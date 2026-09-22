/**
 * modules/users/service.ts
 * ---------------------------------------------------------------------------
 * Admin-side user management.
 *
 * The guard rails here are about an admin harming the system by accident or by
 * malice, which RBAC alone does not cover. Three rules:
 *
 *  1. You cannot change your own role. Otherwise a compromised admin session
 *     could quietly demote every other admin and keep sole control.
 *  2. You cannot remove or suspend the LAST active admin. Locking everyone out
 *     of the admin panel is unrecoverable without database access.
 *  3. You cannot delete yourself.
 *
 * Every change is written to the audit log with the before and after values.
 */
import type { Role, User, UserStatus } from '@prisma/client';
import { ApiError } from '../../utils/ApiError';
import { hashPassword } from '../../utils/password';
import { AuditAction, auditService } from '../audit/service';
import { toPublicUser, type PublicUser } from '../auth/types';
import { authRepository } from '../auth/repository';
import { usersRepository } from './repository';
import type { CreateStaffInput, ListUsersQuery, UpdateUserInput } from './validation';

export interface Actor {
  id: string;
  email: string;
  role: Role;
  ipAddress?: string;
  userAgent?: string;
}

async function assertNotLastAdmin(target: User, change: 'role' | 'status' | 'delete'): Promise<void> {
  if (target.role !== 'ADMIN' || target.status !== 'ACTIVE') return;

  const activeAdmins = await usersRepository.countAdmins();
  if (activeAdmins <= 1) {
    throw ApiError.conflict(
      `Cannot ${change === 'delete' ? 'delete' : 'change the ' + change + ' of'} the last active administrator`,
    );
  }
}

export const usersService = {
  async list(query: ListUsersQuery): Promise<{ items: PublicUser[]; total: number }> {
    const { items, total } = await usersRepository.list(query);
    return { items: items.map(toPublicUser), total };
  },

  async getById(id: string): Promise<PublicUser> {
    const user = await usersRepository.findById(id);
    if (!user) throw ApiError.notFound('User not found');
    return toPublicUser(user);
  },

  /** Create an ADMIN or STAFF account. The only way such accounts come to exist. */
  async createStaff(input: CreateStaffInput, actor: Actor): Promise<PublicUser> {
    const existing = await usersRepository.findByEmail(input.email);
    if (existing) throw ApiError.conflict('An account with this email already exists');

    const user = await usersRepository.create({
      email: input.email,
      passwordHash: await hashPassword(input.password),
      fullName: input.fullName,
      phone: input.phone ?? null,
      role: input.role,
    });

    await auditService.record({
      action: AuditAction.USER_CREATED,
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      entityType: 'User',
      entityId: user.id,
      metadata: { email: user.email, role: user.role },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return toPublicUser(user);
  },

  async update(id: string, input: UpdateUserInput, actor: Actor): Promise<PublicUser> {
    const target = await usersRepository.findById(id);
    if (!target) throw ApiError.notFound('User not found');

    const changingRole = input.role !== undefined && input.role !== target.role;
    const changingStatus = input.status !== undefined && input.status !== target.status;

    if (changingRole && target.id === actor.id) {
      throw ApiError.forbidden('You cannot change your own role');
    }

    if (changingRole) await assertNotLastAdmin(target, 'role');
    if (changingStatus && input.status !== 'ACTIVE') await assertNotLastAdmin(target, 'status');

    const updated = await usersRepository.update(id, {
      ...(input.fullName !== undefined && { fullName: input.fullName }),
      ...(input.phone !== undefined && { phone: input.phone }),
      ...(input.country !== undefined && { country: input.country }),
      ...(input.role !== undefined && { role: input.role }),
      ...(input.status !== undefined && { status: input.status }),
      // '' means "no branch"; undefined means "not mentioned". See the schema.
      ...(input.branchId !== undefined && { branchId: input.branchId || null }),
    });

    // A demoted or suspended user must not keep working with tokens issued
    // under their old privileges. Revoking forces a fresh login, and their
    // 15-minute access token is the longest the old role can survive.
    if (changingRole || (changingStatus && input.status !== 'ACTIVE')) {
      await authRepository.revokeAllUserTokens(id);
    }

    if (changingRole) {
      await auditService.record({
        action: AuditAction.USER_ROLE_CHANGED,
        actorId: actor.id,
        actorEmail: actor.email,
        actorRole: actor.role,
        entityType: 'User',
        entityId: id,
        metadata: { from: target.role, to: input.role as Role },
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });
    }

    if (changingStatus) {
      await auditService.record({
        action: AuditAction.USER_STATUS_CHANGED,
        actorId: actor.id,
        actorEmail: actor.email,
        actorRole: actor.role,
        entityType: 'User',
        entityId: id,
        metadata: { from: target.status, to: input.status as UserStatus },
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });
    }

    return toPublicUser(updated);
  },

  async remove(id: string, actor: Actor): Promise<void> {
    if (id === actor.id) throw ApiError.forbidden('You cannot delete your own account');

    const target = await usersRepository.findById(id);
    if (!target) throw ApiError.notFound('User not found');

    await assertNotLastAdmin(target, 'delete');

    await usersRepository.softDelete(id);
    await authRepository.revokeAllUserTokens(id);

    await auditService.record({
      action: AuditAction.USER_UPDATED,
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      entityType: 'User',
      entityId: id,
      metadata: { operation: 'soft_delete', email: target.email },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
  },
};
