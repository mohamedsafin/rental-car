/**
 * utils/password.ts
 * ---------------------------------------------------------------------------
 * The only place passwords are hashed or checked.
 *
 * bcrypt, not SHA-256: bcrypt is deliberately SLOW and salted per-password.
 * A fast hash lets an attacker with a stolen database try billions of guesses
 * per second; bcrypt at cost 12 caps them at a few dozen. The salt is stored
 * inside the hash string, so identical passwords still produce different hashes.
 *
 * We use `bcryptjs` (pure JavaScript) rather than `bcrypt` (native) so the
 * project installs on Windows without a C++ build toolchain. Same algorithm.
 */
import bcrypt from 'bcryptjs';
import { env } from '../config/env';

export async function hashPassword(plainPassword: string): Promise<string> {
  return bcrypt.hash(plainPassword, env.BCRYPT_SALT_ROUNDS);
}

/**
 * Compare a submitted password against a stored hash.
 *
 * bcrypt.compare is constant-time with respect to the hash, so it does not leak
 * information through timing.
 */
export async function verifyPassword(plainPassword: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plainPassword, hash);
}

/**
 * Burn roughly the same CPU as a real password check, without one.
 *
 * Called when login is attempted against an email that does not exist. Without
 * it, a missing user returns in ~1ms and a wrong password in ~200ms - and that
 * difference alone tells an attacker which email addresses are registered.
 */
export async function fakePasswordCheck(): Promise<void> {
  await bcrypt.compare(
    'dummy-password-for-timing',
    '$2b$12$C6UzMDM.H6dfI/f/IKcEe.7VvNM/3rQCVEfXe0wHzoR8DhI2VXDPu',
  );
}
