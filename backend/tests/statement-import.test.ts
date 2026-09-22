/**
 * tests/statement-import.test.ts
 * ---------------------------------------------------------------------------
 * The import engine itself - Salik crossings and traffic fines.
 *
 * ===========================================================================
 * WHY THIS MATTERS MORE THAN THE PARSER TESTS
 * ===========================================================================
 * The parser only has to read a file. This decides who PAYS for each row, and
 * it runs over hundreds of rows at a time, unattended, from a file nobody has
 * read line by line. The whole design rests on two promises:
 *
 *   1. Re-uploading a file changes nothing. Staff WILL upload the same file
 *      twice - after a failure, after an overlapping month, or because they
 *      cannot remember whether it worked. If that double-bills, it double-
 *      bills dozens of customers at once.
 *
 *   2. The preview is the truth. It is the only thing anybody reads before
 *      committing, so the dry run and the real run must go through the same
 *      code and reach the same answers.
 *
 * Neither was covered by a test until this file.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { prisma, disconnectPrisma } from '../src/config/prisma';
import { clearSettingsCache } from '../src/modules/settings/service';
import { API, cleanupUsers, createUser, loginAndGetToken } from './helpers';

const app = createApp();
const createdEmails: string[] = [];

let staffToken: string;
let plate: string;
let vehicleId: string;
let bookingId: string;
let customerName: string;

/** Far in the future, so no other suite's windows can overlap these. */
function day(offset: number, hour = 9): Date {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offset);
  date.setUTCHours(hour, 0, 0, 0);
  return date;
}

const iso = (date: Date) => {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}/${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
};

const preview = (text: string, kind: 'tolls' | 'fines' = 'tolls') =>
  request(app)
    .post(`${API}/fleet/${kind}/import/preview`)
    .set('Authorization', `Bearer ${staffToken}`)
    .send({ text });

const commit = (text: string, kind: 'tolls' | 'fines' = 'tolls') =>
  request(app)
    .post(`${API}/fleet/${kind}/import`)
    .set('Authorization', `Bearer ${staffToken}`)
    .send({ text });

beforeAll(async () => {
  const staff = await createUser({ role: 'STAFF' });
  const customer = await createUser({ role: 'CUSTOMER' });
  createdEmails.push(staff.email, customer.email);
  staffToken = await loginAndGetToken(app, staff.email);
  customerName = customer.fullName;

  const category = await prisma.vehicleCategory.findFirstOrThrow({ where: { isActive: true } });
  plate = `IMP-${Date.now().toString().slice(-6)}`;
  const vehicle = await prisma.vehicle.create({
    data: {
      brand: 'Import',
      model: 'TestCar',
      year: 2024,
      registrationNumber: plate,
      categoryId: category.id,
      seats: 5,
      transmission: 'AUTOMATIC',
      fuelType: 'PETROL',
      dailyPrice: '200.00',
      securityDeposit: '1000.00',
    },
  });
  vehicleId = vehicle.id;

  // An OPEN rental - charges can still reach it. A completed one refuses them.
  const booking = await prisma.booking.create({
    data: {
      bookingNumber: `IMP-${Date.now()}`,
      vehicleId,
      customerId: customer.id,
      pickupAt: day(700),
      returnAt: day(720),
      status: 'RETURNED',
      rentalDays: 20,
      vehicleSubtotal: '4000.00',
      totalAmount: '4000.00',
      securityDeposit: '1000.00',
    },
  });
  bookingId = booking.id;

  // No handling fee and no auto write-off, so the arithmetic in these tests is
  // the file's figures and nothing else.
  for (const key of ['tolls.service_fee', 'fines.service_fee', 'tolls.auto_write_off_below']) {
    await prisma.systemSetting.update({ where: { key }, data: { value: '' } });
  }
  clearSettingsCache();
});

afterAll(async () => {
  await prisma.tollCharge.deleteMany({ where: { vehicleId } });
  await prisma.trafficFine.deleteMany({ where: { vehicleId } });
  await prisma.booking.deleteMany({ where: { id: bookingId } });
  await prisma.vehicle.deleteMany({ where: { id: vehicleId } });
  await cleanupUsers(createdEmails);
  await disconnectPrisma();
});

describe('Salik crossings', () => {
  const file = () =>
    [
      'Plate No,Transaction Date,Toll Gate,Amount (AED)',
      `${plate},${iso(day(705))},"Al Barsha, Dubai",4.00`,
      `${plate},${iso(day(706))},Al Safa,4.00`,
      `NOT-OURS-1,${iso(day(705))},Al Safa,4.00`,
    ].join('\n');

  it('attributes a crossing to whoever had the car', async () => {
    const res = await preview(file());

    expect(res.status).toBe(200);
    expect(res.body.data.counts.billable).toBe(2);
    expect(res.body.data.counts.unknown_vehicle).toBe(1);
    expect(res.body.data.billableTotal).toBe('8.00');
    expect(res.body.data.rows[0].customerName).toBe(customerName);
  });

  it('writes nothing on a preview', async () => {
    await preview(file());
    expect(await prisma.tollCharge.count({ where: { vehicleId } })).toBe(0);
  });

  it('imports, and then treats the SAME FILE as entirely duplicate', async () => {
    const first = await commit(file());
    expect(first.status).toBe(201);
    expect(first.body.data.imported).toBe(2);

    const second = await preview(file());

    /*
     * The promise the whole design rests on. Staff re-upload files - after a
     * failure, after an overlapping month, or because they cannot remember
     * whether it worked. Anything other than "already have it" here bills
     * dozens of customers twice.
     */
    expect(second.body.data.counts.duplicate).toBe(2);
    expect(second.body.data.counts.billable).toBe(0);

    const committedAgain = await commit(file());
    expect(committedAgain.body.data.imported).toBe(0);
    expect(await prisma.tollCharge.count({ where: { vehicleId } })).toBe(2);
  });

  it('catches a row repeated WITHIN one file', async () => {
    const repeated = [
      'Plate No,Transaction Date,Toll Gate,Amount (AED)',
      `${plate},${iso(day(710))},Airport Tunnel,4.00`,
      `${plate},${iso(day(710))},Airport Tunnel,4.00`,
    ].join('\n');

    const res = await preview(repeated);

    // The database cannot catch this one - neither row exists yet - so the
    // engine has to remember what it has already accepted from this file.
    expect(res.body.data.counts.billable).toBe(1);
    expect(res.body.data.counts.duplicate).toBe(1);
  });

  it('records a crossing nobody was renting as the company’s', async () => {
    const orphan = [
      'Plate No,Transaction Date,Toll Gate,Amount (AED)',
      `${plate},01/01/2020 08:00,Jebel Ali,4.00`,
    ].join('\n');

    const res = await preview(orphan);
    expect(res.body.data.counts.unattached).toBe(1);
    expect(res.body.data.billableTotal).toBe('0.00');
  });
});

describe('traffic fines', () => {
  const fineNumber = `FIMP-${Date.now()}`;

  const file = () =>
    [
      'Plate Number,Fine Number,Violation Date,Violation,Fine Amount',
      `${plate},${fineNumber},${iso(day(707))},overspeed,600.00`,
    ].join('\n');

  it('reads a fines export and attributes it', async () => {
    const res = await preview(file(), 'fines');

    expect(res.status).toBe(200);
    expect(res.body.data.counts.billable).toBe(1);
    expect(res.body.data.rows[0].reference).toBe(fineNumber);
    expect(res.body.data.rows[0].violation).toBe('overspeed');
    expect(res.body.data.billableTotal).toBe('600.00');
  });

  it('imports it as a fine, not a toll', async () => {
    const res = await commit(file(), 'fines');
    expect(res.status).toBe(201);

    const fine = await prisma.trafficFine.findUniqueOrThrow({ where: { fineNumber } });
    expect(fine.vehicleId).toBe(vehicleId);
    expect(fine.bookingId).toBe(bookingId);
    expect(fine.amount.toFixed(2)).toBe('600.00');
    expect(fine.violation).toBe('overspeed');
  });

  it('treats a re-upload as duplicate, by FINE NUMBER', async () => {
    const res = await preview(file(), 'fines');

    /*
     * A fine's number is stamped by the authority and is the same on every
     * export - which makes it the only honest way to tell "the same fine
     * again" from "a second fine at the same moment".
     */
    expect(res.body.data.counts.duplicate).toBe(1);
    expect(res.body.data.counts.billable).toBe(0);
  });

  it('SKIPS a fine with no number rather than risk billing it twice', async () => {
    const noNumber = [
      'Plate Number,Violation Date,Violation,Fine Amount',
      `${plate},${iso(day(708))},no seatbelt,400.00`,
    ].join('\n');

    const res = await preview(noNumber, 'fines');

    expect(res.body.data.rows).toHaveLength(0);
    expect(res.body.data.problems[0].reason).toMatch(/fine number/i);
  });

  it('never writes off a fine, however small', async () => {
    await prisma.systemSetting.update({
      where: { key: 'tolls.auto_write_off_below' },
      data: { value: '1000' },
    });
    clearSettingsCache();

    const small = [
      'Plate Number,Fine Number,Violation Date,Violation,Fine Amount',
      `${plate},${fineNumber}-SMALL,${iso(day(709))},parking,100.00`,
    ].join('\n');

    const res = await preview(small, 'fines');

    // The threshold is about not chasing four dirhams of Salik. Silently
    // writing off a penalty the company is liable for is a different thing
    // entirely.
    expect(res.body.data.counts.written_off).toBe(0);
    expect(res.body.data.counts.billable).toBe(1);

    await prisma.systemSetting.update({
      where: { key: 'tolls.auto_write_off_below' },
      data: { value: '' },
    });
    clearSettingsCache();
  });
});

describe('what the engine refuses', () => {
  it('reports a file whose columns it cannot identify, and imports nothing', async () => {
    const res = await preview(['Some,Random,Columns', 'a,b,c'].join('\n'));

    expect(res.body.data.rows).toHaveLength(0);
    expect(res.body.data.problems[0].reason).toMatch(/could not find/i);
  });

  it('REFUSES an anonymous caller', async () => {
    const res = await request(app)
      .post(`${API}/fleet/tolls/import/preview`)
      .send({ text: 'Plate,Date,Amount\nX,01/01/2026,4.00' });

    expect(res.status).toBe(401);
  });
});
