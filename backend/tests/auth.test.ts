/**
 * tests/auth.test.ts
 * ---------------------------------------------------------------------------
 * Registration, login, token handling and account protection.
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { prisma, disconnectPrisma } from '../src/config/prisma';
import { API, VALID_PASSWORD, cleanupUsers, createUser, uniqueEmail } from './helpers';

const app = createApp();
const createdEmails: string[] = [];

function track(email: string): string {
  createdEmails.push(email);
  return email;
}

afterAll(async () => {
  await cleanupUsers(createdEmails);
  await disconnectPrisma();
});

describe('POST /auth/register', () => {
  it('creates a customer and returns an access token', async () => {
    const email = track(uniqueEmail('reg'));
    const res = await request(app).post(`${API}/auth/register`).send({
      fullName: 'Aisha Rahman',
      email,
      password: VALID_PASSWORD,
      phone: '+971501234567',
      country: 'AE',
    });

    expect(res.status).toBe(201);
    expect(res.body.data.user.email).toBe(email);
    expect(res.body.data.accessToken).toBeTruthy();
  });

  it('never returns the password hash or lockout fields', async () => {
    const email = track(uniqueEmail('leak'));
    const res = await request(app)
      .post(`${API}/auth/register`)
      .send({ fullName: 'Leak Check', email, password: VALID_PASSWORD });

    const body = JSON.stringify(res.body);
    expect(body).not.toContain('passwordHash');
    expect(body).not.toContain('failedLoginAttempts');
    expect(body).not.toContain('lockedUntil');
    expect(body).not.toContain(VALID_PASSWORD);
  });

  it('sets the refresh token as an httpOnly cookie scoped to /auth', async () => {
    const email = track(uniqueEmail('cookie'));
    const res = await request(app)
      .post(`${API}/auth/register`)
      .send({ fullName: 'Cookie User', email, password: VALID_PASSWORD });

    const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith('refreshToken='),
    );

    expect(cookie).toBeDefined();
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Path=/api/v1/auth');
  });

  it('IGNORES a role field in the body - no self-promotion to ADMIN', async () => {
    const email = track(uniqueEmail('escalate'));
    const res = await request(app).post(`${API}/auth/register`).send({
      fullName: 'Sneaky User',
      email,
      password: VALID_PASSWORD,
      role: 'ADMIN',
    });

    expect(res.status).toBe(201);
    expect(res.body.data.user.role).toBe('CUSTOMER');
  });

  it('rejects a weak password with per-field errors', async () => {
    const res = await request(app)
      .post(`${API}/auth/register`)
      .send({ fullName: 'Weak Pass', email: uniqueEmail('weak'), password: 'short' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.errors.some((e: { field: string }) => e.field === 'password')).toBe(true);
  });

  it('rejects a duplicate email with 409', async () => {
    const email = track(uniqueEmail('dupe'));
    await createUser({ email });

    const res = await request(app)
      .post(`${API}/auth/register`)
      .send({ fullName: 'Duplicate', email, password: VALID_PASSWORD });

    expect(res.status).toBe(409);
  });

  it('normalises email to lowercase so one address cannot become two accounts', async () => {
    const lower = track(uniqueEmail('case'));
    const res = await request(app)
      .post(`${API}/auth/register`)
      .send({ fullName: 'Case Test', email: lower.toUpperCase(), password: VALID_PASSWORD });

    expect(res.status).toBe(201);
    expect(res.body.data.user.email).toBe(lower);
  });
});

describe('POST /auth/login', () => {
  it('returns an access token for valid credentials', async () => {
    const email = track(uniqueEmail('login'));
    await createUser({ email });

    const res = await request(app).post(`${API}/auth/login`).send({ email, password: VALID_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeTruthy();
  });

  it('gives the SAME message for a wrong password and an unknown email', async () => {
    const email = track(uniqueEmail('enum'));
    await createUser({ email });

    const wrongPassword = await request(app)
      .post(`${API}/auth/login`)
      .send({ email, password: 'WrongPassword1' });
    const unknownEmail = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: 'nobody-here@test.local', password: 'WrongPassword1' });

    // If these ever differ, the login form becomes an email-enumeration oracle.
    expect(wrongPassword.status).toBe(unknownEmail.status);
    expect(wrongPassword.body.message).toBe(unknownEmail.body.message);
    expect(wrongPassword.body.message).toBe('Invalid email or password');
  });

  it('refuses a suspended account even with the correct password', async () => {
    const email = track(uniqueEmail('susp'));
    await createUser({ email, status: 'SUSPENDED' });

    const res = await request(app).post(`${API}/auth/login`).send({ email, password: VALID_PASSWORD });

    expect(res.status).toBe(403);
    expect(res.body.message).toContain('suspended');
  });

  it('locks the account after 5 failed attempts, then refuses the CORRECT password', async () => {
    const email = track(uniqueEmail('lock'));
    await createUser({ email });

    for (let i = 0; i < 5; i += 1) {
      await request(app).post(`${API}/auth/login`).send({ email, password: 'WrongPassword1' });
    }

    const res = await request(app).post(`${API}/auth/login`).send({ email, password: VALID_PASSWORD });

    expect(res.status).toBe(423);
    expect(res.body.message).toContain('locked');
    /*
     * 20s, not the 5s default. This test performs SEVEN bcrypt operations at
     * cost 12 - one to create the user, then one dummy compare per failed
     * attempt, which the login path runs deliberately so an unknown email
     * takes as long as a wrong password.
     *
     * That slowness is the security property, so the budget has to match the
     * work rather than the hashing being weakened to fit. At 5s it passed on
     * an idle machine and failed whenever anything else was running, which is
     * the definition of a flaky test.
     */
  }, 20_000);
});
