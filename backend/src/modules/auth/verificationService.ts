/**
 * modules/auth/verificationService.ts
 * ---------------------------------------------------------------------------
 * One-time email links: resetting a forgotten password, and proving an address
 * belongs to the person who typed it.
 *
 * ===========================================================================
 * THE SECURITY CHOICES, STATED ONCE
 * ===========================================================================
 *  - REQUESTING A RESET ALWAYS SUCCEEDS. "No account with that email" turns
 *    the forgot-password form into a tool for checking which of a leaked
 *    address list are customers here. The caller is told a link has been sent
 *    whether or not there was anybody to send it to.
 *
 *  - Only the SHA-256 of the token is stored, exactly as refresh tokens are
 *    handled. A database dump therefore does not contain a working reset link
 *    for every account in it.
 *
 *  - A reset REVOKES EVERY SESSION. Forgetting a password and someone else
 *    knowing it look identical from here, so the safe reading is the second
 *    one: whoever was signed in is signed out, on every device.
 *
 *  - Resets expire in an hour, verification links in a day. A reset link sits
 *    in an inbox that may itself be compromised later; a verification link
 *    grants nothing but a tick.
 *
 *  - Requesting a new link INVALIDATES THE PREVIOUS ONE. Otherwise a customer
 *    who clicks "send again" three times has three live keys to their account
 *    lying in their inbox.
 */
import crypto from 'node:crypto';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { prisma } from '../../config/prisma';
import { ApiError } from '../../utils/ApiError';
import { hashPassword } from '../../utils/password';
import { AuditAction, auditService } from '../audit/service';
import { authRepository } from './repository';
import type { RequestMeta } from './service';

/** A reset link is a key to the account, so it does not sit around for long. */
const PASSWORD_RESET_TTL_MINUTES = 60;
/** Verification only proves the address works; a day is a kindness, not a risk. */
const EMAIL_VERIFICATION_TTL_HOURS = 24;

type Purpose = 'PASSWORD_RESET' | 'EMAIL_VERIFICATION';

/** Which app asked, so the emailed link points back at the right one. */
export type ClientApp = 'web' | 'admin';

const sha256 = (value: string): string =>
  crypto.createHash('sha256').update(value).digest('hex');

/**
 * 32 random bytes, URL-safe.
 *
 * `randomBytes`, not `Math.random`: this string is the only thing standing
 * between a stranger and somebody's account, and a predictable one is not a
 * secret at all.
 */
const newToken = (): string => crypto.randomBytes(32).toString('base64url');

function baseUrlFor(client: ClientApp): string {
  return client === 'admin' ? env.ADMIN_SITE_URL : env.PUBLIC_SITE_URL;
}

async function issue(
  userId: string,
  purpose: Purpose,
  ttlMs: number,
  ipAddress?: string,
): Promise<string> {
  const token = newToken();

  await prisma.$transaction(async (tx) => {
    /*
     * Retire anything outstanding for this purpose FIRST.
     *
     * Marked used rather than deleted, so a customer who clicks the older of
     * two links gets "this link has expired" rather than a blank "invalid" -
     * the difference between an explanation and an accusation.
     */
    await tx.verificationToken.updateMany({
      where: { userId, purpose, usedAt: null },
      data: { usedAt: new Date() },
    });

    await tx.verificationToken.create({
      data: {
        userId,
        purpose,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + ttlMs),
        requestedIp: ipAddress ?? null,
      },
    });
  });

  return token;
}

/**
 * Spend a token, or explain why it cannot be spent.
 *
 * Deliberately one message for every failure. "Already used" versus "expired"
 * versus "never existed" tells somebody holding a stolen token which of those
 * it is, and tells a legitimate customer nothing they can act on differently:
 * in all three cases the answer is "ask for a new link".
 */
async function consume(token: string, purpose: Purpose) {
  const record = await prisma.verificationToken.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: { select: { id: true, email: true, role: true, deletedAt: true } } },
  });

  const INVALID = 'This link is no longer valid. Please request a new one.';

  if (!record || record.purpose !== purpose) throw ApiError.badRequest(INVALID);
  if (record.usedAt) throw ApiError.badRequest(INVALID);
  if (record.expiresAt.getTime() < Date.now()) throw ApiError.badRequest(INVALID);
  if (record.user.deletedAt) throw ApiError.badRequest(INVALID);

  await prisma.verificationToken.update({
    where: { id: record.id },
    data: { usedAt: new Date() },
  });

  return record.user;
}

export const verificationService = {
  /**
   * Send a password reset link.
   *
   * Returns nothing about whether the account exists - see the note at the top
   * of this file. The token is returned ONLY so the notification layer can
   * build the link; it is never handed back to the caller of the endpoint.
   */
  async requestPasswordReset(
    email: string,
    client: ClientApp,
    meta: RequestMeta,
  ): Promise<{ sent: boolean }> {
    const user = await authRepository.findByEmail(email.toLowerCase().trim());

    // No account, a deleted one, or a suspended one: say nothing, do nothing.
    if (!user || user.deletedAt || user.status !== 'ACTIVE') {
      logger.info('Password reset requested for an address we cannot serve', {
        // The address itself is not logged: a log file should not become the
        // enumeration tool the response refuses to be.
        known: Boolean(user),
      });
      return { sent: false };
    }

    const token = await issue(
      user.id,
      'PASSWORD_RESET',
      PASSWORD_RESET_TTL_MINUTES * 60_000,
      meta.ipAddress,
    );

    const link = `${baseUrlFor(client)}/reset-password?token=${encodeURIComponent(token)}`;

    // Imported here rather than at the top so the module graph stays acyclic:
    // notifications reach back into users, which reach back into auth.
    const { notify } = await import('../notifications/triggers');
    await notify.passwordReset(user.id, link, PASSWORD_RESET_TTL_MINUTES);

    await auditService.record({
      action: AuditAction.PASSWORD_RESET_REQUESTED,
      actorId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      ...meta,
    });

    return { sent: true };
  },

  /** Set a new password from a reset link, and sign every device out. */
  async resetPassword(token: string, newPassword: string, meta: RequestMeta): Promise<void> {
    const user = await consume(token, 'PASSWORD_RESET');

    await authRepository.updateUser(user.id, {
      passwordHash: await hashPassword(newPassword),
      // A successful reset clears a lockout: the person proved they control
      // the mailbox, which is a stronger claim than the failed logins that
      // locked it.
      failedLoginAttempts: 0,
      lockedUntil: null,
    });

    // Whoever was signed in, anywhere, is signed out. See the note at the top.
    await authRepository.revokeAllUserTokens(user.id);

    await auditService.record({
      action: AuditAction.PASSWORD_RESET_COMPLETED,
      actorId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      ...meta,
    });
  },

  /** Send (or re-send) the address-confirmation link. */
  async requestEmailVerification(
    userId: string,
    client: ClientApp,
    meta: RequestMeta,
  ): Promise<{ alreadyVerified: boolean }> {
    const user = await authRepository.findById(userId);
    if (!user) throw ApiError.notFound('User not found');
    if (user.emailVerifiedAt) return { alreadyVerified: true };

    const token = await issue(
      user.id,
      'EMAIL_VERIFICATION',
      EMAIL_VERIFICATION_TTL_HOURS * 3_600_000,
      meta.ipAddress,
    );

    const link = `${baseUrlFor(client)}/verify-email?token=${encodeURIComponent(token)}`;

    const { notify } = await import('../notifications/triggers');
    await notify.emailVerification(user.id, link, EMAIL_VERIFICATION_TTL_HOURS);

    return { alreadyVerified: false };
  },

  /** Follow the link. Idempotent in effect: verifying twice is not an error. */
  async verifyEmail(token: string, meta: RequestMeta): Promise<{ email: string }> {
    const user = await consume(token, 'EMAIL_VERIFICATION');

    await authRepository.updateUser(user.id, { emailVerifiedAt: new Date() });

    await auditService.record({
      action: AuditAction.EMAIL_VERIFIED,
      actorId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      ...meta,
    });

    return { email: user.email };
  },

  /**
   * Housekeeping: drop spent and expired tokens.
   *
   * Run by the scheduler. Nothing depends on it - every check above already
   * refuses a stale token - it simply stops the table growing forever.
   */
  async purgeExpired(): Promise<{ removed: number }> {
    const { count } = await prisma.verificationToken.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: new Date() } },
          // A spent token is kept a week so "I clicked it twice" is still
          // answerable, then dropped.
          { usedAt: { lt: new Date(Date.now() - 7 * 24 * 3_600_000) } },
        ],
      },
    });
    return { removed: count };
  },
};
