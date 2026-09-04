/**
 * modules/vehicles/repository.ts
 * ---------------------------------------------------------------------------
 * Prisma queries for the fleet. The filter builder here is the interesting
 * part: it turns the customer site's query string into a WHERE clause, and it
 * is where the public/admin visibility rule is enforced in ONE place.
 */
import type { Prisma, Vehicle } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { vehicleInclude, type VehicleWithRelations } from './types';
import type { ListVehiclesQuery } from './validation';

type SortOption = ListVehiclesQuery['sort'];

function orderBy(sort: SortOption): Prisma.VehicleOrderByWithRelationInput[] {
  switch (sort) {
    case 'price_asc':
      return [{ dailyPrice: 'asc' }];
    case 'price_desc':
      return [{ dailyPrice: 'desc' }];
    case 'year_desc':
      return [{ year: 'desc' }];
    case 'newest':
    default:
      // Featured cars first, then newest - what the home page wants (BRD 5).
      return [{ isFeatured: 'desc' }, { createdAt: 'desc' }];
  }
}

/**
 * @param isAdmin  When false, unpublished vehicles are invisible no matter what
 *   the query string asks for. Putting this in the builder rather than the
 *   controller means no future endpoint can forget it.
 */
function buildWhere(query: ListVehiclesQuery, isAdmin: boolean): Prisma.VehicleWhereInput {
  const priceFilter: Prisma.DecimalFilter = {};
  if (query.minPrice !== undefined) priceFilter.gte = query.minPrice;
  if (query.maxPrice !== undefined) priceFilter.lte = query.maxPrice;

  return {
    deletedAt: null,
    ...(isAdmin && query.includeUnpublished ? {} : { isPublished: true }),
    ...(query.categoryId ? { categoryId: query.categoryId } : {}),
    ...(query.category ? { category: { slug: query.category } } : {}),
    ...(query.transmission ? { transmission: query.transmission } : {}),
    ...(query.fuelType ? { fuelType: query.fuelType } : {}),
    ...(query.seats ? { seats: { gte: query.seats } } : {}),
    ...(query.locationId ? { locationId: query.locationId } : {}),
    ...(Object.keys(priceFilter).length > 0 ? { dailyPrice: priceFilter } : {}),
    ...(isAdmin && query.status ? { status: query.status } : {}),
    ...(query.search
      ? {
          OR: [
            { brand: { contains: query.search, mode: 'insensitive' as const } },
            { model: { contains: query.search, mode: 'insensitive' as const } },
            { variant: { contains: query.search, mode: 'insensitive' as const } },
            // Admins search by plate; customers have no reason to, and the
            // registration number is not returned to them anyway.
            ...(isAdmin
              ? [{ registrationNumber: { contains: query.search, mode: 'insensitive' as const } }]
              : []),
          ],
        }
      : {}),
  };
}

export const vehiclesRepository = {
  /**
   * @param extraWhere  Additional constraints merged into the filter. The
   *   availability search uses it to exclude vehicles already booked, without
   *   this module needing to know anything about bookings.
   */
  async list(
    query: ListVehiclesQuery,
    isAdmin: boolean,
    extraWhere?: Prisma.VehicleWhereInput,
  ): Promise<{ items: VehicleWithRelations[]; total: number }> {
    const where: Prisma.VehicleWhereInput = { ...buildWhere(query, isAdmin), ...(extraWhere ?? {}) };

    // One transaction for page + count, so the total always matches the page.
    const [items, total] = await prisma.$transaction([
      prisma.vehicle.findMany({
        where,
        include: vehicleInclude,
        orderBy: orderBy(query.sort),
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      prisma.vehicle.count({ where }),
    ]);

    return { items: items as VehicleWithRelations[], total };
  },

  async findById(id: string, isAdmin: boolean): Promise<VehicleWithRelations | null> {
    const vehicle = await prisma.vehicle.findFirst({
      where: { id, deletedAt: null, ...(isAdmin ? {} : { isPublished: true }) },
      include: vehicleInclude,
    });
    return vehicle as VehicleWithRelations | null;
  },

  findByRegistration(registrationNumber: string): Promise<Vehicle | null> {
    return prisma.vehicle.findFirst({ where: { registrationNumber, deletedAt: null } });
  },

  async create(
    data: Prisma.VehicleCreateInput,
    featureIds: string[],
  ): Promise<VehicleWithRelations> {
    const vehicle = await prisma.vehicle.create({
      data: {
        ...data,
        ...(featureIds.length > 0
          ? { features: { create: featureIds.map((featureId) => ({ featureId })) } }
          : {}),
      },
      include: vehicleInclude,
    });
    return vehicle as VehicleWithRelations;
  },

  /**
   * Update, replacing the feature set when one is supplied.
   *
   * The delete-then-recreate runs inside a transaction: without it, a failure
   * between the two statements would leave the vehicle with NO features rather
   * than its old ones.
   */
  async update(
    id: string,
    data: Prisma.VehicleUpdateInput,
    featureIds?: string[],
  ): Promise<VehicleWithRelations> {
    const vehicle = await prisma.$transaction(async (tx) => {
      if (featureIds) {
        await tx.vehicleFeatureOnVehicle.deleteMany({ where: { vehicleId: id } });
        if (featureIds.length > 0) {
          await tx.vehicleFeatureOnVehicle.createMany({
            data: featureIds.map((featureId) => ({ vehicleId: id, featureId })),
          });
        }
      }
      return tx.vehicle.update({ where: { id }, data, include: vehicleInclude });
    });

    return vehicle as VehicleWithRelations;
  },

  softDelete(id: string): Promise<Vehicle> {
    return prisma.vehicle.update({
      where: { id },
      data: { deletedAt: new Date(), isPublished: false, status: 'UNAVAILABLE' },
    });
  },

  countFeatures(ids: string[]): Promise<number> {
    return prisma.vehicleFeature.count({ where: { id: { in: ids }, isActive: true } });
  },
};
