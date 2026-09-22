/**
 * modules/vehicles/service.ts
 * ---------------------------------------------------------------------------
 * Fleet business logic (BRD 36).
 *
 * Rules enforced here, none of which the database can express on its own:
 *
 *  - A registration number is unique across the live fleet. BRD 41 requires it,
 *    and two cars sharing a plate would make fines and tolls unassignable.
 *  - The category must exist and be active before a vehicle can point at it.
 *  - Exactly one image per vehicle is primary; promoting one demotes the rest.
 *  - Deleting is soft. A vehicle with rental history must never disappear.
 */
import { Prisma } from '@prisma/client';
import type { Role } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { ApiError } from '../../utils/ApiError';
import { auditService } from '../audit/service';
import { toPublicVehicle, type PublicVehicle } from './types';
import { vehiclesRepository } from './repository';
import type { CreateVehicleInput, ListVehiclesQuery, UpdateVehicleInput } from './validation';

export interface FleetActor {
  id: string;
  email: string;
  role: Role;
  ipAddress?: string;
  userAgent?: string;
}

/** Money arrives as a validated string; Prisma.Decimal keeps it exact. */
function decimal(value: string | undefined): Prisma.Decimal | undefined {
  return value === undefined ? undefined : new Prisma.Decimal(value);
}

async function assertCategoryUsable(categoryId: string): Promise<void> {
  const category = await prisma.vehicleCategory.findFirst({
    where: { id: categoryId, deletedAt: null },
  });
  if (!category) throw ApiError.badRequest('Selected category does not exist');
  if (!category.isActive) throw ApiError.badRequest('Selected category is not active');
}

async function assertLocationUsable(locationId: string): Promise<void> {
  const location = await prisma.location.findFirst({ where: { id: locationId, deletedAt: null } });
  if (!location) throw ApiError.badRequest('Selected location does not exist');
}

/**
 * A chassis number identifies one physical car, so two rows cannot share one.
 *
 * The database already refuses it; this turns that refusal into a sentence
 * that names the other car, because "unique constraint violated" tells the
 * person at the desk nothing about which record to go and look at.
 */
async function assertVinFree(vin: string): Promise<void> {
  const duplicate = await prisma.vehicle.findFirst({
    where: { vin, deletedAt: null },
    select: { registrationNumber: true },
  });
  if (duplicate) {
    throw ApiError.conflict(
      `Chassis number ${vin} is already on ${duplicate.registrationNumber}. Two cars cannot share one.`,
    );
  }
}

async function assertFeaturesExist(featureIds: string[]): Promise<void> {
  if (featureIds.length === 0) return;
  const found = await vehiclesRepository.countFeatures(featureIds);
  if (found !== featureIds.length) {
    throw ApiError.badRequest('One or more selected features do not exist');
  }
}

export const vehiclesService = {
  async list(query: ListVehiclesQuery, isAdmin: boolean) {
    const { items, total } = await vehiclesRepository.list(query, isAdmin);
    const vehicles = await Promise.all(items.map((item) => toPublicVehicle(item, isAdmin)));
    return { items: vehicles, total };
  },

  async getById(id: string, isAdmin: boolean): Promise<PublicVehicle> {
    const vehicle = await vehiclesRepository.findById(id, isAdmin);
    if (!vehicle) throw ApiError.notFound('Vehicle not found');
    return toPublicVehicle(vehicle, isAdmin);
  },

  async create(input: CreateVehicleInput, actor: FleetActor): Promise<PublicVehicle> {
    const duplicate = await vehiclesRepository.findByRegistration(input.registrationNumber);
    if (duplicate) {
      throw ApiError.conflict(
        `A vehicle with registration ${input.registrationNumber} already exists`,
      );
    }

    if (input.vin) await assertVinFree(input.vin);

    await assertCategoryUsable(input.categoryId);
    if (input.locationId) await assertLocationUsable(input.locationId);
    await assertFeaturesExist(input.featureIds);

    const { categoryId, locationId, featureIds, ...rest } = input;

    const vehicle = await vehiclesRepository.create(
      {
        ...rest,
        dailyPrice: decimal(rest.dailyPrice) as Prisma.Decimal,
        weeklyPrice: decimal(rest.weeklyPrice) ?? null,
        monthlyPrice: decimal(rest.monthlyPrice) ?? null,
        securityDeposit: decimal(rest.securityDeposit) as Prisma.Decimal,
        extraMileageCharge: decimal(rest.extraMileageCharge) ?? null,
        mileageLimitPerDay: rest.mileageLimitPerDay ?? null,
        vin: rest.vin ?? null,
        purchasePrice: decimal(rest.purchasePrice) ?? null,
        // A day, not an instant: nobody records the hour a car was bought.
        purchaseDate: rest.purchaseDate ? new Date(rest.purchaseDate) : null,
        currentValue: decimal(rest.currentValue) ?? null,
        variant: rest.variant ?? null,
        color: rest.color ?? null,
        description: rest.description ?? null,
        category: { connect: { id: categoryId } },
        ...(locationId ? { location: { connect: { id: locationId } } } : {}),
      },
      featureIds,
    );

    await auditService.record({
      action: 'vehicle.created',
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      entityType: 'Vehicle',
      entityId: vehicle.id,
      metadata: { registrationNumber: vehicle.registrationNumber },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return toPublicVehicle(vehicle, true);
  },

  async update(id: string, input: UpdateVehicleInput, actor: FleetActor): Promise<PublicVehicle> {
    const existing = await vehiclesRepository.findById(id, true);
    if (!existing) throw ApiError.notFound('Vehicle not found');

    if (input.registrationNumber && input.registrationNumber !== existing.registrationNumber) {
      const duplicate = await vehiclesRepository.findByRegistration(input.registrationNumber);
      if (duplicate) {
        throw ApiError.conflict(
          `A vehicle with registration ${input.registrationNumber} already exists`,
        );
      }
    }

    if (input.vin && input.vin !== existing.vin) await assertVinFree(input.vin);

    if (input.categoryId) await assertCategoryUsable(input.categoryId);
    if (input.locationId) await assertLocationUsable(input.locationId);
    if (input.featureIds) await assertFeaturesExist(input.featureIds);

    const { categoryId, locationId, featureIds, ...rest } = input;

    const vehicle = await vehiclesRepository.update(
      id,
      {
        ...rest,
        ...(rest.dailyPrice !== undefined && { dailyPrice: decimal(rest.dailyPrice) }),
        ...(rest.weeklyPrice !== undefined && { weeklyPrice: decimal(rest.weeklyPrice) }),
        ...(rest.monthlyPrice !== undefined && { monthlyPrice: decimal(rest.monthlyPrice) }),
        ...(rest.securityDeposit !== undefined && {
          securityDeposit: decimal(rest.securityDeposit),
        }),
        ...(rest.extraMileageCharge !== undefined && {
          extraMileageCharge: decimal(rest.extraMileageCharge),
        }),
        ...(rest.purchasePrice !== undefined && { purchasePrice: decimal(rest.purchasePrice) }),
        ...(rest.purchaseDate !== undefined && {
          purchaseDate: rest.purchaseDate ? new Date(rest.purchaseDate) : null,
        }),
        ...(rest.currentValue !== undefined && { currentValue: decimal(rest.currentValue) }),
        ...(categoryId ? { category: { connect: { id: categoryId } } } : {}),
        ...(locationId ? { location: { connect: { id: locationId } } } : {}),
      },
      featureIds,
    );

    await auditService.record({
      action: 'vehicle.updated',
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      entityType: 'Vehicle',
      entityId: id,
      metadata: { fields: Object.keys(input) },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return toPublicVehicle(vehicle, true);
  },

  async remove(id: string, actor: FleetActor): Promise<void> {
    const vehicle = await vehiclesRepository.findById(id, true);
    if (!vehicle) throw ApiError.notFound('Vehicle not found');

    // Phase 6 adds a check for future bookings here: a car someone has already
    // paid to collect on Friday must not be removable with one click.
    await vehiclesRepository.softDelete(id);

    await auditService.record({
      action: 'vehicle.deleted',
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      entityType: 'Vehicle',
      entityId: id,
      metadata: { registrationNumber: vehicle.registrationNumber },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
  },
};
