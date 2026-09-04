/**
 * modules/fleet/maintenanceService.ts
 * ---------------------------------------------------------------------------
 * Maintenance scheduling (BRD 39) and expiry tracking (BRD 40, 41).
 *
 * The key idea: maintenance is a DATE RANGE, not a flag. BRD 39 says a vehicle
 * "can automatically be marked unavailable while under maintenance", and a
 * range expresses that far better - a car booked in for a service on the 20th
 * is available on the 10th, and the availability engine can see that. A status
 * flag can only say "off the road", indefinitely and invisibly.
 *
 * Scheduling maintenance therefore CHECKS for bookings it would break, and
 * refuses rather than silently stranding a customer who has already paid.
 */
import { Prisma } from '@prisma/client';
import type { MaintenanceStatus, MaintenanceType } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { ApiError, ErrorCode } from '../../utils/ApiError';
import { auditService } from '../audit/service';
import { blockingBookingsWhere } from '../availability/service';
import { SettingKey, settingsService } from '../settings/service';
import type { FleetActor } from '../damages/service';

export const maintenanceService = {
  /**
   * Book a vehicle in for work.
   *
   * Refuses if a live booking overlaps the window. Taking a car off the road
   * when someone has paid to collect it on Friday is a decision that needs a
   * human to make it deliberately - by cancelling that booking first - not
   * something a scheduling form should do quietly.
   */
  async schedule(
    input: {
      vehicleId: string;
      type: MaintenanceType;
      startsAt: Date;
      endsAt: Date;
      description: string;
      provider?: string;
      mileage?: number;
      cost?: string;
      nextServiceAt?: Date;
      nextServiceMileage?: number;
      notes?: string;
    },
    actor: FleetActor,
  ) {
    if (input.endsAt <= input.startsAt) {
      throw ApiError.badRequest('The maintenance window must end after it starts');
    }

    const vehicle = await prisma.vehicle.findFirst({
      where: { id: input.vehicleId, deletedAt: null },
    });
    if (!vehicle) throw ApiError.notFound('Vehicle not found');

    const bufferHours = await settingsService.getNumberOr(SettingKey.TURNAROUND_BUFFER_HOURS, 0);

    const clash = await prisma.booking.findFirst({
      where: {
        vehicleId: input.vehicleId,
        ...blockingBookingsWhere({ pickupAt: input.startsAt, returnAt: input.endsAt }, bufferHours),
      },
      select: { bookingNumber: true, pickupAt: true, returnAt: true },
    });

    if (clash) {
      throw new ApiError(
        409,
        `Booking ${clash.bookingNumber} runs from ${clash.pickupAt.toISOString().slice(0, 10)} to ${clash.returnAt
          .toISOString()
          .slice(0, 10)} and would clash. Cancel or move it first.`,
        ErrorCode.CONFLICT,
      );
    }

    const record = await prisma.maintenanceRecord.create({
      data: {
        vehicleId: input.vehicleId,
        type: input.type,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        description: input.description,
        provider: input.provider ?? null,
        mileage: input.mileage ?? null,
        cost: input.cost ? new Prisma.Decimal(input.cost) : null,
        nextServiceAt: input.nextServiceAt ?? null,
        nextServiceMileage: input.nextServiceMileage ?? null,
        notes: input.notes ?? null,
        status: 'SCHEDULED',
        createdById: actor.id,
      },
    });

    await auditService.record({
      action: 'maintenance.scheduled',
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      entityType: 'MaintenanceRecord',
      entityId: record.id,
      metadata: {
        vehicleId: input.vehicleId,
        type: input.type,
        from: input.startsAt.toISOString(),
        to: input.endsAt.toISOString(),
      },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return toPublicMaintenance(record);
  },

  /**
   * Move maintenance through its states.
   *
   * Completing or cancelling frees the window immediately - the record stops
   * blocking availability the moment it is no longer SCHEDULED or IN_PROGRESS,
   * so a service that finished early releases the car without anyone editing
   * dates.
   */
  async updateStatus(id: string, status: MaintenanceStatus, actor: FleetActor) {
    const record = await prisma.maintenanceRecord.findUnique({ where: { id } });
    if (!record) throw ApiError.notFound('Maintenance record not found');

    const updated = await prisma.maintenanceRecord.update({
      where: { id },
      data: {
        status,
        // A job that finished early should stop blocking now, not on the date
        // someone typed in a week ago.
        ...(status === 'COMPLETED' && record.endsAt > new Date() ? { endsAt: new Date() } : {}),
      },
    });

    await auditService.record({
      action: 'maintenance.status_changed',
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      entityType: 'MaintenanceRecord',
      entityId: id,
      metadata: { from: record.status, to: status },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return toPublicMaintenance(updated);
  },

  async list(query: { page: number; limit: number; vehicleId?: string; status?: MaintenanceStatus }) {
    const where = {
      ...(query.vehicleId ? { vehicleId: query.vehicleId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };

    const [items, total] = await prisma.$transaction([
      prisma.maintenanceRecord.findMany({
        where,
        include: { vehicle: { select: { brand: true, model: true, registrationNumber: true } } },
        orderBy: { startsAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      prisma.maintenanceRecord.count({ where }),
    ]);

    return {
      items: items.map((record) => ({
        ...toPublicMaintenance(record),
        vehicle: `${record.vehicle.brand} ${record.vehicle.model} (${record.vehicle.registrationNumber})`,
      })),
      total,
    };
  },
};

function toPublicMaintenance(record: {
  id: string;
  vehicleId: string;
  type: MaintenanceType;
  status: MaintenanceStatus;
  startsAt: Date;
  endsAt: Date;
  description: string;
  provider: string | null;
  mileage: number | null;
  cost: Prisma.Decimal | null;
  currency: string;
  nextServiceAt: Date | null;
  nextServiceMileage: number | null;
  notes: string | null;
}) {
  return {
    id: record.id,
    vehicleId: record.vehicleId,
    type: record.type,
    status: record.status,
    startsAt: record.startsAt.toISOString(),
    endsAt: record.endsAt.toISOString(),
    description: record.description,
    provider: record.provider,
    mileage: record.mileage,
    cost: record.cost?.toFixed(2) ?? null,
    currency: record.currency,
    nextServiceAt: record.nextServiceAt?.toISOString() ?? null,
    nextServiceMileage: record.nextServiceMileage,
    notes: record.notes,
  };
}
