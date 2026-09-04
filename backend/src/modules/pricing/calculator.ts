/**
 * modules/pricing/calculator.ts
 * ---------------------------------------------------------------------------
 * The pure arithmetic of pricing. No database, no HTTP - data in, data out.
 *
 * Kept separate from service.ts precisely so it can be unit-tested to death.
 * Every function here is deterministic: same inputs, same output, always.
 */
import { Prisma } from '@prisma/client';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const ZERO = new Prisma.Decimal(0);

/**
 * Billable days: any part of a 24-hour period counts as a whole one.
 *
 * Ceiling, not rounding. Returning 1 hour late is a whole extra day - the
 * standard rental convention, and the one BRD 34 asks us to state explicitly.
 * Minimum 1: a 20-minute rental still costs a day.
 */
export function calculateRentalDays(pickupAt: Date, returnAt: Date): number {
  const ms = returnAt.getTime() - pickupAt.getTime();
  if (ms <= 0) return 0;
  return Math.max(1, Math.ceil(ms / DAY_MS));
}

export function calculateDurationHours(pickupAt: Date, returnAt: Date): number {
  return Math.max(0, (returnAt.getTime() - pickupAt.getTime()) / HOUR_MS);
}

export interface RateTiers {
  daily: Prisma.Decimal;
  weekly: Prisma.Decimal | null;
  monthly: Prisma.Decimal | null;
}

export interface RateBlock {
  tier: 'monthly' | 'weekly' | 'daily';
  quantity: number;
  unitPrice: Prisma.Decimal;
  subtotal: Prisma.Decimal;
}

export interface RateSelection {
  blocks: RateBlock[];
  total: Prisma.Decimal;
}

/** Decompose `days` using the given block size, returning blocks + remainder. */
function decompose(
  days: number,
  size: number,
  price: Prisma.Decimal,
  tier: RateBlock['tier'],
): { block: RateBlock | null; remainder: number } {
  const count = Math.floor(days / size);
  if (count === 0) return { block: null, remainder: days };

  return {
    block: { tier, quantity: count, unitPrice: price, subtotal: price.mul(count) },
    remainder: days - count * size,
  };
}

function sum(blocks: RateBlock[]): Prisma.Decimal {
  return blocks.reduce((acc, block) => acc.add(block.subtotal), ZERO);
}

/**
 * Pick the CHEAPEST way to price `rentalDays` from the available tiers.
 *
 * Candidates considered:
 *   - straight daily
 *   - weeks + daily remainder
 *   - months + weeks + daily remainder
 *   - rounding UP to the next whole week or month when that is cheaper
 *
 * The round-up cases matter: with a AED 650 daily rate and a AED 4200 weekly
 * rate, a 6-day rental costs 3900 daily but 4200 as a week - so daily wins.
 * At 7 days it flips. But a 29-day rental against a 15000 monthly rate is
 * cheaper as one month than as 4 weeks + 1 day, and a customer should never
 * pay more than the next tier up.
 */
export function selectBestRate(rentalDays: number, tiers: RateTiers): RateSelection {
  if (rentalDays <= 0) return { blocks: [], total: ZERO };

  const candidates: RateBlock[][] = [];

  // 1. Straight daily - always available, always the baseline.
  candidates.push([
    { tier: 'daily', quantity: rentalDays, unitPrice: tiers.daily, subtotal: tiers.daily.mul(rentalDays) },
  ]);

  // 2. Weeks + daily remainder.
  if (tiers.weekly) {
    const { block, remainder } = decompose(rentalDays, 7, tiers.weekly, 'weekly');
    if (block) {
      const blocks = [block];
      if (remainder > 0) {
        blocks.push({
          tier: 'daily',
          quantity: remainder,
          unitPrice: tiers.daily,
          subtotal: tiers.daily.mul(remainder),
        });
      }
      candidates.push(blocks);
    }

    // 2b. Round up to whole weeks - cheaper when the remainder is large.
    const wholeWeeks = Math.ceil(rentalDays / 7);
    candidates.push([
      { tier: 'weekly', quantity: wholeWeeks, unitPrice: tiers.weekly, subtotal: tiers.weekly.mul(wholeWeeks) },
    ]);
  }

  // 3. Months (+ weeks + days).
  if (tiers.monthly) {
    const { block: monthBlock, remainder: afterMonths } = decompose(rentalDays, 30, tiers.monthly, 'monthly');
    if (monthBlock) {
      const blocks = [monthBlock];
      let left = afterMonths;

      if (tiers.weekly) {
        const { block: weekBlock, remainder } = decompose(left, 7, tiers.weekly, 'weekly');
        if (weekBlock) {
          blocks.push(weekBlock);
          left = remainder;
        }
      }

      if (left > 0) {
        blocks.push({
          tier: 'daily',
          quantity: left,
          unitPrice: tiers.daily,
          subtotal: tiers.daily.mul(left),
        });
      }
      candidates.push(blocks);
    }

    // 3b. Round up to whole months.
    const wholeMonths = Math.ceil(rentalDays / 30);
    candidates.push([
      {
        tier: 'monthly',
        quantity: wholeMonths,
        unitPrice: tiers.monthly,
        subtotal: tiers.monthly.mul(wholeMonths),
      },
    ]);
  }

  // Cheapest wins. Ties keep the earlier (simpler) candidate.
  let best = candidates[0] as RateBlock[];
  let bestTotal = sum(best);

  for (const candidate of candidates.slice(1)) {
    const total = sum(candidate);
    if (total.lessThan(bestTotal)) {
      best = candidate;
      bestTotal = total;
    }
  }

  return { blocks: best, total: bestTotal };
}

/**
 * Apply a percentage and round to 2 decimal places, half-up.
 *
 * Rounding happens ONCE per derived amount, never mid-calculation, so
 * fractional fils cannot accumulate across a 30-day rental.
 */
export function applyPercentage(base: Prisma.Decimal, percentage: Prisma.Decimal): Prisma.Decimal {
  return base.mul(percentage).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

export function money(value: Prisma.Decimal): string {
  return value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2);
}
