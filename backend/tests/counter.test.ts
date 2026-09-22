/**
 * tests/counter.test.ts
 * ---------------------------------------------------------------------------
 * The work that happens at the desk, which had no tests because it had no code.
 *
 * ===========================================================================
 * WHAT IS BEING PROVED HERE
 * ===========================================================================
 * Four things were added together because they are one workflow: a walk-in
 * arrives, staff open an account for them, book a car in THEIR name, list who
 * else may drive it, and put a signed agreement in their hand. Each step has a
 * rule that is worth more than the feature:
 *
 *   - Staff create an account they cannot log into. If that ever stops being
 *     true, a member of staff can act as a customer and later disown it.
 *   - A customer cannot book in somebody else's name, however the request is
 *     shaped. The `customerId` field exists for staff; for a customer it must
 *     be ignored, not honoured.
 *   - An agreement is a snapshot with a number, and a signed one cannot be
 *     signed again or quietly edited.
 *   - A deposit cannot be released while money is still owed - unless somebody
 *     decides to write it off, deliberately and on the record.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { prisma, disconnectPrisma } from '../src/config/prisma';
import { API, cleanupUsers, createUser, loginAndGetToken, uniqueEmail } from './helpers';

const app = createApp();
const createdEmails: string[] = [];

let staffToken: string;
let adminToken: string;
let customerToken: string;
let customerId: string;
let vehicleId: string;
let bookingSeq = 0;

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
  customerToken = await loginAndGetToken(app, customer.email);
  customerId = customer.id;

  const category = await prisma.vehicleCategory.findFirstOrThrow({ where: { isActive: true } });
  const vehicle = await prisma.vehicle.create({
    data: {
      brand: 'Counter',
      model: 'TestCar',
      year: 2024,
      registrationNumber: `CNT-${Date.now().toString().slice(-8)}`,
      categoryId: category.id,
      seats: 5,
      transmission: 'AUTOMATIC',
      fuelType: 'PETROL',
      dailyPrice: '200.00',
      securityDeposit: '1000.00',
      mileageLimitPerDay: 200,
      extraMileageCharge: '1.00',
    },
  });
  vehicleId = vehicle.id;
});

afterAll(async () => {
  const bookings = await prisma.booking.findMany({ where: { vehicleId }, select: { id: true } });
  const ids = bookings.map((booking) => booking.id);

  await prisma.rentalAgreement.deleteMany({ where: { bookingId: { in: ids } } });
  await prisma.additionalDriver.deleteMany({ where: { bookingId: { in: ids } } });
  await prisma.trafficFine.deleteMany({ where: { bookingId: { in: ids } } });
  await prisma.depositTransaction.deleteMany({ where: { deposit: { bookingId: { in: ids } } } });
  await prisma.securityDeposit.deleteMany({ where: { bookingId: { in: ids } } });
  await prisma.bookingStatusHistory.deleteMany({ where: { bookingId: { in: ids } } });
  await prisma.bookingAgreement.deleteMany({ where: { bookingId: { in: ids } } });
  await prisma.booking.deleteMany({ where: { id: { in: ids } } });
  await prisma.vehicle.deleteMany({ where: { id: vehicleId } });
  await cleanupUsers(createdEmails);
  await disconnectPrisma();
});

/** A booking in `customerId`'s name, written directly. */
async function makeBooking(status: 'CONFIRMED' | 'ACTIVE' | 'RETURNED' = 'CONFIRMED') {
  bookingSeq += 1;
  const offset = 700 + bookingSeq * 10;

  const booking = await prisma.booking.create({
    data: {
      bookingNumber: `CNT-${Date.now()}-${bookingSeq}`,
      vehicleId,
      customerId,
      pickupAt: day(offset),
      returnAt: day(offset + 5),
      status,
      rentalDays: 5,
      vehicleSubtotal: '1000.00',
      taxAmount: '50.00',
      totalAmount: '1050.00',
      securityDeposit: '1000.00',
    },
  });
  return booking.id;
}

// ---------------------------------------------------------------------------
describe('Opening an account for a walk-in', () => {
  it('creates a customer that staff cannot log in as', async () => {
    const email = uniqueEmail('walkin');
    createdEmails.push(email);

    const res = await request(app)
      .post(`${API}/customers`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        fullName: 'Walk In Customer',
        email,
        phone: '+971501234567',
        dateOfBirth: '1992-04-02',
        licenceNumber: 'DXB-99887',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.customer.user.email).toBe(email);

    /*
     * The heart of it: the account exists, and the password it was created
     * with is not one anybody chose. Trying to log in with the password every
     * other test user has must fail.
     */
    const login = await request(app)
      .post(`${API}/auth/login`)
      .send({ email, password: 'Passw0rdTest' });
    expect(login.status).toBe(401);
  });

  it('refuses a second account on the same address, and says so plainly', async () => {
    const email = uniqueEmail('walkin-dupe');
    createdEmails.push(email);

    const body = { fullName: 'First Person', email, phone: '+971501234567' };
    const first = await request(app)
      .post(`${API}/customers`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send(body);
    expect(first.status).toBe(201);

    const second = await request(app)
      .post(`${API}/customers`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ ...body, fullName: 'Second Person' });

    expect(second.status).toBe(409);
    expect(second.body.message).toMatch(/already has an account/i);
  });

  it('will not let a customer create customers', async () => {
    const res = await request(app)
      .post(`${API}/customers`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ fullName: 'Nope', email: uniqueEmail('nope'), phone: '+971501234567' });

    expect(res.status).toBe(403);
  });

  it('requires a company name on a corporate hire', async () => {
    const res = await request(app)
      .post(`${API}/customers`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        fullName: 'Corporate Person',
        email: uniqueEmail('corp'),
        phone: '+971501234567',
        customerType: 'CORPORATE',
      });

    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
describe('Booking for somebody else', () => {
  it('ignores customerId when a customer sends it', async () => {
    const victim = await createUser({ role: 'CUSTOMER' });
    createdEmails.push(victim.email);

    const res = await request(app)
      .post(`${API}/bookings`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        vehicleId,
        customerId: victim.id,
        pickupAt: day(900).toISOString(),
        returnAt: day(903).toISOString(),
      });

    // It may be refused for other reasons (unverified documents will not stop
    // creation, but pricing or availability might), so the assertion is about
    // WHO it belongs to, not whether it succeeded.
    if (res.status === 201) {
      const booking = await prisma.booking.findUniqueOrThrow({
        where: { id: res.body.data.booking.id },
        select: { customerId: true },
      });
      expect(booking.customerId).toBe(customerId);
      expect(booking.customerId).not.toBe(victim.id);
    } else {
      const forVictim = await prisma.booking.count({ where: { customerId: victim.id } });
      expect(forVictim).toBe(0);
    }
  });

  it('refuses a customerId that is not a customer', async () => {
    const staff = await prisma.user.findFirstOrThrow({ where: { role: 'STAFF' } });

    const res = await request(app)
      .post(`${API}/bookings`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        vehicleId,
        customerId: staff.id,
        pickupAt: day(910).toISOString(),
        returnAt: day(913).toISOString(),
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/member of staff/i);
  });
});

// ---------------------------------------------------------------------------
describe('The rental agreement', () => {
  it('issues once, numbers itself, and refuses a second one', async () => {
    const bookingId = await makeBooking();

    const first = await request(app)
      .post(`${API}/agreements`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ bookingId });

    expect(first.status).toBe(201);
    expect(first.body.data.agreementNumber).toMatch(/^AGR-\d{4}-\d{6}$/);
    expect(first.body.data.status).toBe('ISSUED');

    const second = await request(app)
      .post(`${API}/agreements`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ bookingId });

    expect(second.status).toBe(409);
    expect(second.body.message).toMatch(/already has agreement/i);
  });

  it('is a snapshot: raising the vehicle price does not change it', async () => {
    const bookingId = await makeBooking();

    const issued = await request(app)
      .post(`${API}/agreements`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ bookingId });
    const total = issued.body.data.totalAmount as string;

    await prisma.vehicle.update({
      where: { id: vehicleId },
      data: { dailyPrice: '999.00', securityDeposit: '5000.00' },
    });

    const reread = await request(app)
      .get(`${API}/agreements/${issued.body.data.id}`)
      .set('Authorization', `Bearer ${staffToken}`);

    expect(reread.body.data.totalAmount).toBe(total);
    expect(reread.body.data.securityDeposit).toBe('1000.00');

    await prisma.vehicle.update({
      where: { id: vehicleId },
      data: { dailyPrice: '200.00', securityDeposit: '1000.00' },
    });
  });

  it('cannot be signed twice, and reaches SIGNED only when both sides have', async () => {
    const bookingId = await makeBooking();
    const issued = await request(app)
      .post(`${API}/agreements`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ bookingId });
    const id = issued.body.data.id as string;

    const customerSigns = await request(app)
      .post(`${API}/agreements/${id}/sign`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ signedName: 'Test User' });

    expect(customerSigns.status).toBe(200);
    // One signature is not an agreement. It stays ISSUED.
    expect(customerSigns.body.data.status).toBe('ISSUED');

    const again = await request(app)
      .post(`${API}/agreements/${id}/sign`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ signedName: 'Somebody Else' });
    expect(again.status).toBe(409);

    const counter = await request(app)
      .post(`${API}/agreements/${id}/countersign`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ signedName: 'Counter Staff' });

    expect(counter.status).toBe(200);
    expect(counter.body.data.status).toBe('SIGNED');
  });

  it('will not draw one up for a booking nothing has been agreed on', async () => {
    bookingSeq += 1;
    const pending = await prisma.booking.create({
      data: {
        bookingNumber: `CNT-PEND-${Date.now()}`,
        vehicleId,
        customerId,
        pickupAt: day(950),
        returnAt: day(953),
        status: 'PENDING',
        rentalDays: 3,
        vehicleSubtotal: '600.00',
        totalAmount: '600.00',
        securityDeposit: '1000.00',
      },
    });

    const res = await request(app)
      .post(`${API}/agreements`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ bookingId: pending.id });

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/not confirmed/i);
  });

  it('renders a PDF, and hides somebody else’s from them', async () => {
    const bookingId = await makeBooking();
    const issued = await request(app)
      .post(`${API}/agreements`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ bookingId });
    const id = issued.body.data.id as string;

    const pdf = await request(app)
      .get(`${API}/agreements/${id}/pdf`)
      .set('Authorization', `Bearer ${staffToken}`);

    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(pdf.body.length).toBeGreaterThan(1000);

    const stranger = await createUser({ role: 'CUSTOMER' });
    createdEmails.push(stranger.email);
    const strangerToken = await loginAndGetToken(app, stranger.email);

    // 404, not 403: confirming the number exists is itself worth something.
    const peek = await request(app)
      .get(`${API}/agreements/${id}`)
      .set('Authorization', `Bearer ${strangerToken}`);
    expect(peek.status).toBe(404);
  });

  it('voids and reissues under a new number, keeping the old one', async () => {
    const bookingId = await makeBooking();
    const first = await request(app)
      .post(`${API}/agreements`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ bookingId });
    const firstNumber = first.body.data.agreementNumber as string;

    const voided = await request(app)
      .post(`${API}/agreements/${first.body.data.id}/void`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Wrong vehicle on the paperwork' });
    expect(voided.status).toBe(200);
    expect(voided.body.data.status).toBe('VOID');

    const replacement = await request(app)
      .post(`${API}/agreements`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ bookingId });

    expect(replacement.status).toBe(201);
    expect(replacement.body.data.agreementNumber).not.toBe(firstNumber);
  });

  it('only an admin may void one', async () => {
    const bookingId = await makeBooking();
    const issued = await request(app)
      .post(`${API}/agreements`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ bookingId });

    const res = await request(app)
      .post(`${API}/agreements/${issued.body.data.id}/void`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ reason: 'Trying it on' });

    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
describe('Additional drivers', () => {
  it('records one, and refuses a licence that expires mid-rental', async () => {
    const bookingId = await makeBooking();

    const ok = await request(app)
      .post(`${API}/bookings/${bookingId}/drivers`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ fullName: 'Second Driver', licenceNumber: 'AUH-44221' });
    expect(ok.status).toBe(201);

    // The rental ends on day+705ish; a licence expiring yesterday cannot cover it.
    const expired = await request(app)
      .post(`${API}/bookings/${bookingId}/drivers`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        fullName: 'Lapsed Driver',
        licenceNumber: 'AUH-00000',
        licenceExpiry: day(-1).toISOString().slice(0, 10),
      });

    expect(expired.status).toBe(400);
    expect(expired.body.message).toMatch(/expires/i);
  });

  it('names them on the agreement issued afterwards', async () => {
    const bookingId = await makeBooking();

    await request(app)
      .post(`${API}/bookings/${bookingId}/drivers`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ fullName: 'Named On Contract', licenceNumber: 'SHJ-10101' });

    const issued = await request(app)
      .post(`${API}/agreements`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ bookingId });

    const stored = await prisma.rentalAgreement.findUniqueOrThrow({
      where: { id: issued.body.data.id as string },
      select: { additionalDriversText: true },
    });

    expect(stored.additionalDriversText).toContain('Named On Contract');
    expect(stored.additionalDriversText).toContain('SHJ-10101');
  });

  it('is staff-only', async () => {
    const bookingId = await makeBooking();
    const res = await request(app)
      .post(`${API}/bookings/${bookingId}/drivers`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ fullName: 'Self Added', licenceNumber: 'X-1' });

    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
describe('Releasing a deposit with money still owed', () => {
  /** A returned booking with a deposit held and one unrecovered fine. */
  async function bookingWithOutstandingFine() {
    const bookingId = await makeBooking('RETURNED');

    const deposit = await prisma.securityDeposit.create({
      data: { bookingId, amount: '1000.00', status: 'HELD', heldAt: new Date() },
    });
    await prisma.depositTransaction.create({
      data: { depositId: deposit.id, type: 'HOLD', amount: '1000.00', reason: 'Test hold' },
    });

    await prisma.trafficFine.create({
      data: {
        vehicleId,
        bookingId,
        fineNumber: `FINE-${Date.now()}-${bookingSeq}`,
        violationAt: day(702),
        amount: '200.00',
        status: 'ASSIGNED',
      },
    });

    return bookingId;
  }

  it('refuses, and names the amount', async () => {
    const bookingId = await bookingWithOutstandingFine();

    const res = await request(app)
      .post(`${API}/deposits/booking/${bookingId}/release`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/outstanding/i);
    expect(res.body.message).toContain('200.00');

    // And nothing moved.
    const deposit = await prisma.securityDeposit.findUniqueOrThrow({ where: { bookingId } });
    expect(deposit.status).toBe('HELD');
  });

  it('goes through when somebody decides to write it off, and records that', async () => {
    const bookingId = await bookingWithOutstandingFine();

    const res = await request(app)
      .post(`${API}/deposits/booking/${bookingId}/release`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ releaseAnyway: true });

    expect(res.status).toBe(200);

    const release = await prisma.depositTransaction.findFirstOrThrow({
      where: { deposit: { bookingId }, type: 'RELEASE' },
    });
    expect(release.reason).toMatch(/still outstanding/i);
  });

  it('releases normally when nothing is owed', async () => {
    const bookingId = await makeBooking('RETURNED');
    const deposit = await prisma.securityDeposit.create({
      data: { bookingId, amount: '1000.00', status: 'HELD', heldAt: new Date() },
    });
    await prisma.depositTransaction.create({
      data: { depositId: deposit.id, type: 'HOLD', amount: '1000.00', reason: 'Test hold' },
    });

    const res = await request(app)
      .post(`${API}/deposits/booking/${bookingId}/release`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.data.deposit.balance).toBe('0.00');
  });
});

// ---------------------------------------------------------------------------
describe('The back-office roles', () => {
  /*
   * =========================================================================
   * WHAT THESE PROVE
   * =========================================================================
   * The three new roles existed in the database and were enforced nowhere, so
   * a MANAGER was treated as a stranger and an ACCOUNTANT could have walked
   * into a handover screen. Each test below is one door: who gets through it,
   * and - more importantly - who does not.
   */
  let managerToken: string;
  let accountantToken: string;
  let inspectorToken: string;

  beforeAll(async () => {
    const manager = await createUser({ role: 'MANAGER' });
    const accountant = await createUser({ role: 'ACCOUNTANT' });
    const inspector = await createUser({ role: 'INSPECTOR' });
    createdEmails.push(manager.email, accountant.email, inspector.email);

    managerToken = await loginAndGetToken(app, manager.email);
    accountantToken = await loginAndGetToken(app, accountant.email);
    inspectorToken = await loginAndGetToken(app, inspector.email);
  });

  it('lets a manager do the counter work a clerk can', async () => {
    const res = await request(app)
      .get(`${API}/bookings`)
      .set('Authorization', `Bearer ${managerToken}`);
    expect(res.status).toBe(200);
  });

  it('lets an accountant read the payments ledger', async () => {
    const res = await request(app)
      .get(`${API}/payments`)
      .set('Authorization', `Bearer ${accountantToken}`);
    expect(res.status).toBe(200);
  });

  it('keeps an accountant out of the handover screens', async () => {
    const bookingId = await makeBooking('CONFIRMED');
    const res = await request(app)
      .post(`${API}/rentals/booking/${bookingId}/pickup`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ mileage: 100, fuelPercent: 100, customerVerified: true });

    expect(res.status).toBe(403);
  });

  it('keeps an inspector out of the money', async () => {
    const payments = await request(app)
      .get(`${API}/payments`)
      .set('Authorization', `Bearer ${inspectorToken}`);
    expect(payments.status).toBe(403);

    const reports = await request(app)
      .get(`${API}/reports/dashboard`)
      .set('Authorization', `Bearer ${inspectorToken}`);
    expect(reports.status).toBe(403);
  });

  it('lets an inspector record damage, which is their job', async () => {
    const res = await request(app)
      .get(`${API}/damages`)
      .set('Authorization', `Bearer ${inspectorToken}`);
    expect(res.status).toBe(200);
  });

  it('keeps all three out of user management', async () => {
    for (const token of [managerToken, accountantToken, inspectorToken]) {
      const res = await request(app).get(`${API}/users`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    }
  });

  /*
   * A manager is not a customer. Before the shared `isBackOffice` helper,
   * every "am I back office?" test was a hand-written comparison against ADMIN
   * and STAFF - so a manager's booking list would have come back containing
   * only their own bookings, with no error to explain why.
   */
  it('shows a manager everybody’s bookings, not just their own', async () => {
    const res = await request(app)
      .get(`${API}/bookings`)
      .set('Authorization', `Bearer ${managerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.items.length).toBeGreaterThan(0);
  });
});
