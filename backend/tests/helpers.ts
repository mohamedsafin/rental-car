/**
 * tests/helpers.ts
 * ---------------------------------------------------------------------------
 * Shared test setup.
 *
 * Tests create their own users with unique emails and clean up after
 * themselves, so they can run repeatedly against a dev database without
 * wiping data or depending on each other's leftovers.
 */
import request from 'supertest';
import type { Application } from 'express';
import type { Role } from '@prisma/client';
import { prisma } from '../src/config/prisma';
import { hashPassword } from '../src/utils/password';

export const API = '/api/v1';

/** Unique per run, so parallel or repeated runs never collide on email. */
export function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
}

export const VALID_PASSWORD = 'Passw0rdTest';

/** Create a user directly in the database, bypassing the API and its limits. */
export async function createUser(options: {
  email?: string;
  password?: string;
  role?: Role;
  status?: 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';
  fullName?: string;
}) {
  const email = options.email ?? uniqueEmail('user');
  return prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword(options.password ?? VALID_PASSWORD),
      fullName: options.fullName ?? 'Test User',
      role: options.role ?? 'CUSTOMER',
      status: options.status ?? 'ACTIVE',
      /*
       * Every test customer is comfortably old enough to drive.
       *
       * The minimum rental age is a CLIENT SETTING, so it is blank on a fresh
       * install and set to a real number on a running one - and the whole
       * suite shares a database with whatever value is there. Without a date
       * of birth here, somebody typing 18 into the settings screen broke
       * seventy-eight unrelated tests, none of which are about age.
       *
       * A fixed date rather than "thirty years ago": a test fixture that
       * moves with the clock is a test that fails on one particular day.
       */
      customer: {
        create: { dateOfBirth: new Date('1990-01-15') },
      },
    },
  });
}

/** Log in through the real endpoint and return the access token. */
export async function loginAndGetToken(
  app: Application,
  email: string,
  password = VALID_PASSWORD,
): Promise<string> {
  const res = await request(app).post(`${API}/auth/login`).send({ email, password });
  if (res.status !== 200) {
    throw new Error(`Login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data.accessToken as string;
}

/** Create a user and log them in, in one step. */
export async function createUserAndLogin(app: Application, role: Role = 'CUSTOMER') {
  const user = await createUser({ role });
  const token = await loginAndGetToken(app, user.email);
  return { user, token };
}

/** Remove every user this test file created, plus their dependent rows. */
export async function cleanupUsers(emails: string[]): Promise<void> {
  if (emails.length === 0) return;
  const users = await prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  if (ids.length === 0) return;

  await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

/**
 * Put a cleared rental payment on a booking, without going near a gateway.
 *
 * Since confirmation moved ahead of payment, "paid" is no longer implied by
 * any status - a booking is paid when a SUCCESS payment row says so, and both
 * the READY_FOR_PICKUP transition and the handover check for exactly that.
 * Tests about rentals, invoices or reports should not have to drive a webhook
 * to get past those gates, so they write the row directly.
 *
 * Returns the payment id for tests that need to refund or inspect it.
 */
export async function payRental(bookingId: string): Promise<string> {
  const booking = await prisma.booking.findUniqueOrThrow({
    where: { id: bookingId },
    select: { totalAmount: true, currency: true },
  });

  const payment = await prisma.payment.create({
    data: {
      bookingId,
      type: 'RENTAL',
      status: 'SUCCESS',
      amount: booking.totalAmount,
      currency: booking.currency,
      provider: 'test',
      idempotencyKey: `test-${bookingId}-${Date.now()}`,
      paidAt: new Date(),
    },
  });

  return payment.id;
}
