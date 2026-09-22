/**
 * modules/fleet/finesService.ts
 * ---------------------------------------------------------------------------
 * Traffic fines and toll charges (BRD 28 and 29).
 *
 * They live in one FILE because the workflow rhymes - record, attribute to a
 * rental, recover - but in two TABLES, because the records genuinely differ.
 * A fine has an authority reference, a violation, and a driver who may contest
 * it; a toll is an automatic gate reading. One table with a `type` column
 * would be half-empty in both directions and awkward to report on.
 *
 * ===========================================================================
 * ATTRIBUTION
 * ===========================================================================
 * The hard part is not recording the fine - it is working out WHO was driving.
 * That is answered by the timestamp: find the rental whose window contains the
 * violation. The BRD does not describe this, but without it staff would be
 * cross-referencing dates by hand for every Salik charge.
 *
 * Attribution is a SUGGESTION, never automatic recovery. Matching a fine to a
 * rental and taking money for it are different decisions, and the second needs
 * a person - number plates get cloned, and dates can be wrong.
 */
import { Prisma } from '@prisma/client';
import type { ChargeRecoveryStatus, FineType } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { ApiError } from '../../utils/ApiError';
import { auditService } from '../audit/service';
import type { FleetActor } from '../damages/service';
import { SettingKey, settingsService } from '../settings/service';

const ZERO = new Prisma.Decimal(0);

/*
 * ===========================================================================
 * COMPLETED MEANS CLOSED
 * ===========================================================================
 * Clicking "completed" is the owner saying: this rental is over, nothing more
 * will be charged to it, the car is free for the next customer. So a booking
 * in a terminal state is not offered, not matched, and not chargeable - by
 * any route.
 *
 * The consequence is real and deliberate: a fine that arrives after a booking
 * is closed cannot be passed to that customer, and the company absorbs it.
 * The moment to catch those is the settlement check at RETURNED, which is why
 * it lists what is outstanding and how much Salik has not arrived yet BEFORE
 * the deposit goes back.
 */
const OPEN_TO_CHARGES = [
  'ACTIVE',
  'EXTENSION_REQUESTED',
  'RETURN_PENDING',
  'RETURNED',
] as const;

/** Said the same way wherever a closed rental refuses something. */
const closedMessage = (bookingNumber: string): string =>
  `${bookingNumber} is closed. A completed rental takes no further charges - the fine or crossing stays with the company, or it has to be settled with the customer directly.`;

/**
 * The handling fee to apply, in order of authority:
 *
 *   1. what staff typed on this record (an explicit, deliberate override),
 *   2. the configured policy,
 *   3. nothing.
 *
 * Falling through to nothing rather than to a plausible default is the same
 * rule the charge calculator follows: an unset fee bills the customer only
 * what the authority charged, which is the safe way to be wrong.
 */
async function resolveServiceFee(
  explicit: string | undefined,
  key: string,
): Promise<Prisma.Decimal> {
  if (explicit !== undefined) return new Prisma.Decimal(explicit);
  const configured = await settingsService.getNumber(key);
  return configured === null ? ZERO : new Prisma.Decimal(configured);
}

/** Bookings that were live at a given instant, for attribution. */
/**
 * Who to suggest, in the shape the caller actually shows.
 *
 * The name and the booking reference are read together - "Ahmed had this car
 * on BK-2026-0042" - so they are returned together. They used to come back as
 * the raw customer row, which carried `fullName` and no booking number at all,
 * while the admin read `.name` and `.bookingNumber`. Both were undefined, and
 * staff were told "undefined had this car on booking undefined".
 */
function toMatchedCustomer(
  match: { bookingNumber: string; customer: { id: string; fullName: string; email: string } } | null,
) {
  if (!match) return null;
  return {
    id: match.customer.id,
    fullName: match.customer.fullName,
    email: match.customer.email,
    bookingNumber: match.bookingNumber,
  };
}

/**
 * Who actually had this car at this moment?
 *
 * ===========================================================================
 * WHY CONTRACT DATES ARE NOT THE ANSWER
 * ===========================================================================
 * This used to be one `findFirst` on the booked dates, with no ordering. When
 * two bookings on one car both covered the moment - which happens constantly,
 * because a booking's dates are what was AGREED and a finished rental keeps
 * its original return date - the database returned whichever row it happened
 * to reach first. A fine was then billed to a customer picked at random.
 *
 * That is exactly what went wrong: a booking that was never even handed over
 * beat the customer who was demonstrably driving the car, because its stale
 * contract window started a week earlier.
 *
 * ===========================================================================
 * THE RULE
 * ===========================================================================
 * Possession beats paperwork, and uncertainty beats a guess:
 *
 *   1. A HANDOVER RECORD is proof. If exactly one rental was physically out
 *      at that moment - handed over before it, not yet returned after it -
 *      that is the answer, whatever the contracts say.
 *   2. Otherwise fall back to booked dates, for the businesses and the older
 *      records where handovers were not always logged.
 *   3. If either step leaves MORE THAN ONE candidate, attach nothing. Two
 *      rentals covering one moment is a question about reality that this
 *      code cannot answer, and answering it wrongly takes money from the
 *      wrong person. It is reported instead, and a human attaches it.
 */
interface RentalMatch {
  id: string;
  bookingNumber: string;
  customer: { id: string; fullName: string; email: string };
}

interface MatchOutcome {
  /** The single rental that had the car. Null when unknown or ambiguous. */
  match: RentalMatch | null;
  /** Populated when several rentals cover the moment and nobody can say which. */
  candidates: { bookingNumber: string; customerName: string }[];
}

async function findRentalAt(vehicleId: string, at: Date): Promise<MatchOutcome> {
  const SELECT = {
    id: true,
    bookingNumber: true,
    customer: { select: { id: true, fullName: true, email: true } },
  } as const;

  // 1. Proof: the car was signed out and not yet signed back in.
  const heldAtTheTime = await prisma.booking.findMany({
    where: {
      vehicleId,
      status: { in: [...OPEN_TO_CHARGES] },
      rental: {
        pickedUpAt: { lte: at },
        OR: [{ returnedAt: null }, { returnedAt: { gte: at } }],
      },
    },
    select: SELECT,
  });

  if (heldAtTheTime.length === 1) {
    return { match: heldAtTheTime[0]!, candidates: [] };
  }
  if (heldAtTheTime.length > 1) {
    return {
      match: null,
      candidates: heldAtTheTime.map((booking) => ({
        bookingNumber: booking.bookingNumber,
        customerName: booking.customer.fullName,
      })),
    };
  }

  // 2. No handover recorded either way - fall back to what was booked.
  const bookedOverIt = await prisma.booking.findMany({
    where: {
      vehicleId,
      pickupAt: { lte: at },
      returnAt: { gte: at },
      status: { in: [...OPEN_TO_CHARGES] },
    },
    select: SELECT,
  });

  if (bookedOverIt.length === 1) {
    return { match: bookedOverIt[0]!, candidates: [] };
  }

  return {
    match: null,
    candidates: bookedOverIt.map((booking) => ({
      bookingNumber: booking.bookingNumber,
      customerName: booking.customer.fullName,
    })),
  };
}

export const finesService = {
  /**
   * Record a fine.
   *
   * `fineNumber` is unique in the database, so entering the same fine twice is
   * rejected rather than charged twice. That is a real risk: fines arrive in
   * batches and get keyed in by hand.
   */
  async recordFine(
    input: {
      vehicleId: string;
      fineNumber: string;
      fineType?: 'TRAFFIC' | 'PARKING' | 'OTHER';
      violationAt: Date;
      violation?: string;
      location?: string;
      amount: string;
      serviceFee?: string;
      notes?: string;
    },
    actor: FleetActor,
  ) {
    const vehicle = await prisma.vehicle.findFirst({
      where: { id: input.vehicleId, deletedAt: null },
    });
    if (!vehicle) throw ApiError.notFound('Vehicle not found');

    const duplicate = await prisma.trafficFine.findUnique({
      where: { fineNumber: input.fineNumber },
    });
    if (duplicate) {
      throw ApiError.conflict(`Fine ${input.fineNumber} has already been recorded`);
    }

    // Suggest the rental this falls in, but do not recover anything yet.
    const { match, candidates } = await findRentalAt(input.vehicleId, input.violationAt);

    const fine = await prisma.trafficFine.create({
      data: {
        vehicleId: input.vehicleId,
        bookingId: match?.id ?? null,
        fineNumber: input.fineNumber,
        fineType: input.fineType ?? 'TRAFFIC',
        violationAt: input.violationAt,
        violation: input.violation ?? null,
        location: input.location ?? null,
        amount: new Prisma.Decimal(input.amount),
        serviceFee: await resolveServiceFee(input.serviceFee, SettingKey.FINE_SERVICE_FEE),
        notes: input.notes ?? null,
        status: match ? 'ASSIGNED' : 'RECORDED',
        recordedById: actor.id,
      },
    });

    await auditService.record({
      action: 'fine.recorded',
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      entityType: 'TrafficFine',
      entityId: fine.id,
      metadata: {
        fineNumber: input.fineNumber,
        amount: input.amount,
        matchedBooking: match?.bookingNumber ?? null,
        ambiguousBetween: candidates.map((option) => option.bookingNumber),
      },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return {
      fine: toPublicFine(fine),
      matchedCustomer: toMatchedCustomer(match),
      ambiguousBetween: candidates,
    };
  },

  async recordToll(
    input: {
      vehicleId: string;
      crossedAt: Date;
      gate?: string;
      reference?: string;
      amount: string;
      serviceFee?: string;
    },
    actor: FleetActor,
  ) {
    const vehicle = await prisma.vehicle.findFirst({
      where: { id: input.vehicleId, deletedAt: null },
    });
    if (!vehicle) throw ApiError.notFound('Vehicle not found');

    /*
     * The same crossing, entered twice, is billed twice.
     *
     * Fines are protected by a unique fine number; a toll has no such
     * reference of its own, and Salik statements get keyed in by hand or
     * imported repeatedly. So the natural key stands in for one: a car cannot
     * cross the same gate twice at the same instant.
     *
     * A pre-check, not a constraint - `gate` is nullable, and PostgreSQL
     * treats NULLs as distinct in a unique index, so a plain @@unique would
     * quietly let ungated duplicates through. Two operators submitting the
     * identical row in the same instant could still both pass; that is a far
     * smaller risk than the routine one this catches, and worth naming rather
     * than pretending away.
     */
    const duplicate = await prisma.tollCharge.findFirst({
      where: {
        vehicleId: input.vehicleId,
        crossedAt: input.crossedAt,
        gate: input.gate ?? null,
      },
      select: { id: true },
    });
    if (duplicate) {
      throw ApiError.conflict(
        `A crossing of ${input.gate ?? 'this gate'} by this vehicle at that exact time is already recorded.`,
      );
    }

    const { match, candidates } = await findRentalAt(input.vehicleId, input.crossedAt);

    const toll = await prisma.tollCharge.create({
      data: {
        vehicleId: input.vehicleId,
        bookingId: match?.id ?? null,
        crossedAt: input.crossedAt,
        gate: input.gate ?? null,
        reference: input.reference ?? null,
        amount: new Prisma.Decimal(input.amount),
        serviceFee: await resolveServiceFee(input.serviceFee, SettingKey.TOLL_SERVICE_FEE),
        status: match ? 'ASSIGNED' : 'RECORDED',
        recordedById: actor.id,
      },
    });

    await auditService.record({
      action: 'toll.recorded',
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      entityType: 'TollCharge',
      entityId: toll.id,
      metadata: {
        amount: input.amount,
        matchedBooking: match?.bookingNumber ?? null,
        ambiguousBetween: candidates.map((option) => option.bookingNumber),
      },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return {
      toll: toPublicToll(toll),
      matchedCustomer: toMatchedCustomer(match),
      ambiguousBetween: candidates,
    };
  },

  /**
   * Pass a fine or toll on to the customer AND take it from their deposit.
   *
   * The authority's amount and the company's handling fee are charged as one
   * figure, but every description and calculation keeps them separate so the
   * customer can see what went to the authority and what went to the rental
   * company. BRD 28 and 29 both call for that split; hiding it invites a
   * dispute.
   *
   * Recovery remains a decision a person makes - attribution never charges
   * anyone by itself. What changed is that deciding to recover now finishes
   * the job: the deposit deduction happens here rather than waiting for
   * somebody to remember a second action on the booking page.
   *
   * Returns how much came from the deposit and how much is still to invoice.
   */
  async recover(kind: 'fine' | 'toll', id: string, actor: FleetActor) {
    const record =
      kind === 'fine'
        ? await prisma.trafficFine.findUnique({
            where: { id },
            include: {
              booking: {
                select: {
                  id: true,
                  bookingNumber: true,
                  currency: true,
                  billingCycle: true,
                  status: true,
                },
              },
            },
          })
        : await prisma.tollCharge.findUnique({
            where: { id },
            include: {
              booking: {
                select: {
                  id: true,
                  bookingNumber: true,
                  currency: true,
                  billingCycle: true,
                  status: true,
                },
              },
            },
          });

    if (!record) throw ApiError.notFound(`${kind === 'fine' ? 'Fine' : 'Toll charge'} not found`);

    if (record.status === 'RECOVERED') {
      throw ApiError.conflict('This has already been recovered');
    }
    if (record.status === 'DISPUTED') {
      throw ApiError.conflict('This is under dispute and cannot be recovered yet');
    }
    if (!record.bookingId || !record.booking) {
      throw ApiError.badRequest(
        'This is not attributed to a rental, so there is nobody to charge. Assign it to a booking first.',
      );
    }

    // The rental is over. Nothing more comes out of it, and nothing more goes
    // onto it - including the deposit, which has been settled and returned.
    if (!OPEN_TO_CHARGES.includes(record.booking.status as (typeof OPEN_TO_CHARGES)[number])) {
      throw ApiError.conflict(closedMessage(record.booking.bookingNumber));
    }

    const total = record.amount.add(record.serviceFee);
    const label =
      kind === 'fine'
        ? `Traffic fine ${(record as unknown as { fineNumber: string }).fineNumber}`
        : `Toll charge${(record as unknown as { gate: string | null }).gate ? ' (' + (record as unknown as { gate: string | null }).gate + ')' : ''}`;
    const description = `${label}: ${record.amount.toFixed(2)} + ${record.serviceFee.toFixed(2)} handling`;

    /*
     * How much of this the deposit can absorb.
     *
     * Recovering and taking the money used to be two separate actions on two
     * different pages, which meant a recovered fine could sit as a PENDING
     * charge indefinitely while the deposit it should have come out of was
     * released in full. They are one action now - but the deposit's own guards
     * still apply, so a deposit that is not held, or is already spent, simply
     * absorbs nothing and the whole amount stays billable.
     */
    /*
     * ===================================================================
     * A MONTHLY RENTAL IS BILLED, NOT DEDUCTED
     * ===================================================================
     * The deposit exists for damage. Nibbling it for a AED 4 gate crossing
     * spends the one thing that covers a dented door, and leaves the customer
     * a refund that is mysteriously short.
     *
     * A long-term customer is already paying an invoice every month, so the
     * charge simply rides along on the next unpaid one. Nothing to chase,
     * nothing taken, and the deposit stays whole for what it is for.
     *
     * Only the NEXT UNPAID month qualifies: adding to a month already paid
     * would be billing for something that has already been settled.
     */
    const nextInstalment =
      record.booking.billingCycle === 'MONTHLY'
        ? await prisma.rentalInstalment.findFirst({
            where: { bookingId: record.bookingId, status: { in: ['DUE', 'SCHEDULED'] } },
            orderBy: { sequence: 'asc' },
            select: { id: true, sequence: true },
          })
        : null;

    if (nextInstalment) {
      const charge = await prisma.$transaction(async (tx) => {
        const created = await tx.additionalCharge.create({
          data: {
            bookingId: record.bookingId!,
            instalmentId: nextInstalment.id,
            type: 'OTHER',
            amount: total,
            currency: record.booking!.currency,
            description: `${description} - billed with month ${nextInstalment.sequence}`,
            calculation: {
              kind,
              recordId: id,
              authorityAmount: record.amount.toFixed(2),
              companyServiceFee: record.serviceFee.toFixed(2),
              total: total.toFixed(2),
              billedWithInstalment: nextInstalment.sequence,
            },
            createdById: actor.id,
            status: 'PENDING',
          },
        });

        await tx.rentalInstalment.update({
          where: { id: nextInstalment.id },
          data: { extrasAmount: { increment: total } },
        });

        if (kind === 'fine') {
          await tx.trafficFine.update({ where: { id }, data: { status: 'RECOVERED' } });
        } else {
          await tx.tollCharge.update({ where: { id }, data: { status: 'RECOVERED' } });
        }

        return created;
      });

      await auditService.record({
        action: kind === 'fine' ? 'fine.recovered' : 'toll.recovered',
        actorId: actor.id,
        actorEmail: actor.email,
        actorRole: actor.role,
        entityType: kind === 'fine' ? 'TrafficFine' : 'TollCharge',
        entityId: id,
        metadata: {
          bookingNumber: record.booking.bookingNumber,
          total: total.toFixed(2),
          billedWithInstalment: nextInstalment.sequence,
        },
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });

      /*
       * The SAME shape the deposit path returns, plus the month.
       *
       * Two recovery paths returning two different shapes is how the admin
       * page ends up printing "undefined" - it has happened here before. One
       * shape, one reader; `billedWithInstalment` is the only thing that
       * distinguishes them, and it is null on the other path rather than
       * absent.
       */
      return {
        chargeId: charge.id,
        amount: total.toFixed(2),
        recoveredFromDeposit: '0.00',
        leftToInvoice: total.toFixed(2),
        // Untouched: the whole point of billing a month is not to spend it.
        depositBalance: null as string | null,
        billedWithInstalment: nextInstalment.sequence as number | null,
      };
    }

    // Imported here rather than at the top so the module graph stays acyclic -
    // the same pattern rentals uses to reach deposits.
    const { depositsService } = await import('../deposits/service');
    const summary = await depositsService.getByBookingId(record.bookingId);

    const depositIsSpendable =
      summary !== null && (summary.status === 'HELD' || summary.status === 'PARTIALLY_RELEASED');
    const balance = depositIsSpendable ? new Prisma.Decimal(summary.balance) : ZERO;

    // Partial recovery beats no recovery: take the deposit down to zero and
    // bill the rest. The deposit is never pushed negative.
    const fromDeposit = total.greaterThan(balance) ? balance : total;
    const toInvoice = total.sub(fromDeposit);

    if (fromDeposit.greaterThan(0)) {
      // Deducted BEFORE the charge rows are written: if the ledger refuses,
      // nothing else has happened yet and the fine stays recoverable.
      await depositsService.deduct(
        record.bookingId,
        {
          amount: fromDeposit.toFixed(2),
          category: kind === 'fine' ? 'TRAFFIC_FINE' : 'TOLL',
          reason: description,
        },
        actor,
      );
    }

    const calculation = {
      kind,
      recordId: id,
      authorityAmount: record.amount.toFixed(2),
      companyServiceFee: record.serviceFee.toFixed(2),
      total: total.toFixed(2),
      recoveredFromDeposit: fromDeposit.toFixed(2),
      leftToInvoice: toInvoice.toFixed(2),
    } as Prisma.InputJsonValue;

    const charge = await prisma.$transaction(async (tx) => {
      // A part-paid fine becomes two rows rather than one row with a status
      // that is only half true: what came out of the deposit is settled, what
      // is left is still owed.
      const settled = fromDeposit.greaterThan(0)
        ? await tx.additionalCharge.create({
            data: {
              bookingId: record.bookingId!,
              type: 'OTHER',
              amount: fromDeposit,
              currency: record.booking!.currency,
              description: toInvoice.greaterThan(0)
                ? `${description} - ${fromDeposit.toFixed(2)} taken from deposit`
                : description,
              calculation,
              createdById: actor.id,
              status: 'SETTLED_FROM_DEPOSIT',
            },
          })
        : null;

      const outstanding = toInvoice.greaterThan(0)
        ? await tx.additionalCharge.create({
            data: {
              bookingId: record.bookingId!,
              type: 'OTHER',
              amount: toInvoice,
              currency: record.booking!.currency,
              description: fromDeposit.greaterThan(0)
                ? `${description} - ${toInvoice.toFixed(2)} beyond the deposit, to invoice`
                : description,
              calculation,
              createdById: actor.id,
              status: 'PENDING',
            },
          })
        : null;

      if (kind === 'fine') {
        await tx.trafficFine.update({ where: { id }, data: { status: 'RECOVERED' } });
      } else {
        await tx.tollCharge.update({ where: { id }, data: { status: 'RECOVERED' } });
      }

      return settled ?? outstanding!;
    });

    await auditService.record({
      action: kind === 'fine' ? 'fine.recovered' : 'toll.recovered',
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      entityType: kind === 'fine' ? 'TrafficFine' : 'TollCharge',
      entityId: id,
      metadata: {
        bookingNumber: record.booking.bookingNumber,
        total: total.toFixed(2),
        recoveredFromDeposit: fromDeposit.toFixed(2),
        leftToInvoice: toInvoice.toFixed(2),
      },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return {
      chargeId: charge.id,
      amount: total.toFixed(2),
      recoveredFromDeposit: fromDeposit.toFixed(2),
      leftToInvoice: toInvoice.toFixed(2),
      depositBalance: depositIsSpendable ? balance.sub(fromDeposit).toFixed(2) : null,
      billedWithInstalment: null as number | null,
    };
  },

  /**
   * The rentals a charge could plausibly belong to.
   *
   * ===================================================================
   * WHY A LIST AND NOT JUST THE TIMESTAMP MATCH
   * ===================================================================
   * Attribution by timestamp is right most of the time and silent when it is
   * wrong. A fine at 13:58 finds nothing if the rental was extended by phone
   * and never updated, or if the car went out an hour before the contract
   * said - and the charge then sits unattached forever, because there was no
   * way to say "no, it was this customer".
   *
   * So this offers the rentals THAT CAR has actually had, nearest in time
   * first, and marks the one the timestamp falls inside. The staff member
   * picks. They cannot pick a booking for a different vehicle, because only
   * this vehicle's bookings are ever offered.
   */
  async bookingOptions(kind: 'fine' | 'toll', id: string) {
    const record =
      kind === 'fine'
        ? await prisma.trafficFine.findUnique({
            where: { id },
            select: { vehicleId: true, violationAt: true },
          })
        : await prisma.tollCharge.findUnique({
            where: { id },
            select: { vehicleId: true, crossedAt: true },
          });

    if (!record) throw ApiError.notFound(`${kind === 'fine' ? 'Fine' : 'Toll charge'} not found`);

    const at = 'violationAt' in record ? record.violationAt : record.crossedAt;

    /*
     * A window either side of the moment, rather than every rental the car has
     * ever had. A fine in September has nothing to do with a rental in March,
     * and a list of forty bookings is one nobody reads before clicking.
     */
    const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
    const bookings = await prisma.booking.findMany({
      where: {
        vehicleId: record.vehicleId,
        /*
         * Closed rentals ARE listed, and marked unpickable.
         *
         * Leaving them out would show a staff member an empty list, or a list
         * without the customer they know was driving, and tell them nothing.
         * Showing it greyed with "this rental is closed" answers the question
         * they are about to ask.
         */
        status: { in: [...OPEN_TO_CHARGES, 'COMPLETED', 'CANCELLED'] },
        pickupAt: { lte: new Date(at.getTime() + MONTH_MS) },
        returnAt: { gte: new Date(at.getTime() - MONTH_MS) },
      },
      select: {
        id: true,
        bookingNumber: true,
        pickupAt: true,
        returnAt: true,
        status: true,
        billingCycle: true,
        customer: { select: { fullName: true, email: true } },
        rental: { select: { pickedUpAt: true, returnedAt: true } },
      },
      orderBy: { pickupAt: 'desc' },
      take: 10,
    });

    return {
      at: at.toISOString(),
      options: bookings.map((booking) => {
        /*
         * Two different claims, kept apart because they carry different
         * weight. "The car was signed out to them" is evidence; "their
         * contract covered that date" is only paperwork, and a booking that
         * was never handed over has paperwork and nothing else.
         */
        const hadTheCar = Boolean(
          booking.rental &&
            booking.rental.pickedUpAt <= at &&
            (booking.rental.returnedAt === null || booking.rental.returnedAt >= at),
        );

        const closed = !OPEN_TO_CHARGES.includes(
          booking.status as (typeof OPEN_TO_CHARGES)[number],
        );

        return {
          id: booking.id,
          bookingNumber: booking.bookingNumber,
          /** Finished or cancelled: it can be seen, but nothing can be added. */
          closed,
          customerName: booking.customer.fullName,
          customerEmail: booking.customer.email,
          pickupAt: booking.pickupAt.toISOString(),
          returnAt: booking.returnAt.toISOString(),
          status: booking.status,
          billingCycle: booking.billingCycle,
          /** The car was actually signed out to them at that moment. */
          hadTheCar,
          /** Their BOOKED dates cover it - which is not the same thing. */
          bookedOverIt: booking.pickupAt <= at && booking.returnAt >= at,
          /** No handover was ever recorded, so nobody drove anything on it. */
          neverHandedOver: booking.rental === null,
          handedOverAt: booking.rental?.pickedUpAt.toISOString() ?? null,
          returnedAt: booking.rental?.returnedAt?.toISOString() ?? null,
        };
      }),
    };
  },

  /** Attribute a fine or toll to a booking by hand, or mark it disputed. */
  async update(
    kind: 'fine' | 'toll',
    id: string,
    input: { bookingId?: string; status?: ChargeRecoveryStatus; notes?: string },
    actor: FleetActor,
  ) {
    /*
     * A charge may only be attached to a booking FOR THE SAME CAR.
     *
     * Without this, any booking id at all was accepted - so a mistyped or
     * stale id billed a fine to a customer who had never sat in that vehicle,
     * and the only trace was an audit row nobody reads. The check is cheap and
     * the failure it prevents is money taken from the wrong person.
     */
    if (input.bookingId) {
      const record =
        kind === 'fine'
          ? await prisma.trafficFine.findUnique({ where: { id }, select: { vehicleId: true } })
          : await prisma.tollCharge.findUnique({ where: { id }, select: { vehicleId: true } });

      if (!record) throw ApiError.notFound(`${kind === 'fine' ? 'Fine' : 'Toll charge'} not found`);

      const booking = await prisma.booking.findUnique({
        where: { id: input.bookingId },
        select: { vehicleId: true, bookingNumber: true, status: true },
      });

      if (!booking) throw ApiError.notFound('That booking does not exist');
      if (!OPEN_TO_CHARGES.includes(booking.status as (typeof OPEN_TO_CHARGES)[number])) {
        throw ApiError.conflict(closedMessage(booking.bookingNumber));
      }
      if (booking.vehicleId !== record.vehicleId) {
        throw ApiError.badRequest(
          `Booking ${booking.bookingNumber} is for a different vehicle. A charge can only be attached to a rental of the car it was issued against.`,
        );
      }
    }

    const data = {
      ...(input.bookingId !== undefined ? { bookingId: input.bookingId } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      /*
       * Attaching IS assigning.
       *
       * The status was left alone, so a charge attached by hand stayed
       * "recorded" - which reads as "nobody is responsible for this" - and the
       * Recover button, which looks at the status, never appeared. The staff
       * member had done the work and the screen showed nothing for it.
       */
      ...(input.bookingId && input.status === undefined ? { status: 'ASSIGNED' as const } : {}),
    };

    if (kind === 'fine') {
      await prisma.trafficFine.update({ where: { id }, data });
    } else {
      await prisma.tollCharge.update({ where: { id }, data });
    }

    await auditService.record({
      action: kind === 'fine' ? 'fine.updated' : 'toll.updated',
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      entityType: kind === 'fine' ? 'TrafficFine' : 'TollCharge',
      entityId: id,
      metadata: { ...input },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return { ok: true };
  },

  async listFines(query: {
    page: number;
    limit: number;
    status?: ChargeRecoveryStatus;
    vehicleId?: string;
  }) {
    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.vehicleId ? { vehicleId: query.vehicleId } : {}),
    };

    const [items, total] = await prisma.$transaction([
      prisma.trafficFine.findMany({
        where,
        include: {
          vehicle: { select: { brand: true, model: true, registrationNumber: true } },
          booking: {
            select: { bookingNumber: true, status: true, customer: { select: { fullName: true } } },
          },
        },
        orderBy: { violationAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      prisma.trafficFine.count({ where }),
    ]);

    return {
      items: items.map((fine) => ({
        id: fine.id,
        vehicleId: fine.vehicleId,
        bookingId: fine.bookingId,
        fineNumber: fine.fineNumber,
        fineType: fine.fineType,
        violationAt: fine.violationAt.toISOString(),
        violation: fine.violation,
        location: fine.location,
        amount: fine.amount.toFixed(2),
        serviceFee: fine.serviceFee.toFixed(2),
        total: fine.amount.add(fine.serviceFee).toFixed(2),
        currency: fine.currency,
        status: fine.status,
        notes: fine.notes,
        vehicle: `${fine.vehicle.brand} ${fine.vehicle.model} (${fine.vehicle.registrationNumber})`,
        bookingNumber: fine.booking?.bookingNumber ?? null,
        customerName: fine.booking?.customer.fullName ?? null,
        // A closed rental takes nothing further, so the page must not offer it.
        bookingClosed: fine.booking
          ? !OPEN_TO_CHARGES.includes(fine.booking.status as (typeof OPEN_TO_CHARGES)[number])
          : false,
      })),
      total,
    };
  },

  async listTolls(query: {
    page: number;
    limit: number;
    status?: ChargeRecoveryStatus;
    vehicleId?: string;
  }) {
    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.vehicleId ? { vehicleId: query.vehicleId } : {}),
    };

    const [items, total] = await prisma.$transaction([
      prisma.tollCharge.findMany({
        where,
        include: {
          vehicle: { select: { brand: true, model: true, registrationNumber: true } },
          booking: {
            select: { bookingNumber: true, status: true, customer: { select: { fullName: true } } },
          },
        },
        orderBy: { crossedAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      prisma.tollCharge.count({ where }),
    ]);

    return {
      items: items.map((toll) => ({
        id: toll.id,
        vehicleId: toll.vehicleId,
        bookingId: toll.bookingId,
        crossedAt: toll.crossedAt.toISOString(),
        gate: toll.gate,
        reference: toll.reference,
        amount: toll.amount.toFixed(2),
        serviceFee: toll.serviceFee.toFixed(2),
        total: toll.amount.add(toll.serviceFee).toFixed(2),
        currency: toll.currency,
        status: toll.status,
        notes: toll.notes,
        vehicle: `${toll.vehicle.brand} ${toll.vehicle.model} (${toll.vehicle.registrationNumber})`,
        bookingNumber: toll.booking?.bookingNumber ?? null,
        customerName: toll.booking?.customer.fullName ?? null,
        bookingClosed: toll.booking
          ? !OPEN_TO_CHARGES.includes(toll.booking.status as (typeof OPEN_TO_CHARGES)[number])
          : false,
      })),
      total,
    };
  },
};

function toPublicFine(fine: {
  id: string;
  vehicleId: string;
  bookingId: string | null;
  fineNumber: string;
  fineType: FineType;
  violationAt: Date;
  violation: string | null;
  location: string | null;
  amount: Prisma.Decimal;
  serviceFee: Prisma.Decimal;
  currency: string;
  status: ChargeRecoveryStatus;
  notes: string | null;
}) {
  return {
    id: fine.id,
    vehicleId: fine.vehicleId,
    bookingId: fine.bookingId,
    fineNumber: fine.fineNumber,
    /// Decides who the customer disputes it with - see the route schema.
    fineType: fine.fineType,
    violationAt: fine.violationAt.toISOString(),
    violation: fine.violation,
    location: fine.location,
    amount: fine.amount.toFixed(2),
    serviceFee: fine.serviceFee.toFixed(2),
    total: fine.amount.add(fine.serviceFee).toFixed(2),
    currency: fine.currency,
    status: fine.status,
    notes: fine.notes,
  };
}

function toPublicToll(toll: {
  id: string;
  vehicleId: string;
  bookingId: string | null;
  crossedAt: Date;
  gate: string | null;
  reference: string | null;
  amount: Prisma.Decimal;
  serviceFee: Prisma.Decimal;
  currency: string;
  status: ChargeRecoveryStatus;
  notes: string | null;
}) {
  return {
    id: toll.id,
    vehicleId: toll.vehicleId,
    bookingId: toll.bookingId,
    crossedAt: toll.crossedAt.toISOString(),
    gate: toll.gate,
    reference: toll.reference,
    amount: toll.amount.toFixed(2),
    serviceFee: toll.serviceFee.toFixed(2),
    total: toll.amount.add(toll.serviceFee).toFixed(2),
    currency: toll.currency,
    status: toll.status,
    notes: toll.notes,
  };
}
