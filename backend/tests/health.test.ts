/**
 * tests/health.test.ts
 * ---------------------------------------------------------------------------
 * Phase 1 acceptance tests.
 *
 * These use Supertest, which sends real HTTP requests through the Express app
 * in-process — no port binding, no running server needed. Every module we add
 * from here on gets a test file just like this one.
 */
import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { disconnectPrisma } from '../src/config/prisma';

const app = createApp();
const API = '/api/v1';

afterAll(async () => {
  await disconnectPrisma();
});

describe('GET /api/v1/health/live', () => {
  it('reports the process is live without touching the database', async () => {
    const res = await request(app).get(`${API}/health/live`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('ok');
    expect(res.body.data.service).toBe('uae-car-rental-api');
  });
});

describe('GET /api/v1/health', () => {
  it('returns the standard success envelope', async () => {
    const res = await request(app).get(`${API}/health`);

    expect(res.body).toHaveProperty('success');
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('message');
  });

  it('reports database connectivity and matches the HTTP status to it', async () => {
    const res = await request(app).get(`${API}/health`);

    expect(['up', 'down']).toContain(res.body.data.dependencies.database);

    if (res.body.data.dependencies.database === 'up') {
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('ok');
    } else {
      // A DB-less API must NOT claim to be healthy.
      expect(res.status).toBe(503);
      expect(res.body.data.status).toBe('degraded');
    }
  });

  it('echoes a request id header for log correlation', async () => {
    const res = await request(app).get(`${API}/health`);
    expect(res.headers['x-request-id']).toBeTruthy();
  });
});

describe('CORS', () => {
  it('allows the customer site and the admin site', async () => {
    for (const origin of ['http://localhost:5173', 'http://localhost:5174']) {
      const res = await request(app).get(`${API}/health`).set('Origin', origin);
      expect(res.headers['access-control-allow-origin']).toBe(origin);
    }
  });

  it('rejects an unlisted origin with 403, not 500', async () => {
    const res = await request(app).get(`${API}/health`).set('Origin', 'http://evil.example.com');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('error handling', () => {
  it('returns the standard error envelope for an unknown route', async () => {
    const res = await request(app).get(`${API}/this-route-does-not-exist`);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('NOT_FOUND');
    expect(Array.isArray(res.body.errors)).toBe(true);
  });

  it('never leaks a stack trace to the client', async () => {
    const res = await request(app).get(`${API}/this-route-does-not-exist`);
    expect(JSON.stringify(res.body)).not.toContain('at Object');
    expect(res.body).not.toHaveProperty('stack');
  });
});
