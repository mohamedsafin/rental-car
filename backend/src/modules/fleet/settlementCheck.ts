/**
 * modules/fleet/settlementCheck.ts
 * ---------------------------------------------------------------------------
 * "Before you hand this customer their deposit back - is anything outstanding,
 * and is anything still in the post?"
 *
 * ===========================================================================
 * THE PROBLEM THIS EXISTS FOR
 * ===========================================================================
 * Salik arrives as a MONTHLY statement. A customer who takes a car on the 10th
 * and brings it back on the 14th has generated crossings that nobody will see
 * until the month ends - by which time they have paid, been refunded their
 * deposit, and gone home. The money is then uncollectable in practice, because
 * chasing AED 24 from someone who has left the country is not a business.
 *
 * Monthly customers are fine: their charges ride on next month's invoice. It
 * is the SHORT rental that leaks, and it leaks at exactly one moment - the
 * counter, while the customer is still standing there.
 *
 * ===========================================================================
 * WHAT IT REPORTS, AND WHAT IT REFUSES TO INVENT
 * ===========================================================================
 * Two different things, kept apart on purpose:
 *
 *   KNOWN     - fines and tolls already recorded against this rental and not
 *               yet recovered. Real money, exact figures, recoverable now.
 *
 *   NOT YET   - the stretch of the rental that no statement has covered. This
 *     KNOWN     is a GAP IN THE DATA, not an amount owed, and it is reported
 *               as days rather than dirhams.
 *
 * Where there IS evidence - crossings already recorded during this rental -
 * the uncovered days are costed at THIS rental's own observed daily rate. It
 * is an estimate drawn from the customer's own driving, offered as a suggested
 * hold, and it is never applied automatically. With no crossings recorded
 * there is no rate, so no figure is offered at all: a made-up number on a
 * counter screen gets charged to somebody.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { ApiError } from '../../utils/ApiError';

const ZERO = new Prisma.Decimal(0);
/** Recorded, and still owed by somebody. */
const OUTSTANDING = ['RECORDED', 'ASSIGNED'] as const;
const DAY_MS = 86_400_000;

export interface OutstandingItem {
  id: string;
  kind: 'fine' | 'toll';
  /** What it was: the gate crossed, or the violation. */
  what: string;
  at: string;
  amount: string;
  serviceFee: string;
  total: string;
  status: string;
}

export interface SettlementCheck {
  bookingId: string;
  bookingNumber: string;
  currency: string;
  billingCycle: 'UPFRONT' | 'MONTHLY';
  /**
   * The rental is over and takes no further charges.
   *
   * Anything still outstanding on a closed booking is the company's now. It is
   * still listed - staff should be able to see what was missed - but nothing
   * can be recovered from it, so the page must not offer to.
   */
  closed: boolean;

  /** Already recorded, not yet recovered. Exact. */
  outstanding: OutstandingItem[];
  outstandingTotal: string;

  /**
   * Crossings on this car, inside this rental's dates, that are not attached
   * to any booking. Usually an import that could not match - offered so staff
   * can attach them rather than leave the company paying.
   */
  unattached: OutstandingItem[];
  unattachedTotal: string;

  /**
   * How far the toll data actually reaches for this car. Null when nothing has
   * ever been recorded against it.
   */
  tollsKnownUntil: string | null;
  /** Days of this rental no statement has covered yet. */
  uncoveredDays: number;
  /**
   * What those days might cost, at this rental's own observed rate. Null when
   * there is no evidence to base it on - deliberately, rather than a guess.
   */
  suggestedHold: string | null;
  /** How the suggestion was reached, in plain words, for the staff member. */
  suggestionBasis: string | null;

  depositBalance: string | null;
}

const money = (value: Prisma.Decimal): string => value.toFixed(2);

export const settlementCheck = {
  async forBooking(bookingId: string): Promise<SettlementCheck> {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        bookingNumber: true,
        currency: true,
        billingCycle: true,
        status: true,
        vehicleId: true,
        pickupAt: true,
        returnAt: true,
        rental: { select: { returnedAt: true } },
      },
    });
    if (!booking) throw ApiError.notFound('Booking not found');

    const [fines, tolls] = await Promise.all([
      prisma.trafficFine.findMany({
        where: { bookingId, status: { in: [...OUTSTANDING] } },
        orderBy: { violationAt: 'asc' },
      }),
      prisma.tollCharge.findMany({
        where: { bookingId, status: { in: [...OUTSTANDING] } },
        orderBy: { crossedAt: 'asc' },
      }),
    ]);

    const outstanding: OutstandingItem[] = [
      ...fines.map((fine) => ({
        id: fine.id,
        kind: 'fine' as const,
        what: fine.violation ?? `Fine ${fine.fineNumber}`,
        at: fine.violationAt.toISOString(),
        amount: money(fine.amount),
        serviceFee: money(fine.serviceFee),
        total: money(fine.amount.add(fine.serviceFee)),
        status: fine.status,
      })),
      ...tolls.map((toll) => ({
        id: toll.id,
        kind: 'toll' as const,
        what: toll.gate ? `Salik - ${toll.gate}` : 'Salik crossing',
        at: toll.crossedAt.toISOString(),
        amount: money(toll.amount),
        serviceFee: money(toll.serviceFee),
        total: money(toll.amount.add(toll.serviceFee)),
        status: toll.status,
      })),
    ].sort((left, right) => left.at.localeCompare(right.at));

    const outstandingTotal = outstanding.reduce(
      (sum, item) => sum.add(new Prisma.Decimal(item.total)),
      ZERO,
    );

    /*
     * The rental's real end. A car brought back early stops generating
     * crossings when it is handed over, not when the contract said it would
     * be - using the contract date would invent uncovered days that cannot
     * contain anything.
     */
    const endedAt = booking.rental?.returnedAt ?? booking.returnAt;

    // Crossings the import could not place. Bounded by the rental window, so
    // this only ever offers rows this customer could actually be responsible
    // for.
    const loose = await prisma.tollCharge.findMany({
      where: {
        vehicleId: booking.vehicleId,
        bookingId: null,
        crossedAt: { gte: booking.pickupAt, lte: endedAt },
        status: { in: [...OUTSTANDING] },
      },
      orderBy: { crossedAt: 'asc' },
    });

    const unattached: OutstandingItem[] = loose.map((toll) => ({
      id: toll.id,
      kind: 'toll' as const,
      what: toll.gate ? `Salik - ${toll.gate}` : 'Salik crossing',
      at: toll.crossedAt.toISOString(),
      amount: money(toll.amount),
      serviceFee: money(toll.serviceFee),
      total: money(toll.amount.add(toll.serviceFee)),
      status: toll.status,
    }));

    const unattachedTotal = unattached.reduce(
      (sum, item) => sum.add(new Prisma.Decimal(item.total)),
      ZERO,
    );

    /*
     * How far the data reaches.
     *
     * The latest crossing recorded for THIS CAR, from any rental: a statement
     * covers the vehicle, not the booking, so if last month's import ran then
     * every rental on that car is covered to the same date.
     */
    const latest = await prisma.tollCharge.findFirst({
      where: { vehicleId: booking.vehicleId },
      orderBy: { crossedAt: 'desc' },
      select: { crossedAt: true },
    });

    const knownUntil = latest?.crossedAt ?? null;
    const uncoveredFrom =
      knownUntil && knownUntil > booking.pickupAt ? knownUntil : booking.pickupAt;
    const uncoveredMs = endedAt.getTime() - uncoveredFrom.getTime();
    // Rounded up: a half-day gap is still a day somebody drove through a gate.
    const uncoveredDays = uncoveredMs > 0 ? Math.ceil(uncoveredMs / DAY_MS) : 0;

    /*
     * Cost the gap at what this customer has actually been costing.
     *
     * Every crossing recorded during this rental, divided by the days it
     * covers. A commuter crossing eight gates a day and a tourist who crossed
     * one all week get very different suggestions, which is the point.
     */
    let suggestedHold: string | null = null;
    let suggestionBasis: string | null = null;

    if (uncoveredDays > 0 && booking.billingCycle !== 'MONTHLY') {
      const duringRental = await prisma.tollCharge.findMany({
        where: {
          vehicleId: booking.vehicleId,
          crossedAt: { gte: booking.pickupAt, lte: endedAt },
        },
        select: { amount: true, serviceFee: true, crossedAt: true },
      });

      if (duringRental.length > 0) {
        const observedTotal = duringRental.reduce(
          (sum, row) => sum.add(row.amount).add(row.serviceFee),
          ZERO,
        );
        const coveredMs = Math.max(uncoveredFrom.getTime() - booking.pickupAt.getTime(), DAY_MS);
        const coveredDays = Math.max(Math.round(coveredMs / DAY_MS), 1);
        const perDay = observedTotal.div(coveredDays);

        suggestedHold = money(perDay.mul(uncoveredDays));
        suggestionBasis =
          `${duringRental.length} crossing(s) totalling ${money(observedTotal)} over ` +
          `${coveredDays} day(s) works out at ${money(perDay)} a day, and ${uncoveredDays} ` +
          `day(s) of this rental are not covered by a statement yet.`;
      } else {
        suggestionBasis =
          `No Salik has been recorded for this car during the rental, so there is nothing ` +
          `to estimate from. ${uncoveredDays} day(s) are not covered by a statement yet - ` +
          `check the Salik portal before releasing the deposit.`;
      }
    }

    const { depositsService } = await import('../deposits/service');
    const deposit = await depositsService.getByBookingId(bookingId);

    return {
      bookingId: booking.id,
      bookingNumber: booking.bookingNumber,
      currency: booking.currency,
      billingCycle: booking.billingCycle,
      closed: booking.status === 'COMPLETED' || booking.status === 'CANCELLED',
      outstanding,
      outstandingTotal: money(outstandingTotal),
      unattached,
      unattachedTotal: money(unattachedTotal),
      tollsKnownUntil: knownUntil?.toISOString() ?? null,
      uncoveredDays,
      suggestedHold,
      suggestionBasis,
      depositBalance: deposit?.balance ?? null,
    };
  },
};
