/**
 * components/InstalmentSchedule.tsx
 * ---------------------------------------------------------------------------
 * The monthly payment plan for a long-term rental (BRD 16).
 *
 * Shown in FULL, every month of the term, not just the one that is payable.
 * A customer taking a car for six months is making a six-month financial
 * commitment, and a page that reveals the cost one month at a time is one
 * nobody can budget against. The whole schedule is agreed up front, so the
 * whole schedule is visible up front.
 *
 * Only the earliest unpaid month can be paid, and the backend enforces that -
 * this just declines to offer buttons the server would refuse.
 */
import { CalendarClock } from 'lucide-react';
import type { Booking } from '../types/booking';

const STATUS_STYLE: Record<string, string> = {
  PAID: 'bg-teal-100 text-teal-800',
  DUE: 'bg-amber-100 text-amber-800',
  SCHEDULED: 'bg-ink-100 text-ink-600',
  CANCELLED: 'bg-slate-100 text-slate-500',
};

const STATUS_LABEL: Record<string, string> = {
  PAID: 'paid',
  DUE: 'due now',
  SCHEDULED: 'upcoming',
  CANCELLED: 'cancelled',
};

function monthRange(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const day = (date: Date) =>
    date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return `${day(start)} - ${day(end)}`;
}

export default function InstalmentSchedule({
  booking,
  onPay,
  paying,
}: {
  booking: Booking;
  onPay: () => void;
  paying: boolean;
}) {
  if (booking.billingCycle !== 'MONTHLY' || booking.instalments.length === 0) return null;

  const currency = booking.pricing.currency;
  const paidCount = booking.instalments.filter((row) => row.status === 'PAID').length;

  // The earliest unpaid month is the only one payable - paying month four
  // while month two is outstanding is not a thing.
  const nextUnpaid = booking.instalments.find(
    (row) => row.status === 'DUE' || row.status === 'SCHEDULED',
  );

  return (
    <section aria-labelledby="schedule-title" className="surface mt-6 p-5 sm:p-6">
      <div className="flex items-center gap-2.5">
        <CalendarClock aria-hidden className="h-4 w-4 text-ink-400" />
        <h2 id="schedule-title" className="font-semibold text-ink-950">
          Monthly payments
        </h2>
      </div>
      <p className="mt-1 text-sm text-ink-500">
        {paidCount} of {booking.instalments.length} months paid. Each month is due on the day it
        starts.
      </p>

      <ol className="mt-4 divide-y divide-ink-100 text-sm">
        {booking.instalments.map((row) => {
          const isNext = row.id === nextUnpaid?.id;
          /*
           * What is riding along on this month.
           *
           * Salik and fines on a long-term rental are billed with the next
           * month rather than taken out of the damage deposit, so a month can
           * legitimately cost more than the rent. Showing only the rent while
           * charging more is how a customer's card is debited for a figure
           * they were never shown - so each extra is named, with its amount.
           */
          const extras = booking.additionalCharges.filter(
            (charge) => charge.instalmentId === row.id,
          );
          const hasExtras = extras.length > 0 || Number(row.extrasAmount) > 0;

          return (
            <li key={row.id} className="flex items-center justify-between gap-4 py-3">
              <div className="min-w-0">
                <p className="font-medium text-ink-950">
                  Month {row.sequence}
                  {booking.termMonths ? ` of ${booking.termMonths}` : ''}
                </p>
                <p className="mt-0.5 text-xs text-ink-500">
                  {monthRange(row.periodStart, row.periodEnd)}
                </p>

                {hasExtras && (
                  <ul className="mt-2 space-y-1 border-l-2 border-ink-100 pl-3 text-xs text-ink-600">
                    {extras.map((charge) => (
                      <li key={charge.id} className="flex gap-2">
                        <span className="tabular shrink-0 font-medium">
                          + {currency} {charge.amount}
                        </span>
                        <span className="min-w-0 truncate">{charge.description}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-3">
                <div className="text-right">
                  <p className="tabular text-sm font-semibold text-ink-950">
                    {currency} {row.totalDue}
                  </p>
                  {hasExtras && (
                    <p className="tabular mt-0.5 text-xs text-ink-500">
                      {currency} {row.amount} rent + {currency} {row.extrasAmount} extras
                    </p>
                  )}
                  <span
                    className={`mt-1 inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      STATUS_STYLE[row.status] ?? STATUS_STYLE.SCHEDULED
                    }`}
                  >
                    {STATUS_LABEL[row.status] ?? row.status.toLowerCase()}
                  </span>
                </div>

                {isNext && (
                  <button
                    type="button"
                    disabled={paying}
                    onClick={onPay}
                    className="btn btn-accent btn-sm shrink-0"
                  >
                    {paying ? 'Opening…' : 'Pay'}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
