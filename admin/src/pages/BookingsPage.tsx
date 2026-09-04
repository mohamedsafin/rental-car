/**
 * pages/BookingsPage.tsx
 * ---------------------------------------------------------------------------
 * The booking list (BRD 27), filterable by status - which is how staff find
 * today's work: everything awaiting document verification, everything ready
 * for pickup, everything due back.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
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
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<BookingStatus | ''>('');
  const [search, setSearch] = useState('');

  const { data, isPending, isError, error } = useAdminBookings({
    page,
    limit: 20,
    status: status || undefined,
    search: search || undefined,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Bookings</h2>
          <p className="text-sm text-slate-600">
            {data ? `${data.pagination.total} booking(s)` : 'Loading...'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as BookingStatus | '');
              setPage(1);
            }}
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
