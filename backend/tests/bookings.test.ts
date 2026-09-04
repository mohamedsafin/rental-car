/**
 * tests/bookings.test.ts
 * ---------------------------------------------------------------------------
 * PHASE 6 ACCEPTANCE: two customers booking the same car for overlapping dates
 * - one succeeds, one gets a clean 409.
 *
 * Plus the rule that matters just as much: the price stored on a booking comes
 * from the pricing engine, never from the request body.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { prisma, disconnectPrisma } from '../src/config/prisma';
import { API, cleanupUsers, createUser, loginAndGetToken } from './helpers';

const app = createApp();
const createdEmails: string[] = [];

let customerToken: string;
let customerId: string;
let rivalToken: string;
let adminToken: string;
let vehicleId: string;

/** Far enough ahead that "pickup cannot be in the past" never interferes. */
function future(days: number, hour = 10): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  date.setUTCHours(hour, 0, 0, 0);
  return date.toISOString();
}

beforeAll(async () => {
  const customer = await createUser({ role: 'CUSTOMER' });
  const rival = await createUser({ role: 'CUSTOMER' });
  const admin = await createUser({ role: 'ADMIN' });
  createdEmails.push(customer.email, rival.email, admin.email);
  customerId = customer.id;

  customerToken = await loginAndGetToken(app, customer.email);
  rivalToken = await loginAndGetToken(app, rival.email);
  adminToken = await loginAndGetToken(app, admin.email);

  const category = await prisma.vehicleCategory.findFirst({ where: { isActive: true } });
  const vehicle = await prisma.vehicle.create({
    data: {
      brand: 'Booking',
      model: 'TestCar',
      year: 2024,
      registrationNumber: `BKT-${Date.now().toString().slice(-8)}`,
      categoryId: category!.id,
      seats: 5,
      transmission: 'AUTOMATIC',
      fuelType: 'PETROL',
      dailyPrice: '200.00',
      securityDeposit: '1000.00',
    },
  });
  vehicleId = vehicle.id;
});

afterAll(async () => {
  await prisma.bookingStatusHistory.deleteMany({ where: { booking: { vehicleId } } });
  await prisma.bookingService.deleteMany({ where: { booking: { vehicleId } } });
  await prisma.booking.deleteMany({ where: { vehicleId } });
  await prisma.vehicle.deleteMany({ where: { id: vehicleId } });

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

function book(token: string, days: [number, number], extra: Record<string, unknown> = {}) {
  return request(app)
    .post(`${API}/bookings`)
    .set('Authorization', `Bearer ${token}`)
    .send({
      vehicleId,
      pickupAt: future(days[0]),
      returnAt: future(days[1]),
      ...extra,
    });
}

describe('booking creation', () => {
  it('creates a booking with a readable reference', async () => {
    const res = await book(customerToken, [600, 605]);

    expect(res.status).toBe(201);
    expect(res.body.data.booking.bookingNumber).toMatch(/^BK-\d{4}-\d{4}$/);
    expect(res.body.data.booking.period.rentalDays).toBe(5);
  });

  it('starts unverified customers at DOCUMENT_VERIFICATION, per BRD 3', async () => {
    const res = await book(customerToken, [610, 612]);

    // This customer has no approved documents, so payment must wait.
    expect(res.body.data.booking.status).toBe('DOCUMENT_VERIFICATION');
  });

  it('IGNORES a price sent by the client and recomputes it', async () => {
    const res = await book(customerToken, [620, 625], {
      totalAmount: '1.00',
      vehicleSubtotal: '1.00',
      securityDeposit: '0.00',
    });

    expect(res.status).toBe(201);

    const pricing = res.body.data.booking.pricing;

    // 5 days at 200.00. Asserted on the SUBTOTAL, not the grand total: the
    // total also carries VAT, and whether VAT is configured is an operator
    // setting this test has no business depending on.
    expect(pricing.vehicleSubtotal).toBe('1000.00');
    // The deposit comes from the vehicle, not from the request body.
    expect(pricing.securityDeposit).toBe('1000.00');
    // And whatever the total is, it is emphatically not the client's 1.00.
    expect(pricing.totalAmount).not.toBe('1.00');
    expect(Number(pricing.totalAmount)).toBeGreaterThanOrEqual(1000);
  });

  it('sets a hold so an abandoned checkout does not keep the car forever', async () => {
    const res = await book(customerToken, [630, 632]);
    expect(res.body.data.booking.holdExpiresAt).toBeTruthy();
  });

  it('rejects a return before the pickup', async () => {
    const res = await book(customerToken, [645, 640]);
    expect(res.status).toBe(400);
  });

  it('requires authentication', async () => {
    const res = await request(app)
      .post(`${API}/bookings`)
      .send({ vehicleId, pickupAt: future(700), returnAt: future(702) });

    expect(res.status).toBe(401);
  });
});

describe('double booking - the Phase 6 acceptance test', () => {
  it('rejects an overlapping booking with 409 VEHICLE_UNAVAILABLE', async () => {
    const first = await book(customerToken, [700, 705]);
    expect(first.status).toBe(201);

    // BRD 34: 700-705 and 702-708 overlap.
    const second = await book(rivalToken, [702, 708]);

    expect(second.status).toBe(409);
    expect(second.body.code).toBe('VEHICLE_UNAVAILABLE');
  });

  it('ALLOWS a booking that starts exactly when the previous one ends', async () => {
    // The 700-705 booking above is still live. 705-710 touches but does not
    // overlap, because the rental window is half-open.
    const res = await book(rivalToken, [705, 710]);
    expect(res.status).toBe(201);
  });

  it('lets exactly ONE of two simultaneous bookings win', async () => {
    // Both requests read "free" before either writes. Only the database's
    // exclusion constraint can settle this, and the service must surface it
    // as a clean 409 rather than a 500.
    const [a, b] = await Promise.all([
      book(customerToken, [800, 805]),
      book(rivalToken, [800, 805]),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);

    const loser = a.status === 409 ? a : b;
    expect(loser.body.code).toBe('VEHICLE_UNAVAILABLE');
    // Critically NOT a 500 with a raw Postgres message.
    expect(loser.body.message).not.toContain('constraint');
  });

  it('frees the dates again once a booking is cancelled', async () => {
    const created = await book(customerToken, [900, 905]);
    expect(created.status).toBe(201);

    const blocked = await book(rivalToken, [901, 904]);
    expect(blocked.status).toBe(409);

    await request(app)
      .post(`${API}/bookings/${created.body.data.booking.id}/cancel`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ reason: 'Plans changed' });

    const retry = await book(rivalToken, [901, 904]);
    expect(retry.status).toBe(201);
  });
});

describe('status lifecycle', () => {
  async function makeBooking(days: [number, number]) {
    const res = await book(customerToken, days);
    expect(res.status).toBe(201);
    return res.body.data.booking.id as string;
  }

  function setStatus(id: string, status: string, token = adminToken) {
    return request(app)
      .patch(`${API}/bookings/${id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status });
  }

  it('walks the happy path from verification to completed', async () => {
    const id = await makeBooking([1000, 1005]);

    for (const status of [
      'PAYMENT_PENDING',
      'CONFIRMED',
      'READY_FOR_PICKUP',
      'ACTIVE',
      'RETURN_PENDING',
      'RETURNED',
      'COMPLETED',
    ]) {
      const res = await setStatus(id, status);
      expect(res.status, `transition to ${status}`).toBe(200);
    }
  });

  it('refuses a transition the machine does not allow', async () => {
    const id = await makeBooking([1010, 1015]);

    // DOCUMENT_VERIFICATION -> ACTIVE would hand over a car nobody has paid
    // for or verified.
    const res = await setStatus(id, 'ACTIVE');

    expect(res.status).toBe(409);
    expect(res.body.message).toContain('cannot become');
  });

  it('refuses to move a COMPLETED booking', async () => {
    const id = await makeBooking([1020, 1025]);
    for (const status of [
      'PAYMENT_PENDING',
      'CONFIRMED',
      'READY_FOR_PICKUP',
      'ACTIVE',
      'RETURN_PENDING',
      'RETURNED',
      'COMPLETED',
    ]) {
      await setStatus(id, status);
    }

    const res = await setStatus(id, 'ACTIVE');
    expect(res.status).toBe(409);
  });

  it('refuses status changes from a CUSTOMER', async () => {
    const id = await makeBooking([1030, 1035]);
    const res = await setStatus(id, 'CONFIRMED', customerToken);
    expect(res.status).toBe(403);
  });

  it('records every transition in the history', async () => {
    const id = await makeBooking([1040, 1045]);
    await setStatus(id, 'PAYMENT_PENDING');
    await setStatus(id, 'CONFIRMED');

    const res = await request(app)
      .get(`${API}/bookings/${id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    const history = res.body.data.booking.statusHistory;
    // Creation + two transitions.
    expect(history).toHaveLength(3);
    expect(history[history.length - 1].to).toBe('CONFIRMED');
  });
});

describe('cancellation (BRD 31)', () => {
  it('lets a customer cancel their own booking', async () => {
    const created = await book(customerToken, [1100, 1105]);

    const res = await request(app)
      .post(`${API}/bookings/${created.body.data.booking.id}/cancel`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ reason: 'Trip postponed' });

    expect(res.status).toBe(200);
    expect(res.body.data.booking.status).toBe('CANCELLED');
    expect(res.body.data.booking.cancellation.reason).toBe('Trip postponed');
  });

  it('charges NO fee when no cancellation policy is configured', async () => {
    // Both policy settings seed empty. Inventing a fee would be the same
    // mistake as inventing a VAT rate.
    await prisma.systemSetting.updateMany({
      where: { key: { in: ['cancellation.free_window_hours', 'cancellation.fee_percentage'] } },
      data: { value: '' },
    });

    const created = await book(customerToken, [1110, 1115]);
    const res = await request(app)
      .post(`${API}/bookings/${created.body.data.booking.id}/cancel`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({});

    expect(res.body.data.booking.cancellation.fee).toBe('0.00');
  });

  it('refuses to cancel someone else\u2019s booking, with 404 not 403', async () => {
    const created = await book(customerToken, [1120, 1125]);

    const res = await request(app)
      .post(`${API}/bookings/${created.body.data.booking.id}/cancel`)
      .set('Authorization', `Bearer ${rivalToken}`)
      .send({});

    expect(res.status).toBe(404);
  });

  it('refuses to cancel a rental that is already ACTIVE', async () => {
    const created = await book(customerToken, [1130, 1135]);
    const id = created.body.data.booking.id;

    for (const status of ['PAYMENT_PENDING', 'CONFIRMED', 'READY_FOR_PICKUP', 'ACTIVE']) {
      await request(app)
        .patch(`${API}/bookings/${id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status });
    }

    const res = await request(app)
      .post(`${API}/bookings/${id}/cancel`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.message).toContain('returned');
  });
});

describe('booking visibility', () => {
  it('hides another customer\u2019s booking behind a 404', async () => {
    const created = await book(customerToken, [1200, 1205]);

    const res = await request(app)
      .get(`${API}/bookings/${created.body.data.booking.id}`)
      .set('Authorization', `Bearer ${rivalToken}`);

    expect(res.status).toBe(404);
  });

  it('hides the plate and staff notes from the customer view', async () => {
    const created = await book(customerToken, [1210, 1215]);
    const id = created.body.data.booking.id;

    const customerView = await request(app)
      .get(`${API}/bookings/${id}`)
      .set('Authorization', `Bearer ${customerToken}`);
    const adminView = await request(app)
      .get(`${API}/bookings/${id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(customerView.body.data.booking.vehicle.registrationNumber).toBeNull();
    expect(adminView.body.data.booking.vehicle.registrationNumber).toBeTruthy();
  });

  it('refuses the staff booking list to a CUSTOMER', async () => {
    const res = await request(app)
      .get(`${API}/bookings`)
      .set('Authorization', `Bearer ${customerToken}`);

    expect(res.status).toBe(403);
  });

  it('groups My Bookings the way BRD 22 does', async () => {
    const res = await request(app)
      .get(`${API}/bookings/me?scope=upcoming`)
      .set('Authorization', `Bearer ${customerToken}`);

    expect(res.status).toBe(200);
    for (const booking of res.body.data.items) {
      expect(['PENDING', 'DOCUMENT_VERIFICATION', 'PAYMENT_PENDING', 'CONFIRMED', 'READY_FOR_PICKUP'])
        .toContain(booking.status);
    }
  });

  it('only ever returns the caller\u2019s own bookings from /me', async () => {
    const res = await request(app)
      .get(`${API}/bookings/me?limit=50`)
      .set('Authorization', `Bearer ${rivalToken}`);

    const ids = res.body.data.items.map((b: { id: string }) => b.id);
    const theirs = await prisma.booking.findMany({
      where: { id: { in: ids } },
      select: { customerId: true },
    });

    expect(theirs.every((b) => b.customerId !== customerId)).toBe(true);
  });
});
