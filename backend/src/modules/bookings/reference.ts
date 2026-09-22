/**
 * modules/bookings/reference.ts
 * ---------------------------------------------------------------------------
 * Generates the human-facing booking reference, e.g. "BK-2026-0042".
 *
 * Separate from the UUID primary key on purpose. A customer reads this over
 * the phone and a member of staff types it into a search box; "please quote
 * 0f0f0392-ee8e-43f0-ad97-1d3aaccab1fb" is not a support process.
 *
 * This used to be `COUNT(*) + 1` over the year's bookings, which was wrong in
 * a way that only showed up once a booking was ever deleted: the count went
 * back down, and the next booking was handed a reference another row already
 * held. The unique index then rejected it, so the customer saw "a record with
 * this bookingNumber already exists" and no booking at all.
 *
 * It now claims from the same atomic counter the invoice series uses, which
 * never counts rows and therefore cannot rewind. See `invoices/numbering.ts`
 * for why the counter is shaped the way it is.
 */
import type { Prisma } from '@prisma/client';
import { nextDocumentNumber } from '../invoices/numbering';

export async function generateBookingNumber(
  tx: Prisma.TransactionClient,
  now: Date = new Date(),
): Promise<string> {
  return nextDocumentNumber(tx, 'booking', now);
}
