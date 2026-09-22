/**
 * tests/auth.test.ts
 * ---------------------------------------------------------------------------
 * Registration, login, token handling and account protection.
 */
import { describe, it, expect, afterAll } from 'vitest';
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
      dateOfBirth: '1990-01-15',
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
      .send({ fullName: 'Leak Check', email, password: VALID_PASSWORD, dateOfBirth: '1990-01-15' });

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
      .send({ fullName: 'Cookie User', email, password: VALID_PASSWORD, dateOfBirth: '1990-01-15' });

    const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith('refreshToken='),
    );

    expect(cookie).toBeDefined();
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Path=/api/v1/auth');
  });

  /*
   * ONE BROWSER, TWO APPS.
   *
   * Browsers file cookies by host and ignore the port, so the customer site
   * and the admin shared a single "refreshToken" for localhost - and in
   * production would share one across two subdomains just the same. Whoever
   * signed in last owned it. Signing into the customer site overwrote the
   * admin's, the admin then renewed itself with the only cookie there was, and
   * came back holding a CUSTOMER's session: every staff screen refusing
   * permission while the header still showed the admin's name.
   */
  describe('an admin and a customer can be signed in at once', () => {
    const readCookie = (res: request.Response, name: string) =>
      (res.headers['set-cookie'] as unknown as string[] | undefined)?.find((c) =>
        c.startsWith(`${name}=`),
      );

    it('gives the admin app its own cookie name', async () => {
      const email = track(uniqueEmail('admincookie'));
      await createUser({ email, role: 'ADMIN' });

      const res = await request(app)
        .post(`${API}/auth/login`)
        .set('X-Client-App', 'admin')
        .send({ email, password: VALID_PASSWORD });

      expect(res.status).toBe(200);
      expect(readCookie(res, 'adminRefreshToken')).toBeDefined();
      // The customer site's cookie is left exactly as it was.
      expect(readCookie(res, 'refreshToken')).toBeUndefined();
    });

    it('leaves the customer site on the original cookie', async () => {
      const email = track(uniqueEmail('webcookie'));

      const res = await request(app)
        .post(`${API}/auth/register`)
        .send({ fullName: 'Web User', email, password: VALID_PASSWORD, dateOfBirth: '1990-01-15' });

      expect(readCookie(res, 'refreshToken')).toBeDefined();
      expect(readCookie(res, 'adminRefreshToken')).toBeUndefined();
    });

    it('REFUSES to renew an admin session from the customer cookie', async () => {
      const customerEmail = track(uniqueEmail('mixed-customer'));
      const customer = await request(app)
        .post(`${API}/auth/register`)
        .send({ fullName: 'Mixed Customer', email: customerEmail, password: VALID_PASSWORD, dateOfBirth: '1990-01-15' });

      const customerCookie = readCookie(customer, 'refreshToken')!.split(';')[0]!;

      // The admin app, holding only the customer site's cookie, asks to renew.
      const res = await request(app)
        .post(`${API}/auth/refresh`)
        .set('X-Client-App', 'admin')
        .set('Cookie', customerCookie)
        .send();

      // It used to hand back a working CUSTOMER token here.
      expect(res.status).toBe(401);
    });

    it('renews each app from its own cookie, as itself', async () => {
      const adminEmail = track(uniqueEmail('side-admin'));
      await createUser({ email: adminEmail, role: 'ADMIN' });

      const adminLogin = await request(app)
        .post(`${API}/auth/login`)
        .set('X-Client-App', 'admin')
        .send({ email: adminEmail, password: VALID_PASSWORD });

      const customerEmail = track(uniqueEmail('side-customer'));
      const customerLogin = await request(app)
        .post(`${API}/auth/register`)
        .send({ fullName: 'Side Customer', email: customerEmail, password: VALID_PASSWORD, dateOfBirth: '1990-01-15' });

      // Both cookies in one jar, exactly as a real browser would hold them.
      const jar = [
        readCookie(adminLogin, 'adminRefreshToken')!.split(';')[0]!,
        readCookie(customerLogin, 'refreshToken')!.split(';')[0]!,
      ].join('; ');

      const asAdmin = await request(app)
        .post(`${API}/auth/refresh`)
        .set('X-Client-App', 'admin')
        .set('Cookie', jar)
        .send();

      const asCustomer = await request(app).post(`${API}/auth/refresh`).set('Cookie', jar).send();

      expect(asAdmin.status).toBe(200);
      expect(asAdmin.body.data.user.email).toBe(adminEmail);
      expect(asAdmin.body.data.user.role).toBe('ADMIN');

      expect(asCustomer.status).toBe(200);
      expect(asCustomer.body.data.user.email).toBe(customerEmail);
      expect(asCustomer.body.data.user.role).toBe('CUSTOMER');
    });

    it('signing out of the admin leaves the customer session alone', async () => {
      const adminEmail = track(uniqueEmail('out-admin'));
      await createUser({ email: adminEmail, role: 'ADMIN' });

      const adminLogin = await request(app)
        .post(`${API}/auth/login`)
        .set('X-Client-App', 'admin')
        .send({ email: adminEmail, password: VALID_PASSWORD });

      const customerEmail = track(uniqueEmail('out-customer'));
      const customerLogin = await request(app)
        .post(`${API}/auth/register`)
        .send({ fullName: 'Out Customer', email: customerEmail, password: VALID_PASSWORD, dateOfBirth: '1990-01-15' });

      const customerCookie = readCookie(customerLogin, 'refreshToken')!.split(';')[0]!;
      const jar = [
        readCookie(adminLogin, 'adminRefreshToken')!.split(';')[0]!,
        customerCookie,
      ].join('; ');

      const loggedOut = await request(app)
        .post(`${API}/auth/logout`)
        .set('X-Client-App', 'admin')
        .set('Cookie', jar)
        .send();
      expect(loggedOut.status).toBe(200);

      // The customer, in the next tab, is still signed in.
      const stillIn = await request(app)
        .post(`${API}/auth/refresh`)
        .set('Cookie', customerCookie)
        .send();
      expect(stillIn.status).toBe(200);
      expect(stillIn.body.data.user.email).toBe(customerEmail);
    });
  });

  it('IGNORES a role field in the body - no self-promotion to ADMIN', async () => {
    const email = track(uniqueEmail('escalate'));
    const res = await request(app).post(`${API}/auth/register`).send({
      fullName: 'Sneaky User',
      email,
      password: VALID_PASSWORD,
      dateOfBirth: '1990-01-15',
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
      .send({ fullName: 'Duplicate', email, password: VALID_PASSWORD, dateOfBirth: '1990-01-15' });

    expect(res.status).toBe(409);
  });

  it('normalises email to lowercase so one address cannot become two accounts', async () => {
    const lower = track(uniqueEmail('case'));
    const res = await request(app)
      .post(`${API}/auth/register`)
      .send({
        fullName: 'Case Test',
        email: lower.toUpperCase(),
        password: VALID_PASSWORD,
        dateOfBirth: '1990-01-15',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.user.email).toBe(lower);
  });

  /*
   * ==========================================================================
   * ASKING FOR THE DATE OF BIRTH AT SIGN-UP, NOT AT BOOKING
   * ==========================================================================
   * It used to live on the profile screen, so the first time most customers
   * were asked was halfway through a booking: the minimum-age rule fired, the
   * booking stopped, and somebody who had already chosen a car and picked
   * dates was sent off to fill in a form. These prove the field is collected
   * at sign-up and actually lands on the rental profile - which is the only
   * thing that stops the booking flow having to ask.
   */
  it('saves the date of birth onto the rental profile', async () => {
    const email = track(uniqueEmail('dob'));

    const res = await request(app).post(`${API}/auth/register`).send({
      fullName: 'Dated Customer',
      email,
      password: VALID_PASSWORD,
      dateOfBirth: '1994-06-30',
    });

    expect(res.status).toBe(201);

    // On the CUSTOMER row, not the login: the booking flow reads it there.
    const customer = await prisma.customer.findFirst({
      where: { user: { email } },
      select: { dateOfBirth: true },
    });

    expect(customer).not.toBeNull();
    expect(customer?.dateOfBirth?.toISOString().slice(0, 10)).toBe('1994-06-30');
  });

  it('refuses to create an account without one', async () => {
    const res = await request(app)
      .post(`${API}/auth/register`)
      .send({ fullName: 'No Birthday', email: uniqueEmail('nodob'), password: VALID_PASSWORD });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/dateOfBirth/i);
  });

  it('refuses a date that cannot describe a living driver', async () => {
    for (const dateOfBirth of ['2025-01-01', '1890-01-01']) {
      const res = await request(app)
        .post(`${API}/auth/register`)
        .send({
          fullName: 'Impossible Age',
          email: uniqueEmail('badage'),
          password: VALID_PASSWORD,
          dateOfBirth,
        });

      expect(res.status).toBe(400);
    }
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
