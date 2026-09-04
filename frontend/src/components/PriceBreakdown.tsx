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
 */
import type { PriceQuote } from '../types/pricing';

export default function PriceBreakdown({ quote }: { quote: PriceQuote }) {
  const { totals, lineItems, period, currency } = quote;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex items-baseline justify-between">
        <h3 className="font-semibold text-slate-900">Price breakdown</h3>
        <span className="text-xs text-slate-500">
          {period.rentalDays} day{period.rentalDays === 1 ? '' : 's'}
        </span>
      </div>

      <dl className="mt-4 space-y-2 text-sm">
        {lineItems.map((item) => {
          const isDiscount = item.amount.startsWith('-');
          return (
            <div key={item.key} className="flex items-start justify-between gap-4">
              <dt className="text-slate-600">
                {item.label}
                {item.detail && <span className="block text-xs text-slate-400">{item.detail}</span>}
              </dt>
              <dd className={isDiscount ? 'font-medium text-emerald-700' : 'font-medium text-slate-900'}>
                {isDiscount ? '' : ''}
                {currency} {item.amount}
              </dd>
            </div>
          );
        })}
      </dl>

      <div className="mt-4 border-t border-slate-200 pt-3">
        <div className="flex items-baseline justify-between">
          <span className="font-semibold text-slate-900">Rental total</span>
          <span className="text-lg font-bold text-slate-900">
            {currency} {totals.rentalTotal}
          </span>
        </div>

        {/* The deposit is presented separately and explained. BRD 20 makes it
            refundable, so folding it into the total would misrepresent the
            cost of the rental. */}
        <div className="mt-3 rounded-md bg-slate-50 p-3">
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-slate-700">Security deposit (refundable)</span>
            <span className="font-medium text-slate-900">
              {currency} {totals.securityDeposit}
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Held at pickup and returned after the vehicle is inspected, less any approved charges.
          </p>
        </div>

        <div className="mt-3 flex items-baseline justify-between border-t border-slate-200 pt-3">
          <span className="font-semibold text-slate-900">Total payable now</span>
          <span className="text-xl font-bold text-slate-900">
            {currency} {totals.totalPayable}
          </span>
        </div>
      </div>

      {/* Configuration gaps are surfaced, not hidden. If VAT has not been set
          up, the customer and the operator both need to know the quote is
          incomplete rather than see a confident wrong number. */}
      {quote.warnings.length > 0 && (
        <ul className="mt-4 space-y-1 rounded-md border border-amber-200 bg-amber-50 p-3">
          {quote.warnings.map((warning) => (
            <li key={warning} className="text-xs text-amber-800">
              {warning}
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 text-xs text-slate-400">{period.dayCountingRule}</p>
    </div>
  );
}
