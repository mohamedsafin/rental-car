/**
 * pages/BookingsPage.tsx
 * ---------------------------------------------------------------------------
 * The booking list (BRD 27), filterable by status - which is how staff find
 * today's work: everything awaiting document verification, everything ready
 * for pickup, everything due back.
 */
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import BookingStatusBadge from '../components/BookingStatusBadge';
import { useAdminBookings } from '../features/bookings/useBookingsAdmin';
import type { BookingStatus } from '../types/booking';

const STATUS_OPTIONS: BookingStatus[] = [
  'PENDING',
  'DOCUMENT_VERIFICATION',
  'PAYMENT_PENDING',
  'CONFIRMED',
  'READY_FOR_PICKUP',
  'ACTIVE',
  'EXTENSION_REQUESTED',
  'RETURN_PENDING',
  'RETURNED',
  'COMPLETED',
  'CANCELLED',
];

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: '2-digit',
  });
}

export default function BookingsPage() {
  /*
   * The filter lives in the URL, not in component state.
   *
   * The dashboard's "needs attention" tiles link here with a filter already
   * chosen - `?status=ACTIVE`, `?awaitingPayment=true`. This page used to hold
   * the status in `useState`, so it ignored those links entirely: you clicked
   * "1 booking awaiting payment", landed on all 60 bookings with "All
   * statuses" selected, could not find the one, and concluded the dashboard
   * was wrong. The count was right; the link was silently dropping the filter.
   *
   * Keeping it in the URL also makes a filtered list shareable and survives a
   * refresh, which a status dropdown someone has just set really ought to.
   */
  const [params, setParams] = useSearchParams();
  const status = (params.get('status') ?? '') as BookingStatus | '';
  const awaitingPayment = params.get('awaitingPayment') === 'true';

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');

  function applyStatus(next: BookingStatus | '') {
    const updated = new URLSearchParams(params);
    if (next) updated.set('status', next);
    else updated.delete('status');
    // The two filters ask different questions; choosing one clears the other.
    updated.delete('awaitingPayment');
    setParams(updated, { replace: true });
    setPage(1);
  }

  const { data, isPending, isError, error } = useAdminBookings({
    page,
    limit: 20,
    status: status || undefined,
    awaitingPayment: awaitingPayment || undefined,
    search: search || undefined,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-slate-900">Bookings</h2>
            {/*
              The status dropdown cannot represent this filter, so without a
              chip the list would be filtered while every visible control said
              "All statuses" - a screen quietly disagreeing with itself, which
              is the same complaint that started this.
            */}
            {awaitingPayment && (
              <button
                type="button"
                onClick={() => applyStatus('')}
                title="Clear this filter"
                className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800 hover:bg-amber-200"
              >
                Awaiting payment
                <span aria-hidden>&times;</span>
                <span className="sr-only">Clear the awaiting payment filter</span>
              </button>
            )}
          </div>
          <p className="text-sm text-slate-600">
            {data ? `${data.pagination.total} booking(s)` : 'Loading...'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* The counter's way in. Every other control here filters a list;
              this is the only one that creates something. */}
          <Link to="/bookings/new" className="btn btn-primary btn-sm">
            New booking
          </Link>
          <select
            value={status}
            onChange={(e) => applyStatus(e.target.value as BookingStatus | '')}
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          >
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
          <input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Reference, customer or plate"
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          />
        </div>
      </div>

      {isError && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error.message}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Reference</th>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Vehicle</th>
              <th className="px-4 py-3">Dates</th>
              <th className="px-4 py-3">Total</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {isPending && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                  Loading bookings...
                </td>
              </tr>
            )}

            {data?.items.map((booking) => (
              <tr key={booking.id} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-3 font-mono text-xs font-medium text-slate-900">
                  {booking.bookingNumber}
                </td>
                <td className="px-4 py-3">
                  <p className="text-slate-900">{booking.customer?.fullName ?? '-'}</p>
                  <p className="text-xs text-slate-500">{booking.customer?.email}</p>
                </td>
                <td className="px-4 py-3">
                  <p className="text-slate-900">{booking.vehicle.name}</p>
                  <p className="font-mono text-xs text-slate-500">
                    {booking.vehicle.registrationNumber}
                  </p>
                </td>
                <td className="px-4 py-3 text-xs text-slate-600">
                  {shortDate(booking.period.pickupAt)} - {shortDate(booking.period.returnAt)}
                  <span className="block text-slate-400">{booking.period.rentalDays}d</span>
                </td>
                <td className="px-4 py-3 font-medium text-slate-900">
                  {booking.pricing.currency} {booking.pricing.totalAmount}
                </td>
                <td className="px-4 py-3">
                  <BookingStatusBadge status={booking.status} label={booking.statusLabel} />
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    to={`/bookings/${booking.id}`}
                    className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Open
                  </Link>
                </td>
              </tr>
            ))}

            {data?.items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-500">
                  No bookings match those filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {data && data.pagination.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-slate-600">
            Page {data.pagination.page} of {data.pagination.totalPages}
          </span>
          <button
            type="button"
            disabled={page >= data.pagination.totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
