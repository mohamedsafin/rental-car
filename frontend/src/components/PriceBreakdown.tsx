/**
 * components/PriceBreakdown.tsx
 * ---------------------------------------------------------------------------
 * The price table from BRD 15.
 *
 * This component performs NO arithmetic. Every figure it shows came from the
 * backend's pricing engine already formatted. If you ever find yourself
 * wanting to add two of these numbers here, that sum belongs in the engine -
 * two places computing money is two places for them to disagree, and the one
 * the customer sees would not be the one they are charged.
 *
 * Exact two-decimal figures throughout, unlike the rounded "AED 260" on the
 * marketing surfaces: this is the checkout, and the customer should see
 * precisely what they will pay.
 */
import type { PriceQuote } from '../types/pricing';

export default function PriceBreakdown({
  quote,
  monthly,
}: {
  quote: PriceQuote;
  /**
   * Set on a monthly rental: how many months the term runs to.
   *
   * It changes only the FOOTER, and only the honest way round. The table above
   * is the whole term - that is what is being agreed - but "Total payable now"
   * is a promise about this moment, and on a monthly rental the customer is
   * not paying the term today. Leaving it saying the full figure would
   * contradict the line directly above it offering to bill month by month.
   */
  monthly?: { months: number } | null;
}) {
  const { totals, lineItems, period, currency } = quote;

  /*
   * The first month, as the backend will divide it.
   *
   * This is the one sum this component does, and it is a presentational
   * estimate of a figure the server owns - which is why it is shown as "about"
   * and why the exact schedule appears on the booking itself once created. It
   * is here because a customer deciding between daily and monthly needs to
   * know roughly what leaves their account today.
   */
  const firstMonth =
    monthly && monthly.months > 1
      ? (Number(totals.rentalTotal) / monthly.months).toFixed(2)
      : null;
  const dueNow =
    firstMonth !== null
      ? (Number(firstMonth) + Number(totals.securityDeposit)).toFixed(2)
      : null;

  return (
    <div className="rounded-2xl bg-ink-50 p-4 sm:p-5">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-ink-950">Price breakdown</h3>
        <span className="tabular text-xs text-ink-500">
          {period.rentalDays} day{period.rentalDays === 1 ? '' : 's'}
        </span>
      </div>

      <dl className="mt-4 space-y-2.5 text-sm">
        {lineItems.map((item) => {
          const isDiscount = item.amount.startsWith('-');
          return (
            <div key={item.key} className="flex items-start justify-between gap-4">
              <dt className="text-ink-600">
                {item.label}
                {item.detail && <span className="block text-xs text-ink-500">{item.detail}</span>}
              </dt>
              <dd
                className={`tabular shrink-0 font-medium ${isDiscount ? 'text-emerald-700' : 'text-ink-950'}`}
              >
                {currency} {item.amount}
              </dd>
            </div>
          );
        })}
      </dl>

      <div className="mt-4 border-t border-ink-200 pt-4">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-semibold text-ink-950">Rental total</span>
          <span className="tabular text-base font-semibold text-ink-950">
            {currency} {totals.rentalTotal}
          </span>
        </div>

        {/* The deposit is presented separately and explained. BRD 20 makes it
            refundable, so folding it into the total would misrepresent the
            cost of the rental. */}
        <div className="mt-3 rounded-xl bg-white p-3.5">
          <div className="flex items-baseline justify-between gap-4 text-sm">
            <span className="text-ink-700">Security deposit (refundable)</span>
            <span className="tabular shrink-0 font-medium text-ink-950">
              {currency} {totals.securityDeposit}
            </span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-ink-500">
            Held at pickup and returned after the vehicle is inspected, less any approved charges.
          </p>
        </div>

        <div className="mt-4 flex items-baseline justify-between border-t border-ink-200 pt-4">
          <span className="text-sm font-semibold text-ink-950">
            {dueNow ? 'Due now' : 'Total payable now'}
          </span>
          <span className="tabular text-xl font-semibold tracking-tight text-ink-950">
            {currency} {dueNow ?? totals.totalPayable}
          </span>
        </div>

        {dueNow && firstMonth && (
          <p className="mt-2 text-xs leading-relaxed text-ink-500">
            About {currency} {firstMonth} for the first month plus the {currency}{' '}
            {totals.securityDeposit} deposit. The remaining {monthly!.months - 1} month
            {monthly!.months - 1 === 1 ? '' : 's'} are billed one at a time. You will see the exact
            schedule before you pay.
          </p>
        )}
      </div>

      {/* Configuration gaps are surfaced, not hidden. If VAT has not been set
          up, the customer and the operator both need to know the quote is
          incomplete rather than see a confident wrong number. */}
      {quote.warnings.length > 0 && (
        <ul className="mt-4 space-y-1 rounded-xl border border-amber-200 bg-amber-50 p-3">
          {quote.warnings.map((warning) => (
            <li key={warning} className="text-xs text-amber-800">
              {warning}
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 text-xs text-ink-500">{period.dayCountingRule}</p>
    </div>
  );
}
