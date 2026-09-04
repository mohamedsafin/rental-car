/**
 * modules/availability/service.ts
 * ---------------------------------------------------------------------------
 * "Is this vehicle free for these dates?" - and the search built on top of it.
 *
 * This module and the pricing engine are the two places in the system where a
 * bug costs real money, so both are built as plain functions over data with no
 * HTTP knowledge, and both are tested exhaustively.
 *
 * Correctness here has THREE layers, and all three are needed:
 *
 *   1. This service - filters the search so customers only see bookable cars.
 *   2. A re-check inside the booking transaction (Phase 6) - catches anything
 *      that changed between browsing and clicking Book.
 *   3. A PostgreSQL exclusion constraint - the only layer that cannot lose a
 *      race, because the database evaluates it inside the INSERT itself.
 *
 * Layer 1 alone is a read-then-write, and two simultaneous requests can both
 * pass it. That is why layer 3 exists.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { ApiError, ErrorCode } from '../../utils/ApiError';
import { SettingKey, settingsService } from '../settings/service';
import {
  BLOCKING_STATUSES,
  UNBOOKABLE_VEHICLE_STATUSES,
  type AvailabilityResult,
  type RentalPeriod,
} from './types';

const HOUR_MS = 60 * 60 * 1000;

/**
 * Validate a requested rental window.
 *
 * Rejects the past, zero-length and inverted ranges before any query runs -
 * a negative duration would otherwise reach the pricing engine and price at
 * zero.
 */
export async function assertValidPeriod(period: RentalPeriod): Promise<void> {
  if (period.returnAt <= period.pickupAt) {
    throw ApiError.badRequest('Return date and time must be after pickup');
  }

  // A small grace window: a customer submitting a form for "in 5 minutes"
  // should not be rejected because their clock is a minute behind ours.
  const graceMs = 5 * 60 * 1000;
  if (period.pickupAt.getTime() < Date.now() - graceMs) {
    throw ApiError.badRequest('Pickup date and time cannot be in the past');
  }

  const durationHours = (period.returnAt.getTime() - period.pickupAt.getTime()) / HOUR_MS;

  // Both bounds are settings, not constants - BRD 51 leaves minimum and
  // maximum rental duration to the client. The fallbacks are structural
  // sanity limits, not commercial policy.
  const minHours = await settingsService.getNumberOr(SettingKey.MIN_RENTAL_HOURS, 1);
  const maxDays = await settingsService.getNumberOr(SettingKey.MAX_RENTAL_DAYS, 365);

  if (durationHours < minHours) {
    throw ApiError.badRequest(`The minimum rental period is ${minHours} hour(s)`);
  }
  if (durationHours > maxDays * 24) {
    throw ApiError.badRequest(`The maximum rental period is ${maxDays} day(s)`);
  }
}

/**
 * Build the Prisma filter that matches bookings blocking a given window.
 *
 * Exported because the booking module (Phase 6) must re-use the EXACT same
 * predicate inside its transaction. Two hand-written copies of an overlap
 * condition is how the search and the booking check drift apart.
 */
export function blockingBookingsWhere(
  period: RentalPeriod,
  bufferHours: number,
  now: Date = new Date(),
): Prisma.BookingWhereInput {
  // Widen the REQUESTED window by the buffer. Equivalent to widening every
  // existing booking, and it keeps the comparison to two columns.
  const bufferMs = bufferHours * HOUR_MS;
  const from = new Date(period.pickupAt.getTime() - bufferMs);
  const to = new Date(period.returnAt.getTime() + bufferMs);

  return {
    // THE OVERLAP RULE. Strict on both sides, so touching periods do not
    // conflict: `lt` not `lte`, `gt` not `gte`.
    pickupAt: { lt: to },
    returnAt: { gt: from },
    OR: [
      // Firm bookings always block.
      { status: { in: BLOCKING_STATUSES } },
      // An unpaid checkout blocks only while its hold is still alive.
      { status: 'PENDING', holdExpiresAt: { gt: now } },
    ],
  };
}

export const availabilityService = {
  /**
   * Check one vehicle against one window.
   *
   * @param includeConflictDetail  Staff and admins get the conflicting booking
   *   numbers, which is what makes the admin calendar useful. Customers get a
   *   plain yes/no: who else booked the car is none of their business.
   */
  async checkVehicle(
    vehicleId: string,
    period: RentalPeriod,
    options: { includeConflictDetail?: boolean; excludeBookingId?: string } = {},
  ): Promise<AvailabilityResult> {
    await assertValidPeriod(period);

    const vehicle = await prisma.vehicle.findFirst({
      where: { id: vehicleId, deletedAt: null },
      select: { id: true, status: true, isPublished: true },
    });

    if (!vehicle) throw ApiError.notFound('Vehicle not found');

    if (!vehicle.isPublished) {
      return { available: false, reason: 'This vehicle is not currently offered for rent' };
    }

    if ((UNBOOKABLE_VEHICLE_STATUSES as readonly string[]).includes(vehicle.status)) {
      return {
        available: false,
        reason:
          vehicle.status === 'UNDER_MAINTENANCE'
            ? 'This vehicle is under maintenance'
            : 'This vehicle is not currently available',
      };
    }

    const bufferHours = await settingsService.getNumberOr(SettingKey.TURNAROUND_BUFFER_HOURS, 0);

    const conflicts = await prisma.booking.findMany({
      where: {
        vehicleId,
        // Set when checking an EXTENSION: the booking being extended must not
        // be treated as conflicting with itself.
        ...(options.excludeBookingId ? { id: { not: options.excludeBookingId } } : {}),
        ...blockingBookingsWhere(period, bufferHours),
      },
      select: { id: true, bookingNumber: true, pickupAt: true, returnAt: true, status: true },
      orderBy: { pickupAt: 'asc' },
    });

    if (conflicts.length === 0) return { available: true };

    return {
      available: false,
      reason: 'This vehicle is already booked for part of the selected period',
      ...(options.includeConflictDetail
        ? {
            conflicts: conflicts.map((booking) => ({
              id: booking.id,
              bookingNumber: booking.bookingNumber,
              pickupAt: booking.pickupAt.toISOString(),
              returnAt: booking.returnAt.toISOString(),
              status: booking.status,
            })),
          }
        : {}),
    };
  },

  /** Throw if unavailable. Used by the booking module before it writes. */
  async assertVehicleAvailable(
    vehicleId: string,
    period: RentalPeriod,
    options: { excludeBookingId?: string } = {},
  ): Promise<void> {
    const result = await availabilityService.checkVehicle(vehicleId, period, options);
    if (!result.available) {
      throw new ApiError(
        409,
        result.reason ?? 'This vehicle is not available for the selected dates',
        ErrorCode.VEHICLE_UNAVAILABLE,
      );
    }
  },
};
