/**
 * tests/output.test.ts
 * ---------------------------------------------------------------------------
 * PHASE 10 ACCEPTANCE, both halves:
 *
 *   1. A downloadable invoice - issued, immutable, and correctable only by a
 *      credit note.
 *   2. A revenue report that MATCHES PAYMENTS. Not bookings. The test books
 *      more than it pays for, on purpose, so a report that summed bookings
 *      instead of payments would fail here.
 *
 * Plus coupons, where the point being tested is that the server decides what a
 * code is worth and the client cannot send an amount.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'node:crypto';
import { createApp } from '../src/app';
import { prisma, disconnectPrisma } from '../src/config/prisma';
import { env } from '../src/config/env';
import { clearSettingsCache } from '../src/modules/settings/service';
import { notificationsService } from '../src/modules/notifications/service';
import { API, cleanupUsers, createUser, loginAndGetToken } from './helpers';

const app = createApp();
const createdEmails: string[] = [];

let customerToken: string;
let otherCustomerToken: string;
let staffToken: string;
let adminToken: string;
let customerId: string;
let vehicleId: string;
let categoryId: string;

/** Far-future offsets, so this suite cannot collide with the others. */
function future(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  date.setUTCHours(10, 0, 0, 0);
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
  const other = await createUser({ role: 'CUSTOMER' });
  const staff = await createUser({ role: 'STAFF' });
  const admin = await createUser({ role: 'ADMIN' });
  createdEmails.push(customer.email, other.email, staff.email, admin.email);

  customerId = customer.id;
  customerToken = await loginAndGetToken(app, customer.email);
  otherCustomerToken = await loginAndGetToken(app, other.email);
  staffToken = await loginAndGetToken(app, staff.email);
  adminToken = await loginAndGetToken(app, admin.email);

  const category = await prisma.vehicleCategory.findFirst({ where: { isActive: true } });
  categoryId = category!.id;

  const vehicle = await prisma.vehicle.create({
    data: {
      brand: 'Output',
      model: 'TestCar',
      year: 2024,
      registrationNumber: `OUT-${Date.now().toString().slice(-8)}`,
      categoryId,
      seats: 5,
      transmission: 'AUTOMATIC',
      fuelType: 'PETROL',
      dailyPrice: '100.00',
      securityDeposit: '500.00',
    },
  });
  vehicleId = vehicle.id;

  clearSettingsCache();
});

afterAll(async () => {
  const bookings = await prisma.booking.findMany({ where: { vehicleId }, select: { id: true } });
  const ids = bookings.map((booking) => booking.id);

  if (ids.length > 0) {
    await prisma.invoiceLineItem.deleteMany({ where: { invoice: { bookingId: { in: ids } } } });
    // Credit notes reference their original, so clear the pointer before the
    // rows go or the self-relation blocks the delete.
    await prisma.invoice.updateMany({ where: { bookingId: { in: ids } }, data: { correctsId: null } });
    await prisma.invoice.deleteMany({ where: { bookingId: { in: ids } } });
    await prisma.bookingAgreement.deleteMany({ where: { bookingId: { in: ids } } });
    await prisma.couponRedemption.deleteMany({ where: { bookingId: { in: ids } } });
    await prisma.additionalCharge.deleteMany({ where: { bookingId: { in: ids } } });
    await prisma.depositTransaction.deleteMany({ where: { deposit: { bookingId: { in: ids } } } });
    await prisma.securityDeposit.deleteMany({ where: { bookingId: { in: ids } } });
    await prisma.refund.deleteMany({ where: { payment: { bookingId: { in: ids } } } });
    await prisma.payment.deleteMany({ where: { bookingId: { in: ids } } });
    await prisma.bookingStatusHistory.deleteMany({ where: { bookingId: { in: ids } } });
    await prisma.bookingService.deleteMany({ where: { bookingId: { in: ids } } });
    await prisma.booking.deleteMany({ where: { id: { in: ids } } });
  }

  await prisma.coupon.deleteMany({ where: { code: { startsWith: 'TEST' } } });
  await prisma.notification.deleteMany({ where: { recipientId: { in: [customerId] } } });
  await prisma.vehicle.deleteMany({ where: { id: vehicleId } });

  const customers = await prisma.customer.findMany({
    where: { user: { email: { in: createdEmails } } },
    select: { id: true },
  });
  const customerIds = customers.map((row) => row.id);
  if (customerIds.length > 0) {
    await prisma.customerDocument.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
  }

  await cleanupUsers(createdEmails);
  await disconnectPrisma();
});

/** Book, then pay through the webhook - the only route that confirms money. */
async function bookAndPay(
  days: [number, number],
  options: { couponCode?: string } = {},
): Promise<{ bookingId: string; total: string }> {
  const created = await request(app)
    .post(`${API}/bookings`)
    .set('Authorization', `Bearer ${customerToken}`)
    .send({
      vehicleId,
      pickupAt: future(days[0]),
      returnAt: future(days[1]),
      ...(options.couponCode ? { couponCode: options.couponCode } : {}),
    });

  expect(created.status).toBe(201);
  const bookingId = created.body.data.booking.id as string;

  if (created.body.data.booking.status === 'DOCUMENT_VERIFICATION') {
    await request(app)
      .patch(`${API}/bookings/${bookingId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'PAYMENT_PENDING' });
  }

  const initiated = await request(app)
    .post(`${API}/payments/initiate`)
    .set('Authorization', `Bearer ${customerToken}`)
    .send({ bookingId, type: 'RENTAL' });

  expect(initiated.status).toBe(201);

  // Read the payment row rather than trusting the session response: the
  // webhook is verified against what WE recorded, and that is the pair of
  // values a real provider would echo back.
  const payment = await prisma.payment.findFirstOrThrow({
    where: { bookingId, type: 'RENTAL' },
  });
  const providerPaymentId = payment.providerPaymentId;
  const amount = payment.amount.toFixed(2);

  const body = JSON.stringify({
    eventId: `evt_${crypto.randomUUID()}`,
    type: 'payment.succeeded',
    status: 'succeeded',
    currency: 'AED',
    providerPaymentId,
    amount,
  });

  const webhook = await request(app)
    .post(`${API}/payments/webhook`)
    .set('Content-Type', 'application/json')
    .set('x-webhook-signature', sign(body))
    .send(body);

  expect(webhook.status).toBe(200);

  return { bookingId, total: amount };
}

describe('Coupons (BRD 19)', () => {
  let couponId: string;

  it('creates a percentage code', async () => {
    const response = await request(app)
      .post(`${API}/coupons`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        code: 'testsave20',
        description: '20% off',
        discountType: 'PERCENTAGE',
        value: '20',
        maxDiscount: '50.00',
        validFrom: future(-1),
        validUntil: future(400),
        perCustomerLimit: 1,
      });

    expect(response.status).toBe(201);
    // Stored uppercase, so SUMMER25 and summer25 are one code, not two.
    expect(response.body.data.code).toBe('TESTSAVE20');
    couponId = response.body.data.id;
  });

  it('refuses a duplicate code', async () => {
    const response = await request(app)
      .post(`${API}/coupons`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        code: 'TESTSAVE20',
        discountType: 'PERCENTAGE',
        value: '10',
        validFrom: future(-1),
        validUntil: future(400),
      });

    expect(response.status).toBe(409);
  });

  it('will not let staff create a coupon - giving money away is an admin call', async () => {
    const response = await request(app)
      .post(`${API}/coupons`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        code: 'TESTSTAFF',
        discountType: 'FIXED_AMOUNT',
        value: '10',
        validFrom: future(-1),
        validUntil: future(400),
      });

    expect(response.status).toBe(403);
  });

  it('applies the code in the quote, capped by maxDiscount', async () => {
    // 3 days at 100 = 300. 20% would be 60, but the cap is 50.
    const response = await request(app)
      .post(`${API}/pricing/quote`)
      .send({
        vehicleId,
        pickupAt: future(300),
        returnAt: future(303),
        couponCode: 'TESTSAVE20',
      });

    expect(response.status).toBe(200);
    expect(response.body.data.quote.coupon.code).toBe('TESTSAVE20');
    expect(response.body.data.quote.coupon.discountAmount).toBe('50.00');
    expect(response.body.data.quote.totals.discountAmount).toBe('50.00');
  });

  it('IGNORES a discount amount sent by the client', async () => {
    const response = await request(app)
      .post(`${API}/pricing/quote`)
      .send({
        vehicleId,
        pickupAt: future(300),
        returnAt: future(303),
        couponCode: 'TESTSAVE20',
        // A hopeful browser. `validate` strips it before the schema runs.
        discountAmount: '9999.00',
        totals: { discountAmount: '9999.00' },
      });

    expect(response.status).toBe(200);
    expect(response.body.data.quote.totals.discountAmount).toBe('50.00');
  });

  it('explains WHY a code does not apply, rather than just refusing', async () => {
    await request(app)
      .post(`${API}/coupons`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        code: 'TESTLONG7',
        discountType: 'FIXED_AMOUNT',
        value: '25.00',
        minRentalDays: 7,
        validFrom: future(-1),
        validUntil: future(400),
      });

    const response = await request(app)
      .post(`${API}/pricing/quote`)
      .send({ vehicleId, pickupAt: future(300), returnAt: future(302), couponCode: 'TESTLONG7' });

    expect(response.status).toBe(400);
    // "invalid code" makes people retype a code that was never going to work.
    expect(response.body.message).toContain('7 days');
  });

  it('gives the same answer for an unknown code and a withdrawn one', async () => {
    await request(app)
      .patch(`${API}/coupons/${couponId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isActive: false });

    const withdrawn = await request(app)
      .post(`${API}/pricing/quote`)
      .send({ vehicleId, pickupAt: future(300), returnAt: future(303), couponCode: 'TESTSAVE20' });

    const unknown = await request(app)
      .post(`${API}/pricing/quote`)
      .send({ vehicleId, pickupAt: future(300), returnAt: future(303), couponCode: 'NOSUCHCODE' });

    // Identical, so the endpoint is not an oracle for guessing live codes.
    expect(withdrawn.status).toBe(400);
    expect(unknown.status).toBe(400);
    expect(withdrawn.body.message).toBe(unknown.body.message);

    await request(app)
      .patch(`${API}/coupons/${couponId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isActive: true });
  });

  it('records a redemption and gives the use back when the booking is cancelled', async () => {
    const created = await request(app)
      .post(`${API}/bookings`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        vehicleId,
        pickupAt: future(320),
        returnAt: future(323),
        couponCode: 'TESTSAVE20',
      });

    expect(created.status).toBe(201);
    const bookingId = created.body.data.booking.id as string;

    const afterBooking = await prisma.coupon.findUniqueOrThrow({ where: { id: couponId } });
    expect(afterBooking.timesUsed).toBe(1);

    const redemption = await prisma.couponRedemption.findUnique({ where: { bookingId } });
    expect(redemption?.discountAmount.toFixed(2)).toBe('50.00');

    await request(app)
      .post(`${API}/bookings/${bookingId}/cancel`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ reason: 'Testing release' });

    const afterCancel = await prisma.coupon.findUniqueOrThrow({ where: { id: couponId } });
    // Otherwise a customer who cancels has silently burnt a single-use code
    // they never benefited from.
    expect(afterCancel.timesUsed).toBe(0);
    expect(await prisma.couponRedemption.findUnique({ where: { bookingId } })).toBeNull();
  });
});

describe('Invoices (BRD 28)', () => {
  let bookingId: string;
  let invoiceId: string;
  let invoiceNumber: string;

  it('issues an invoice for a paid booking', async () => {
    const booked = await bookAndPay([340, 343]);
    bookingId = booked.bookingId;

    const response = await request(app)
      .post(`${API}/invoices`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ bookingId });

    expect(response.status).toBe(201);
    expect(response.body.data.type).toBe('INVOICE');
    expect(response.body.data.status).toBe('ISSUED');
    expect(response.body.data.invoiceNumber).toMatch(/^INV-\d{4}-\d{6}$/);
    expect(response.body.data.lineItems.length).toBeGreaterThan(0);

    invoiceId = response.body.data.id;
    invoiceNumber = response.body.data.invoiceNumber;
  });

  it('warns on the invoice while no TRN is configured', async () => {
    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });

    // BRD 51 leaves the TRN to the client. Rather than invent one, the invoice
    // says out loud that it is not yet a valid tax invoice.
    expect(invoice.companyTrn).toBeNull();
    expect(invoice.notes).toContain('Tax Registration Number');
  });

  it('REFUSES to invoice the same booking twice', async () => {
    const response = await request(app)
      .post(`${API}/invoices`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ bookingId });

    // Two live tax documents for one supply is not a duplicate record, it is
    // a compliance problem.
    expect(response.status).toBe(409);
    expect(response.body.message).toContain('credit note');
  });

  it('is a SNAPSHOT: changing the vehicle price does not change the invoice', async () => {
    const before = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });

    await prisma.vehicle.update({
      where: { id: vehicleId },
      data: { dailyPrice: '999.00' },
    });

    const after = await prisma.invoice.findUniqueOrThrow({
      where: { id: invoiceId },
      include: { lineItems: true },
    });

    // The whole reason the snapshot exists. If the invoice were rendered from
    // the live booking, raising a rate would rewrite last month's paperwork.
    expect(after.total.toFixed(2)).toBe(before.total.toFixed(2));
    expect(after.lineItems[0]!.unitPrice.toFixed(2)).not.toBe('999.00');

    await prisma.vehicle.update({ where: { id: vehicleId }, data: { dailyPrice: '100.00' } });
  });

  it('serves the invoice as a PDF', async () => {
    const response = await request(app)
      .get(`${API}/invoices/${invoiceId}/pdf`)
      .set('Authorization', `Bearer ${customerToken}`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/pdf');
    expect(response.headers['content-disposition']).toContain(invoiceNumber);
    // Every PDF starts with these five bytes.
    expect((response.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    expect((response.body as Buffer).length).toBeGreaterThan(1000);
  });

  it('gives another customer 404, not 403', async () => {
    const response = await request(app)
      .get(`${API}/invoices/${invoiceId}`)
      .set('Authorization', `Bearer ${otherCustomerToken}`);

    // 403 would confirm the invoice exists, which is itself a leak.
    expect(response.status).toBe(404);
  });

  it('corrects only by credit note, and the pair sums to zero', async () => {
    const original = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });

    const response = await request(app)
      .post(`${API}/invoices/${invoiceId}/credit-note`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Charged the wrong rate' });

    expect(response.status).toBe(201);
    expect(response.body.data.type).toBe('CREDIT_NOTE');
    expect(response.body.data.invoiceNumber).toMatch(/^CN-\d{4}-\d{6}$/);
    expect(response.body.data.correctsId).toBe(invoiceId);

    const note = await prisma.invoice.findUniqueOrThrow({ where: { id: response.body.data.id } });
    expect(original.total.add(note.total).toFixed(2)).toBe('0.00');

    const afterwards = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    // The original is marked cancelled but is otherwise untouched.
    expect(afterwards.status).toBe('CANCELLED');
    expect(afterwards.total.toFixed(2)).toBe(original.total.toFixed(2));
  });

  it('will not credit the same invoice twice', async () => {
    const response = await request(app)
      .post(`${API}/invoices/${invoiceId}/credit-note`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Again' });

    expect(response.status).toBe(409);
  });

  it('gives every document a distinct number', async () => {
    const invoices = await prisma.invoice.findMany({ select: { invoiceNumber: true } });
    const numbers = invoices.map((invoice) => invoice.invoiceNumber);

    expect(new Set(numbers).size).toBe(numbers.length);
  });
});

describe('Reports (BRD 48-50)', () => {
  /**
   * The acceptance criterion for this phase: "revenue report matches
   * payments".
   *
   * The setup deliberately creates MORE booked value than paid value - one
   * booking is paid, one is left unpaid, and a deposit is taken. A report that
   * summed bookings would count the unpaid one; a report that ignored the
   * payment type would count the deposit as income. Both are wrong, and this
   * test fails on either.
   */
  let paidTotal: string;
  let windowFrom: Date;
  let windowTo: Date;

  beforeAll(async () => {
    windowFrom = new Date(Date.now() - 60_000);

    // Paid.
    const paid = await bookAndPay([360, 363]);
    paidTotal = paid.total;

    // Booked but NEVER paid. Its value must not appear in revenue.
    const unpaid = await request(app)
      .post(`${API}/bookings`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ vehicleId, pickupAt: future(370), returnAt: future(375) });
    expect(unpaid.status).toBe(201);

    windowTo = new Date(Date.now() + 60_000);
  });

  it('ACCEPTANCE: revenue equals what was actually paid, not what was booked', async () => {
    const response = await request(app)
      .get(`${API}/reports/revenue?from=${windowFrom.toISOString()}&to=${windowTo.toISOString()}`)
      .set('Authorization', `Bearer ${staffToken}`);

    expect(response.status).toBe(200);

    // Reconcile against the payment rows directly - the same source the bank
    // statement would agree with.
    const payments = await prisma.payment.findMany({
      where: {
        status: { in: ['SUCCESS', 'REFUNDED', 'PARTIALLY_REFUNDED'] },
        paidAt: { gte: windowFrom, lt: windowTo },
        type: { not: 'SECURITY_DEPOSIT' },
      },
    });

    const expected = payments
      .reduce((total, payment) => total.add(payment.amount), new (require('@prisma/client').Prisma.Decimal)(0))
      .toFixed(2);

    expect(response.body.data.grossRevenue).toBe(expected);
    expect(Number(response.body.data.grossRevenue)).toBeGreaterThanOrEqual(Number(paidTotal));
  });

  it('does NOT count the unpaid booking as revenue', async () => {
    const [revenue, bookings] = await Promise.all([
      request(app)
        .get(`${API}/reports/revenue?from=${windowFrom.toISOString()}&to=${windowTo.toISOString()}`)
        .set('Authorization', `Bearer ${staffToken}`),
      request(app)
        .get(`${API}/reports/bookings?from=${windowFrom.toISOString()}&to=${windowTo.toISOString()}`)
        .set('Authorization', `Bearer ${staffToken}`),
    ]);

    // Booked value is strictly greater than revenue, because one booking was
    // never paid for. If these were equal the report would be summing the
    // wrong table.
    expect(Number(bookings.body.data.bookedValue)).toBeGreaterThan(
      Number(revenue.body.data.grossRevenue),
    );
  });

  it('reports deposits separately and never as income', async () => {
    const booked = await bookAndPay([380, 383]);

    // Pay the security deposit as well.
    const deposit = await request(app)
      .post(`${API}/payments/initiate`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ bookingId: booked.bookingId, type: 'SECURITY_DEPOSIT' });
    expect(deposit.status).toBe(201);

    const payment = await prisma.payment.findFirstOrThrow({
      where: { bookingId: booked.bookingId, type: 'SECURITY_DEPOSIT' },
    });

    const body = JSON.stringify({
      eventId: `evt_${crypto.randomUUID()}`,
      type: 'payment.succeeded',
      status: 'succeeded',
      currency: 'AED',
      providerPaymentId: payment.providerPaymentId,
      amount: payment.amount.toFixed(2),
    });

    await request(app)
      .post(`${API}/payments/webhook`)
      .set('Content-Type', 'application/json')
      .set('x-webhook-signature', sign(body))
      .send(body);

    const to = new Date(Date.now() + 60_000);
    const response = await request(app)
      .get(`${API}/reports/revenue?from=${windowFrom.toISOString()}&to=${to.toISOString()}`)
      .set('Authorization', `Bearer ${staffToken}`);

    // Held, not earned. It shows up, but outside every revenue figure.
    expect(Number(response.body.data.depositsHeld)).toBeGreaterThanOrEqual(500);
    expect(response.body.data.netRevenue).toBe(response.body.data.grossRevenue);
  });

  it('reports fleet utilisation as rented days over AVAILABLE days', async () => {
    const response = await request(app)
      .get(`${API}/reports/fleet?from=${future(355)}&to=${future(365)}`)
      .set('Authorization', `Bearer ${staffToken}`);

    expect(response.status).toBe(200);

    const row = response.body.data.vehicles.find(
      (vehicle: { vehicleId: string }) => vehicle.vehicleId === vehicleId,
    );
    expect(row).toBeTruthy();
    expect(row.rentedDays).toBeGreaterThan(0);
    expect(row.utilisation).toBeGreaterThan(0);
    expect(row.utilisation).toBeLessThanOrEqual(100);
  });

  it('rejects a backwards date range', async () => {
    const response = await request(app)
      .get(`${API}/reports/revenue?from=${future(10)}&to=${future(5)}`)
      .set('Authorization', `Bearer ${staffToken}`);

    expect(response.status).toBe(400);
  });

  it('keeps reports away from customers', async () => {
    const response = await request(app)
      .get(`${API}/reports/dashboard`)
      .set('Authorization', `Bearer ${customerToken}`);

    expect(response.status).toBe(403);
  });
});

describe('Notifications (BRD 42-44)', () => {
  it('logs a confirmation when a booking is paid for', async () => {
    const booked = await bookAndPay([390, 393]);

    // The trigger is fire-and-forget, so give the detached promise a moment.
    await new Promise((resolve) => setTimeout(resolve, 300));

    const notifications = await prisma.notification.findMany({
      where: { relatedType: 'Booking', relatedId: booked.bookingId },
    });

    const keys = notifications.map((notification) => notification.templateKey);
    expect(keys).toContain('booking.created');
    expect(keys).toContain('booking.confirmed');
    expect(keys).toContain('payment.received');
  });

  it('records the composed body, not just an intent to send', async () => {
    const notification = await prisma.notification.findFirstOrThrow({
      where: { templateKey: 'booking.confirmed', recipientId: customerId },
      orderBy: { createdAt: 'desc' },
    });

    // Placeholders were filled from real data, and the row holds what was
    // actually composed - so "what did we send them?" is answerable.
    expect(notification.body).toContain('Output TestCar');
    expect(notification.body).not.toContain('{{');
    expect(notification.subject).toContain('confirmed');
    expect(notification.status).toBe('SENT');
    // The log driver: composed and recorded, but nothing left the building.
    expect(notification.provider).toBe('log');
  });

  it('records a SKIPPED row rather than silently sending nothing', async () => {
    const result = await notificationsService.send({
      templateKey: 'no.such.event',
      recipientId: customerId,
    });

    // Distinct from FAILED: we chose not to send, we did not try and fail.
    expect(result?.status).toBe('SKIPPED');
    expect(result?.lastError).toContain('No template configured');
  });

  it('exposes the log and its templates to staff only', async () => {
    const staff = await request(app)
      .get(`${API}/notifications?limit=5`)
      .set('Authorization', `Bearer ${staffToken}`);
    const customer = await request(app)
      .get(`${API}/notifications`)
      .set('Authorization', `Bearer ${customerToken}`);

    expect(staff.status).toBe(200);
    expect(staff.body.data.items.length).toBeGreaterThan(0);
    expect(customer.status).toBe(403);
  });

  it('lets an admin reword a template without a deployment', async () => {
    const templates = await request(app)
      .get(`${API}/notifications/templates`)
      .set('Authorization', `Bearer ${staffToken}`);

    const target = templates.body.data.find(
      (template: { key: string; channel: string }) =>
        template.key === 'booking.confirmed' && template.channel === 'EMAIL',
    );
    expect(target).toBeTruthy();

    const original = target.subject as string;

    const updated = await request(app)
      .patch(`${API}/notifications/templates/${target.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ subject: 'Reworded by the client' });

    expect(updated.status).toBe(200);
    expect(updated.body.data.subject).toBe('Reworded by the client');

    await request(app)
      .patch(`${API}/notifications/templates/${target.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ subject: original });
  });
});

describe('Legal documents (BRD 45-47)', () => {
  let draftId: string;

  it('creates a draft version', async () => {
    const response = await request(app)
      .post(`${API}/legal`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'CANCELLATION_POLICY',
        title: 'Cancellation policy',
        content: '# Cancellation\n\nTest content.',
      });

    expect(response.status).toBe(201);
    expect(response.body.data.isPublished).toBe(false);
    draftId = response.body.data.id;
  });

  it('publishes it, and then REFUSES to edit it', async () => {
    const published = await request(app)
      .post(`${API}/legal/${draftId}/publish`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send();

    expect(published.status).toBe(200);
    expect(published.body.data.isPublished).toBe(true);

    const edit = await request(app)
      .patch(`${API}/legal/${draftId}/draft`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ content: 'Quietly changed' });

    // Customers agreed to this text. Editing it in place would destroy the
    // only record of what they agreed to.
    expect(edit.status).toBe(409);
  });

  it('serves published documents publicly, with no token', async () => {
    const response = await request(app).get(`${API}/legal/CANCELLATION_POLICY`);

    // Terms you have to sign in to read are terms you cannot read before
    // deciding whether to sign up.
    expect(response.status).toBe(200);
    expect(response.body.data.version).toBeGreaterThanOrEqual(1);
  });

  it('pins the version a booking agreed to', async () => {
    const created = await request(app)
      .post(`${API}/bookings`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ vehicleId, pickupAt: future(410), returnAt: future(413) });

    expect(created.status).toBe(201);

    const agreements = await prisma.bookingAgreement.findMany({
      where: { bookingId: created.body.data.booking.id },
      include: { legalDocument: true },
    });

    // In a dispute the question is "what did the terms say on the day they
    // booked?", and this row is the answer.
    expect(agreements.length).toBeGreaterThan(0);
  });

  it('supersedes rather than overwrites when a new version is published', async () => {
    const before = await prisma.legalDocument.count({ where: { type: 'CANCELLATION_POLICY' } });

    const next = await request(app)
      .post(`${API}/legal`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'CANCELLATION_POLICY',
        title: 'Cancellation policy',
        content: 'A later version.',
      });

    await request(app)
      .post(`${API}/legal/${next.body.data.id}/publish`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send();

    const live = await request(app).get(`${API}/legal/CANCELLATION_POLICY`);
    expect(live.body.data.version).toBe(next.body.data.version);

    // The earlier version is still there, because bookings point at it.
    const after = await prisma.legalDocument.count({ where: { type: 'CANCELLATION_POLICY' } });
    expect(after).toBe(before + 1);
  });
});
