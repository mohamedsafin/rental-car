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
import type { PaymentType } from '@prisma/client';
import crypto from 'node:crypto';
import { prisma } from '../../config/prisma';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { ApiError, ErrorCode } from '../../utils/ApiError';
import { auditService } from '../audit/service';
import { fireAndForget, notify } from '../notifications/triggers';
import { paymentProvider } from '../../services/payment';
import type { VerifiedWebhookEvent } from '../../services/payment';

export interface PaymentActor {
  id: string;
  email: string;
  role: 'CUSTOMER' | 'ADMIN' | 'STAFF';
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Which booking statuses accept which kind of payment.
 *
 * They differ, and the difference is operational rather than arbitrary. The
 * RENTAL is paid to GET a confirmation, so it only makes sense while the
 * booking is still waiting on payment. The DEPOSIT is taken at or after
 * confirmation - often at the counter on handover day - so it must remain
 * payable once the booking is CONFIRMED or READY_FOR_PICKUP.
 */
const PAYABLE_STATUSES: Record<string, string[]> = {
  RENTAL: ['PENDING', 'PAYMENT_PENDING'],
  SECURITY_DEPOSIT: ['PAYMENT_PENDING', 'CONFIRMED', 'READY_FOR_PICKUP'],
  EXTENSION: ['ACTIVE', 'EXTENSION_REQUESTED'],
  ADDITIONAL_CHARGE: ['RETURN_PENDING', 'RETURNED', 'COMPLETED'],
};

export const paymentsService = {
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

    const isBackOffice = actor.role === 'ADMIN' || actor.role === 'STAFF';
    if (!isBackOffice && booking.customerId !== actor.id) {
      throw ApiError.notFound('Booking not found');
    }

    const payableFrom = PAYABLE_STATUSES[type] ?? [];
    if (!payableFrom.includes(booking.status)) {
      throw ApiError.conflict(
        booking.status === 'DOCUMENT_VERIFICATION'
          ? 'Your documents must be approved before payment.'
          : `A ${booking.status.toLowerCase().replace(/_/g, ' ')} booking cannot take a ${type
              .toLowerCase()
              .replace(/_/g, ' ')} payment.`,
      );
    }

    // The amount comes from the BOOKING, never from the request. The booking's
    // total was itself computed by the pricing engine at creation time.
    const amount =
      type === 'SECURITY_DEPOSIT' ? booking.securityDeposit : booking.totalAmount;

    if (amount.lessThanOrEqualTo(0)) {
      throw ApiError.badRequest('There is nothing to pay for this booking');
    }

    // An existing pending payment is reused rather than duplicated - a
    // customer clicking Pay twice must not create two charges.
    const existing = await prisma.payment.findFirst({
      where: { bookingId, type, status: 'PENDING' },
    });
    if (existing?.providerPaymentId) {
      const session = await paymentProvider.createPayment({
        bookingNumber: booking.bookingNumber,
        amount: amount.toFixed(2),
        currency: booking.currency,
        description: `${type === 'SECURITY_DEPOSIT' ? 'Security deposit' : 'Rental'} - ${booking.bookingNumber}`,
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
      },
    });

    const session = await paymentProvider.createPayment({
      bookingNumber: booking.bookingNumber,
      amount: amount.toFixed(2),
      currency: booking.currency,
      description: `${type === 'SECURITY_DEPOSIT' ? 'Security deposit' : 'Rental'} - ${booking.bookingNumber}`,
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
        // Only advance a booking that is actually waiting on payment. A
        // late-arriving webhook must not drag an ACTIVE rental backwards.
        if (payment.booking.status === 'PAYMENT_PENDING' || payment.booking.status === 'PENDING') {
          await tx.booking.update({
            where: { id: payment.bookingId },
            data: { status: 'CONFIRMED', holdExpiresAt: null },
          });

          await tx.bookingStatusHistory.create({
            data: {
              bookingId: payment.bookingId,
              fromStatus: payment.booking.status,
              toStatus: 'CONFIRMED',
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

    // Detached on purpose. The money has arrived and the booking is confirmed;
    // a mail server being down must not undo either of those.
    fireAndForget(notify.paymentReceived(paymentId));
    if (payment.type === 'RENTAL') {
      fireAndForget(notify.bookingConfirmed(payment.bookingId));
    }

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
      include: { refunds: true, booking: { select: { bookingNumber: true } } },
    });
    if (!payment) throw ApiError.notFound('Payment not found');

    if (payment.status !== 'SUCCESS' && payment.status !== 'PARTIALLY_REFUNDED') {
      throw ApiError.conflict('Only a successful payment can be refunded');
    }

    const alreadyRefunded = payment.refunds
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

    if (!payment.providerPaymentId) {
      throw new ApiError(
        409,
        'This payment has no provider reference and cannot be refunded automatically',
        ErrorCode.PAYMENT_ERROR,
      );
    }

    const result = await paymentProvider.refundPayment({
      providerPaymentId: payment.providerPaymentId,
      amount: amount.toFixed(2),
      reason: input.reason,
      idempotencyKey: crypto.randomUUID(),
    });

    const refund = await prisma.$transaction(async (tx) => {
      const created = await tx.refund.create({
        data: {
          paymentId,
          amount,
          reason: input.reason ?? null,
          providerRefundId: result.providerRefundId,
          initiatedById: actor.id,
          // PENDING until the provider confirms by webhook. Marking it
          // COMPLETED here would claim money moved that has not moved.
          status: result.status === 'succeeded' ? 'COMPLETED' : 'PENDING',
          completedAt: result.status === 'succeeded' ? new Date() : null,
        },
      });

      const totalRefunded = alreadyRefunded.add(amount);
      await tx.payment.update({
        where: { id: paymentId },
        data: {
          status: totalRefunded.equals(payment.amount) ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
        },
      });

      return created;
    });

    await auditService.record({
      action: 'payment.refunded',
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      entityType: 'Refund',
      entityId: refund.id,
      metadata: {
        bookingNumber: payment.booking.bookingNumber,
        amount: amount.toFixed(2),
        reason: input.reason,
      },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return refund;
  },

  /** Payments for one booking. Ownership is checked by the caller. */
  async listForBooking(bookingId: string) {
    return prisma.payment.findMany({
      where: { bookingId },
      include: { refunds: true },
      orderBy: { createdAt: 'desc' },
    });
  },
};
