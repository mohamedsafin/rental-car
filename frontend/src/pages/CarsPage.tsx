/**
 * pages/CarsPage.tsx
 * ---------------------------------------------------------------------------
 * The car listing with filters (BRD 7).
 *
 * Filter state lives in the URL query string, not in useState. That is
 * deliberate: it makes a filtered listing shareable, bookmarkable, and correct
 * when the user presses Back. Copy the URL after filtering to "SUV, automatic"
 * and the person you send it to sees exactly that view.
 *
 * Two things the redesign added, both for the same reason - a fleet of thirty
 * cars is unusable without them:
 *
 *  - Active filters appear as removable chips. With filters hidden inside
 *    <select>s, "why am I only seeing four cars?" is a question the page never
 *    answers; a chip you can click off answers it.
 *  - Category is a row of buttons rather than a dropdown, because it is the
 *    filter people actually reach for first and a dropdown hides the options.
 */
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useCategories, useVehicles } from '../features/fleet/useFleet';
import VehicleCard from '../components/VehicleCard';
import { SearchIcon } from '../components/icons';
import type { VehicleFilters } from '../types/vehicle';

const SORT_OPTIONS = [
  { value: 'newest', label: 'Featured first' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' },
  { value: 'year_desc', label: 'Newest model year' },
] as const;

const FILTER_KEYS = ['category', 'transmission', 'fuelType', 'seats', 'maxPrice', 'search'];

/** How an active filter reads on its chip. */
const CHIP_LABEL: Record<string, (value: string) => string> = {
  category: (value) => value.replace(/-/g, ' '),
  transmission: (value) => (value === 'AUTOMATIC' ? 'Automatic' : 'Manual'),
  fuelType: (value) => value.charAt(0) + value.slice(1).toLowerCase(),
  seats: (value) => `${value}+ seats`,
  maxPrice: (value) => `Under AED ${value}/day`,
  search: (value) => `“${value}”`,
};

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-ink-500">{label}</span>
      {children}
    </label>
  );
}

const selectClass =
  'rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-800 transition hover:border-ink-300';

export default function CarsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: categoryData } = useCategories();

  const filters: VehicleFilters = {
    page: Number(searchParams.get('page') ?? 1),
    limit: 12,
    category: searchParams.get('category') ?? undefined,
    transmission: (searchParams.get('transmission') as VehicleFilters['transmission']) ?? undefined,
    fuelType: (searchParams.get('fuelType') as VehicleFilters['fuelType']) ?? undefined,
    seats: searchParams.get('seats') ? Number(searchParams.get('seats')) : undefined,
    maxPrice: searchParams.get('maxPrice') ? Number(searchParams.get('maxPrice')) : undefined,
    search: searchParams.get('search') ?? undefined,
    sort: (searchParams.get('sort') as VehicleFilters['sort']) ?? 'newest',
  };

  const { data, isPending, isError, error } = useVehicles(filters);

  /**
   * The search box is the one filter that must NOT write to the URL on every
   * keystroke: doing that pushes a history entry per character, so Back walks
   * the user backwards letter by letter. Local state drives the input and a
   * short debounce writes the URL once the typing stops.
   */
  const [searchDraft, setSearchDraft] = useState(searchParams.get('search') ?? '');
  const urlSearch = searchParams.get('search') ?? '';

  useEffect(() => {
    // Keep the box in step when the URL changes from elsewhere - a chip being
    // removed, or the Back button.
    setSearchDraft(urlSearch);
  }, [urlSearch]);

  useEffect(() => {
    if (searchDraft === urlSearch) return;

    const timer = setTimeout(() => {
      const next = new URLSearchParams(searchParams);
      if (searchDraft) next.set('search', searchDraft);
      else next.delete('search');
      next.delete('page');
      setSearchParams(next, { replace: true });
    }, 350);

    return () => clearTimeout(timer);
  }, [searchDraft, urlSearch, searchParams, setSearchParams]);

  /** Set or clear one filter. Changing a filter always resets to page 1. */
  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setSearchParams(next);
  }

  const activeFilters = FILTER_KEYS.map((key) => [key, searchParams.get(key)] as const).filter(
    (entry): entry is readonly [string, string] => Boolean(entry[1]),
  );

  const activeCategory = searchParams.get('category') ?? '';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink-900 sm:text-3xl">Our fleet</h1>
          <p className="mt-1 text-sm text-ink-500">
            {data
              ? `${data.pagination.total} vehicle${data.pagination.total === 1 ? '' : 's'} match${
                  data.pagination.total === 1 ? 'es' : ''
                } your filters`
              : 'Loading the fleet…'}
          </p>
        </div>

        <Field label="Sort by">
          <select
            value={filters.sort}
            onChange={(event) => setFilter('sort', event.target.value)}
            className={selectClass}
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {/* Category comes first and stays visible - it is the filter people
          reach for, and a dropdown would hide the options behind a click. */}
      {categoryData && categoryData.categories.length > 0 && (
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          <button
            type="button"
            onClick={() => setFilter('category', '')}
            className={
              activeCategory === ''
                ? 'shrink-0 rounded-full bg-ink-900 px-4 py-2 text-sm font-medium text-white'
                : 'shrink-0 rounded-full border border-ink-200 bg-white px-4 py-2 text-sm font-medium text-ink-600 transition hover:border-ink-300 hover:text-ink-900'
            }
          >
            All cars
          </button>
          {categoryData.categories.map((category) => (
            <button
              key={category.id}
              type="button"
              onClick={() => setFilter('category', category.slug)}
              className={
                activeCategory === category.slug
                  ? 'shrink-0 rounded-full bg-ink-900 px-4 py-2 text-sm font-medium text-white'
                  : 'shrink-0 rounded-full border border-ink-200 bg-white px-4 py-2 text-sm font-medium text-ink-600 transition hover:border-ink-300 hover:text-ink-900'
              }
            >
              {category.name}
            </button>
          ))}
        </div>
      )}

      <div className="rounded-card border border-ink-100 bg-white p-4 shadow-card">
        <div className="flex flex-wrap items-end gap-4">
          <Field label="Search">
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
              <input
                type="search"
                value={searchDraft}
                onChange={(event) => setSearchDraft(event.target.value)}
                placeholder="Brand or model"
                className="w-52 rounded-lg border border-ink-200 py-2 pl-9 pr-3 text-sm transition hover:border-ink-300"
              />
            </div>
          </Field>

          <Field label="Transmission">
            <select
              value={searchParams.get('transmission') ?? ''}
              onChange={(event) => setFilter('transmission', event.target.value)}
              className={selectClass}
            >
              <option value="">Any</option>
              <option value="AUTOMATIC">Automatic</option>
              <option value="MANUAL">Manual</option>
            </select>
          </Field>

          <Field label="Fuel">
            <select
              value={searchParams.get('fuelType') ?? ''}
              onChange={(event) => setFilter('fuelType', event.target.value)}
              className={selectClass}
            >
              <option value="">Any</option>
              <option value="PETROL">Petrol</option>
              <option value="DIESEL">Diesel</option>
              <option value="HYBRID">Hybrid</option>
              <option value="ELECTRIC">Electric</option>
            </select>
          </Field>

          <Field label="Passengers">
            <select
              value={searchParams.get('seats') ?? ''}
              onChange={(event) => setFilter('seats', event.target.value)}
              className={selectClass}
            >
              <option value="">Any</option>
              <option value="4">4 or more</option>
              <option value="5">5 or more</option>
              <option value="7">7 or more</option>
            </select>
          </Field>

          <Field label="Max daily rate">
            <select
              value={searchParams.get('maxPrice') ?? ''}
              onChange={(event) => setFilter('maxPrice', event.target.value)}
              className={selectClass}
            >
              <option value="">Any</option>
              <option value="150">Up to AED 150</option>
              <option value="300">Up to AED 300</option>
              <option value="500">Up to AED 500</option>
              <option value="1000">Up to AED 1,000</option>
            </select>
          </Field>
        </div>

        {activeFilters.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-ink-100 pt-4">
            <span className="text-xs font-medium text-ink-500">Filtering by</span>
            {activeFilters.map(([key, value]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key, '')}
                className="group inline-flex items-center gap-1.5 rounded-full bg-ink-100 py-1 pl-3 pr-2 text-xs font-medium capitalize text-ink-700 transition hover:bg-ink-200"
              >
                {CHIP_LABEL[key]?.(value) ?? value}
                <span aria-hidden className="text-ink-400 group-hover:text-ink-700">
                  &times;
                </span>
                <span className="sr-only">Remove this filter</span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => setSearchParams(new URLSearchParams())}
              className="ml-1 text-xs font-medium text-ink-500 underline underline-offset-2 hover:text-ink-900"
            >
              Clear all
            </button>
          </div>
        )}
      </div>

      {isError && (
        <div
          role="alert"
          className="rounded-card border border-red-200 bg-red-50 p-4 text-sm text-red-700"
        >
          {error.message}
        </div>
      )}

      {isPending ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="animate-pulse rounded-card border border-ink-100 bg-white">
              <div className="aspect-16/10 rounded-t-card bg-ink-100" />
              <div className="space-y-3 p-4">
                <div className="h-4 w-2/3 rounded bg-ink-100" />
                <div className="h-3 w-1/3 rounded bg-ink-100" />
                <div className="h-8 w-1/2 rounded bg-ink-100" />
              </div>
            </div>
          ))}
        </div>
      ) : data && data.items.length > 0 ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {data.items.map((vehicle) => (
            <VehicleCard key={vehicle.id} vehicle={vehicle} />
          ))}
        </div>
      ) : (
        <div className="rounded-card border border-dashed border-ink-200 bg-white p-12 text-center">
          <p className="font-medium text-ink-800">No vehicles match your filters</p>
          <p className="mt-1 text-sm text-ink-500">
            Try removing one of the filters above, or widen the price range.
          </p>
          <Link
            to="/cars"
            className="mt-5 inline-block rounded-lg bg-ink-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-ink-800"
          >
            Clear all filters
          </Link>
        </div>
      )}

      {data && data.pagination.totalPages > 1 && (
        <nav className="flex items-center justify-between text-sm" aria-label="Pagination">
          <button
            type="button"
            disabled={data.pagination.page <= 1}
            onClick={() => setFilter('page', String(data.pagination.page - 1))}
            className="rounded-lg border border-ink-200 bg-white px-4 py-2 font-medium text-ink-700 transition hover:border-ink-300 disabled:opacity-40 disabled:hover:border-ink-200"
          >
            Previous
          </button>
          <span className="text-ink-500">
            Page {data.pagination.page} of {data.pagination.totalPages}
          </span>
          <button
            type="button"
            disabled={data.pagination.page >= data.pagination.totalPages}
            onClick={() => setFilter('page', String(data.pagination.page + 1))}
            className="rounded-lg border border-ink-200 bg-white px-4 py-2 font-medium text-ink-700 transition hover:border-ink-300 disabled:opacity-40 disabled:hover:border-ink-200"
          >
            Next
          </button>
        </nav>
      )}
    </div>
  );
}
