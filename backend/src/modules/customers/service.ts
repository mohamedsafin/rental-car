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
import type { Prisma, ResidencyStatus } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { ApiError } from '../../utils/ApiError';
import { auditService } from '../audit/service';
import { evaluateRequirements } from './requirements';
import { toPublicCustomer, type PublicCustomer, type VerificationSummary } from './types';
import type { UpdateCustomerProfileInput } from './validation';

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
        residencyStatus: input.residencyStatus as ResidencyStatus,
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
  async getVerificationSummary(customerId: string): Promise<VerificationSummary> {
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

  async getByIdForStaff(
    customerId: string,
    actor: { id: string; email: string; role: 'ADMIN' | 'STAFF' | 'CUSTOMER' },
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
