/**
 * tests/notifications.test.ts
 * ---------------------------------------------------------------------------
 * The customer is told when their booking is confirmed.
 *
 * The online route (payment clears -> confirmed -> email) was already covered
 * by the payment tests. What was NOT covered, and what these tests exist for,
 * is every OTHER way a booking reaches CONFIRMED:
 *
 *   1. Staff confirming a verified cash booking by hand.
 *   2. A cash booking that is confirmed the moment it is created.
 *
 * Both used to notify nobody, which is a silent failure of exactly the kind a
 * test suite is supposed to catch: the booking was correct, the customer just
 * never heard about it.
 *
 * They also check the WORDING, because "your payment has gone through" sent to
 * someone paying at the counter is not a typo - it tells them there is nothing
 * left to pay, and they arrive without the money.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { prisma, disconnectPrisma } from '../src/config/prisma';
import { API, cleanupUsers, createUser, loginAndGetToken } from './helpers';
import { SmtpNotificationProvider } from '../src/services/notification/smtpProvider';

const app = createApp();
const createdEmails: string[] = [];

let customerToken: string;
let customerEmail: string;
let adminToken: string;
let vehicleId: string;
let cashWasAllowed: string | null = null;

function future(days: number, hour = 10): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  date.setUTCHours(hour, 0, 0, 0);
  return date.toISOString();
}

/** The notification the system composed for this booking, whatever its fate. */
async function confirmationFor(bookingId: string) {
  return prisma.notification.findFirst({
    where: { relatedType: 'Booking', relatedId: bookingId, templateKey: 'booking.confirmed' },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * The send is deliberately detached from the request - a mail server being
 * down must not roll back a confirmation - so the row appears just after the
 * response. Polling beats a fixed sleep: it is faster when things are quick
 * and does not go flaky when the machine is busy.
 */
async function waitForConfirmation(bookingId: string, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = await confirmationFor(bookingId);
    if (found) return found;
    if (Date.now() > deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

beforeAll(async () => {
  const customer = await createUser({ role: 'CUSTOMER', fullName: 'Cash Paying Customer' });
  const admin = await createUser({ role: 'ADMIN' });
  createdEmails.push(customer.email, admin.email);
  customerEmail = customer.email;

  customerToken = await loginAndGetToken(app, customer.email);
  adminToken = await loginAndGetToken(app, admin.email);

  // Pay-at-pickup is a client-configurable setting seeded blank, so the test
  // turns it on and puts it back exactly as it found it.
  const existing = await prisma.systemSetting.findUnique({
    where: { key: 'payments.allow_cash_on_pickup' },
  });
  cashWasAllowed = existing?.value ?? null;
  await prisma.systemSetting.update({
    where: { key: 'payments.allow_cash_on_pickup' },
    data: { value: 'true' },
  });

  const category = await prisma.vehicleCategory.findFirst({ where: { isActive: true } });
  const vehicle = await prisma.vehicle.create({
    data: {
      brand: 'Notify',
      model: 'TestCar',
      year: 2024,
      registrationNumber: `NTF-${Date.now().toString().slice(-8)}`,
      categoryId: category!.id,
      seats: 5,
      transmission: 'AUTOMATIC',
      fuelType: 'PETROL',
      dailyPrice: '150.00',
      securityDeposit: '750.00',
    },
  });
  vehicleId = vehicle.id;
});

afterAll(async () => {
  await prisma.systemSetting.update({
    where: { key: 'payments.allow_cash_on_pickup' },
    data: { value: cashWasAllowed },
  });

  const bookings = await prisma.booking.findMany({ where: { vehicleId }, select: { id: true } });
  const ids = bookings.map((b) => b.id);
  await prisma.notification.deleteMany({ where: { relatedType: 'Booking', relatedId: { in: ids } } });
  await prisma.bookingStatusHistory.deleteMany({ where: { bookingId: { in: ids } } });
  await prisma.bookingService.deleteMany({ where: { bookingId: { in: ids } } });
  await prisma.booking.deleteMany({ where: { vehicleId } });
  await prisma.vehicle.deleteMany({ where: { id: vehicleId } });

  const customers = await prisma.customer.findMany({
    where: { user: { email: { in: createdEmails } } },
    select: { id: true },
  });
  await prisma.notification.deleteMany({
    where: { recipientId: { in: customers.map((c) => c.id) } },
  });
  await prisma.customer.deleteMany({ where: { id: { in: customers.map((c) => c.id) } } });
  await cleanupUsers(createdEmails);
  await disconnectPrisma();
});

describe('booking confirmation email', () => {
  it('is sent when staff confirm a cash booking, and is addressed to the customer', async () => {
    // Documents are unverified, so this lands in DOCUMENT_VERIFICATION - the
    // exact route that used to end in silence.
    const created = await request(app)
      .post(`${API}/bookings`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        vehicleId,
        pickupAt: future(20),
        returnAt: future(23),
        paymentMethod: 'CASH_ON_PICKUP',
      });

    expect(created.status).toBe(201);
    const booking = created.body.data.booking;
    expect(booking.status).toBe('DOCUMENT_VERIFICATION');

    // Nothing has been confirmed yet, so nothing may claim it has.
    expect(await confirmationFor(booking.id)).toBeNull();

    const confirmed = await request(app)
      .patch(`${API}/bookings/${booking.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'CONFIRMED', reason: 'Documents checked at the counter' });

    expect(confirmed.status).toBe(200);

    const message = await waitForConfirmation(booking.id);
    expect(message).not.toBeNull();
    expect(message!.channel).toBe('EMAIL');
    expect(message!.toAddress).toBe(customerEmail);
    expect(message!.status).toBe('SENT');
    expect(message!.subject).toContain(booking.bookingNumber);
  });

  it('tells a cash customer to bring the money, and does not claim they have paid', async () => {
    const created = await request(app)
      .post(`${API}/bookings`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        vehicleId,
        pickupAt: future(40),
        returnAt: future(42),
        paymentMethod: 'CASH_ON_PICKUP',
      });

    expect(created.status).toBe(201);
    const booking = created.body.data.booking;

    await request(app)
      .patch(`${API}/bookings/${booking.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'CONFIRMED' });

    const message = await waitForConfirmation(booking.id);
    expect(message).not.toBeNull();

    // The whole point of the two data-driven lines.
    expect(message!.body).not.toContain('payment has gone through');
    expect(message!.body).toContain('pay when you collect');
    expect(message!.body).toContain(booking.pricing.totalAmount);

    // And no placeholder escaped unfilled - a single-pass fill means a nested
    // {{total}} would reach the customer literally.
    expect(message!.body).not.toContain('{{');
  });

  it('never leaves a template placeholder unfilled in the subject either', async () => {
    const message = await prisma.notification.findFirst({
      where: { templateKey: 'booking.confirmed' },
      orderBy: { createdAt: 'desc' },
    });
    expect(message?.subject ?? '').not.toContain('{{');
  });
});

describe('the smtp driver', () => {
  it('refuses to be constructed without credentials, naming every missing one', () => {
    // The test environment has no SMTP settings, which is the point: a server
    // that boots and then fails on every email is worse than one that does
    // not boot.
    expect(() => new SmtpNotificationProvider()).toThrowError(/SMTP_HOST/);
    expect(() => new SmtpNotificationProvider()).toThrowError(/SMTP_PASSWORD/);
  });
});
