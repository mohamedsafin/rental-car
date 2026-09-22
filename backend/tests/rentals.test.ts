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
import { API, cleanupUsers, createUser, loginAndGetToken, payRental } from './helpers';

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

/** Kept for webhook-driven tests; underscore marks it deliberately unused. */
function _sign(body: string): string {
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

/**
 * Vehicles this suite creates beyond the shared one.
 *
 * Anything measuring what the FLEET says needs a car of its own, and the
 * cleanup below has to know about it - a booking left pointing at a deleted
 * test user is what turns a passing suite into a failing teardown.
 */
const extraVehicleIds: string[] = [];

afterAll(async () => {
  const allVehicles = [vehicleId, ...extraVehicleIds];
  const bookings = await prisma.booking.findMany({
    where: { vehicleId: { in: allVehicles } },
    select: { id: true },
  });
  const ids = bookings.map((b) => b.id);
  if (ids.length > 0) {
    // Returning a car with damage notes now RAISES a damage record, so these
    // exist where they never used to and hold the vehicle down on delete.
    await prisma.damagePhoto.deleteMany({ where: { damage: { bookingId: { in: ids } } } });
    await prisma.damage.deleteMany({ where: { bookingId: { in: ids } } });
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
  await prisma.vehicle.deleteMany({ where: { id: { in: allVehicles } } });

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
  onVehicle?: string,
): Promise<{ bookingId: string }> {
  const created = await request(app)
    .post(`${API}/bookings`)
    .set('Authorization', `Bearer ${customerToken}`)
    .send({ vehicleId: onVehicle ?? vehicleId, pickupAt, returnAt });

  const bookingId = created.body.data.booking.id as string;

  // Payment first: confirmation no longer implies it, so both the
  // READY_FOR_PICKUP transition and the handover now refuse an unpaid booking.
  await payRental(bookingId);

  // Then straight to READY_FOR_PICKUP via the status API, so these tests
  // exercise the rental module rather than re-testing payments.
  for (const status of ['CONFIRMED', 'PAYMENT_PENDING', 'READY_FOR_PICKUP']) {
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
  /*
   * The PAST window has to be unique too.
   *
   * The comment below always said each call needs its own window, and the
   * future one is - but every call then dragged the booking onto the SAME past
   * dates, so the exclusion constraint refused the second overlap. It only
   * went unnoticed while few tests used this helper.
   */
  let pastWindowSeq = 0;

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

    await payRental(bookingId);

    for (const status of ['CONFIRMED', 'PAYMENT_PENDING', 'READY_FOR_PICKUP']) {
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
    const slot = pastWindowSeq++;
    await prisma.booking.update({
      where: { id: bookingId },
      data: {
        pickupAt: new Date(past(6 + slot * 10)),
        returnAt: new Date(past(1 + slot * 10)),
      },
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

    await payRental(bookingId);

    for (const status of ['CONFIRMED', 'PAYMENT_PENDING', 'READY_FOR_PICKUP']) {
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
  /*
   * The "New damage" box on the return form has to reach the damage queue.
   *
   * It used to be saved on the inspection and nowhere else, so the whole
   * assess-approve-charge workflow sat unreachable and the Damages screen was
   * permanently empty no matter how many scratches staff wrote down.
   */
  it('raises a damage record from the damage noted at return', async () => {
    const bookingId = await activeOverdueRental(41_000, 260);

    const res = await request(app)
      .post(`${API}/rentals/booking/${bookingId}/return`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        mileage: 41_500,
        fuelPercent: 100,
        damageNotes: 'Deep scratch along the rear passenger door',
      });
    expect(res.status).toBe(200);

    const damage = await prisma.damage.findFirstOrThrow({ where: { bookingId } });
    expect(damage.description).toBe('Deep scratch along the rear passenger door');
    expect(damage.vehicleId).toBe(vehicleId);
    // Uncosted on purpose: the person handing the car back knows what they can
    // see, not what the bodyshop will charge.
    expect(damage.status).toBe('REPORTED');
    expect(damage.estimatedAmount).toBeNull();
  });

  it('raises NO damage record when nothing was noted', async () => {
    const bookingId = await activeOverdueRental(42_000, 280);

    await request(app)
      .post(`${API}/rentals/booking/${bookingId}/return`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ mileage: 42_100, fuelPercent: 100 });

    expect(await prisma.damage.count({ where: { bookingId } })).toBe(0);
  });
});

/*
 * THE DASHBOARD WENT ON SAYING "3 CARS RENTED" AFTER EVERY RENTAL FINISHED.
 *
 * The status buttons move the booking row and nothing else. Walking one to
 * COMPLETED by hand left the rental running, the return mileage unrecorded,
 * the charges uncalculated and the car stuck on RENTED - so the fleet count
 * drifted, and the car quietly stopped being bookable.
 */
describe('a booking cannot walk past the return', () => {
  /*
   * Its own car. Everything here is about what the FLEET says, and the shared
   * test vehicle is left out on several open rentals by the tests above - so a
   * reading taken from it would be measuring those, not this.
   */
  let ownCar: string;

  beforeAll(async () => {
    const category = await prisma.vehicleCategory.findFirstOrThrow({ where: { isActive: true } });
    const car = await prisma.vehicle.create({
      data: {
        brand: 'Walk',
        model: 'PastCar',
        year: 2024,
        registrationNumber: `WLK-${Date.now().toString().slice(-8)}`,
        categoryId: category.id,
        seats: 5,
        transmission: 'AUTOMATIC',
        fuelType: 'PETROL',
        dailyPrice: '200.00',
        securityDeposit: '1000.00',
        currentMileage: 60_000,
        status: 'AVAILABLE',
      },
    });
    ownCar = car.id;
    extraVehicleIds.push(ownCar);
  });

  it('REFUSES to mark a booking returned while the car is still out', async () => {
    const { bookingId } = await readyBooking(future(300), future(305), ownCar);

    await request(app)
      .post(`${API}/rentals/booking/${bookingId}/pickup`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ mileage: 60_000, fuelPercent: 100, customerVerified: true });

    for (const status of ['RETURN_PENDING', 'RETURNED']) {
      const res = await request(app)
        .patch(`${API}/bookings/${bookingId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status });

      if (status === 'RETURNED') {
        expect(res.status).toBe(409);
        expect(res.body.message).toContain('has not been checked in');
      }
    }

    // Still out, still rented, and the booking has not been quietly finished.
    const vehicle = await prisma.vehicle.findUniqueOrThrow({ where: { id: ownCar } });
    expect(vehicle.status).toBe('RENTED');

    // Cleanup: close it properly, the way staff are now made to.
    await request(app)
      .post(`${API}/rentals/booking/${bookingId}/return`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ mileage: 60_100, fuelPercent: 100 });
  });

  it('puts the car back on the fleet when the booking is finished', async () => {
    const { bookingId } = await readyBooking(future(320), future(325), ownCar);

    await request(app)
      .post(`${API}/rentals/booking/${bookingId}/pickup`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ mileage: 61_000, fuelPercent: 100, customerVerified: true });

    await request(app)
      .post(`${API}/rentals/booking/${bookingId}/return`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ mileage: 61_200, fuelPercent: 100 });

    // Checked in, so finishing the booking by hand is allowed. COMPLETED means
    // the inspection is done, so the car comes back on sale with it - which is
    // what has to leave the fleet count telling the truth.
    const res = await request(app)
      .patch(`${API}/bookings/${bookingId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'COMPLETED' });

    expect(res.status).toBe(200);

    const vehicle = await prisma.vehicle.findUniqueOrThrow({ where: { id: ownCar } });
    expect(vehicle.status).toBe('AVAILABLE');

    const rental = await prisma.rental.findFirstOrThrow({ where: { bookingId } });
    expect(rental.status).toBe('CLOSED');
    expect(rental.returnedAt).not.toBeNull();
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

    await payRental(bookingId);

    for (const status of ['CONFIRMED', 'PAYMENT_PENDING', 'READY_FOR_PICKUP']) {
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

/**
 * Recovering a booking whose handover was never recorded.
 *
 * The status API walks the booking lifecycle without creating a rental, so a
 * booking can end up saying the car is out - or back - with nothing behind it.
 * The counter then has nothing to return, inspect or close, which reads as
 * "the inspection option is disabled".
 *
 * Its own vehicle, because these tests move an odometer a long way and the
 * shared one is used by every test above.
 */
describe('late handover for a booking with no rental', () => {
  let lateVehicleId: string;

  beforeAll(async () => {
    const category = await prisma.vehicleCategory.findFirst({ where: { isActive: true } });
    const vehicle = await prisma.vehicle.create({
      data: {
        brand: 'Late',
        model: 'TestCar',
        year: 2024,
        registrationNumber: `LTE-${Date.now().toString().slice(-8)}`,
        categoryId: category!.id,
        seats: 5,
        transmission: 'AUTOMATIC',
        fuelType: 'PETROL',
        dailyPrice: '200.00',
        securityDeposit: '1000.00',
        currentMileage: 50_000,
      },
    });
    lateVehicleId = vehicle.id;
  });

  afterAll(async () => {
    const ids = (
      await prisma.booking.findMany({ where: { vehicleId: lateVehicleId }, select: { id: true } })
    ).map((b) => b.id);
    if (ids.length > 0) {
      await prisma.damagePhoto.deleteMany({ where: { damage: { bookingId: { in: ids } } } });
      await prisma.damage.deleteMany({ where: { bookingId: { in: ids } } });
      await prisma.vehicleInspection.deleteMany({ where: { rental: { bookingId: { in: ids } } } });
      await prisma.rental.deleteMany({ where: { bookingId: { in: ids } } });
      await prisma.additionalCharge.deleteMany({ where: { bookingId: { in: ids } } });
      // These bookings carry a cleared payment now - handover refuses without
      // one - and a payment row holds the booking down against deletion.
      await prisma.depositTransaction.deleteMany({ where: { deposit: { bookingId: { in: ids } } } });
      await prisma.securityDeposit.deleteMany({ where: { bookingId: { in: ids } } });
      await prisma.refund.deleteMany({ where: { payment: { bookingId: { in: ids } } } });
      await prisma.payment.deleteMany({ where: { bookingId: { in: ids } } });
      await prisma.bookingStatusHistory.deleteMany({ where: { bookingId: { in: ids } } });
      await prisma.booking.deleteMany({ where: { id: { in: ids } } });
    }
    await prisma.vehicle.deleteMany({ where: { id: lateVehicleId } });
  });

  /** Book, then walk it past pickup by hand exactly as the status dropdown does. */
  async function strandedBooking(offset: number, upTo: string[]): Promise<string> {
    const created = await request(app)
      .post(`${API}/bookings`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ vehicleId: lateVehicleId, pickupAt: future(offset), returnAt: future(offset + 5) });

    const bookingId = created.body.data.booking.id as string;

    await payRental(bookingId);

    for (const status of ['CONFIRMED', 'PAYMENT_PENDING', 'READY_FOR_PICKUP', ...upTo]) {
      await request(app)
        .patch(`${API}/bookings/${bookingId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status });
    }

    return bookingId;
  }

  it('accepts the handover late, so the return and its inspection can run', async () => {
    const bookingId = await strandedBooking(200, ['ACTIVE', 'RETURN_PENDING', 'RETURNED']);

    const stuck = await request(app)
      .get(`${API}/rentals/booking/${bookingId}`)
      .set('Authorization', `Bearer ${staffToken}`);
    expect(stuck.body.data.rental).toBeNull();

    const handover = await request(app)
      .post(`${API}/rentals/booking/${bookingId}/pickup`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ mileage: 50_000, fuelPercent: 100, customerVerified: true });

    expect(handover.status).toBe(201);
    expect(handover.body.data.rental.status).toBe('ACTIVE');

    const returned = await request(app)
      .post(`${API}/rentals/booking/${bookingId}/return`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ mileage: 50_200, fuelPercent: 90, needsCleaning: false });

    expect(returned.status).toBe(200);
    expect(returned.body.data.rental.status).toBe('RETURNED');
    expect(
      returned.body.data.rental.inspections.map((i: { type: string }) => i.type).sort(),
    ).toEqual(['PICKUP', 'RETURN']);
  });

  it('REFUSES a late handover once the booking is COMPLETED', async () => {
    const bookingId = await strandedBooking(220, [
      'ACTIVE',
      'RETURN_PENDING',
      'RETURNED',
      'COMPLETED',
    ]);

    const res = await request(app)
      .post(`${API}/rentals/booking/${bookingId}/pickup`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ mileage: 51_000, fuelPercent: 100, customerVerified: true });

    // Terminal. Quietly reopening finished business would be the worse bug.
    expect(res.status).toBe(409);
  });
});
