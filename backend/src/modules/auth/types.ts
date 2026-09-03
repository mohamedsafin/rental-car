/**
 * modules/auth/types.ts
 * ---------------------------------------------------------------------------
 * Contracts for the auth module.
 */
import type { Role, User, UserStatus } from '@prisma/client';

/**
 * The user shape safe to return over the API.
 *
 * Note what is absent: `passwordHash`, `failedLoginAttempts`, `lockedUntil`.
 * Returning a Prisma `User` directly would leak all three, so every response
 * goes through `toPublicUser` instead.
 */
export interface PublicUser {
  id: string;
  email: string;
  role: Role;
  status: UserStatus;
  fullName: string;
  phone: string | null;
  country: string | null;
  emailVerified: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    status: user.status,
    fullName: user.fullName,
    phone: user.phone,
    country: user.country,
    emailVerified: user.emailVerifiedAt !== null,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
  };
}

export interface AuthResult {
  user: PublicUser;
  accessToken: string;
  /** Returned to the controller so it can set the httpOnly cookie. */
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}
