/**
 * pages/MyBookingsPage.tsx
 * ---------------------------------------------------------------------------
 * "My Bookings" (BRD 22), grouped the way the BRD asks: upcoming, active,
 * previous, cancelled.
 *
 * The tab lives in the URL so a customer can bookmark or share their active
 * rentals, and Back works.
 */
import { Link, useSearchParams } from 'react-router-dom';
import BookingStatusBadge from '../components/BookingStatusBadge';
import { useMyBookings } from '../features/bookings/useBookings';

const TABS = [
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'active', label: 'Active rentals' },
  { key: 'previous', label: 'Previous' },
  { key: 'cancelled', label: 'Cancelled' },
] as const;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function MyBookingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const scope = searchParams.get('scope') ?? 'upcoming';
  const page = Number(searchParams.get('page') ?? 1);

  const { data, isPending, isError, error } = useMyBookings({ scope, page, limit: 10 });

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    next.set(key, value);
    if (key !== 'page') next.delete('page');
    setSearchParams(next);
  }

  return (
    <div className="space-y-6">
      <div>
        <Link to="/account" className="text-sm text-ink-500 hover:underline">
          &larr; My account
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-ink-900">My bookings</h1>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-ink-200 pb-3">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setParam('scope', tab.key)}
            className={
              scope === tab.key
                ? 'rounded-md bg-ink-900 px-3 py-1.5 text-sm font-medium text-white'
                : 'rounded-md px-3 py-1.5 text-sm font-medium text-ink-600 hover:bg-ink-100'
            }
          >
            {tab.label}
          </button>
        ))}
      </div>

      {isError && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error.message}
        </div>
      )}

      {isPending ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="h-28 animate-pulse rounded-lg bg-ink-200" />
          ))}
        </div>
      ) : data && data.items.length > 0 ? (
        <ul className="space-y-3">
          {data.items.map((booking) => (
            <li key={booking.id}>
              <Link
                to={`/account/bookings/${booking.id}`}
                className="flex gap-4 rounded-lg border border-ink-200 bg-white p-4 transition hover:shadow-sm"
              >
                <div className="h-20 w-28 shrink-0 overflow-hidden rounded bg-ink-100">
                  {booking.vehicle.imageUrl && (
                    <img
                      src={`http://localhost:4000${booking.vehicle.imageUrl}`}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-ink-900">{booking.vehicle.name}</p>
                    <BookingStatusBadge status={booking.status} label={booking.statusLabel} />
                  </div>
                  <p className="mt-1 text-xs text-ink-500">{booking.bookingNumber}</p>
                  <p className="mt-1 text-sm text-ink-600">
                    {formatDate(booking.period.pickupAt)} &rarr; {formatDate(booking.period.returnAt)}
                  </p>
                </div>

                <div className="shrink-0 text-right">
                  <p className="font-semibold text-ink-900">
                    {booking.pricing.currency} {booking.pricing.totalAmount}
                  </p>
                  <p className="text-xs text-ink-500">
                    {booking.period.rentalDays} day{booking.period.rentalDays === 1 ? '' : 's'}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-lg border border-dashed border-ink-300 bg-white p-10 text-center">
          <p className="font-medium text-ink-700">Nothing here yet</p>
          <Link to="/cars" className="mt-3 inline-block text-sm text-ink-900 underline">
            Browse cars
          </Link>
        </div>
      )}

      {data && data.pagination.totalPages > 1 && (
        <nav className="flex items-center justify-between text-sm" aria-label="Pagination">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setParam('page', String(page - 1))}
            className="rounded-md border border-ink-300 bg-white px-3 py-1.5 disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-ink-600">
            Page {data.pagination.page} of {data.pagination.totalPages}
          </span>
          <button
            type="button"
            disabled={page >= data.pagination.totalPages}
            onClick={() => setParam('page', String(page + 1))}
            className="rounded-md border border-ink-300 bg-white px-3 py-1.5 disabled:opacity-40"
          >
            Next
          </button>
        </nav>
      )}
    </div>
  );
}
