/**
 * modules/bookings/instalments.ts
 * ---------------------------------------------------------------------------
 * The monthly payment schedule for a long-term rental (BRD 16).
 *
 * ===========================================================================
 * WHY THIS EXISTS
 * ===========================================================================
 * The system was built around short rentals: one price, paid once, before the
 * keys. That is wrong for a fleet let by the month - a six-month rental at
 * AED 3,000 would ask for AED 18,000 before the customer has driven anywhere,
 * and nobody agrees to that. Long-term customers pay month by month.
 *
 * ===========================================================================
 * WHAT IS PLANNED UP FRONT, AND WHY
 * ===========================================================================
 * The WHOLE schedule is generated when the booking is made, not one month at
 * a time. The customer sees every date and every amount before committing,
 * and each row is a SNAPSHOT: a rate rise in month three does not reach back
 * into a month already agreed. That is the same rule the rest of the booking
 * follows for its own prices.
 *
 * Month boundaries are calendar months from the pickup date, not 30-day
 * blocks. A rental starting on the 15th bills on the 15th - which is what a
 * customer expects and what a contract says.
 */
import { Prisma } from '@prisma/client';

export interface InstalmentPlanRow {
  sequence: number;
  periodStart: Date;
  periodEnd: Date;
  dueAt: Date;
  amount: Prisma.Decimal;
  subtotal: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
}

/**
 * Add whole calendar months, clamping to the end of a short month.
 *
 * 31 January + 1 month is 28 February, not 3 March. Letting JavaScript roll
 * over would drift a long rental's billing date forward every short month.
 */
export function addMonths(from: Date, months: number): Date {
  const result = new Date(from.getTime());
  const targetMonth = result.getUTCMonth() + months;
  const dayOfMonth = result.getUTCDate();

  result.setUTCDate(1);
  result.setUTCMonth(targetMonth);

  const lastDayOfTargetMonth = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();

  result.setUTCDate(Math.min(dayOfMonth, lastDayOfTargetMonth));
  return result;
}

/** Whole calendar months between two dates, rounded UP to cover the period. */
export function monthsBetween(from: Date, to: Date): number {
  let months = 0;
  while (addMonths(from, months + 1) <= to) months += 1;
  // A remainder of even one day is another month billed: a 45-day rental is
  // two months, because the car is off the fleet for a second month either way.
  return addMonths(from, months) < to ? months + 1 : Math.max(months, 1);
}

/**
 * Split a term into equal monthly payments.
 *
 * @param total     VAT-inclusive total for the whole term.
 * @param subtotal  The same term before VAT.
 * @param tax       The VAT on it.
 *
 * Rounding is settled on the FIRST instalment rather than spread, so every
 * later month is the identical round figure a customer can set up a standing
 * transfer for. The three columns are divided independently and reconciled, so
 * the months still sum to exactly the agreed total rather than a cent off.
 */
export function buildInstalmentPlan(input: {
  pickupAt: Date;
  returnAt: Date;
  months: number;
  total: Prisma.Decimal;
  subtotal: Prisma.Decimal;
  tax: Prisma.Decimal;
}): InstalmentPlanRow[] {
  const months = Math.max(1, Math.floor(input.months));

  const share = (whole: Prisma.Decimal): { each: Prisma.Decimal; first: Prisma.Decimal } => {
    const each = whole.div(months).toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN);
    const first = whole.sub(each.mul(months - 1));
    return { each, first };
  };

  const amount = share(input.total);
  const subtotal = share(input.subtotal);
  const tax = share(input.tax);

  const rows: InstalmentPlanRow[] = [];

  for (let index = 0; index < months; index += 1) {
    const periodStart = addMonths(input.pickupAt, index);
    // The last month runs to the agreed return, which may be short of a full
    // month - the customer still pays for it, but the dates must not claim the
    // car is theirs for longer than the booking says.
    const naturalEnd = addMonths(input.pickupAt, index + 1);
    const periodEnd =
      index === months - 1 && input.returnAt < naturalEnd ? input.returnAt : naturalEnd;

    rows.push({
      sequence: index + 1,
      periodStart,
      periodEnd,
      /*
       * Each month is due when it STARTS - rent in advance, as a rental
       * contract works. The first is therefore due immediately, which is what
       * makes "pay the first month and collect the car" the natural flow.
       */
      dueAt: periodStart,
      amount: index === 0 ? amount.first : amount.each,
      subtotal: index === 0 ? subtotal.first : subtotal.each,
      taxAmount: index === 0 ? tax.first : tax.each,
    });
  }

  return rows;
}
