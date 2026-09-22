/**
 * modules/settings/readiness.ts
 * ---------------------------------------------------------------------------
 * What is still switched off, and what that costs.
 *
 * ===========================================================================
 * WHY THIS EXISTS
 * ===========================================================================
 * This system refuses to invent business values. VAT, the minimum driving age,
 * the cancellation fee, the company's tax registration number - all of them
 * come from the client, and until one is supplied the code that uses it does
 * nothing rather than guess. That is the right call: a plausible-looking 5%
 * VAT on a real invoice is worse than a visible blank.
 *
 * The cost of that design is silence. A blank minimum age does not throw, it
 * simply means NOBODY'S AGE IS CHECKED - and nothing anywhere says so. An
 * owner reasonably assumes a feature they can see in the settings screen is
 * working.
 *
 * So this turns each blank into a sentence: what is off, what that means in
 * practice, and how much it matters. It is the difference between a settings
 * page with empty boxes and a list of decisions still to make.
 *
 * ===========================================================================
 * SEVERITY MEANS SOMETHING SPECIFIC
 * ===========================================================================
 *   blocking - the business is exposed today: a legal requirement missing
 *              from documents already being issued, or a safety rule that is
 *              silently not being applied.
 *   degraded - a feature that exists but is doing nothing.
 *   optional - genuinely a preference; blank is a legitimate answer.
 */
import { settingsService, SettingKey } from './service';

export type ReadinessSeverity = 'blocking' | 'degraded' | 'optional';

export interface ReadinessItem {
  key: string;
  label: string;
  severity: ReadinessSeverity;
  /** What is happening right now because this is blank. Plain words. */
  consequence: string;
}

interface Check {
  key: string;
  label: string;
  severity: ReadinessSeverity;
  consequence: string;
}

/**
 * Every setting whose absence changes behaviour.
 *
 * Deliberately not "every setting". A list that reports all 28 is a list
 * nobody reads to the end, and most of them have a sensible blank state.
 */
const CHECKS: Check[] = [
  {
    key: SettingKey.COMPANY_TRN,
    label: 'Tax registration number',
    severity: 'blocking',
    consequence:
      'A UAE tax invoice must carry your TRN. Invoices are being issued without one, and they print a visible gap where it should be.',
  },
  {
    key: SettingKey.COMPANY_ADDRESS,
    label: 'Company address',
    severity: 'blocking',
    consequence: 'Invoices and rental agreements are going out without your address on them.',
  },
  {
    key: SettingKey.MINIMUM_RENTAL_AGE,
    label: 'Minimum driver age',
    severity: 'blocking',
    consequence:
      'Nobody’s age is being checked. Anyone can book any car, whatever their date of birth says - and your insurer will test that rule, not this software.',
  },
  {
    key: SettingKey.VAT_PERCENTAGE,
    label: 'VAT rate',
    severity: 'blocking',
    consequence: 'No tax is being added to any quote or invoice.',
  },
  {
    key: SettingKey.CANCELLATION_FREE_WINDOW_HOURS,
    label: 'Free cancellation window',
    severity: 'degraded',
    consequence:
      'There is no cancellation policy in force, so every cancellation is treated as free however late it arrives.',
  },
  {
    key: SettingKey.CANCELLATION_FEE_PERCENTAGE,
    label: 'Late cancellation fee',
    severity: 'degraded',
    consequence: 'Late cancellations are not charged anything.',
  },
  {
    key: SettingKey.FINE_SERVICE_FEE,
    label: 'Fine handling fee',
    severity: 'degraded',
    consequence:
      'Traffic fines are passed on at the authority’s amount only - your admin time on each one is not recovered.',
  },
  {
    key: SettingKey.TOLL_SERVICE_FEE,
    label: 'Salik handling fee',
    severity: 'degraded',
    consequence: 'Salik crossings are passed on at cost, with no handling fee.',
  },
  {
    key: SettingKey.TOLL_AUTO_WRITE_OFF_BELOW,
    label: 'Write off tolls below',
    severity: 'optional',
    consequence:
      'Every Salik crossing is chased, however small. Set a figure to stop staff spending ten minutes recovering four dirhams.',
  },
  {
    key: SettingKey.COMPANY_PHONE,
    label: 'Company phone',
    severity: 'optional',
    consequence: 'Customers have no number to call on their invoice or booking confirmation.',
  },
  {
    key: SettingKey.COMPANY_EMAIL,
    label: 'Company email',
    severity: 'optional',
    consequence: 'Documents carry no address for customers to reply to.',
  },
];

export const readinessService = {
  /**
   * The blanks that matter, worst first.
   *
   * Reads through the settings service so the 30-second cache applies - this
   * runs on every dashboard load and must not become eleven queries.
   */
  async check(): Promise<{
    ready: boolean;
    blocking: number;
    items: ReadinessItem[];
  }> {
    const items: ReadinessItem[] = [];

    for (const entry of CHECKS) {
      const value = await settingsService.getString(entry.key);
      // getString already treats a whitespace-only value as absent, which is
      // what a seeded-but-unfilled setting looks like.
      if (value === null) {
        items.push({
          key: entry.key,
          label: entry.label,
          severity: entry.severity,
          consequence: entry.consequence,
        });
      }
    }

    const order: Record<ReadinessSeverity, number> = { blocking: 0, degraded: 1, optional: 2 };
    items.sort((left, right) => order[left.severity] - order[right.severity]);

    const blocking = items.filter((item) => item.severity === 'blocking').length;

    return {
      // "Ready" ignores the optional ones on purpose: a permanent warning
      // about a setting that is fine to leave blank is a warning people learn
      // to ignore, and then they ignore the real ones too.
      ready: items.every((item) => item.severity === 'optional'),
      blocking,
      items,
    };
  },
};
