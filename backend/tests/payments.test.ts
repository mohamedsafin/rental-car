/**
 * tests/payments.test.ts
 * ---------------------------------------------------------------------------
 * PHASE 7 ACCEPTANCE: a WEBHOOK - not the browser - flips a booking from
 * PAYMENT_PENDING to CONFIRMED.
 *
 * The negative tests matter more than the happy path. Marking a payment
 * successful because the frontend said so is the single most common way
 * rental systems get defrauded, so most of this file is about the ways that
 * must fail.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'node:crypto';
import { createApp } from '../src/app';
import { prisma, disconnectPrisma } from '../src/config/prisma';
import { env } from '../src/config/env';
import { API, cleanupUsers, createUser, loginAndGetToken } from './helpers';

const app = createApp();
const createdEmails: string[] = [];

let customerToken: string;
let adminToken: string;
let vehicleId: string;

function future(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  date.setUTCHours(10, 0, 0, 0);
  return date.toISOString();
}

/** Sign a webhook body exactly as the provider would. */
function sign(body: string): string {
  return crypto
    .createHmac('sha256', env.PAYMENT_WEBHOOK_SECRET ?? '')
    .update(Buffer.from(body, 'utf8'))
    .digest('hex');
}

function webhookBody(overrides: Record<string, unknown>): string {
  return JSON.stringify({
    eventId: `evt_${crypto.randomUUID()}`,
    type: 'payment.succeeded',
    status: 'succeeded',
    currency: 'AED',
    ...overrides,
  });
}

function postWebhook(body: string, signature?: string) {
  // The STRING is sent, not a Buffer. Superagent re-serialises a Buffer when
  // the content type is JSON, which changes the bytes and breaks the very
  // signature this is meant to exercise.
  return request(app)
    .post(`${API}/payments/webhook`)
    .set('Content-Type', 'application/json')
    .set('x-webhook-signature', signature ?? sign(body))
    .send(body);
}

beforeAll(async () => {
  const customer = await createUser({ role: 'CUSTOMER' });
  const admin = await createUser({ role: 'ADMIN' });
  createdEmails.push(customer.email, admin.email);

  customerToken = await loginAndGetToken(app, customer.email);
  adminToken = await loginAndGetToken(app, admin.email);

  const category = await prisma.vehicleCategory.findFirst({ where: { isActive: true } });
  const vehicle = await prisma.vehicle.create({
    data: {
      brand: 'Payment',
      model: 'TestCar',
      year: 2024,
      registrationNumber: `PAY-${Date.now().toString().slice(-8)}`,
      categoryId: category!.id,
      seats: 5,
      transmission: 'AUTOMATIC',
      fuelType: 'PETROL',
      dailyPrice: '100.00',
      securityDeposit: '500.00',
    },
  });
  vehicleId = vehicle.id;
});

afterAll(async () => {
  const bookings = await prisma.booking.findMany({ where: { vehicleId }, select: { id: true } });
  const ids = bookings.map((b) => b.id);
  if (ids.length > 0) {
    await prisma.depositTransaction.deleteMany({
      where: { deposit: { bookingId: { in: ids } } },
    });
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

/** Create a booking and move it to PAYMENT_PENDING. */
async function bookAndReady(days: [number, number]): Promise<string> {
  const created = await request(app)
    .post(`${API}/bookings`)
    .set('Authorization', `Bearer ${customerToken}`)
    .send({ vehicleId, pickupAt: future(days[0]), returnAt: future(days[1]) });

  const id = created.body.data.booking.id as string;

  if (created.body.data.booking.status === 'DOCUMENT_VERIFICATION') {
    await request(app)
      .patch(`${API}/bookings/${id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'PAYMENT_PENDING' });
  }
  return id;
}

async function initiate(bookingId: string, type = 'RENTAL') {
  const res = await request(app)
    .post(`${API}/payments/initiate`)
    .set('Authorization', `Bearer ${customerToken}`)
    .send({ bookingId, type });
  return res;
}

describe('webhook signature - the front door', () => {
  it('REFUSES a webhook with no signature', async () => {
    const res = await request(app)
      .post(`${API}/payments/webhook`)
      .set('Content-Type', 'application/json')
      .send(webhookBody({ providerPaymentId: 'anything' }));

    expect(res.status).toBe(401);
  });

  it('REFUSES a webhook with a forged signature', async () => {
    const body = webhookBody({ providerPaymentId: 'anything' });
    const res = await postWebhook(body, 'a'.repeat(64));

    expect(res.status).toBe(401);
    expect(res.body.message).toContain('signature');
  });

  it('REFUSES a signature computed over a DIFFERENT body', async () => {
    // Sign one payload, send another - the classic tampering attempt.
    const honest = webhookBody({ providerPaymentId: 'x', amount: '10.00' });
    const tampered = webhookBody({ providerPaymentId: 'x', amount: '10000.00' });

    const res = await postWebhook(tampered, sign(honest));
    expect(res.status).toBe(401);
  });
});

describe('a webhook confirms the booking - the Phase 7 acceptance test', () => {
  it('flips PAYMENT_PENDING to CONFIRMED, and only via the webhook', async () => {
    const bookingId = await bookAndReady([2000, 2003]);

    const session = await initiate(bookingId);
    expect(session.status).toBe(201);
    expect(session.body.data.checkoutUrl).toBeTruthy();

    // Creating the session must NOT confirm anything on its own.
    let booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(booking.status).toBe('PAYMENT_PENDING');

    const payment = await prisma.payment.findFirstOrThrow({ where: { bookingId } });

    const res = await postWebhook(
      webhookBody({
        providerPaymentId: payment.providerPaymentId,
        amount: payment.amount.toFixed(2),
      }),
    );
    expect(res.status).toBe(200);

    booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(booking.status).toBe('CONFIRMED');
    expect(booking.holdExpiresAt).toBeNull();

    const settled = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(settled.status).toBe('SUCCESS');
    expect(settled.paidAt).not.toBeNull();
  });

  it('records the confirmation in the booking history', async () => {
    const bookingId = await bookAndReady([2010, 2013]);
    await initiate(bookingId);
    const payment = await prisma.payment.findFirstOrThrow({ where: { bookingId } });

    await postWebhook(
      webhookBody({
        providerPaymentId: payment.providerPaymentId,
        amount: payment.amount.toFixed(2),
      }),
    );

    const history = await prisma.bookingStatusHistory.findMany({
      where: { bookingId, toStatus: 'CONFIRMED' },
    });
    expect(history).toHaveLength(1);
    expect(history[0]?.reason).toContain('Payment received');
  });

  it('there is NO endpoint a browser can call to confirm a payment', async () => {
    const bookingId = await bookAndReady([2020, 2023]);
    await initiate(bookingId);

    // Every shape someone might hope exists.
    for (const path of [
      `${API}/payments/confirm`,
      `${API}/payments/success`,
      `${API}/bookings/${bookingId}/confirm-payment`,
    ]) {
      const res = await request(app)
        .post(path)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ bookingId, status: 'SUCCESS' });

      expect(res.status, `${path} must not exist`).toBe(404);
    }

    // And the customer cannot drive the booking there through the status API.
    const viaStatus = await request(app)
      .patch(`${API}/bookings/${bookingId}/status`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ status: 'CONFIRMED' });
    expect(viaStatus.status).toBe(403);

    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(booking.status).toBe('PAYMENT_PENDING');
  });
});

describe('amount tampering', () => {
  it('REFUSES a correctly-signed webhook whose amount is wrong', async () => {
    const bookingId = await bookAndReady([2030, 2033]);
    await initiate(bookingId);
    const payment = await prisma.payment.findFirstOrThrow({ where: { bookingId } });

    // Genuinely signed. Genuinely from the provider. Genuinely 1.00 instead
    // of the real total - and that is enough to reject it.
    const res = await postWebhook(
      webhookBody({ providerPaymentId: payment.providerPaymentId, amount: '1.00' }),
    );

    expect(res.status).toBe(200);
    expect(res.body.data.handled).toBe(false);
    expect(res.body.data.reason).toBe('amount_mismatch');

    const after = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(after.status).toBe('PENDING');

    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(booking.status).toBe('PAYMENT_PENDING');
  });

  it('logs the mismatch for investigation', async () => {
    const logs = await prisma.auditLog.findMany({ where: { action: 'payment.amount_mismatch' } });
    expect(logs.length).toBeGreaterThan(0);
  });
});

describe('idempotency - providers retry', () => {
  it('processes a repeated delivery exactly once', async () => {
    const bookingId = await bookAndReady([2040, 2043]);
    await initiate(bookingId);
    const payment = await prisma.payment.findFirstOrThrow({ where: { bookingId } });

    const body = webhookBody({
      providerPaymentId: payment.providerPaymentId,
      amount: payment.amount.toFixed(2),
    });

    const first = await postWebhook(body);
    const second = await postWebhook(body);
    const third = await postWebhook(body);

    // All acknowledged - a non-2xx would make the provider retry forever.
    expect([first.status, second.status, third.status]).toEqual([200, 200, 200]);
    expect(second.body.data.reason).toBe('duplicate');

    // But only ONE deposit hold, not three.
    const deposit = await prisma.securityDeposit.findUnique({ where: { bookingId } });
    expect(deposit?.status).toBe('PENDING');

    const events = await prisma.webhookEvent.findMany({
      where: { eventId: JSON.parse(body).eventId as string },
    });
    expect(events).toHaveLength(1);
  });

  it('ignores a webhook for an unknown payment without erroring', async () => {
    const res = await postWebhook(
      webhookBody({ providerPaymentId: 'mock_pi_does_not_exist', amount: '10.00' }),
    );

    expect(res.status).toBe(200);
    expect(res.body.data.reason).toBe('unknown_payment');
  });
});

describe('deposit ledger', () => {
  /** Pay the rental, then the deposit, so it reaches HELD. */
  async function bookingWithHeldDeposit(days: [number, number]): Promise<string> {
    const bookingId = await bookAndReady(days);

    await initiate(bookingId, 'RENTAL');
    const rental = await prisma.payment.findFirstOrThrow({ where: { bookingId, type: 'RENTAL' } });
    await postWebhook(
      webhookBody({
        providerPaymentId: rental.providerPaymentId,
        amount: rental.amount.toFixed(2),
      }),
    );

    await initiate(bookingId, 'SECURITY_DEPOSIT');
    const deposit = await prisma.payment.findFirstOrThrow({
      where: { bookingId, type: 'SECURITY_DEPOSIT' },
    });
    await postWebhook(
      webhookBody({
        providerPaymentId: deposit.providerPaymentId,
        amount: deposit.amount.toFixed(2),
      }),
    );

    return bookingId;
  }

  it('opens the ledger with a HOLD when the deposit is paid', async () => {
    const bookingId = await bookingWithHeldDeposit([2100, 2103]);

    const res = await request(app)
      .get(`${API}/deposits/booking/${bookingId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.deposit.status).toBe('HELD');
    expect(res.body.data.deposit.held).toBe('500.00');
    expect(res.body.data.deposit.balance).toBe('500.00');
    expect(res.body.data.deposit.transactions).toHaveLength(1);
    expect(res.body.data.deposit.transactions[0].type).toBe('HOLD');
  });

  it('derives the balance from the ledger after a deduction', async () => {
    const bookingId = await bookingWithHeldDeposit([2110, 2113]);

    const res = await request(app)
      .post(`${API}/deposits/booking/${bookingId}/deduct`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount: '150.00', category: 'DAMAGE', reason: 'Scratch on the rear bumper' });

    expect(res.status).toBe(200);
    expect(res.body.data.deposit.deducted).toBe('150.00');
    expect(res.body.data.deposit.balance).toBe('350.00');
  });

  it('REFUSES a deduction with no reason', async () => {
    const bookingId = await bookingWithHeldDeposit([2120, 2123]);

    const res = await request(app)
      .post(`${API}/deposits/booking/${bookingId}/deduct`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount: '50.00', category: 'CLEANING' });

    expect(res.status).toBe(400);
  });

  it('REFUSES a deduction larger than the remaining balance', async () => {
    const bookingId = await bookingWithHeldDeposit([2130, 2133]);

    const res = await request(app)
      .post(`${API}/deposits/booking/${bookingId}/deduct`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount: '9999.00', category: 'DAMAGE', reason: 'Written off' });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('additional charge');
  });

  it('releases the balance and closes the deposit', async () => {
    const bookingId = await bookingWithHeldDeposit([2140, 2143]);

    await request(app)
      .post(`${API}/deposits/booking/${bookingId}/deduct`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount: '100.00', category: 'FUEL', reason: 'Returned with 3/4 tank' });

    const res = await request(app)
      .post(`${API}/deposits/booking/${bookingId}/release`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.data.deposit.status).toBe('RELEASED');
    expect(res.body.data.deposit.balance).toBe('0.00');
    expect(res.body.data.deposit.released).toBe('400.00');
    // HOLD + DEDUCTION + RELEASE, all still there.
    expect(res.body.data.deposit.transactions).toHaveLength(3);
  });

  it('lets the customer see their own deposit ledger', async () => {
    const bookingId = await bookingWithHeldDeposit([2150, 2153]);

    const res = await request(app)
      .get(`${API}/deposits/booking/${bookingId}`)
      .set('Authorization', `Bearer ${customerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.deposit.held).toBe('500.00');
  });

  it('REFUSES a deduction by a CUSTOMER', async () => {
    const bookingId = await bookingWithHeldDeposit([2160, 2163]);

    const res = await request(app)
      .post(`${API}/deposits/booking/${bookingId}/deduct`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ amount: '10.00', category: 'OTHER', reason: 'Refund me less' });

    expect(res.status).toBe(403);
  });
});

describe('refunds (BRD 32)', () => {
  async function paidBooking(days: [number, number]) {
    const bookingId = await bookAndReady(days);
    await initiate(bookingId);
    const payment = await prisma.payment.findFirstOrThrow({ where: { bookingId } });
    await postWebhook(
      webhookBody({
        providerPaymentId: payment.providerPaymentId,
        amount: payment.amount.toFixed(2),
      }),
    );
    return { bookingId, paymentId: payment.id, amount: payment.amount.toFixed(2) };
  }

  it('issues a partial refund and marks the payment PARTIALLY_REFUNDED', async () => {
    const { paymentId } = await paidBooking([2200, 2203]);

    const res = await request(app)
      .post(`${API}/payments/${paymentId}/refund`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount: '50.00', reason: 'Goodwill' });

    expect(res.status).toBe(201);

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(payment.status).toBe('PARTIALLY_REFUNDED');
  });

  it('REFUSES to refund more than remains', async () => {
    const { paymentId, amount } = await paidBooking([2210, 2213]);

    await request(app)
      .post(`${API}/payments/${paymentId}/refund`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount: '100.00' });

    const res = await request(app)
      .post(`${API}/payments/${paymentId}/refund`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('remains refundable');
  });

  it('REFUSES a refund by a CUSTOMER', async () => {
    const { paymentId } = await paidBooking([2220, 2223]);

    const res = await request(app)
      .post(`${API}/payments/${paymentId}/refund`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ amount: '10.00' });

    expect(res.status).toBe(403);
  });
});

describe('no card data anywhere', () => {
  it('never stores a card number, CVV or expiry', async () => {
    const bookingId = await bookAndReady([2300, 2303]);
    await initiate(bookingId);

    const payment = await prisma.payment.findFirstOrThrow({ where: { bookingId } });
    const serialised = JSON.stringify(payment).toLowerCase();

    for (const forbidden of ['cardnumber', 'card_number', 'cvv', 'cvc', 'expiry']) {
      expect(serialised).not.toContain(forbidden);
    }
  });

  it('ignores an amount sent on the initiate request', async () => {
    const bookingId = await bookAndReady([2310, 2313]);

    const res = await request(app)
      .post(`${API}/payments/initiate`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ bookingId, type: 'RENTAL', amount: '1.00' });

    expect(res.status).toBe(201);

    // The amount came from the booking, not the request body.
    const payment = await prisma.payment.findFirstOrThrow({ where: { bookingId } });
    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(payment.amount.toFixed(2)).toBe(booking.totalAmount.toFixed(2));
    expect(payment.amount.toFixed(2)).not.toBe('1.00');
  });
});
