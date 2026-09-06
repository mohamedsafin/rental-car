/**
 * modules/notifications/triggers.ts
 * ---------------------------------------------------------------------------
 * The events that produce a message, and the data each template gets.
 *
 * Kept in one file rather than scattered through the modules that fire them,
 * so "what do we email a customer, and when?" is answerable by reading a
 * single screen. The calling module says WHAT HAPPENED; this file decides what
 * that means for the customer's inbox.
 *
 * Every function here is fire-and-forget. They are called with `void` from
 * inside business flows and they never throw: a booking is confirmed whether
 * or not the confirmation email left the building, and letting a mail outage
 * roll back a paid booking would be a far worse failure than a missing email.
 */
import { prisma } from '../../config/prisma';
import { logger } from '../../config/logger';
import { env } from '../../config/env';
import { notificationsService } from './service';

/** Template keys, in one place so a typo cannot silently send nothing. */
export const TemplateKey = {
  BOOKING_CREATED: 'booking.created',
  BOOKING_CONFIRMED: 'booking.confirmed',
  BOOKING_CANCELLED: 'booking.cancelled',
  PAYMENT_RECEIVED: 'payment.received',
  PICKUP_REMINDER: 'booking.pickup_reminder',
  RETURN_REMINDER: 'booking.return_reminder',
  DOCUMENT_REVIEWED: 'document.reviewed',
  INVOICE_ISSUED: 'invoice.issued',
  DEPOSIT_RELEASED: 'deposit.released',
} as const;

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 16).replace('T', ' ');
}

async function bookingData(bookingId: string) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      vehicle: { select: { brand: true, model: true, year: true } },
      customer: { select: { id: true, fullName: true, email: true } },
      pickupLocation: { select: { name: true } },
    },
  });
  if (!booking) return null;

  return {
    recipientId: booking.customerId,
    paymentMethod: booking.paymentMethod,
    data: {
      customerName: booking.customer.fullName,
      bookingNumber: booking.bookingNumber,
      vehicle: `${booking.vehicle.brand} ${booking.vehicle.model} (${booking.vehicle.year})`,
      pickupAt: formatDate(booking.pickupAt),
      returnAt: formatDate(booking.returnAt),
      pickupLocation: booking.pickupLocation?.name ?? 'our office',
      rentalDays: booking.rentalDays,
      total: `${booking.currency} ${booking.totalAmount.toFixed(2)}`,
      deposit: `${booking.currency} ${booking.securityDeposit.toFixed(2)}`,
      bookingUrl: `${env.PUBLIC_SITE_URL}/account/bookings/${booking.id}`,
    },
    related: { type: 'Booking', id: booking.id },
  };
}

export const notify = {
  /** A booking was created - status decides which of two messages applies. */
  async bookingCreated(bookingId: string, awaitingDocuments: boolean) {
    const context = await bookingData(bookingId);
    if (!context) return;

    await notificationsService.send({
      templateKey: TemplateKey.BOOKING_CREATED,
      recipientId: context.recipientId,
      data: {
        ...context.data,
        nextStep: awaitingDocuments
          ? 'We need to verify your documents before your booking can be confirmed.'
          : 'Your booking is held while you complete payment.',
      },
      related: context.related,
    });
  },

  /**
   * The booking is confirmed and the vehicle is reserved (BRD 42).
   *
   * Reached three ways - an online payment clearing, staff confirming a
   * verified cash booking, and a cash booking that was confirmed the moment
   * it was made - so the wording cannot assume money has arrived. Saying
   * "your payment has gone through" to someone who is paying at the counter
   * is not a cosmetic error: it tells them there is nothing left to pay, and
   * they turn up without the cash.
   *
   * Both lines are resolved HERE, not in the template, because `fill` runs a
   * single pass - a {{total}} sitting inside a substituted value would reach
   * the customer as the literal text `{{total}}`.
   */
  async bookingConfirmed(bookingId: string) {
    const context = await bookingData(bookingId);
    if (!context) return;

    const payingCash = context.paymentMethod === 'CASH_ON_PICKUP';

    await notificationsService.send({
      templateKey: TemplateKey.BOOKING_CONFIRMED,
      recipientId: context.recipientId,
      data: {
        ...context.data,
        confirmationLine: payingCash
          ? 'Your booking is confirmed and the vehicle is reserved for you.'
          : 'Your payment has gone through and the vehicle is reserved for you.',
        paymentNote: payingCash
          ? `You chose to pay when you collect the vehicle. Please bring ${context.data.total} - we cannot hand over the keys until it is paid.`
          : 'Paid in full. There is nothing further to pay before you collect it.',
      },
      related: context.related,
    });
  },

  async bookingCancelled(bookingId: string, cancellationFee: string, refundDue: string) {
    const context = await bookingData(bookingId);
    if (!context) return;

    await notificationsService.send({
      templateKey: TemplateKey.BOOKING_CANCELLED,
      recipientId: context.recipientId,
      data: { ...context.data, cancellationFee, refundDue },
      related: context.related,
    });
  },

  async paymentReceived(paymentId: string) {
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: { booking: { select: { id: true, bookingNumber: true, customerId: true } } },
    });
    if (!payment) return;

    await notificationsService.send({
      templateKey: TemplateKey.PAYMENT_RECEIVED,
      recipientId: payment.booking.customerId,
      data: {
        bookingNumber: payment.booking.bookingNumber,
        amount: `${payment.currency} ${payment.amount.toFixed(2)}`,
        paymentType: payment.type.replace(/_/g, ' ').toLowerCase(),
        bookingUrl: `${env.PUBLIC_SITE_URL}/account/bookings/${payment.booking.id}`,
      },
      related: { type: 'Booking', id: payment.booking.id },
    });
  },

  /**
   * A staff decision on an identity document (BRD 13).
   *
   * `nextStep` matters more than the verdict. "Your passport was approved" is
   * not actionable on its own - the customer wants to know whether they can
   * now book, or whether something else is still outstanding.
   */
  async documentReviewed(
    customerUserId: string,
    documentType: string,
    approved: boolean,
    options: { reason?: string; nowVerified?: boolean; documentId?: string } = {},
  ) {
    const nextStep = approved
      ? options.nowVerified
        ? 'Your account is fully verified - you can book and pay straight away.'
        : 'One or more documents are still outstanding, so we cannot confirm a booking yet.'
      : 'Please upload a corrected copy so we can check it again.';

    await notificationsService.send({
      templateKey: TemplateKey.DOCUMENT_REVIEWED,
      recipientId: customerUserId,
      data: {
        documentType: documentType.replace(/_/g, ' ').toLowerCase(),
        outcome: approved ? 'approved' : 'not accepted',
        reason: options.reason ?? '',
        nextStep,
        documentsUrl: `${env.PUBLIC_SITE_URL}/account/documents`,
      },
      // Keyed to the DOCUMENT, so the log can be filtered by the thing that
      // was actually reviewed rather than by the person.
      related: { type: 'CustomerDocument', id: options.documentId ?? customerUserId },
    });
  },

  async invoiceIssued(invoiceId: string) {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { booking: { select: { bookingNumber: true } } },
    });
    if (!invoice) return;

    await notificationsService.send({
      templateKey: TemplateKey.INVOICE_ISSUED,
      recipientId: invoice.customerId,
      data: {
        customerName: invoice.customerName,
        invoiceNumber: invoice.invoiceNumber,
        bookingNumber: invoice.booking.bookingNumber,
        total: `${invoice.currency} ${invoice.total.toFixed(2)}`,
        invoiceUrl: `${env.PUBLIC_SITE_URL}/account/invoices/${invoice.id}`,
      },
      related: { type: 'Invoice', id: invoice.id },
    });
  },

  /**
   * The scheduled sweep for pickup and return reminders (BRD 43).
   *
   * Idempotent by query, not by flag: it only picks bookings whose reminder
   * has not already been logged. Re-running the job an hour later, or twice
   * because a cron fired twice, does not send a second reminder.
   */
  async runDueReminders(now = new Date()) {
    const results = { pickup: 0, return: 0 };

    // Anything starting or ending in the next 24 hours. A wider net than a
    // narrow "exactly 24h from now" window, which a job that runs late would
    // step straight over.
    const horizon = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const [pickups, returns] = await Promise.all([
      prisma.booking.findMany({
        where: {
          status: { in: ['CONFIRMED', 'READY_FOR_PICKUP'] },
          pickupAt: { gte: now, lte: horizon },
        },
        select: { id: true },
      }),
      prisma.booking.findMany({
        where: { status: 'ACTIVE', returnAt: { gte: now, lte: horizon } },
        select: { id: true },
      }),
    ]);

    for (const [bookings, key, counter] of [
      [pickups, TemplateKey.PICKUP_REMINDER, 'pickup'],
      [returns, TemplateKey.RETURN_REMINDER, 'return'],
    ] as const) {
      for (const booking of bookings) {
        const alreadySent = await prisma.notification.findFirst({
          where: {
            templateKey: key,
            relatedType: 'Booking',
            relatedId: booking.id,
            status: { in: ['SENT', 'PENDING'] },
          },
          select: { id: true },
        });
        if (alreadySent) continue;

        const context = await bookingData(booking.id);
        if (!context) continue;

        await notificationsService.send({
          templateKey: key,
          recipientId: context.recipientId,
          data: context.data,
          related: context.related,
        });

        results[counter] += 1;
      }
    }

    logger.info('Reminder sweep finished', results);
    return results;
  },
};

/**
 * Fire a trigger without making the caller wait or care.
 *
 * Used as `fireAndForget(notify.bookingConfirmed(id))` from inside business
 * flows. The promise is detached and its rejection swallowed with a log line,
 * because the event it describes has already happened and cannot be undone by
 * a mail server being down.
 */
export function fireAndForget(promise: Promise<unknown>): void {
  void promise.catch((error: unknown) => {
    logger.error('Notification trigger failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  });
}
