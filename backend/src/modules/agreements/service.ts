/**
 * modules/agreements/service.ts
 * ---------------------------------------------------------------------------
 * The rental agreement - the document the hirer actually signs.
 *
 * =============================================================================
 * WHY THIS IS NOT THE BOOKING, AND NOT THE INVOICE
 * =============================================================================
 * The booking is an intention. The invoice is a demand for money. Neither one
 * says who may drive the car, what happens if it is damaged, what the mileage
 * allowance is, or what the hirer owes before the insurer pays anything - and
 * none of those questions can be settled after the fact. The agreement is the
 * only document in the system that both sides put their name to, so it is the
 * only one that decides a dispute.
 *
 * Like the invoice, it is a SNAPSHOT. Every figure and every clause is copied
 * in at issue time. If it were rendered live from the booking, then extending
 * a rental, correcting a price or renewing an insurance policy would silently
 * rewrite a document somebody has already signed - and the copy in the
 * customer's hand would stop matching the copy on screen. A signed document
 * that changes afterwards is not a document.
 *
 * A mistake is corrected by VOIDING the agreement and issuing a new one, which
 * takes a new number. Never by editing. The voided one stays, because "what
 * did they sign" has to remain answerable.
 */
import { Prisma } from '@prisma/client';
import type { Role } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { ApiError } from '../../utils/ApiError';
import { auditService } from '../audit/service';
import { SettingKey, settingsService } from '../settings/service';
import { nextDocumentNumber } from '../invoices/numbering';

export interface AgreementActor {
  id: string | null;
  email: string;
  role: Role;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Bookings that can carry an agreement.
 *
 * Not PENDING or DOCUMENT_VERIFICATION: nothing is agreed yet, and printing a
 * contract for a booking that may still be refused on documents invites
 * somebody to hand it over. Not CANCELLED: there is no rental to agree to.
 */
const AGREEABLE_STATUSES = [
  'CONFIRMED',
  'PAYMENT_PENDING',
  'READY_FOR_PICKUP',
  'ACTIVE',
  'EXTENSION_REQUESTED',
  'RETURN_PENDING',
  'RETURNED',
  'COMPLETED',
] as const;

const bookingForAgreement = {
  vehicle: {
    select: {
      brand: true,
      model: true,
      year: true,
      variant: true,
      registrationNumber: true,
      vin: true,
      mileageLimitPerDay: true,
      extraMileageCharge: true,
      currentMileage: true,
      insuranceRecords: {
        where: { isActive: true },
        orderBy: { expiryDate: 'desc' },
        take: 1,
        select: { provider: true, policyNumber: true, excessAmount: true },
      },
    },
  },
  customer: {
    select: {
      id: true,
      fullName: true,
      email: true,
      phone: true,
      customer: {
        select: {
          licenceNumber: true,
          licenceExpiryDate: true,
          addressLine1: true,
          addressLine2: true,
          city: true,
          emirate: true,
          country: true,
          documents: {
            where: { status: 'APPROVED', supersededAt: null },
            select: { type: true, documentNumber: true },
          },
        },
      },
    },
  },
  additionalDrivers: {
    select: { fullName: true, licenceNumber: true, licenceExpiry: true },
    orderBy: { createdAt: 'asc' },
  },
  pickupLocation: { select: { name: true, emirate: true } },
  dropoffLocation: { select: { name: true, emirate: true } },
  rental: {
    select: {
      inspections: {
        where: { type: 'PICKUP' },
        orderBy: { createdAt: 'asc' },
        take: 1,
        select: { mileage: true },
      },
    },
  },
} satisfies Prisma.BookingInclude;

export const agreementsService = {
  /**
   * Issue the agreement for a booking.
   *
   * One live agreement per booking. Re-issuing is not an error the caller has
   * to guess at: it says which number already exists and how to replace it.
   */
  async issueForBooking(bookingId: string, actor: AgreementActor) {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: bookingForAgreement,
    });
    if (!booking) throw ApiError.notFound('That booking does not exist');

    if (!(AGREEABLE_STATUSES as readonly string[]).includes(booking.status)) {
      throw ApiError.conflict(
        booking.status === 'CANCELLED'
          ? 'This booking was cancelled. There is no rental to draw up an agreement for.'
          : 'This booking is not confirmed yet. Confirm it first, then draw up the agreement.',
      );
    }

    const existing = await prisma.rentalAgreement.findUnique({ where: { bookingId } });
    if (existing && existing.status !== 'VOID') {
      throw ApiError.conflict(
        `This booking already has agreement ${existing.agreementNumber}. Void it first if it needs to be replaced.`,
      );
    }

    const seller = await companySnapshot();
    const terms = await currentTerms();
    const profile = booking.customer.customer;
    const documents = profile?.documents ?? [];
    const numberOf = (type: string) =>
      documents.find((d) => d.type === type)?.documentNumber ?? null;

    const policy = booking.vehicle.insuranceRecords[0] ?? null;
    const pickupMileage =
      booking.rental?.inspections[0]?.mileage ?? booking.vehicle.currentMileage ?? null;

    const agreement = await prisma.$transaction(async (tx) => {
      // The old agreement is void, so its number is spent. A replacement gets
      // its own, and the two are told apart by number, not by a flag.
      if (existing) await tx.rentalAgreement.delete({ where: { id: existing.id } });

      const agreementNumber = await nextDocumentNumber(tx, 'agreement');

      return tx.rentalAgreement.create({
        data: {
          agreementNumber,
          bookingId: booking.id,
          status: 'ISSUED',

          ...seller,

          customerName: booking.customer.fullName,
          customerEmail: booking.customer.email,
          customerPhone: booking.customer.phone,
          customerAddress: addressLine(profile),
          licenceNumber: profile?.licenceNumber ?? null,
          licenceExpiry: profile?.licenceExpiryDate ?? null,
          emiratesIdNumber: numberOf('EMIRATES_ID'),
          passportNumber: numberOf('PASSPORT'),

          vehicleDescription: [
            booking.vehicle.year,
            booking.vehicle.brand,
            booking.vehicle.model,
            booking.vehicle.variant,
          ]
            .filter(Boolean)
            .join(' '),
          registrationNumber: booking.vehicle.registrationNumber,
          vin: booking.vehicle.vin,
          pickupMileage,

          pickupAt: booking.pickupAt,
          returnAt: booking.returnAt,
          pickupLocation: locationLine(booking.pickupLocation),
          dropoffLocation: locationLine(booking.dropoffLocation),
          rentalDays: booking.rentalDays,

          rentalAmount: booking.totalAmount.minus(booking.taxAmount),
          taxAmount: booking.taxAmount,
          totalAmount: booking.totalAmount,
          securityDeposit: booking.securityDeposit,
          currency: booking.currency,

          mileageLimitPerDay: booking.vehicle.mileageLimitPerDay,
          extraMileageCharge: booking.vehicle.extraMileageCharge,
          fuelPolicy: await fuelPolicyText(),

          insurerName: policy?.provider ?? null,
          policyNumber: policy?.policyNumber ?? null,
          excessAmount: policy?.excessAmount ?? null,

          additionalDriversText: driversLine(booking.additionalDrivers),

          termsVersion: terms.version,
          termsBody: terms.body,
        },
      });
    });

    await auditService.record({
      action: 'agreement.issued',
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      entityType: 'RentalAgreement',
      entityId: agreement.id,
      metadata: { agreementNumber: agreement.agreementNumber, bookingNumber: booking.bookingNumber },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return toPublicAgreement(agreement, booking.bookingNumber);
  },

  /** The agreement for a booking, or null when none has been drawn up yet. */
  async forBooking(bookingId: string, actor: AgreementActor) {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { id: true, bookingNumber: true, customerId: true },
    });
    if (!booking) throw ApiError.notFound('That booking does not exist');
    assertMaySee(actor, booking.customerId);

    const agreement = await prisma.rentalAgreement.findUnique({ where: { bookingId } });
    return agreement ? toPublicAgreement(agreement, booking.bookingNumber) : null;
  },

  /**
   * One agreement, with the ownership check.
   *
   * A customer who is not on the booking gets a 404, not a 403: confirming
   * that AGR-2026-000042 exists is itself worth something to an attacker.
   */
  async getForActor(id: string, actor: AgreementActor) {
    const agreement = await prisma.rentalAgreement.findUnique({
      where: { id },
      include: { booking: { select: { bookingNumber: true, customerId: true } } },
    });
    if (!agreement) throw ApiError.notFound('Agreement not found');
    assertMaySee(actor, agreement.booking.customerId, true);

    return toPublicAgreement(agreement, agreement.booking.bookingNumber);
  },

  /**
   * The hirer signs.
   *
   * A typed name, the timestamp and the IP address it came from. That is the
   * record the UAE Electronic Transactions Law asks for, and - unlike a drawn
   * squiggle nobody can verify - it is the part that is actually checkable.
   * Staff may capture it at the counter on the customer's behalf; who typed it
   * is recorded either way, which is the honest way round.
   */
  async signByCustomer(
    id: string,
    input: { signedName: string; declined?: boolean; declineReason?: string },
    actor: AgreementActor,
  ) {
    const agreement = await prisma.rentalAgreement.findUnique({
      where: { id },
      include: { booking: { select: { bookingNumber: true, customerId: true } } },
    });
    if (!agreement) throw ApiError.notFound('Agreement not found');
    assertMaySee(actor, agreement.booking.customerId, true);

    if (agreement.status === 'VOID') {
      throw ApiError.conflict('This agreement was voided. Ask for the replacement.');
    }
    if (agreement.customerSignedAt) {
      throw ApiError.conflict(
        `Already signed by ${agreement.customerSignedName ?? 'the hirer'}. A signed agreement cannot be signed again - void it and issue a new one.`,
      );
    }

    const updated = await prisma.rentalAgreement.update({
      where: { id },
      data: {
        customerSignedName: input.signedName,
        customerSignedAt: new Date(),
        customerSignedIp: actor.ipAddress ?? null,
        status: agreement.staffSignedAt ? 'SIGNED' : agreement.status,
      },
    });

    await auditService.record({
      action: 'agreement.signed.customer',
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      entityType: 'RentalAgreement',
      entityId: id,
      metadata: {
        agreementNumber: agreement.agreementNumber,
        signedName: input.signedName,
        // Worth recording when staff typed it in on the customer's behalf.
        signedBy: actor.role === 'CUSTOMER' ? 'customer' : 'staff-on-behalf',
      },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return toPublicAgreement(updated, agreement.booking.bookingNumber);
  },

  /** The company countersigns. Staff only. */
  async signByStaff(id: string, signedName: string, actor: AgreementActor) {
    const agreement = await prisma.rentalAgreement.findUnique({
      where: { id },
      include: { booking: { select: { bookingNumber: true } } },
    });
    if (!agreement) throw ApiError.notFound('Agreement not found');
    if (agreement.status === 'VOID') {
      throw ApiError.conflict('This agreement was voided. Ask for the replacement.');
    }
    if (agreement.staffSignedAt) {
      throw ApiError.conflict(`Already countersigned by ${agreement.staffSignedName ?? 'staff'}.`);
    }

    const updated = await prisma.rentalAgreement.update({
      where: { id },
      data: {
        staffSignedName: signedName,
        staffSignedAt: new Date(),
        staffId: actor.id,
        status: agreement.customerSignedAt ? 'SIGNED' : agreement.status,
      },
    });

    await auditService.record({
      action: 'agreement.signed.staff',
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      entityType: 'RentalAgreement',
      entityId: id,
      metadata: { agreementNumber: agreement.agreementNumber, signedName },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return toPublicAgreement(updated, agreement.booking.bookingNumber);
  },

  /**
   * Void an agreement, with a reason.
   *
   * The row survives. A voided agreement is the evidence that a superseded set
   * of terms once existed, and deleting it would destroy exactly the thing a
   * dispute turns on.
   */
  async voidAgreement(id: string, reason: string, actor: AgreementActor) {
    const agreement = await prisma.rentalAgreement.findUnique({
      where: { id },
      include: { booking: { select: { bookingNumber: true } } },
    });
    if (!agreement) throw ApiError.notFound('Agreement not found');
    if (agreement.status === 'VOID') throw ApiError.conflict('This agreement is already void.');

    const updated = await prisma.rentalAgreement.update({
      where: { id },
      data: { status: 'VOID', voidReason: reason, voidedAt: new Date() },
    });

    await auditService.record({
      action: 'agreement.voided',
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      entityType: 'RentalAgreement',
      entityId: id,
      metadata: { agreementNumber: agreement.agreementNumber, reason },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return toPublicAgreement(updated, agreement.booking.bookingNumber);
  },

  /** Back-office list. Customers use `forBooking` instead. */
  async list(query: { page: number; limit: number; status?: string; bookingId?: string }) {
    const where: Prisma.RentalAgreementWhereInput = {
      ...(query.status ? { status: query.status as Prisma.EnumAgreementStatusFilter['equals'] } : {}),
      ...(query.bookingId ? { bookingId: query.bookingId } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.rentalAgreement.findMany({
        where,
        include: { booking: { select: { bookingNumber: true } } },
        orderBy: { issuedAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      prisma.rentalAgreement.count({ where }),
    ]);

    return {
      items: items.map((a) => toPublicAgreement(a, a.booking.bookingNumber)),
      total,
    };
  },
};

/**
 * The authorised drivers, as one printable line each.
 *
 * Stored as text rather than as a relation because the agreement is a
 * snapshot: the drivers named on the paper the hirer signed must not change
 * when somebody is added to the booking next week.
 */
function driversLine(
  drivers: { fullName: string; licenceNumber: string; licenceExpiry: Date | null }[],
): string | null {
  if (drivers.length === 0) return null;
  return drivers
    .map(
      (driver) =>
        `${driver.fullName} - licence ${driver.licenceNumber}` +
        (driver.licenceExpiry ? ` (expires ${driver.licenceExpiry.toISOString().slice(0, 10)})` : ''),
    )
    .join('\n');
}

/** Staff see everything; a customer sees only their own. */
function assertMaySee(actor: AgreementActor, ownerId: string, hide = false): void {
  if (actor.role !== 'CUSTOMER') return;
  if (actor.id === ownerId) return;
  throw hide
    ? ApiError.notFound('Agreement not found')
    : ApiError.forbidden('You do not have permission to perform this action');
}

function addressLine(profile: {
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  emirate?: string | null;
  country?: string | null;
} | null | undefined): string | null {
  if (!profile) return null;
  const parts = [
    profile.addressLine1,
    profile.addressLine2,
    profile.city,
    profile.emirate,
    profile.country,
  ].filter((p): p is string => Boolean(p && p.trim()));
  return parts.length ? parts.join(', ') : null;
}

function locationLine(location: { name: string; emirate: string | null } | null): string | null {
  if (!location) return null;
  return location.emirate ? `${location.name}, ${location.emirate}` : location.name;
}

/** Company details AT ISSUE TIME. Blank where the client has not supplied one. */
async function companySnapshot() {
  const [name, address, phone, email, trn] = await Promise.all([
    settingsService.getString(SettingKey.COMPANY_NAME),
    settingsService.getString(SettingKey.COMPANY_ADDRESS),
    settingsService.getString(SettingKey.COMPANY_PHONE),
    settingsService.getString(SettingKey.COMPANY_EMAIL),
    settingsService.getString(SettingKey.COMPANY_TRN),
  ]);

  return {
    companyName: name || null,
    companyAddress: address || null,
    companyPhone: phone || null,
    companyEmail: email || null,
    companyTrn: trn || null,
  };
}

/**
 * The fuel rule, in words the hirer can act on.
 *
 * Built from the same setting the return charge is calculated from, so the
 * contract cannot promise one rate while the counter charges another. Where no
 * rate is configured, it says so rather than inventing a figure - a driver who
 * reads "no charge" and is then billed has a complaint that is hard to answer.
 */
async function fuelPolicyText(): Promise<string> {
  const perPercent = await settingsService.getNumber('rental.fuel_charge_per_percent');
  if (perPercent === null || perPercent <= 0) {
    return 'Return the vehicle with the same fuel level it was collected at.';
  }
  return `Return the vehicle with the same fuel level it was collected at. Any shortfall is charged at AED ${perPercent.toFixed(2)} for each 1% missing.`;
}

/**
 * The terms in force right now, copied in whole.
 *
 * A link to the living legal document would let somebody publish version 4 and
 * change what a hirer signed under version 3. So the text travels with the
 * agreement, and the version number is kept beside it so the two can be
 * compared later.
 */
async function currentTerms(): Promise<{ version: string | null; body: string | null }> {
  const document =
    (await prisma.legalDocument.findFirst({
      where: { type: 'RENTAL_AGREEMENT', isPublished: true },
      orderBy: { version: 'desc' },
    })) ??
    (await prisma.legalDocument.findFirst({
      where: { type: 'TERMS_AND_CONDITIONS', isPublished: true },
      orderBy: { version: 'desc' },
    }));

  if (!document) return { version: null, body: null };
  return { version: `${document.title} v${document.version}`, body: document.content };
}

export function toPublicAgreement(
  agreement: Prisma.RentalAgreementGetPayload<object>,
  bookingNumber?: string,
) {
  return {
    id: agreement.id,
    agreementNumber: agreement.agreementNumber,
    bookingId: agreement.bookingId,
    bookingNumber: bookingNumber ?? null,
    status: agreement.status,

    customerName: agreement.customerName,
    customerEmail: agreement.customerEmail,
    vehicleDescription: agreement.vehicleDescription,
    registrationNumber: agreement.registrationNumber,

    pickupAt: agreement.pickupAt,
    returnAt: agreement.returnAt,
    rentalDays: agreement.rentalDays,

    totalAmount: agreement.totalAmount.toFixed(2),
    securityDeposit: agreement.securityDeposit.toFixed(2),
    currency: agreement.currency,

    mileageLimitPerDay: agreement.mileageLimitPerDay,
    excessAmount: agreement.excessAmount ? agreement.excessAmount.toFixed(2) : null,

    customerSignedName: agreement.customerSignedName,
    customerSignedAt: agreement.customerSignedAt,
    staffSignedName: agreement.staffSignedName,
    staffSignedAt: agreement.staffSignedAt,

    voidReason: agreement.voidReason,
    voidedAt: agreement.voidedAt,
    issuedAt: agreement.issuedAt,
  };
}
