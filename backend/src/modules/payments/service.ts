/**
 * modules/payments/service.ts
 * ---------------------------------------------------------------------------
 * Payments and refunds.
 *
 * ===========================================================================
 * THE RULE THIS MODULE EXISTS TO ENFORCE
 * ===========================================================================
 * A payment becomes SUCCESS in exactly one way: a webhook arrives from the
 * provider, its HMAC signature verifies, and the amount it reports matches
 * what we asked for.
 *
 * There is deliberately NO endpoint a browser can call to mark a payment
 * successful. Not a "confirm" route, not a query parameter on the return URL.
 * The customer's browser is under the customer's control, and "the frontend
 * said it worked" is how rental systems get defrauded: change one JavaScript
 * variable, drive away in a car nobody paid for.
 *
 * The return URL exists only to bring the customer back to a page that SHOWS
 * them the status. It carries no authority.
 *
 * ===========================================================================
 * IDEMPOTENCY
 * ===========================================================================
 * Gateways retry webhooks - the same event can arrive three times. Every
 * event is recorded in `webhook_events` with a UNIQUE (provider, eventId).
 * The second delivery is rejected by the DATABASE, not by an application check
 * that two concurrent deliveries could both pass.
 */
import { Prisma } from '@prisma/client';
import type { PaymentType, Role } from '@prisma/client';
import crypto from 'node:crypto';
import { prisma } from '../../config/prisma';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { ApiError, ErrorCode } from '../../utils/ApiError';
import { auditService } from '../audit/service';
import { fireAndForget, notify } from '../notifications/triggers';
import { paymentProvider } from '../../services/payment';
import type { VerifiedWebhookEvent } from '../../services/payment';
import { isBackOffice } from '../../modules/auth/roles';

export interface PaymentActor {
  id: string;
  email: string;
  role: Role;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Which booking statuses accept which kind of payment.
 *
 * They differ, and the difference is operational rather than arbitrary. The
 * RENTAL is paid AFTER the booking is confirmed - confirmation is the company
 * accepting the customer, not a receipt - so CONFIRMED is where most online
 * payments now start from. The DEPOSIT is taken at or after confirmation,
 * often at the counter on handover day, so it stays payable right up to
 * READY_FOR_PICKUP.
 */
const PAYABLE_STATUSES: Record<string, string[]> = {
  RENTAL: ['PENDING', 'CONFIRMED', 'PAYMENT_PENDING'],
  SECURITY_DEPOSIT: ['CONFIRMED', 'PAYMENT_PENDING', 'READY_FOR_PICKUP'],
  EXTENSION: ['ACTIVE', 'EXTENSION_REQUESTED'],
  ADDITIONAL_CHARGE: ['RETURN_PENDING', 'RETURNED', 'COMPLETED'],
};

/**
 * Recompute a payment's refund status from its refund rows.
 *
 * Derived, never set by hand in two places. A payment is REFUNDED only when
 * the refunds that actually COMPLETED add up to the whole amount; anything
 * partial or still in flight leaves it PARTIALLY_REFUNDED. Marking a payment
 * REFUNDED at the moment a refund is requested - which is what used to happen
 * - claims money moved that a provider may still decline.
 */
async function syncPaymentRefundStatus(paymentId: string): Promise<void> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { refunds: true },
  });
  if (!payment) return;

  const completed = payment.refunds
    .filter((refund) => refund.status === 'COMPLETED')
    .reduce((sum, refund) => sum.add(refund.amount), new Prisma.Decimal(0));

  if (completed.lessThanOrEqualTo(0)) return;

  await prisma.payment.update({
    where: { id: paymentId },
    data: { status: completed.greaterThanOrEqualTo(payment.amount) ? 'REFUNDED' : 'PARTIALLY_REFUNDED' },
  });
}

export const paymentsService = {
  /**
   * Record cash taken at the counter (BRD 19).
   *
   * Staff only, and it is the counterpart to the handover guard: a
   * pay-at-pickup booking is CONFIRMED but unpaid, and the vehicle is not
   * released until this has been called.
   *
   * Written as a SUCCESS payment immediately, with no PENDING state and no
   * webhook. That is honest rather than a shortcut - a card payment is pending
   * because a third party is still deciding, whereas notes in a drawer have
   * either been handed over or they have not, and the staff member pressing
   * the button is the one who counted them.
   */
  async recordCash(
    bookingId: string,
    input: { type: 'RENTAL' | 'SECURITY_DEPOSIT'; amount?: string; reference?: string },
    actor: { id: string; email: string; role: string; ipAddress?: string; userAgent?: string },
  ) {
    const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) throw ApiError.notFound('Booking not found');

    if (booking.paymentMethod !== 'CASH_ON_PICKUP') {
      throw ApiError.badRequest(
        'This booking was taken as an online payment. Recording cash against it would double-count the rental.',
      );
    }

    if (booking.status === 'CANCELLED' || booking.status === 'COMPLETED') {
      throw ApiError.conflict(
        `A ${booking.status.toLowerCase()} booking cannot take a payment`,
      );
    }

    const existing = await prisma.payment.findFirst({
      where: { bookingId, type: input.type, status: { in: ['SUCCESS', 'REFUNDED', 'PARTIALLY_REFUNDED'] } },
    });
    if (existing) {
      throw ApiError.conflict(`The ${input.type.toLowerCase().replace(/_/g, ' ')} is already paid`);
    }

    // The amount comes from the BOOKING, not the request, unless staff
    // deliberately override it - the same rule as everywhere else. A till
    // that accepts whatever figure the form posts is not a till.
    const expected =
      input.type === 'RENTAL' ? booking.totalAmount : booking.securityDeposit;
    const amount = input.amount ? new Prisma.Decimal(input.amount) : expected;

    const payment = await prisma.$transaction(async (tx) => {
      const created = await tx.payment.create({
        data: {
          bookingId,
          type: input.type,
          status: 'SUCCESS',
          amount,
          currency: booking.currency,
          provider: 'cash',
          providerReference: input.reference ?? null,
          idempotencyKey: `cash_${bookingId}_${input.type}_${Date.now()}`,
          paidAt: new Date(),
        },
      });

      if (input.type === 'SECURITY_DEPOSIT') {
        const deposit = await tx.securityDeposit.upsert({
          where: { bookingId },
          update: { status: 'HELD', heldAt: new Date() },
          create: {
            bookingId,
            amount,
            currency: booking.currency,
            status: 'HELD',
            heldAt: new Date(),
          },
        });

        await tx.depositTransaction.create({
          data: {
            depositId: deposit.id,
            type: 'HOLD',
            amount,
            reason: 'Security deposit received in cash',
          },
        });
      }

      return created;
    });

    await auditService.record({
      action: 'payment.cash_recorded',
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role as 'ADMIN' | 'STAFF',
      entityType: 'Payment',
      entityId: payment.id,
      // Who took the money matters more here than anywhere else in the system:
      // this is the one payment with no third-party record behind it.
      metadata: {
        bookingNumber: booking.bookingNumber,
        type: input.type,
        amount: amount.toFixed(2),
        reference: input.reference,
      },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    fireAndForget(notify.paymentReceived(payment.id));

    return {
      id: payment.id,
      type: payment.type,
      status: payment.status,
      amount: payment.amount.toFixed(2),
      currency: payment.currency,
      paidAt: payment.paidAt?.toISOString() ?? null,
    };
  },

  /**
   * Start a payment: create our record, ask the provider for a checkout
   * session, and hand the customer the URL.
   *
   * Note what this does NOT do: change the booking status. The booking stays
   * PAYMENT_PENDING until a verified webhook says otherwise.
   */
  async initiate(
    bookingId: string,
    type: PaymentType,
    actor: PaymentActor,
  ): Promise<{ paymentId: string; checkoutUrl: string; amount: string }> {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { customer: { select: { email: true } } },
    });
    if (!booking) throw ApiError.notFound('Booking not found');

    const backOffice = isBackOffice(actor.role);
    if (!backOffice && booking.customerId !== actor.id) {
      throw ApiError.notFound('Booking not found');
    }

    /*
     * A MONTHLY rental keeps taking rental payments long after collection.
     *
     * The upfront list stops at PAYMENT_PENDING, which is right when the whole
     * rental is paid before the keys - but month four of a six-month term
     * falls due while the car is out and the booking is ACTIVE. Held to the
     * upfront list, a long-term customer simply could not pay, and the answer
     * came back as "a ready for pickup booking cannot take a rental payment".
     *
     * Terminal statuses stay excluded: a finished or cancelled booking is not
     * collecting more rent.
     */
    const payableFrom =
      type === 'RENTAL' && booking.billingCycle === 'MONTHLY'
        ? ['PENDING', 'CONFIRMED', 'PAYMENT_PENDING', 'READY_FOR_PICKUP', 'ACTIVE', 'EXTENSION_REQUESTED', 'RETURN_PENDING']
        : (PAYABLE_STATUSES[type] ?? []);

    if (!payableFrom.includes(booking.status)) {
      throw ApiError.conflict(
        booking.status === 'DOCUMENT_VERIFICATION'
          ? 'Your documents must be approved before payment.'
          : `A ${booking.status.toLowerCase().replace(/_/g, ' ')} booking cannot take a ${type
              .toLowerCase()
              .replace(/_/g, ' ')} payment.`,
      );
    }

    /*
     * The amount comes from the BOOKING, never from the request.
     *
     * For a MONTHLY booking the rental is not one figure but a schedule, so
     * the sum owed now is the OLDEST unpaid month - never the whole term.
     * Asking a long-term customer for six months before they have the keys is
     * the thing monthly billing exists to avoid.
     */
    let dueInstalment: {
      id: string;
      sequence: number;
      amount: Prisma.Decimal;
      extrasAmount: Prisma.Decimal;
    } | null = null;

    if (type === 'RENTAL' && booking.billingCycle === 'MONTHLY') {
      dueInstalment = await prisma.rentalInstalment.findFirst({
        where: { bookingId, status: { in: ['DUE', 'SCHEDULED'] } },
        orderBy: { sequence: 'asc' },
        select: { id: true, sequence: true, amount: true, extrasAmount: true },
      });

      if (!dueInstalment) {
        throw ApiError.badRequest('Every month of this rental has been paid.');
      }
    }

    /*
     * A month's bill is the rent PLUS whatever was billed alongside it.
     *
     * Salik and fines on a long-term rental ride on the next invoice rather
     * than eating the damage deposit (see fleet/finesService). If the checkout
     * asked for `amount` alone it would collect the rent, mark the month paid,
     * and silently drop the extras - the customer would be square and the
     * company short, with nothing left pointing at the difference.
     */
    const amount =
      type === 'SECURITY_DEPOSIT'
        ? booking.securityDeposit
        : dueInstalment
          ? dueInstalment.amount.add(dueInstalment.extrasAmount)
          : booking.totalAmount;

    if (amount.lessThanOrEqualTo(0)) {
      throw ApiError.badRequest('There is nothing to pay for this booking');
    }

    // Says WHICH month, so a customer with six charges from one rental can
    // tell them apart on their card statement.
    const paymentDescription =
      type === 'SECURITY_DEPOSIT'
        ? `Security deposit - ${booking.bookingNumber}`
        : dueInstalment
          ? `Rental month ${dueInstalment.sequence} - ${booking.bookingNumber}`
          : `Rental - ${booking.bookingNumber}`;

    // An existing pending payment is reused rather than duplicated - a
    // customer clicking Pay twice must not create two charges.
    const existing = await prisma.payment.findFirst({
      where: {
        bookingId,
        type,
        status: 'PENDING',
        // A half-finished checkout for LAST month must not be handed back as
        // this month's, or the customer pays one month twice and the schedule
        // never advances.
        ...(dueInstalment ? { instalment: { id: dueInstalment.id } } : {}),
      },
    });
    if (existing?.providerPaymentId) {
      /*
       * A charge can land between abandoning a checkout and coming back to it,
       * so the row's figure is re-stated before the customer is sent onward.
       * Otherwise this month's Salik would be invisible to anyone reading the
       * payment afterwards, even though the checkout asked for it.
       */
      if (!existing.amount.equals(amount)) {
        await prisma.payment.update({ where: { id: existing.id }, data: { amount } });
      }

      const session = await paymentProvider.createPayment({
        bookingNumber: booking.bookingNumber,
        amount: amount.toFixed(2),
        currency: booking.currency,
        description: paymentDescription,
        idempotencyKey: existing.idempotencyKey,
        customerEmail: booking.customer.email,
        returnUrl: `${env.PAYMENT_RETURN_URL}/${booking.id}`,
        metadata: { bookingId: booking.id, paymentId: existing.id },
      });
      return {
        paymentId: existing.id,
        checkoutUrl: session.checkoutUrl,
        amount: amount.toFixed(2),
      };
    }

    const idempotencyKey = crypto.randomUUID();

    const payment = await prisma.payment.create({
      data: {
        bookingId,
        type,
        amount,
        currency: booking.currency,
        provider: paymentProvider.name,
        idempotencyKey,
        status: 'PENDING',
        // Tied to the month it settles, so the schedule and the money can
        // never disagree about which month was paid.
        ...(dueInstalment ? { instalment: { connect: { id: dueInstalment.id } } } : {}),
      },
    });

    const session = await paymentProvider.createPayment({
      bookingNumber: booking.bookingNumber,
      amount: amount.toFixed(2),
      currency: booking.currency,
      description: paymentDescription,
      idempotencyKey,
      customerEmail: booking.customer.email,
      returnUrl: `${env.PAYMENT_RETURN_URL}/${booking.id}`,
      metadata: { bookingId: booking.id, paymentId: payment.id },
    });

    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        providerPaymentId: session.providerPaymentId,
        providerReference: session.reference ?? null,
      },
    });

    /*
     * Move a confirmed booking onto the payment step.
     *
     * This does NOT claim the money has arrived - the payment row is still
     * PENDING and only a verified webhook may mark it SUCCESS. It records
     * that the customer has entered checkout, which is the difference between
     * "confirmed, nothing owed yet acted on" and "paying right now", and it
     * is what puts the booking on the payment step of their progress rail.
     */
    if (type === 'RENTAL' && booking.status === 'CONFIRMED') {
      await prisma.$transaction(async (tx) => {
        await tx.booking.update({
          where: { id: bookingId },
          data: { status: 'PAYMENT_PENDING' },
        });
        await tx.bookingStatusHistory.create({
          data: {
            bookingId,
            fromStatus: 'CONFIRMED',
            toStatus: 'PAYMENT_PENDING',
            changedById: actor.id,
            reason: 'Checkout started',
          },
        });
      });
    }

    await auditService.record({
      action: 'payment.initiated',
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      entityType: 'Payment',
      entityId: payment.id,
      metadata: { bookingNumber: booking.bookingNumber, type, amount: amount.toFixed(2) },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return { paymentId: payment.id, checkoutUrl: session.checkoutUrl, amount: amount.toFixed(2) };
  },

  /**
   * Handle a webhook. THE ONLY PATH to a successful payment.
   *
   * Steps, in order, each of which can reject the event:
   *   1. signature verified (by the provider driver, before we are called)
   *   2. not already processed          - idempotency, enforced by the DB
   *   3. the payment exists             - unknown reference is discarded
   *   4. the AMOUNT MATCHES our record  - see below
   *   5. only then: mark success, confirm the booking, open the deposit
   *
   * Step 4 deserves its own note. A signature proves the message came from the
   * provider; it does NOT prove the amount is the one we asked for. Systems
   * have been robbed by a genuine, correctly-signed 1.00 payment accepted
   * against a 5,000 booking.
   */
  async handleWebhook(event: VerifiedWebhookEvent): Promise<{ handled: boolean; reason?: string }> {
    // Step 2. The unique index is the guard, not a prior SELECT: two
    // simultaneous deliveries would both pass a read-then-write check.
    try {
      await prisma.webhookEvent.create({
        data: {
          provider: paymentProvider.name,
          eventId: event.eventId,
          type: event.type,
          payload: event.raw as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        logger.info('Ignoring duplicate webhook delivery', { eventId: event.eventId });
        // Reported as handled: the provider did nothing wrong, and an error
        // would make it retry the duplicate forever.
        return { handled: true, reason: 'duplicate' };
      }
      throw error;
    }

    const markProcessed = (error?: string) =>
      prisma.webhookEvent.updateMany({
        where: { provider: paymentProvider.name, eventId: event.eventId },
        data: { processedAt: new Date(), error: error ?? null },
      });

    /*
     * A REFUND outcome, not a payment one.
     *
     * Handled before anything below, because the checks that follow are about
     * payments: they short-circuit on "already settled", which is exactly what
     * a payment being refunded looks like. That is why refund webhooks were
     * silently swallowed and every refund sat PENDING for ever - nothing in
     * the system ever completed one.
     */
    if (event.providerRefundId) {
      const refund = await prisma.refund.findFirst({
        where: { providerRefundId: event.providerRefundId },
      });

      if (!refund) {
        await markProcessed('Unknown refund reference');
        return { handled: false, reason: 'unknown_refund' };
      }

      if (refund.status === 'COMPLETED' || refund.status === 'FAILED') {
        await markProcessed();
        return { handled: true, reason: 'already_settled' };
      }

      const succeeded = event.status === 'succeeded';
      await prisma.refund.update({
        where: { id: refund.id },
        data: {
          status: succeeded ? 'COMPLETED' : 'FAILED',
          completedAt: succeeded ? new Date() : null,
          failureReason: succeeded ? null : 'The provider reported the refund as failed',
        },
      });

      if (succeeded) await syncPaymentRefundStatus(refund.paymentId);

      await markProcessed();
      logger.info('Refund outcome applied', { refundId: refund.id, succeeded });
      return { handled: true, reason: succeeded ? 'refund_completed' : 'refund_failed' };
    }

    if (!event.providerPaymentId) {
      await markProcessed('No providerPaymentId on the event');
      return { handled: false, reason: 'no_payment_reference' };
    }

    // Step 3.
    const payment = await prisma.payment.findUnique({
      where: { providerPaymentId: event.providerPaymentId },
      include: { booking: true },
    });

    if (!payment) {
      logger.warn('Webhook referenced an unknown payment', {
        providerPaymentId: event.providerPaymentId,
      });
      await markProcessed('Unknown payment reference');
      return { handled: false, reason: 'unknown_payment' };
    }

    if (payment.status === 'SUCCESS' || payment.status === 'REFUNDED') {
      await markProcessed();
      return { handled: true, reason: 'already_settled' };
    }

    // Step 4. THE AMOUNT CHECK.
    if (event.status === 'succeeded') {
      const reported = new Prisma.Decimal(event.amount ?? '0');

      if (!reported.equals(payment.amount)) {
        logger.error('Webhook amount does not match the payment record', {
          paymentId: payment.id,
          expected: payment.amount.toFixed(2),
          reported: reported.toFixed(2),
        });

        await auditService.record({
          action: 'payment.amount_mismatch',
          entityType: 'Payment',
          entityId: payment.id,
          metadata: {
            expected: payment.amount.toFixed(2),
            reported: reported.toFixed(2),
            eventId: event.eventId,
          },
        });

        await markProcessed('Amount mismatch');
        // Deliberately NOT marked successful. A correctly-signed payment for
        // the wrong amount is still the wrong amount.
        return { handled: false, reason: 'amount_mismatch' };
      }
    }

    // Step 5.
    if (event.status === 'succeeded') {
      await paymentsService.applySuccessfulPayment(payment.id);
    } else if (event.status === 'failed' || event.status === 'cancelled') {
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'FAILED', failureReason: event.failureReason ?? `Payment ${event.status}` },
      });

      await auditService.record({
        action: 'payment.failed',
        entityType: 'Payment',
        entityId: payment.id,
        metadata: { reason: event.failureReason ?? event.status },
      });
    }

    await markProcessed();
    return { handled: true };
  },

  /**
   * Mark a payment successful and move everything that depends on it.
   *
   * One transaction: the payment, the booking status and the deposit either
   * all land or none do. A confirmed booking with no payment row - or a paid
   * booking still sitting in PAYMENT_PENDING - is worse than a clean failure
   * the provider will retry.
   */
  async applySuccessfulPayment(paymentId: string): Promise<void> {
    /*
     * Set inside the transaction, acted on after it commits.
     *
     * Issuing the month's tax invoice takes the next number from a shared
     * counter; doing that inside the payment transaction would let numbering
     * contention roll back money that has already cleared at the gateway.
     */
    let invoiceThisInstalment: string | null = null;

    await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUniqueOrThrow({
        where: { id: paymentId },
        include: { booking: true },
      });

      await tx.payment.update({
        where: { id: paymentId },
        data: { status: 'SUCCESS', paidAt: new Date(), failureReason: null },
      });

      if (payment.type === 'RENTAL') {
        /*
         * A cleared rental payment makes the car collectable, so the booking
         * lands on READY_FOR_PICKUP.
         *
         * It used to land on CONFIRMED, because confirmation was what payment
         * bought. It no longer is - the booking was confirmed when its
         * documents passed, and sending it back there would walk the customer
         * BACKWARDS along their own progress rail after paying.
         *
         * Only a booking actually waiting on payment is advanced: a
         * late-arriving webhook must not drag an ACTIVE rental backwards
         * either.
         */
        /*
         * A monthly booking settles ONE month, then re-checks.
         *
         * Marking the month paid has to happen whatever the booking's status
         * is - month four clears while the rental is ACTIVE, long after the
         * booking stopped being "awaiting payment".
         */
        const instalment = await tx.rentalInstalment.findUnique({
          where: { paymentId: payment.id },
        });

        if (instalment) {
          await tx.rentalInstalment.update({
            where: { id: instalment.id },
            data: { status: 'PAID', paidAt: new Date() },
          });

          // Anything billed with this month has now been paid with it, so it
          // stops showing as owing. INVOICED is the honest state: it was
          // settled on an invoice, not taken out of the deposit.
          await tx.additionalCharge.updateMany({
            where: { instalmentId: instalment.id, status: 'PENDING' },
            data: { status: 'INVOICED' },
          });

          /*
           * A paid month is a supply, and a supply needs a tax invoice.
           *
           * Noted here and issued AFTER the transaction commits: the invoice
           * takes the next number from a shared counter, and holding that
           * inside a payment transaction would let a slow mail server or a
           * numbering contention roll back money that has already cleared.
           */
          invoiceThisInstalment = instalment.id;
        }

        const AWAITING = ['PENDING', 'CONFIRMED', 'PAYMENT_PENDING'];
        if (AWAITING.includes(payment.booking.status)) {
          await tx.booking.update({
            where: { id: payment.bookingId },
            data: { status: 'READY_FOR_PICKUP', holdExpiresAt: null },
          });

          await tx.bookingStatusHistory.create({
            data: {
              bookingId: payment.bookingId,
              fromStatus: payment.booking.status,
              toStatus: 'READY_FOR_PICKUP',
              changedById: null,
              reason: 'Payment received',
            },
          });
        }

        // Open the deposit record. It is not HELD until the deposit is paid.
        if (payment.booking.securityDeposit.greaterThan(0)) {
          await tx.securityDeposit.upsert({
            where: { bookingId: payment.bookingId },
            update: {},
            create: {
              bookingId: payment.bookingId,
              amount: payment.booking.securityDeposit,
              currency: payment.booking.currency,
              status: 'PENDING',
            },
          });
        }
      }

      if (payment.type === 'SECURITY_DEPOSIT') {
        const deposit = await tx.securityDeposit.upsert({
          where: { bookingId: payment.bookingId },
          update: { status: 'HELD', heldAt: new Date() },
          create: {
            bookingId: payment.bookingId,
            amount: payment.amount,
            currency: payment.currency,
            status: 'HELD',
            heldAt: new Date(),
          },
        });

        // The opening entry in the ledger.
        await tx.depositTransaction.create({
          data: {
            depositId: deposit.id,
            type: 'HOLD',
            amount: payment.amount,
            reason: 'Security deposit received',
          },
        });
      }
    });

    /*
     * A paid month is a supply, so it gets its own tax invoice.
     *
     * Detached and swallowed: the money has cleared and the month is marked
     * paid whatever happens here. A failure leaves the month invoiceable by
     * hand from the booking, which is a recoverable state - rolling back a
     * settled payment is not.
     */
    if (invoiceThisInstalment) {
      try {
        // Imported here rather than at the top: invoices reach back into
        // bookings and settings, and a static import would close the loop.
        const { invoicesService } = await import('../invoices/service');
        await invoicesService.issueForInstalment(invoiceThisInstalment, {
          id: null,
          email: 'system',
          role: 'ADMIN',
        });
      } catch (error) {
        logger.warn('Could not issue the invoice for a paid month', {
          instalmentId: invoiceThisInstalment,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const payment = await prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
      include: { booking: { select: { bookingNumber: true } } },
    });

    await auditService.record({
      action: 'payment.succeeded',
      entityType: 'Payment',
      entityId: paymentId,
      metadata: {
        bookingNumber: payment.booking.bookingNumber,
        type: payment.type,
        amount: payment.amount.toFixed(2),
      },
    });

    /*
     * Detached on purpose: the money has arrived, and a mail server being down
     * must not undo that.
     *
     * Only the receipt goes out. The "booking confirmed" message was sent when
     * the booking was confirmed - which now happens before payment - so
     * sending it again here would tell the customer a second time about
     * something that happened days ago.
     */
    fireAndForget(notify.paymentReceived(paymentId));

    logger.info('Payment applied', { paymentId, type: payment.type });
  },

  /**
   * Refund a payment, fully or partially (BRD 32).
   *
   * The cap is enforced against the sum of refunds ALREADY issued, not against
   * a flag on the payment. Two concurrent partial refunds must not between
   * them exceed the original charge.
   */
  async refund(
    paymentId: string,
    input: { amount?: string; reason?: string },
    actor: PaymentActor,
  ) {
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: { booking: { select: { bookingNumber: true } } },
    });
    if (!payment) throw ApiError.notFound('Payment not found');

    if (payment.status !== 'SUCCESS' && payment.status !== 'PARTIALLY_REFUNDED') {
      throw ApiError.conflict('Only a successful payment can be refunded');
    }

    if (!payment.providerPaymentId) {
      throw new ApiError(
        409,
        'This payment has no provider reference and cannot be refunded automatically',
        ErrorCode.PAYMENT_ERROR,
      );
    }

    /*
     * ===================================================================
     * CLAIM FIRST, THEN CALL THE PROVIDER
     * ===================================================================
     * This used to read the existing refunds, work out what was left,
     * validate against it, call the gateway, and only then write a row. Two
     * admins refunding at the same moment both read the same "remaining",
     * both passed, and both sent real money - and because the gateway had
     * already moved it, no database guard could take it back.
     *
     * So the row is created FIRST, inside a transaction that locks the
     * payment. `FOR UPDATE` makes concurrent refunds queue rather than race:
     * the second one re-reads the refunds with the first already committed,
     * finds less remaining, and is refused before anything is sent.
     *
     * The claim starts PENDING. That is not a formality - a PENDING refund
     * still counts against the cap, so an in-flight refund cannot be
     * double-spent, and a provider failure below marks it FAILED, which is
     * the one status excluded from the sum.
     */
    const claim = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM payments WHERE id = ${paymentId}::uuid FOR UPDATE`;

      const existing = await tx.refund.findMany({ where: { paymentId } });
      const alreadyRefunded = existing
        .filter((refund) => refund.status !== 'FAILED')
        .reduce((sum, refund) => sum.add(refund.amount), new Prisma.Decimal(0));

      const remaining = payment.amount.sub(alreadyRefunded);
      const amount = input.amount ? new Prisma.Decimal(input.amount) : remaining;

      if (amount.lessThanOrEqualTo(0)) {
        throw ApiError.badRequest('The refund amount must be greater than zero');
      }
      if (amount.greaterThan(remaining)) {
        throw ApiError.badRequest(
          `Only ${remaining.toFixed(2)} ${payment.currency} remains refundable on this payment`,
        );
      }

      return tx.refund.create({
        data: {
          paymentId,
          amount,
          reason: input.reason?.trim() ?? null,
          initiatedById: actor.id,
          status: 'PENDING',
        },
      });
    });

    // Outside the transaction on purpose: never hold a row lock across a
    // network call to a third party.
    let result;
    try {
      result = await paymentProvider.refundPayment({
        providerPaymentId: payment.providerPaymentId,
        amount: claim.amount.toFixed(2),
        reason: input.reason,
        idempotencyKey: claim.id,
      });
    } catch (error) {
      // The claim must not sit PENDING forever holding capacity the customer
      // could still be refunded.
      await prisma.refund.update({
        where: { id: claim.id },
        data: {
          status: 'FAILED',
          failureReason: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    }

    const refund = await prisma.refund.update({
      where: { id: claim.id },
      data: {
        providerRefundId: result.providerRefundId,
        // COMPLETED only if the provider says the money has actually moved.
        // Otherwise it stays PENDING until the refund webhook says so.
        status: result.status === 'succeeded' ? 'COMPLETED' : 'PENDING',
        completedAt: result.status === 'succeeded' ? new Date() : null,
      },
    });

    if (refund.status === 'COMPLETED') {
      await syncPaymentRefundStatus(paymentId);
    }

    await auditService.record({
      action: 'payment.refunded',
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      entityType: 'Refund',
      entityId: refund.id,
      metadata: {
        bookingNumber: payment.booking.bookingNumber,
        amount: claim.amount.toFixed(2),
        reason: input.reason,
        status: refund.status,
      },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return refund;
  },

  /** Payments for one booking. Ownership is checked by the caller. */
  /**
   * Every payment, newest first, for the back office.
   *
   * There was no way to answer "what came in today" without opening bookings
   * one at a time. Filtered by status and type because the two questions
   * anybody actually asks are "what failed" and "what deposits are sitting
   * with us".
   */
  async list(query: {
    page: number;
    limit: number;
    status?: string;
    type?: string;
    search?: string;
  }) {
    const where: Prisma.PaymentWhereInput = {
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.type ? { type: query.type as never } : {}),
      ...(query.search
        ? {
            OR: [
              { booking: { bookingNumber: { contains: query.search, mode: 'insensitive' } } },
              { booking: { customer: { fullName: { contains: query.search, mode: 'insensitive' } } } },
              { providerReference: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await prisma.$transaction([
      prisma.payment.findMany({
        where,
        include: {
          booking: {
            select: { bookingNumber: true, customer: { select: { fullName: true, email: true } } },
          },
          refunds: { select: { amount: true, status: true } },
          instalment: { select: { sequence: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      prisma.payment.count({ where }),
    ]);

    return {
      items: items.map((payment) => ({
        id: payment.id,
        bookingId: payment.bookingId,
        bookingNumber: payment.booking.bookingNumber,
        customerName: payment.booking.customer.fullName,
        customerEmail: payment.booking.customer.email,
        type: payment.type,
        status: payment.status,
        amount: payment.amount.toFixed(2),
        currency: payment.currency,
        provider: payment.provider,
        reference: payment.providerReference,
        failureReason: payment.failureReason,
        /** Which month of a long-term rental this settled, if any. */
        instalmentSequence: payment.instalment?.sequence ?? null,
        refundedTotal: payment.refunds
          .filter((refund) => refund.status === 'COMPLETED')
          .reduce((sum, refund) => sum.add(refund.amount), new Prisma.Decimal(0))
          .toFixed(2),
        paidAt: payment.paidAt?.toISOString() ?? null,
        createdAt: payment.createdAt.toISOString(),
      })),
      total,
    };
  },

  async listForBooking(bookingId: string) {
    return prisma.payment.findMany({
      where: { bookingId },
      include: { refunds: true },
      orderBy: { createdAt: 'desc' },
    });
  },
};
