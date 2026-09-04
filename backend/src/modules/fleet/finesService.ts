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
import type { ChargeRecoveryStatus } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { ApiError } from '../../utils/ApiError';
import { auditService } from '../audit/service';
import type { FleetActor } from '../damages/service';

/** Bookings that were live at a given instant, for attribution. */
async function findRentalAt(vehicleId: string, at: Date) {
  return prisma.booking.findFirst({
    where: {
      vehicleId,
      pickupAt: { lte: at },
      returnAt: { gte: at },
      status: { in: ['ACTIVE', 'EXTENSION_REQUESTED', 'RETURN_PENDING', 'RETURNED', 'COMPLETED'] },
    },
    select: {
      id: true,
      bookingNumber: true,
      customer: { select: { id: true, fullName: true, email: true } },
    },
  });
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
    const match = await findRentalAt(input.vehicleId, input.violationAt);

    const fine = await prisma.trafficFine.create({
      data: {
        vehicleId: input.vehicleId,
        bookingId: match?.id ?? null,
        fineNumber: input.fineNumber,
        violationAt: input.violationAt,
        violation: input.violation ?? null,
        location: input.location ?? null,
        amount: new Prisma.Decimal(input.amount),
        serviceFee: new Prisma.Decimal(input.serviceFee ?? '0'),
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
      },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return { fine: toPublicFine(fine), matchedCustomer: match?.customer ?? null };
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

    const match = await findRentalAt(input.vehicleId, input.crossedAt);

    const toll = await prisma.tollCharge.create({
      data: {
        vehicleId: input.vehicleId,
        bookingId: match?.id ?? null,
        crossedAt: input.crossedAt,
        gate: input.gate ?? null,
        reference: input.reference ?? null,
        amount: new Prisma.Decimal(input.amount),
        serviceFee: new Prisma.Decimal(input.serviceFee ?? '0'),
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
      metadata: { amount: input.amount, matchedBooking: match?.bookingNumber ?? null },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return { toll: toPublicToll(toll), matchedCustomer: match?.customer ?? null };
  },

  /**
   * Pass a fine or toll on to the customer as a chargeable amount.
   *
   * The authority's amount and the company's handling fee are added into ONE
   * charge, but the description keeps them separate so the customer can see
   * what went to the authority and what went to the rental company. BRD 28 and
   * 29 both call for that split; hiding it invites a dispute.
   */
  async recover(kind: 'fine' | 'toll', id: string, actor: FleetActor) {
    const record =
      kind === 'fine'
        ? await prisma.trafficFine.findUnique({
            where: { id },
            include: { booking: { select: { id: true, bookingNumber: true, currency: true } } },
          })
        : await prisma.tollCharge.findUnique({
            where: { id },
            include: { booking: { select: { id: true, bookingNumber: true, currency: true } } },
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

    const total = record.amount.add(record.serviceFee);
    const label =
      kind === 'fine'
        ? `Traffic fine ${(record as unknown as { fineNumber: string }).fineNumber}`
        : `Toll charge${(record as unknown as { gate: string | null }).gate ? ' (' + (record as unknown as { gate: string | null }).gate + ')' : ''}`;
    const description = `${label}: ${record.amount.toFixed(2)} + ${record.serviceFee.toFixed(2)} handling`;

    const charge = await prisma.$transaction(async (tx) => {
      const created = await tx.additionalCharge.create({
        data: {
          bookingId: record.bookingId!,
          type: 'OTHER',
          amount: total,
          currency: record.booking!.currency,
          description,
          calculation: {
            kind,
            recordId: id,
            authorityAmount: record.amount.toFixed(2),
            companyServiceFee: record.serviceFee.toFixed(2),
            total: total.toFixed(2),
          } as Prisma.InputJsonValue,
          createdById: actor.id,
          status: 'PENDING',
        },
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
      metadata: { bookingNumber: record.booking.bookingNumber, total: total.toFixed(2) },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return { chargeId: charge.id, amount: total.toFixed(2) };
  },

  /** Attribute a fine or toll to a booking by hand, or mark it disputed. */
  async update(
    kind: 'fine' | 'toll',
    id: string,
    input: { bookingId?: string; status?: ChargeRecoveryStatus; notes?: string },
    actor: FleetActor,
  ) {
    const data = {
      ...(input.bookingId !== undefined ? { bookingId: input.bookingId } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
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
          booking: { select: { bookingNumber: true, customer: { select: { fullName: true } } } },
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
          booking: { select: { bookingNumber: true, customer: { select: { fullName: true } } } },
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
