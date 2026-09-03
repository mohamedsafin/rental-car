/**
 * tests/rbac.test.ts
 * ---------------------------------------------------------------------------
 * The phase's definition of done: a CUSTOMER token must be refused on an admin
 * endpoint by the BACKEND, regardless of what the frontend allows.
 *
 * Also covers the guard rails that stop an admin locking everyone out.
 */
import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { disconnectPrisma } from '../src/config/prisma';
import {
  API,
  VALID_PASSWORD,
  cleanupUsers,
  createUser,
  createUserAndLogin,
  loginAndGetToken,
} from './helpers';

const app = createApp();
const createdEmails: string[] = [];

/** Pull the refresh cookie out of a Set-Cookie header array. */
function refreshCookie(res: request.Response): string {
  const cookies = res.headers['set-cookie'] as unknown as string[];
  const found = cookies?.find((c) => c.startsWith('refreshToken='));
  if (!found) throw new Error('No refresh cookie on response');
  return found;
}

afterAll(async () => {
  await cleanupUsers(createdEmails);
  await disconnectPrisma();
});

describe('GET /users access control', () => {
  it('rejects an anonymous request with 401', async () => {
    const res = await request(app).get(`${API}/users`);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('rejects a CUSTOMER token with 403 - the phase acceptance test', async () => {
    const { user, token } = await createUserAndLogin(app, 'CUSTOMER');
    createdEmails.push(user.email);

    const res = await request(app).get(`${API}/users`).set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('rejects a STAFF token with 403 - staff are not admins', async () => {
    const { user, token } = await createUserAndLogin(app, 'STAFF');
    createdEmails.push(user.email);

    const res = await request(app).get(`${API}/users`).set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it('allows an ADMIN token', async () => {
    const { user, token } = await createUserAndLogin(app, 'ADMIN');
    createdEmails.push(user.email);

    const res = await request(app).get(`${API}/users`).set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.items)).toBe(true);
  });

  it('rejects a malformed or forged token with 401, not 500', async () => {
    for (const header of ['Bearer not.a.token', 'Bearer ', 'Basic abc123']) {
      const res = await request(app).get(`${API}/users`).set('Authorization', header);
      expect(res.status).toBe(401);
    }
  });
});

describe('admin guard rails', () => {
  it('stops an admin changing their own role', async () => {
    const admin = await createUser({ role: 'ADMIN' });
    createdEmails.push(admin.email);
    const token = await loginAndGetToken(app, admin.email);

    const res = await request(app)
      .patch(`${API}/users/${admin.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'STAFF' });

    expect(res.status).toBe(403);
    expect(res.body.message).toContain('your own role');
  });

  it('stops an admin deleting their own account', async () => {
    const admin = await createUser({ role: 'ADMIN' });
    createdEmails.push(admin.email);
    const token = await loginAndGetToken(app, admin.email);

    const res = await request(app)
      .delete(`${API}/users/${admin.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it('revokes the target user sessions when their role changes', async () => {
    const admin = await createUser({ role: 'ADMIN' });
    const victim = await createUser({ role: 'CUSTOMER' });
    createdEmails.push(admin.email, victim.email);

    const adminToken = await loginAndGetToken(app, admin.email);
    const login = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: victim.email, password: VALID_PASSWORD });
    const cookie = refreshCookie(login);

    await request(app)
      .patch(`${API}/users/${victim.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'STAFF' });

    // Their refresh token is dead, so they cannot obtain a new access token
    // under the old role once the current 15-minute one expires.
    const res = await request(app).post(`${API}/auth/refresh`).set('Cookie', cookie);
    expect(res.status).toBe(401);
  });

  it('validates the user id is a UUID rather than querying with junk', async () => {
    const { user, token } = await createUserAndLogin(app, 'ADMIN');
    createdEmails.push(user.email);

    const res = await request(app)
      .get(`${API}/users/not-a-uuid`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });
});

describe('token lifecycle', () => {
  it('rotates the refresh token and kills the whole family on re-use', async () => {
    const user = await createUser({ role: 'CUSTOMER' });
    createdEmails.push(user.email);

    const login = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: user.email, password: VALID_PASSWORD });
    const first = refreshCookie(login);

    const rotated = await request(app).post(`${API}/auth/refresh`).set('Cookie', first);
    expect(rotated.status).toBe(200);

    const second = refreshCookie(rotated);
    expect(second).not.toBe(first);

    // Replaying the revoked first token is treated as theft...
    const replay = await request(app).post(`${API}/auth/refresh`).set('Cookie', first);
    expect(replay.status).toBe(401);

    // ...and takes the legitimate second token down with it.
    const afterTheft = await request(app).post(`${API}/auth/refresh`).set('Cookie', second);
    expect(afterTheft.status).toBe(401);
  });

  it('GET /auth/me returns the caller and requires a token', async () => {
    const { user, token } = await createUserAndLogin(app, 'CUSTOMER');
    createdEmails.push(user.email);

    const authed = await request(app).get(`${API}/auth/me`).set('Authorization', `Bearer ${token}`);
    const anon = await request(app).get(`${API}/auth/me`);

    expect(authed.status).toBe(200);
    expect(authed.body.data.user.email).toBe(user.email);
    expect(anon.status).toBe(401);
  });

  it('logout revokes the session', async () => {
    const user = await createUser({ role: 'CUSTOMER' });
    createdEmails.push(user.email);

    const login = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: user.email, password: VALID_PASSWORD });
    const cookie = refreshCookie(login);

    await request(app).post(`${API}/auth/logout`).set('Cookie', cookie);

    const res = await request(app).post(`${API}/auth/refresh`).set('Cookie', cookie);
    expect(res.status).toBe(401);
  });
});
