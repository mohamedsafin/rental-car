/**
 * modules/customers/service.ts
 * ---------------------------------------------------------------------------
 * Customer profiles (BRD 22 "My Profile", BRD 37 admin customer management).
 *
 * A `customers` row is created lazily on first access rather than at
 * registration. Registration only needs identity; the rental profile - date of
 * birth, licence details, residency - is collected when the customer starts a
 * booking. Creating an empty row at sign-up would just be a table full of nulls.
 */
import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { Role } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { ApiError } from '../../utils/ApiError';
import { hashPassword } from '../../utils/password';
import { auditService } from '../audit/service';
import { evaluateRequirements } from './requirements';
import { toPublicCustomer, type PublicCustomer, type VerificationSummary } from './types';
import type { CreateWalkInCustomerInput, UpdateCustomerProfileInput } from './validation';

export const customersService = {
  /** The caller's own profile, created on first access. */
  async getOrCreateForUser(userId: string): Promise<PublicCustomer> {
    const existing = await prisma.customer.findUnique({ where: { userId } });
    if (existing) return toPublicCustomer(existing);

    const created = await prisma.customer.create({ data: { userId } });
    return toPublicCustomer(created);
  },

  async findByUserId(userId: string) {
    const customer = await prisma.customer.findUnique({ where: { userId } });
    if (!customer) throw ApiError.notFound('Customer profile not found');
    return customer;
  },

  async updateProfile(userId: string, input: UpdateCustomerProfileInput): Promise<PublicCustomer> {
    // Ensure the row exists before updating it.
    await customersService.getOrCreateForUser(userId);

    const data: Prisma.CustomerUpdateInput = {
      ...(input.residencyStatus !== undefined && {
        residencyStatus: input.residencyStatus,
      }),
      ...(input.dateOfBirth !== undefined && { dateOfBirth: new Date(input.dateOfBirth) }),
      ...(input.nationality !== undefined && { nationality: input.nationality }),
      ...(input.addressLine1 !== undefined && { addressLine1: input.addressLine1 }),
      ...(input.addressLine2 !== undefined && { addressLine2: input.addressLine2 }),
      ...(input.city !== undefined && { city: input.city }),
      ...(input.emirate !== undefined && { emirate: input.emirate }),
      ...(input.country !== undefined && { country: input.country }),
      ...(input.emergencyContactName !== undefined && {
        emergencyContactName: input.emergencyContactName,
      }),
      ...(input.emergencyContactPhone !== undefined && {
        emergencyContactPhone: input.emergencyContactPhone,
      }),
      ...(input.licenceNumber !== undefined && { licenceNumber: input.licenceNumber }),
      ...(input.licenceIssuingCountry !== undefined && {
        licenceIssuingCountry: input.licenceIssuingCountry,
      }),
      ...(input.licenceIssueDate !== undefined && {
        licenceIssueDate: new Date(input.licenceIssueDate),
      }),
      ...(input.licenceExpiryDate !== undefined && {
        licenceExpiryDate: new Date(input.licenceExpiryDate),
      }),
    };

    const customer = await prisma.customer.update({ where: { userId }, data });
    return toPublicCustomer(customer);
  },

  /**
   * The document checklist and verification verdict.
   *
   * Recomputed from the requirement settings on every call rather than read
   * from the cached flag, so changing the required-documents list takes effect
   * immediately instead of waiting for the next upload.
   */
  /**
   * @param asOf  The moment the documents must still be valid AT. Defaults to
   *   now, which is right for "is my account in order?" - but a booking must
   *   pass its RETURN date, or a licence that expires mid-rental is approved
   *   and the customer is driving unlicensed on day three. An insurer declines
   *   that claim, and rightly.
   */
  async getVerificationSummary(
    customerId: string,
    asOf: Date = new Date(),
  ): Promise<VerificationSummary> {
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      include: {
        documents: {
          select: {
            id: true,
            type: true,
            status: true,
            expiryDate: true,
            rejectionReason: true,
            supersededAt: true,
          },
          orderBy: { uploadedAt: 'desc' },
        },
      },
    });
    if (!customer) throw ApiError.notFound('Customer profile not found');

    const { requirements, isVerified, warnings } = await evaluateRequirements(
      customer.residencyStatus,
      customer.documents,
      asOf,
    );

    return { isVerified, residencyStatus: customer.residencyStatus, requirements, warnings };
  },

  /** Admin/staff listing (BRD 37). */
  async list(query: {
    page: number;
    limit: number;
    search?: string;
    verified?: boolean;
    pendingDocuments?: boolean;
  }) {
    const where: Prisma.CustomerWhereInput = {
      ...(query.verified !== undefined ? { isVerified: query.verified } : {}),
      ...(query.pendingDocuments
        ? { documents: { some: { status: 'PENDING', supersededAt: null } } }
        : {}),
      // One `user` clause only. Two keys with the same name would silently
      // overwrite each other and quietly drop the search filter.
      user: {
        deletedAt: null,
        ...(query.search
          ? {
              OR: [
                { fullName: { contains: query.search, mode: 'insensitive' } },
                { email: { contains: query.search, mode: 'insensitive' } },
                { phone: { contains: query.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
    };

    const [items, total] = await prisma.$transaction([
      prisma.customer.findMany({
        where,
        include: {
          user: { select: { id: true, fullName: true, email: true, phone: true, status: true } },
          _count: { select: { documents: { where: { status: 'PENDING', supersededAt: null } } } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      prisma.customer.count({ where }),
    ]);

    return {
      items: items.map((customer) => ({
        ...toPublicCustomer(customer),
        user: customer.user,
        pendingDocumentCount: customer._count.documents,
      })),
      total,
    };
  },


  /**
   * Open an account for a customer standing at the counter.
   *
   * =========================================================================
   * THE PASSWORD IS NOT SET HERE, AND THAT IS THE POINT
   * =========================================================================
   * The account is created with a random secret nobody records, nobody sees
   * and nobody can use. The customer receives a set-password link at their own
   * address and chooses their own. Staff end up able to BOOK for the customer
   * and never able to LOG IN as them, which is the line that has to hold: an
   * account a member of staff can sign into is an account whose bookings,
   * documents and payments they can later disown.
   *
   * If the email is already registered the answer says so plainly. Silence
   * would be the wrong trade here - this is a staff member typing an address
   * the customer just read out, not a public form an attacker can probe, and
   * "that address already has an account, search for it" is the thing they
   * need to be told.
   */
  async createWalkIn(
    input: CreateWalkInCustomerInput,
    actor: { id: string; email: string; role: Role; ipAddress?: string; userAgent?: string },
  ) {
    const existing = await prisma.user.findUnique({ where: { email: input.email } });
    if (existing) {
      throw ApiError.conflict(
        `${input.email} already has an account. Search for the customer instead of creating a second one.`,
      );
    }

    // 32 bytes of nothing anybody keeps. The customer sets the real one from
    // the emailed link; until then the account simply cannot be signed into.
    const unusablePassword = await hashPassword(randomBytes(32).toString('base64url'));

    const created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: input.email,
          fullName: input.fullName,
          phone: input.phone,
          passwordHash: unusablePassword,
          role: 'CUSTOMER',
          country: input.nationality ?? null,
        },
      });

      const customer = await tx.customer.create({
        data: {
          userId: user.id,
          customerType: input.customerType,
          companyName: input.companyName ?? null,
          companyTrn: input.companyTrn ?? null,
          residencyStatus: input.residencyStatus ?? null,
          dateOfBirth: input.dateOfBirth ? new Date(input.dateOfBirth) : null,
          nationality: input.nationality ?? null,
          addressLine1: input.addressLine1 ?? null,
          city: input.city ?? null,
          emirate: input.emirate ?? null,
          licenceNumber: input.licenceNumber ?? null,
          licenceIssuingCountry: input.licenceIssuingCountry ?? null,
          licenceExpiryDate: input.licenceExpiryDate ? new Date(input.licenceExpiryDate) : null,
        },
      });

      return { user, customer };
    });

    await auditService.record({
      action: 'customer.created_by_staff',
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      entityType: 'Customer',
      entityId: created.customer.id,
      metadata: { email: input.email, customerType: input.customerType },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    /*
     * The invitation. Imported here rather than at the top so the module graph
     * stays acyclic - auth reaches back into customers.
     *
     * Deliberately not awaited into the response's success: an account that
     * exists but whose email did not send is recoverable (staff resend it),
     * while failing the whole creation over a mail server would lose the
     * customer's details and leave the person at the counter waiting.
     */
    let invitationSent = false;
    try {
      const { verificationService } = await import('../auth/verificationService');
      const result = await verificationService.requestPasswordReset(input.email, 'web', {
        ipAddress: actor.ipAddress ?? 'counter',
        userAgent: actor.userAgent ?? 'counter',
      });
      invitationSent = result.sent;
    } catch {
      invitationSent = false;
    }

    return {
      ...toPublicCustomer(created.customer),
      user: {
        id: created.user.id,
        fullName: created.user.fullName,
        email: created.user.email,
        phone: created.user.phone,
        country: created.user.country,
        status: created.user.status,
      },
      /// False means the account exists but the customer has not been emailed
      /// a way in yet. The screen says so rather than implying it was sent.
      invitationSent,
    };
  },


  /**
   * Edit a customer's file from the staff side.
   *
   * =========================================================================
   * WHY STAFF NEED THIS AT ALL
   * =========================================================================
   * Only the customer could edit their own profile, which sounds principled
   * and fails immediately at a counter: a walk-in reads their licence number
   * out loud, a visitor's address is written on a form, and somebody has to
   * type it in. Without this, the only ways to correct a misspelt name were to
   * ask the customer to log in and do it, or to edit the database by hand.
   *
   * Two differences from the customer's own edit, both deliberate:
   *   - it is audited by name, because staff reading and writing somebody
   *     else's date of birth and licence details should leave a trail, and
   *   - the contact fields on the USER row (name, phone) can be corrected too,
   *     which the self-service route does not cover.
   */
  async updateForStaff(
    customerId: string,
    input: UpdateCustomerProfileInput & {
      fullName?: string;
      phone?: string;
      customerType?: 'INDIVIDUAL' | 'CORPORATE';
      companyName?: string;
      companyTrn?: string;
    },
    actor: { id: string; email: string; role: Role; ipAddress?: string; userAgent?: string },
  ) {
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { userId: true },
    });
    if (!customer) throw ApiError.notFound('Customer not found');

    const { fullName, phone, customerType, companyName, companyTrn, ...profile } = input;

    if (Object.keys(profile).length > 0) {
      await customersService.updateProfile(customer.userId, profile);
    }

    if (customerType !== undefined || companyName !== undefined || companyTrn !== undefined) {
      await prisma.customer.update({
        where: { id: customerId },
        data: {
          ...(customerType !== undefined && { customerType }),
          ...(companyName !== undefined && { companyName }),
          ...(companyTrn !== undefined && { companyTrn }),
        },
      });
    }

    if (fullName !== undefined || phone !== undefined) {
      await prisma.user.update({
        where: { id: customer.userId },
        data: {
          ...(fullName !== undefined && { fullName }),
          ...(phone !== undefined && { phone }),
        },
      });
    }

    await auditService.record({
      action: 'customer.updated_by_staff',
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      entityType: 'Customer',
      entityId: customerId,
      metadata: { fields: Object.keys(input) },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return customersService.getByIdForStaff(customerId, actor);
  },

  /**
   * Everything about one customer, on one screen.
   *
   * =========================================================================
   * WHY A ROLL-UP AND NOT FIVE SEPARATE CALLS
   * =========================================================================
   * The question staff actually ask is "who is this person and are they any
   * good?" - which nobody could answer, because their bookings were on the
   * bookings screen, their money on the payments screen and their damages
   * somewhere else again. Working it out meant four searches and a memory.
   *
   * So this returns the answer rather than the ingredients: how many rentals,
   * how much they have spent, what is still owed, and whether they have a
   * history of fines or damage. `outstanding` is the one that decides whether
   * to hand over another set of keys.
   */
  async profileForStaff(
    customerId: string,
    actor: { id: string; email: string; role: Role; ipAddress?: string; userAgent?: string },
  ) {
    const customer = await customersService.getByIdForStaff(customerId, actor);
    const userId = customer.userId;

    const [bookings, payments, fines, damages] = await Promise.all([
      prisma.booking.findMany({
        where: { customerId: userId },
        select: {
          id: true,
          bookingNumber: true,
          status: true,
          pickupAt: true,
          returnAt: true,
          totalAmount: true,
          currency: true,
          vehicle: { select: { brand: true, model: true, registrationNumber: true } },
        },
        orderBy: { pickupAt: 'desc' },
        take: 20,
      }),
      prisma.payment.findMany({
        where: { booking: { customerId: userId }, status: 'SUCCESS' },
        select: { amount: true, type: true },
      }),
      prisma.trafficFine.count({ where: { booking: { customerId: userId } } }),
      prisma.damage.count({ where: { booking: { customerId: userId } } }),
    ]);

    /*
     * What they still owe, counted the way the counter counts it: charges
     * raised against their rentals that have not been recovered. Anything
     * already taken from a deposit is settled and is not owed twice.
     */
    const [unpaidFines, unpaidTolls, unpaidCharges] = await Promise.all([
      prisma.trafficFine.aggregate({
        where: { booking: { customerId: userId }, status: { in: ['RECORDED', 'ASSIGNED'] } },
        // The service fee is part of what they owe, so both columns count.
        _sum: { amount: true, serviceFee: true },
      }),
      prisma.tollCharge.aggregate({
        where: { booking: { customerId: userId }, status: { in: ['RECORDED', 'ASSIGNED'] } },
        _sum: { amount: true, serviceFee: true },
      }),
      prisma.additionalCharge.aggregate({
        where: { booking: { customerId: userId }, status: 'PENDING' },
        _sum: { amount: true },
      }),
    ]);

    const zero = new Prisma.Decimal(0);
    const outstanding = (unpaidFines._sum.amount ?? zero)
      .add(unpaidFines._sum.serviceFee ?? zero)
      .add(unpaidTolls._sum.amount ?? zero)
      .add(unpaidTolls._sum.serviceFee ?? zero)
      .add(unpaidCharges._sum.amount ?? zero);

    // The deposit is somebody else's money being held, not revenue, so it has
    // no business in "what this customer has spent with us".
    const spent = payments
      .filter((payment) => payment.type !== 'SECURITY_DEPOSIT')
      .reduce((sum, payment) => sum.add(payment.amount), zero);

    return {
      customer,
      history: {
        rentals: bookings.length,
        completed: bookings.filter((booking) => booking.status === 'COMPLETED').length,
        cancelled: bookings.filter((booking) => booking.status === 'CANCELLED').length,
        totalSpent: spent.toFixed(2),
        outstanding: outstanding.toFixed(2),
        fines,
        damages,
        currency: bookings[0]?.currency ?? 'AED',
      },
      bookings: bookings.map((booking) => ({
        id: booking.id,
        bookingNumber: booking.bookingNumber,
        status: booking.status,
        pickupAt: booking.pickupAt.toISOString(),
        returnAt: booking.returnAt.toISOString(),
        total: booking.totalAmount.toFixed(2),
        currency: booking.currency,
        vehicle: booking.vehicle.brand + ' ' + booking.vehicle.model +
          ' (' + booking.vehicle.registrationNumber + ')',
      })),
    };
  },


  /**
   * Erase a customer's personal data, on request.
   *
   * ==========================================================================
   * WHY THIS ANONYMISES AND DOES NOT DELETE
   * ==========================================================================
   * A UAE business must keep its tax records - invoices, payments, the lot -
   * for five years. So "delete everything about me" cannot mean deleting the
   * rows: an invoice that vanishes takes a VAT return with it, and the company
   * would be breaking one law to satisfy another.
   *
   * What CAN go is everything that identifies the person: name, email, phone,
   * address, date of birth, licence number, and the uploaded copies of their
   * Emirates ID and passport. What stays is the shape of the transactions -
   * dates, amounts, which car - with nobody's name on them.
   *
   * WHAT IT REFUSES. A customer with a car out, money owed, or a deposit still
   * held is not erasable: there would be no way to chase, refund or even
   * identify them afterwards. The message says which of the three it is, so
   * the request can be honoured once that is settled rather than simply
   * denied.
   *
   * IT CANNOT BE UNDONE, and the audit log keeps only the fact that it
   * happened, the customer's id and who authorised it - never the data that
   * was removed, which would defeat the whole exercise.
   */
  async erase(
    customerId: string,
    actor: { id: string; email: string; role: Role; ipAddress?: string; userAgent?: string },
  ) {
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true, userId: true },
    });
    if (!customer) throw ApiError.notFound('Customer not found');

    const userId = customer.userId;

    const [liveRentals, unpaid, heldDeposits] = await Promise.all([
      prisma.rental.count({ where: { returnedAt: null, booking: { customerId: userId } } }),
      prisma.booking.count({
        where: {
          customerId: userId,
          status: { in: ['CONFIRMED', 'PAYMENT_PENDING', 'READY_FOR_PICKUP', 'ACTIVE'] },
        },
      }),
      prisma.securityDeposit.count({
        where: { booking: { customerId: userId }, status: { in: ['HELD', 'PARTIALLY_RELEASED'] } },
      }),
    ]);

    if (liveRentals > 0) {
      throw ApiError.conflict(
        'This customer has a car out. Take the vehicle back before erasing their details - afterwards there would be nobody to contact.',
      );
    }
    if (heldDeposits > 0) {
      throw ApiError.conflict(
        'A deposit is still being held for this customer. Return or forfeit it first; an anonymised customer cannot be refunded.',
      );
    }
    if (unpaid > 0) {
      throw ApiError.conflict(
        'This customer has open bookings. Complete or cancel them before erasing their details.',
      );
    }

    // A placeholder that is unique (the email column is), obviously not real,
    // and carries no trace of who it replaced.
    const token = randomBytes(8).toString('hex');
    const erasedEmail = 'erased-' + token + '@erased.invalid';

    await prisma.$transaction(async (tx) => {
      /*
       * The uploaded identity documents go entirely. These are the scans of an
       * Emirates ID and a passport - the most sensitive thing in the system,
       * and nothing in a tax record depends on them existing.
       *
       * The FILES behind them are not reachable from here; the storage sweep
       * removes keys with no row pointing at them, which is why deleting the
       * rows is enough to schedule the files for removal too.
       */
      await tx.customerDocument.deleteMany({ where: { customerId } });

      await tx.customer.update({
        where: { id: customerId },
        data: {
          dateOfBirth: null,
          nationality: null,
          addressLine1: null,
          addressLine2: null,
          city: null,
          emirate: null,
          country: null,
          emergencyContactName: null,
          emergencyContactPhone: null,
          licenceNumber: null,
          licenceIssuingCountry: null,
          licenceIssueDate: null,
          licenceExpiryDate: null,
          companyName: null,
          companyTrn: null,
          isVerified: false,
          verifiedAt: null,
        },
      });

      await tx.user.update({
        where: { id: userId },
        data: {
          email: erasedEmail,
          fullName: 'Erased customer',
          phone: null,
          country: null,
          // Deactivated, not deleted: the bookings and invoices still point
          // here, and a dangling reference is worse than a dormant account.
          status: 'DEACTIVATED',
          deletedAt: new Date(),
        },
      });

      // Every session ends immediately. An access token issued minutes ago
      // would otherwise keep working under the old identity.
      await tx.refreshToken.deleteMany({ where: { userId } });
    });

    await auditService.record({
      action: 'customer.erased',
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      entityType: 'Customer',
      entityId: customerId,
      // Deliberately nothing about WHO this was. Recording the name here would
      // preserve the very thing that was just erased.
      metadata: { userId },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return {
      erased: true,
      customerId,
      message:
        'Personal details and identity documents removed. Bookings, invoices and payments are kept without a name on them, as tax law requires.',
    };
  },

  async getByIdForStaff(
    customerId: string,
    actor: { id: string; email: string; role: Role },
  ) {
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      include: {
        user: { select: { id: true, fullName: true, email: true, phone: true, country: true, status: true } },
      },
    });
    if (!customer) throw ApiError.notFound('Customer not found');

    // Staff opening a customer file is worth recording: this screen shows an
    // address, a date of birth and links to identity documents.
    await auditService.record({
      action: 'customer.viewed',
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      entityType: 'Customer',
      entityId: customerId,
    });

    return { ...toPublicCustomer(customer), user: customer.user };
  },
};
