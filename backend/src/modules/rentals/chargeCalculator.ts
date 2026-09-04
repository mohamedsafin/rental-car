/**
 * modules/rentals/chargeCalculator.ts
 * ---------------------------------------------------------------------------
 * What the customer owes on top of the rental, worked out from the two
 * inspections (BRD 26 and 30).
 *
 * Pure functions: inputs in, charges out, no database and no clock of their
 * own. That is what lets every rule here be tested exhaustively - and these
 * are the rules a customer argues about at the counter, so each one returns a
 * `calculation` object showing exactly how the figure was reached.
 *
 * EVERY RATE IS A SETTING. BRD 51 leaves late-return, fuel and mileage policy
 * to the client, so nothing here invents a number. An unset rate produces NO
 * charge and a warning, never a plausible-looking default.
 */
import { Prisma } from '@prisma/client';

const ZERO = new Prisma.Decimal(0);
const HOUR_MS = 60 * 60 * 1000;

export interface ChargePolicy {
  /** Hours of grace before a late return is chargeable. Null = not configured. */
  lateGraceHours: number | null;
  /** Charge per full or part day late. Null = fall back to the daily rate. */
  lateFeePerDay: Prisma.Decimal | null;
  /** Charge per percentage point of missing fuel. Null = not configured. */
  fuelChargePerPercent: Prisma.Decimal | null;
  /** Flat charge when the car comes back dirty. Null = not configured. */
  cleaningFee: Prisma.Decimal | null;
}

export interface ChargeInput {
  dueBackAt: Date;
  returnedAt: Date;
  pickupMileage: number;
  returnMileage: number;
  pickupFuelPercent: number;
  returnFuelPercent: number;
  /** Billable days on the booking, used for the mileage allowance. */
  rentalDays: number;
  dailyRate: Prisma.Decimal;
  /** Km included per day. Null = unlimited, so no excess is possible. */
  mileageLimitPerDay: number | null;
  extraMileageCharge: Prisma.Decimal | null;
  /** Staff judgement at return. */
  needsCleaning: boolean;
}

export interface CalculatedCharge {
  type: 'LATE_RETURN' | 'EXCESS_MILEAGE' | 'FUEL' | 'CLEANING';
  amount: Prisma.Decimal;
  description: string;
  calculation: Record<string, unknown>;
}

export interface ChargeResult {
  charges: CalculatedCharge[];
  total: Prisma.Decimal;
  warnings: string[];
}

/**
 * Late return.
 *
 * Charged in whole days, matching how the rental itself is priced: a rental
 * day is a 24-hour period, so keeping the car three hours past the grace
 * window is one more day. Any other rule would mean two different day-counting
 * conventions inside the same system.
 */
export function calculateLateReturn(
  input: ChargeInput,
  policy: ChargePolicy,
): { charge: CalculatedCharge | null; warning?: string } {
  const overdueMs = input.returnedAt.getTime() - input.dueBackAt.getTime();
  if (overdueMs <= 0) return { charge: null };

  if (policy.lateGraceHours === null) {
    return {
      charge: null,
      warning:
        'No late-return policy is configured, so no late fee was applied. Set rental.late_grace_hours in Settings.',
    };
  }

  const overdueHours = overdueMs / HOUR_MS;
  if (overdueHours <= policy.lateGraceHours) return { charge: null };

  const chargeableHours = overdueHours - policy.lateGraceHours;
  const days = Math.ceil(chargeableHours / 24);

  // Falls back to the vehicle's own daily rate when no separate late fee is
  // set. That is the common commercial arrangement, not an invented figure.
  const perDay = policy.lateFeePerDay ?? input.dailyRate;
  const amount = perDay.mul(days).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

  return {
    charge: {
      type: 'LATE_RETURN',
      amount,
      description: `Returned ${Math.round(overdueHours)}h late (${days} extra day${days === 1 ? '' : 's'})`,
      calculation: {
        dueBackAt: input.dueBackAt.toISOString(),
        returnedAt: input.returnedAt.toISOString(),
        overdueHours: Math.round(overdueHours * 100) / 100,
        graceHours: policy.lateGraceHours,
        chargeableDays: days,
        ratePerDay: perDay.toFixed(2),
      },
    },
  };
}

/** Excess mileage: kilometres over the allowance, times the per-km rate. */
export function calculateExcessMileage(input: ChargeInput): {
  charge: CalculatedCharge | null;
  warning?: string;
} {
  // Unlimited mileage means no excess is possible, whatever they drove.
  if (input.mileageLimitPerDay === null) return { charge: null };

  const driven = input.returnMileage - input.pickupMileage;
  const allowance = input.mileageLimitPerDay * input.rentalDays;
  const excess = driven - allowance;

  if (excess <= 0) return { charge: null };

  if (!input.extraMileageCharge) {
    return {
      charge: null,
      warning: `The vehicle was driven ${excess}km over its allowance, but no per-km rate is set on it, so nothing was charged.`,
    };
  }

  const amount = input.extraMileageCharge
    .mul(excess)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

  return {
    charge: {
      type: 'EXCESS_MILEAGE',
      amount,
      description: `${excess}km over the ${allowance}km allowance`,
      calculation: {
        pickupMileage: input.pickupMileage,
        returnMileage: input.returnMileage,
        driven,
        allowancePerDay: input.mileageLimitPerDay,
        rentalDays: input.rentalDays,
        allowance,
        excessKm: excess,
        ratePerKm: input.extraMileageCharge.toFixed(2),
      },
    },
  };
}

/**
 * Fuel (BRD 30).
 *
 * Charged on the SHORTFALL only. A customer who returns the car fuller than
 * they took it is neither refunded nor charged - being generous with fuel
 * should not cost anyone money in either direction.
 */
export function calculateFuel(
  input: ChargeInput,
  policy: ChargePolicy,
): { charge: CalculatedCharge | null; warning?: string } {
  const shortfall = input.pickupFuelPercent - input.returnFuelPercent;
  if (shortfall <= 0) return { charge: null };

  if (!policy.fuelChargePerPercent) {
    return {
      charge: null,
      warning: `The vehicle came back ${shortfall}% down on fuel, but no fuel charge is configured, so nothing was applied. Set rental.fuel_charge_per_percent in Settings.`,
    };
  }

  const amount = policy.fuelChargePerPercent
    .mul(shortfall)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

  return {
    charge: {
      type: 'FUEL',
      amount,
      description: `Returned ${shortfall}% below the fuel level at pickup`,
      calculation: {
        pickupFuelPercent: input.pickupFuelPercent,
        returnFuelPercent: input.returnFuelPercent,
        shortfallPercent: shortfall,
        ratePerPercent: policy.fuelChargePerPercent.toFixed(2),
      },
    },
  };
}

export function calculateCleaning(
  input: ChargeInput,
  policy: ChargePolicy,
): { charge: CalculatedCharge | null; warning?: string } {
  if (!input.needsCleaning) return { charge: null };

  if (!policy.cleaningFee) {
    return {
      charge: null,
      warning:
        'The vehicle was marked as needing cleaning, but no cleaning fee is configured, so nothing was charged.',
    };
  }

  return {
    charge: {
      type: 'CLEANING',
      amount: policy.cleaningFee,
      description: 'Vehicle required cleaning beyond normal use',
      calculation: { flatFee: policy.cleaningFee.toFixed(2) },
    },
  };
}

/** Run every rule and collect the results. */
export function calculateReturnCharges(input: ChargeInput, policy: ChargePolicy): ChargeResult {
  const results = [
    calculateLateReturn(input, policy),
    calculateExcessMileage(input),
    calculateFuel(input, policy),
    calculateCleaning(input, policy),
  ];

  const charges = results
    .map((result) => result.charge)
    .filter((charge): charge is CalculatedCharge => charge !== null);

  const warnings = results
    .map((result) => result.warning)
    .filter((warning): warning is string => warning !== undefined);

  const total = charges.reduce((sum, charge) => sum.add(charge.amount), ZERO);

  return { charges, total, warnings };
}
