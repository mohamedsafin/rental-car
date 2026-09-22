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
import { ArrowRight, CalendarDays, CarFront } from 'lucide-react';
import BookingStatusBadge from '../components/BookingStatusBadge';
import PageHeader from '../components/PageHeader';
import { useMyBookings } from '../features/bookings/useBookings';
import { API_ORIGIN } from '../utils/apiOrigin';

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
    <div className="page-container pt-10 sm:pt-14">
      <PageHeader
        back={{ to: '/account', label: 'My account' }}
        eyebrow="Bookings"
        title={
          <>
            My <span className="font-editorial">bookings.</span>
          </>
        }
        actions={
          <Link to="/cars" className="btn btn-outline">
            Book another car
            <ArrowRight aria-hidden className="btn-arrow h-4 w-4" />
          </Link>
        }
      />

      <div className="no-scrollbar mt-10 flex gap-7 overflow-x-auto border-b border-ink-200">
        {TABS.map((tab) => {
          const active = scope === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setParam('scope', tab.key)}
              aria-pressed={active}
              className={`-mb-px shrink-0 whitespace-nowrap border-b-2 pb-3.5 text-sm font-medium transition-colors ${
                active
                  ? 'border-accent-500 text-ink-950'
                  : 'border-transparent text-ink-500 hover:text-ink-950'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {isError && (
        <div role="alert" className="mt-8 rounded-card border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error.message}
        </div>
      )}

      <div className="mt-8">
        {isPending ? (
          <div className="space-y-3" aria-hidden>
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="h-32 animate-pulse rounded-card bg-ink-100" />
            ))}
          </div>
        ) : data && data.items.length > 0 ? (
          <ul className="space-y-3">
            {data.items.map((booking) => (
              <li key={booking.id}>
                <Link
                  to={`/account/bookings/${booking.id}`}
                  className="group surface surface-interactive flex flex-col gap-4 p-3 sm:flex-row sm:items-center sm:gap-6 sm:p-3.5"
                >
                  <div className="image-stage h-40 w-full shrink-0 overflow-hidden rounded-xl sm:h-24 sm:w-36">
                    {booking.vehicle.imageUrl ? (
                      <img
                        src={`${API_ORIGIN}${booking.vehicle.imageUrl}`}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="flex h-full items-center justify-center">
                        <CarFront aria-hidden className="h-6 w-6 text-ink-400" strokeWidth={1.5} />
                      </span>
                    )}
                  </div>

                  <div className="min-w-0 flex-1 px-1 sm:px-0">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <p className="text-base font-semibold tracking-tight text-ink-950">{booking.vehicle.name}</p>
                      <BookingStatusBadge status={booking.status} label={booking.statusLabel} />
                    </div>
                    <p className="tabular mt-1 font-mono text-xs text-ink-500">{booking.bookingNumber}</p>
                    <p className="mt-2 flex flex-wrap items-center gap-1.5 text-sm text-ink-600">
                      <CalendarDays aria-hidden className="h-4 w-4 text-ink-400" />
                      {formatDate(booking.period.pickupAt)}
                      <span aria-hidden className="text-ink-300">
                        &rarr;
                      </span>
                      <span className="sr-only">to</span>
                      {formatDate(booking.period.returnAt)}
                    </p>
                  </div>

                  <div className="flex items-center justify-between gap-5 border-t border-ink-100 px-1 pt-3 sm:border-0 sm:px-0 sm:pr-3 sm:pt-0">
                    <div className="sm:text-right">
                      <p className="tabular text-base font-semibold text-ink-950">
                        {booking.pricing.currency} {booking.pricing.totalAmount}
                      </p>
                      <p className="text-xs text-ink-500">
                        {booking.period.rentalDays} day{booking.period.rentalDays === 1 ? '' : 's'}
                      </p>
                    </div>
                    <ArrowRight aria-hidden className="link-arrow-icon h-4 w-4 text-ink-400" />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="rounded-card border border-dashed border-ink-300 px-6 py-14 text-center">
            <p className="text-lg font-semibold text-ink-950">Nothing here yet</p>
            <p className="mx-auto mt-1.5 max-w-sm text-sm text-ink-500">
              Bookings you make appear here, grouped by where they are in the rental.
            </p>
            <Link to="/cars" className="btn btn-primary mt-6">
              Browse cars
            </Link>
          </div>
        )}
      </div>

      {data && data.pagination.totalPages > 1 && (
        <nav
          className="mt-12 flex items-center justify-between border-t border-ink-100 pt-6 text-sm"
          aria-label="Pagination"
        >
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setParam('page', String(page - 1))}
            className="btn btn-outline"
          >
            Previous
          </button>
          <span className="tabular text-ink-500">
            Page {data.pagination.page} of {data.pagination.totalPages}
          </span>
          <button
            type="button"
            disabled={page >= data.pagination.totalPages}
            onClick={() => setParam('page', String(page + 1))}
            className="btn btn-outline"
          >
            Next
          </button>
        </nav>
      )}
    </div>
  );
}
