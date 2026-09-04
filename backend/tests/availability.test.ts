/**
 * tests/availability.test.ts
 * ---------------------------------------------------------------------------
 * THE PHASE 4 ACCEPTANCE TESTS.
 *
 * BRD 34 names these two cases specifically:
 *
 *   Booking A: 10 Sep -> 15 Sep
 *   Booking B: 12 Sep -> 18 Sep   same vehicle   MUST be rejected
 *
 *   Booking A: 10 Sep -> 15 Sep
 *   Booking B: 15 Sep -> 20 Sep   same vehicle   MUST be allowed
 *
 * They are tested at BOTH layers - the service that filters search results,
 * and the PostgreSQL exclusion constraint that catches a race the service
 * cannot.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { periodsOverlap } from '../src/modules/availability/types';
import { prisma, disconnectPrisma } from '../src/config/prisma';
import { availabilityService } from '../src/modules/availability/service';
import { createUser, cleanupUsers } from './helpers';

const at = (iso: string) => new Date(iso);

/** Far enough ahead that "pickup cannot be in the past" never interferes. */
function future(days: number, hour = 10): Date {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  date.setUTCHours(hour, 0, 0, 0);
  return date;
}

describe('periodsOverlap (pure rule)', () => {
  it('BRD 34 case 1: 10-15 Sep and 12-18 Sep OVERLAP', () => {
    expect(
      periodsOverlap(
        { pickupAt: at('2026-09-10T10:00:00Z'), returnAt: at('2026-09-15T10:00:00Z') },
        { pickupAt: at('2026-09-12T10:00:00Z'), returnAt: at('2026-09-18T10:00:00Z') },
      ),
    ).toBe(true);
  });

  it('BRD 34 case 2: 10-15 Sep and 15-20 Sep DO NOT overlap', () => {
    expect(
      periodsOverlap(
        { pickupAt: at('2026-09-10T10:00:00Z'), returnAt: at('2026-09-15T10:00:00Z') },
        { pickupAt: at('2026-09-15T10:00:00Z'), returnAt: at('2026-09-20T10:00:00Z') },
      ),
    ).toBe(false);
  });

  it('detects a new booking entirely inside an existing one', () => {
    expect(
      periodsOverlap(
        { pickupAt: at('2026-09-10T00:00:00Z'), returnAt: at('2026-09-20T00:00:00Z') },
        { pickupAt: at('2026-09-12T00:00:00Z'), returnAt: at('2026-09-14T00:00:00Z') },
      ),
    ).toBe(true);
  });

  it('detects a new booking that completely swallows an existing one', () => {
    expect(
      periodsOverlap(
        { pickupAt: at('2026-09-12T00:00:00Z'), returnAt: at('2026-09-14T00:00:00Z') },
        { pickupAt: at('2026-09-10T00:00:00Z'), returnAt: at('2026-09-20T00:00:00Z') },
      ),
    ).toBe(true);
  });

  it('detects a one-second overlap', () => {
    expect(
      periodsOverlap(
        { pickupAt: at('2026-09-10T10:00:00Z'), returnAt: at('2026-09-15T10:00:00Z') },
        { pickupAt: at('2026-09-15T09:59:59Z'), returnAt: at('2026-09-20T10:00:00Z') },
      ),
    ).toBe(true);
  });

  it('treats fully separate periods as free', () => {
    expect(
      periodsOverlap(
        { pickupAt: at('2026-09-01T10:00:00Z'), returnAt: at('2026-09-05T10:00:00Z') },
        { pickupAt: at('2026-09-10T10:00:00Z'), returnAt: at('2026-09-15T10:00:00Z') },
      ),
    ).toBe(false);
  });
});

describe('availability service and database constraint', () => {
  let vehicleId: string;
  let customerId: string;
  const createdEmails: string[] = [];
  const createdBookingNumbers: string[] = [];

  beforeAll(async () => {
    const customer = await createUser({ role: 'CUSTOMER' });
    createdEmails.push(customer.email);
    customerId = customer.id;

    const category = await prisma.vehicleCategory.findFirst({ where: { isActive: true } });
    if (!category) throw new Error('No seeded category. Run: npm run prisma:seed');

    const vehicle = await prisma.vehicle.create({
      data: {
        brand: 'Availability',
        model: 'TestCar',
        year: 2024,
        registrationNumber: `AVL-${Date.now().toString().slice(-8)}`,
        categoryId: category.id,
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
    await prisma.booking.deleteMany({ where: { vehicleId } });
    await prisma.vehicle.deleteMany({ where: { id: vehicleId } });
    await cleanupUsers(createdEmails);
    await disconnectPrisma();
  });

  async function makeBooking(pickupAt: Date, returnAt: Date, status = 'CONFIRMED' as const) {
    const bookingNumber = `TEST-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    createdBookingNumbers.push(bookingNumber);

    return prisma.booking.create({
      data: {
        bookingNumber,
        vehicleId,
        customerId,
        pickupAt,
        returnAt,
        status,
        rentalDays: 1,
        vehicleSubtotal: '100.00',
        totalAmount: '100.00',
      },
    });
  }

  it('reports a free vehicle as available', async () => {
    const result = await availabilityService.checkVehicle(vehicleId, {
      pickupAt: future(400),
      returnAt: future(402),
    });
    expect(result.available).toBe(true);
  });

  it('BRD 34: rejects 12-18 Sep when 10-15 Sep is already booked', async () => {
    await makeBooking(future(10), future(15));

    const result = await availabilityService.checkVehicle(vehicleId, {
      pickupAt: future(12),
      returnAt: future(18),
    });

    expect(result.available).toBe(false);
    expect(result.reason).toContain('already booked');
  });

  it('BRD 34: ALLOWS 15-20 Sep when 10-15 Sep is booked (periods touch)', async () => {
    // The 10-15 booking from the previous test is still in place.
    const result = await availabilityService.checkVehicle(vehicleId, {
      pickupAt: future(15),
      returnAt: future(20),
    });

    expect(result.available).toBe(true);
  });

  it('throws VEHICLE_UNAVAILABLE from assertVehicleAvailable', async () => {
    await expect(
      availabilityService.assertVehicleAvailable(vehicleId, {
        pickupAt: future(11),
        returnAt: future(13),
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'VEHICLE_UNAVAILABLE' });
  });

  it('ignores CANCELLED bookings - a cancelled car is free again', async () => {
    const cancelled = await makeBooking(future(50), future(55), 'CANCELLED');
    expect(cancelled.status).toBe('CANCELLED');

    const result = await availabilityService.checkVehicle(vehicleId, {
      pickupAt: future(51),
      returnAt: future(53),
    });
    expect(result.available).toBe(true);
  });

  it('ignores an EXPIRED unpaid hold', async () => {
    await prisma.booking.create({
      data: {
        bookingNumber: `TEST-EXPIRED-${Date.now()}`,
        vehicleId,
        customerId,
        pickupAt: future(60),
        returnAt: future(65),
        status: 'PENDING',
        // The hold lapsed an hour ago, so this must not block anyone.
        holdExpiresAt: new Date(Date.now() - 60 * 60 * 1000),
        rentalDays: 5,
        vehicleSubtotal: '500.00',
        totalAmount: '500.00',
      },
    });

    const result = await availabilityService.checkVehicle(vehicleId, {
      pickupAt: future(61),
      returnAt: future(63),
    });
    expect(result.available).toBe(true);
  });

  it('respects a LIVE unpaid hold', async () => {
    await prisma.booking.create({
      data: {
        bookingNumber: `TEST-LIVE-${Date.now()}`,
        vehicleId,
        customerId,
        pickupAt: future(70),
        returnAt: future(75),
        status: 'PENDING',
        holdExpiresAt: new Date(Date.now() + 30 * 60 * 1000),
        rentalDays: 5,
        vehicleSubtotal: '500.00',
        totalAmount: '500.00',
      },
    });

    const result = await availabilityService.checkVehicle(vehicleId, {
      pickupAt: future(71),
      returnAt: future(73),
    });
    expect(result.available).toBe(false);
  });
});

/**
 * The layer that matters under load.
 *
 * The service check above is a READ then a WRITE. Two simultaneous requests
 * can both pass it. These tests prove the database refuses the second write
 * regardless - which is the only guarantee that survives a race.
 */
describe('database exclusion constraint', () => {
  let vehicleId: string;
  let customerId: string;
  const createdEmails: string[] = [];

  beforeAll(async () => {
    const customer = await createUser({ role: 'CUSTOMER' });
    createdEmails.push(customer.email);
    customerId = customer.id;

    const category = await prisma.vehicleCategory.findFirst({ where: { isActive: true } });
    const vehicle = await prisma.vehicle.create({
      data: {
        brand: 'Constraint',
        model: 'TestCar',
        year: 2024,
        registrationNumber: `CON-${Date.now().toString().slice(-8)}`,
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
    await prisma.booking.deleteMany({ where: { vehicleId } });
    await prisma.vehicle.deleteMany({ where: { id: vehicleId } });
    await cleanupUsers(createdEmails);
  });

  function bookingData(pickupAt: Date, returnAt: Date, status = 'CONFIRMED' as const) {
    return {
      bookingNumber: `DB-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      vehicleId,
      customerId,
      pickupAt,
      returnAt,
      status,
      rentalDays: 1,
      vehicleSubtotal: '100.00',
      totalAmount: '100.00',
    };
  }

  it('REFUSES an overlapping insert even when the service check is bypassed', async () => {
    await prisma.booking.create({ data: bookingData(future(200), future(205)) });

    // Straight to the database - no service, no availability check.
    await expect(
      prisma.booking.create({ data: bookingData(future(202), future(208)) }),
    ).rejects.toThrow();
  });

  it('ACCEPTS a touching insert - the half-open range makes 15-20 valid', async () => {
    const booking = await prisma.booking.create({ data: bookingData(future(205), future(210)) });
    expect(booking.id).toBeTruthy();
  });

  it('wins the race when two identical bookings are inserted concurrently', async () => {
    const pickupAt = future(300);
    const returnAt = future(305);

    // Fire both at once. This is the scenario an application-level check
    // cannot survive: both reads see "free", both proceed to write.
    const results = await Promise.allSettled([
      prisma.booking.create({ data: bookingData(pickupAt, returnAt) }),
      prisma.booking.create({ data: bookingData(pickupAt, returnAt) }),
    ]);

    const succeeded = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');

    // Exactly one car, exactly one winner.
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
  });

  it('does not block on a CANCELLED booking', async () => {
    await prisma.booking.create({ data: bookingData(future(400), future(405), 'CANCELLED') });
    const second = await prisma.booking.create({ data: bookingData(future(401), future(404)) });
    expect(second.id).toBeTruthy();
  });

  it('rejects a return that is not after pickup', async () => {
    await expect(
      prisma.booking.create({ data: bookingData(future(500), future(499)) }),
    ).rejects.toThrow();
  });
});
