/**
 * modules/auth/service.ts
 * ---------------------------------------------------------------------------
 * Every authentication decision in the system. No HTTP knowledge lives here -
 * the service takes data and returns data, which is what makes it testable.
 *
 * The security choices, stated once so they are not re-litigated later:
 *
 *  - Login failures are ALWAYS "Invalid email or password", never "no such
 *    user". Distinguishing the two turns the login form into a tool for
 *    checking which emails are registered.
 *
 *  - A missing user still burns a bcrypt comparison, so the response time does
 *    not leak the same fact the message refuses to.
 *
 *  - Registration always creates a CUSTOMER. The role is hardcoded here, not
 *    read from input, so no request body can promote itself.
 *
 *  - Refresh tokens rotate on every use, and re-use of a revoked token revokes
 *    the whole family. That is how a stolen token gets caught.
 */
import { env } from '../../config/env';
import type { Role } from '@prisma/client';
import { logger } from '../../config/logger';
import { ApiError, ErrorCode } from '../../utils/ApiError';
import { fakePasswordCheck, hashPassword, verifyPassword } from '../../utils/password';
import {
  getTokenExpiry,
  hashToken,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../../utils/jwt';
import { AuditAction, auditService } from '../audit/service';
import { authRepository } from './repository';
import { toPublicUser, type AuthResult, type PublicUser } from './types';
import type { ChangePasswordInput, LoginInput, RegisterInput, UpdateProfileInput } from './validation';

/** Context captured from the request, for audit rows and token records. */
export interface RequestMeta {
  ipAddress?: string;
  userAgent?: string;
}

const GENERIC_LOGIN_FAILURE = 'Invalid email or password';

/** Issue an access + refresh pair and persist the refresh token's hash. */
async function issueTokens(
  user: { id: string; email: string; role: Role },
  meta: RequestMeta,
): Promise<{ accessToken: string; refreshToken: string; refreshTokenExpiresAt: Date }> {
  const accessToken = signAccessToken({ sub: user.id, email: user.email, role: user.role });
  const { token: refreshToken } = signRefreshToken(user.id);
  const refreshTokenExpiresAt = getTokenExpiry(refreshToken);

  await authRepository.createRefreshToken({
    userId: user.id,
    tokenHash: hashToken(refreshToken),
    expiresAt: refreshTokenExpiresAt,
    userAgent: meta.userAgent,
    ipAddress: meta.ipAddress,
  });

  return { accessToken, refreshToken, refreshTokenExpiresAt };
}

export const authService = {
  /**
   * Create a customer account.
   *
   * Duplicate email DOES return a clear 409 here, unlike login. It is a
   * deliberate trade-off: a registration form cannot hide that an email is
   * taken (the user must be told why they cannot proceed), so we accept the
   * disclosure and rate-limit the endpoint instead.
   */
  async register(input: RegisterInput, meta: RequestMeta): Promise<AuthResult> {
    const existing = await authRepository.findByEmail(input.email);
    if (existing) {
      throw ApiError.conflict('An account with this email already exists');
    }

    const passwordHash = await hashPassword(input.password);

    const user = await authRepository.createUser({
      email: input.email,
      passwordHash,
      fullName: input.fullName,
      phone: input.phone,
      country: input.country,
      // Creates the rental profile alongside the login, so the age rule has
      // something to read at booking time instead of interrupting to ask.
      dateOfBirth: input.dateOfBirth,
      // Hardcoded. Never taken from input.
      role: 'CUSTOMER',
    });

    const tokens = await issueTokens(user, meta);

    await auditService.record({
      action: AuditAction.REGISTER,
      actorId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      entityType: 'User',
      entityId: user.id,
      ...meta,
    });

    return { user: toPublicUser(user), ...tokens };
  },

  async login(input: LoginInput, meta: RequestMeta): Promise<AuthResult> {
    const user = await authRepository.findByEmail(input.email);

    if (!user) {
      // Spend the time a real check would have taken, then fail identically.
      await fakePasswordCheck();
      await auditService.record({
        action: AuditAction.LOGIN_FAILED,
        actorEmail: input.email,
        metadata: { reason: 'unknown_email' },
        ...meta,
      });
      throw ApiError.unauthorized(GENERIC_LOGIN_FAILURE);
    }

    // Locked out? Refuse before checking the password, so a lockout cannot be
    // used as an oracle for whether a guessed password was correct.
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await auditService.record({
        action: AuditAction.LOGIN_LOCKED,
        actorId: user.id,
        actorEmail: user.email,
        metadata: { lockedUntil: user.lockedUntil.toISOString() },
        ...meta,
      });
      throw new ApiError(
        423,
        `Account temporarily locked after too many failed attempts. Try again in ${env.AUTH_LOCKOUT_MINUTES} minutes.`,
        ErrorCode.FORBIDDEN,
      );
    }

    const passwordValid = await verifyPassword(input.password, user.passwordHash);

    if (!passwordValid) {
      const attempts = user.failedLoginAttempts + 1;
      const shouldLock = attempts >= env.AUTH_MAX_FAILED_ATTEMPTS;
      const lockUntil = shouldLock
        ? new Date(Date.now() + env.AUTH_LOCKOUT_MINUTES * 60_000)
        : null;

      // On lock, reset the counter: the lockout window is now the deterrent,
      // and the next wrong guess after it expires starts a fresh count.
      await authRepository.registerFailedLogin(user.id, shouldLock ? 0 : attempts, lockUntil);

      await auditService.record({
        action: AuditAction.LOGIN_FAILED,
        actorId: user.id,
        actorEmail: user.email,
        metadata: { reason: 'bad_password', attempts, locked: shouldLock },
        ...meta,
      });

      throw ApiError.unauthorized(GENERIC_LOGIN_FAILURE);
    }

    // Correct password, but the account may not sign in. This message IS
    // specific: the user has proved who they are, so telling them the account
    // is suspended discloses nothing to an attacker.
    if (user.status !== 'ACTIVE') {
      throw ApiError.forbidden(
        user.status === 'SUSPENDED'
          ? 'Your account has been suspended. Please contact support.'
          : 'Your account is no longer active. Please contact support.',
      );
    }

    const updated = await authRepository.registerSuccessfulLogin(user.id);
    const tokens = await issueTokens(updated, meta);

    await auditService.record({
      action: AuditAction.LOGIN_SUCCESS,
      actorId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      ...meta,
    });

    return { user: toPublicUser(updated), ...tokens };
  },

  /**
   * Exchange a refresh token for a new pair, rotating the old one.
   *
   * The re-use branch is the important one. A valid-looking token that has
   * already been revoked means one of two things: a race, or a stolen token
   * being replayed. We cannot tell which, so we assume theft and revoke every
   * token the user has - forcing a fresh login on all devices.
   */
  async refresh(refreshToken: string, meta: RequestMeta): Promise<AuthResult> {
    const payload = verifyRefreshToken(refreshToken);
    const stored = await authRepository.findRefreshTokenByHash(hashToken(refreshToken));

    if (!stored) {
      throw ApiError.unauthorized('Invalid or expired refresh token');
    }

    if (stored.revokedAt) {
      logger.warn('Refresh token re-use detected', { userId: stored.userId });
      await authRepository.revokeAllUserTokens(stored.userId);
      await auditService.record({
        action: AuditAction.TOKEN_REUSE_DETECTED,
        actorId: stored.userId,
        metadata: { tokenId: stored.id },
        ...meta,
      });
      throw ApiError.unauthorized('Session expired. Please log in again.');
    }

    if (stored.expiresAt < new Date()) {
      throw ApiError.unauthorized('Session expired. Please log in again.');
    }

    const user = await authRepository.findById(payload.sub);
    if (!user || user.status !== 'ACTIVE') {
      // Catches an admin suspending the account mid-session: the 15-minute
      // access token still works until it expires, but no new one is issued.
      await authRepository.revokeAllUserTokens(stored.userId);
      throw ApiError.unauthorized('Session expired. Please log in again.');
    }

    const accessToken = signAccessToken({ sub: user.id, email: user.email, role: user.role });
    const { token: newRefreshToken } = signRefreshToken(user.id);
    const refreshTokenExpiresAt = getTokenExpiry(newRefreshToken);

    await authRepository.rotateRefreshToken({
      oldTokenId: stored.id,
      userId: user.id,
      newTokenHash: hashToken(newRefreshToken),
      expiresAt: refreshTokenExpiresAt,
      userAgent: meta.userAgent,
      ipAddress: meta.ipAddress,
    });

    await auditService.record({
      action: AuditAction.TOKEN_REFRESHED,
      actorId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      ...meta,
    });

    return {
      user: toPublicUser(user),
      accessToken,
      refreshToken: newRefreshToken,
      refreshTokenExpiresAt,
    };
  },

  /** Revoke one session. Never errors: logging out must always appear to work. */
  async logout(refreshToken: string | undefined, meta: RequestMeta): Promise<void> {
    if (!refreshToken) return;

    const stored = await authRepository.findRefreshTokenByHash(hashToken(refreshToken));
    if (!stored || stored.revokedAt) return;

    await authRepository.revokeRefreshToken(stored.id);
    await auditService.record({
      action: AuditAction.LOGOUT,
      actorId: stored.userId,
      ...meta,
    });
  },

  /** Revoke every session for a user ("log out on all devices"). */
  async logoutAll(userId: string, meta: RequestMeta): Promise<void> {
    await authRepository.revokeAllUserTokens(userId);
    await auditService.record({
      action: AuditAction.LOGOUT,
      actorId: userId,
      metadata: { scope: 'all_devices' },
      ...meta,
    });
  },

  async getCurrentUser(userId: string): Promise<PublicUser> {
    const user = await authRepository.findById(userId);
    if (!user) throw ApiError.notFound('User not found');
    return toPublicUser(user);
  },

  async updateProfile(userId: string, input: UpdateProfileInput): Promise<PublicUser> {
    const user = await authRepository.updateUser(userId, {
      ...(input.fullName !== undefined && { fullName: input.fullName }),
      ...(input.phone !== undefined && { phone: input.phone }),
      ...(input.country !== undefined && { country: input.country }),
    });
    return toPublicUser(user);
  },

  /**
   * Change password, then revoke every session.
   *
   * The revocation is the point: if the password was changed BECAUSE it was
   * compromised, leaving the attacker's existing sessions alive would defeat
   * the whole exercise.
   */
  async changePassword(
    userId: string,
    input: ChangePasswordInput,
    meta: RequestMeta,
  ): Promise<void> {
    const user = await authRepository.findById(userId);
    if (!user) throw ApiError.notFound('User not found');

    const valid = await verifyPassword(input.currentPassword, user.passwordHash);
    if (!valid) throw ApiError.unauthorized('Current password is incorrect');

    await authRepository.updateUser(userId, {
      passwordHash: await hashPassword(input.newPassword),
    });
    await authRepository.revokeAllUserTokens(userId);

    await auditService.record({
      action: AuditAction.PASSWORD_CHANGED,
      actorId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      ...meta,
    });
  },
};
