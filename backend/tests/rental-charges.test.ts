/**
 * tests/rental-charges.test.ts
 * ---------------------------------------------------------------------------
 * Pure unit tests for the return-charge rules.
 *
 * These are the figures a customer disputes at the counter, so every branch is
 * covered - including, importantly, the "not configured" branches that must
 * produce NO charge rather than a guessed one.
 */
import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  calculateCleaning,
  calculateExcessMileage,
  calculateFuel,
  calculateLateReturn,
  calculateReturnCharges,
  type ChargeInput,
  type ChargePolicy,
} from '../src/modules/rentals/chargeCalculator';

const d = (value: string) => new Prisma.Decimal(value);
const at = (iso: string) => new Date(iso);

const BASE_INPUT: ChargeInput = {
  dueBackAt: at('2027-03-15T10:00:00Z'),
  returnedAt: at('2027-03-15T10:00:00Z'),
  pickupMileage: 10_000,
  returnMileage: 10_500,
  pickupFuelPercent: 100,
  returnFuelPercent: 100,
  rentalDays: 5,
  dailyRate: d('200'),
  mileageLimitPerDay: 250,
  extraMileageCharge: d('1.50'),
  needsCleaning: false,
};

const FULL_POLICY: ChargePolicy = {
  lateGraceHours: 2,
  lateFeePerDay: d('250'),
  fuelChargePerPercent: d('4'),
  cleaningFee: d('150'),
};

const EMPTY_POLICY: ChargePolicy = {
  lateGraceHours: null,
  lateFeePerDay: null,
  fuelChargePerPercent: null,
  cleaningFee: null,
};

describe('late return', () => {
  it('charges nothing when the car is back on time', () => {
    const { charge } = calculateLateReturn(BASE_INPUT, FULL_POLICY);
    expect(charge).toBeNull();
  });

  it('charges nothing inside the grace window', () => {
    const { charge } = calculateLateReturn(
      { ...BASE_INPUT, returnedAt: at('2027-03-15T11:30:00Z') },
      FULL_POLICY,
    );
    expect(charge).toBeNull();
  });

  it('charges ONE day for three hours late with a two-hour grace', () => {
    const { charge } = calculateLateReturn(
      { ...BASE_INPUT, returnedAt: at('2027-03-15T13:00:00Z') },
      FULL_POLICY,
    );

    expect(charge?.amount.toFixed(2)).toBe('250.00');
    expect(charge?.calculation.chargeableDays).toBe(1);
  });

  it('charges TWO days for 30 hours late', () => {
    const { charge } = calculateLateReturn(
      { ...BASE_INPUT, returnedAt: at('2027-03-16T16:00:00Z') },
      FULL_POLICY,
    );
    expect(charge?.amount.toFixed(2)).toBe('500.00');
  });

  it("falls back to the vehicle's daily rate when no late fee is set", () => {
    const { charge } = calculateLateReturn(
      { ...BASE_INPUT, returnedAt: at('2027-03-15T13:00:00Z') },
      { ...FULL_POLICY, lateFeePerDay: null },
    );
    // The vehicle's own 200, not the policy's 250.
    expect(charge?.amount.toFixed(2)).toBe('200.00');
  });

  it('charges NOTHING and warns when no policy is configured', () => {
    const { charge, warning } = calculateLateReturn(
      { ...BASE_INPUT, returnedAt: at('2027-03-17T10:00:00Z') },
      EMPTY_POLICY,
    );

    expect(charge).toBeNull();
    expect(warning).toContain('No late-return policy is configured');
  });
});

describe('excess mileage', () => {
  it('charges nothing inside the allowance', () => {
    // 500km driven against a 1250km allowance.
    const { charge } = calculateExcessMileage(BASE_INPUT);
    expect(charge).toBeNull();
  });

  it('charges for kilometres beyond the allowance', () => {
    const { charge } = calculateExcessMileage({ ...BASE_INPUT, returnMileage: 11_500 });

    // 1500 driven - 1250 allowed = 250 excess, at 1.50/km.
    expect(charge?.amount.toFixed(2)).toBe('375.00');
    expect(charge?.calculation.excessKm).toBe(250);
  });

  it('charges nothing when mileage is unlimited', () => {
    const { charge } = calculateExcessMileage({
      ...BASE_INPUT,
      returnMileage: 99_999,
      mileageLimitPerDay: null,
    });
    expect(charge).toBeNull();
  });

  it('warns rather than guessing when no per-km rate is set', () => {
    const { charge, warning } = calculateExcessMileage({
      ...BASE_INPUT,
      returnMileage: 11_500,
      extraMileageCharge: null,
    });

    expect(charge).toBeNull();
    expect(warning).toContain('no per-km rate is set');
  });
});

describe('fuel', () => {
  it('charges for the shortfall', () => {
    const { charge } = calculateFuel({ ...BASE_INPUT, returnFuelPercent: 70 }, FULL_POLICY);

    // 30 percentage points at 4.00 each.
    expect(charge?.amount.toFixed(2)).toBe('120.00');
  });

  it('charges NOTHING when the car comes back fuller', () => {
    const { charge } = calculateFuel(
      { ...BASE_INPUT, pickupFuelPercent: 50, returnFuelPercent: 90 },
      FULL_POLICY,
    );
    // Generosity must not be refunded, and must certainly not be charged.
    expect(charge).toBeNull();
  });

  it('warns rather than guessing when no fuel rate is set', () => {
    const { charge, warning } = calculateFuel(
      { ...BASE_INPUT, returnFuelPercent: 70 },
      EMPTY_POLICY,
    );

    expect(charge).toBeNull();
    expect(warning).toContain('no fuel charge is configured');
  });
});

describe('cleaning', () => {
  it('charges the flat fee when marked as needing cleaning', () => {
    const { charge } = calculateCleaning({ ...BASE_INPUT, needsCleaning: true }, FULL_POLICY);
    expect(charge?.amount.toFixed(2)).toBe('150.00');
  });

  it('charges nothing when the car is clean', () => {
    const { charge } = calculateCleaning(BASE_INPUT, FULL_POLICY);
    expect(charge).toBeNull();
  });
});

describe('all charges together', () => {
  it('sums a messy return correctly', () => {
    const result = calculateReturnCharges(
      {
        ...BASE_INPUT,
        returnedAt: at('2027-03-15T13:00:00Z'),
        returnMileage: 11_500,
        returnFuelPercent: 70,
        needsCleaning: true,
      },
      FULL_POLICY,
    );

    // 250 late + 375 mileage + 120 fuel + 150 cleaning.
    expect(result.total.toFixed(2)).toBe('895.00');
    expect(result.charges).toHaveLength(4);
    expect(result.warnings).toHaveLength(0);
  });

  it('returns nothing at all for a perfect return', () => {
    const result = calculateReturnCharges(BASE_INPUT, FULL_POLICY);

    expect(result.charges).toHaveLength(0);
    expect(result.total.toFixed(2)).toBe('0.00');
  });

  it('charges NOTHING and collects every warning when nothing is configured', () => {
    const result = calculateReturnCharges(
      {
        ...BASE_INPUT,
        returnedAt: at('2027-03-17T10:00:00Z'),
        returnFuelPercent: 50,
        needsCleaning: true,
      },
      EMPTY_POLICY,
    );

    expect(result.total.toFixed(2)).toBe('0.00');
    expect(result.warnings.length).toBeGreaterThanOrEqual(3);
  });
});
