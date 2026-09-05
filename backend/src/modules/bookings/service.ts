/**
 * modules/bookings/service.ts
 * ---------------------------------------------------------------------------
 * Booking creation and lifecycle. The module everything else was built for.
 *
 * ===========================================================================
 * WHAT THE CLIENT SENDS, AND WHAT IT DOES NOT
 * ===========================================================================
 * The checkout page sends the CHOICE: vehicle, dates, locations, services,
 * notes. It does not send a price, and if it does the validation middleware
 * strips it. Every amount stored on the booking is recomputed here from the
 * pricing engine. A total under the client's control is not a price.
 *
 * ===========================================================================
 * WHY A SERIALIZABLE TRANSACTION
 * ===========================================================================
 * Creating a booking is: check availability -> compute price -> insert. Under
 * READ COMMITTED, two requests for the last free car can both pass the check
 * before either inserts.
 *
 * Three defences, in order of how much they can be trusted:
 *   1. the availability check here          - catches the ordinary case
 *   2. SERIALIZABLE isolation               - makes the read-write atomic
 *   3. the PostgreSQL exclusion constraint  - cannot be beaten, ever
 *
 * Layer 3 is the one that matters, and this service's job is to turn its raw
 * error into a clean 409 the frontend can act on rather than a 500.
 */
import { Prisma } from '@prisma/client';
import type { BookingStatus } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { logger } from '../../config/logger';
import { ApiError, ErrorCode } from '../../utils/ApiError';
import { auditService } from '../audit/service';
import { availabilityService, blockingBookingsWhere } from '../availability/service';
import { pricingService } from '../pricing/service';
import { SettingKey, settingsService } from '../settings/service';
import { customersService } from '../customers/service';
import { canTransition, CUSTOMER_CANCELLABLE, PRE_PICKUP } from './statusMachine';
import { couponsService } from '../coupons/service';
import { legalService } from '../legal/service';
import { fireAndForget, notify } from '../notifications/triggers';
import { generateBookingNumber } from './reference';
import { bookingInclude, toPublicBooking, type PublicBooking } from './types';
import type { CreateBookingInput } from './validation';

export interface BookingActor {
  id: string;
  email: string;
  role: 'CUSTOMER' | 'ADMIN' | 'STAFF';
  ipAddress?: string;
  userAgent?: string;
}

/**
 * PostgreSQL raises 40001 when a SERIALIZABLE transaction is aborted because
 * another one it depended on committed first.
 *
 * This is not a fault: it is the isolation level doing its job, and the
 * documented response is to run the transaction again. Booking creation reads
 * a handful of shared rows - the published terms, a coupon - so two customers
 * checking out at the same instant can trip it even when they want different
 * cars.
 *
 * Retried rather than reported. If the two really did want the same vehicle,
 * the retry re-runs the availability check, finds the now-committed booking,
 * and returns a clean 409 saying so.
 */
function isSerializationFailure(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === 'P2034' ||
      error.meta?.code === '40001' ||
      String(error.message).includes('could not serialize access'))
  );
}

/** PostgreSQL raises 23P01 when an exclusion constraint rejects a row. */
function isOverlapViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.meta?.code === '23P01' ||
      String(error.meta?.constraint ?? '').includes('no_overlapping_rental') ||
      String(error.message).includes('bookings_no_overlapping_rental'))
  );
}

async function recordStatusChange(
  tx: Prisma.TransactionClient,
  bookingId: string,
  fromStatus: BookingStatus | null,
  toStatus: BookingStatus,
  changedById: string | null,
  reason?: string,
): Promise<void> {
  await tx.bookingStatusHistory.create({
    data: { bookingId, fromStatus, toStatus, changedById, reason: reason ?? null },
  });
}

export const bookingsService = {
  /**
   * Create a booking.
   *
   * The customer's documents decide the starting status, per BRD 3: verified
   * customers go straight to payment, everyone else waits on verification.
   */
  async create(input: CreateBookingInput, actor: BookingActor): Promise<PublicBooking> {
    const period = { pickupAt: input.pickupAt, returnAt: input.returnAt };

    // Cheap pre-checks OUTSIDE the transaction. A serializable transaction
    // holds locks, so anything that can fail early should fail before it opens.
    await availabilityService.assertVehicleAvailable(input.vehicleId, period);

    const quote = await pricingService.quote({
      vehicleId: input.vehicleId,
      pickupAt: input.pickupAt,
      returnAt: input.returnAt,
      services: input.services,
      pickupLocationId: input.pickupLocationId,
      dropoffLocationId: input.dropoffLocationId,
      couponCode: input.couponCode,
      // The REAL customer this time, not the anonymous placeholder a public
      // quote uses - so a per-customer usage limit is enforced here, at the
      // point a use is actually consumed.
      customerId: actor.id,
    });

    const customer = await customersService.getOrCreateForUser(actor.id);
    const verification = await customersService.getVerificationSummary(customer.id);

    // BRD 3: documents are verified BEFORE payment.
    const initialStatus: BookingStatus = verification.isVerified
      ? 'PAYMENT_PENDING'
      : 'DOCUMENT_VERIFICATION';

    const holdMinutes = await settingsService.getNumberOr(SettingKey.BOOKING_HOLD_MINUTES, 30);
    const bufferHours = await settingsService.getNumberOr(SettingKey.TURNAROUND_BUFFER_HOURS, 0);

    try {
      const booking = await withSerializableRetry(() =>
        prisma.$transaction(
        async (tx) => {
          // Re-check INSIDE the transaction. The pre-check above happened
          // before we held any locks; the world may have changed since.
          const conflicts = await tx.booking.count({
            where: { vehicleId: input.vehicleId, ...blockingBookingsWhere(period, bufferHours) },
          });
          if (conflicts > 0) {
            throw new ApiError(
              409,
              'This vehicle was just booked for those dates. Please choose different dates.',
              ErrorCode.VEHICLE_UNAVAILABLE,
            );
          }

          const created = await tx.booking.create({
            data: {
              bookingNumber: await generateBookingNumber(tx),
              vehicleId: input.vehicleId,
              customerId: actor.id,
              pickupLocationId: input.pickupLocationId ?? null,
              dropoffLocationId: input.dropoffLocationId ?? null,
              pickupAt: input.pickupAt,
              returnAt: input.returnAt,
              status: initialStatus,
              // The hold is what stops an abandoned checkout taking a car off
              // sale indefinitely.
              holdExpiresAt: new Date(Date.now() + holdMinutes * 60_000),

              // --- Price snapshot, straight from the engine ---------------
              rentalDays: quote.period.rentalDays,
              vehicleSubtotal: new Prisma.Decimal(quote.totals.vehicleSubtotal),
              servicesSubtotal: new Prisma.Decimal(quote.totals.servicesSubtotal),
              deliveryFee: new Prisma.Decimal(quote.totals.deliveryFee),
              discountAmount: new Prisma.Decimal(quote.totals.discountAmount),
              couponCode: quote.coupon?.code ?? null,
              taxAmount: new Prisma.Decimal(quote.totals.taxAmount),
              totalAmount: new Prisma.Decimal(quote.totals.rentalTotal),
              securityDeposit: new Prisma.Decimal(quote.totals.securityDeposit),
              currency: quote.currency,

              customerNotes: input.customerNotes ?? null,
            },
          });

          // Copy each chosen service with the price charged TODAY.
          if (input.services && input.services.length > 0) {
            const services = await tx.additionalService.findMany({
              where: { id: { in: input.services.map((s) => s.serviceId) } },
            });

            for (const selected of input.services) {
              const service = services.find((s) => s.id === selected.serviceId);
              if (!service) continue;

              const units = service.chargeType === 'PER_DAY' ? quote.period.rentalDays : 1;

              await tx.bookingService.create({
                data: {
                  bookingId: created.id,
                  serviceId: service.id,
                  name: service.name,
                  quantity: selected.quantity,
                  unitPrice: service.price,
                  chargeType: service.chargeType,
                  lineTotal: service.price.mul(selected.quantity).mul(units),
                },
              });
            }
          }

          // Consume the code INSIDE the transaction. If anything after this
          // throws, the redemption rolls back with the booking - a code must
          // never be burnt by a booking that did not happen.
          if (quote.coupon) {
            const applied = await tx.coupon.findUniqueOrThrow({
              where: { code: quote.coupon.code },
            });
            await couponsService.redeem(tx, {
              couponId: applied.id,
              bookingId: created.id,
              customerId: actor.id,
              discountAmount: new Prisma.Decimal(quote.coupon.discountAmount),
              codeUsed: quote.coupon.code,
            });
          }

          // Pin which version of the terms was live at this moment. In a
          // dispute the question is "what did the terms say on the day they
          // booked?", and this row is the answer.
          await legalService.recordAgreement(tx, created.id, actor.ipAddress);

          await recordStatusChange(tx, created.id, null, initialStatus, actor.id, 'Booking created');

          return tx.booking.findUniqueOrThrow({
            where: { id: created.id },
            include: bookingInclude,
          });
        },
        {
          // The strongest isolation PostgreSQL offers. Combined with the
          // exclusion constraint, a double booking is not reachable.
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 15_000,
        },
        ),
      );

      fireAndForget(notify.bookingCreated(booking.id, initialStatus === 'DOCUMENT_VERIFICATION'));

      await auditService.record({
        action: 'booking.created',
        actorId: actor.id,
        actorEmail: actor.email,
        actorRole: actor.role,
        entityType: 'Booking',
        entityId: booking.id,
        metadata: {
          bookingNumber: booking.bookingNumber,
          vehicleId: input.vehicleId,
          total: quote.totals.rentalTotal,
          status: initialStatus,
        },
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });

      return toPublicBooking(booking);
    } catch (error) {
      // The database refused an overlap. Translate it into the same clean 409
      // a customer would have got from the ordinary check - not a 500.
      if (isOverlapViolation(error)) {
        logger.warn('Exclusion constraint prevented a double booking', {
          vehicleId: input.vehicleId,
        });
        throw new ApiError(
          409,
          'This vehicle was just booked for those dates. Please choose different dates.',
          ErrorCode.VEHICLE_UNAVAILABLE,
        );
      }
      throw error;
    }
  },

  /**
   * Move a booking to a new status.
   *
   * Every transition goes through here, so the machine is checked once rather
   * than re-implemented per endpoint, and the history row is never forgotten.
   */
  async changeStatus(
    bookingId: string,
    toStatus: BookingStatus,
    actor: BookingActor,
    reason?: string,
  ): Promise<PublicBooking> {
    const existing = await prisma.booking.findUnique({ where: { id: bookingId } });
    if (!existing) throw ApiError.notFound('Booking not found');

    if (existing.status === toStatus) {
      throw ApiError.badRequest(`This booking is already ${toStatus.toLowerCase().replace(/_/g, ' ')}`);
    }

    if (!canTransition(existing.status, toStatus)) {
      throw ApiError.conflict(
        `A ${existing.status.toLowerCase().replace(/_/g, ' ')} booking cannot become ${toStatus
          .toLowerCase()
          .replace(/_/g, ' ')}`,
      );
    }

    const booking = await prisma.$transaction(async (tx) => {
      const updated = await tx.booking.update({
        where: { id: bookingId },
        data: {
          status: toStatus,
          // Once past payment the hold is irrelevant: the booking is firm.
          ...(toStatus === 'CONFIRMED' ? { holdExpiresAt: null } : {}),
        },
      });

      await recordStatusChange(tx, bookingId, existing.status, toStatus, actor.id, reason);

      return tx.booking.findUniqueOrThrow({ where: { id: updated.id }, include: bookingInclude });
    });

    await auditService.record({
      action: 'booking.status_changed',
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      entityType: 'Booking',
      entityId: bookingId,
      metadata: { from: existing.status, to: toStatus, ...(reason ? { reason } : {}) },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return toPublicBooking(booking);
  },

  /**
   * Cancel a booking and work out what is owed back (BRD 31).
   *
   * The fee comes from settings and is FROZEN onto the booking. Recomputing it
   * later from the live policy would silently rewrite what a customer was told
   * at the moment they cancelled.
   *
   * `cancellation.free_window_hours` and `cancellation.fee_percentage` both
   * seed empty. Unset means NO fee - refusing to invent a cancellation charge
   * is the same rule as refusing to invent a VAT rate.
   */
  async cancel(
    bookingId: string,
    reason: string | undefined,
    actor: BookingActor,
  ): Promise<PublicBooking> {
    const existing = await prisma.booking.findUnique({ where: { id: bookingId } });
    if (!existing) throw ApiError.notFound('Booking not found');

    const isCustomer = actor.role === 'CUSTOMER';

    if (isCustomer && existing.customerId !== actor.id) {
      // Same reasoning as documents: 404, not 403 - do not confirm it exists.
      throw ApiError.notFound('Booking not found');
    }

    if (isCustomer && !CUSTOMER_CANCELLABLE.includes(existing.status)) {
      throw ApiError.conflict(
        'This booking can no longer be cancelled online. Please contact support.',
      );
    }

    if (!canTransition(existing.status, 'CANCELLED')) {
      throw ApiError.conflict(
        existing.status === 'ACTIVE'
          ? 'This rental is already under way. The vehicle must be returned rather than cancelled.'
          : `A ${existing.status.toLowerCase().replace(/_/g, ' ')} booking cannot be cancelled`,
      );
    }

    const hoursUntilPickup = (existing.pickupAt.getTime() - Date.now()) / (60 * 60 * 1000);

    const freeWindowHours = await settingsService.getNumber(
      SettingKey.CANCELLATION_FREE_WINDOW_HOURS,
    );
    const feePercentage = await settingsService.getNumber(SettingKey.CANCELLATION_FEE_PERCENTAGE);

    let cancellationFee = new Prisma.Decimal(0);
    const policyNotes: string[] = [];

    if (freeWindowHours === null || feePercentage === null) {
      policyNotes.push(
        'No cancellation policy is configured, so no fee has been charged. Set cancellation.free_window_hours and cancellation.fee_percentage in Settings.',
      );
    } else if (hoursUntilPickup < freeWindowHours) {
      // Inside the window: the configured percentage of the rental total.
      // Never of the deposit, which is refundable by definition.
      cancellationFee = existing.totalAmount
        .mul(feePercentage)
        .div(100)
        .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      policyNotes.push(
        `Cancelled ${Math.max(0, Math.round(hoursUntilPickup))}h before pickup, inside the ${freeWindowHours}h free window: ${feePercentage}% fee applied.`,
      );
    } else {
      policyNotes.push(`Cancelled outside the ${freeWindowHours}h window: no fee.`);
    }

    // Nothing has been captured until Phase 7, so this is what WILL be owed
    // once payments exist. Recorded now so the figure is not re-derived later.
    const refundDue = existing.totalAmount.sub(cancellationFee);

    const booking = await prisma.$transaction(async (tx) => {
      await tx.booking.update({
        where: { id: bookingId },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancelledById: actor.id,
          cancellationReason: reason?.trim() ?? null,
          cancellationFee,
          refundDueAmount: refundDue.isNegative() ? new Prisma.Decimal(0) : refundDue,
          holdExpiresAt: null,
        },
      });

      // Give the promo code back. Without this a customer who cancels has
      // silently burnt a single-use code they got no benefit from, and the
      // "fully redeemed" message they hit next time would be wrong.
      await couponsService.release(tx, bookingId);

      await recordStatusChange(
        tx,
        bookingId,
        existing.status,
        'CANCELLED',
        actor.id,
        [reason?.trim(), ...policyNotes].filter(Boolean).join(' | '),
      );

      return tx.booking.findUniqueOrThrow({ where: { id: bookingId }, include: bookingInclude });
    });

    fireAndForget(
      notify.bookingCancelled(
        bookingId,
        `${existing.currency} ${cancellationFee.toFixed(2)}`,
        `${existing.currency} ${(refundDue.isNegative() ? new Prisma.Decimal(0) : refundDue).toFixed(2)}`,
      ),
    );

    await auditService.record({
      action: 'booking.cancelled',
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      entityType: 'Booking',
      entityId: bookingId,
      metadata: {
        bookingNumber: existing.bookingNumber,
        hoursBeforePickup: Math.round(hoursUntilPickup),
        cancellationFee: cancellationFee.toFixed(2),
        refundDue: refundDue.toFixed(2),
      },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return toPublicBooking(booking);
  },

  /** One booking. Customers may only reach their own. */
  async getById(bookingId: string, actor: BookingActor): Promise<PublicBooking> {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: bookingInclude,
    });

    const isBackOffice = actor.role === 'ADMIN' || actor.role === 'STAFF';
    if (!booking || (!isBackOffice && booking.customerId !== actor.id)) {
      throw ApiError.notFound('Booking not found');
    }

    return toPublicBooking(booking, isBackOffice);
  },

  /** The signed-in customer's own bookings (BRD 22 "My Bookings"). */
  async listForCustomer(
    customerId: string,
    query: { page: number; limit: number; scope?: string },
  ) {
    // The BRD's own grouping: upcoming, active, previous, cancelled.
    const scopeFilter: Record<string, Prisma.BookingWhereInput> = {
      upcoming: { status: { in: PRE_PICKUP } },
      active: { status: { in: ['ACTIVE', 'EXTENSION_REQUESTED', 'RETURN_PENDING'] } },
      previous: { status: { in: ['RETURNED', 'COMPLETED'] } },
      cancelled: { status: 'CANCELLED' },
    };

    const where: Prisma.BookingWhereInput = {
      customerId,
      ...(query.scope && scopeFilter[query.scope] ? scopeFilter[query.scope] : {}),
    };

    const [items, total] = await prisma.$transaction([
      prisma.booking.findMany({
        where,
        include: bookingInclude,
        orderBy: { pickupAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      prisma.booking.count({ where }),
    ]);

    return { items: items.map((booking) => toPublicBooking(booking)), total };
  },

  /** Admin and staff listing (BRD 27). */
  async list(query: {
    page: number;
    limit: number;
    status?: BookingStatus;
    vehicleId?: string;
    search?: string;
    from?: Date;
    to?: Date;
    dateField?: 'pickup' | 'return';
  }) {
    // The pickups board asks "what goes out today", the returns board asks
    // "what comes back today". Same rows, different timestamp.
    const dateColumn = query.dateField === 'return' ? 'returnAt' : 'pickupAt';

    const where: Prisma.BookingWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.vehicleId ? { vehicleId: query.vehicleId } : {}),
      ...(query.from || query.to
        ? {
            [dateColumn]: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lte: query.to } : {}),
            },
          }
        : {}),
      ...(query.search
        ? {
            OR: [
              { bookingNumber: { contains: query.search, mode: 'insensitive' } },
              { customer: { fullName: { contains: query.search, mode: 'insensitive' } } },
              { customer: { email: { contains: query.search, mode: 'insensitive' } } },
              { vehicle: { registrationNumber: { contains: query.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const [items, total] = await prisma.$transaction([
      prisma.booking.findMany({
        where,
        include: bookingInclude,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      prisma.booking.count({ where }),
    ]);

    return { items: items.map((booking) => toPublicBooking(booking, true)), total };
  },

  /**
   * Release bookings whose unpaid hold has lapsed.
   *
   * Without this an abandoned checkout keeps a vehicle off sale forever. Phase
   * 10 runs it on a schedule; it lives here so the rule has one home.
   *
   * Deliberately CANCELLED rather than deleted - the customer may ring up
   * asking what happened to their booking, and "it expired at 14:32" is a
   * better answer than a missing row.
   */
  async releaseExpiredHolds(now: Date = new Date()): Promise<number> {
    const expired = await prisma.booking.findMany({
      where: { status: 'PENDING', holdExpiresAt: { lt: now } },
      select: { id: true, status: true, bookingNumber: true },
    });

    if (expired.length === 0) return 0;

    await prisma.$transaction(async (tx) => {
      for (const booking of expired) {
        await tx.booking.update({
          where: { id: booking.id },
          data: {
            status: 'CANCELLED',
            cancelledAt: now,
            cancellationReason: 'Payment not completed within the hold period',
            holdExpiresAt: null,
          },
        });
        // No actor: this is the system, not a person.
        await recordStatusChange(tx, booking.id, booking.status, 'CANCELLED', null, 'Hold expired');
      }
    });

    logger.info('Released expired booking holds', { count: expired.length });
    return expired.length;
  },
};

/**
 * Run a serializable transaction, retrying if PostgreSQL aborts it for
 * serialization reasons.
 *
 * Three attempts with a short jittered pause. Jittered because two clients
 * that collided once will collide again if they both retry on the same
 * schedule - the whole point is to separate them in time.
 *
 * If it still fails, the error propagates: at that point something other than
 * ordinary contention is happening, and pretending otherwise would hide it.
 */
async function withSerializableRetry<T>(run: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (!isSerializationFailure(error) || attempt === attempts) throw error;

      lastError = error;
      logger.warn('Serialization conflict, retrying the booking transaction', { attempt });
      await new Promise((resolve) => setTimeout(resolve, 25 * attempt + Math.random() * 25));
    }
  }

  throw lastError;
}
