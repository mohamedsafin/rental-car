/**
 * tests/pricing-calculator.test.ts
 * ---------------------------------------------------------------------------
 * Pure unit tests for the pricing arithmetic. No database, no HTTP - which is
 * exactly why the calculator was kept as plain functions.
 *
 * These are the cheapest tests in the project and cover the logic most likely
 * to cost money if it is wrong.
 */
import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  applyPercentage,
  calculateRentalDays,
  money,
  selectBestRate,
} from '../src/modules/pricing/calculator';

const d = (value: string) => new Prisma.Decimal(value);
const at = (iso: string) => new Date(iso);

describe('calculateRentalDays', () => {
  it('counts an exact 24 hours as one day', () => {
    expect(calculateRentalDays(at('2026-09-10T10:00:00Z'), at('2026-09-11T10:00:00Z'))).toBe(1);
  });

  it('rounds a part day UP - one hour late is a whole extra day', () => {
    expect(calculateRentalDays(at('2026-09-10T10:00:00Z'), at('2026-09-11T11:00:00Z'))).toBe(2);
  });

  it('charges at least one day for a very short rental', () => {
    expect(calculateRentalDays(at('2026-09-10T10:00:00Z'), at('2026-09-10T10:20:00Z'))).toBe(1);
  });

  it('counts the BRD example (10 Sep to 15 Sep) as 5 days', () => {
    expect(calculateRentalDays(at('2026-09-10T10:00:00Z'), at('2026-09-15T10:00:00Z'))).toBe(5);
  });

  it('returns 0 for an inverted range rather than a negative day count', () => {
    expect(calculateRentalDays(at('2026-09-15T10:00:00Z'), at('2026-09-10T10:00:00Z'))).toBe(0);
  });
});

describe('selectBestRate', () => {
  const tiers = { daily: d('100'), weekly: d('600'), monthly: d('2000') };

  it('uses the daily rate for a short rental', () => {
    const result = selectBestRate(3, tiers);
    expect(money(result.total)).toBe('300.00');
    expect(result.blocks[0]?.tier).toBe('daily');
  });

  it('switches to the weekly rate at 7 days, saving the customer money', () => {
    const result = selectBestRate(7, tiers);
    // 7 x 100 = 700 daily, versus 600 weekly. The customer must get 600.
    expect(money(result.total)).toBe('600.00');
    expect(result.blocks[0]?.tier).toBe('weekly');
  });

  it('combines a week and loose days for 10 days', () => {
    const result = selectBestRate(10, tiers);
    // 1 week (600) + 3 days (300) = 900, versus 1000 straight daily.
    expect(money(result.total)).toBe('900.00');
    expect(result.blocks.map((b) => b.tier)).toEqual(['weekly', 'daily']);
  });

  it('never charges more than rounding up to the next tier', () => {
    const result = selectBestRate(6, { daily: d('100'), weekly: d('550'), monthly: null });
    // 6 x 100 = 600 daily, but a whole week is 550. The cheaper wins.
    expect(money(result.total)).toBe('550.00');
  });

  it('uses the monthly rate for a 30-day rental', () => {
    const result = selectBestRate(30, tiers);
    expect(money(result.total)).toBe('2000.00');
    expect(result.blocks[0]?.tier).toBe('monthly');
  });

  it('prices 29 days as a whole month when that is cheaper', () => {
    const result = selectBestRate(29, tiers);
    // 4 weeks (2400) + 1 day (100) = 2500, versus one month at 2000.
    expect(money(result.total)).toBe('2000.00');
  });

  it('falls back to daily when no weekly or monthly rate is set', () => {
    const result = selectBestRate(10, { daily: d('100'), weekly: null, monthly: null });
    expect(money(result.total)).toBe('1000.00');
  });

  it('returns zero for a zero-day rental instead of throwing', () => {
    expect(money(selectBestRate(0, tiers).total)).toBe('0.00');
  });
});

describe('decimal precision', () => {
  it('adds fractional amounts without floating-point drift', () => {
    // 0.1 + 0.2 === 0.30000000000000004 with JS numbers. Not here.
    expect(money(d('0.1').add(d('0.2')))).toBe('0.30');
  });

  it('keeps a 30-day total exact', () => {
    const result = selectBestRate(30, { daily: d('249.99'), weekly: null, monthly: null });
    // 249.99 x 30 = 7499.70 exactly. A float would give 7499.699999999999.
    expect(money(result.total)).toBe('7499.70');
  });

  it('rounds a percentage half-up to 2 places', () => {
    // 5% of 1234.55 = 61.7275 -> 61.73
    expect(money(applyPercentage(d('1234.55'), d('5')))).toBe('61.73');
  });

  it('treats a negative percentage as a reduction', () => {
    expect(money(applyPercentage(d('1000'), d('-15')))).toBe('-150.00');
  });
});
