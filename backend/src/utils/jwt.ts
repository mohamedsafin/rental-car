/**
 * utils/jwt.ts
 * ---------------------------------------------------------------------------
 * Issues and verifies the two tokens this API uses.
 *
 * ACCESS TOKEN  - short-lived (15m), sent as `Authorization: Bearer ...` on
 *   every request. Self-contained: the server verifies the signature and reads
 *   the role from inside it, with no database hit. That speed is the whole
 *   point, and the cost is that it CANNOT be revoked before it expires.
 *
 * REFRESH TOKEN - long-lived (7d), sent only to /auth/refresh, and stored in an
 *   httpOnly cookie so page JavaScript can never read it (an XSS bug therefore
 *   cannot steal it). Its hash is recorded in the database, which is what makes
 *   revocation - "log out everywhere", suspending an account - actually work.
 *
 * The 15-minute access token is the compromise: a suspended user keeps working
 * for at most 15 minutes, instead of 7 days.
 */
import crypto from 'node:crypto';
import jwt, { type SignOptions } from 'jsonwebtoken';
import type { Role } from '@prisma/client';
import { env } from '../config/env';
import { ApiError } from './ApiError';

/** What we put inside an access token. Small, and never secret. */
export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: Role;
}

export interface RefreshTokenPayload {
  sub: string;
  /** Random per-token id, so two refresh tokens are never byte-identical. */
  jti: string;
}

const ISSUER = 'uae-car-rental-api';

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRES_IN,
    issuer: ISSUER,
  } as SignOptions);
}

export function signRefreshToken(userId: string): { token: string; jti: string } {
  const jti = crypto.randomUUID();
  const token = jwt.sign({ sub: userId, jti }, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRES_IN,
    issuer: ISSUER,
  } as SignOptions);
  return { token, jti };
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    return jwt.verify(token, env.JWT_ACCESS_SECRET, { issuer: ISSUER }) as AccessTokenPayload;
  } catch (error) {
    // Distinguish "expired" from "invalid": the frontend silently refreshes on
    // the first and forces a re-login on the second.
    if (error instanceof jwt.TokenExpiredError) {
      throw ApiError.unauthorized('Access token expired');
    }
    throw ApiError.unauthorized('Invalid access token');
  }
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  try {
    return jwt.verify(token, env.JWT_REFRESH_SECRET, { issuer: ISSUER }) as RefreshTokenPayload;
  } catch {
    // No detail here on purpose - a refresh failure always means "log in again".
    throw ApiError.unauthorized('Invalid or expired refresh token');
  }
}

/**
 * Hash a refresh token for storage.
 *
 * SHA-256, not bcrypt: the token is already 200+ bits of cryptographic
 * randomness, so it cannot be brute-forced or guessed from a rainbow table.
 * bcrypt's slowness protects low-entropy human passwords; here it would only
 * make every refresh request slow for no security gain.
 */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Milliseconds until a signed token expires, for setting cookie maxAge. */
export function getTokenExpiry(token: string): Date {
  const decoded = jwt.decode(token) as { exp?: number } | null;
  if (!decoded?.exp) throw ApiError.internal('Token has no expiry claim');
  return new Date(decoded.exp * 1000);
}
