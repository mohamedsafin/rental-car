/**
 * tests/fleet-settlement.test.ts
 * ---------------------------------------------------------------------------
 * Two ways a Salik crossing reaches the customer, and the safety net for the
 * case where it has not reached anybody yet.
 *
 *  1. LONG-TERM: it rides on the next unpaid month. The deposit is not
 *     touched, and the month's payment must then ASK FOR IT - a charge added
 *     to an invoice that still collects the old figure is a charge written off
 *     by accident.
 *
 *  2. SHORT: the counter needs to know, before the deposit goes back, what is
 *     outstanding and how much of the rental no statement has covered.
 *
 * The first of these is the one worth testing hardest. It has two halves in
 * two modules - fleet says "bill it with month N", payments decides what month
 * N costs - and nothing else would notice if they stopped agreeing.
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
let customerToken: string;
let customerId: string;
let vehicleId: string;

/** Far-out offsets so this suite cannot collide with another one's windows. */
function day(offset: number, hour = 9): Date {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offset);
  date.setUTCHours(hour, 0, 0, 0);
  return date;
}

let bookingSeq = 0;
let crossingSeq = 0;

beforeAll(async () => {
  const staff = await createUser({ role: 'STAFF' });
  const admin = await createUser({ role: 'ADMIN' });
  const customer = await createUser({ role: 'CUSTOMER' });
  createdEmails.push(staff.email, admin.email, customer.email);

  staffToken = await loginAndGetToken(app, staff.email);
  adminToken = await loginAndGetToken(app, admin.email);
  customerToken = await loginAndGetToken(app, customer.email);
  customerId = customer.id;

  const category = await prisma.vehicleCategory.findFirst({ where: { isActive: true } });
  const vehicle = await prisma.vehicle.create({
    data: {
      brand: 'Settle',
      model: 'TestCar',
      year: 2024,
      registrationNumber: `STL-${Date.now().toString().slice(-8)}`,
      categoryId: category!.id,
      seats: 5,
      transmission: 'AUTOMATIC',
      fuelType: 'PETROL',
      dailyPrice: '250.00',
      securityDeposit: '1500.00',
      currentMileage: 10_000,
    },
  });
  vehicleId = vehicle.id;
});

afterAll(async () => {
  const bookingIds = (
    await prisma.booking.findMany({ where: { vehicleId }, select: { id: true } })
  ).map((booking) => booking.id);

  await prisma.payment.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.rentalInstalment.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.depositTransaction.deleteMany({
    where: { deposit: { bookingId: { in: bookingIds } } },
  });
  await prisma.securityDeposit.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.additionalCharge.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.tollCharge.deleteMany({ where: { vehicleId } });
  await prisma.trafficFine.deleteMany({ where: { vehicleId } });
  await prisma.bookingStatusHistory.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
  await prisma.vehicle.deleteMany({ where: { id: vehicleId } });
  await cleanupUsers(createdEmails);
  await disconnectPrisma();
});

/**
 * A booking with a deposit held, built directly rather than driven through
 * the API: this suite is about what happens to charges, not about how a
 * booking is made, and the windows have to be controlled to the hour.
 */
async function bookingWith(options: {
  monthly: boolean;
  pickup: Date;
  ret: Date;
  deposit?: string;
  status?: 'ACTIVE' | 'COMPLETED';
}) {
  bookingSeq += 1;
  const deposit = options.deposit ?? '1500.00';

  const booking = await prisma.booking.create({
    data: {
      bookingNumber: `STL-${Date.now()}-${bookingSeq}`,
      vehicleId,
      customerId,
      pickupAt: options.pickup,
      returnAt: options.ret,
      status: options.status ?? 'ACTIVE',
      rentalDays: Math.max(
        Math.round((options.ret.getTime() - options.pickup.getTime()) / 86_400_000),
        1,
      ),
      vehicleSubtotal: '6000.00',
      totalAmount: '6000.00',
      securityDeposit: deposit,
      billingCycle: options.monthly ? 'MONTHLY' : 'UPFRONT',
      termMonths: options.monthly ? 2 : null,
    },
  });

  const held = await prisma.securityDeposit.create({
    data: { bookingId: booking.id, amount: deposit, status: 'HELD', heldAt: new Date() },
  });
  await prisma.depositTransaction.create({
    data: { depositId: held.id, type: 'HOLD', amount: deposit, reason: 'Test hold' },
  });

  if (options.monthly) {
    // Month 1 already settled, month 2 outstanding: the interesting case,
    // because a charge must land on the UNPAID month and not the paid one.
    await prisma.rentalInstalment.createMany({
      data: [
        {
          bookingId: booking.id,
          sequence: 1,
          periodStart: options.pickup,
          periodEnd: day(0),
          dueAt: options.pickup,
          amount: '3000.00',
          subtotal: '3000.00',
          status: 'PAID',
          paidAt: new Date(),
        },
        {
          bookingId: booking.id,
          sequence: 2,
          periodStart: day(0),
          periodEnd: options.ret,
          dueAt: day(0),
          amount: '3000.00',
          subtotal: '3000.00',
          status: 'DUE',
        },
      ],
    });
  }

  return booking.id;
}

/**
 * A car of this suite's own.
 *
 * Anything that measures HOW FAR THE TOLL DATA REACHES has to own its vehicle:
 * the reading is the newest crossing on that car, so one crossing recorded by
 * another test - at any date at all - silently changes the answer. That is
 * exactly how this suite broke once.
 */
async function spareVehicle(tag: string) {
  const category = await prisma.vehicleCategory.findFirst({ where: { isActive: true } });
  return prisma.vehicle.create({
    data: {
      brand: 'Settle',
      model: tag,
      year: 2024,
      registrationNumber: `${tag.slice(0, 3).toUpperCase()}-${Date.now().toString().slice(-8)}`,
      categoryId: category!.id,
      seats: 5,
      transmission: 'AUTOMATIC',
      fuelType: 'PETROL',
      dailyPrice: '250.00',
      securityDeposit: '1000.00',
    },
  });
}

/** A toll inside the booking's window, pinned to it. */
async function tollOn(
  bookingId: string,
  amount: string,
  serviceFee = '0.00',
  at?: Date,
  onVehicle?: string,
) {
  const crossedAt = at ?? new Date(day(-2).getTime() + crossingSeq * 60_000);
  crossingSeq += 1;

  const response = await request(app)
    .post(`${API}/fleet/tolls`)
    .set('Authorization', `Bearer ${staffToken}`)
    .send({
      vehicleId: onVehicle ?? vehicleId,
      crossedAt: crossedAt.toISOString(),
      gate: 'Al Safa',
      amount,
      serviceFee,
    });

  expect(response.status).toBe(201);
  const id = response.body.data.toll.id as string;
  await prisma.tollCharge.update({ where: { id }, data: { bookingId, status: 'ASSIGNED' } });
  return id;
}

describe('A charge on a long-term rental goes on the invoice, not the deposit', () => {
  let bookingId: string;
  let tollId: string;

  beforeAll(async () => {
    bookingId = await bookingWith({ monthly: true, pickup: day(-40), ret: day(20) });
    tollId = await tollOn(bookingId, '24.00', '6.00');
  });

  it('bills it with the next UNPAID month and leaves the deposit alone', async () => {
    const response = await request(app)
      .post(`${API}/fleet/tolls/${tollId}/recover`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send();

    expect(response.status).toBe(201);
    // Month 1 is paid, so it has to be month 2.
    expect(response.body.data.billedWithInstalment).toBe(2);
    expect(response.body.data.recoveredFromDeposit).toBe('0.00');
    expect(response.body.data.amount).toBe('30.00');

    const deposit = await prisma.securityDeposit.findUniqueOrThrow({ where: { bookingId } });
    const deductions = await prisma.depositTransaction.count({
      where: { depositId: deposit.id, type: 'DEDUCTION' },
    });
    // The whole point: the money for a dented door is still all there.
    expect(deductions).toBe(0);
  });

  it('adds it to that month, and the month knows what it is', async () => {
    const month2 = await prisma.rentalInstalment.findFirstOrThrow({
      where: { bookingId, sequence: 2 },
      include: { charges: true },
    });

    expect(month2.extrasAmount.toFixed(2)).toBe('30.00');
    expect(month2.amount.toFixed(2)).toBe('3000.00'); // The rent never moves.
    expect(month2.charges).toHaveLength(1);
    expect(month2.charges[0]!.description).toContain('month 2');
  });

  it('ASKS FOR the extras when that month is paid', async () => {
    const response = await request(app)
      .post(`${API}/payments/initiate`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ bookingId, type: 'RENTAL' });

    expect(response.status).toBe(201);
    // 3000 rent + 30 toll. Collecting 3000.00 here would silently write the
    // charge off while marking the month paid.
    expect(response.body.data.amount).toBe('3030.00');
  });

  it('shows the customer the split on their booking', async () => {
    const response = await request(app)
      .get(`${API}/bookings/${bookingId}`)
      .set('Authorization', `Bearer ${customerToken}`);

    expect(response.status).toBe(200);
    const month2 = response.body.data.booking.instalments.find(
      (row: { sequence: number }) => row.sequence === 2,
    );
    expect(month2.amount).toBe('3000.00');
    expect(month2.extrasAmount).toBe('30.00');
    expect(month2.totalDue).toBe('3030.00');
  });
});

/*
 * Attaching by hand.
 *
 * The timestamp match is right most of the time and silent when it is wrong,
 * and an unattached charge is one the company pays. These tests are about the
 * escape hatch - and about the one thing it must never allow, which is billing
 * a fine to somebody who was never in that car.
 */
describe('Attaching a charge to a rental by hand', () => {
  let bookingId: string;
  let strayTollId: string;

  beforeAll(async () => {
    bookingId = await bookingWith({
      monthly: false,
      pickup: day(200),
      ret: day(206),
      status: 'ACTIVE',
    });

    // A crossing LONG before that rental: nothing will have matched it, which
    // is exactly the row staff are left staring at.
    const response = await request(app)
      .post(`${API}/fleet/tolls`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        vehicleId,
        crossedAt: day(202).toISOString(),
        gate: 'Al Garhoud',
        amount: '4.00',
      });
    expect(response.status).toBe(201);
    strayTollId = response.body.data.toll.id as string;
    // Force it loose, whatever the timestamp happened to match.
    await prisma.tollCharge.update({
      where: { id: strayTollId },
      data: { bookingId: null, status: 'RECORDED' },
    });
  });

  it("offers this car's rentals, and marks the one that covers the moment", async () => {
    const response = await request(app)
      .get(`${API}/fleet/tolls/${strayTollId}/booking-options`)
      .set('Authorization', `Bearer ${staffToken}`);

    expect(response.status).toBe(200);
    const options = response.body.data.options as {
      id: string;
      hadTheCar: boolean;
      bookedOverIt: boolean;
      neverHandedOver: boolean;
      customerName: string;
    }[];

    expect(options.length).toBeGreaterThan(0);
    const offered = options.find((option) => option.id === bookingId);
    expect(offered).toBeDefined();
    expect(offered!.customerName).toBeTruthy();
    // Booked over that moment - but no handover was ever recorded, and the
    // picker must not dress paperwork up as evidence of who was driving.
    expect(offered!.bookedOverIt).toBe(true);
    expect(offered!.neverHandedOver).toBe(true);
    expect(offered!.hadTheCar).toBe(false);
  });

  it('attaching also marks it assigned, so the Recover button can appear', async () => {
    const response = await request(app)
      .patch(`${API}/fleet/tolls/${strayTollId}`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ bookingId });

    expect(response.status).toBe(200);

    const toll = await prisma.tollCharge.findUniqueOrThrow({ where: { id: strayTollId } });
    expect(toll.bookingId).toBe(bookingId);
    // It used to stay RECORDED - which reads as "nobody is responsible" - and
    // the recover action stayed hidden even though the work had been done.
    expect(toll.status).toBe('ASSIGNED');
  });

  it('REFUSES a booking for a different car', async () => {
    // Somebody else's rental, on somebody else's vehicle.
    const category = await prisma.vehicleCategory.findFirst({ where: { isActive: true } });
    const otherCar = await prisma.vehicle.create({
      data: {
        brand: 'Settle',
        model: 'OtherCar',
        year: 2024,
        registrationNumber: `STO-${Date.now().toString().slice(-8)}`,
        categoryId: category!.id,
        seats: 5,
        transmission: 'AUTOMATIC',
        fuelType: 'PETROL',
        dailyPrice: '200.00',
        securityDeposit: '1000.00',
      },
    });
    const otherBooking = await prisma.booking.create({
      data: {
        bookingNumber: `STO-${Date.now()}`,
        vehicleId: otherCar.id,
        customerId,
        pickupAt: day(300),
        returnAt: day(305),
        status: 'ACTIVE',
        rentalDays: 5,
        vehicleSubtotal: '1000.00',
        totalAmount: '1000.00',
        securityDeposit: '1000.00',
      },
    });

    const response = await request(app)
      .patch(`${API}/fleet/tolls/${strayTollId}`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ bookingId: otherBooking.id });

    // The whole point: this would have billed a customer for a car they were
    // never in, and only an audit row nobody reads would have recorded it.
    expect(response.status).toBe(400);
    expect(response.body.message).toContain('different vehicle');

    await prisma.booking.delete({ where: { id: otherBooking.id } });
    await prisma.vehicle.delete({ where: { id: otherCar.id } });
  });

  it("never offers another car's rental in the first place", async () => {
    const response = await request(app)
      .get(`${API}/fleet/tolls/${strayTollId}/booking-options`)
      .set('Authorization', `Bearer ${staffToken}`);

    const options = response.body.data.options as { id: string }[];
    const ids = options.map((option) => option.id);
    const foreign = await prisma.booking.findMany({
      where: { vehicleId: { not: vehicleId }, id: { in: ids } },
      select: { id: true },
    });
    expect(foreign).toHaveLength(0);
  });
});

/*
 * WHO WAS DRIVING.
 *
 * A real failure, reproduced: one car, two bookings whose dates overlap - one
 * of them never even collected - and a fine billed to whichever row the
 * database happened to return first. The customer who was demonstrably driving
 * was not the one charged.
 */
describe('Deciding who had the car', () => {
  it('believes the handover record over the contract dates', async () => {
    const car = await spareVehicle('WhoCar');

    // The stale one: booked over the date, marked completed, never collected.
    const neverCollected = await prisma.booking.create({
      data: {
        bookingNumber: `WHO-A-${Date.now()}`,
        vehicleId: car.id,
        customerId,
        pickupAt: day(400),
        returnAt: day(420),
        status: 'COMPLETED',
        rentalDays: 20,
        vehicleSubtotal: '4000.00',
        totalAmount: '4000.00',
        securityDeposit: '1000.00',
      },
    });

    // The real one: overlapping dates, and the car was actually signed out.
    const actuallyDriving = await prisma.booking.create({
      data: {
        bookingNumber: `WHO-B-${Date.now()}`,
        vehicleId: car.id,
        customerId,
        pickupAt: day(410),
        returnAt: day(440),
        status: 'ACTIVE',
        rentalDays: 30,
        vehicleSubtotal: '6000.00',
        totalAmount: '6000.00',
        securityDeposit: '1000.00',
      },
    });
    await prisma.rental.create({
      data: {
        bookingId: actuallyDriving.id,
        pickedUpAt: day(410),
        pickupMileage: 1000,
        pickupFuelPercent: 100,
        status: 'ACTIVE',
      },
    });

    const response = await request(app)
      .post(`${API}/fleet/fines`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        vehicleId: car.id,
        fineNumber: `WHO-${Date.now()}`,
        violationAt: day(415).toISOString(),
        violation: 'overspeed',
        amount: '100.00',
      });

    expect(response.status).toBe(201);
    // Paperwork said both. Only one of them was ever handed the keys.
    expect(response.body.data.matchedCustomer?.bookingNumber).toBe(actuallyDriving.bookingNumber);
    expect(response.body.data.ambiguousBetween).toHaveLength(0);

    await prisma.trafficFine.deleteMany({ where: { vehicleId: car.id } });
    await prisma.rental.deleteMany({
      where: { bookingId: { in: [neverCollected.id, actuallyDriving.id] } },
    });
    await prisma.booking.deleteMany({ where: { id: { in: [neverCollected.id, actuallyDriving.id] } } });
    await prisma.vehicle.delete({ where: { id: car.id } });
  });

  it('attaches NOTHING when two rentals genuinely both cover the moment', async () => {
    const car = await spareVehicle('TwoCar');

    // Two bookings, neither with a handover record: nothing to tell them apart.
    // Both RETURNED - still open to charges, so the ambiguity is real rather
    // than both simply being closed.
    const first = await prisma.booking.create({
      data: {
        bookingNumber: `TWO-A-${Date.now()}`,
        vehicleId: car.id,
        customerId,
        pickupAt: day(500),
        returnAt: day(520),
        status: 'RETURNED',
        rentalDays: 20,
        vehicleSubtotal: '4000.00',
        totalAmount: '4000.00',
        securityDeposit: '1000.00',
      },
    });
    const second = await prisma.booking.create({
      data: {
        bookingNumber: `TWO-B-${Date.now()}`,
        vehicleId: car.id,
        customerId,
        pickupAt: day(510),
        returnAt: day(530),
        status: 'RETURNED',
        rentalDays: 20,
        vehicleSubtotal: '4000.00',
        totalAmount: '4000.00',
        securityDeposit: '1000.00',
      },
    });

    const response = await request(app)
      .post(`${API}/fleet/fines`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        vehicleId: car.id,
        fineNumber: `TWO-${Date.now()}`,
        violationAt: day(515).toISOString(),
        violation: 'overspeed',
        amount: '100.00',
      });

    expect(response.status).toBe(201);
    // Guessing here is how the wrong customer gets billed. It says so instead.
    expect(response.body.data.matchedCustomer).toBeNull();
    expect(response.body.data.ambiguousBetween).toHaveLength(2);
    expect(response.body.data.fine.bookingId ?? null).toBeNull();

    await prisma.trafficFine.deleteMany({ where: { vehicleId: car.id } });
    await prisma.booking.deleteMany({ where: { id: { in: [first.id, second.id] } } });
    await prisma.vehicle.delete({ where: { id: car.id } });
  });
});

/*
 * COMPLETED MEANS CLOSED.
 *
 * The owner's rule: clicking completed ends the rental, nothing more is
 * charged to it, and the car is free for the next customer. So every route a
 * charge could take to a booking has to stop at that line - recovering,
 * attaching by hand, automatic matching, and the statement import.
 */
describe('a completed rental takes no further charges', () => {
  let closedBooking: string;
  let tollId: string;

  beforeAll(async () => {
    closedBooking = await bookingWith({
      monthly: false,
      pickup: day(600),
      ret: day(606),
      status: 'COMPLETED',
    });
    tollId = await tollOn(closedBooking, '40.00', '0.00', day(602));
  });

  it('REFUSES to recover a charge from it', async () => {
    const response = await request(app)
      .post(`${API}/fleet/tolls/${tollId}/recover`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send();

    expect(response.status).toBe(409);
    expect(response.body.message).toContain('closed');

    // And nothing came out of the deposit on the way to refusing.
    const deposit = await prisma.securityDeposit.findUniqueOrThrow({
      where: { bookingId: closedBooking },
    });
    const deductions = await prisma.depositTransaction.count({
      where: { depositId: deposit.id, type: 'DEDUCTION' },
    });
    expect(deductions).toBe(0);
  });

  it('REFUSES to attach a new charge to it', async () => {
    const loose = await request(app)
      .post(`${API}/fleet/tolls`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        vehicleId,
        crossedAt: day(604).toISOString(),
        gate: 'Al Garhoud',
        amount: '4.00',
      });
    expect(loose.status).toBe(201);

    const response = await request(app)
      .patch(`${API}/fleet/tolls/${loose.body.data.toll.id}`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ bookingId: closedBooking });

    expect(response.status).toBe(409);
    expect(response.body.message).toContain('closed');
  });

  it('does not match a new charge to it automatically', async () => {
    const response = await request(app)
      .post(`${API}/fleet/fines`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        vehicleId,
        fineNumber: `CLOSED-${Date.now()}`,
        // Squarely inside the closed rental's dates.
        violationAt: day(603).toISOString(),
        violation: 'overspeed',
        amount: '100.00',
      });

    expect(response.status).toBe(201);
    // The company absorbs it. That is the cost of closing a booking, and the
    // settlement check at RETURNED is where it was meant to be caught.
    expect(response.body.data.matchedCustomer).toBeNull();
    expect(response.body.data.fine.bookingId ?? null).toBeNull();
  });

  it('still SHOWS what was left unsettled on it', async () => {
    const response = await request(app)
      .get(`${API}/fleet/bookings/${closedBooking}/settlement-check`)
      .set('Authorization', `Bearer ${staffToken}`);

    expect(response.status).toBe(200);
    // Closed, but not hidden: what was missed is worth being able to see.
    expect(response.body.data.closed).toBe(true);
    expect(response.body.data.outstanding.length).toBeGreaterThan(0);
  });

  it('offers it in the picker as unpickable, rather than silently omitting it', async () => {
    const loose = await request(app)
      .post(`${API}/fleet/tolls`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        vehicleId,
        crossedAt: day(605).toISOString(),
        gate: 'Al Safa',
        amount: '4.00',
      });

    const options = await request(app)
      .get(`${API}/fleet/tolls/${loose.body.data.toll.id}/booking-options`)
      .set('Authorization', `Bearer ${staffToken}`);

    const offered = (options.body.data.options as { id: string; closed: boolean }[]).find(
      (option) => option.id === closedBooking,
    );

    // An empty list teaches nobody anything; "this rental is closed" does.
    expect(offered).toBeDefined();
    expect(offered!.closed).toBe(true);
  });
});

describe('The check before a deposit goes back', () => {
  it('lists what is outstanding on a short rental', async () => {
    const bookingId = await bookingWith({
      monthly: false,
      pickup: day(-5),
      ret: day(-1),
      status: 'COMPLETED',
    });
    await tollOn(bookingId, '12.00', '3.00', new Date(day(-3).getTime() + 5 * 60_000));

    const response = await request(app)
      .get(`${API}/fleet/bookings/${bookingId}/settlement-check`)
      .set('Authorization', `Bearer ${staffToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.outstanding).toHaveLength(1);
    expect(response.body.data.outstandingTotal).toBe('15.00');
    expect(response.body.data.depositBalance).toBe('1500.00');
  });

  it('reports the days no statement has covered, and costs them from real crossings', async () => {
    const car = await spareVehicle('GapCar');
    const booking = await prisma.booking.create({
      data: {
        bookingNumber: `STG-${Date.now()}`,
        vehicleId: car.id,
        customerId,
        pickupAt: day(-8),
        returnAt: day(-1),
        status: 'COMPLETED',
        rentalDays: 7,
        vehicleSubtotal: '1750.00',
        totalAmount: '1750.00',
        securityDeposit: '1000.00',
      },
    });
    const bookingId = booking.id;

    // Two crossings early in the rental; nothing recorded for the last stretch,
    // which is exactly the real-world shape - the statement has not arrived.
    await tollOn(bookingId, '4.00', '0.00', new Date(day(-7).getTime() + 60_000), car.id);
    await tollOn(bookingId, '4.00', '0.00', new Date(day(-6).getTime() + 60_000), car.id);

    const response = await request(app)
      .get(`${API}/fleet/bookings/${bookingId}/settlement-check`)
      .set('Authorization', `Bearer ${staffToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.uncoveredDays).toBeGreaterThan(0);
    // An estimate exists because there is evidence to base it on...
    expect(response.body.data.suggestedHold).not.toBeNull();
    expect(Number(response.body.data.suggestedHold)).toBeGreaterThan(0);
    // ...and it says out loud how it got there.
    expect(response.body.data.suggestionBasis).toContain('day');

    await prisma.tollCharge.deleteMany({ where: { vehicleId: car.id } });
    await prisma.booking.delete({ where: { id: bookingId } });
    await prisma.vehicle.delete({ where: { id: car.id } });
  });

  it('offers NO estimate for a car with no toll history, rather than a guess', async () => {
    // A vehicle of its own, so other suites' crossings cannot lend it a rate.
    const category = await prisma.vehicleCategory.findFirst({ where: { isActive: true } });
    const fresh = await prisma.vehicle.create({
      data: {
        brand: 'Settle',
        model: 'NoTolls',
        year: 2024,
        registrationNumber: `STN-${Date.now().toString().slice(-8)}`,
        categoryId: category!.id,
        seats: 5,
        transmission: 'AUTOMATIC',
        fuelType: 'PETROL',
        dailyPrice: '250.00',
        securityDeposit: '1000.00',
      },
    });

    const booking = await prisma.booking.create({
      data: {
        bookingNumber: `STN-${Date.now()}`,
        vehicleId: fresh.id,
        customerId,
        pickupAt: day(-4),
        returnAt: day(-1),
        status: 'COMPLETED',
        rentalDays: 3,
        vehicleSubtotal: '750.00',
        totalAmount: '750.00',
        securityDeposit: '1000.00',
      },
    });

    const response = await request(app)
      .get(`${API}/fleet/bookings/${booking.id}/settlement-check`)
      .set('Authorization', `Bearer ${staffToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.suggestedHold).toBeNull();
    expect(response.body.data.suggestionBasis).toContain('Salik portal');

    await prisma.booking.delete({ where: { id: booking.id } });
    await prisma.vehicle.delete({ where: { id: fresh.id } });
  });

  it('says nothing to hold on a MONTHLY rental - it is billed, not held', async () => {
    // Far in the future: the vehicle already has a live monthly rental above,
    // and the database refuses two overlapping rentals on one car.
    const bookingId = await bookingWith({ monthly: true, pickup: day(100), ret: day(160) });

    const response = await request(app)
      .get(`${API}/fleet/bookings/${bookingId}/settlement-check`)
      .set('Authorization', `Bearer ${staffToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.billingCycle).toBe('MONTHLY');
    expect(response.body.data.suggestedHold).toBeNull();
  });
});
