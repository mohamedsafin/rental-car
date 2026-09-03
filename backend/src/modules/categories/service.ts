/**
 * modules/categories/service.ts
 * ---------------------------------------------------------------------------
 * Vehicle categories (BRD 8). Small module, but it establishes two rules the
 * rest of the fleet follows.
 *
 * Rule 1 - the slug is derived, then made unique. Two categories called
 * "Luxury" and "luxury " would otherwise collide on a unique index and surface
 * as a confusing 500.
 *
 * Rule 2 - a category with vehicles cannot be deleted. Deleting it would either
 * orphan those vehicles or cascade and delete the fleet. Deactivating hides it
 * from customers while leaving the data intact.
 */
import { prisma } from '../../config/prisma';
import { ApiError } from '../../utils/ApiError';
import { slugify } from '../../utils/slug';
import type { CreateCategoryInput, ListCategoriesQuery, UpdateCategoryInput } from './validation';

/** Append -2, -3 ... until the slug is free. */
async function uniqueSlug(name: string, excludeId?: string): Promise<string> {
  const base = slugify(name);
  if (!base) throw ApiError.badRequest('Category name must contain letters or numbers');

  let candidate = base;
  let suffix = 2;

  for (;;) {
    const existing = await prisma.vehicleCategory.findUnique({ where: { slug: candidate } });
    if (!existing || existing.id === excludeId) return candidate;
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
}

export const categoriesService = {
  async list(query: ListCategoriesQuery) {
    return prisma.vehicleCategory.findMany({
      where: {
        deletedAt: null,
        ...(query.includeInactive ? {} : { isActive: true }),
      },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
      include: {
        // Lets the admin table show "12 vehicles" without a second query.
        _count: { select: { vehicles: { where: { deletedAt: null } } } },
      },
    });
  },

  async getById(id: string) {
    const category = await prisma.vehicleCategory.findFirst({ where: { id, deletedAt: null } });
    if (!category) throw ApiError.notFound('Category not found');
    return category;
  },

  async create(input: CreateCategoryInput) {
    const existing = await prisma.vehicleCategory.findFirst({
      where: { name: { equals: input.name, mode: 'insensitive' }, deletedAt: null },
    });
    if (existing) throw ApiError.conflict('A category with this name already exists');

    return prisma.vehicleCategory.create({
      data: { ...input, slug: await uniqueSlug(input.name) },
    });
  },

  async update(id: string, input: UpdateCategoryInput) {
    await categoriesService.getById(id);

    return prisma.vehicleCategory.update({
      where: { id },
      data: {
        ...input,
        // Renaming re-derives the slug, so old URLs change. Acceptable here
        // because categories are renamed rarely and are not deep-linked from
        // outside; a booking URL would need a permanent identifier instead.
        ...(input.name ? { slug: await uniqueSlug(input.name, id) } : {}),
      },
    });
  },

  async remove(id: string) {
    await categoriesService.getById(id);

    const vehicleCount = await prisma.vehicle.count({ where: { categoryId: id, deletedAt: null } });
    if (vehicleCount > 0) {
      throw ApiError.conflict(
        `Cannot delete this category: ${vehicleCount} vehicle(s) still use it. Deactivate it instead.`,
      );
    }

    await prisma.vehicleCategory.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  },
};
