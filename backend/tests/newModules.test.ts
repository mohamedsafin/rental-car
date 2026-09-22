/**
 * tests/newModules.test.ts
 * ---------------------------------------------------------------------------
 * The modules added in this pass that had no coverage at all: accidents and
 * claims, the vehicle cost ledger, the fleet calendar, the new reports, the
 * booking edit, and erasing a customer.
 *
 * ===========================================================================
 * WHAT IS BEING PROVED
 * ===========================================================================
 * Not that the endpoints respond - that they hold the rules that justify them:
 *
 *   - a claim cannot be marked submitted without a police report number,
 *     because no UAE insurer opens a file without one;
 *   - a repair cost reaches the vehicle's ledger once, not twice, however
 *     many times the figure is corrected;
 *   - a booking edit re-prices and refuses a car that is already taken;
 *   - erasing a customer is refused while their money is still in play, and
 *     leaves the transactions standing when it does go ahead.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { prisma, disconnectPrisma } from '../src/config/prisma';
import { API, cleanupUsers, createUser, loginAndGetToken } from './helpers';

const app = createApp();
const createdEmails: string[] = [];

let staffToken: string;
let adminToken: string;
let customerId: string;
let vehicleId: string;
let secondVehicleId: string;
let seq = 0;

function day(offset: number): Date {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offset);
  date.setUTCHours(10, 0, 0, 0);
  return date;
}

beforeAll(async () => {
  const staff = await createUser({ role: 'STAFF' });
  const admin = await createUser({ role: 'ADMIN' });
  const customer = await createUser({ role: 'CUSTOMER' });
  createdEmails.push(staff.email, admin.email, customer.email);

  staffToken = await loginAndGetToken(app, staff.email);
  adminToken = await loginAndGetToken(app, admin.email);
  customerId = customer.id;

  const category = await prisma.vehicleCategory.findFirstOrThrow({ where: { isActive: true } });
  const stamp = Date.now().toString().slice(-7);

  const vehicle = await prisma.vehicle.create({
    data: {
      brand: 'Ledger',
      model: 'TestCar',
      year: 2024,
      registrationNumber: `LDG-${stamp}`,
      categoryId: category.id,
      seats: 5,
      transmission: 'AUTOMATIC',
      fuelType: 'PETROL',
      dailyPrice: '200.00',
      securityDeposit: '1000.00',
    },
  });
  vehicleId = vehicle.id;

  const second = await prisma.vehicle.create({
    data: {
      brand: 'Ledger',
      model: 'OtherCar',
      year: 2024,
      registrationNumber: `LDG2-${stamp}`,
      categoryId: category.id,
      seats: 5,
      transmission: 'AUTOMATIC',
      fuelType: 'PETROL',
      dailyPrice: '250.00',
      securityDeposit: '1000.00',
    },
  });
  secondVehicleId = second.id;
});

afterAll(async () => {
  const ids = [vehicleId, secondVehicleId];
  const bookings = await prisma.booking.findMany({
    where: { vehicleId: { in: ids } },
    select: { id: true },
  });
  const bookingIds = bookings.map((booking) => booking.id);

  await prisma.accidentReport.deleteMany({ where: { vehicleId: { in: ids } } });
  await prisma.vehicleExpense.deleteMany({ where: { vehicleId: { in: ids } } });
  await prisma.bookingStatusHistory.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.bookingAgreement.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.rentalAgreement.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
  await prisma.maintenanceRecord.deleteMany({ where: { vehicleId: { in: ids } } });
  await prisma.insuranceRecord.deleteMany({ where: { vehicleId: { in: ids } } });
  await prisma.vehicle.deleteMany({ where: { id: { in: ids } } });
  await cleanupUsers(createdEmails);
  await disconnectPrisma();
});

async function makeBooking(vehicle = vehicleId, offset = 1200) {
  seq += 1;
  const booking = await prisma.booking.create({
    data: {
      bookingNumber: `NEW-${Date.now()}-${seq}`,
      vehicleId: vehicle,
      customerId,
      pickupAt: day(offset + seq * 10),
      returnAt: day(offset + seq * 10 + 4),
      status: 'CONFIRMED',
      rentalDays: 4,
      vehicleSubtotal: '800.00',
      taxAmount: '40.00',
      totalAmount: '840.00',
      securityDeposit: '1000.00',
    },
  });
  return booking.id;
}

// ---------------------------------------------------------------------------
describe('Accidents and claims', () => {
  it('records one and refuses to mark it submitted with no police report', async () => {
    const reported = await request(app)
      .post(`${API}/accidents`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        vehicleId,
        occurredAt: day(-2).toISOString(),
        location: 'Al Khail Road',
        description: 'Rear-ended at the exit; both cars driveable.',
      });

    expect(reported.status).toBe(201);
    expect(reported.body.data.accident.reference).toMatch(/^ACC-\d{4}-\d{4}$/);
    expect(reported.body.data.accident.status).toBe('REPORTED');
    // The car stops earning when it is damaged, not when somebody types it in.
    expect(reported.body.data.accident.offRoadFrom).not.toBeNull();

    const id = reported.body.data.accident.id as string;

    const premature = await request(app)
      .patch(`${API}/accidents/${id}`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ status: 'CLAIM_SUBMITTED' });

    expect(premature.status).toBe(400);
    expect(premature.body.message).toMatch(/police report/i);

    const withReport = await request(app)
      .patch(`${API}/accidents/${id}`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ status: 'CLAIM_SUBMITTED', policeReportNumber: 'DXB-2026-5512' });

    expect(withReport.status).toBe(200);
    // Marking it submitted stamps the date, so "how long has the insurer had
    // this?" stays answerable.
    expect(withReport.body.data.accident.claimSubmittedAt).not.toBeNull();
  });

  it('posts the repair cost to the vehicle ledger once, however often it is corrected', async () => {
    const reported = await request(app)
      .post(`${API}/accidents`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        vehicleId,
        occurredAt: day(-3).toISOString(),
        description: 'Kerbed a wheel.',
      });
    const id = reported.body.data.accident.id as string;

    await request(app)
      .patch(`${API}/accidents/${id}`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ repairCost: '1200.00', garageName: 'Al Quoz Body Shop' });

    await request(app)
      .patch(`${API}/accidents/${id}`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ repairCost: '1450.00' });

    const rows = await prisma.vehicleExpense.findMany({
      where: { sourceType: 'AccidentReport', sourceId: id },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.amount.toFixed(2)).toBe('1450.00');
    expect(rows[0]?.type).toBe('ACCIDENT');
  });

  it('refuses an accident on a booking for a different car', async () => {
    const bookingId = await makeBooking(secondVehicleId);

    const res = await request(app)
      .post(`${API}/accidents`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        vehicleId,
        bookingId,
        occurredAt: day(-1).toISOString(),
        description: 'Wrong car on the paperwork.',
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/different vehicle/i);
  });
});

// ---------------------------------------------------------------------------
describe('The vehicle cost ledger', () => {
  it('takes a manual cost and shows it in the list', async () => {
    const res = await request(app)
      .post(`${API}/fleet/expenses`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        vehicleId,
        type: 'REGISTRATION',
        amount: '420.00',
        incurredAt: day(-10).toISOString(),
        description: 'Mulkiya renewal',
      });

    expect(res.status).toBe(201);

    const list = await request(app)
      .get(`${API}/fleet/expenses`)
      .query({ vehicleId })
      .set('Authorization', `Bearer ${staffToken}`);

    expect(list.status).toBe(200);
    expect(list.body.data.items.some((row: { amount: string }) => row.amount === '420.00')).toBe(true);
  });

  it('will not let a posted cost be deleted from the ledger', async () => {
    const reported = await request(app)
      .post(`${API}/accidents`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ vehicleId, occurredAt: day(-4).toISOString(), description: 'Scraped a pillar.' });

    await request(app)
      .patch(`${API}/accidents/${reported.body.data.accident.id}`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ repairCost: '300.00' });

    const posted = await prisma.vehicleExpense.findFirstOrThrow({
      where: { sourceType: 'AccidentReport', sourceId: reported.body.data.accident.id },
    });

    const res = await request(app)
      .delete(`${API}/fleet/expenses/${posted.id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/correct it there/i);
  });

  it('is counted against the vehicle in the profitability report', async () => {
    const from = day(-30).toISOString();
    const to = day(1).toISOString();

    const res = await request(app)
      .get(`${API}/reports/vehicles`)
      .query({ from, to })
      .set('Authorization', `Bearer ${staffToken}`);

    expect(res.status).toBe(200);

    const row = res.body.data.vehicles.find(
      (candidate: { vehicleId: string }) => candidate.vehicleId === vehicleId,
    );
    expect(row).toBeDefined();
    expect(Number(row.costs)).toBeGreaterThan(0);
    // Net is revenue minus costs, so a car that earned nothing and cost
    // something is negative - and the report must say so rather than clamp it.
    expect(Number(row.net)).toBe(Number(row.revenue) - Number(row.costs));
  });
});

// ---------------------------------------------------------------------------
describe('Reports added in this pass', () => {
  it('returns one entry per day, including the empty ones', async () => {
    const from = day(-6);
    const to = day(0);

    const res = await request(app)
      .get(`${API}/reports/revenue-series`)
      .query({ from: from.toISOString(), to: to.toISOString() })
      .set('Authorization', `Bearer ${staffToken}`);

    expect(res.status).toBe(200);
    // Six whole days between them, and a gap must not be skipped - a chart
    // that closes the gaps makes a dead week look busy.
    expect(res.body.data.days).toHaveLength(6);
    expect(res.body.data.days.every((entry: { amount: string }) => entry.amount !== undefined)).toBe(
      true,
    );
  });

  it('gives the dashboard separate figures for fines and tolls, and today', async () => {
    const res = await request(app)
      .get(`${API}/reports/dashboard`)
      .set('Authorization', `Bearer ${staffToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.charges.fines).toHaveProperty('amount');
    expect(res.body.data.charges.tolls).toHaveProperty('amount');
    expect(res.body.data.today).toHaveProperty('revenue');
    expect(res.body.data.fleet).toHaveProperty('damaged');
  });
});

// ---------------------------------------------------------------------------
describe('The fleet calendar', () => {
  it('lists every car with its commitments', async () => {
    const bookingId = await makeBooking(vehicleId, 1400);
    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });

    const res = await request(app)
      .get(`${API}/availability/calendar`)
      .query({
        from: new Date(booking.pickupAt.getTime() - 86_400_000).toISOString(),
        to: new Date(booking.returnAt.getTime() + 86_400_000).toISOString(),
      })
      .set('Authorization', `Bearer ${staffToken}`);

    expect(res.status).toBe(200);

    const row = res.body.data.vehicles.find(
      (candidate: { id: string }) => candidate.id === vehicleId,
    );
    expect(row.blocks.some((block: { id: string }) => block.id === bookingId)).toBe(true);
  });

  it('refuses a window longer than a quarter', async () => {
    const res = await request(app)
      .get(`${API}/availability/calendar`)
      .query({ from: day(0).toISOString(), to: day(200).toISOString() })
      .set('Authorization', `Bearer ${staffToken}`);

    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
describe('Editing a booking', () => {
  it('moves the dates and re-prices from the engine', async () => {
    const bookingId = await makeBooking(vehicleId, 1600);
    const before = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });

    const res = await request(app)
      .patch(`${API}/bookings/${bookingId}`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        // Two days longer, so the total has to change.
        returnAt: new Date(before.returnAt.getTime() + 2 * 86_400_000).toISOString(),
        reason: 'Customer asked for two more days',
      });

    expect(res.status).toBe(200);

    const after = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(after.rentalDays).toBeGreaterThan(before.rentalDays);
    expect(after.totalAmount.toFixed(2)).not.toBe(before.totalAmount.toFixed(2));

    // The change is on the booking's own timeline, where a customer asking
    // "why did my price change?" can be answered.
    const history = await prisma.bookingStatusHistory.findFirst({
      where: { bookingId, reason: { contains: 'two more days' } },
    });
    expect(history).not.toBeNull();
  });

  it('refuses a car that is already booked over those dates', async () => {
    const taken = await makeBooking(secondVehicleId, 1800);
    const takenBooking = await prisma.booking.findUniqueOrThrow({ where: { id: taken } });

    const mover = await prisma.booking.create({
      data: {
        bookingNumber: `NEW-CLASH-${Date.now()}`,
        vehicleId,
        customerId,
        pickupAt: takenBooking.pickupAt,
        returnAt: takenBooking.returnAt,
        status: 'CONFIRMED',
        rentalDays: 4,
        vehicleSubtotal: '800.00',
        totalAmount: '800.00',
        securityDeposit: '1000.00',
      },
    });

    const res = await request(app)
      .patch(`${API}/bookings/${mover.id}`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ vehicleId: secondVehicleId });

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/already booked/i);
  });

  it('refuses once the car has gone out', async () => {
    const bookingId = await makeBooking(vehicleId, 2000);
    await prisma.booking.update({ where: { id: bookingId }, data: { status: 'ACTIVE' } });

    const res = await request(app)
      .patch(`${API}/bookings/${bookingId}`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ returnAt: day(2100).toISOString() });

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/already gone out/i);

    await prisma.booking.update({ where: { id: bookingId }, data: { status: 'CONFIRMED' } });
  });
});

// ---------------------------------------------------------------------------
describe('Erasing a customer', () => {
  it('refuses while a deposit is still held, and says why', async () => {
    const erasable = await createUser({ role: 'CUSTOMER' });
    createdEmails.push(erasable.email);

    const booking = await prisma.booking.create({
      data: {
        bookingNumber: `ERASE-${Date.now()}`,
        vehicleId,
        customerId: erasable.id,
        pickupAt: day(2200),
        returnAt: day(2204),
        status: 'COMPLETED',
        rentalDays: 4,
        vehicleSubtotal: '800.00',
        totalAmount: '800.00',
        securityDeposit: '1000.00',
      },
    });

    const deposit = await prisma.securityDeposit.create({
      data: { bookingId: booking.id, amount: '1000.00', status: 'HELD', heldAt: new Date() },
    });

    const profile = await prisma.customer.findUniqueOrThrow({ where: { userId: erasable.id } });

    const refused = await request(app)
      .post(`${API}/customers/${profile.id}/erase`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(refused.status).toBe(409);
    expect(refused.body.message).toMatch(/deposit/i);

    // Settle it, and the same request goes through.
    await prisma.securityDeposit.update({
      where: { id: deposit.id },
      data: { status: 'RELEASED', settledAt: new Date() },
    });

    const erased = await request(app)
      .post(`${API}/customers/${profile.id}/erase`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(erased.status).toBe(200);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: erasable.id } });
    expect(user.fullName).toBe('Erased customer');
    expect(user.email).toMatch(/@erased\.invalid$/);
    expect(user.phone).toBeNull();

    // The transaction survives, because tax law says it must.
    const kept = await prisma.booking.findUnique({ where: { id: booking.id } });
    expect(kept).not.toBeNull();
    expect(kept?.totalAmount.toFixed(2)).toBe('800.00');

    await prisma.depositTransaction.deleteMany({ where: { depositId: deposit.id } });
    await prisma.securityDeposit.delete({ where: { id: deposit.id } });
    await prisma.booking.delete({ where: { id: booking.id } });
  });

  it('is admin-only', async () => {
    const profile = await prisma.customer.findFirstOrThrow({ where: { userId: customerId } });

    const res = await request(app)
      .post(`${API}/customers/${profile.id}/erase`)
      .set('Authorization', `Bearer ${staffToken}`);

    expect(res.status).toBe(403);
  });
});
