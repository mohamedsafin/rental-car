/**
 * utils/displayMoney.ts
 * ---------------------------------------------------------------------------
 * Formats a money STRING for display: "2500.00" -> "2,500", "260.50" -> "260.50".
 *
 * It never parses the amount into a JavaScript number. Every money field in
 * this app is a string all the way from Postgres' DECIMAL, precisely so that
 * floating-point rounding can never creep in (see types/vehicle.ts). Grouping
 * digits and dropping a ".00" are text operations, so they stay text
 * operations here.
 *
 * Use it for marketing surfaces - cards, the hero, category tiles - where
 * "AED 260 / day" reads better than "AED 260.00 / day". Checkout and invoices
 * keep the exact two-decimal figures the pricing engine returned.
 */
export function displayMoney(amount: string): string {
  const negative = amount.startsWith('-');
  const [whole, fraction = ''] = amount.replace(/^-/, '').split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const cents = /^0*$/.test(fraction) ? '' : `.${fraction}`;
  return `${negative ? '-' : ''}${grouped}${cents}`;
}
