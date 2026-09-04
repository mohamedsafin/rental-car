/**
 * pages/SearchResultsPage.tsx
 * ---------------------------------------------------------------------------
 * Results for a dated search (BRD 6 step 4: "views available cars").
 *
 * The important guarantee: every car shown here CAN be booked for these exact
 * dates. The backend excluded the rest. Showing a car and only revealing at
 * checkout that it is taken is the failure mode this whole phase exists to
 * prevent.
 */
import { Link, useSearchParams } from 'react-router-dom';
import SearchWidget from '../components/SearchWidget';
import VehicleCard from '../components/VehicleCard';
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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Available cars</h1>
        {hasCriteria && (
          <p className="mt-1 text-sm text-slate-600">
            {formatWhen(criteria.pickupDate, criteria.pickupTime)}
            {' \u2192 '}
            {formatWhen(criteria.returnDate, criteria.returnTime)}
          </p>
        )}
      </div>

      <SearchWidget compact initial={criteria} />

      {!hasCriteria && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center">
          <p className="font-medium text-slate-700">Choose your dates to see what is available</p>
          <Link to="/cars" className="mt-3 inline-block text-sm text-slate-900 underline">
            Or browse the whole fleet
          </Link>
        </div>
      )}

      {isError && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error.message}
        </div>
      )}

      {hasCriteria && !isError && (
        <>
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-600">
              {data ? `${data.pagination.total} available` : 'Searching...'}
            </p>
            <label className="flex items-center gap-2 text-sm">
              <span className="text-slate-600">Sort</span>
              <select
                value={searchParams.get('sort') ?? 'newest'}
                onChange={(e) => setParam('sort', e.target.value)}
                className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              >
                <option value="newest">Featured first</option>
                <option value="price_asc">Price: low to high</option>
                <option value="price_desc">Price: high to low</option>
              </select>
            </label>
          </div>

          {isPending ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="h-72 animate-pulse rounded-lg bg-slate-200" />
              ))}
            </div>
          ) : data && data.items.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
            <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center">
              <p className="font-medium text-slate-700">No cars are free for those dates</p>
              <p className="mt-1 text-sm text-slate-500">
                Try shifting your dates, or browse the full fleet to see what else we run.
              </p>
              <Link to="/cars" className="mt-4 inline-block text-sm font-medium text-slate-900 underline">
                Browse all cars
              </Link>
            </div>
          )}

          {data && data.pagination.totalPages > 1 && (
            <nav className="flex items-center justify-between text-sm" aria-label="Pagination">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setParam('page', String(page - 1))}
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
                onClick={() => setParam('page', String(page + 1))}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 disabled:opacity-40"
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
