/**
 * components/ChargesPanel.tsx
 * ---------------------------------------------------------------------------
 * What was charged on top of the rental, and what happened to each charge.
 *
 * Traffic fines, Salik crossings, fuel, cleaning, late return and damage all
 * land here. Until this existed a customer could see money leave their deposit
 * - the deposit ledger shows that - but nothing said what the money was for on
 * the booking itself, and anything that exceeded the deposit was invisible
 * entirely. "Your refund is AED 80 short" with no line explaining it is how a
 * correct recovery turns into a dispute.
 *
 * Two groups, because they need different things from the reader: what has
 * been settled is information, what is still owed is a bill.
 */
import { Receipt } from 'lucide-react';
import type { Booking } from '../types/booking';

/** Plain words. `LATE_RETURN` is a database value, not something to show. */
const TYPE_LABEL: Record<string, string> = {
  LATE_RETURN: 'Late return',
  EXCESS_MILEAGE: 'Extra mileage',
  FUEL: 'Fuel',
  CLEANING: 'Cleaning',
  DAMAGE: 'Damage',
  OTHER: 'Other charge',
};

const STATUS_STYLE: Record<string, string> = {
  SETTLED_FROM_DEPOSIT: 'bg-teal-100 text-teal-800',
  PENDING: 'bg-amber-100 text-amber-800',
  INVOICED: 'bg-amber-100 text-amber-800',
  WAIVED: 'bg-slate-100 text-slate-600',
};

const STATUS_LABEL: Record<string, string> = {
  SETTLED_FROM_DEPOSIT: 'taken from deposit',
  PENDING: 'outstanding',
  INVOICED: 'invoiced',
  WAIVED: 'waived',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export default function ChargesPanel({ booking }: { booking: Booking }) {
  const charges = booking.additionalCharges;
  if (charges.length === 0) return null;

  const currency = booking.pricing.currency;

  // A waived charge is not owed and was not paid - it belongs in neither total.
  const owed = charges
    .filter((charge) => charge.status === 'PENDING' || charge.status === 'INVOICED')
    .reduce((sum, charge) => sum + Number(charge.amount), 0);

  return (
    <section aria-labelledby="charges-title" className="surface mt-6 p-5 sm:p-6">
      <div className="flex items-center gap-2.5">
        <Receipt aria-hidden className="h-4 w-4 text-ink-400" />
        <h2 id="charges-title" className="font-semibold text-ink-950">
          Additional charges
        </h2>
      </div>

      <ul className="mt-4 divide-y divide-ink-100 text-sm">
        {charges.map((charge) => (
          <li key={charge.id} className="flex items-start justify-between gap-4 py-3">
            <div className="min-w-0">
              <p className="font-medium text-ink-950">
                {TYPE_LABEL[charge.type] ?? TYPE_LABEL.OTHER}
              </p>
              {/*
                The description carries the detail that makes a charge
                arguable or not - the fine number, the gate, what the money
                was split between. It is the whole reason this reads as an
                explanation rather than a deduction.
              */}
              {charge.description && (
                <p className="mt-0.5 text-xs leading-relaxed text-ink-500">{charge.description}</p>
              )}
              <p className="mt-1 text-xs text-ink-400">{formatDate(charge.at)}</p>
            </div>

            <div className="shrink-0 text-right">
              <p
                className={`tabular text-sm font-semibold ${
                  charge.status === 'WAIVED' ? 'text-ink-400 line-through' : 'text-ink-950'
                }`}
              >
                {charge.currency} {charge.amount}
              </p>
              <span
                className={`mt-1 inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  STATUS_STYLE[charge.status] ?? STATUS_STYLE.PENDING
                }`}
              >
                {STATUS_LABEL[charge.status] ?? charge.status.toLowerCase()}
              </span>
            </div>
          </li>
        ))}
      </ul>

      {owed > 0 && (
        <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-sm text-amber-900">
          <span className="font-semibold">
            {currency} {owed.toFixed(2)} still outstanding.
          </span>{' '}
          This is beyond what your deposit covered and will be invoiced separately.
        </p>
      )}
    </section>
  );
}
