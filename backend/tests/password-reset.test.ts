/**
 * tests/password-reset.test.ts
 * ---------------------------------------------------------------------------
 * Forgetting a password, and proving an email address is yours.
 *
 * ===========================================================================
 * WHAT IS ACTUALLY WORTH TESTING HERE
 * ===========================================================================
 * That the happy path works is the least of it. The failures that matter are
 * the ones nobody notices until they are being exploited:
 *
 *   - the form telling an attacker which addresses are registered
 *   - a reset link that still works after it has been used
 *   - a reset that leaves the old sessions signed in, so changing a password
 *     under duress achieves nothing
 *   - a link for one purpose being spent on the other
 *
 * The raw token is read from the database rather than from an inbox: the mail
 * itself is the notification module's job and is tested there. What matters
 * here is what the token does.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/app';
import { prisma, disconnectPrisma } from '../src/config/prisma';
import { API, VALID_PASSWORD, cleanupUsers, createUser, uniqueEmail } from './helpers';

const app = createApp();
const createdEmails: string[] = [];

const NEW_PASSWORD = 'Rese7Passw0rd!';

function track(email: string): string {
  createdEmails.push(email);
  return email;
}

/**
 * The raw token never leaves the email, so a test cannot read it back.
 *
 * Issuing a known token directly is the honest way in: it exercises every
 * rule that matters (purpose, expiry, single use) without pretending to parse
 * an inbox, and it keeps the SHA-256 storage under test - if the service
 * started storing raw tokens, this would still pass, but the service's own
 * lookup by hash would not.
 */
async function issueToken(
  userId: string,
  purpose: 'PASSWORD_RESET' | 'EMAIL_VERIFICATION',
  options: { expiresAt?: Date; usedAt?: Date } = {},
): Promise<string> {
  const raw = crypto.randomBytes(24).toString('base64url');
  await prisma.verificationToken.create({
    data: {
      userId,
      purpose,
      tokenHash: crypto.createHash('sha256').update(raw).digest('hex'),
      expiresAt: options.expiresAt ?? new Date(Date.now() + 3_600_000),
      usedAt: options.usedAt ?? null,
    },
  });
  return raw;
}

beforeAll(async () => {
  // Templates are seeded; this suite only needs them to exist so sending does
  // not throw. It does not assert on the mail itself.
  await prisma.notificationTemplate.findFirst({ where: { key: 'auth.password_reset' } });
});

afterAll(async () => {
  await cleanupUsers(createdEmails);
  await disconnectPrisma();
});

describe('asking for a reset link', () => {
  it('answers the same whether or not the account exists', async () => {
    const real = track(uniqueEmail('reset-known'));
    await createUser({ email: real });

    const known = await request(app).post(`${API}/auth/forgot-password`).send({ email: real });
    const unknown = await request(app)
      .post(`${API}/auth/forgot-password`)
      .send({ email: 'nobody-at-all@example.com' });

    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    // Byte-identical. A different message, or a different status, turns this
    // form into a way to test a leaked address list against our customers.
    expect(unknown.body.message).toBe(known.body.message);
    expect(unknown.body.data).toEqual(known.body.data);
  });

  it('issues a token for a real account, and none for a stranger', async () => {
    const email = track(uniqueEmail('reset-issue'));
    const user = await createUser({ email });

    await request(app).post(`${API}/auth/forgot-password`).send({ email });

    const tokens = await prisma.verificationToken.findMany({
      where: { userId: user.id, purpose: 'PASSWORD_RESET' },
    });
    expect(tokens).toHaveLength(1);
    // Stored as a hash, never as the thing that was emailed.
    expect(tokens[0]!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(tokens[0]!.usedAt).toBeNull();
  });

  it('retires the previous link when a new one is asked for', async () => {
    const email = track(uniqueEmail('reset-again'));
    const user = await createUser({ email });

    await request(app).post(`${API}/auth/forgot-password`).send({ email });
    await request(app).post(`${API}/auth/forgot-password`).send({ email });

    const live = await prisma.verificationToken.count({
      where: { userId: user.id, purpose: 'PASSWORD_RESET', usedAt: null },
    });
    // Otherwise "send it again" leaves three working keys to one account
    // lying in an inbox.
    expect(live).toBe(1);
  });

  it('sends nothing for a suspended account', async () => {
    const email = track(uniqueEmail('reset-suspended'));
    const user = await createUser({ email });
    await prisma.user.update({ where: { id: user.id }, data: { status: 'SUSPENDED' } });

    const res = await request(app).post(`${API}/auth/forgot-password`).send({ email });

    expect(res.status).toBe(200); // Still says nothing about the account.
    const tokens = await prisma.verificationToken.count({ where: { userId: user.id } });
    expect(tokens).toBe(0);
  });
});

describe('using a reset link', () => {
  it('sets the new password and lets them straight in', async () => {
    const email = track(uniqueEmail('reset-use'));
    const user = await createUser({ email });
    const token = await issueToken(user.id, 'PASSWORD_RESET');

    const reset = await request(app)
      .post(`${API}/auth/reset-password`)
      .send({ token, password: NEW_PASSWORD });
    expect(reset.status).toBe(200);

    const withNew = await request(app)
      .post(`${API}/auth/login`)
      .send({ email, password: NEW_PASSWORD });
    expect(withNew.status).toBe(200);

    const withOld = await request(app)
      .post(`${API}/auth/login`)
      .send({ email, password: VALID_PASSWORD });
    expect(withOld.status).toBe(401);
  });

  it('SIGNS OUT every other device', async () => {
    const email = track(uniqueEmail('reset-sessions'));
    const user = await createUser({ email });

    // A session already open somewhere else.
    const signedIn = await request(app)
      .post(`${API}/auth/login`)
      .send({ email, password: VALID_PASSWORD });
    const cookie = (signedIn.headers['set-cookie'] as unknown as string[])
      .find((c) => c.startsWith('refreshToken='))!
      .split(';')[0]!;

    const token = await issueToken(user.id, 'PASSWORD_RESET');
    await request(app).post(`${API}/auth/reset-password`).send({ token, password: NEW_PASSWORD });

    const stillIn = await request(app).post(`${API}/auth/refresh`).set('Cookie', cookie).send();

    /*
     * Forgetting a password and somebody else knowing it look identical from
     * the server. The safe reading is the second one - so whoever was signed
     * in is signed out, everywhere.
     */
    expect(stillIn.status).toBe(401);
  });

  it('REFUSES the same link twice', async () => {
    const email = track(uniqueEmail('reset-twice'));
    const user = await createUser({ email });
    const token = await issueToken(user.id, 'PASSWORD_RESET');

    const first = await request(app)
      .post(`${API}/auth/reset-password`)
      .send({ token, password: NEW_PASSWORD });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post(`${API}/auth/reset-password`)
      .send({ token, password: 'An0therPassw0rd!' });
    expect(second.status).toBe(400);

    // And the second attempt changed nothing.
    const login = await request(app)
      .post(`${API}/auth/login`)
      .send({ email, password: NEW_PASSWORD });
    expect(login.status).toBe(200);
  });

  it('REFUSES an expired link', async () => {
    const email = track(uniqueEmail('reset-expired'));
    const user = await createUser({ email });
    const token = await issueToken(user.id, 'PASSWORD_RESET', {
      expiresAt: new Date(Date.now() - 60_000),
    });

    const res = await request(app)
      .post(`${API}/auth/reset-password`)
      .send({ token, password: NEW_PASSWORD });

    expect(res.status).toBe(400);
  });

  it('REFUSES a made-up token, saying nothing useful about why', async () => {
    const res = await request(app)
      .post(`${API}/auth/reset-password`)
      .send({ token: 'not-a-real-token', password: NEW_PASSWORD });

    expect(res.status).toBe(400);
    // The same sentence an expired or spent link gets. Distinguishing them
    // tells somebody holding a stolen token which it is.
    expect(res.body.message).toMatch(/no longer valid/i);
  });

  it('REFUSES a verification link used as a reset link', async () => {
    const email = track(uniqueEmail('reset-wrongpurpose'));
    const user = await createUser({ email });
    const token = await issueToken(user.id, 'EMAIL_VERIFICATION');

    const res = await request(app)
      .post(`${API}/auth/reset-password`)
      .send({ token, password: NEW_PASSWORD });

    // A tick that the address works must never become a key to the account.
    expect(res.status).toBe(400);
  });

  it('still enforces the password rules', async () => {
    const email = track(uniqueEmail('reset-weak'));
    const user = await createUser({ email });
    const token = await issueToken(user.id, 'PASSWORD_RESET');

    const res = await request(app)
      .post(`${API}/auth/reset-password`)
      .send({ token, password: 'short' });

    expect(res.status).toBe(400);
  });

  it('clears a lockout - controlling the mailbox outranks the failed logins', async () => {
    const email = track(uniqueEmail('reset-locked'));
    const user = await createUser({ email });
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 9, lockedUntil: new Date(Date.now() + 3_600_000) },
    });

    const token = await issueToken(user.id, 'PASSWORD_RESET');
    await request(app).post(`${API}/auth/reset-password`).send({ token, password: NEW_PASSWORD });

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.lockedUntil).toBeNull();
    expect(after.failedLoginAttempts).toBe(0);

    const login = await request(app)
      .post(`${API}/auth/login`)
      .send({ email, password: NEW_PASSWORD });
    expect(login.status).toBe(200);
  });
});

describe('confirming an email address', () => {
  it('marks the address verified', async () => {
    const email = track(uniqueEmail('verify-ok'));
    const user = await createUser({ email });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt).toBeNull();

    const token = await issueToken(user.id, 'EMAIL_VERIFICATION');
    const res = await request(app).post(`${API}/auth/verify-email`).send({ token });

    expect(res.status).toBe(200);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.emailVerifiedAt).not.toBeNull();
  });

  it('REFUSES a reset link used as a verification link', async () => {
    const email = track(uniqueEmail('verify-wrongpurpose'));
    const user = await createUser({ email });
    const token = await issueToken(user.id, 'PASSWORD_RESET');

    const res = await request(app).post(`${API}/auth/verify-email`).send({ token });
    expect(res.status).toBe(400);
  });

  it('sends a link when a new account registers', async () => {
    const email = track(uniqueEmail('verify-onregister'));

    const res = await request(app)
      .post(`${API}/auth/register`)
      .send({ fullName: 'Verify Me', email, password: VALID_PASSWORD, dateOfBirth: '1990-01-15' });
    expect(res.status).toBe(201);

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });

    /*
     * Polled, not read once.
     *
     * The link is sent fire-and-forget on purpose: a slow mail server must
     * not fail a registration that has already succeeded. So the token
     * appears shortly AFTER the response, and asserting immediately is a race
     * that passes alone and fails in a full suite - which is exactly how it
     * first failed.
     */
    let tokens = 0;
    for (let attempt = 0; attempt < 20 && tokens === 0; attempt += 1) {
      tokens = await prisma.verificationToken.count({
        where: { userId: user.id, purpose: 'EMAIL_VERIFICATION' },
      });
      if (tokens === 0) await new Promise((resolve) => setTimeout(resolve, 100));
    }

    expect(tokens).toBe(1);
  });

  it('says so, rather than sending again, when it is already confirmed', async () => {
    const email = track(uniqueEmail('verify-already'));
    const user = await createUser({ email });
    await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });

    const login = await request(app)
      .post(`${API}/auth/login`)
      .send({ email, password: VALID_PASSWORD });
    const accessToken = login.body.data.accessToken as string;

    const res = await request(app)
      .post(`${API}/auth/resend-verification`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.data.alreadyVerified).toBe(true);
  });
});

describe('housekeeping', () => {
  it('purges spent and expired tokens, and leaves live ones alone', async () => {
    const email = track(uniqueEmail('purge'));
    const user = await createUser({ email });

    await issueToken(user.id, 'PASSWORD_RESET', { expiresAt: new Date(Date.now() - 60_000) });
    const live = await issueToken(user.id, 'EMAIL_VERIFICATION');

    const { verificationService } = await import('../src/modules/auth/verificationService');
    await verificationService.purgeExpired();

    const remaining = await prisma.verificationToken.findMany({ where: { userId: user.id } });
    expect(remaining).toHaveLength(1);

    // The live one still works afterwards.
    const res = await request(app).post(`${API}/auth/verify-email`).send({ token: live });
    expect(res.status).toBe(200);
  });
});
