/**
 * tests/deposits.test.ts
 * ---------------------------------------------------------------------------
 * The security deposit ledger.
 *
 * ===========================================================================
 * WHY THIS MODULE NEEDED TESTS MOST
 * ===========================================================================
 * A deposit is the only place in this system holding money that BELONGS TO
 * SOMEBODY ELSE. Every other figure is ours to be wrong about internally; this
 * one gets refunded to a real person who counted it.
 *
 * The ledger is append-only - holds, deductions and releases as rows, with the
 * balance derived from them rather than stored. That is the right design and
 * it has one failure mode worth guarding hard: an arithmetic path that lets
 * the derived balance go negative, or lets the same money leave twice. None of
 * that was covered by a single test before this file.
 *
 * So these are arithmetic and boundary tests, not happy-path coverage:
 *   - deducting more than is held
 *   - releasing more than remains
 *   - deducting after release
 *   - whether the balance still reconciles after a mixed sequence
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { prisma, disconnectPrisma } from '../src/config/prisma';
import { API, cleanupUsers, createUser, loginAndGetToken } from './helpers';

const app = createApp();
const createdEmails: string[] = [];

let staffToken: string;
let customerToken: string;
let otherCustomerToken: string;
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
  const customer = await createUser({ role: 'CUSTOMER' });
  const other = await createUser({ role: 'CUSTOMER' });
  createdEmails.push(staff.email, customer.email, other.email);

  staffToken = await loginAndGetToken(app, staff.email);
  customerToken = await loginAndGetToken(app, customer.email);
  otherCustomerToken = await loginAndGetToken(app, other.email);
  customerId = customer.id;

  const category = await prisma.vehicleCategory.findFirstOrThrow({ where: { isActive: true } });
  const vehicle = await prisma.vehicle.create({
    data: {
      brand: 'Deposit',
      model: 'TestCar',
      year: 2024,
      registrationNumber: `DEP-${Date.now().toString().slice(-8)}`,
      categoryId: category.id,
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
  const bookings = await prisma.booking.findMany({ where: { vehicleId }, select: { id: true } });
  const ids = bookings.map((booking) => booking.id);

  await prisma.depositTransaction.deleteMany({ where: { deposit: { bookingId: { in: ids } } } });
  await prisma.securityDeposit.deleteMany({ where: { bookingId: { in: ids } } });
  await prisma.additionalCharge.deleteMany({ where: { bookingId: { in: ids } } });
  await prisma.bookingStatusHistory.deleteMany({ where: { bookingId: { in: ids } } });
  await prisma.booking.deleteMany({ where: { id: { in: ids } } });
  await prisma.vehicle.deleteMany({ where: { id: vehicleId } });
  await cleanupUsers(createdEmails);
  await disconnectPrisma();
});

/** A returned rental with `amount` held on the ledger. */
async function bookingWithDeposit(amount: string) {
  bookingSeq += 1;
  const offset = 400 + bookingSeq * 10;

  const booking = await prisma.booking.create({
    data: {
      bookingNumber: `DEP-${Date.now()}-${bookingSeq}`,
      vehicleId,
      customerId,
      pickupAt: day(offset),
      returnAt: day(offset + 5),
      status: 'RETURNED',
      rentalDays: 5,
      vehicleSubtotal: '1000.00',
      totalAmount: '1000.00',
      securityDeposit: amount,
    },
  });

  const deposit = await prisma.securityDeposit.create({
    data: { bookingId: booking.id, amount, status: 'HELD', heldAt: new Date() },
  });
  await prisma.depositTransaction.create({
    data: { depositId: deposit.id, type: 'HOLD', amount, reason: 'Test hold' },
  });

  return booking.id;
}

const read = async (bookingId: string) => {
  const res = await request(app)
    .get(`${API}/deposits/booking/${bookingId}`)
    .set('Authorization', `Bearer ${staffToken}`);
  return res.body.data.deposit as {
    status: string;
    amount: string;
    held: string;
    deducted: string;
    released: string;
    balance: string;
  };
};

const deduct = (bookingId: string, amount: string, category = 'DAMAGE') =>
  request(app)
    .post(`${API}/deposits/booking/${bookingId}/deduct`)
    .set('Authorization', `Bearer ${staffToken}`)
    .send({ amount, category, reason: 'Test deduction' });

const release = (bookingId: string, body: Record<string, unknown> = {}) =>
  request(app)
    .post(`${API}/deposits/booking/${bookingId}/release`)
    .set('Authorization', `Bearer ${staffToken}`)
    .send(body);

describe('the ledger adds up', () => {
  it('starts with everything held and nothing spent', async () => {
    const bookingId = await bookingWithDeposit('1000.00');
    const deposit = await read(bookingId);

    expect(deposit.held).toBe('1000.00');
    expect(deposit.deducted).toBe('0.00');
    expect(deposit.released).toBe('0.00');
    expect(deposit.balance).toBe('1000.00');
  });

  it('reconciles after a mixed sequence of deductions and a release', async () => {
    const bookingId = await bookingWithDeposit('1000.00');

    expect((await deduct(bookingId, '150.00', 'DAMAGE')).status).toBe(200);
    expect((await deduct(bookingId, '75.50', 'TRAFFIC_FINE')).status).toBe(200);
    expect((await release(bookingId, { amount: '200.00' })).status).toBe(200);

    const deposit = await read(bookingId);

    // held - deducted - released, to the fils. The balance is DERIVED, so
    // this is the one assertion that catches an arithmetic slip anywhere in
    // the chain.
    expect(deposit.deducted).toBe('225.50');
    expect(deposit.released).toBe('200.00');
    expect(deposit.balance).toBe('574.50');
    expect(deposit.status).toBe('PARTIALLY_RELEASED');
  });

  it('closes the deposit when the last of it is released', async () => {
    const bookingId = await bookingWithDeposit('500.00');
    await deduct(bookingId, '100.00');

    const res = await release(bookingId); // No amount = whatever is left.
    expect(res.status).toBe(200);

    const deposit = await read(bookingId);
    expect(deposit.balance).toBe('0.00');
    expect(deposit.released).toBe('400.00');
    expect(deposit.status).toBe('RELEASED');
  });
});

describe('money cannot leave twice', () => {
  it('REFUSES a deduction larger than the balance', async () => {
    const bookingId = await bookingWithDeposit('300.00');

    const res = await deduct(bookingId, '300.01');

    // A negative deposit is a number that has to be explained to a customer
    // later. The excess becomes an invoice instead, which the message says.
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/only 300\.00/i);

    expect((await read(bookingId)).balance).toBe('300.00');
  });

  it('REFUSES a release larger than what remains', async () => {
    const bookingId = await bookingWithDeposit('300.00');
    await deduct(bookingId, '250.00');

    const res = await release(bookingId, { amount: '100.00' });

    expect(res.status).toBe(400);
    expect((await read(bookingId)).balance).toBe('50.00');
  });

  it('REFUSES a second full release', async () => {
    const bookingId = await bookingWithDeposit('200.00');
    expect((await release(bookingId)).status).toBe(200);

    const second = await release(bookingId);
    expect(second.status).toBe(409);
  });

  it('REFUSES a deduction once the deposit has been returned', async () => {
    const bookingId = await bookingWithDeposit('200.00');
    await release(bookingId);

    const res = await deduct(bookingId, '10.00');

    // The customer has their money back. Taking more is a conversation, not
    // a database write.
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/already been settled/i);
  });

  it('REFUSES zero and negative amounts', async () => {
    const bookingId = await bookingWithDeposit('200.00');

    expect((await deduct(bookingId, '0')).status).toBe(400);
    expect((await deduct(bookingId, '-50.00')).status).toBe(400);
    expect((await read(bookingId)).balance).toBe('200.00');
  });

  it('REFUSES a deduction with no reason given', async () => {
    const bookingId = await bookingWithDeposit('200.00');

    const res = await request(app)
      .post(`${API}/deposits/booking/${bookingId}/deduct`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ amount: '50.00', category: 'DAMAGE', reason: '   ' });

    // Every fils taken from somebody's deposit has to be explainable later.
    expect(res.status).toBe(400);
  });
});

describe('who can see and touch a deposit', () => {
  it('lets the customer read their own', async () => {
    const bookingId = await bookingWithDeposit('400.00');

    const res = await request(app)
      .get(`${API}/deposits/booking/${bookingId}`)
      .set('Authorization', `Bearer ${customerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.deposit.balance).toBe('400.00');
  });

  it('HIDES it from a different customer', async () => {
    const bookingId = await bookingWithDeposit('400.00');

    const res = await request(app)
      .get(`${API}/deposits/booking/${bookingId}`)
      .set('Authorization', `Bearer ${otherCustomerToken}`);

    // 404, not 403: confirming the booking exists is itself a small leak.
    expect(res.status).toBe(404);
  });

  it('REFUSES a customer trying to deduct or release', async () => {
    const bookingId = await bookingWithDeposit('400.00');

    const deducted = await request(app)
      .post(`${API}/deposits/booking/${bookingId}/deduct`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ amount: '10.00', category: 'DAMAGE', reason: 'Nope' });

    const released = await request(app)
      .post(`${API}/deposits/booking/${bookingId}/release`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send();

    expect(deducted.status).toBe(403);
    expect(released.status).toBe(403);
  });

  it('REFUSES anonymous access outright', async () => {
    const bookingId = await bookingWithDeposit('400.00');

    const res = await request(app).get(`${API}/deposits/booking/${bookingId}`);
    expect(res.status).toBe(401);
  });
});

describe('a booking with no deposit', () => {
  it('says so rather than inventing an empty one', async () => {
    bookingSeq += 1;
    const booking = await prisma.booking.create({
      data: {
        bookingNumber: `DEP-NONE-${Date.now()}`,
        vehicleId,
        customerId,
        pickupAt: day(900),
        returnAt: day(905),
        status: 'RETURNED',
        rentalDays: 5,
        vehicleSubtotal: '500.00',
        totalAmount: '500.00',
        securityDeposit: '0.00',
      },
    });

    const res = await request(app)
      .get(`${API}/deposits/booking/${booking.id}`)
      .set('Authorization', `Bearer ${staffToken}`);

    expect(res.status).toBe(200);
    // Null, not a zeroed deposit: "nothing was ever held" and "everything has
    // been returned" are different facts, and a refund screen must not
    // confuse them.
    expect(res.body.data.deposit).toBeNull();

    const deducted = await deduct(booking.id, '10.00');
    expect(deducted.status).toBe(404);
  });
});
