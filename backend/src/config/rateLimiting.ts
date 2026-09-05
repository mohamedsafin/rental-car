/**
 * config/rateLimiting.ts
 * ---------------------------------------------------------------------------
 * One switch controlling whether the rate limiters actually limit.
 *
 * Why this exists: the limiters were previously skipped with a hardcoded
 * `isTest`, which meant the one thing standing between the login endpoint and
 * a credential-stuffing script was never exercised by a single test. "It is
 * configured, so presumably it works" is not a security control, it is a hope.
 *
 * The suite still runs with limiting OFF - it makes dozens of deliberate login
 * attempts from one address and would otherwise lock itself out - but a
 * dedicated test turns it on and proves the limiters fire, count only what
 * they should, and return 429 rather than leaking a different error.
 *
 * Off ONLY in tests. In every other environment this reads `true` and the
 * setter is never called.
 */
import { isTest } from './env';

let enabled = !isTest;

/** Read at REQUEST time by each limiter's `skip`, so it can be toggled. */
export function rateLimitingEnabled(): boolean {
  return enabled;
}

/**
 * Test-only. Turning limiting on inside a test that then makes many requests
 * will rate-limit that test, so callers must turn it off again in `afterAll`.
 */
export function setRateLimiting(value: boolean): void {
  if (!isTest) {
    throw new Error('Rate limiting cannot be toggled outside tests');
  }
  enabled = value;
}
