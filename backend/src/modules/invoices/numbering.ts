/**
 * modules/invoices/numbering.ts
 * ---------------------------------------------------------------------------
 * Invoice numbers.
 *
 * A reference needs to be unique, sequential and never reused. The obvious
 * implementation - `count() + 1` - is wrong twice over:
 *
 *   1. two documents issued in the same moment under READ COMMITTED both count
 *      the same rows and both claim the same number, and
 *   2. a count goes DOWN when a row is deleted, so the next caller reissues a
 *      number that is already in use and the unique index rejects it.
 *
 * Booking numbers used to be generated that way and were thought safe because
 * they are written inside a SERIALIZABLE transaction. That covers (1) but does
 * nothing about (2) - deleting any booking made the next one collide - so they
 * are issued from this counter too.
 *
 * So this uses a counter row and an atomic `increment`. PostgreSQL locks that
 * single row for the duration of the update, the second caller waits, and the
 * two get different numbers. The lock is held for microseconds. Nothing ever
 * counts rows, so deleting one cannot rewind the series.
 *
 * A real SEQUENCE would also work, but sequences are not transactional: a
 * rolled-back invoice would leave a hole in the series, and gaps in an invoice
 * series are exactly what an auditor asks about.
 */
import type { Prisma } from '@prisma/client';

export type SequenceKey = 'invoice' | 'credit_note' | 'booking' | 'agreement' | 'accident';

const PREFIX: Record<SequenceKey, string> = {
  invoice: 'INV',
  credit_note: 'CN',
  booking: 'BK',
  agreement: 'AGR',
  accident: 'ACC',
};

/**
 * Digits after the year. Bookings keep the shorter form customers already
 * read down the phone; tax documents keep the wider one.
 */
const WIDTH: Record<SequenceKey, number> = {
  invoice: 6,
  credit_note: 6,
  booking: 4,
  agreement: 6,
  accident: 4,
};

/**
 * Next number in this year's series, e.g. INV-2026-000042.
 *
 * MUST be called inside the same transaction that writes the invoice. If the
 * insert fails, the increment rolls back with it and the number goes to the
 * next caller instead of being lost.
 */
export async function nextDocumentNumber(
  tx: Prisma.TransactionClient,
  key: SequenceKey,
  now: Date = new Date(),
): Promise<string> {
  const year = now.getUTCFullYear();

  // 1. Make sure the counter exists. Starts at 0 so the first increment
  //    yields 1. `update: {}` makes this a no-op when it already exists.
  await tx.numberSequence.upsert({
    where: { key },
    create: { key, year, lastValue: 0 },
    update: {},
  });

  // 2. Roll the year over if needed. Written as a conditional updateMany
  //    rather than read-then-write: two invoices issued either side of
  //    midnight on 1 January would otherwise both read the old year, both
  //    reset, and both claim 000001. Here the second one matches no rows.
  await tx.numberSequence.updateMany({
    where: { key, year: { not: year } },
    data: { year, lastValue: 0 },
  });

  // 3. Claim a number. Atomic, and returns the value this caller got.
  const updated = await tx.numberSequence.update({
    where: { key },
    data: { lastValue: { increment: 1 } },
  });

  return `${PREFIX[key]}-${year}-${String(updated.lastValue).padStart(WIDTH[key], '0')}`;
}
