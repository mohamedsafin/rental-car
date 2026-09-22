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

  /**
   * Revenue day by day, for a chart.
   * ==========================================================================
   * WHY A SERIES AND NOT JUST A TOTAL
   * ==========================================================================
   * "AED 84,000 in March" tells an owner nothing they can act on. The same
   * total can be a steady month, or three good weekends and nineteen dead
   * days - and those two months need completely different decisions about
   * pricing and fleet size. The shape is the information; the total is just
   * its sum.
   *
   * Days with no money are returned as zero rather than skipped, because a
   * chart that silently closes the gaps makes a dead week look like a busy one.
   */
  async revenueSeries(range: DateRange) {
    assertRange(range);

    const received: Prisma.EnumPaymentStatusFilter = {
      in: ['SUCCESS', 'REFUNDED', 'PARTIALLY_REFUNDED'],
    };

    const payments = await prisma.payment.findMany({
      where: {
        status: received,
        paidAt: { gte: range.from, lt: range.to },
        type: { not: 'SECURITY_DEPOSIT' },
      },
      select: { amount: true, paidAt: true },
    });

    const byDay = new Map<string, Prisma.Decimal>();
    for (const payment of payments) {
      if (!payment.paidAt) continue;
      const key = payment.paidAt.toISOString().slice(0, 10);
      byDay.set(key, (byDay.get(key) ?? ZERO).add(payment.amount));
    }

    const days: { date: string; amount: string }[] = [];
    for (
      let cursor = new Date(range.from);
      cursor < range.to;
      cursor.setUTCDate(cursor.getUTCDate() + 1)
    ) {
      const key = cursor.toISOString().slice(0, 10);
      days.push({ date: key, amount: (byDay.get(key) ?? ZERO).toFixed(2) });
    }

    return { period: { from: range.from.toISOString(), to: range.to.toISOString() }, days };
  },

  /**
   * Which cars earn, and which cost.
   * ==========================================================================
   * THE QUESTION NOBODY COULD ANSWER
   * ==========================================================================
   * Revenue per car was derivable; cost per car was recorded nowhere, so
   * "which of my cars makes money" had no answer and fleet decisions were made
   * on the feeling that the big ones rent more.
   *
   * Now both sides are here: what each car brought in over the period, what it
   * cost over the same period (services, tyres, insurance, accident repairs),
   * and how many days it was actually out. `net` is the number worth sorting
   * by; `utilisation` is the one that explains it.
   *
   * COSTS ARE NOT APPORTIONED. An annual insurance premium entered once lands
   * whole in whichever month it was paid, and this report says so rather than
   * spreading it silently - a figure the owner can reconcile against a bank
   * statement beats a smoother one they cannot.
   */
  async vehicleProfitability(range: DateRange) {
    assertRange(range);

    const window = { gte: range.from, lt: range.to };
    const days = Math.max(1, Math.round((range.to.getTime() - range.from.getTime()) / 86_400_000));

    const vehicles = await prisma.vehicle.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        brand: true,
        model: true,
        year: true,
        registrationNumber: true,
        purchasePrice: true,
        currentValue: true,
        category: { select: { name: true } },
      },
    });

    /*
     * Revenue is counted from BOOKINGS in the window, not from payments,
     * because a payment row knows what was paid but not which car it was for
     * without walking back through the booking anyway - and a monthly rental
     * paid in one lump would otherwise credit its whole term to one day.
     */
    const [bookings, expenses] = await Promise.all([
      prisma.booking.findMany({
        where: {
          // Overlapping the window, not starting in it: a hire that began last
          // month and runs through this one is a car that was out all month,
          // and counting only new bookings would report it as idle.
          pickupAt: { lt: range.to },
          returnAt: { gt: range.from },
          status: { notIn: ['CANCELLED', 'PENDING'] },
        },
        select: {
          vehicleId: true,
          totalAmount: true,
          taxAmount: true,
          rentalDays: true,
          pickupAt: true,
          returnAt: true,
          currency: true,
        },
      }),
      prisma.vehicleExpense.groupBy({
        by: ['vehicleId'],
        where: { incurredAt: window },
        _sum: { amount: true },
      }),
    ]);

    /*
     * ========================================================================
     * DAYS OUT IS A UNION, NOT A SUM
     * ========================================================================
     * Two things had to be got right here, and the obvious code gets both
     * wrong:
     *
     *   1. CLIPPING. A ten-day hire collected on the 28th belongs to this
     *      month for three days, not ten. Taking `rentalDays` whole puts more
     *      days into a month than the month has.
     *
     *   2. OVERLAP. Completed bookings on one car CAN overlap - the database
     *      constraint only guards live ones - and the demo fleet has several.
     *      Adding their lengths together produced 55 days out of a 30-day
     *      month for one car, clamped to a confident-looking 100%.
     *
     * So the periods are merged before they are measured: a day the car was
     * out is counted once however many bookings covered it. Revenue is still
     * credited whole to the month the car went out, which is the convention
     * the bookings report already uses and the one an owner reconciles
     * against.
     */
    const revenueByVehicle = new Map<
      string,
      { net: Prisma.Decimal; rentals: number; periods: [number, number][] }
    >();

    for (const booking of bookings) {
      const current = revenueByVehicle.get(booking.vehicleId) ?? {
        net: ZERO,
        rentals: 0,
        periods: [] as [number, number][],
      };
      // Net of VAT: the tax was never the company's money.
      current.net = current.net.add(booking.totalAmount.sub(booking.taxAmount));
      current.rentals += 1;

      const startedIn = Math.max(booking.pickupAt.getTime(), range.from.getTime());
      const endedIn = Math.min(booking.returnAt.getTime(), range.to.getTime());
      if (endedIn > startedIn) current.periods.push([startedIn, endedIn]);

      revenueByVehicle.set(booking.vehicleId, current);
    }

    const costByVehicle = new Map(
      expenses.map((row) => [row.vehicleId, row._sum.amount ?? ZERO]),
    );

    const rows = vehicles.map((vehicle) => {
      const revenue = revenueByVehicle.get(vehicle.id) ?? {
        net: ZERO,
        rentals: 0,
        periods: [] as [number, number][],
      };
      const cost = costByVehicle.get(vehicle.id) ?? ZERO;
      const daysOut = mergedDays(revenue.periods);

      return {
        vehicleId: vehicle.id,
        vehicle: vehicle.brand + ' ' + vehicle.model + ' (' + vehicle.year + ')',
        registrationNumber: vehicle.registrationNumber,
        category: vehicle.category.name,
        revenue: revenue.net.toFixed(2),
        costs: cost.toFixed(2),
        net: revenue.net.sub(cost).toFixed(2),
        rentals: revenue.rentals,
        daysRented: Math.round(daysOut),
        /// Percentage of the period the car was out on hire. Cannot exceed
        /// 100 now that overlapping hires are merged rather than added.
        utilisation: Math.round((daysOut / days) * 100),
        purchasePrice: vehicle.purchasePrice?.toFixed(2) ?? null,
        currentValue: vehicle.currentValue?.toFixed(2) ?? null,
      };
    });

    rows.sort((a, b) => Number(b.net) - Number(a.net));

    const totals = rows.reduce(
      (sum, row) => ({
        revenue: sum.revenue.add(new Prisma.Decimal(row.revenue)),
        costs: sum.costs.add(new Prisma.Decimal(row.costs)),
      }),
      { revenue: ZERO, costs: ZERO },
    );

    return {
      period: { from: range.from.toISOString(), to: range.to.toISOString(), days },
      totals: {
        revenue: totals.revenue.toFixed(2),
        costs: totals.costs.toFixed(2),
        net: totals.revenue.sub(totals.costs).toFixed(2),
      },
      vehicles: rows,
      /// True when no cost has ever been recorded, so the screen can explain
      /// why every "net" equals its revenue instead of looking wrong.
      noCostsRecorded: totals.costs.isZero(),
    };
  },

  /**
   * Who rents the most, and who owes the most.
   *
   * Two different lists deliberately: the best customer and the most
   * troublesome one are rarely the same person, and a single "top customers"
   * table ranked by spend hides the second entirely.
   */
  async customers(range: DateRange) {
    assertRange(range);

    const window = { gte: range.from, lt: range.to };

    const grouped = await prisma.booking.groupBy({
      by: ['customerId'],
      where: { pickupAt: window, status: { notIn: ['CANCELLED', 'PENDING'] } },
      _sum: { totalAmount: true },
      _count: true,
    });

    const ids = grouped.map((row) => row.customerId);
    const users = await prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, fullName: true, email: true },
    });
    const nameOf = new Map(users.map((user) => [user.id, user]));

    const top = grouped
      .map((row) => ({
        customerId: row.customerId,
        name: nameOf.get(row.customerId)?.fullName ?? 'Unknown',
        email: nameOf.get(row.customerId)?.email ?? '',
        rentals: row._count,
        spent: (row._sum.totalAmount ?? ZERO).toFixed(2),
      }))
      .sort((a, b) => Number(b.spent) - Number(a.spent))
      .slice(0, 20);

    return {
      period: { from: range.from.toISOString(), to: range.to.toISOString() },
      topBySpend: top,
    };
  },

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
        /*
         * Money promised but not yet taken.
         *
         * CONFIRMED belongs here now: confirmation means the documents passed
         * and the car is held, not that anyone has paid. Counting only
         * PAYMENT_PENDING would understate the book by every confirmed
         * customer who has not reached checkout yet.
         *
         * Cash bookings are excluded - nothing is outstanding online, the
         * notes are due at the counter.
         */
        where: {
          status: { in: ['CONFIRMED', 'PAYMENT_PENDING'] },
          paymentMethod: { not: 'CASH_ON_PICKUP' },
        },
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

  /**
   * The two summaries the dashboard opens with: the fleet, and what is out.
   *
   * =========================================================================
   * WHY THESE PARTICULAR NUMBERS
   * =========================================================================
   * Every one of them is a question somebody asks out loud during a working
   * day, and every one of them was previously answerable only by opening a
   * list and counting:
   *
   *   "how many cars are free right now"
   *   "which cars have no registration on file"    - uninsurable, unrentable
   *   "what is overdue"                            - money and a missing car
   *   "what is due back today"                     - who to expect at the desk
   *   "what came back today"                       - what needs inspecting
   *
   * Counted by the DATABASE, never by tallying a page of results in the
   * browser: a dashboard that is right for the first sixty vehicles and
   * quietly wrong afterwards is worse than one that says nothing.
   */
  async operationsSummary() {
    const now = new Date();
    const startOfToday = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const startOfTomorrow = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);
    const today = startOfToday;

    const [
      byStatus,
      registrations,
      insurances,
      activeRentals,
      overdue,
      dueBackToday,
      returnedToday,
      awaitingPayment,
      documentsToReview,
      damagedVehicles,
      unrecoveredFines,
      unrecoveredTolls,
      revenueToday,
    ] = await Promise.all([
      prisma.vehicle.groupBy({
        by: ['status'],
        where: { deletedAt: null },
        _count: { _all: true },
      }),

      /*
       * One row per vehicle that HAS a registration document, carrying the
       * latest expiry among them.
       *
       * Grouped in the database rather than fetched and reduced here: a
       * renewal is a second document, not an edit of the first, so "is this
       * car registered" is a question about the newest one.
       */
      prisma.vehicleDocument.groupBy({
        by: ['vehicleId'],
        where: {
          type: { in: ['REGISTRATION', 'REGISTRATION_RENEWAL'] },
          vehicle: { deletedAt: null },
        },
        _max: { expiryDate: true },
      }),

      // Insurance lives in its own table with a policy history; only the
      // policy currently in force answers "is this car insured".
      prisma.insuranceRecord.groupBy({
        by: ['vehicleId'],
        where: { isActive: true, vehicle: { deletedAt: null } },
        _max: { expiryDate: true },
      }),

      prisma.booking.count({ where: { status: 'ACTIVE' } }),

      /*
       * Out, and past the date it was due back.
       *
       * The rental record says the car is ACTUALLY out (a handover happened,
       * no return yet); the booking says when it was due. Both halves are
       * needed - a booking whose dates have passed but which was never
       * collected is not an overdue car, it is a no-show.
       */
      prisma.rental.count({
        where: { returnedAt: null, booking: { returnAt: { lt: now } } },
      }),

      prisma.rental.count({
        where: {
          returnedAt: null,
          booking: { returnAt: { gte: startOfToday, lt: startOfTomorrow } },
        },
      }),

      prisma.rental.count({
        where: { returnedAt: { gte: startOfToday, lt: startOfTomorrow } },
      }),

      /*
       * Identical to the bookings list and the outstanding report. Three
       * screens answering "who owes us money" with three different numbers is
       * worse than any one of them being slightly off.
       */
      prisma.booking.count({
        where: {
          status: { in: ['CONFIRMED', 'PAYMENT_PENDING'] },
          paymentMethod: { not: 'CASH_ON_PICKUP' },
        },
      }),

      prisma.customerDocument.count({ where: { status: 'PENDING' } }),

      /*
       * Cars carrying damage nobody has finished dealing with.
       *
       * Counted from the DAMAGE record rather than from vehicle status,
       * because a scratched car is usually still out on hire or already back
       * on the fleet - its status says AVAILABLE while an unresolved damage
       * charge sits behind it, and that is exactly the thing that gets lost.
       */
      prisma.damage.groupBy({
        by: ['vehicleId'],
        // Not CHARGED or DISMISSED: those are finished with.
        where: { status: { in: ['REPORTED', 'ASSESSED', 'APPROVED'] } },
      }),

      /*
       * Salik and fines are counted SEPARATELY, not as one "charges" number.
       * They behave differently - a toll is a few dirhams recovered from a
       * deposit, a fine is a few hundred with a deadline and a driver to
       * nominate - and one combined figure hides whichever is the problem.
       */
      prisma.trafficFine.aggregate({
        where: { status: { in: ['RECORDED', 'ASSIGNED'] } },
        _sum: { amount: true, serviceFee: true },
        _count: true,
      }),
      prisma.tollCharge.aggregate({
        where: { status: { in: ['RECORDED', 'ASSIGNED'] } },
        _sum: { amount: true, serviceFee: true },
        _count: true,
      }),

      /*
       * Money in TODAY. The month-to-date figure answers a different question
       * from the one asked at five o'clock, which is "how did we do today".
       */
      prisma.payment.aggregate({
        where: {
          status: { in: ['SUCCESS', 'REFUNDED', 'PARTIALLY_REFUNDED'] },
          paidAt: { gte: startOfToday, lt: startOfTomorrow },
          type: { not: 'SECURITY_DEPOSIT' },
        },
        _sum: { amount: true },
        _count: true,
      }),
    ]);

    const fleetTotal = byStatus.reduce((sum, row) => sum + row._count._all, 0);
    const countOf = (status: string) =>
      byStatus.find((row) => row.status === status)?._count._all ?? 0;

    const expired = (rows: { _max: { expiryDate: Date | null } }[]) =>
      rows.filter((row) => row._max.expiryDate !== null && row._max.expiryDate < today).length;

    return {
      fleet: {
        total: fleetTotal,
        available: countOf('AVAILABLE'),
        rented: countOf('RENTED'),
        reserved: countOf('RESERVED'),
        underInspection: countOf('UNDER_INSPECTION'),
        underMaintenance: countOf('UNDER_MAINTENANCE'),
        unavailable: countOf('UNAVAILABLE'),
        /*
         * A car with no registration or no insurance on file cannot legally
         * go out, and nothing else in this system says so out loud.
         */
        noRegistration: fleetTotal - registrations.length,
        noInsurance: fleetTotal - insurances.length,
        expiredRegistration: expired(registrations),
        expiredInsurance: expired(insurances),
        /// Cars with damage still open, whatever their status says.
        damaged: damagedVehicles.length,
      },
      rentals: {
        active: activeRentals,
        overdue,
        dueBackToday,
        returnedToday,
        awaitingPayment,
        documentsToReview,
      },
      /*
       * Charges raised and not yet recovered, split by kind. The counts matter
       * as much as the money: twenty small tolls and one large fine are
       * different afternoons.
       */
      charges: {
        fines: {
          count: unrecoveredFines._count,
          amount: (unrecoveredFines._sum.amount ?? ZERO)
            .add(unrecoveredFines._sum.serviceFee ?? ZERO)
            .toFixed(2),
        },
        tolls: {
          count: unrecoveredTolls._count,
          amount: (unrecoveredTolls._sum.amount ?? ZERO)
            .add(unrecoveredTolls._sum.serviceFee ?? ZERO)
            .toFixed(2),
        },
      },
      today: {
        revenue: (revenueToday._sum.amount ?? ZERO).toFixed(2),
        payments: revenueToday._count,
      },
    };
  },

  /** Everything the dashboard needs, in one round trip. */
  async dashboard() {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

    const [revenue, bookings, outstanding, activeRentals, fleetSize, summary] = await Promise.all([
      this.revenue({ from: monthStart, to: nextMonth }),
      this.bookings({ from: monthStart, to: nextMonth }),
      this.outstanding(),
      prisma.booking.count({ where: { status: 'ACTIVE' } }),
      prisma.vehicle.count({ where: { deletedAt: null, isPublished: true } }),
      /*
       * Counted by the DATABASE, not by tallying a page of vehicles.
       *
       * The dashboard used to fetch the first 60 cars and count the statuses
       * it found. Correct on a small fleet, and quietly wrong the day the
       * 61st car is added - the tiles would simply stop adding up, with
       * nothing on screen to say why.
       */
      this.operationsSummary(),
    ]);

    return {
      month: { from: monthStart.toISOString(), to: nextMonth.toISOString() },
      revenue,
      bookings,
      outstanding,
      activeRentals,
      /** Published cars only - what a customer could actually book. */
      fleetSize,
      /** Every car on the books, counted by status, plus what is missing. */
      fleet: summary.fleet,
      /** What is out, overdue, due back and just returned. */
      rentals: summary.rentals,
      /** Fines and tolls raised and not yet recovered, counted separately. */
      charges: summary.charges,
      /** Money taken today, which is not the same question as this month. */
      today: summary.today,
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


/**
 * Total length of a set of periods, counting overlaps once.
 *
 * Sorting by start and then extending a single open period is the standard
 * merge: anything beginning before the current one ends is part of it, and
 * anything beginning after it starts a new one.
 */
function mergedDays(periods: [number, number][]): number {
  if (periods.length === 0) return 0;

  const sorted = [...periods].sort((a, b) => a[0] - b[0]);
  let total = 0;
  let [start, end] = sorted[0]!;

  for (const [nextStart, nextEnd] of sorted.slice(1)) {
    if (nextStart <= end) {
      end = Math.max(end, nextEnd);
    } else {
      total += end - start;
      start = nextStart;
      end = nextEnd;
    }
  }

  total += end - start;
  return total / 86_400_000;
}
