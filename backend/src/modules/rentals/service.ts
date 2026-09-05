/**
 * modules/rentals/service.ts
 * ---------------------------------------------------------------------------
 * Pickup, return and the charges that fall out of them (BRD 24, 26, 30).
 *
 * The shape of this module follows one idea: a BOOKING is what was agreed, a
 * RENTAL is what actually happened. Handover creates the rental and records
 * reality - the real mileage, the real fuel, the real time. Return records it
 * again, and the DIFFERENCE between the two inspections is what gets charged.
 *
 * That is also why both inspections are kept rather than one row that gets
 * updated: "the scratch was already there" has to be an answerable question.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { logger } from '../../config/logger';
import { ApiError } from '../../utils/ApiError';
import { auditService } from '../audit/service';
import { SettingKey, settingsService } from '../settings/service';
import { calculateReturnCharges, type ChargePolicy } from './chargeCalculator';

export interface RentalActor {
  id: string;
  email: string;
  role: 'CUSTOMER' | 'ADMIN' | 'STAFF';
  ipAddress?: string;
  userAgent?: string;
}

/** Settings keys this module reads. All client-configurable (BRD 51). */
export const RentalSettingKey = {
  LATE_GRACE_HOURS: 'rental.late_grace_hours',
  LATE_FEE_PER_DAY: 'rental.late_fee_per_day',
  FUEL_CHARGE_PER_PERCENT: 'rental.fuel_charge_per_percent',
  CLEANING_FEE: 'rental.cleaning_fee',
} as const;

async function loadChargePolicy(): Promise<ChargePolicy> {
  const [grace, lateFee, fuel, cleaning] = await Promise.all([
    settingsService.getNumber(RentalSettingKey.LATE_GRACE_HOURS),
    settingsService.getNumber(RentalSettingKey.LATE_FEE_PER_DAY),
    settingsService.getNumber(RentalSettingKey.FUEL_CHARGE_PER_PERCENT),
    settingsService.getNumber(RentalSettingKey.CLEANING_FEE),
  ]);

  return {
    lateGraceHours: grace,
    lateFeePerDay: lateFee === null ? null : new Prisma.Decimal(lateFee),
    fuelChargePerPercent: fuel === null ? null : new Prisma.Decimal(fuel),
    cleaningFee: cleaning === null ? null : new Prisma.Decimal(cleaning),
  };
}

export interface PickupInput {
  mileage: number;
  fuelPercent: number;
  customerVerified: boolean;
  conditionNotes?: string;
  damageNotes?: string;
  accessories?: string[];
}

export interface ReturnInput {
  mileage: number;
  fuelPercent: number;
  conditionNotes?: string;
  damageNotes?: string;
  cleanliness?: string;
  needsCleaning?: boolean;
  missingAccessories?: string[];
}

export const rentalsService = {
  /**
   * Hand the vehicle over (BRD 24).
   *
   * One transaction moves four things together: the booking becomes ACTIVE,
   * the rental record opens, the pickup inspection is recorded, and the
   * vehicle is marked RENTED. A partial handover - a car marked RENTED with no
   * inspection, or an ACTIVE booking with no rental - is worse than a clean
   * failure the counter can retry.
   *
   * `customerVerified` is required to be TRUE. BRD 24 puts customer
   * verification first in the handover checklist, and a system that lets staff
   * skip it in a hurry is not enforcing it at all.
   */
  async recordPickup(bookingId: string, input: PickupInput, actor: RentalActor) {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { vehicle: true, rental: true },
    });
    if (!booking) throw ApiError.notFound('Booking not found');

    if (booking.rental) {
      throw ApiError.conflict('This booking has already been handed over');
    }

    if (booking.status !== 'READY_FOR_PICKUP' && booking.status !== 'CONFIRMED') {
      throw ApiError.conflict(
        `A ${booking.status.toLowerCase().replace(/_/g, ' ')} booking cannot be handed over. Confirm it first.`,
      );
    }

    if (!input.customerVerified) {
      throw ApiError.badRequest(
        'Confirm you have checked the customer\u2019s identity and licence before handing over the vehicle.',
      );
    }

    /*
     * NO KEYS UNTIL THE MONEY IS IN.
     *
     * A cash booking reaches CONFIRMED without a payment - that is the whole
     * point of the option - so this is the control that keeps it safe. It
     * mirrors what happens at a real counter: the cash is taken, THEN the car
     * is released. Without it, "pay at pickup" would quietly mean "never pay".
     *
     * An online booking is already paid by the time it is CONFIRMED, so this
     * simply passes for them.
     */
    if (booking.paymentMethod === 'CASH_ON_PICKUP') {
      const paid = await prisma.payment.findFirst({
        where: {
          bookingId,
          type: 'RENTAL',
          status: { in: ['SUCCESS', 'REFUNDED', 'PARTIALLY_REFUNDED'] },
        },
        select: { id: true },
      });

      if (!paid) {
        throw ApiError.badRequest(
          'This is a pay-at-pickup booking and the rental is unpaid. Record the cash payment before handing over the vehicle.',
        );
      }
    }

    if (input.mileage < booking.vehicle.currentMileage) {
      // Odometers do not go backwards. Almost always a typo, and one that
      // would make the excess-mileage charge nonsense later.
      throw ApiError.badRequest(
        `Mileage cannot be below the vehicle\u2019s last recorded reading of ${booking.vehicle.currentMileage}km.`,
      );
    }

    const now = new Date();

    const rental = await prisma.$transaction(async (tx) => {
      const created = await tx.rental.create({
        data: {
          bookingId,
          status: 'ACTIVE',
          pickedUpAt: now,
          pickupMileage: input.mileage,
          pickupFuelPercent: input.fuelPercent,
          handedOverById: actor.id,
        },
      });

      await tx.vehicleInspection.create({
        data: {
          rentalId: created.id,
          type: 'PICKUP',
          mileage: input.mileage,
          fuelPercent: input.fuelPercent,
          conditionNotes: input.conditionNotes ?? null,
          damageNotes: input.damageNotes ?? null,
          accessories: (input.accessories ?? []) as Prisma.InputJsonValue,
          customerVerified: true,
          inspectedById: actor.id,
        },
      });

      await tx.booking.update({ where: { id: bookingId }, data: { status: 'ACTIVE' } });

      await tx.bookingStatusHistory.create({
        data: {
          bookingId,
          fromStatus: booking.status,
          toStatus: 'ACTIVE',
          changedById: actor.id,
          reason: 'Vehicle handed over',
        },
      });

      // The car is out. Its own status reflects that, and the odometer moves
      // forward so the next pickup validates against a current figure.
      await tx.vehicle.update({
        where: { id: booking.vehicleId },
        data: { status: 'RENTED', currentMileage: input.mileage },
      });

      return created;
    });

    await auditService.record({
      action: 'rental.pickup',
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      entityType: 'Rental',
      entityId: rental.id,
      metadata: {
        bookingNumber: booking.bookingNumber,
        mileage: input.mileage,
        fuelPercent: input.fuelPercent,
      },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return rentalsService.getByBookingId(bookingId);
  },

  /**
   * Take the vehicle back (BRD 26).
   *
   * Records the return inspection, computes the charges from the DIFFERENCE
   * between the two inspections, and puts the vehicle under inspection rather
   * than straight back on sale - a car that has just come in has not been
   * checked over yet.
   *
   * The charges are recorded but NOT automatically taken from the deposit.
   * Applying money to someone's deposit is a decision a person makes, and the
   * separation is what lets an admin waive a charge without unpicking a
   * ledger entry.
   */
  async recordReturn(bookingId: string, input: ReturnInput, actor: RentalActor) {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { vehicle: true, rental: { include: { inspections: true } } },
    });
    if (!booking) throw ApiError.notFound('Booking not found');
    if (!booking.rental) throw ApiError.conflict('This vehicle has not been handed over yet');

    if (booking.rental.status !== 'ACTIVE') {
      throw ApiError.conflict('This rental has already been returned');
    }

    if (input.mileage < booking.rental.pickupMileage) {
      throw ApiError.badRequest(
        `Return mileage cannot be below the pickup reading of ${booking.rental.pickupMileage}km.`,
      );
    }

    const now = new Date();
    const policy = await loadChargePolicy();

    const { charges, total, warnings } = calculateReturnCharges(
      {
        dueBackAt: booking.returnAt,
        returnedAt: now,
        pickupMileage: booking.rental.pickupMileage,
        returnMileage: input.mileage,
        pickupFuelPercent: booking.rental.pickupFuelPercent,
        returnFuelPercent: input.fuelPercent,
        rentalDays: booking.rentalDays,
        dailyRate: booking.vehicle.dailyPrice,
        mileageLimitPerDay: booking.vehicle.mileageLimitPerDay,
        extraMileageCharge: booking.vehicle.extraMileageCharge,
        needsCleaning: input.needsCleaning ?? false,
      },
      policy,
    );

    await prisma.$transaction(async (tx) => {
      await tx.rental.update({
        where: { id: booking.rental!.id },
        data: {
          status: 'RETURNED',
          returnedAt: now,
          returnMileage: input.mileage,
          returnFuelPercent: input.fuelPercent,
          receivedById: actor.id,
        },
      });

      await tx.vehicleInspection.create({
        data: {
          rentalId: booking.rental!.id,
          type: 'RETURN',
          mileage: input.mileage,
          fuelPercent: input.fuelPercent,
          conditionNotes: input.conditionNotes ?? null,
          // At return this field holds the NEW damage - what was not on the
          // pickup inspection.
          damageNotes: input.damageNotes ?? null,
          cleanliness: input.cleanliness ?? null,
          accessories: (input.missingAccessories ?? []) as Prisma.InputJsonValue,
          inspectedById: actor.id,
        },
      });

      for (const charge of charges) {
        await tx.additionalCharge.create({
          data: {
            bookingId,
            type: charge.type,
            amount: charge.amount,
            currency: booking.currency,
            description: charge.description,
            calculation: charge.calculation as Prisma.InputJsonValue,
            createdById: actor.id,
            status: 'PENDING',
          },
        });
      }

      await tx.booking.update({ where: { id: bookingId }, data: { status: 'RETURNED' } });

      await tx.bookingStatusHistory.create({
        data: {
          bookingId,
          fromStatus: 'ACTIVE',
          toStatus: 'RETURNED',
          changedById: actor.id,
          reason: charges.length > 0 ? `Returned with ${charges.length} charge(s)` : 'Returned',
        },
      });

      // UNDER_INSPECTION, not AVAILABLE. A car that has just come back has not
      // been checked, cleaned or refuelled - putting it straight back on sale
      // is how a customer collects a dirty car with a flat tyre.
      await tx.vehicle.update({
        where: { id: booking.vehicleId },
        data: { status: 'UNDER_INSPECTION', currentMileage: input.mileage },
      });
    });

    await auditService.record({
      action: 'rental.return',
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      entityType: 'Rental',
      entityId: booking.rental.id,
      metadata: {
        bookingNumber: booking.bookingNumber,
        mileage: input.mileage,
        fuelPercent: input.fuelPercent,
        chargeCount: charges.length,
        chargeTotal: total.toFixed(2),
      },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    if (warnings.length > 0) {
      logger.warn('Return charges skipped because policy is unconfigured', { warnings });
    }

    return {
      rental: await rentalsService.getByBookingId(bookingId),
      charges: charges.map((charge) => ({
        type: charge.type,
        amount: charge.amount.toFixed(2),
        description: charge.description,
      })),
      chargeTotal: total.toFixed(2),
      warnings,
    };
  },

  /** The rental, its inspections and any charges raised. */
  async getByBookingId(bookingId: string) {
    const rental = await prisma.rental.findUnique({
      where: { bookingId },
      include: {
        inspections: { include: { photos: true }, orderBy: { createdAt: 'asc' } },
        booking: { select: { bookingNumber: true, returnAt: true, currency: true } },
      },
    });
    if (!rental) return null;

    const charges = await prisma.additionalCharge.findMany({
      where: { bookingId },
      orderBy: { createdAt: 'asc' },
    });

    return {
      id: rental.id,
      bookingId: rental.bookingId,
      bookingNumber: rental.booking.bookingNumber,
      status: rental.status,
      pickedUpAt: rental.pickedUpAt.toISOString(),
      returnedAt: rental.returnedAt?.toISOString() ?? null,
      dueBackAt: rental.booking.returnAt.toISOString(),
      pickupMileage: rental.pickupMileage,
      returnMileage: rental.returnMileage,
      pickupFuelPercent: rental.pickupFuelPercent,
      returnFuelPercent: rental.returnFuelPercent,
      distanceDriven:
        rental.returnMileage === null ? null : rental.returnMileage - rental.pickupMileage,
      inspections: rental.inspections.map((inspection) => ({
        id: inspection.id,
        type: inspection.type,
        mileage: inspection.mileage,
        fuelPercent: inspection.fuelPercent,
        conditionNotes: inspection.conditionNotes,
        damageNotes: inspection.damageNotes,
        cleanliness: inspection.cleanliness,
        accessories: inspection.accessories,
        customerVerified: inspection.customerVerified,
        createdAt: inspection.createdAt.toISOString(),
        photos: inspection.photos.map((photo) => ({
          id: photo.id,
          type: photo.type,
          caption: photo.caption,
          // Public: pictures of a car, not of anybody's identity documents.
          url: `/uploads/${photo.storageKey.replace(/^public\//, '')}`,
        })),
      })),
      charges: charges.map((charge) => ({
        id: charge.id,
        type: charge.type,
        status: charge.status,
        amount: charge.amount.toFixed(2),
        currency: charge.currency,
        description: charge.description,
        calculation: charge.calculation,
      })),
      chargeTotal: charges
        .filter((charge) => charge.status !== 'WAIVED')
        .reduce((sum, charge) => sum.add(charge.amount), new Prisma.Decimal(0))
        .toFixed(2),
    };
  },

  /**
   * Settle a charge against the security deposit (BRD 20).
   *
   * An explicit action, not something the return does automatically. Taking
   * money from a deposit is a decision, and the separation lets an admin waive
   * a charge without unpicking a ledger entry.
   */
  async settleChargeFromDeposit(chargeId: string, actor: RentalActor) {
    const charge = await prisma.additionalCharge.findUnique({
      where: { id: chargeId },
      include: { booking: { select: { id: true, bookingNumber: true } } },
    });
    if (!charge) throw ApiError.notFound('Charge not found');

    if (charge.status !== 'PENDING') {
      throw ApiError.conflict(`This charge is already ${charge.status.toLowerCase()}`);
    }

    // Imported here rather than at the top to keep the module graph acyclic
    // and obvious - this is the only place rentals reaches into deposits.
    const { depositsService } = await import('../deposits/service');

    const categoryFor: Record<string, 'DAMAGE' | 'FUEL' | 'CLEANING' | 'LATE_RETURN' | 'OTHER'> = {
      LATE_RETURN: 'LATE_RETURN',
      EXCESS_MILEAGE: 'OTHER',
      FUEL: 'FUEL',
      CLEANING: 'CLEANING',
      DAMAGE: 'DAMAGE',
      OTHER: 'OTHER',
    };

    await depositsService.deduct(
      charge.booking.id,
      {
        amount: charge.amount.toFixed(2),
        category: categoryFor[charge.type] ?? 'OTHER',
        reason: charge.description,
      },
      actor,
    );

    await prisma.additionalCharge.update({
      where: { id: chargeId },
      data: { status: 'SETTLED_FROM_DEPOSIT' },
    });

    await auditService.record({
      action: 'charge.settled_from_deposit',
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      entityType: 'AdditionalCharge',
      entityId: chargeId,
      metadata: {
        bookingNumber: charge.booking.bookingNumber,
        amount: charge.amount.toFixed(2),
        type: charge.type,
      },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return rentalsService.getByBookingId(charge.booking.id);
  },

  /** Write off a charge. Always with a reason. */
  async waiveCharge(chargeId: string, reason: string, actor: RentalActor) {
    const charge = await prisma.additionalCharge.findUnique({
      where: { id: chargeId },
      include: { booking: { select: { id: true, bookingNumber: true } } },
    });
    if (!charge) throw ApiError.notFound('Charge not found');

    if (charge.status !== 'PENDING') {
      throw ApiError.conflict(`This charge is already ${charge.status.toLowerCase()}`);
    }

    await prisma.additionalCharge.update({
      where: { id: chargeId },
      data: { status: 'WAIVED', description: `${charge.description} (waived: ${reason})` },
    });

    await auditService.record({
      action: 'charge.waived',
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      entityType: 'AdditionalCharge',
      entityId: chargeId,
      metadata: {
        bookingNumber: charge.booking.bookingNumber,
        amount: charge.amount.toFixed(2),
        reason,
      },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return rentalsService.getByBookingId(charge.booking.id);
  },

  /**
   * Close the rental once the vehicle has been checked over: the car goes
   * back on sale and the booking completes.
   */
  async closeRental(bookingId: string, actor: RentalActor) {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { rental: true },
    });
    if (!booking?.rental) throw ApiError.notFound('Rental not found');

    if (booking.rental.status !== 'RETURNED') {
      throw ApiError.conflict('This rental is not awaiting closure');
    }

    await prisma.$transaction(async (tx) => {
      await tx.rental.update({ where: { id: booking.rental!.id }, data: { status: 'CLOSED' } });
      await tx.booking.update({ where: { id: bookingId }, data: { status: 'COMPLETED' } });

      await tx.bookingStatusHistory.create({
        data: {
          bookingId,
          fromStatus: 'RETURNED',
          toStatus: 'COMPLETED',
          changedById: actor.id,
          reason: 'Inspection complete, vehicle back in service',
        },
      });

      await tx.vehicle.update({ where: { id: booking.vehicleId }, data: { status: 'AVAILABLE' } });
    });

    await auditService.record({
      action: 'rental.closed',
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      entityType: 'Rental',
      entityId: booking.rental.id,
      metadata: { bookingNumber: booking.bookingNumber },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return rentalsService.getByBookingId(bookingId);
  },
};
