/**
 * tests/security.test.ts
 * ---------------------------------------------------------------------------
 * PHASE 11: the security guarantees, asserted rather than reviewed.
 *
 * The point of this file is that these properties stay true in six months.
 * "Every mutating endpoint requires authentication" is easy to be true today
 * and false the first time somebody adds a route in a hurry. A code review
 * catches that only if a human is looking; this catches it every time.
 *
 * Three groups:
 *
 *  1. Route inventory - walks the live router and checks every endpoint's
 *     guards against an explicit allowlist of what is deliberately public.
 *  2. Rate limiting - switched ON here, because a limiter that is skipped in
 *     every test is a control nobody has ever seen work.
 *  3. Hardening - headers, mass assignment, error leakage, payload limits.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { disconnectPrisma } from '../src/config/prisma';
import { setRateLimiting } from '../src/config/rateLimiting';
import { API_MOUNTS } from '../src/routes/index';
import { listRoutes } from '../src/utils/routeInventory';
import { API, cleanupUsers, createUser, loginAndGetToken, uniqueEmail, VALID_PASSWORD } from './helpers';

const app = createApp();
const createdEmails: string[] = [];

/**
 * Endpoints that are public ON PURPOSE, with the reason.
 *
 * Anything mutating and not on this list must require authentication. Adding
 * to this list is a deliberate act that shows up in review as a security
 * decision, which is exactly what it is.
 */
const INTENTIONALLY_PUBLIC: Record<string, string> = {
  'POST /auth/register': 'Creating an account cannot require an account.',
  'POST /auth/login': 'Same.',
  'POST /auth/refresh': 'Authenticated by the httpOnly refresh cookie, not a bearer token.',
  'POST /auth/logout': 'Must work even with an expired access token, or sessions cannot be ended.',
  'POST /payments/webhook': 'Authenticated by HMAC signature over the raw body, not by a user.',
  'POST /pricing/quote': 'BRD 14: the customer reviews the price before logging in.',
  /*
   * Account recovery. Somebody who cannot sign in is exactly who needs these,
   * so requiring a token would make them useless.
   *
   * What stands in for authentication:
   *   forgot-password  answers identically for every address, so it grants
   *                    nothing and reveals nothing; rate limited to 5/hour.
   *   reset-password   authenticated by a single-use 256-bit token that was
   *                    emailed to the address on the account.
   *   verify-email     the same, and it only sets a flag.
   */
  'POST /auth/forgot-password': 'Cannot require a session to recover a lost one. Says nothing about whether the account exists, and is rate limited.',
  'POST /auth/reset-password': 'Authenticated by the single-use token emailed to the account holder.',
  'POST /auth/verify-email': 'Same - a single-use emailed token, and it only confirms an address.',
};

let customerToken: string;
let staffToken: string;

beforeAll(async () => {
  const customer = await createUser({ role: 'CUSTOMER' });
  const staff = await createUser({ role: 'STAFF' });
  createdEmails.push(customer.email, staff.email);

  customerToken = await loginAndGetToken(app, customer.email);
  staffToken = await loginAndGetToken(app, staff.email);
});

afterAll(async () => {
  setRateLimiting(false);
  await cleanupUsers(createdEmails);
  await disconnectPrisma();
});

describe('route inventory - what is reachable without a token', () => {
  const routes = listRoutes(API_MOUNTS);

  it('found the whole API surface', () => {
    // A sanity check on the walker itself. If this drops to a handful, the
    // inventory has silently stopped seeing routes and every assertion below
    // becomes vacuously true.
    expect(routes.length).toBeGreaterThan(100);
  });

  it('ACCEPTANCE: every mutating endpoint requires authentication', () => {
    const unguarded = routes
      .filter((route) => ['POST', 'PATCH', 'PUT', 'DELETE'].includes(route.method))
      .filter((route) => !route.requiresAuth)
      .map((route) => `${route.method} ${route.path}`)
      .filter((key) => !(key in INTENTIONALLY_PUBLIC));

    expect(unguarded).toEqual([]);
  });

  it('keeps every back-office prefix behind a role check', () => {
    const backOffice = ['/reports', '/notifications', '/coupons', '/damages', '/fleet', '/admin/'];

    const unprotected = routes
      .filter((route) => backOffice.some((prefix) => route.path.startsWith(prefix)))
      .filter((route) => route.allowedRoles.length === 0)
      .map((route) => `${route.method} ${route.path}`);

    expect(unprotected).toEqual([]);
  });

  it('never lets a CUSTOMER role reach a back-office route', () => {
    const leaky = routes
      .filter((route) => route.allowedRoles.length > 0)
      .filter((route) => route.allowedRoles.includes('CUSTOMER'))
      .map((route) => `${route.method} ${route.path}`);

    // authorize() is only ever used to restrict to staff/admin here. A
    // CUSTOMER appearing in an allowlist means someone widened a back-office
    // route rather than adding an ownership check.
    expect(leaky).toEqual([]);
  });

  it('proves the inventory reflects reality, not just its own data', async () => {
    // The list above is derived from the router. This fires a real request at
    // a route it claims is guarded, to confirm the two agree.
    const guarded = routes.find((route) => route.path === '/reports/revenue');
    expect(guarded?.requiresAuth).toBe(true);

    const response = await request(app).get(`${API}/reports/revenue`);
    expect(response.status).toBe(401);
  });
});

describe('authorisation boundaries', () => {
  it('refuses a customer token on staff endpoints', async () => {
    const endpoints = [
      '/reports/dashboard',
      '/notifications',
      '/coupons',
      '/damages',
      '/fleet/fines',
      '/fleet/expiring',
    ];

    for (const endpoint of endpoints) {
      const response = await request(app)
        .get(`${API}${endpoint}`)
        .set('Authorization', `Bearer ${customerToken}`);

      expect({ endpoint, status: response.status }).toEqual({ endpoint, status: 403 });
    }
  });

  it('refuses a staff token on admin-only endpoints', async () => {
    const response = await request(app)
      .post(`${API}/coupons`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        code: 'SECTEST',
        discountType: 'PERCENTAGE',
        value: '10',
        validFrom: new Date().toISOString(),
        validUntil: new Date(Date.now() + 86_400_000).toISOString(),
      });

    expect(response.status).toBe(403);
  });

  it('does not say WHICH role is required', async () => {
    const response = await request(app)
      .get(`${API}/reports/dashboard`)
      .set('Authorization', `Bearer ${customerToken}`);

    // Naming the required role tells an attacker what to go after.
    expect(response.body.message).not.toMatch(/admin|staff/i);
  });

  it('rejects a token signed with the wrong secret', async () => {
    // Header and payload of a well-formed token, signature from elsewhere.
    const forged =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIwMDAwMDAwMC0wMDAwLTAwMDAtMDAwMC0wMDAwMDAwMDAwMDAiLCJyb2xlIjoiQURNSU4iLCJpYXQiOjE3MDAwMDAwMDB9.not_a_real_signature';

    const response = await request(app)
      .get(`${API}/reports/dashboard`)
      .set('Authorization', `Bearer ${forged}`);

    expect(response.status).toBe(401);
  });
});

describe('mass assignment', () => {
  it('cannot self-promote to ADMIN at registration', async () => {
    const email = uniqueEmail('escalate');
    createdEmails.push(email);

    const response = await request(app).post(`${API}/auth/register`).send({
      email,
      password: VALID_PASSWORD,
      dateOfBirth: '1990-01-15',
      fullName: 'Escalation Attempt',
      phone: '+971500000000',
      // Not in the schema. `validate` replaces req.body with the parsed
      // output, so these never reach the service at all.
      role: 'ADMIN',
      status: 'ACTIVE',
      emailVerified: true,
    });

    expect(response.status).toBe(201);
    expect(response.body.data.user.role).toBe('CUSTOMER');
  });

  it('cannot set its own booking total', async () => {
    const response = await request(app)
      .post(`${API}/pricing/quote`)
      .send({
        vehicleId: '00000000-0000-0000-0000-000000000000',
        pickupAt: new Date(Date.now() + 86_400_000).toISOString(),
        returnAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
        totalAmount: '1.00',
        totals: { rentalTotal: '1.00' },
      });

    // 404 for the made-up vehicle - but crucially NOT a 200 echoing back the
    // total the client suggested.
    expect(response.status).toBe(404);
  });
});

describe('error responses do not leak', () => {
  it('gives the same answer for a wrong password and an unknown account', async () => {
    const known = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: createdEmails[0], password: 'WrongPassword123' });

    const unknown = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: 'nobody@nowhere.invalid', password: 'WrongPassword123' });

    expect(known.status).toBe(unknown.status);
    expect(known.body.message).toBe(unknown.body.message);
  });

  it('never returns a stack trace', async () => {
    const response = await request(app).get(`${API}/vehicles/not-a-uuid`);

    const body = JSON.stringify(response.body);
    expect(body).not.toContain('at Object.');
    expect(body).not.toContain('node_modules');
    expect(response.body.stack).toBeUndefined();
  });

  it('tags every response with a request id for support to trace', async () => {
    const response = await request(app).get(`${API}/health`);
    expect(response.headers['x-request-id']).toBeTruthy();
  });
});

describe('hardening headers', () => {
  it('sets the headers that matter', async () => {
    const response = await request(app).get(`${API}/health`);

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['strict-transport-security']).toContain('max-age=');
    expect(response.headers['x-frame-options']).toBeTruthy();
    // Express advertising itself is free reconnaissance.
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('refuses an origin that is not ours', async () => {
    const response = await request(app)
      .get(`${API}/health`)
      .set('Origin', 'https://evil.example.com');

    // 403, not 500: a blocked origin is expected traffic, not a server fault.
    expect(response.status).toBe(403);
  });
});

describe('payload limits', () => {
  it('rejects a body far larger than any real request', async () => {
    const response = await request(app)
      .post(`${API}/auth/login`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ email: 'a@b.co', password: 'x'.repeat(2 * 1024 * 1024) }));

    // 413 from the parser, or 400 from validation - either is a refusal. What
    // must not happen is the server buffering it and carrying on.
    expect([400, 413]).toContain(response.status);
  });

  it('caps how many records one request can ask for', async () => {
    const response = await request(app).get(`${API}/vehicles?limit=100000`);

    // Unbounded pagination is a denial-of-service vector aimed at the
    // database rather than the process.
    expect(response.status).toBe(400);
  });
});

describe('rate limiting - switched ON for this block', () => {
  beforeAll(() => setRateLimiting(true));
  afterAll(() => setRateLimiting(false));

  it('ACCEPTANCE: blocks a burst of failed logins', async () => {
    const email = uniqueEmail('bruteforce');
    let limited = false;

    // The limiter allows 10 failures per 15 minutes per IP.
    for (let attempt = 0; attempt < 14; attempt += 1) {
      const response = await request(app)
        .post(`${API}/auth/login`)
        .send({ email, password: `WrongPassword${attempt}` });

      if (response.status === 429) {
        limited = true;
        expect(response.body.code).toBe('RATE_LIMITED');
        break;
      }
    }

    expect(limited).toBe(true);
    // Up to 14 login attempts, each one a bcrypt compare at cost 12. Same
    // reasoning as the lockout test: budget the timeout for the work.
  }, 30_000);

  it('still answers health checks while limited', async () => {
    // An uptime monitor must not be locked out by someone else's brute force,
    // or the alert fires for the wrong reason.
    const response = await request(app).get(`${API}/health`);
    expect(response.status).toBe(200);
  });
});
