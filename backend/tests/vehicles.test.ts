/**
 * tests/vehicles.test.ts
 * ---------------------------------------------------------------------------
 * Phase 3 acceptance: an admin can manage the fleet, a customer can browse it,
 * and neither can do the other's job.
 */
import zlib from 'node:zlib';
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { prisma, disconnectPrisma } from '../src/config/prisma';
import { API, cleanupUsers, createUser, loginAndGetToken } from './helpers';

const app = createApp();
const createdEmails: string[] = [];
const createdVehicleIds: string[] = [];

let adminToken: string;
let customerToken: string;
let categoryId: string;

/** Unique plate per run, so repeated runs never collide on the unique index. */
function plate(): string {
  return `TST-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 1000)}`;
}

function vehiclePayload(overrides: Record<string, unknown> = {}) {
  return {
    brand: 'Toyota',
    model: 'Land Cruiser',
    year: 2024,
    registrationNumber: plate(),
    categoryId,
    seats: 7,
    transmission: 'AUTOMATIC',
    fuelType: 'PETROL',
    dailyPrice: '550.00',
    securityDeposit: '2500.00',
    ...overrides,
  };
}

beforeAll(async () => {
  const admin = await createUser({ role: 'ADMIN' });
  const customer = await createUser({ role: 'CUSTOMER' });
  createdEmails.push(admin.email, customer.email);

  adminToken = await loginAndGetToken(app, admin.email);
  customerToken = await loginAndGetToken(app, customer.email);

  const category = await prisma.vehicleCategory.findFirst({ where: { isActive: true } });
  if (!category) throw new Error('No seeded category found. Run: npm run prisma:seed');
  categoryId = category.id;
});

afterAll(async () => {
  if (createdVehicleIds.length > 0) {
    await prisma.vehicleImage.deleteMany({ where: { vehicleId: { in: createdVehicleIds } } });
    await prisma.vehicleFeatureOnVehicle.deleteMany({
      where: { vehicleId: { in: createdVehicleIds } },
    });
    await prisma.vehicle.deleteMany({ where: { id: { in: createdVehicleIds } } });
  }
  await cleanupUsers(createdEmails);
  await disconnectPrisma();
});

describe('vehicle access control', () => {
  it('lets anyone browse the fleet without logging in', async () => {
    const res = await request(app).get(`${API}/vehicles`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.items)).toBe(true);
  });

  it('refuses vehicle creation to a CUSTOMER', async () => {
    const res = await request(app)
      .post(`${API}/vehicles`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send(vehiclePayload());

    expect(res.status).toBe(403);
  });

  it('refuses vehicle creation to an anonymous caller', async () => {
    const res = await request(app).post(`${API}/vehicles`).send(vehiclePayload());
    expect(res.status).toBe(401);
  });

  it('lets an ADMIN create a vehicle', async () => {
    const res = await request(app)
      .post(`${API}/vehicles`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(vehiclePayload());

    expect(res.status).toBe(201);
    createdVehicleIds.push(res.body.data.vehicle.id);
  });
});

describe('money precision', () => {
  it('returns prices as fixed 2-decimal strings, not floats', async () => {
    const res = await request(app)
      .post(`${API}/vehicles`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(vehiclePayload({ dailyPrice: '249.99', securityDeposit: '1500.50' }));

    expect(res.status).toBe(201);
    createdVehicleIds.push(res.body.data.vehicle.id);

    // A float round-trip would give 249.99000000000001 or similar.
    expect(res.body.data.vehicle.pricing.daily).toBe('249.99');
    expect(res.body.data.vehicle.pricing.securityDeposit).toBe('1500.50');
    expect(typeof res.body.data.vehicle.pricing.daily).toBe('string');
  });

  it('rejects a malformed price', async () => {
    const res = await request(app)
      .post(`${API}/vehicles`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(vehiclePayload({ dailyPrice: '12.999' }));

    expect(res.status).toBe(400);
    expect(res.body.errors.some((e: { field: string }) => e.field === 'dailyPrice')).toBe(true);
  });
});

describe('fleet integrity rules', () => {
  it('rejects a duplicate registration number', async () => {
    const payload = vehiclePayload();

    const first = await request(app)
      .post(`${API}/vehicles`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(payload);
    expect(first.status).toBe(201);
    createdVehicleIds.push(first.body.data.vehicle.id);

    const second = await request(app)
      .post(`${API}/vehicles`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(payload);

    expect(second.status).toBe(409);
    expect(second.body.message).toContain('already exists');
  });

  it('rejects a category that does not exist', async () => {
    const res = await request(app)
      .post(`${API}/vehicles`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(vehiclePayload({ categoryId: '00000000-0000-4000-8000-000000000000' }));

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('category');
  });

  it('refuses to delete a category that still has vehicles', async () => {
    const created = await request(app)
      .post(`${API}/vehicles`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(vehiclePayload());
    createdVehicleIds.push(created.body.data.vehicle.id);

    const res = await request(app)
      .delete(`${API}/categories/${categoryId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(409);
    expect(res.body.message).toContain('Deactivate it instead');
  });
});

describe('public vs admin visibility', () => {
  it('hides the registration number from the public view', async () => {
    const created = await request(app)
      .post(`${API}/vehicles`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(vehiclePayload());
    const id = created.body.data.vehicle.id;
    createdVehicleIds.push(id);

    const publicView = await request(app).get(`${API}/vehicles/${id}`);
    const adminView = await request(app)
      .get(`${API}/vehicles/${id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(publicView.body.data.vehicle.registrationNumber).toBeNull();
    expect(adminView.body.data.vehicle.registrationNumber).toBeTruthy();
  });

  it('hides an unpublished vehicle from the public entirely', async () => {
    const created = await request(app)
      .post(`${API}/vehicles`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(vehiclePayload({ isPublished: false }));
    const id = created.body.data.vehicle.id;
    createdVehicleIds.push(id);

    const direct = await request(app).get(`${API}/vehicles/${id}`);
    expect(direct.status).toBe(404);

    const list = await request(app).get(`${API}/vehicles?limit=60`);
    expect(list.body.data.items.some((v: { id: string }) => v.id === id)).toBe(false);
  });

  it('ignores includeUnpublished when a CUSTOMER sends it', async () => {
    const created = await request(app)
      .post(`${API}/vehicles`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(vehiclePayload({ isPublished: false }));
    const id = created.body.data.vehicle.id;
    createdVehicleIds.push(id);

    const res = await request(app)
      .get(`${API}/vehicles?includeUnpublished=true&limit=60`)
      .set('Authorization', `Bearer ${customerToken}`);

    expect(res.body.data.items.some((v: { id: string }) => v.id === id)).toBe(false);
  });
});

describe('image upload validation', () => {
  /** A genuinely valid 2x2 PNG, built byte by byte. */
  function realPng(): Buffer {
    const chunk = (type: string, data: Buffer): Buffer => {
      const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
      const length = Buffer.alloc(4);
      length.writeUInt32BE(data.length);
      const crcTable: number[] = [];
      for (let n = 0; n < 256; n += 1) {
        let c = n;
        for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        crcTable[n] = c >>> 0;
      }
      let crc = 0xffffffff;
      for (const byte of body) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
      const crcBuf = Buffer.alloc(4);
      crcBuf.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
      return Buffer.concat([length, body, crcBuf]);
    };

    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(2, 0);
    ihdr.writeUInt32BE(2, 4);
    ihdr[8] = 8;
    ihdr[9] = 2;

    // Imported at the top rather than required inline: `require` in an ES
    // module is a footgun waiting for someone to move this file.
    const raw = Buffer.concat([
      Buffer.from([0x00, 0x1e, 0x40, 0xaf, 0x1e, 0x40, 0xaf]),
      Buffer.from([0x00, 0x1e, 0x40, 0xaf, 0x1e, 0x40, 0xaf]),
    ]);

    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', zlib.deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]);
  }

  async function makeVehicle(): Promise<string> {
    const res = await request(app)
      .post(`${API}/vehicles`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(vehiclePayload());
    createdVehicleIds.push(res.body.data.vehicle.id);
    return res.body.data.vehicle.id as string;
  }

  it('accepts a real PNG and makes the first upload primary', async () => {
    const id = await makeVehicle();

    const res = await request(app)
      .post(`${API}/vehicles/${id}/images?type=EXTERIOR_FRONT`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('images', realPng(), { filename: 'front.png', contentType: 'image/png' });

    expect(res.status).toBe(201);
    expect(res.body.data.vehicle.images).toHaveLength(1);
    expect(res.body.data.vehicle.images[0].isPrimary).toBe(true);
    expect(res.body.data.vehicle.primaryImageUrl).toContain('/uploads/');
  });

  it('rejects a non-image whose MIME type CLAIMS to be an image', async () => {
    const id = await makeVehicle();

    // The declared content type is a client-supplied string. The bytes are not.
    const res = await request(app)
      .post(`${API}/vehicles/${id}/images`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('images', Buffer.from('<?php system($_GET["c"]); ?>'), {
        filename: 'shell.jpg',
        contentType: 'image/jpeg',
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('FILE_UPLOAD_ERROR');
    expect(res.body.message).toContain('not a valid');
  });

  it('rejects a disallowed file type outright', async () => {
    const id = await makeVehicle();

    const res = await request(app)
      .post(`${API}/vehicles/${id}/images`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('images', Buffer.from('plain text'), {
        filename: 'notes.txt',
        contentType: 'text/plain',
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('FILE_UPLOAD_ERROR');
  });

  it('refuses uploads from a CUSTOMER', async () => {
    const id = await makeVehicle();

    const res = await request(app)
      .post(`${API}/vehicles/${id}/images`)
      .set('Authorization', `Bearer ${customerToken}`)
      .attach('images', realPng(), { filename: 'front.png', contentType: 'image/png' });

    expect(res.status).toBe(403);
  });
});

describe('filtering and search', () => {
  it('filters by category slug', async () => {
    const category = await prisma.vehicleCategory.findFirst({ where: { id: categoryId } });
    const res = await request(app).get(`${API}/vehicles?category=${category!.slug}&limit=60`);

    expect(res.status).toBe(200);
    for (const vehicle of res.body.data.items) {
      expect(vehicle.category.slug).toBe(category!.slug);
    }
  });

  it('filters by transmission', async () => {
    const res = await request(app).get(`${API}/vehicles?transmission=AUTOMATIC&limit=60`);

    expect(res.status).toBe(200);
    for (const vehicle of res.body.data.items) {
      expect(vehicle.transmission).toBe('AUTOMATIC');
    }
  });

  it('rejects an invalid filter value instead of ignoring it', async () => {
    const res = await request(app).get(`${API}/vehicles?transmission=ROCKET`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });
});
