/**
 * modules/locations/service.ts
 * ---------------------------------------------------------------------------
 * Pickup, drop-off and delivery points (BRD 38).
 *
 * Like categories, a location in use cannot be deleted - vehicles are assigned
 * to one, and Phase 6 bookings will reference them as pickup and drop-off
 * points. Deactivating removes it from the customer's dropdown while keeping
 * every historical booking readable.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { ApiError } from '../../utils/ApiError';
import { slugify } from '../../utils/slug';
import type { CreateLocationInput, ListLocationsQuery, UpdateLocationInput } from './validation';

async function uniqueSlug(name: string, excludeId?: string): Promise<string> {
  const base = slugify(name);
  if (!base) throw ApiError.badRequest('Location name must contain letters or numbers');

  let candidate = base;
  let suffix = 2;

  for (;;) {
    const existing = await prisma.location.findUnique({ where: { slug: candidate } });
    if (!existing || existing.id === excludeId) return candidate;
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
}

/** Decimals and JSON out of Prisma are not directly JSON-friendly. */
function toPublicLocation(location: Prisma.LocationGetPayload<object>) {
  return {
    id: location.id,
    name: location.name,
    slug: location.slug,
    type: location.type,
    address: location.address,
    emirate: location.emirate,
    phone: location.phone,
    email: location.email,
    workingHours: location.workingHours,
    latitude: location.latitude?.toString() ?? null,
    longitude: location.longitude?.toString() ?? null,
    deliveryCharge: location.deliveryCharge.toFixed(2),
    isPickupPoint: location.isPickupPoint,
    isDropoffPoint: location.isDropoffPoint,
    isActive: location.isActive,
  };
}

function toData(input: CreateLocationInput | UpdateLocationInput) {
  return {
    ...(input.name !== undefined && { name: input.name }),
    ...(input.type !== undefined && { type: input.type }),
    ...(input.address !== undefined && { address: input.address }),
    ...(input.emirate !== undefined && { emirate: input.emirate }),
    ...(input.phone !== undefined && { phone: input.phone }),
    ...(input.email !== undefined && { email: input.email }),
    ...(input.workingHours !== undefined && {
      workingHours: input.workingHours as Prisma.InputJsonValue,
    }),
    ...(input.latitude !== undefined && { latitude: new Prisma.Decimal(input.latitude) }),
    ...(input.longitude !== undefined && { longitude: new Prisma.Decimal(input.longitude) }),
    ...(input.deliveryCharge !== undefined && {
      deliveryCharge: new Prisma.Decimal(input.deliveryCharge),
    }),
    ...(input.isPickupPoint !== undefined && { isPickupPoint: input.isPickupPoint }),
    ...(input.isDropoffPoint !== undefined && { isDropoffPoint: input.isDropoffPoint }),
    ...(input.isActive !== undefined && { isActive: input.isActive }),
  };
}

export const locationsService = {
  async list(query: ListLocationsQuery) {
    const locations = await prisma.location.findMany({
      where: {
        deletedAt: null,
        ...(query.includeInactive ? {} : { isActive: true }),
        ...(query.type ? { type: query.type } : {}),
        ...(query.pickupOnly ? { isPickupPoint: true } : {}),
      },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    });
    return locations.map(toPublicLocation);
  },

  async getById(id: string) {
    const location = await prisma.location.findFirst({ where: { id, deletedAt: null } });
    if (!location) throw ApiError.notFound('Location not found');
    return toPublicLocation(location);
  },

  async create(input: CreateLocationInput) {
    const location = await prisma.location.create({
      data: {
        ...toData(input),
        name: input.name,
        slug: await uniqueSlug(input.name),
      },
    });
    return toPublicLocation(location);
  },

  async update(id: string, input: UpdateLocationInput) {
    await locationsService.getById(id);

    const location = await prisma.location.update({
      where: { id },
      data: {
        ...toData(input),
        ...(input.name ? { slug: await uniqueSlug(input.name, id) } : {}),
      },
    });
    return toPublicLocation(location);
  },

  async remove(id: string) {
    await locationsService.getById(id);

    const vehicleCount = await prisma.vehicle.count({ where: { locationId: id, deletedAt: null } });
    if (vehicleCount > 0) {
      throw ApiError.conflict(
        `Cannot delete this location: ${vehicleCount} vehicle(s) are assigned to it. Deactivate it instead.`,
      );
    }

    await prisma.location.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  },
};
