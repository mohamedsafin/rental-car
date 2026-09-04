/**
 * tests/rentals.test.ts
 * ---------------------------------------------------------------------------
 * PHASE 8 ACCEPTANCE: one booking taken through pickup -> active -> return ->
 * charges -> deposit settlement, with an inspection at each end.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'node:crypto';
import { createApp } from '../src/app';
import { prisma, disconnectPrisma } from '../src/config/prisma';
import { env } from '../src/config/env';
import { clearSettingsCache } from '../src/modules/settings/service';
import { API, cleanupUsers, createUser, loginAndGetToken } from './helpers';

const app = createApp();
const createdEmails: string[] = [];

let customerToken: string;
let staffToken: string;
let adminToken: string;
let vehicleId: string;

function future(days: number, hour = 10): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  date.setUTCHours(hour, 0, 0, 0);
  return date.toISOString();
}

/** A rental window in the PAST, so a return can be "late" relative to it. */
function past(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString();
}

function sign(body: string): string {
  return crypto
    .createHmac('sha256', env.PAYMENT_WEBHOOK_SECRET ?? '')
    .update(Buffer.from(body, 'utf8'))
    .digest('hex');
}

beforeAll(async () => {
  const customer = await createUser({ role: 'CUSTOMER' });
  const staff = await createUser({ role: 'STAFF' });
  const admin = await createUser({ role: 'ADMIN' });
  createdEmails.push(customer.email, staff.email, admin.email);

  customerToken = await loginAndGetToken(app, customer.email);
  staffToken = await loginAndGetToken(app, staff.email);
  adminToken = await loginAndGetToken(app, admin.email);

  const category = await prisma.vehicleCategory.findFirst({ where: { isActive: true } });
  const vehicle = await prisma.vehicle.create({
    data: {
      brand: 'Rental',
      model: 'TestCar',
      year: 2024,
      registrationNumber: `RNT-${Date.now().toString().slice(-8)}`,
      categoryId: category!.id,
      seats: 5,
      transmission: 'AUTOMATIC',
      fuelType: 'PETROL',
      dailyPrice: '200.00',
      securityDeposit: '1000.00',
      mileageLimitPerDay: 250,
      extraMileageCharge: '1.50',
      currentMileage: 10_000,
    },
  });
  vehicleId = vehicle.id;

  // Configure a full charge policy so the calculations are exercised.
  for (const [key, value] of [
    ['rental.late_grace_hours', '2'],
    ['rental.late_fee_per_day', '250'],
    ['rental.fuel_charge_per_percent', '4'],
    ['rental.cleaning_fee', '150'],
  ]) {
    await prisma.systemSetting.upsert({
      where: { key: key as string },
      update: { value: value as string },
      create: {
        key: key as string,
        value: value as string,
        valueType: 'NUMBER',
        category: 'RENTAL_POLICY',
        label: key as string,
      },
    });
  }
  clearSettingsCache();
});

afterAll(async () => {
  const bookings = await prisma.booking.findMany({ where: { vehicleId }, select: { id: true } });
  const ids = bookings.map((b) => b.id);
  if (ids.length > 0) {
    await prisma.inspectionPhoto.deleteMany({
      where: { inspection: { rental: { bookingId: { in: ids } } } },
    });
    await prisma.vehicleInspection.deleteMany({ where: { rental: { bookingId: { in: ids } } } });
    await prisma.rental.deleteMany({ where: { bookingId: { in: ids } } });
    await prisma.bookingExtension.deleteMany({ where: { bookingId: { in: ids } } });
    await prisma.additionalCharge.deleteMany({ where: { bookingId: { in: ids } } });
    await prisma.depositTransaction.deleteMany({ where: { deposit: { bookingId: { in: ids } } } });
    await prisma.securityDeposit.deleteMany({ where: { bookingId: { in: ids } } });
    await prisma.refund.deleteMany({ where: { payment: { bookingId: { in: ids } } } });
    await prisma.payment.deleteMany({ where: { bookingId: { in: ids } } });
    await prisma.bookingStatusHistory.deleteMany({ where: { bookingId: { in: ids } } });
    await prisma.bookingService.deleteMany({ where: { bookingId: { in: ids } } });
    await prisma.booking.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.vehicle.deleteMany({ where: { id: vehicleId } });

  const customers = await prisma.customer.findMany({
    where: { user: { email: { in: createdEmails } } },
    select: { id: true },
  });
  const customerIds = customers.map((c) => c.id);
  if (customerIds.length > 0) {
    await prisma.customerDocument.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
  }
  await cleanupUsers(createdEmails);
  await disconnectPrisma();
});

/** Book, pay, and move to READY_FOR_PICKUP. */
async function readyBooking(
  pickupAt: string,
  returnAt: string,
): Promise<{ bookingId: string }> {
  const created = await request(app)
    .post(`${API}/bookings`)
    .set('Authorization', `Bearer ${customerToken}`)
    .send({ vehicleId, pickupAt, returnAt });

  const bookingId = created.body.data.booking.id as string;

  // Straight to READY_FOR_PICKUP via the status API, so these tests exercise
  // the rental module rather than re-testing payments.
  for (const status of ['PAYMENT_PENDING', 'CONFIRMED', 'READY_FOR_PICKUP']) {
    await request(app)
      .patch(`${API}/bookings/${bookingId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status });
  }

  return { bookingId };
}

describe('vehicle handover (BRD 24)', () => {
  it('records the pickup, activates the booking and marks the car RENTED', async () => {
    const { bookingId } = await readyBooking(future(10), future(15));

    const res = await request(app)
      .post(`${API}/rentals/booking/${bookingId}/pickup`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        mileage: 10_000,
        fuelPercent: 100,
        customerVerified: true,
        conditionNotes: 'Good condition',
        damageNotes: 'Small stone chip on the windscreen',
        accessories: ['spare tyre', 'jack', 'first aid kit'],
      });

    expect(res.status).toBe(201);
    expect(res.body.data.rental.status).toBe('ACTIVE');
    expect(res.body.data.rental.inspections).toHaveLength(1);
    expect(res.body.data.rental.inspections[0].type).toBe('PICKUP');
    expect(res.body.data.rental.inspections[0].customerVerified).toBe(true);

    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(booking.status).toBe('ACTIVE');

    const vehicle = await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicleId } });
    expect(vehicle.status).toBe('RENTED');
  });

  it('REFUSES handover without customer verification (BRD 24)', async () => {
    const { bookingId } = await readyBooking(future(20), future(25));

    const res = await request(app)
      .post(`${API}/rentals/booking/${bookingId}/pickup`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ mileage: 10_100, fuelPercent: 100, customerVerified: false });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('identity');
  });

  it('REFUSES a mileage reading below the last recorded one', async () => {
    const { bookingId } = await readyBooking(future(30), future(35));

    const res = await request(app)
      .post(`${API}/rentals/booking/${bookingId}/pickup`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ mileage: 1, fuelPercent: 100, customerVerified: true });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('below');
  });

  it('REFUSES a second handover of the same booking', async () => {
    const { bookingId } = await readyBooking(future(40), future(45));

    await request(app)
      .post(`${API}/rentals/booking/${bookingId}/pickup`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ mileage: 10_200, fuelPercent: 100, customerVerified: true });

    const second = await request(app)
      .post(`${API}/rentals/booking/${bookingId}/pickup`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ mileage: 10_200, fuelPercent: 100, customerVerified: true });

    expect(second.status).toBe(409);
  });

  it('REFUSES handover by a CUSTOMER', async () => {
    const { bookingId } = await readyBooking(future(50), future(55));

    const res = await request(app)
      .post(`${API}/rentals/booking/${bookingId}/pickup`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ mileage: 10_300, fuelPercent: 100, customerVerified: true });

    expect(res.status).toBe(403);
  });
});

describe('vehicle return and charges (BRD 26, 30)', () => {
  /** Hand a car over, then move the due-back time into the past. */
  async function activeOverdueRental(mileage: number, startDay: number): Promise<string> {
    // Each call needs its OWN window: these bookings share one vehicle, and
    // reusing a window makes the second collide with the first.
    const created = await request(app)
      .post(`${API}/bookings`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ vehicleId, pickupAt: future(startDay), returnAt: future(startDay + 5) });

    expect(created.status).toBe(201);
    const bookingId = created.body.data.booking.id as string;

    for (const status of ['PAYMENT_PENDING', 'CONFIRMED', 'READY_FOR_PICKUP']) {
      await request(app)
        .patch(`${API}/bookings/${bookingId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status });
    }

    await request(app)
      .post(`${API}/rentals/booking/${bookingId}/pickup`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ mileage, fuelPercent: 100, customerVerified: true });

    // Move the WHOLE window into the past, not just the return time. The
    // database's bookings_return_after_pickup check refuses an inverted range
    // - correctly - and caught this test's first attempt to fake a late
    // return by dragging returnAt backwards on its own.
    await prisma.booking.update({
      where: { id: bookingId },
      data: { pickupAt: new Date(past(6)), returnAt: new Date(past(1)) },
    });

    return bookingId;
  }

  it('records the return, raises charges and puts the car UNDER_INSPECTION', async () => {
    const bookingId = await activeOverdueRental(11_000, 200);

    const res = await request(app)
      .post(`${API}/rentals/booking/${bookingId}/return`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        // 2500km driven against a 1250km allowance = 1250km excess.
        mileage: 13_500,
        fuelPercent: 70,
        needsCleaning: true,
        damageNotes: 'New scratch on the rear bumper',
        cleanliness: 'Sand throughout the interior',
      });

    expect(res.status).toBe(200);

    const types = res.body.data.charges.map((c: { type: string }) => c.type).sort();
    expect(types).toEqual(['CLEANING', 'EXCESS_MILEAGE', 'FUEL', 'LATE_RETURN']);

    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(booking.status).toBe('RETURNED');

    // UNDER_INSPECTION, not AVAILABLE - the car has not been checked yet.
    const vehicle = await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicleId } });
    expect(vehicle.status).toBe('UNDER_INSPECTION');
  });

  it('keeps BOTH inspections so pickup and return can be compared', async () => {
    const bookingId = await activeOverdueRental(20_000, 220);

    await request(app)
      .post(`${API}/rentals/booking/${bookingId}/return`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ mileage: 20_100, fuelPercent: 100 });

    const res = await request(app)
      .get(`${API}/rentals/booking/${bookingId}`)
      .set('Authorization', `Bearer ${staffToken}`);

    const types = res.body.data.rental.inspections.map((i: { type: string }) => i.type);
    expect(types).toEqual(['PICKUP', 'RETURN']);
  });

  it('REFUSES a return mileage below the pickup reading', async () => {
    const bookingId = await activeOverdueRental(30_000, 240);

    const res = await request(app)
      .post(`${API}/rentals/booking/${bookingId}/return`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ mileage: 100, fuelPercent: 100 });

    expect(res.status).toBe(400);
  });

  it('raises NO charges for a clean, on-time, in-allowance return', async () => {
    const created = await request(app)
      .post(`${API}/bookings`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ vehicleId, pickupAt: future(300), returnAt: future(305) });
    const bookingId = created.body.data.booking.id as string;

    for (const status of ['PAYMENT_PENDING', 'CONFIRMED', 'READY_FOR_PICKUP']) {
      await request(app)
        .patch(`${API}/bookings/${bookingId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status });
    }

    await request(app)
      .post(`${API}/rentals/booking/${bookingId}/pickup`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ mileage: 40_000, fuelPercent: 100, customerVerified: true });

    const res = await request(app)
      .post(`${API}/rentals/booking/${bookingId}/return`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ mileage: 40_500, fuelPercent: 100, needsCleaning: false });

    expect(res.status).toBe(200);
    expect(res.body.data.charges).toHaveLength(0);
    expect(res.body.data.chargeTotal).toBe('0.00');
  });
});

describe('extensions (BRD 23)', () => {
  /** An ACTIVE rental starting well clear of other test bookings. */
  async function activeRental(startDay: number): Promise<string> {
    const created = await request(app)
      .post(`${API}/bookings`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ vehicleId, pickupAt: future(startDay), returnAt: future(startDay + 3) });

    const bookingId = created.body.data.booking.id as string;

    for (const status of ['PAYMENT_PENDING', 'CONFIRMED', 'READY_FOR_PICKUP']) {
      await request(app)
        .patch(`${API}/bookings/${bookingId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status });
    }

    await request(app)
      .post(`${API}/rentals/booking/${bookingId}/pickup`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ mileage: 50_000, fuelPercent: 100, customerVerified: true });

    return bookingId;
  }

  it('lets a customer request an extension and prices the extra days', async () => {
    const bookingId = await activeRental(400);

    const res = await request(app)
      .post(`${API}/rentals/booking/${bookingId}/extensions`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ requestedReturnAt: future(406) });

    expect(res.status).toBe(201);
    expect(res.body.data.extension.status).toBe('REQUESTED');
    expect(res.body.data.extension.additionalDays).toBe(3);
    expect(Number(res.body.data.extension.additionalAmount)).toBeGreaterThan(0);

    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(booking.status).toBe('EXTENSION_REQUESTED');
  });

  it('REFUSES an extension into a period the car is already booked for', async () => {
    const bookingId = await activeRental(500);

    // Somebody else has the car straight afterwards.
    await request(app)
      .post(`${API}/bookings`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ vehicleId, pickupAt: future(504), returnAt: future(508) });

    const res = await request(app)
      .post(`${API}/rentals/booking/${bookingId}/extensions`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ requestedReturnAt: future(506) });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('VEHICLE_UNAVAILABLE');
  });

  it('moves the booking return date when an extension is approved', async () => {
    const bookingId = await activeRental(600);

    const requested = await request(app)
      .post(`${API}/rentals/booking/${bookingId}/extensions`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ requestedReturnAt: future(606) });

    const before = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });

    const res = await request(app)
      .patch(`${API}/rentals/extensions/${requested.body.data.extension.id}/review`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ approve: true });

    expect(res.status).toBe(200);
    expect(res.body.data.extension.status).toBe('APPROVED');

    const after = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(after.status).toBe('ACTIVE');
    expect(after.returnAt.getTime()).toBeGreaterThan(before.returnAt.getTime());
    // The extra days are added to the booking's own figures.
    expect(after.rentalDays).toBeGreaterThan(before.rentalDays);
    expect(after.totalAmount.greaterThan(before.totalAmount)).toBe(true);
  });

  it('REFUSES a rejection with no reason, and returns the booking to ACTIVE on one', async () => {
    const bookingId = await activeRental(700);

    const requested = await request(app)
      .post(`${API}/rentals/booking/${bookingId}/extensions`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ requestedReturnAt: future(706) });

    const noReason = await request(app)
      .patch(`${API}/rentals/extensions/${requested.body.data.extension.id}/review`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ approve: false });
    expect(noReason.status).toBe(400);

    const rejected = await request(app)
      .patch(`${API}/rentals/extensions/${requested.body.data.extension.id}/review`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ approve: false, rejectionReason: 'The vehicle is booked in for a service.' });

    expect(rejected.status).toBe(200);

    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(booking.status).toBe('ACTIVE');
  });

  it('REFUSES review by a CUSTOMER', async () => {
    const bookingId = await activeRental(800);

    const requested = await request(app)
      .post(`${API}/rentals/booking/${bookingId}/extensions`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ requestedReturnAt: future(806) });

    const res = await request(app)
      .patch(`${API}/rentals/extensions/${requested.body.data.extension.id}/review`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ approve: true });

    expect(res.status).toBe(403);
  });
});
