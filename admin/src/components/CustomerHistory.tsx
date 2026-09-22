/**
 * components/CustomerHistory.tsx
 * ---------------------------------------------------------------------------
 * Who this customer is, in the terms the counter actually cares about.
 *
 * ===========================================================================
 * THE QUESTION THIS ANSWERS
 * ===========================================================================
 * "Should I hand this person another set of keys?" Until now that took four
 * searches - bookings, payments, fines, damages - and a good memory, so in
 * practice nobody asked it and everybody said yes.
 *
 * `Still owed` is the number that decides it, so it is the one that turns red.
 * The rest is context: how often they rent, what they are worth, and whether
 * there is a pattern of fines or damage behind them.
 */
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getData } from '../services/api';
import type { NormalisedApiError } from '../types/api';

interface CustomerProfile {
  history: {
    rentals: number;
    completed: number;
    cancelled: number;
    totalSpent: string;
    outstanding: string;
    fines: number;
    damages: number;
    currency: string;
  };
  bookings: {
    id: string;
    bookingNumber: string;
    status: string;
    pickupAt: string;
    returnAt: string;
    total: string;
    currency: string;
    vehicle: string;
  }[];
}

const day = (iso: string): string =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

export default function CustomerHistory({ customerId }: { customerId: string }) {
  const { data, isPending } = useQuery<CustomerProfile, NormalisedApiError>({
    queryKey: ['customer-profile', customerId],
    queryFn: () => getData<CustomerProfile>(`/customers/${customerId}/profile`),
  });

  if (isPending) return <div className="skeleton h-40 rounded-xl" />;
  if (!data) return null;

  const { history, bookings } = data;
  const owes = Number(history.outstanding) > 0;

  return (
    <>
      <section className="card p-5">
        <h3 className="section-title">History</h3>

        <dl className="mt-3 grid gap-4 sm:grid-cols-4">
          <Stat label="Rentals" value={String(history.rentals)} />
          <Stat
            label="Spent with us"
            value={`${history.currency} ${history.totalSpent}`}
          />
          <Stat
            label="Still owed"
            value={`${history.currency} ${history.outstanding}`}
            tone={owes ? 'bad' : 'good'}
          />
          <Stat
            label="Fines / damage"
            value={`${history.fines} / ${history.damages}`}
            tone={history.fines + history.damages > 0 ? 'warn' : undefined}
          />
        </dl>

        {owes && (
          <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            {history.currency} {history.outstanding} is outstanding across their rentals - fines,
            tolls or charges not yet recovered. Settle it before handing over another car.
          </p>
        )}

        {history.cancelled > 0 && (
          <p className="mt-2 text-xs text-slate-500">
            {history.cancelled} of their {history.rentals} bookings were cancelled.
          </p>
        )}
      </section>

      <section className="card p-5">
        <h3 className="section-title">Their bookings</h3>

        {bookings.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">They have never booked.</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100">
            {bookings.map((booking) => (
              <li key={booking.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <div>
                  <Link
                    to={`/bookings/${booking.id}`}
                    className="text-sm font-medium text-slate-900 underline-offset-2 hover:underline"
                  >
                    {booking.bookingNumber}
                  </Link>
                  <p className="text-xs text-slate-500">
                    {booking.vehicle} · {day(booking.pickupAt)} → {day(booking.returnAt)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium text-slate-900">
                    {booking.currency} {booking.total}
                  </p>
                  <p className="text-xs text-slate-500">
                    {booking.status.replace(/_/g, ' ').toLowerCase()}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'good' | 'bad' | 'warn';
}) {
  const colour =
    tone === 'bad'
      ? 'text-red-700'
      : tone === 'warn'
        ? 'text-amber-700'
        : tone === 'good'
          ? 'text-emerald-700'
          : 'text-slate-900';

  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className={`text-lg font-semibold ${colour}`}>{value}</dd>
    </div>
  );
}
