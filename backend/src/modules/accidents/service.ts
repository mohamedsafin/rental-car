/**
 * modules/accidents/service.ts
 * ---------------------------------------------------------------------------
 * An accident, from the roadside to the garage bill.
 *
 * =============================================================================
 * WHY THIS IS NOT THE DAMAGE RECORD
 * =============================================================================
 * A `Damage` answers one question: what do we charge this customer for that
 * dent? An accident asks four more that a damage charge has nowhere to put:
 *
 *   - Is there a police report? No UAE insurer pays a claim without one, and
 *     the number is the first thing they ask for.
 *   - What is the excess? The hirer owes it whatever the insurer decides.
 *   - Where is the car, and what is the garage charging?
 *   - How long was it off the road? That is revenue nobody counts, and it is
 *     usually larger than the repair.
 *
 * Forcing all of that into a damage note is how a police report number ends up
 * in free text where no report can find it.
 *
 * The two records are LINKED, not merged: an accident can point at the damage
 * charge it produced, so the customer-facing money and the insurance claim stay
 * connected without pretending to be the same thing.
 */
import { Prisma } from '@prisma/client';
import type { AccidentStatus, Role } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { ApiError } from '../../utils/ApiError';
import { auditService } from '../audit/service';
import { nextDocumentNumber } from '../invoices/numbering';

export interface AccidentActor {
  id: string | null;
  email: string;
  role: Role;
  ipAddress?: string;
  userAgent?: string;
}

export interface CreateAccidentInput {
  vehicleId: string;
  bookingId?: string;
  occurredAt: Date;
  location?: string;
  description: string;
  policeReportNumber?: string;
  policeReportDate?: string;
  insurerName?: string;
  policyNumber?: string;
  excessAmount?: string;
  garageName?: string;
  repairEstimate?: string;
  offRoadFrom?: Date;
  notes?: string;
}

export interface UpdateAccidentInput {
  status?: AccidentStatus;
  location?: string;
  description?: string;
  policeReportNumber?: string;
  policeReportDate?: string;
  insurerName?: string;
  policyNumber?: string;
  claimNumber?: string;
  claimSubmittedAt?: Date;
  claimSettledAt?: Date;
  claimPaidAmount?: string;
  excessAmount?: string;
  customerLiability?: string;
  garageName?: string;
  repairEstimate?: string;
  repairCost?: string;
  offRoadFrom?: Date;
  offRoadUntil?: Date;
  notes?: string;
  damageId?: string;
}

const decimal = (value: string | undefined | null) =>
  value === undefined || value === null || value === '' ? null : new Prisma.Decimal(value);

const dateOnly = (value: string | undefined) => (value ? new Date(value) : null);

export const accidentsService = {
  /**
   * Report an accident.
   *
   * The insurer's details are copied from the vehicle's live policy rather
   * than typed, because the policy in force on the day of the accident is the
   * one that pays - and a month later nobody remembers which that was.
   */
  async create(input: CreateAccidentInput, actor: AccidentActor) {
    const vehicle = await prisma.vehicle.findUnique({
      where: { id: input.vehicleId },
      select: {
        id: true,
        registrationNumber: true,
        deletedAt: true,
        insuranceRecords: {
          where: { isActive: true },
          orderBy: { expiryDate: 'desc' },
          take: 1,
          select: { provider: true, policyNumber: true, excessAmount: true },
        },
      },
    });
    if (!vehicle || vehicle.deletedAt) throw ApiError.notFound('That vehicle does not exist');

    if (input.bookingId) {
      const booking = await prisma.booking.findUnique({
        where: { id: input.bookingId },
        select: { vehicleId: true, bookingNumber: true },
      });
      if (!booking) throw ApiError.badRequest('That booking does not exist');
      if (booking.vehicleId !== input.vehicleId) {
        throw ApiError.badRequest(
          `Booking ${booking.bookingNumber} is for a different vehicle. An accident belongs to the car it happened to.`,
        );
      }
    }

    const policy = vehicle.insuranceRecords[0] ?? null;

    const accident = await prisma.$transaction(async (tx) => {
      const reference = await nextDocumentNumber(tx, 'accident');

      return tx.accidentReport.create({
        data: {
          reference,
          vehicleId: input.vehicleId,
          bookingId: input.bookingId ?? null,
          status: 'REPORTED',
          occurredAt: input.occurredAt,
          location: input.location ?? null,
          description: input.description,
          policeReportNumber: input.policeReportNumber ?? null,
          policeReportDate: dateOnly(input.policeReportDate),
          // Typed values win; the policy fills the gaps.
          insurerName: input.insurerName ?? policy?.provider ?? null,
          policyNumber: input.policyNumber ?? policy?.policyNumber ?? null,
          excessAmount: decimal(input.excessAmount) ?? policy?.excessAmount ?? null,
          garageName: input.garageName ?? null,
          repairEstimate: decimal(input.repairEstimate),
          // The car stops earning the moment it is damaged, not the moment
          // somebody gets round to typing it in.
          offRoadFrom: input.offRoadFrom ?? input.occurredAt,
          notes: input.notes ?? null,
          reportedById: actor.id,
        },
      });
    });

    await auditService.record({
      action: 'accident.reported',
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      entityType: 'AccidentReport',
      entityId: accident.id,
      metadata: { reference: accident.reference, plate: vehicle.registrationNumber },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return toPublicAccident(accident);
  },

  /**
   * Update a claim as it moves along.
   *
   * Everything is optional because a claim is filled in over weeks: the police
   * report on day one, the claim number a week later, the garage bill after
   * that. A form that demanded them together would be filled in once, at the
   * end, from memory.
   */
  async update(id: string, input: UpdateAccidentInput, actor: AccidentActor) {
    const existing = await prisma.accidentReport.findUnique({ where: { id } });
    if (!existing) throw ApiError.notFound('That accident report does not exist');

    if (existing.status === 'CLOSED' && input.status !== undefined && input.status !== 'CLOSED') {
      throw ApiError.conflict('This claim is closed. Reopening it is not something to do quietly.');
    }

    /*
     * A claim cannot be submitted without a police report number.
     *
     * Not a formality: a UAE insurer will not open a file without one, so a
     * claim marked submitted with no report number is a claim that was never
     * really submitted - and the record would say otherwise for months before
     * anybody noticed.
     */
    const reportNumber = input.policeReportNumber ?? existing.policeReportNumber;
    if (input.status === 'CLAIM_SUBMITTED' && !reportNumber) {
      throw ApiError.badRequest(
        'Record the police report number first. No UAE insurer opens a claim without one.',
      );
    }

    const data: Prisma.AccidentReportUpdateInput = {
      ...(input.status !== undefined && { status: input.status }),
      ...(input.location !== undefined && { location: input.location }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.policeReportNumber !== undefined && { policeReportNumber: input.policeReportNumber }),
      ...(input.policeReportDate !== undefined && { policeReportDate: dateOnly(input.policeReportDate) }),
      ...(input.insurerName !== undefined && { insurerName: input.insurerName }),
      ...(input.policyNumber !== undefined && { policyNumber: input.policyNumber }),
      ...(input.claimNumber !== undefined && { claimNumber: input.claimNumber }),
      ...(input.claimSubmittedAt !== undefined && { claimSubmittedAt: input.claimSubmittedAt }),
      ...(input.claimSettledAt !== undefined && { claimSettledAt: input.claimSettledAt }),
      ...(input.claimPaidAmount !== undefined && { claimPaidAmount: decimal(input.claimPaidAmount) }),
      ...(input.excessAmount !== undefined && { excessAmount: decimal(input.excessAmount) }),
      ...(input.customerLiability !== undefined && {
        customerLiability: decimal(input.customerLiability),
      }),
      ...(input.garageName !== undefined && { garageName: input.garageName }),
      ...(input.repairEstimate !== undefined && { repairEstimate: decimal(input.repairEstimate) }),
      ...(input.repairCost !== undefined && { repairCost: decimal(input.repairCost) }),
      ...(input.offRoadFrom !== undefined && { offRoadFrom: input.offRoadFrom }),
      ...(input.offRoadUntil !== undefined && { offRoadUntil: input.offRoadUntil }),
      ...(input.notes !== undefined && { notes: input.notes }),
      ...(input.damageId !== undefined && { damage: { connect: { id: input.damageId } } }),
    };

    /*
     * Marking a claim submitted stamps the date if nobody typed one, and the
     * same for settlement. Otherwise "submitted" would be a status with no
     * date behind it, and "how long has the insurer had this?" - the question
     * that actually gets asked - would be unanswerable.
     */
    if (input.status === 'CLAIM_SUBMITTED' && !existing.claimSubmittedAt && !input.claimSubmittedAt) {
      data.claimSubmittedAt = new Date();
    }
    if (input.status === 'COMPLETED' && !existing.offRoadUntil && !input.offRoadUntil) {
      data.offRoadUntil = new Date();
    }

    const updated = await prisma.accidentReport.update({ where: { id }, data });

    /*
     * The repair cost posts to the vehicle's expense ledger, once.
     *
     * This is the other half of "which of my cars makes money": a car that
     * costs 9,000 in body repairs twice a year is not the earner its rental
     * revenue suggests. `sourceType`/`sourceId` are unique together, so
     * correcting the figure updates the same row rather than adding a second.
     */
    if (updated.repairCost && !updated.repairCost.isZero()) {
      await prisma.vehicleExpense.upsert({
        where: { sourceType_sourceId: { sourceType: 'AccidentReport', sourceId: updated.id } },
        create: {
          vehicleId: updated.vehicleId,
          type: 'ACCIDENT',
          amount: updated.repairCost,
          currency: updated.currency,
          incurredAt: updated.occurredAt,
          description: `Accident ${updated.reference}${updated.garageName ? ` - ${updated.garageName}` : ''}`,
          supplier: updated.garageName,
          sourceType: 'AccidentReport',
          sourceId: updated.id,
          recordedById: actor.id,
        },
        update: {
          amount: updated.repairCost,
          supplier: updated.garageName,
          description: `Accident ${updated.reference}${updated.garageName ? ` - ${updated.garageName}` : ''}`,
        },
      });
    }

    await auditService.record({
      action: 'accident.updated',
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      entityType: 'AccidentReport',
      entityId: id,
      metadata: {
        reference: updated.reference,
        ...(input.status ? { status: input.status } : {}),
      },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return toPublicAccident(updated);
  },

  async list(query: { page: number; limit: number; status?: AccidentStatus; vehicleId?: string }) {
    const where: Prisma.AccidentReportWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.vehicleId ? { vehicleId: query.vehicleId } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.accidentReport.findMany({
        where,
        include: {
          vehicle: { select: { brand: true, model: true, registrationNumber: true } },
          booking: { select: { bookingNumber: true, customer: { select: { fullName: true } } } },
        },
        orderBy: { occurredAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      prisma.accidentReport.count({ where }),
    ]);

    return { items: items.map(toPublicAccident), total };
  },

  async getById(id: string) {
    const accident = await prisma.accidentReport.findUnique({
      where: { id },
      include: {
        vehicle: { select: { brand: true, model: true, registrationNumber: true } },
        booking: { select: { bookingNumber: true, customer: { select: { fullName: true } } } },
      },
    });
    if (!accident) throw ApiError.notFound('That accident report does not exist');
    return toPublicAccident(accident);
  },
};

type AccidentRow = Prisma.AccidentReportGetPayload<object> & {
  vehicle?: { brand: string; model: string; registrationNumber: string };
  booking?: { bookingNumber: string; customer: { fullName: string } } | null;
};

/**
 * Days the car has not been earning.
 *
 * Counted to today while it is still off the road, because "14 days so far" is
 * the number that makes somebody chase the garage. A null `offRoadFrom` means
 * nobody recorded it, which is different from zero days.
 */
function offRoadDays(from: Date | null, until: Date | null): number | null {
  if (!from) return null;
  const end = until ?? new Date();
  return Math.max(0, Math.round((end.getTime() - from.getTime()) / 86_400_000));
}

export function toPublicAccident(accident: AccidentRow) {
  const money = (value: Prisma.Decimal | null) => (value ? value.toFixed(2) : null);

  return {
    id: accident.id,
    reference: accident.reference,
    status: accident.status,

    vehicleId: accident.vehicleId,
    vehicle: accident.vehicle
      ? {
          name: `${accident.vehicle.brand} ${accident.vehicle.model}`,
          registrationNumber: accident.vehicle.registrationNumber,
        }
      : null,
    bookingId: accident.bookingId,
    bookingNumber: accident.booking?.bookingNumber ?? null,
    customerName: accident.booking?.customer.fullName ?? null,

    occurredAt: accident.occurredAt.toISOString(),
    location: accident.location,
    description: accident.description,

    policeReportNumber: accident.policeReportNumber,
    policeReportDate: accident.policeReportDate?.toISOString().slice(0, 10) ?? null,

    insurerName: accident.insurerName,
    policyNumber: accident.policyNumber,
    claimNumber: accident.claimNumber,
    claimSubmittedAt: accident.claimSubmittedAt?.toISOString() ?? null,
    claimSettledAt: accident.claimSettledAt?.toISOString() ?? null,
    claimPaidAmount: money(accident.claimPaidAmount),

    excessAmount: money(accident.excessAmount),
    customerLiability: money(accident.customerLiability),

    garageName: accident.garageName,
    repairEstimate: money(accident.repairEstimate),
    repairCost: money(accident.repairCost),
    currency: accident.currency,

    offRoadFrom: accident.offRoadFrom?.toISOString() ?? null,
    offRoadUntil: accident.offRoadUntil?.toISOString() ?? null,
    offRoadDays: offRoadDays(accident.offRoadFrom, accident.offRoadUntil),

    damageId: accident.damageId,
    notes: accident.notes,
    createdAt: accident.createdAt.toISOString(),
  };
}
