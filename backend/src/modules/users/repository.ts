/**
 * modules/users/repository.ts
 * ---------------------------------------------------------------------------
 * Queries for admin user management, including the paginated list.
 */
import type { Prisma, User } from '@prisma/client';
import { prisma } from '../../config/prisma';
import type { ListUsersQuery } from './validation';

function buildWhere(query: ListUsersQuery): Prisma.UserWhereInput {
  return {
    deletedAt: null,
    ...(query.role ? { role: query.role } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.search
      ? {
          OR: [
            { fullName: { contains: query.search, mode: 'insensitive' as const } },
            { email: { contains: query.search, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };
}

export const usersRepository = {
  /**
   * One round trip for both the page and the total, via $transaction. Two
   * separate awaits would let a row be inserted between them and produce a
   * total that does not match the page.
   */
  async list(query: ListUsersQuery): Promise<{ items: User[]; total: number }> {
    const where = buildWhere(query);

    const [items, total] = await prisma.$transaction([
      prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      prisma.user.count({ where }),
    ]);

    return { items, total };
  },

  findById(id: string): Promise<User | null> {
    return prisma.user.findFirst({ where: { id, deletedAt: null } });
  },

  findByEmail(email: string): Promise<User | null> {
    return prisma.user.findFirst({ where: { email, deletedAt: null } });
  },

  create(data: Prisma.UserCreateInput): Promise<User> {
    return prisma.user.create({ data });
  },

  update(id: string, data: Prisma.UserUpdateInput): Promise<User> {
    return prisma.user.update({ where: { id }, data });
  },

  /**
   * Soft delete. A hard delete would orphan bookings, payments and invoices
   * that legally must be retained, so the row stays and is filtered out
   * everywhere by `deletedAt: null`.
   */
  softDelete(id: string): Promise<User> {
    return prisma.user.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'DEACTIVATED' },
    });
  },

  countAdmins(): Promise<number> {
    return prisma.user.count({ where: { role: 'ADMIN', status: 'ACTIVE', deletedAt: null } });
  },
};
