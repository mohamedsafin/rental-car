/**
 * tests/documents.test.ts
 * ---------------------------------------------------------------------------
 * PHASE 5 ACCEPTANCE: a customer uploads a document, an admin approves or
 * rejects it with a reason, and the document is NOT reachable by anyone else.
 *
 * The access-control tests here matter more than the happy path. This module
 * stores Emirates IDs and passports.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createApp } from '../src/app';
import { prisma, disconnectPrisma } from '../src/config/prisma';
import { API, cleanupUsers, createUser, loginAndGetToken } from './helpers';

const app = createApp();
const createdEmails: string[] = [];

let customerToken: string;
let customerId: string;
let otherToken: string;
let adminToken: string;
let staffToken: string;

/** A genuinely valid 1x1 PNG. */
const REAL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const REAL_PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');

beforeAll(async () => {
  const customer = await createUser({ role: 'CUSTOMER' });
  const other = await createUser({ role: 'CUSTOMER' });
  const admin = await createUser({ role: 'ADMIN' });
  const staff = await createUser({ role: 'STAFF' });
  createdEmails.push(customer.email, other.email, admin.email, staff.email);

  customerToken = await loginAndGetToken(app, customer.email);
  otherToken = await loginAndGetToken(app, other.email);
  adminToken = await loginAndGetToken(app, admin.email);
  staffToken = await loginAndGetToken(app, staff.email);

  // Configure a requirement list so verification has something to check.
  await prisma.systemSetting.upsert({
    where: { key: 'documents.required_uae_resident' },
    update: { value: '["EMIRATES_ID","UAE_DRIVING_LICENCE"]' },
    create: {
      key: 'documents.required_uae_resident',
      value: '["EMIRATES_ID","UAE_DRIVING_LICENCE"]',
      valueType: 'JSON',
      category: 'DOCUMENTS',
      label: 'Required documents - UAE resident',
    },
  });

  const profile = await request(app)
    .patch(`${API}/customers/me`)
    .set('Authorization', `Bearer ${customerToken}`)
    .send({ residencyStatus: 'UAE_RESIDENT' });
  customerId = profile.body.data.customer.id;
});

afterAll(async () => {
  const customers = await prisma.customer.findMany({
    where: { user: { email: { in: createdEmails } } },
    select: { id: true },
  });
  const ids = customers.map((c) => c.id);
  if (ids.length > 0) {
    await prisma.customerDocument.deleteMany({ where: { customerId: { in: ids } } });
    await prisma.customer.deleteMany({ where: { id: { in: ids } } });
  }
  await cleanupUsers(createdEmails);
  await disconnectPrisma();
});

function upload(token: string, type = 'EMIRATES_ID', file = REAL_PNG, filename = 'eid.png') {
  return request(app)
    .post(`${API}/documents`)
    .set('Authorization', `Bearer ${token}`)
    .field('type', type)
    .attach('document', file, { filename, contentType: 'image/png' });
}

describe('document upload', () => {
  it('accepts a real image and marks it PENDING', async () => {
    const res = await upload(customerToken);

    expect(res.status).toBe(201);
    expect(res.body.data.document.status).toBe('PENDING');
    expect(res.body.data.document.type).toBe('EMIRATES_ID');
  });

  it('NEVER returns the storage key', async () => {
    const res = await upload(customerToken, 'PASSPORT');

    const body = JSON.stringify(res.body);
    expect(body).not.toContain('storageKey');
    expect(body).not.toContain('private/');
    expect(body).not.toContain('uploads');
  });

  it('accepts a PDF - visas are often issued as one', async () => {
    const res = await request(app)
      .post(`${API}/documents`)
      .set('Authorization', `Bearer ${customerToken}`)
      .field('type', 'VISA')
      .attach('document', REAL_PDF, { filename: 'visa.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(201);
  });

  it('rejects a file whose MIME type LIES about its contents', async () => {
    const res = await request(app)
      .post(`${API}/documents`)
      .set('Authorization', `Bearer ${customerToken}`)
      .field('type', 'PASSPORT')
      .attach('document', Buffer.from('<?php system($_GET["c"]); ?>'), {
        filename: 'passport.png',
        contentType: 'image/png',
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('FILE_UPLOAD_ERROR');
  });

  it('rejects a disallowed file type', async () => {
    const res = await request(app)
      .post(`${API}/documents`)
      .set('Authorization', `Bearer ${customerToken}`)
      .field('type', 'OTHER')
      .attach('document', Buffer.from('notes'), {
        filename: 'notes.txt',
        contentType: 'text/plain',
      });

    expect(res.status).toBe(400);
  });

  it('rejects an already-expired document', async () => {
    const res = await request(app)
      .post(`${API}/documents`)
      .set('Authorization', `Bearer ${customerToken}`)
      .field('type', 'DRIVING_LICENCE')
      .field('expiryDate', '2020-01-01')
      .attach('document', REAL_PNG, { filename: 'old.png', contentType: 'image/png' });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('expired');
  });

  it('requires authentication', async () => {
    const res = await request(app)
      .post(`${API}/documents`)
      .field('type', 'EMIRATES_ID')
      .attach('document', REAL_PNG, { filename: 'x.png', contentType: 'image/png' });

    expect(res.status).toBe(401);
  });
});

describe('private file access - the BRD 12 guarantee', () => {
  let documentId: string;

  beforeAll(async () => {
    const res = await upload(customerToken, 'UAE_DRIVING_LICENCE');
    documentId = res.body.data.document.id;
  });

  it('lets the OWNER fetch their own file', async () => {
    const res = await request(app)
      .get(`${API}/documents/${documentId}/file`)
      .set('Authorization', `Bearer ${customerToken}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');
    expect(res.headers['cache-control']).toContain('no-store');
  });

  it('lets STAFF fetch it for review', async () => {
    const res = await request(app)
      .get(`${API}/documents/${documentId}/file`)
      .set('Authorization', `Bearer ${staffToken}`);

    expect(res.status).toBe(200);
  });

  it('gives ANOTHER CUSTOMER 404, not 403 - a 403 would confirm it exists', async () => {
    const res = await request(app)
      .get(`${API}/documents/${documentId}/file`)
      .set('Authorization', `Bearer ${otherToken}`);

    expect(res.status).toBe(404);

    // A real id and a fake id must be indistinguishable to an outsider.
    const fake = await request(app)
      .get(`${API}/documents/11111111-1111-4111-8111-111111111111/file`)
      .set('Authorization', `Bearer ${otherToken}`);

    expect(fake.status).toBe(res.status);
    expect(fake.body.message).toBe(res.body.message);
  });

  it('refuses an anonymous request', async () => {
    const res = await request(app).get(`${API}/documents/${documentId}/file`);
    expect(res.status).toBe(401);
  });

  it('does NOT serve the file from the public /uploads path', async () => {
    const document = await prisma.customerDocument.findUnique({ where: { id: documentId } });
    expect(document?.storageKey.startsWith('private/')).toBe(true);

    // The stored key must not be reachable through the static mount, whichever
    // way an attacker guesses at the path.
    for (const guess of [
      `/uploads/${document!.storageKey}`,
      `/uploads/${document!.storageKey.replace('private/', '')}`,
      `/uploads/../private/${document!.storageKey}`,
    ]) {
      const res = await request(app).get(guess);
      expect(res.status).toBeGreaterThanOrEqual(400);
    }
  });

  it('writes the file outside the publicly served directory', async () => {
    const document = await prisma.customerDocument.findUnique({ where: { id: documentId } });
    const root = path.resolve(process.cwd(), 'uploads');
    const stored = path.resolve(root, document!.storageKey);

    // It exists...
    await expect(fs.access(stored)).resolves.toBeUndefined();
    // ...and it is NOT under uploads/public.
    expect(stored.startsWith(path.join(root, 'public'))).toBe(false);
  });
});

describe('verification workflow (BRD 13)', () => {
  it('refuses a rejection with no reason', async () => {
    const uploaded = await upload(customerToken, 'PASSPORT');

    const res = await request(app)
      .patch(`${API}/documents/${uploaded.body.data.document.id}/review`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'REJECTED' });

    expect(res.status).toBe(400);
    expect(res.body.errors.some((e: { field: string }) => e.field === 'rejectionReason')).toBe(true);
  });

  it('records the reason on a rejection so the customer can correct it', async () => {
    const uploaded = await upload(customerToken, 'PASSPORT');

    const res = await request(app)
      .patch(`${API}/documents/${uploaded.body.data.document.id}/review`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'REJECTED', rejectionReason: 'The photo page is blurred - please re-scan.' });

    expect(res.status).toBe(200);
    expect(res.body.data.document.status).toBe('REJECTED');
    expect(res.body.data.document.rejectionReason).toContain('blurred');
  });

  it('lets the customer re-upload, superseding the rejected document', async () => {
    const first = await upload(customerToken, 'OTHER');
    const firstId = first.body.data.document.id;

    await request(app)
      .patch(`${API}/documents/${firstId}/review`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'REJECTED', rejectionReason: 'Wrong document.' });

    const second = await upload(customerToken, 'OTHER');
    expect(second.status).toBe(201);

    // The rejected original is kept, marked superseded - it is part of the
    // record of what was checked, not something to erase.
    const original = await prisma.customerDocument.findUnique({ where: { id: firstId } });
    expect(original).not.toBeNull();
    expect(original?.supersededAt).not.toBeNull();
  });

  it('refuses to review a superseded document', async () => {
    const first = await upload(customerToken, 'INTERNATIONAL_DRIVING_PERMIT');
    await upload(customerToken, 'INTERNATIONAL_DRIVING_PERMIT');

    const res = await request(app)
      .patch(`${API}/documents/${first.body.data.document.id}/review`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'APPROVED' });

    expect(res.status).toBe(409);
  });

  it('refuses review by a CUSTOMER - they cannot approve their own documents', async () => {
    const uploaded = await upload(customerToken, 'EMIRATES_ID');

    const res = await request(app)
      .patch(`${API}/documents/${uploaded.body.data.document.id}/review`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ status: 'APPROVED' });

    expect(res.status).toBe(403);
  });

  it('marks the customer verified only when EVERY required document is approved', async () => {
    const eid = await upload(customerToken, 'EMIRATES_ID');
    const licence = await upload(customerToken, 'UAE_DRIVING_LICENCE');

    await request(app)
      .patch(`${API}/documents/${eid.body.data.document.id}/review`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'APPROVED' });

    // One of two approved - not verified yet.
    let summary = await request(app)
      .get(`${API}/customers/me`)
      .set('Authorization', `Bearer ${customerToken}`);
    expect(summary.body.data.verification.isVerified).toBe(false);

    await request(app)
      .patch(`${API}/documents/${licence.body.data.document.id}/review`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'APPROVED' });

    summary = await request(app)
      .get(`${API}/customers/me`)
      .set('Authorization', `Bearer ${customerToken}`);
    expect(summary.body.data.verification.isVerified).toBe(true);
  });

  it('un-verifies the customer when an approved document expires', async () => {
    const document = await prisma.customerDocument.findFirst({
      where: { customerId, type: 'EMIRATES_ID', supersededAt: null, status: 'APPROVED' },
    });
    expect(document).not.toBeNull();

    // Backdate the expiry, then run the sweep.
    await prisma.customerDocument.update({
      where: { id: document!.id },
      data: { expiryDate: new Date('2020-01-01') },
    });

    await request(app)
      .post(`${API}/documents/expire-overdue`)
      .set('Authorization', `Bearer ${staffToken}`);

    const summary = await request(app)
      .get(`${API}/customers/me`)
      .set('Authorization', `Bearer ${customerToken}`);

    // An APPROVED-but-expired licence must not keep counting as valid.
    expect(summary.body.data.verification.isVerified).toBe(false);
  });
});

describe('customer records access control', () => {
  it('refuses the staff customer list to a CUSTOMER', async () => {
    const res = await request(app)
      .get(`${API}/customers`)
      .set('Authorization', `Bearer ${customerToken}`);

    expect(res.status).toBe(403);
  });

  it('allows STAFF to list customers', async () => {
    const res = await request(app)
      .get(`${API}/customers`)
      .set('Authorization', `Bearer ${staffToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.items)).toBe(true);
  });

  it('refuses a CUSTOMER reading another customer file by id', async () => {
    const res = await request(app)
      .get(`${API}/customers/${customerId}`)
      .set('Authorization', `Bearer ${otherToken}`);

    expect(res.status).toBe(403);
  });
});
