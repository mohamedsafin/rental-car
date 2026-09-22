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
import type { BookingStatus, Role, VehicleStatus } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { logger } from '../../config/logger';
import { ApiError, ErrorCode } from '../../utils/ApiError';
import { auditService } from '../audit/service';
import { availabilityService, blockingBookingsWhere } from '../availability/service';
import { pricingService } from '../pricing/service';
import { SettingKey, settingsService } from '../settings/service';
import { customersService } from '../customers/service';
import { canTransition, CUSTOMER_CANCELLABLE, PRE_PICKUP, TERMINAL } from './statusMachine';
import { couponsService } from '../coupons/service';
import { legalService } from '../legal/service';
import { fireAndForget, notify } from '../notifications/triggers';
import { generateBookingNumber } from './reference';
import { buildInstalmentPlan, monthsBetween } from './instalments';
import { bookingInclude, toPublicBooking, type PublicBooking } from './types';
import type { CreateBookingInput } from './validation';
import { isBackOffice } from '../../modules/auth/roles';

export interface BookingActor {
  id: string;
  email: string;
  role: Role;
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
      (typeof error.meta?.constraint === 'string' &&
        error.meta.constraint.includes('no_overlapping_rental')) ||
      String(error.message).includes('bookings_no_overlapping_rental'))
  );
}

/**
 * Whole years between two dates, the way an age is counted - the birthday has
 * to have happened. Naive year subtraction makes someone 25 on 1 January of
 * the year they turn 25, which for a rental age rule is months too early.
 */
function yearsBetween(from: Date, to: Date): number {
  let years = to.getUTCFullYear() - from.getUTCFullYear();
  const monthDelta = to.getUTCMonth() - from.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && to.getUTCDate() < from.getUTCDate())) years -= 1;
  return years;
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

    /*
     * WHO THE BOOKING IS FOR, WHICH IS NOT ALWAYS WHO IS ASKING.
     * =======================================================================
     * Most of this business walks in off the street. Until now the only
     * bookable customer was the signed-in one, so a member of staff at the
     * counter had no way to book for the person in front of them - they either
     * borrowed the customer's phone or created the booking under their own
     * account, which puts the company's own staff on the rental agreement.
     *
     * So staff may name a customer. A CUSTOMER never can: `customerId` is read
     * from the token for them and the field in the request is ignored, because
     * honouring it would let anyone book in somebody else's name.
     */
    const namedByStaff = actor.role !== 'CUSTOMER' && Boolean(input.customerId);
    const bookingForId = namedByStaff ? input.customerId! : actor.id;
    const onBehalf = bookingForId !== actor.id;

    /*
     * Checked whenever staff NAMED somebody, not only when that somebody is
     * different from them.
     *
     * The first version only validated a customerId that differed from the
     * caller's, so a member of staff passing their OWN id sailed through and
     * created a booking owned by a staff account - a rental with no customer,
     * which then has no documents to verify, no agreement to sign and nobody
     * to invoice. The rule is about the TARGET being a real, active customer;
     * who asked is beside the point.
     */
    if (namedByStaff) {
      const target = await prisma.user.findUnique({
        where: { id: bookingForId },
        select: { role: true, status: true, deletedAt: true, fullName: true },
      });
      if (!target || target.deletedAt || target.role !== 'CUSTOMER') {
        throw ApiError.badRequest(
          target && target.role !== 'CUSTOMER'
            ? 'That account is a member of staff, not a customer. A booking needs a customer to belong to.'
            : 'That customer does not exist. Search for them, or create them first.',
        );
      }
      if (target.status !== 'ACTIVE') {
        throw ApiError.badRequest(
          `${target.fullName}'s account is ${target.status.toLowerCase()}. Reactivate it before booking.`,
        );
      }
    }

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
      customerId: bookingForId,
    });

    const customer = await customersService.getOrCreateForUser(bookingForId);
    /*
     * Checked against the RETURN date, not today.
     *
     * A licence valid this morning but expiring mid-rental must not pass:
     * the customer would be driving unlicensed for the back half of the
     * booking, which is exactly the situation an insurer refuses to cover.
     */
    const verification = await customersService.getVerificationSummary(
      customer.id,
      input.returnAt,
    );

    /*
     * Minimum rental age (BRD 51).
     *
     * The setting has existed since the beginning and was read by nothing, so
     * a client who set it to 25 still had 19-year-olds booking. It seeds
     * BLANK, so turning it on is a deliberate act - and a rule the client has
     * deliberately turned on should be enforced, not advisory.
     *
     * Measured at PICKUP, not today: what matters is their age when they are
     * handed the keys. A birthday between booking and collection counts.
     *
     * With the rule on and no date of birth recorded we refuse rather than
     * wave them through, because the alternative is an unverifiable customer
     * driving away under a policy the insurer will test later. The message
     * says exactly what to do about it.
     */
    const minimumAge = await settingsService.getNumber(SettingKey.MINIMUM_RENTAL_AGE);
    if (minimumAge !== null && minimumAge > 0) {
      if (!customer.dateOfBirth) {
        throw ApiError.badRequest(
          onBehalf
            ? `This customer's date of birth is not on file, and drivers must be at least ${minimumAge}. Add it to their profile first.`
            : `We need your date of birth before you can book - drivers must be at least ${minimumAge}. Add it to your profile and try again.`,
        );
      }

      // The customer service returns the public shape, where the date is an
      // ISO day string rather than a Date.
      const ageAtPickup = yearsBetween(new Date(customer.dateOfBirth), input.pickupAt);
      if (ageAtPickup < minimumAge) {
        throw ApiError.badRequest(
          onBehalf
            ? `Drivers must be at least ${minimumAge} on the pickup date. This customer would be ${ageAtPickup}.`
            : `Drivers must be at least ${minimumAge} on the pickup date. This booking would start when you are ${ageAtPickup}.`,
        );
      }
    }

    /*
     * Cash on pickup, if the client allows it.
     *
     * Checked HERE rather than trusted from the request: the option appearing
     * in a browser does not make it available, and a booking that reserves a
     * car without money is exactly the request worth re-deciding server-side.
     */
    const cashAllowed = await settingsService.getBoolean(SettingKey.ALLOW_CASH_ON_PICKUP);
    const wantsCash = input.paymentMethod === 'CASH_ON_PICKUP';

    if (wantsCash && cashAllowed !== true) {
      throw ApiError.badRequest('Paying at pickup is not available. Please pay online to confirm.');
    }

    /*
     * BRD 3: documents are verified BEFORE payment, whichever way they pay.
     *
     * Confirmation now means "your documents passed and the car is yours to
     * collect", not "you have paid" - so a customer whose documents are
     * already on file is CONFIRMED immediately regardless of how they intend
     * to pay. Payment is the next step, not the price of admission.
     *
     * What stops that being a free car: an online booking cannot reach
     * READY_FOR_PICKUP without a cleared payment (see `changeStatus`), and
     * nothing is handed over without one (see the rental service).
     */
    const initialStatus: BookingStatus = verification.isVerified
      ? 'CONFIRMED'
      : 'DOCUMENT_VERIFICATION';

    /*
     * WHY verification failed, in words the customer can act on.
     *
     * The common case since documents began being checked against the RETURN
     * date is the confusing one: every document is approved, the account page
     * says "verified", and the booking still lands in document verification -
     * because something expires partway through the rental. Told only
     * "upload anything still outstanding", the customer looks at a folder of
     * approved documents and reasonably concludes the site is broken.
     *
     * So name the document and the date. A reason nobody can act on is not a
     * reason.
     */
    const expiringSoon = verification.requirements.filter(
      (requirement) =>
        requirement.required &&
        requirement.status === 'APPROVED' &&
        requirement.expiryDate !== null &&
        new Date(requirement.expiryDate) < input.returnAt,
    );

    const verificationReason = verification.isVerified
      ? 'Booking created'
      : expiringSoon.length > 0
        ? `Booking created. ${expiringSoon
            .map((requirement) => `${requirement.label} expires ${requirement.expiryDate}`)
            .join('; ')} - before this rental ends on ${input.returnAt
            .toISOString()
            .slice(0, 10)}. A renewed copy is needed before it can be confirmed.`
        : 'Booking created. Awaiting document verification.';

    /*
     * How many whole months the term runs to.
     *
     * Derived from the dates rather than taken from the request, so the
     * schedule can never disagree with the booking it belongs to. Rounded up:
     * a 45-day rental is two months, because the car is off the fleet for a
     * second month whether or not it is used for all of it.
     */
    const termMonths =
      input.billingCycle === 'MONTHLY' ? monthsBetween(input.pickupAt, input.returnAt) : 0;

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
              customerId: bookingForId,
              pickupLocationId: input.pickupLocationId ?? null,
              dropoffLocationId: input.dropoffLocationId ?? null,
              pickupAt: input.pickupAt,
              returnAt: input.returnAt,
              status: initialStatus,
              // The hold is what stops an abandoned checkout taking a car off
              // sale indefinitely. It runs until the money clears, which now
              // outlasts confirmation: a CONFIRMED online booking is still
              // unpaid, and without a hold it would reserve a car forever.
              //
              // A cash booking never has one - it is not awaiting checkout,
              // and a no-show is handled by cancelling it deliberately rather
              // than by a timer nobody saw.
              holdExpiresAt: wantsCash ? null : new Date(Date.now() + holdMinutes * 60_000),

              // --- Price snapshot, straight from the engine ---------------
              rentalDays: quote.period.rentalDays,
              vehicleSubtotal: new Prisma.Decimal(quote.totals.vehicleSubtotal),
              servicesSubtotal: new Prisma.Decimal(quote.totals.servicesSubtotal),
              deliveryFee: new Prisma.Decimal(quote.totals.deliveryFee),
              discountAmount: new Prisma.Decimal(quote.totals.discountAmount),
              couponCode: quote.coupon?.code ?? null,
              paymentMethod: wantsCash ? 'CASH_ON_PICKUP' : 'ONLINE',
              taxAmount: new Prisma.Decimal(quote.totals.taxAmount),
              totalAmount: new Prisma.Decimal(quote.totals.rentalTotal),
              securityDeposit: new Prisma.Decimal(quote.totals.securityDeposit),
              currency: quote.currency,
              billingCycle: input.billingCycle,
              termMonths: input.billingCycle === 'MONTHLY' ? termMonths : null,

              customerNotes: input.customerNotes ?? null,
              // Staff-written, so only honoured when staff wrote it.
              staffNotes: actor.role !== 'CUSTOMER' ? (input.staffNotes ?? null) : null,
            },
          });

          /*
           * The monthly payment schedule, written with the booking.
           *
           * Generated in full rather than a month at a time: the customer sees
           * every date and amount before committing, and each row is a
           * snapshot, so a rate rise in month three cannot reach back into a
           * month already agreed.
           */
          if (input.billingCycle === 'MONTHLY') {
            const plan = buildInstalmentPlan({
              pickupAt: input.pickupAt,
              returnAt: input.returnAt,
              months: termMonths,
              total: new Prisma.Decimal(quote.totals.rentalTotal),
              subtotal: new Prisma.Decimal(quote.totals.taxableAmount),
              tax: new Prisma.Decimal(quote.totals.taxAmount),
            });

            await tx.rentalInstalment.createMany({
              data: plan.map((row) => ({
                bookingId: created.id,
                sequence: row.sequence,
                periodStart: row.periodStart,
                periodEnd: row.periodEnd,
                dueAt: row.dueAt,
                amount: row.amount,
                subtotal: row.subtotal,
                taxAmount: row.taxAmount,
                currency: quote.currency,
                // The first month is payable now - that is what confirms the
                // booking and releases the car.
                status: row.sequence === 1 ? 'DUE' : 'SCHEDULED',
              })),
            });
          }

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
              customerId: bookingForId,
              discountAmount: new Prisma.Decimal(quote.coupon.discountAmount),
              codeUsed: quote.coupon.code,
            });
          }

          // Pin which version of the terms was live at this moment. In a
          // dispute the question is "what did the terms say on the day they
          // booked?", and this row is the answer.
          await legalService.recordAgreement(tx, created.id, actor.ipAddress);

          await recordStatusChange(tx, created.id, null, initialStatus, actor.id, verificationReason);

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

      /*
       * A cash booking is CONFIRMED the instant it is created - there is no
       * payment step to wait for - so the confirmation is the right message
       * and the only one. Sending "booking received, complete your payment"
       * to someone whose booking is already firm, and nothing afterwards to
       * say it was confirmed, is how a customer ends up unsure whether they
       * have a car.
       */
      fireAndForget(
        initialStatus === 'CONFIRMED'
          ? notify.bookingConfirmed(booking.id)
          : notify.bookingCreated(booking.id, initialStatus === 'DOCUMENT_VERIFICATION'),
      );

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

    /*
     * The money gate, at the step where money now matters.
     *
     * Confirmation no longer means "paid", so guarding it would guard nothing.
     * READY_FOR_PICKUP is the status that says the car is theirs to collect,
     * and for an online booking that claim is only true once the payment has
     * cleared. Without this, one click on an unpaid booking would walk it to
     * the counter and the handover would be the only thing left standing
     * between a customer and a free car.
     *
     * Cash bookings pass: not paying online is the entire point of the option,
     * and the notes are counted at handover instead.
     */
    if (toStatus === 'READY_FOR_PICKUP' && existing.paymentMethod !== 'CASH_ON_PICKUP') {
      const paid = await prisma.payment.findFirst({
        where: {
          bookingId,
          type: 'RENTAL',
          status: { in: ['SUCCESS', 'REFUNDED', 'PARTIALLY_REFUNDED'] },
        },
        select: { id: true },
      });

      if (!paid) {
        throw ApiError.conflict(
          'This booking is paid online and has no cleared payment yet. It becomes ready for pickup when the payment arrives, not by hand.',
        );
      }
    }

    /*
     * ===================================================================
     * A BOOKING CANNOT WALK PAST THE RETURN
     * ===================================================================
     * The status buttons move the booking row and nothing else. The RETURN
     * FORM is what closes the rental, records mileage and fuel, computes the
     * late and cleaning charges, and puts the car back in the fleet.
     *
     * So clicking "mark returned" on a car that is still out produced a
     * booking marked COMPLETED, a rental still running with no return
     * mileage, and a vehicle stuck on RENTED forever - which is why the
     * dashboard went on reporting cars as rented after every rental had
     * finished, and why those cars quietly stopped being bookable.
     *
     * The charges are the worse half: skipping the form skips the money it
     * would have calculated, and nothing afterwards says it was skipped.
     *
     * A booking with NO handover record is untouched by this - nothing was
     * ever collected on it, so there is nothing to check in.
     */
    if (toStatus === 'RETURNED' || toStatus === 'COMPLETED') {
      const openRental = await prisma.rental.findFirst({
        where: { bookingId, returnedAt: null },
        select: { id: true },
      });

      if (openRental) {
        throw ApiError.conflict(
          'This vehicle has not been checked in yet. Record the return first - that is where the mileage, the fuel and any extra charges are worked out. Marking the booking finished here would skip all of it and leave the car showing as rented.',
        );
      }
    }

    const confirmHoldMinutes = await settingsService.getNumberOr(
      SettingKey.BOOKING_HOLD_MINUTES,
      30,
    );

    const booking = await prisma.$transaction(async (tx) => {
      const updated = await tx.booking.update({
        where: { id: bookingId },
        data: {
          status: toStatus,
          // Once the car is theirs to collect the hold is irrelevant: nothing
          // is outstanding, so there is nothing left to lapse. Confirmation is
          // no longer that moment - an online booking is confirmed but unpaid.
          ...(toStatus === 'READY_FOR_PICKUP' ? { holdExpiresAt: null } : {}),
          // Confirmation is the first moment an online customer can actually
          // pay, so the clock starts here rather than at creation. A booking
          // that spent two days waiting on a document review must not arrive
          // at the payment step with an already-expired hold.
          ...(toStatus === 'CONFIRMED' && existing.paymentMethod !== 'CASH_ON_PICKUP'
            ? { holdExpiresAt: new Date(Date.now() + confirmHoldMinutes * 60_000) }
            : {}),
        },
      });

      await recordStatusChange(tx, bookingId, existing.status, toStatus, actor.id, reason);

      /*
       * Finishing a booking puts the car back on the fleet.
       *
       * The return form already does this properly, in stages - back from the
       * customer means UNDER_INSPECTION, and only a finished inspection means
       * AVAILABLE. This is the safety net for every other way a booking can
       * end: cancelled before collection, or completed by hand after the car
       * was checked in.
       *
       * Deliberately narrow. A vehicle taken off the road for maintenance is
       * never put back on sale by a booking edit, and a car mid-inspection is
       * freed only when it is THIS booking's inspection being finished.
       */
      if (TERMINAL.includes(toStatus)) {
        /*
         * COMPLETED means "inspection done, charges settled" - that is what
         * the proper close-rental action means by it, and it is what an admin
         * means by clicking it. So a rental checked in but never closed off is
         * closed here, and the car it belongs to comes back on sale with it.
         *
         * Only this booking's own inspection, though. A car sitting under
         * inspection after a DIFFERENT rental must not be released because an
         * unrelated booking was cancelled.
         */
        const closed = await tx.rental.updateMany({
          where: { bookingId, status: 'RETURNED' },
          data: { status: 'CLOSED' },
        });

        /*
         * Is the car genuinely out with somebody else?
         *
         * Only a rental belonging to a booking that is still live counts. An
         * open rental hanging off a finished or cancelled booking is the very
         * corruption this block exists to clear up - letting it answer "yes"
         * would pin the car as rented for good.
         */
        const stillOut = await tx.rental.findFirst({
          where: {
            returnedAt: null,
            booking: { vehicleId: existing.vehicleId, status: { notIn: TERMINAL } },
          },
          select: { id: true },
        });

        if (!stillOut) {
          const freeable: VehicleStatus[] =
            closed.count > 0
              ? ['RESERVED', 'RENTED', 'UNDER_INSPECTION']
              : ['RESERVED', 'RENTED'];

          await tx.vehicle.updateMany({
            where: { id: existing.vehicleId, status: { in: freeable } },
            data: { status: 'AVAILABLE' },
          });
        }
      }

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

    /*
     * The customer is told when their booking becomes confirmed, whoever
     * confirmed it. The online route already notifies from the payment
     * service, which updates the booking row directly rather than calling
     * this method - so this covers the hand-confirmed cash booking without
     * double-sending to anyone.
     *
     * Detached: a mail server being down must not roll back a confirmation
     * that has already happened.
     */
    if (toStatus === 'CONFIRMED') {
      fireAndForget(notify.bookingConfirmed(bookingId));
    }

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


  /**
   * Change a booking's dates, car or locations before it goes out.
   *
   * ==========================================================================
   * WHY THIS IS NOT A SIMPLE UPDATE
   * ==========================================================================
   * "The customer wants Thursday instead of Wednesday" is the most ordinary
   * request at a rental desk, and there was no way to do it: staff cancelled
   * the booking and made a new one, which lost the reference number, the
   * price snapshot and the payment attached to it.
   *
   * It is not a simple update because three things have to move together:
   *   - the new window must be free, checked the same way a new booking is,
   *     inside a serializable transaction so two edits cannot both win;
   *   - the price must be recalculated, because a Thursday is not a Wednesday
   *     and a different car is a different rate; and
   *   - if money has already been taken, the difference has to be visible
   *     rather than silently absorbed.
   *
   * WHAT IT REFUSES. A booking whose car has already been handed over cannot
   * be edited: the dates on it are now a record of what happened, and changing
   * them would rewrite history. Extending a live rental is what the extension
   * flow is for, and it has its own rules about conflicts and payment.
   */
  async edit(
    bookingId: string,
    input: {
      pickupAt?: Date;
      returnAt?: Date;
      vehicleId?: string;
      pickupLocationId?: string;
      dropoffLocationId?: string;
      reason?: string;
    },
    actor: BookingActor,
  ): Promise<PublicBooking> {
    const existing = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: bookingInclude,
    });
    if (!existing) throw ApiError.notFound('Booking not found');

    /*
     * Only before the keys move. `EDITABLE` deliberately stops at
     * READY_FOR_PICKUP - once a rental record exists, the booking's dates are
     * history rather than intention.
     */
    const EDITABLE = [
      'PENDING',
      'DOCUMENT_VERIFICATION',
      'PAYMENT_PENDING',
      'CONFIRMED',
      'READY_FOR_PICKUP',
    ];
    if (!EDITABLE.includes(existing.status)) {
      throw ApiError.conflict(
        existing.status === 'CANCELLED'
          ? 'This booking was cancelled. Create a new one rather than reviving it.'
          : `The car for ${existing.bookingNumber} has already gone out. Use the extension or return flow instead of editing the dates.`,
      );
    }

    const pickupAt = input.pickupAt ?? existing.pickupAt;
    const returnAt = input.returnAt ?? existing.returnAt;
    const vehicleId = input.vehicleId ?? existing.vehicleId;

    if (returnAt <= pickupAt) {
      throw ApiError.badRequest('The return has to be after the collection.');
    }

    const period = { pickupAt, returnAt };
    const unchanged =
      vehicleId === existing.vehicleId &&
      pickupAt.getTime() === existing.pickupAt.getTime() &&
      returnAt.getTime() === existing.returnAt.getTime();

    // Re-price against the NEW shape. Same engine as a new booking, so an edit
    // can never produce a price the booking flow would not have given.
    const quote = await pricingService.quote({
      vehicleId,
      pickupAt,
      returnAt,
      pickupLocationId: input.pickupLocationId ?? existing.pickupLocationId ?? undefined,
      dropoffLocationId: input.dropoffLocationId ?? existing.dropoffLocationId ?? undefined,
      couponCode: existing.couponCode ?? undefined,
      customerId: existing.customerId,
    });

    const bufferHours = await settingsService.getNumberOr(SettingKey.TURNAROUND_BUFFER_HOURS, 0);

    const updated = await withSerializableRetry(() =>
      prisma.$transaction(
        async (tx) => {
          if (!unchanged) {
            /*
             * The booking's own row must be excluded from the conflict check,
             * or every edit would collide with itself and nothing could ever
             * be moved by an hour.
             */
            const conflicts = await tx.booking.count({
              where: {
                vehicleId,
                id: { not: bookingId },
                ...blockingBookingsWhere(period, bufferHours),
              },
            });
            if (conflicts > 0) {
              throw new ApiError(
                409,
                'That car is already booked over those dates. Choose different dates or another car.',
                ErrorCode.VEHICLE_UNAVAILABLE,
              );
            }
          }

          await tx.booking.update({
            where: { id: bookingId },
            data: {
              vehicleId,
              pickupAt,
              returnAt,
              ...(input.pickupLocationId !== undefined && {
                pickupLocationId: input.pickupLocationId,
              }),
              ...(input.dropoffLocationId !== undefined && {
                dropoffLocationId: input.dropoffLocationId,
              }),

              // --- The price snapshot, taken again ----------------------
              rentalDays: quote.period.rentalDays,
              vehicleSubtotal: new Prisma.Decimal(quote.totals.vehicleSubtotal),
              deliveryFee: new Prisma.Decimal(quote.totals.deliveryFee),
              discountAmount: new Prisma.Decimal(quote.totals.discountAmount),
              taxAmount: new Prisma.Decimal(quote.totals.taxAmount),
              totalAmount: new Prisma.Decimal(quote.totals.rentalTotal),
              securityDeposit: new Prisma.Decimal(quote.totals.securityDeposit),
            },
          });

          /*
           * The change goes in the booking's own history, not only the audit
           * log. The customer-facing timeline is where "why did my price
           * change?" gets answered, and an audit row nobody can see does not
           * answer it.
           */
          await recordStatusChange(
            tx,
            bookingId,
            existing.status,
            existing.status,
            actor.id,
            input.reason?.trim() ||
              `Booking edited: ${existing.pickupAt.toISOString().slice(0, 10)} to ${pickupAt
                .toISOString()
                .slice(0, 10)}`,
          );

          return tx.booking.findUniqueOrThrow({
            where: { id: bookingId },
            include: bookingInclude,
          });
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 15_000,
        },
      ),
    );

    await auditService.record({
      action: 'booking.edited',
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      entityType: 'Booking',
      entityId: bookingId,
      metadata: {
        bookingNumber: existing.bookingNumber,
        was: {
          pickupAt: existing.pickupAt.toISOString(),
          returnAt: existing.returnAt.toISOString(),
          vehicleId: existing.vehicleId,
          total: existing.totalAmount.toFixed(2),
        },
        now: {
          pickupAt: pickupAt.toISOString(),
          returnAt: returnAt.toISOString(),
          vehicleId,
          total: quote.totals.rentalTotal,
        },
        reason: input.reason ?? null,
      },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return toPublicBooking(updated, true);
  },

  /** One booking. Customers may only reach their own. */
  async getById(bookingId: string, actor: BookingActor): Promise<PublicBooking> {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: bookingInclude,
    });

    const backOffice = isBackOffice(actor.role);
    if (!booking || (!backOffice && booking.customerId !== actor.id)) {
      throw ApiError.notFound('Booking not found');
    }

    return toPublicBooking(booking, backOffice);
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
    awaitingPayment?: boolean;
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
      /*
       * Kept identical to the outstanding report's definition on purpose - see
       * reports/service.ts. Two screens answering "who owes us money" with
       * different numbers is worse than either number being slightly off.
       */
      ...(query.awaitingPayment
        ? {
            status: { in: ['CONFIRMED', 'PAYMENT_PENDING'] as BookingStatus[] },
            paymentMethod: { not: 'CASH_ON_PICKUP' },
          }
        : {}),
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
      where: {
        /*
         * The statuses that can actually be sitting on an unpaid hold.
         *
         * This used to read `status: 'PENDING'` alone, which matched nothing:
         * a booking is never created into PENDING, so no hold was ever swept
         * and abandoned checkouts kept their cars off sale indefinitely. With
         * confirmation now happening BEFORE payment, that latent bug would
         * have become the common case.
         *
         * DOCUMENT_VERIFICATION is deliberately absent. That booking is
         * waiting on US to review the upload; cancelling it for "not paying"
         * would punish a customer for our own queue.
         */
        status: { in: ['PENDING', 'CONFIRMED', 'PAYMENT_PENDING'] },
        // Cash bookings never carry a hold, but be explicit rather than rely
        // on the column being null.
        paymentMethod: { not: 'CASH_ON_PICKUP' },
        holdExpiresAt: { lt: now },
        // Belt and braces: never cancel something that has actually been paid,
        // whatever its status column says.
        payments: {
          none: {
            type: 'RENTAL',
            status: { in: ['SUCCESS', 'REFUNDED', 'PARTIALLY_REFUNDED'] },
          },
        },
      },
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
