/**
 * modules/rentals/extensionService.ts
 * ---------------------------------------------------------------------------
 * Rental extensions (BRD 23).
 *
 * BRD 23 sets out four steps, and this module does them in that order:
 *   1. check the vehicle is free for the extra period
 *   2. price the additional days
 *   3. request payment if applicable
 *   4. update the booking once approved and paid
 *
 * Step 1 is the one that matters. A car whose next customer collects on Friday
 * cannot be extended into Saturday, and the check has to exclude the booking
 * being extended - otherwise a rental always conflicts with itself.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { ApiError } from '../../utils/ApiError';
import { auditService } from '../audit/service';
import { availabilityService } from '../availability/service';
import { pricingService } from '../pricing/service';
import type { RentalActor } from './service';
import { isBackOffice } from '../../modules/auth/roles';

export const extensionsService = {
  /**
   * Ask to keep the vehicle longer.
   *
   * The availability check runs BEFORE anything is written, so a customer is
   * told immediately that the car is spoken for rather than waiting on a
   * request that was never going to be approved.
   */
  async request(bookingId: string, requestedReturnAt: Date, actor: RentalActor) {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { vehicle: true },
    });
    if (!booking) throw ApiError.notFound('Booking not found');

    const backOffice = isBackOffice(actor.role);
    if (!backOffice && booking.customerId !== actor.id) {
      throw ApiError.notFound('Booking not found');
    }

    if (booking.status !== 'ACTIVE') {
      throw ApiError.conflict(
        'Only an active rental can be extended. Change the dates on the booking instead.',
      );
    }

    if (requestedReturnAt <= booking.returnAt) {
      throw ApiError.badRequest('The new return time must be later than the current one');
    }

    const existing = await prisma.bookingExtension.findFirst({
      where: { bookingId, status: 'REQUESTED' },
    });
    if (existing) {
      throw ApiError.conflict('An extension request is already awaiting review');
    }

    // Step 1: is the car free for the EXTRA period? Only the new stretch is
    // checked, and the booking itself is excluded so it cannot block itself.
    await availabilityService.assertVehicleAvailable(
      booking.vehicleId,
      { pickupAt: booking.returnAt, returnAt: requestedReturnAt },
      { excludeBookingId: bookingId },
    );

    // Step 2: price the extra days through the same engine as the original
    // booking, so an extension is never priced by a different rule.
    const quote = await pricingService.quote({
      vehicleId: booking.vehicleId,
      pickupAt: booking.returnAt,
      returnAt: requestedReturnAt,
    });

    const extension = await prisma.bookingExtension.create({
      data: {
        bookingId,
        originalReturnAt: booking.returnAt,
        requestedReturnAt,
        additionalDays: quote.period.rentalDays,
        /*
         * Stored as three figures, not one.
         *
         * `rentalTotal` is VAT-INCLUSIVE. Keeping only that meant approval had
         * nothing to add to the booking's tax line and no way to know how much
         * of the total was tax - so it added the whole VAT-inclusive figure to
         * the pre-VAT subtotal instead. The split is known here, at the moment
         * the quote is made, so it is kept here.
         */
        additionalAmount: new Prisma.Decimal(quote.totals.rentalTotal),
        additionalSubtotal: new Prisma.Decimal(quote.totals.taxableAmount),
        additionalTax: new Prisma.Decimal(quote.totals.taxAmount),
        currency: booking.currency,
        status: 'REQUESTED',
      },
    });

    await prisma.$transaction(async (tx) => {
      await tx.booking.update({ where: { id: bookingId }, data: { status: 'EXTENSION_REQUESTED' } });
      await tx.bookingStatusHistory.create({
        data: {
          bookingId,
          fromStatus: 'ACTIVE',
          toStatus: 'EXTENSION_REQUESTED',
          changedById: actor.id,
          reason: `Extension requested to ${requestedReturnAt.toISOString()}`,
        },
      });
    });

    await auditService.record({
      action: 'extension.requested',
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      entityType: 'BookingExtension',
      entityId: extension.id,
      metadata: {
        bookingNumber: booking.bookingNumber,
        additionalDays: quote.period.rentalDays,
        additionalAmount: quote.totals.rentalTotal,
      },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return extensionsService.toPublic(extension.id);
  },

  /**
   * Approve or reject a request (staff).
   *
   * Availability is re-checked on approval. Between the request and the
   * decision the car may have been booked by someone else, and approving an
   * extension into a booking that now exists would create the exact conflict
   * this system is built to prevent.
   */
  async review(
    extensionId: string,
    decision: { approve: boolean; rejectionReason?: string },
    actor: RentalActor,
  ) {
    const extension = await prisma.bookingExtension.findUnique({
      where: { id: extensionId },
      include: { booking: true },
    });
    if (!extension) throw ApiError.notFound('Extension request not found');

    if (extension.status !== 'REQUESTED') {
      throw ApiError.conflict(`This request has already been ${extension.status.toLowerCase()}`);
    }

    if (!decision.approve) {
      if (!decision.rejectionReason?.trim()) {
        throw ApiError.badRequest('Give a reason so the customer knows why');
      }

      await prisma.$transaction(async (tx) => {
        await tx.bookingExtension.update({
          where: { id: extensionId },
          data: {
            status: 'REJECTED',
            rejectionReason: decision.rejectionReason!.trim(),
            reviewedById: actor.id,
            reviewedAt: new Date(),
          },
        });

        // Back to ACTIVE: the rental carries on to its original return time.
        await tx.booking.update({ where: { id: extension.bookingId }, data: { status: 'ACTIVE' } });
        await tx.bookingStatusHistory.create({
          data: {
            bookingId: extension.bookingId,
            fromStatus: 'EXTENSION_REQUESTED',
            toStatus: 'ACTIVE',
            changedById: actor.id,
            reason: `Extension rejected: ${decision.rejectionReason!.trim()}`,
          },
        });
      });

      await auditService.record({
        action: 'extension.rejected',
        actorId: actor.id,
        actorEmail: actor.email,
        actorRole: actor.role,
        entityType: 'BookingExtension',
        entityId: extensionId,
        metadata: {
          bookingNumber: extension.booking.bookingNumber,
          reason: decision.rejectionReason,
        },
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });

      return extensionsService.toPublic(extensionId);
    }

    // Re-check. The world may have changed since the request was made.
    await availabilityService.assertVehicleAvailable(
      extension.booking.vehicleId,
      { pickupAt: extension.originalReturnAt, returnAt: extension.requestedReturnAt },
      { excludeBookingId: extension.bookingId },
    );

    await prisma.$transaction(async (tx) => {
      await tx.bookingExtension.update({
        where: { id: extensionId },
        data: { status: 'APPROVED', reviewedById: actor.id, reviewedAt: new Date() },
      });

      // The booking's return time MOVES. From here on, availability, late-fee
      // and mileage-allowance calculations all use the new date - which is
      // exactly right: the customer now has the car legitimately for longer.
      await tx.booking.update({
        where: { id: extension.bookingId },
        data: {
          status: 'ACTIVE',
          returnAt: extension.requestedReturnAt,
          rentalDays: extension.booking.rentalDays + extension.additionalDays,
          /*
           * Each part to its own column, so the invoice still reconciles.
           *
           * `vehicleSubtotal` is pre-VAT and `taxAmount` is the VAT line;
           * adding the VAT-inclusive total to the subtotal - which is what
           * this used to do - inflated the subtotal by the extension's VAT
           * and left the tax line untouched. Subtotal + VAT then no longer
           * equalled the total, and the VAT shown on a tax invoice was short.
           */
          totalAmount: extension.booking.totalAmount.add(extension.additionalAmount),
          vehicleSubtotal: extension.booking.vehicleSubtotal.add(extension.additionalSubtotal),
          taxAmount: extension.booking.taxAmount.add(extension.additionalTax),
        },
      });

      await tx.bookingStatusHistory.create({
        data: {
          bookingId: extension.bookingId,
          fromStatus: 'EXTENSION_REQUESTED',
          toStatus: 'ACTIVE',
          changedById: actor.id,
          reason: `Extension approved to ${extension.requestedReturnAt.toISOString()}`,
        },
      });
    });

    await auditService.record({
      action: 'extension.approved',
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      entityType: 'BookingExtension',
      entityId: extensionId,
      metadata: {
        bookingNumber: extension.booking.bookingNumber,
        newReturnAt: extension.requestedReturnAt.toISOString(),
        additionalAmount: extension.additionalAmount.toFixed(2),
      },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return extensionsService.toPublic(extensionId);
  },

  async listForBooking(bookingId: string) {
    const extensions = await prisma.bookingExtension.findMany({
      where: { bookingId },
      orderBy: { createdAt: 'desc' },
    });
    return extensions.map(toPublicExtension);
  },

  async toPublic(extensionId: string) {
    const extension = await prisma.bookingExtension.findUniqueOrThrow({
      where: { id: extensionId },
    });
    return toPublicExtension(extension);
  },
};

function toPublicExtension(extension: {
  id: string;
  bookingId: string;
  originalReturnAt: Date;
  requestedReturnAt: Date;
  status: string;
  additionalDays: number;
  additionalAmount: Prisma.Decimal;
  currency: string;
  rejectionReason: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: extension.id,
    bookingId: extension.bookingId,
    originalReturnAt: extension.originalReturnAt.toISOString(),
    requestedReturnAt: extension.requestedReturnAt.toISOString(),
    status: extension.status,
    additionalDays: extension.additionalDays,
    additionalAmount: extension.additionalAmount.toFixed(2),
    currency: extension.currency,
    rejectionReason: extension.rejectionReason,
    reviewedAt: extension.reviewedAt?.toISOString() ?? null,
    createdAt: extension.createdAt.toISOString(),
  };
}
