/**
 * modules/auth/repository.ts
 * ---------------------------------------------------------------------------
 * All Prisma access for the auth module. Nothing here knows a business rule;
 * it just reads and writes rows.
 *
 * Why this layer exists at all: it keeps `service.ts` readable as business
 * logic rather than query soup, and when Phase 4 needs a hand-tuned SQL query
 * for the availability search, only the repository changes.
 */
import type { Prisma, RefreshToken, Role, User } from '@prisma/client';
import { prisma } from '../../config/prisma';

export const authRepository = {
  /** Find an active (not soft-deleted) user by email. */
  findByEmail(email: string): Promise<User | null> {
    return prisma.user.findFirst({ where: { email, deletedAt: null } });
  },

  findById(id: string): Promise<User | null> {
    return prisma.user.findFirst({ where: { id, deletedAt: null } });
  },

  createUser(data: {
    email: string;
    passwordHash: string;
    fullName: string;
    phone?: string;
    country?: string;
    role?: Role;
    /// Only ever set for a customer - see the nested create below.
    dateOfBirth?: string;
  }): Promise<User> {
    const role = data.role ?? 'CUSTOMER';

    return prisma.user.create({
      data: {
        email: data.email,
        passwordHash: data.passwordHash,
        fullName: data.fullName,
        phone: data.phone ?? null,
        country: data.country ?? null,
        role,
        /*
         * The rental profile is created WITH the account when a date of birth
         * was given, rather than lazily on first access.
         *
         * Two reasons. The date has nowhere else to live - it belongs to the
         * customer profile, not the login - and creating the row here means
         * the booking flow finds an age on file instead of stopping to ask.
         *
         * Staff and admin accounts never get one: none of this applies to
         * them, and a customers table full of empty rows for employees is
         * exactly what the lazy creation was avoiding.
         */
        ...(data.dateOfBirth && role === 'CUSTOMER'
          ? { customer: { create: { dateOfBirth: new Date(data.dateOfBirth) } } }
          : {}),
      },
    });
  },

  updateUser(id: string, data: Prisma.UserUpdateInput): Promise<User> {
    return prisma.user.update({ where: { id }, data });
  },

  /** Record a failed login and lock the account once the threshold is hit. */
  registerFailedLogin(id: string, attempts: number, lockUntil: Date | null): Promise<User> {
    return prisma.user.update({
      where: { id },
      data: { failedLoginAttempts: attempts, lockedUntil: lockUntil },
    });
  },

  /** Clear the lockout counters and stamp the login time. */
  registerSuccessfulLogin(id: string): Promise<User> {
    return prisma.user.update({
      where: { id },
      data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
  },

  // --- Refresh tokens ----------------------------------------------------

  createRefreshToken(data: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    userAgent?: string;
    ipAddress?: string;
  }): Promise<RefreshToken> {
    return prisma.refreshToken.create({
      data: {
        userId: data.userId,
        tokenHash: data.tokenHash,
        expiresAt: data.expiresAt,
        userAgent: data.userAgent ?? null,
        ipAddress: data.ipAddress ?? null,
      },
    });
  },

  findRefreshTokenByHash(tokenHash: string): Promise<RefreshToken | null> {
    return prisma.refreshToken.findUnique({ where: { tokenHash } });
  },

  revokeRefreshToken(id: string, replacedById?: string): Promise<RefreshToken> {
    return prisma.refreshToken.update({
      where: { id },
      data: { revokedAt: new Date(), replacedById: replacedById ?? null },
    });
  },

  /** Revoke every live token for a user: logout-everywhere, or theft response. */
  revokeAllUserTokens(userId: string): Promise<Prisma.BatchPayload> {
    return prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  },

  /**
   * Rotate in one transaction: revoke the old token and issue the new one
   * together, so a crash between the two cannot leave the user with neither.
   */
  async rotateRefreshToken(params: {
    oldTokenId: string;
    userId: string;
    newTokenHash: string;
    expiresAt: Date;
    userAgent?: string;
    ipAddress?: string;
  }): Promise<RefreshToken> {
    return prisma.$transaction(async (tx) => {
      const created = await tx.refreshToken.create({
        data: {
          userId: params.userId,
          tokenHash: params.newTokenHash,
          expiresAt: params.expiresAt,
          userAgent: params.userAgent ?? null,
          ipAddress: params.ipAddress ?? null,
        },
      });

      await tx.refreshToken.update({
        where: { id: params.oldTokenId },
        data: { revokedAt: new Date(), replacedById: created.id },
      });

      return created;
    });
  },
};
