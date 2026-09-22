/**
 * modules/settings/service.ts
 * ---------------------------------------------------------------------------
 * Typed reader for the `system_settings` table.
 *
 * BRD 38 is explicit that VAT rate, deposit rules, cancellation windows and
 * minimum age are "to be provided by the client". This module is how the rest
 * of the code consumes them WITHOUT inventing a fallback.
 *
 * The critical design decision: an unset setting returns `null`, never a
 * plausible-looking default. If VAT is not configured, `getNumber('pricing.
 * vat_percentage')` gives null and the pricing engine reports "tax not
 * configured" rather than silently charging 5% - a number nobody approved,
 * which would then appear on real invoices.
 *
 * Values are cached briefly: pricing reads several on every quote, and settings
 * change a handful of times a year.
 */
import { prisma } from '../../config/prisma';
import { logger } from '../../config/logger';

const CACHE_TTL_MS = 30_000;

interface CacheEntry {
  value: string | null;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();

/** Drop the cache. Called after any settings write, and by tests. */
export function clearSettingsCache(): void {
  cache.clear();
}

async function readRaw(key: string): Promise<string | null> {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.value;
  }

  const setting = await prisma.systemSetting.findUnique({ where: { key } });
  // An empty string means "seeded but not yet filled in by the client", which
  // is the same as absent for every consumer.
  const value = setting && setting.value.trim() !== '' ? setting.value : null;

  cache.set(key, { value, fetchedAt: Date.now() });
  return value;
}

export const settingsService = {
  async getString(key: string): Promise<string | null> {
    return readRaw(key);
  },

  /** Returns null when unset OR unparseable - never a guessed number. */
  async getNumber(key: string): Promise<number | null> {
    const raw = await readRaw(key);
    if (raw === null) return null;

    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      logger.warn('System setting is not a valid number', { key, value: raw });
      return null;
    }
    return parsed;
  },

  async getBoolean(key: string): Promise<boolean | null> {
    const raw = await readRaw(key);
    if (raw === null) return null;
    return raw === 'true' || raw === '1';
  },

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await readRaw(key);
    if (raw === null) return null;

    try {
      return JSON.parse(raw) as T;
    } catch {
      logger.warn('System setting is not valid JSON', { key });
      return null;
    }
  },

  /**
   * A number with an explicit fallback.
   *
   * Use ONLY where the fallback is a structural default rather than a business
   * value the client must approve. `turnaround_buffer_hours` defaults to 0
   * (back-to-back rentals allowed) because zero is the absence of a policy.
   * VAT must NEVER use this - there is no safe default tax rate.
   */
  async getNumberOr(key: string, fallback: number): Promise<number> {
    return (await settingsService.getNumber(key)) ?? fallback;
  },
};

/** Keys used by more than one module, so a typo cannot silently read nothing. */
export const SettingKey = {
  VAT_PERCENTAGE: 'pricing.vat_percentage',
  CURRENCY: 'pricing.currency',
  TURNAROUND_BUFFER_HOURS: 'rental.turnaround_buffer_hours',
  MINIMUM_RENTAL_AGE: 'rental.minimum_age',
  MIN_RENTAL_HOURS: 'rental.minimum_rental_hours',
  MAX_RENTAL_DAYS: 'rental.maximum_rental_days',
  BOOKING_HOLD_MINUTES: 'rental.booking_hold_minutes',
  CANCELLATION_FREE_WINDOW_HOURS: 'cancellation.free_window_hours',
  CANCELLATION_FEE_PERCENTAGE: 'cancellation.fee_percentage',
  /// JSON array of day offsets, e.g. [30, 15, 7, 0] (BRD 41).
  EXPIRY_REMINDER_DAYS: 'fleet.expiry_reminder_days',

  /*
   * What the company adds on top of the authority's own figure when passing a
   * fine or a Salik crossing to the customer (BRD 28, 29 - "additional company
   * charge", left to the client).
   *
   * A POLICY, not a per-record decision. Before these existed the handling fee
   * was typed in by hand on every record, so two identical fines could carry
   * different fees depending on who keyed them - and the customer had no way
   * to know which was right. Staff can still override on a single record where
   * a case genuinely warrants it; these decide the default.
   */
  FINE_SERVICE_FEE: 'fines.service_fee',
  TOLL_SERVICE_FEE: 'tolls.service_fee',

  /*
   * Below this, a toll on a SHORT rental is written off rather than chased.
   *
   * Not meanness, arithmetic: a two-day customer who crossed four gates owes
   * about AED 16, and they have gone home. The staff minutes spent recovering
   * it cost more than the money, and the attempt annoys a customer over the
   * price of a coffee.
   *
   * It deliberately does NOT apply to monthly rentals. There the charge rides
   * along on a bill the customer is already paying, so collecting it costs
   * nothing and writing it off would just be giving money away.
   */
  TOLL_AUTO_WRITE_OFF_BELOW: 'tolls.auto_write_off_below',

  /// Printed on every invoice. All client-supplied; blank until they are.
  COMPANY_NAME: 'company.name',
  COMPANY_ADDRESS: 'company.address',
  COMPANY_PHONE: 'company.phone',
  COMPANY_EMAIL: 'company.email',
  /// UAE Tax Registration Number. Legally required on a tax invoice.
  COMPANY_TRN: 'company.trn',

  /// Whether a customer may reserve a vehicle and pay cash at the counter.
  /// OFF unless the client turns it on: it is the only path that holds a car
  /// without money.
  ALLOW_CASH_ON_PICKUP: 'payments.allow_cash_on_pickup',
} as const;
