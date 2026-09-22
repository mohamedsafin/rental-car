/**
 * utils/format.ts
 * ---------------------------------------------------------------------------
 * Turning server strings into things a person reads at a glance.
 *
 * Money crosses the wire as a decimal STRING ("31862.25") so that no amount is
 * ever rounded by a float on the way here. That is right, and it is also
 * unreadable: nobody scanning a dashboard parses "31862.25" as thirty-one
 * thousand without stopping to count the digits. Grouping is not decoration -
 * it is the difference between reading a number and decoding one.
 */

/** "31862.25" -> "31,862.25". Passes anything unparseable straight through. */
export function formatMoney(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';

  const amount = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(amount)) return String(value);

  return amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * The same, but the fillers dropped on round figures: "5,000" not "5,000.00".
 *
 * For headline tiles only. Anything that has to reconcile against an invoice
 * keeps its decimals, because a column of money that mixes the two is a column
 * nobody trusts.
 */
export function formatMoneyCompact(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';

  const amount = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(amount)) return String(value);

  return amount.toLocaleString(undefined, {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

/** A count with thousands separators. */
export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toLocaleString();
}

/** "16 September 2026" - the long form, for a date shown once on a page. */
export function formatLongDate(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/** "16 Sep" - for a range where the year is already obvious from context. */
export function formatShortDate(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
