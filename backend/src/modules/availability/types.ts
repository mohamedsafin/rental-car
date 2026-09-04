/**
 * modules/availability/types.ts
 * ---------------------------------------------------------------------------
 * The overlap rule, stated once, in one place.
 *
 * ===========================================================================
 * THE RULE
 * ===========================================================================
 * Two rental periods overlap when:
 *
 *     existingStart < requestedEnd   AND   existingEnd > requestedStart
 *
 * Both comparisons are STRICT. That single choice decides the case BRD 34
 * asks us to settle:
 *
 *     Booking A: 10 Sep 10:00 -> 15 Sep 10:00
 *     Booking B: 12 Sep 10:00 -> 18 Sep 10:00   OVERLAP    -> rejected
 *
 *     Booking A: 10 Sep 10:00 -> 15 Sep 10:00
 *     Booking C: 15 Sep 10:00 -> 20 Sep 10:00   NO OVERLAP -> allowed
 *
 * In interval terms the rental window is HALF-OPEN: [pickupAt, returnAt).
 * The vehicle is held from the instant of pickup up to, but not including,
 * the instant of return. The return time is therefore an available pickup
 * time for the next customer.
 *
 * ===========================================================================
 * THE TURNAROUND BUFFER
 * ===========================================================================
 * Back-to-back handover assumes zero minutes to inspect, clean and refuel -
 * which is not how a real rental desk works. `rental.turnaround_buffer_hours`
 * (a system setting, default 0) widens each existing booking by that many
 * hours on both sides when checking.
 *
 * It is a SETTING, not a constant, because BRD 51 leaves operational policy to
 * the client. It is enforced in the service rather than the database
 * constraint because a value read at request time cannot live inside an
 * immutable index.
 */
import type { BookingStatus } from '@prisma/client';

/**
 * Statuses that hold a vehicle.
 *
 * PENDING is deliberately absent. A PENDING booking is an unpaid checkout in
 * progress: it holds the car only until `holdExpiresAt`, so that an abandoned
 * browser tab cannot take a vehicle off sale for a week. That time-dependent
 * rule is applied separately in the query.
 *
 * CANCELLED, RETURNED and COMPLETED never block - the car is back.
 */
export const BLOCKING_STATUSES: BookingStatus[] = [
  'PAYMENT_PENDING',
  'DOCUMENT_VERIFICATION',
  'CONFIRMED',
  'READY_FOR_PICKUP',
  'ACTIVE',
  'EXTENSION_REQUESTED',
  'RETURN_PENDING',
];

/**
 * Vehicle statuses that make a car unbookable regardless of its calendar.
 *
 * The test is simple: does this status describe the car's state RIGHT NOW, or
 * its state for the foreseeable future?
 *
 * NOT here, because they are momentary:
 *   RESERVED, RENTED       - out on hire today, bookable for next month
 *   UNDER_INSPECTION       - the post-return check takes hours, not weeks
 *
 * Treating any of those as a blocker would make the fleet look far emptier
 * than it is and turn away bookings the company could serve. UNDER_INSPECTION
 * originally WAS in this list, which meant every returned car silently
 * dropped out of search until someone closed the rental - a quiet loss of
 * revenue that only surfaced when a test tried to book a car that had just
 * come back.
 *
 * Still here:
 *   UNDER_MAINTENANCE - Phase 9 gives maintenance real date ranges, which is
 *                       the right way to express "off the road until the 20th"
 *   UNAVAILABLE       - withdrawn from the fleet
 */
export const UNBOOKABLE_VEHICLE_STATUSES = ['UNDER_MAINTENANCE', 'UNAVAILABLE'] as const;

export interface RentalPeriod {
  pickupAt: Date;
  returnAt: Date;
}

export interface ConflictingBooking {
  id: string;
  bookingNumber: string;
  pickupAt: string;
  returnAt: string;
  status: BookingStatus;
}

export interface AvailabilityResult {
  available: boolean;
  /** Present only for staff/admin callers - customers never see who booked. */
  conflicts?: ConflictingBooking[];
  reason?: string;
}

/**
 * Maintenance statuses that take a vehicle off the road for their window.
 *
 * CANCELLED and COMPLETED do not: a service that was called off, or one that
 * finished early, must not keep blocking the calendar.
 */
export const BLOCKING_MAINTENANCE_STATUSES = ['SCHEDULED', 'IN_PROGRESS'] as const;

/**
 * Do two periods overlap? Pure function, no I/O - which is what makes the
 * rule exhaustively unit-testable without a database.
 */
export function periodsOverlap(a: RentalPeriod, b: RentalPeriod): boolean {
  return a.pickupAt < b.returnAt && a.returnAt > b.pickupAt;
}
