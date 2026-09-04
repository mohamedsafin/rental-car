/**
 * modules/reports/service.ts
 * ---------------------------------------------------------------------------
 * Management reporting (BRD 48-50).
 *
 * The rule that shapes every query here: REVENUE IS WHAT WAS PAID.
 *
 * It would be easier to sum `bookings.totalAmount`, and it would be wrong.
 * A booking is an agreement; a payment is money. Bookings include ones that
 * were never paid for, ones that lapsed on hold, and ones that were cancelled
 * after confirmation. Summing them produces a revenue figure that does not
 * reconcile with the bank, which makes the whole report untrustworthy - and an
 * untrustworthy report is worse than no report, because someone will make a
 * decision with it.
 *
 * So revenue comes from COMPLETED payments, minus COMPLETED refunds, and
 * deposits are excluded throughout: a security deposit is held, not earned.
 * The phase acceptance test asserts exactly this reconciliation.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { ApiError } from '../../utils/ApiError';

const ZERO = new Prisma.Decimal(0);

export interface DateRange {
  from: Date;
  to: Date;
}

function assertRange(range: DateRange): void {
  if (range.to <= range.from) throw ApiError.badRequest('The end date must be after the start date');
}

export const reportsService = {
  /**
   * Money in, over a period (BRD 48).
   *
   * `paymentType` matters: SECURITY_DEPOSIT payments are money we are holding
   * for the customer, not income, so they are reported separately and never
   * added into revenue.
   */
  async revenue(range: DateRange) {
    assertRange(range);

    const window = { gte: range.from, lt: range.to };

    // Money that actually arrived. REFUNDED and PARTIALLY_REFUNDED belong here
    // alongside SUCCESS: those payments WERE received, and the refund is
    // subtracted separately below. Counting only SUCCESS would drop the
    // original payment out of gross AND subtract the refund - taking the money
    // off the books twice.
    const received: Prisma.EnumPaymentStatusFilter = {
      in: ['SUCCESS', 'REFUNDED', 'PARTIALLY_REFUNDED'],
    };

    const [earned, deposits, refunds, byProvider] = await Promise.all([
      prisma.payment.aggregate({
        where: { status: received, paidAt: window, type: { not: 'SECURITY_DEPOSIT' } },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.payment.aggregate({
        where: { status: received, paidAt: window, type: 'SECURITY_DEPOSIT' },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.refund.aggregate({
        where: { status: 'COMPLETED', completedAt: window },
        _sum: { amount: true },
        _count: true,
      }),
      // Grouped by PROVIDER, not by card scheme. We never see a card scheme -
      // no card data touches this system (BRD 21) - so the gateway that
      // handled the money is the only breakdown we can honestly report.
      prisma.payment.groupBy({
        by: ['provider'],
        where: { status: received, paidAt: window, type: { not: 'SECURITY_DEPOSIT' } },
        _sum: { amount: true },
        _count: true,
      }),
    ]);

    const gross = earned._sum?.amount ?? ZERO;
    const refunded = refunds._sum?.amount ?? ZERO;

    return {
      period: { from: range.from.toISOString(), to: range.to.toISOString() },
      grossRevenue: gross.toFixed(2),
      refunds: refunded.toFixed(2),
      netRevenue: gross.sub(refunded).toFixed(2),
      paymentCount: earned._count,
      refundCount: refunds._count,
      /// Held, not earned. Reported so the bank balance makes sense, and
      /// deliberately outside every revenue figure above.
      depositsHeld: (deposits._sum?.amount ?? ZERO).toFixed(2),
      depositPaymentCount: deposits._count,
      byProvider: byProvider
        .map((row) => ({
          provider: row.provider,
          amount: (row._sum?.amount ?? ZERO).toFixed(2),
          count: row._count,
        }))
        .sort((a, b) => Number(b.amount) - Number(a.amount)),
    };
  },

  /**
   * Booking counts and their outcomes (BRD 49).
   *
   * Grouped on `createdAt`, not `pickupAt`: this answers "how much did we sell
   * in March", which is a different question from "how many cars went out in
   * March" and is the one a monthly report is usually asked.
   */
  async bookings(range: DateRange) {
    assertRange(range);

    const window = { gte: range.from, lt: range.to };

    const [byStatus, totals, cancelled] = await Promise.all([
      prisma.booking.groupBy({
        by: ['status'],
        where: { createdAt: window },
        _count: true,
        _sum: { totalAmount: true },
      }),
      prisma.booking.aggregate({
        where: { createdAt: window },
        _count: true,
        _sum: { totalAmount: true, discountAmount: true },
        _avg: { rentalDays: true },
      }),
      prisma.booking.aggregate({
        where: { createdAt: window, status: 'CANCELLED' },
        _count: true,
        _sum: { cancellationFee: true },
      }),
    ]);

    const total = totals._count;

    return {
      period: { from: range.from.toISOString(), to: range.to.toISOString() },
      totalBookings: total,
      /// Agreed value, NOT revenue - much of it may never be paid. Named so
      /// nobody mistakes the two.
      bookedValue: (totals._sum?.totalAmount ?? ZERO).toFixed(2),
      discountsGiven: (totals._sum?.discountAmount ?? ZERO).toFixed(2),
      averageRentalDays: totals._avg?.rentalDays ? Number(totals._avg.rentalDays.toFixed(1)) : 0,
      cancellations: cancelled._count,
      cancellationRate: total > 0 ? Number(((cancelled._count / total) * 100).toFixed(1)) : 0,
      cancellationFees: (cancelled._sum?.cancellationFee ?? ZERO).toFixed(2),
      byStatus: byStatus
        .map((row) => ({
          status: row.status,
          count: row._count,
          value: (row._sum?.totalAmount ?? ZERO).toFixed(2),
        }))
        .sort((a, b) => b.count - a.count),
    };
  },

  /**
   * How hard each car is working (BRD 50).
   *
   * Utilisation is rented days over available days in the window. Days a
   * vehicle spent in the workshop are subtracted from the denominator, not
   * counted as idle - a car cannot be blamed for not earning while it is up on
   * a ramp, and leaving maintenance in the denominator would make a
   * well-maintained fleet look badly managed.
   */
  async fleetUtilisation(range: DateRange) {
    assertRange(range);

    const windowDays = Math.max(
      1,
      Math.round((range.to.getTime() - range.from.getTime()) / 86_400_000),
    );

    const vehicles = await prisma.vehicle.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        brand: true,
        model: true,
        registrationNumber: true,
        category: { select: { name: true } },
        bookings: {
          where: {
            status: { in: ['CONFIRMED', 'READY_FOR_PICKUP', 'ACTIVE', 'RETURN_PENDING', 'RETURNED', 'COMPLETED'] },
            pickupAt: { lt: range.to },
            returnAt: { gt: range.from },
          },
          select: { pickupAt: true, returnAt: true, totalAmount: true },
        },
        maintenanceRecords: {
          where: {
            status: { in: ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED'] },
            startsAt: { lt: range.to },
            endsAt: { gt: range.from },
          },
          select: { startsAt: true, endsAt: true },
        },
      },
    });

    const rows = vehicles.map((vehicle) => {
      const rentedDays = vehicle.bookings.reduce(
        (days, booking) => days + overlapDays(booking.pickupAt, booking.returnAt, range),
        0,
      );
      const maintenanceDays = vehicle.maintenanceRecords.reduce(
        (days, record) => days + overlapDays(record.startsAt, record.endsAt, range),
        0,
      );

      const availableDays = Math.max(0, windowDays - maintenanceDays);
      const revenue = vehicle.bookings.reduce((total, booking) => total.add(booking.totalAmount), ZERO);

      return {
        vehicleId: vehicle.id,
        vehicle: `${vehicle.brand} ${vehicle.model}`,
        registrationNumber: vehicle.registrationNumber,
        category: vehicle.category.name,
        bookings: vehicle.bookings.length,
        rentedDays: Number(rentedDays.toFixed(1)),
        maintenanceDays: Number(maintenanceDays.toFixed(1)),
        availableDays,
        utilisation:
          availableDays > 0 ? Number(((rentedDays / availableDays) * 100).toFixed(1)) : 0,
        /// Booked value again, not cash. Useful for ranking vehicles against
        /// each other; not a revenue figure.
        bookedValue: revenue.toFixed(2),
      };
    });

    rows.sort((a, b) => b.utilisation - a.utilisation);

    const fleetRented = rows.reduce((total, row) => total + row.rentedDays, 0);
    const fleetAvailable = rows.reduce((total, row) => total + row.availableDays, 0);

    return {
      period: { from: range.from.toISOString(), to: range.to.toISOString() },
      windowDays,
      fleetSize: rows.length,
      fleetUtilisation:
        fleetAvailable > 0 ? Number(((fleetRented / fleetAvailable) * 100).toFixed(1)) : 0,
      vehicles: rows,
    };
  },

  /**
   * What is owed to us, and what we are holding (BRD 49).
   *
   * A snapshot at "now", not over a period - "how much is outstanding" has no
   * date range.
   */
  async outstanding() {
    const [unpaidCharges, heldDeposits, unpaidBookings] = await Promise.all([
      prisma.additionalCharge.groupBy({
        by: ['type'],
        where: { status: { in: ['PENDING', 'INVOICED'] } },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.securityDeposit.aggregate({
        where: { status: { in: ['HELD', 'PARTIALLY_RELEASED'] } },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.booking.aggregate({
        where: { status: 'PAYMENT_PENDING' },
        _sum: { totalAmount: true },
        _count: true,
      }),
    ]);

    const chargeTotal = unpaidCharges.reduce(
      (total, row) => total.add(row._sum?.amount ?? ZERO),
      ZERO,
    );

    return {
      asOf: new Date().toISOString(),
      unrecoveredCharges: chargeTotal.toFixed(2),
      chargesByType: unpaidCharges.map((row) => ({
        type: row.type,
        amount: (row._sum?.amount ?? ZERO).toFixed(2),
        count: row._count,
      })),
      depositsHeld: (heldDeposits._sum?.amount ?? ZERO).toFixed(2),
      depositCount: heldDeposits._count,
      awaitingPayment: (unpaidBookings._sum?.totalAmount ?? ZERO).toFixed(2),
      awaitingPaymentCount: unpaidBookings._count,
    };
  },

  /** Everything the dashboard needs, in one round trip. */
  async dashboard() {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

    const [revenue, bookings, outstanding, activeRentals, fleetSize] = await Promise.all([
      this.revenue({ from: monthStart, to: nextMonth }),
      this.bookings({ from: monthStart, to: nextMonth }),
      this.outstanding(),
      prisma.booking.count({ where: { status: 'ACTIVE' } }),
      prisma.vehicle.count({ where: { deletedAt: null, isPublished: true } }),
    ]);

    return {
      month: { from: monthStart.toISOString(), to: nextMonth.toISOString() },
      revenue,
      bookings,
      outstanding,
      activeRentals,
      fleetSize,
    };
  },
};

/**
 * Days of a period that fall inside the window, as a fraction.
 *
 * Fractional rather than whole days on purpose: a 36-hour rental is 1.5 days
 * of utilisation, and rounding it to 1 or 2 across a whole fleet moves the
 * headline number by several percent.
 */
function overlapDays(start: Date, end: Date, range: DateRange): number {
  const from = Math.max(start.getTime(), range.from.getTime());
  const to = Math.min(end.getTime(), range.to.getTime());
  return to <= from ? 0 : (to - from) / 86_400_000;
}
