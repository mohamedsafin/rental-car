/**
 * modules/bookings/reference.ts
 * ---------------------------------------------------------------------------
 * Generates the human-facing booking reference, e.g. "BK-2026-0042".
 *
 * Separate from the UUID primary key on purpose. A customer reads this over
 * the phone and a member of staff types it into a search box; "please quote
 * 0f0f0392-ee8e-43f0-ad97-1d3aaccab1fb" is not a support process.
 *
 * The sequence is per-year and derived from a COUNT inside the booking
 * transaction, so two bookings created at the same instant cannot collide -
 * and if they somehow did, the unique index on bookingNumber would reject the
 * second rather than silently issue a duplicate reference.
 */
import type { Prisma } from '@prisma/client';

export async function generateBookingNumber(
  tx: Prisma.TransactionClient,
  now: Date = new Date(),
): Promise<string> {
  const year = now.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEnd = new Date(Date.UTC(year + 1, 0, 1));

  const countThisYear = await tx.booking.count({
    where: { createdAt: { gte: yearStart, lt: yearEnd } },
  });

  return `BK-${year}-${String(countThisYear + 1).padStart(4, '0')}`;
}
