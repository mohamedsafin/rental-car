/**
 * pages/SearchResultsPage.tsx
 * ---------------------------------------------------------------------------
 * Results for a dated search (BRD 6 step 4: "views available cars").
 *
 * The important guarantee: every car shown here CAN be booked for these exact
 * dates. The backend excluded the rest. Showing a car and only revealing at
 * checkout that it is taken is the failure mode this whole phase exists to
 * prevent.
 *
 * Also the landing point for "Rent a Car" from interior pages and for a pickup
 * point chosen on the home page (?pickupLocationId=...), which is why it shows
 * the booking bar pre-filled even before any dates are chosen.
 */
import { Link, useSearchParams } from 'react-router-dom';
import { CalendarDays } from 'lucide-react';
import SearchWidget from '../components/SearchWidget';
import VehicleCard, { VehicleCardSkeleton } from '../components/VehicleCard';
import PageHeader from '../components/PageHeader';
import { useAvailableVehicles } from '../features/booking/useBooking';
import type { SearchCriteria } from '../types/pricing';

function formatWhen(date: string, time: string): string {
  if (!date) return '';
  const parsed = new Date(`${date}T${time || '10:00'}`);
  return parsed.toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function SearchResultsPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const criteria: SearchCriteria = {
    pickupDate: searchParams.get('pickupDate') ?? '',
    pickupTime: searchParams.get('pickupTime') ?? '10:00',
    returnDate: searchParams.get('returnDate') ?? '',
    returnTime: searchParams.get('returnTime') ?? '10:00',
    pickupLocationId: searchParams.get('pickupLocationId') ?? undefined,
    dropoffLocationId: searchParams.get('dropoffLocationId') ?? undefined,
  };

  const page = Number(searchParams.get('page') ?? 1);
  const hasCriteria = Boolean(criteria.pickupDate && criteria.returnDate);

  const { data, isPending, isError, error } = useAvailableVehicles(
    hasCriteria ? criteria : null,
    { page, limit: 12, sort: searchParams.get('sort') ?? 'newest' },
  );

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setSearchParams(next);
  }

  return (
    <div className="page-container pt-10 sm:pt-14">
      <PageHeader
        eyebrow="Availability"
        title={
          <>
            Available <span className="font-editorial">cars.</span>
          </>
        }
        description={
          hasCriteria ? (
            <span className="inline-flex flex-wrap items-center gap-2">
              <CalendarDays aria-hidden className="h-4 w-4 text-ink-400" />
              {formatWhen(criteria.pickupDate, criteria.pickupTime)}
              <span aria-hidden className="text-ink-300">
                &rarr;
              </span>
              <span className="sr-only">to</span>
              {formatWhen(criteria.returnDate, criteria.returnTime)}
            </span>
          ) : (
            'Choose where and when, and we show only the cars genuinely free for those dates.'
          )
        }
      />

      <div className="mt-10">
        <SearchWidget initial={criteria} />
      </div>

      {!hasCriteria && (
        <div className="mt-10 rounded-card border border-dashed border-ink-300 px-6 py-14 text-center">
          <p className="text-lg font-semibold text-ink-950">Choose your dates to see what is available</p>
          <Link to="/cars" className="link-arrow mt-3">
            Or browse the whole fleet
          </Link>
        </div>
      )}

      {isError && (
        <div role="alert" className="mt-8 rounded-card border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error.message}
        </div>
      )}

      {hasCriteria && !isError && (
        <>
          <div className="mt-12 flex flex-wrap items-center justify-between gap-4 border-b border-ink-100 pb-5">
            <p className="text-[15px] text-ink-700" role="status">
              {data ? (
                <>
                  <span className="font-semibold text-ink-950">{data.pagination.total}</span> available
                  for your dates
                </>
              ) : (
                'Searching…'
              )}
            </p>
            <label className="flex items-center gap-3">
              <span className="text-sm text-ink-500">Sort by</span>
              <select
                value={searchParams.get('sort') ?? 'newest'}
                onChange={(e) => setParam('sort', e.target.value)}
                className="field-control min-h-0 w-auto py-2.5 text-sm"
              >
                <option value="newest">Featured first</option>
                <option value="price_asc">Price: low to high</option>
                <option value="price_desc">Price: high to low</option>
              </select>
            </label>
          </div>

          <div className="mt-8">
            {isPending ? (
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 6 }).map((_, index) => (
                  <VehicleCardSkeleton key={index} />
                ))}
              </div>
            ) : data && data.items.length > 0 ? (
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {data.items.map((vehicle) => (
                  <VehicleCard
                    key={vehicle.id}
                    vehicle={vehicle}
                    // Carry the dates through, so the details page can quote
                    // immediately instead of asking for them again.
                    detailsQuery={new URLSearchParams({
                      pickupDate: criteria.pickupDate,
                      pickupTime: criteria.pickupTime,
                      returnDate: criteria.returnDate,
                      returnTime: criteria.returnTime,
                      ...(criteria.pickupLocationId
                        ? { pickupLocationId: criteria.pickupLocationId }
                        : {}),
                    }).toString()}
                  />
                ))}
              </div>
            ) : (
              <div className="rounded-card border border-dashed border-ink-300 px-6 py-14 text-center">
                <p className="text-lg font-semibold text-ink-950">No cars are free for those dates</p>
                <p className="mx-auto mt-1.5 max-w-sm text-sm text-ink-500">
                  Try shifting your dates, or browse the full fleet to see what else we run.
                </p>
                <Link to="/cars" className="btn btn-primary mt-6">
                  Browse all cars
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
        </>
      )}
    </div>
  );
}
