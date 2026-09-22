/**
 * tests/monthly-invoices.test.ts
 * ---------------------------------------------------------------------------
 * A long-term rental is invoiced a month at a time.
 *
 * ===========================================================================
 * WHY THIS IS NOT A PREFERENCE
 * ===========================================================================
 * A six-month rental is not one supply paid in pieces - it is six supplies,
 * each with its own tax point. One invoice at the end would declare six months
 * of VAT in a single period and leave the customer nothing to reclaim against
 * for five of them. A business customer renting for a year would simply not
 * accept it.
 *
 * So the rules under test are:
 *   - a month is invoiced when it is PAID, never in advance
 *   - a month cannot be invoiced twice
 *   - the invoice carries that month's rent AND whatever rode along with it
 *   - the whole-booking path refuses a monthly rental rather than issuing one
 *     document for the term
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { prisma, disconnectPrisma } from '../src/config/prisma';
import { invoicesService } from '../src/modules/invoices/service';
import { API, cleanupUsers, createUser, loginAndGetToken } from './helpers';

const app = createApp();
const createdEmails: string[] = [];

let staffToken: string;
let customerId: string;
let vehicleId: string;
let bookingId: string;
let monthOne: string;
let monthTwo: string;

function day(offset: number): Date {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offset);
  date.setUTCHours(10, 0, 0, 0);
  return date;
}

const actor = { id: null, email: 'test', role: 'ADMIN' as const };

beforeAll(async () => {
  const staff = await createUser({ role: 'STAFF' });
  const customer = await createUser({ role: 'CUSTOMER' });
  createdEmails.push(staff.email, customer.email);
  staffToken = await loginAndGetToken(app, staff.email);
  customerId = customer.id;

  const category = await prisma.vehicleCategory.findFirstOrThrow({ where: { isActive: true } });
  const vehicle = await prisma.vehicle.create({
    data: {
      brand: 'Monthly',
      model: 'InvoiceCar',
      year: 2024,
      registrationNumber: `MIV-${Date.now().toString().slice(-8)}`,
      categoryId: category.id,
      seats: 5,
      transmission: 'AUTOMATIC',
      fuelType: 'PETROL',
      dailyPrice: '300.00',
      securityDeposit: '2000.00',
    },
  });
  vehicleId = vehicle.id;

  const booking = await prisma.booking.create({
    data: {
      bookingNumber: `MIV-${Date.now()}`,
      vehicleId,
      customerId,
      pickupAt: day(800),
      returnAt: day(860),
      status: 'ACTIVE',
      rentalDays: 60,
      vehicleSubtotal: '12000.00',
      totalAmount: '12600.00',
      taxAmount: '600.00',
      securityDeposit: '2000.00',
      billingCycle: 'MONTHLY',
      termMonths: 2,
    },
  });
  bookingId = booking.id;

  const first = await prisma.rentalInstalment.create({
    data: {
      bookingId,
      sequence: 1,
      periodStart: day(800),
      periodEnd: day(830),
      dueAt: day(800),
      amount: '6300.00',
      subtotal: '6000.00',
      taxAmount: '300.00',
      status: 'PAID',
      paidAt: new Date(),
    },
  });
  monthOne = first.id;

  const second = await prisma.rentalInstalment.create({
    data: {
      bookingId,
      sequence: 2,
      periodStart: day(830),
      periodEnd: day(860),
      dueAt: day(830),
      amount: '6300.00',
      subtotal: '6000.00',
      taxAmount: '300.00',
      status: 'DUE',
    },
  });
  monthTwo = second.id;

  // Salik that rode along on month one, the way finesService bills it.
  await prisma.additionalCharge.create({
    data: {
      bookingId,
      instalmentId: monthOne,
      type: 'OTHER',
      amount: '30.00',
      description: 'Toll charge (Al Safa) - billed with month 1',
      status: 'PENDING',
    },
  });
});

afterAll(async () => {
  const invoices = await prisma.invoice.findMany({ where: { bookingId }, select: { id: true } });
  await prisma.invoiceLineItem.deleteMany({
    where: { invoiceId: { in: invoices.map((invoice) => invoice.id) } },
  });
  await prisma.invoice.deleteMany({ where: { bookingId } });
  await prisma.additionalCharge.deleteMany({ where: { bookingId } });
  await prisma.rentalInstalment.deleteMany({ where: { bookingId } });
  await prisma.booking.deleteMany({ where: { id: bookingId } });
  await prisma.vehicle.deleteMany({ where: { id: vehicleId } });
  await cleanupUsers(createdEmails);
  await disconnectPrisma();
});

describe('one invoice per month', () => {
  it('invoices a paid month, with its rent and its extras', async () => {
    const invoice = await invoicesService.issueForInstalment(monthOne, actor);

    expect(invoice.instalmentId).toBe(monthOne);
    expect(invoice.status).toBe('PAID');

    // 6,000 rent + 30 Salik, before that month's own tax.
    expect(invoice.subtotal.toFixed(2)).toBe('6030.00');
    expect(invoice.taxTotal.toFixed(2)).toBe('300.00');
    expect(invoice.total.toFixed(2)).toBe('6330.00');

    const lines = await prisma.invoiceLineItem.findMany({
      where: { invoiceId: invoice.id },
      orderBy: { sortOrder: 'asc' },
    });

    expect(lines).toHaveLength(2);
    // The period is named. "Rental" repeated six times on a statement is not
    // an accounting record.
    expect(lines[0]!.description).toContain('month 1');
    expect(lines[1]!.description).toContain('Al Safa');
  });

  it('marks the extras as invoiced, so they stop reading as owing', async () => {
    const charge = await prisma.additionalCharge.findFirstOrThrow({
      where: { instalmentId: monthOne },
    });
    expect(charge.status).toBe('INVOICED');
  });

  it('REFUSES to invoice the same month twice', async () => {
    await expect(invoicesService.issueForInstalment(monthOne, actor)).rejects.toThrow(
      /already invoiced/i,
    );
  });

  it('REFUSES to invoice a month that has not been paid', async () => {
    // The tax point is settlement. Invoicing in advance declares VAT on money
    // that has not arrived and might never - a long-term rental can be ended
    // mid-term.
    await expect(invoicesService.issueForInstalment(monthTwo, actor)).rejects.toThrow(
      /has not been paid/i,
    );
  });

  it('gives each month its own number', async () => {
    await prisma.rentalInstalment.update({
      where: { id: monthTwo },
      data: { status: 'PAID', paidAt: new Date() },
    });

    const second = await invoicesService.issueForInstalment(monthTwo, actor);
    const first = await prisma.invoice.findFirstOrThrow({ where: { instalmentId: monthOne } });

    expect(second.invoiceNumber).not.toBe(first.invoiceNumber);
    expect(await prisma.invoice.count({ where: { bookingId } })).toBe(2);
  });
});

describe('the whole-booking path', () => {
  it('REFUSES a monthly rental, and says where to go instead', async () => {
    const res = await request(app)
      .post(`${API}/invoices`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ bookingId });

    expect(res.status).toBe(409);
    // One document for a six-month term would collapse six tax points into
    // one period.
    expect(res.body.message).toMatch(/each month is invoiced on its own/i);
  });
});
