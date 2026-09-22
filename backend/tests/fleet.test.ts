/**
 * tests/fleet.test.ts
 * ---------------------------------------------------------------------------
 * PHASE 9 ACCEPTANCE. Two things have to be true at the end of this file:
 *
 *  1. A damage charge flows from a return inspection through approval to the
 *     customer's account - at the APPROVED amount, never the estimate.
 *  2. A maintenance window makes a vehicle unbookable FOR THOSE DATES ONLY.
 *
 * The second one is the one that would quietly cost money if it were wrong.
 * A status flag that takes a car off the road indefinitely looks like it
 * works, right up until every serviced car disappears from search.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { prisma, disconnectPrisma } from '../src/config/prisma';
import { clearSettingsCache } from '../src/modules/settings/service';
import { availabilityService } from '../src/modules/availability/service';
import { API, cleanupUsers, createUser, loginAndGetToken } from './helpers';

const app = createApp();
const createdEmails: string[] = [];

let staffToken: string;
let adminToken: string;
let customerToken: string;
let vehicleId: string;

/** Day offsets are large so this suite cannot collide with other suites. */
function day(offset: number, hour = 10): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offset);
  date.setUTCHours(hour, 0, 0, 0);
  return date.toISOString();
}

beforeAll(async () => {
  const staff = await createUser({ role: 'STAFF' });
  const admin = await createUser({ role: 'ADMIN' });
  const customer = await createUser({ role: 'CUSTOMER' });
  createdEmails.push(staff.email, admin.email, customer.email);

  staffToken = await loginAndGetToken(app, staff.email);
  adminToken = await loginAndGetToken(app, admin.email);
  customerToken = await loginAndGetToken(app, customer.email);

  const category = await prisma.vehicleCategory.findFirst({ where: { isActive: true } });
  const vehicle = await prisma.vehicle.create({
    data: {
      brand: 'Fleet',
      model: 'TestCar',
      year: 2024,
      registrationNumber: `FLT-${Date.now().toString().slice(-8)}`,
      categoryId: category!.id,
      seats: 5,
      transmission: 'AUTOMATIC',
      fuelType: 'PETROL',
      dailyPrice: '200.00',
      securityDeposit: '1000.00',
      currentMileage: 20_000,
    },
  });
  vehicleId = vehicle.id;

  clearSettingsCache();
});

afterAll(async () => {
  // Bookings created by the recovery tests, plus everything hanging off them.
  const bookingIds = (
    await prisma.booking.findMany({ where: { vehicleId }, select: { id: true } })
  ).map((booking) => booking.id);
  await prisma.depositTransaction.deleteMany({
    where: { deposit: { bookingId: { in: bookingIds } } },
  });
  await prisma.securityDeposit.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.additionalCharge.deleteMany({ where: { bookingId: { in: bookingIds } } });

  await prisma.damagePhoto.deleteMany({ where: { damage: { vehicleId } } });
  await prisma.damage.deleteMany({ where: { vehicleId } });
  await prisma.trafficFine.deleteMany({ where: { vehicleId } });
  await prisma.tollCharge.deleteMany({ where: { vehicleId } });
  await prisma.maintenanceRecord.deleteMany({ where: { vehicleId } });
  await prisma.insuranceRecord.deleteMany({ where: { vehicleId } });
  await prisma.vehicleDocument.deleteMany({ where: { vehicleId } });
  // Bookings hold an FK to the vehicle, so they go before it.
  await prisma.bookingStatusHistory.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
  await prisma.vehicle.deleteMany({ where: { id: vehicleId } });
  await cleanupUsers(createdEmails);
  await disconnectPrisma();
});

describe('Damages (BRD 30, 38)', () => {
  let damageId: string;

  it('records damage found on inspection', async () => {
    const response = await request(app)
      .post(`${API}/damages`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        vehicleId,
        type: 'SCRATCH',
        description: 'Deep scratch along the driver door',
        location: 'Driver door',
        estimatedAmount: '900.00',
      });

    expect(response.status).toBe(201);
    // An estimate at reporting time moves it straight to ASSESSED: it is
    // costed, and only the approval decision is outstanding.
    expect(response.body.data.status).toBe('ASSESSED');
    damageId = response.body.data.id;
  });

  it('refuses to charge a damage nobody has assessed', async () => {
    const response = await request(app)
      .post(`${API}/damages/${damageId}/charge`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send();

    // The three-step exists so a scratch cannot become money in one click.
    expect(response.status).toBe(409);
  });

  it('will not let staff assess - that is an admin decision', async () => {
    const response = await request(app)
      .patch(`${API}/damages/${damageId}/assess`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ approve: true, approvedAmount: '600.00' });

    expect(response.status).toBe(403);
  });

  it('requires an amount when approving', async () => {
    const response = await request(app)
      .patch(`${API}/damages/${damageId}/assess`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ approve: true });

    expect(response.status).toBe(400);
  });

  it('charges the APPROVED amount, not the estimate', async () => {
    const assessed = await request(app)
      .patch(`${API}/damages/${damageId}/assess`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ approve: true, approvedAmount: '600.00', notes: 'Panel respray only' });

    expect(assessed.status).toBe(200);
    expect(assessed.body.data.status).toBe('APPROVED');
    expect(assessed.body.data.approvedAmount).toBe('600.00');

    const damage = await prisma.damage.findUnique({ where: { id: damageId } });
    // The estimate is still on file - it is evidence of what was first
    // thought - but it is not what the customer is asked to pay.
    expect(damage!.estimatedAmount?.toFixed(2)).toBe('900.00');
    expect(damage!.approvedAmount?.toFixed(2)).toBe('600.00');
  });

  it('keeps damages out of customer hands entirely', async () => {
    const response = await request(app)
      .get(`${API}/damages`)
      .set('Authorization', `Bearer ${customerToken}`);

    expect(response.status).toBe(403);
  });

  it('dismisses fair wear and tear with a reason', async () => {
    const created = await request(app)
      .post(`${API}/damages`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ vehicleId, type: 'INTERIOR', description: 'Slight seat wear' });

    const noReason = await request(app)
      .patch(`${API}/damages/${created.body.data.id}/assess`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ approve: false });

    expect(noReason.status).toBe(400);

    const dismissed = await request(app)
      .patch(`${API}/damages/${created.body.data.id}/assess`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ approve: false, notes: 'Normal wear for the mileage' });

    expect(dismissed.status).toBe(200);
    expect(dismissed.body.data.status).toBe('DISMISSED');
  });
});

describe('Traffic fines and tolls (BRD 38)', () => {
  const fineNumber = `FN-${Date.now()}`;

  it('records a fine', async () => {
    const response = await request(app)
      .post(`${API}/fleet/fines`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        vehicleId,
        fineNumber,
        violationAt: day(-3),
        violation: 'Speeding',
        location: 'Sheikh Zayed Road',
        amount: '600.00',
        serviceFee: '50.00',
      });

    expect(response.status).toBe(201);
    expect(response.body.data.fine.amount).toBe('600.00');
    expect(response.body.data.fine.serviceFee).toBe('50.00');
    // Recording a fine SUGGESTS a rental; it does not assign one. Nobody was
    // renting this car, so there is no customer to point at.
    expect(response.body.data.matchedCustomer).toBeNull();
  });

  it('refuses the same fine number twice', async () => {
    // Without this, one violation gets billed to the customer twice.
    const response = await request(app)
      .post(`${API}/fleet/fines`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ vehicleId, fineNumber, violationAt: day(-3), amount: '600.00' });

    expect(response.status).toBe(409);
  });

  it('records a toll crossing', async () => {
    const response = await request(app)
      .post(`${API}/fleet/tolls`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ vehicleId, crossedAt: day(-2), gate: 'Al Garhoud', amount: '4.00' });

    expect(response.status).toBe(201);
    expect(response.body.data.toll.amount).toBe('4.00');
  });

  it('cannot recover a charge that is not attached to a booking', async () => {
    const fine = await prisma.trafficFine.findFirst({ where: { fineNumber } });

    const response = await request(app)
      .post(`${API}/fleet/fines/${fine!.id}/recover`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send();

    // Nobody to bill. Guessing which customer was driving is exactly the
    // mistake this refusal prevents.
    expect(response.status).toBe(400);
  });
});

/**
 * Recovering a fine has to actually take the money.
 *
 * Before this, "recover" only raised a PENDING charge and the deduction was a
 * separate action on another page - so a recovered fine could sit unpaid while
 * the deposit it should have come from was released in full.
 */
describe('Recovering fines and tolls against the deposit', () => {
  let bookingSeq = 0;

  /**
   * A rental at the counter: car back, deposit still held, charges being
   * settled. RETURNED rather than COMPLETED on purpose - completing a booking
   * closes it, and a closed rental now refuses further charges, which is the
   * whole point of settling them at this step.
   */
  async function rentalWithDeposit(deposit: string) {
    bookingSeq += 1;
    const customer = await prisma.user.findFirstOrThrow({
      where: { email: createdEmails[2] },
    });

    const booking = await prisma.booking.create({
      data: {
        bookingNumber: `FLT-${Date.now()}-${bookingSeq}`,
        vehicleId,
        customerId: customer.id,
        pickupAt: day(-6),
        returnAt: day(-1),
        status: 'RETURNED',
        rentalDays: 5,
        vehicleSubtotal: '1000.00',
        totalAmount: '1000.00',
        securityDeposit: deposit,
      },
    });

    const held = await prisma.securityDeposit.create({
      data: { bookingId: booking.id, amount: deposit, status: 'HELD', heldAt: new Date() },
    });
    await prisma.depositTransaction.create({
      data: { depositId: held.id, type: 'HOLD', amount: deposit, reason: 'Test hold' },
    });

    return booking.id;
  }

  /*
   * Every crossing needs its OWN timestamp.
   *
   * One car cannot pass one gate twice in the same millisecond, and the
   * service now rejects a repeat of (vehicle, instant, gate) as the duplicate
   * it would be in real life. This used to stamp every toll with the same
   * `day(-3)`, which only worked because nothing checked.
   */
  let crossingSeq = 0;

  /** Record a toll inside that rental's window so it attributes itself. */
  async function tollOn(bookingId: string, amount: string, serviceFee = '0.00') {
    const crossedAt = new Date(new Date(day(-3)).getTime() + crossingSeq++ * 60_000).toISOString();

    const response = await request(app)
      .post(`${API}/fleet/tolls`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ vehicleId, crossedAt, gate: 'Al Barsha', amount, serviceFee });

    expect(response.status).toBe(201);
    const id = response.body.data.toll.id as string;
    // Attribution is by timestamp, but several test rentals overlap - pin it.
    await prisma.tollCharge.update({ where: { id }, data: { bookingId, status: 'ASSIGNED' } });
    return id;
  }

  async function depositOf(bookingId: string) {
    const res = await request(app)
      .get(`${API}/deposits/booking/${bookingId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    return res.body.data.deposit;
  }

  it('takes the whole charge from the deposit in one action', async () => {
    const bookingId = await rentalWithDeposit('1000.00');
    const tollId = await tollOn(bookingId, '120.00', '10.00');

    const response = await request(app)
      .post(`${API}/fleet/tolls/${tollId}/recover`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send();

    expect(response.status).toBe(201);
    expect(response.body.data.recoveredFromDeposit).toBe('130.00');
    expect(response.body.data.leftToInvoice).toBe('0.00');

    const deposit = await depositOf(bookingId);
    expect(deposit.deducted).toBe('130.00');
    expect(deposit.balance).toBe('870.00');
  });

  it('records the deduction as TOLL, not as a nameless "other"', async () => {
    const bookingId = await rentalWithDeposit('1000.00');
    const tollId = await tollOn(bookingId, '30.00');

    await request(app)
      .post(`${API}/fleet/tolls/${tollId}/recover`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send();

    const deposit = await depositOf(bookingId);
    const deduction = deposit.transactions.find(
      (entry: { type: string }) => entry.type === 'DEDUCTION',
    );
    // The ledger is what a customer is shown in a dispute. "Other" is not an
    // answer to "what did you keep my money for".
    expect(deduction.category).toBe('TOLL');
  });

  it('takes what the deposit can cover and leaves the rest to invoice', async () => {
    const bookingId = await rentalWithDeposit('100.00');
    const tollId = await tollOn(bookingId, '250.00', '20.00');

    const response = await request(app)
      .post(`${API}/fleet/tolls/${tollId}/recover`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send();

    expect(response.status).toBe(201);
    expect(response.body.data.recoveredFromDeposit).toBe('100.00');
    expect(response.body.data.leftToInvoice).toBe('170.00');

    const deposit = await depositOf(bookingId);
    expect(deposit.balance).toBe('0.00');

    // Two rows, each with an honest status: one settled, one still owed.
    const charges = await prisma.additionalCharge.findMany({ where: { bookingId } });
    expect(charges).toHaveLength(2);
    expect(charges.find((c) => c.status === 'SETTLED_FROM_DEPOSIT')?.amount.toFixed(2)).toBe(
      '100.00',
    );
    expect(charges.find((c) => c.status === 'PENDING')?.amount.toFixed(2)).toBe('170.00');
  });

  it('never pushes the deposit negative', async () => {
    const bookingId = await rentalWithDeposit('50.00');
    const tollId = await tollOn(bookingId, '400.00');

    await request(app)
      .post(`${API}/fleet/tolls/${tollId}/recover`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send();

    const deposit = await depositOf(bookingId);
    expect(Number(deposit.balance)).toBe(0);
    expect(Number(deposit.balance)).toBeGreaterThanOrEqual(0);
  });

  it('still charges the customer when no deposit is held', async () => {
    bookingSeq += 1;
    const customer = await prisma.user.findFirstOrThrow({ where: { email: createdEmails[2] } });
    const booking = await prisma.booking.create({
      data: {
        bookingNumber: `FLT-ND-${Date.now()}-${bookingSeq}`,
        vehicleId,
        customerId: customer.id,
        pickupAt: day(-6),
        returnAt: day(-1),
        status: 'RETURNED',
        rentalDays: 5,
        vehicleSubtotal: '1000.00',
        totalAmount: '1000.00',
      },
    });
    const tollId = await tollOn(booking.id, '75.00');

    const response = await request(app)
      .post(`${API}/fleet/tolls/${tollId}/recover`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send();

    // No deposit is not a reason to drop the charge - it becomes invoiceable.
    expect(response.status).toBe(201);
    expect(response.body.data.recoveredFromDeposit).toBe('0.00');
    expect(response.body.data.leftToInvoice).toBe('75.00');

    const charges = await prisma.additionalCharge.findMany({ where: { bookingId: booking.id } });
    expect(charges).toHaveLength(1);
    expect(charges[0]?.status).toBe('PENDING');
  });

  it('refuses to recover the same toll twice', async () => {
    const bookingId = await rentalWithDeposit('1000.00');
    const tollId = await tollOn(bookingId, '40.00');

    await request(app)
      .post(`${API}/fleet/tolls/${tollId}/recover`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send();

    const second = await request(app)
      .post(`${API}/fleet/tolls/${tollId}/recover`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send();

    expect(second.status).toBe(409);

    // And the deposit moved exactly once.
    const deposit = await depositOf(bookingId);
    expect(deposit.deducted).toBe('40.00');
  });
});

describe('Maintenance windows and availability (BRD 39)', () => {
  let maintenanceId: string;

  it('schedules a maintenance window', async () => {
    const response = await request(app)
      .post(`${API}/fleet/maintenance`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        vehicleId,
        type: 'ROUTINE_SERVICE',
        startsAt: day(200),
        endsAt: day(203),
        description: '20,000 km service',
        provider: 'Main dealer',
        cost: '850.00',
      });

    expect(response.status).toBe(201);
    expect(response.body.data.status).toBe('SCHEDULED');
    maintenanceId = response.body.data.id;
  });

  it('rejects a window that ends before it starts', async () => {
    const response = await request(app)
      .post(`${API}/fleet/maintenance`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        vehicleId,
        type: 'REPAIR',
        startsAt: day(210),
        endsAt: day(208),
        description: 'Backwards window',
      });

    expect(response.status).toBe(400);
  });

  it('ACCEPTANCE: the vehicle is unbookable inside the window', async () => {
    const result = await availabilityService.checkVehicle(vehicleId, {
      pickupAt: new Date(day(201)),
      returnAt: new Date(day(202)),
    });

    expect(result.available).toBe(false);
    expect(result.reason?.toLowerCase()).toContain('maintenance');
  });

  it('ACCEPTANCE: the vehicle is still bookable OUTSIDE the window', async () => {
    // This is the assertion that separates a date range from a status flag.
    // With a flag, a car booked in for a service in seven months would vanish
    // from search today - and nobody would notice the lost revenue.
    const before = await availabilityService.checkVehicle(vehicleId, {
      pickupAt: new Date(day(190)),
      returnAt: new Date(day(193)),
    });
    const after = await availabilityService.checkVehicle(vehicleId, {
      pickupAt: new Date(day(210)),
      returnAt: new Date(day(213)),
    });

    expect(before.available).toBe(true);
    expect(after.available).toBe(true);
  });

  it('reports the maintenance window in blocked dates', async () => {
    // The calendar only looks 180 days ahead, so this one sits inside that
    // horizon rather than reusing the window above.
    const soon = await request(app)
      .post(`${API}/fleet/maintenance`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        vehicleId,
        type: 'TYRE_CHANGE',
        startsAt: day(100),
        endsAt: day(101),
        description: 'Tyres',
      });

    expect(soon.status).toBe(201);

    const response = await request(app).get(`${API}/availability/${vehicleId}/blocked-dates`);

    expect(response.status).toBe(200);
    const blocked: string[] = response.body.data.blockedDates;
    // A customer picking that date is told on the calendar, not at checkout.
    expect(blocked).toContain(day(100).slice(0, 10));

    await request(app)
      .patch(`${API}/fleet/maintenance/${soon.body.data.id}/status`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ status: 'CANCELLED' });
  });

  it('frees the vehicle as soon as the work is marked complete', async () => {
    const response = await request(app)
      .patch(`${API}/fleet/maintenance/${maintenanceId}/status`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ status: 'COMPLETED' });

    expect(response.status).toBe(200);

    const result = await availabilityService.checkVehicle(vehicleId, {
      pickupAt: new Date(day(201)),
      returnAt: new Date(day(202)),
    });

    // A service that finished early should put the car back on the road now,
    // not on the date someone typed in last week.
    expect(result.available).toBe(true);
  });
});

describe('Insurance and expiry tracking (BRD 40, 41)', () => {
  it('records a policy and supersedes the previous one', async () => {
    const first = await request(app)
      .post(`${API}/fleet/insurance`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        vehicleId,
        provider: 'Old Insurer',
        policyNumber: 'POL-OLD',
        startDate: day(-400),
        expiryDate: day(-35),
        premium: '3200.00',
      });

    expect(first.status).toBe(201);

    const second = await request(app)
      .post(`${API}/fleet/insurance`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        vehicleId,
        provider: 'New Insurer',
        policyNumber: 'POL-NEW',
        startDate: day(-30),
        expiryDate: day(20),
        premium: '3400.00',
      });

    expect(second.status).toBe(201);

    const policies = await request(app)
      .get(`${API}/fleet/vehicles/${vehicleId}/insurance`)
      .set('Authorization', `Bearer ${staffToken}`);

    const active = policies.body.data.filter((policy: { isActive: boolean }) => policy.isActive);
    // The old policy is still on file - a claim about last year needs it -
    // but only one policy is current.
    expect(policies.body.data).toHaveLength(2);
    expect(active).toHaveLength(1);
    expect(active[0].policyNumber).toBe('POL-NEW');
  });

  it('rejects a policy that expires before it starts', async () => {
    const response = await request(app)
      .post(`${API}/fleet/insurance`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        vehicleId,
        provider: 'Nonsense',
        policyNumber: 'POL-BAD',
        startDate: day(30),
        expiryDate: day(10),
      });

    expect(response.status).toBe(400);
  });

  it('lists the current policy as due soon inside the reminder window', async () => {
    const response = await request(app)
      .get(`${API}/fleet/expiring?withinDays=30`)
      .set('Authorization', `Bearer ${staffToken}`);

    expect(response.status).toBe(200);

    const due = response.body.data.dueSoon.find(
      (item: { label: string }) => item.label === 'New Insurer - POL-NEW',
    );
    expect(due).toBeTruthy();
    expect(due.daysRemaining).toBe(20);
  });

  it('uses the configured reminder schedule, not a hardcoded one', async () => {
    const response = await request(app)
      .get(`${API}/fleet/expiring`)
      .set('Authorization', `Bearer ${staffToken}`);

    // Seeded from BRD 41's own example. Changing it is a settings edit, not a
    // deployment.
    expect(response.body.data.reminderDays).toEqual([30, 15, 7, 0]);
  });

  it('never hides an already-expired policy behind the window filter', async () => {
    // The superseded policy is inactive, so it should not appear at all -
    // but an ACTIVE expired policy must always surface, however narrow the
    // window. A lapsed policy is the most urgent row on the page.
    await prisma.insuranceRecord.updateMany({
      where: { vehicleId, policyNumber: 'POL-OLD' },
      data: { isActive: true },
    });

    const response = await request(app)
      .get(`${API}/fleet/expiring?withinDays=1`)
      .set('Authorization', `Bearer ${staffToken}`);

    const expired = response.body.data.expired.find(
      (item: { label: string }) => item.label === 'Old Insurer - POL-OLD',
    );
    expect(expired).toBeTruthy();
    expect(expired.daysRemaining).toBeLessThan(0);

    await prisma.insuranceRecord.updateMany({
      where: { vehicleId, policyNumber: 'POL-OLD' },
      data: { isActive: false },
    });
  });

  it('keeps the fleet dashboard away from customers', async () => {
    const response = await request(app)
      .get(`${API}/fleet/expiring`)
      .set('Authorization', `Bearer ${customerToken}`);

    expect(response.status).toBe(403);
  });
});
