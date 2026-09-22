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
 * Two things that make a fleet of thirty cars usable:
 *
 *  - Active filters appear as removable chips. With filters hidden inside
 *    <select>s, "why am I only seeing four cars?" is a question the page never
 *    answers; a chip you can click off answers it.
 *  - Category is a row of pills rather than a dropdown, because it is the
 *    filter people actually reach for first and a dropdown hides the options.
 */
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search, X } from 'lucide-react';
import { useCategories, useVehicles } from '../features/fleet/useFleet';
import VehicleCard, { VehicleCardSkeleton } from '../components/VehicleCard';
import PageHeader from '../components/PageHeader';
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

function Field({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`flex min-w-0 flex-col ${className}`}>
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

const PILL_ACTIVE =
  'shrink-0 rounded-full border border-ink-950 bg-ink-950 px-4 py-2 text-sm font-medium text-white';
const PILL_IDLE =
  'shrink-0 rounded-full border border-ink-200 bg-white px-4 py-2 text-sm font-medium text-ink-700 transition-colors hover:border-ink-950 hover:text-ink-950';

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
    <div className="page-container pt-10 sm:pt-14">
      <PageHeader
        eyebrow="The fleet"
        title={
          <>
            Browse <span className="font-editorial">the fleet.</span>
          </>
        }
        description={
          data
            ? `${data.pagination.total} vehicle${data.pagination.total === 1 ? '' : 's'} match${
                data.pagination.total === 1 ? 'es' : ''
              } your filters.`
            : 'Loading the fleet…'
        }
        actions={
          <label className="flex items-center gap-3">
            <span className="text-sm text-ink-500">Sort by</span>
            <select
              value={filters.sort}
              onChange={(event) => setFilter('sort', event.target.value)}
              className="field-control min-h-0 w-auto py-2.5 text-sm"
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        }
      />

      {/* Category first and always visible - the filter people reach for. */}
      {categoryData && categoryData.categories.length > 0 && (
        <div className="no-scrollbar -mx-(--gutter) mt-10 flex gap-2 overflow-x-auto px-(--gutter) pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
          <button
            type="button"
            onClick={() => setFilter('category', '')}
            aria-pressed={activeCategory === ''}
            className={activeCategory === '' ? PILL_ACTIVE : PILL_IDLE}
          >
            All cars
          </button>
          {categoryData.categories.map((category) => (
            <button
              key={category.id}
              type="button"
              onClick={() => setFilter('category', category.slug)}
              aria-pressed={activeCategory === category.slug}
              className={activeCategory === category.slug ? PILL_ACTIVE : PILL_IDLE}
            >
              {category.name}
              {typeof category._count?.vehicles === 'number' && (
                <span
                  className={`ml-1.5 tabular text-xs ${
                    activeCategory === category.slug ? 'text-white/70' : 'text-ink-500'
                  }`}
                >
                  {category._count.vehicles}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      <div className="mt-6 rounded-[20px] bg-ink-50 p-3 sm:p-4">
        {/* Two filters per row on phones, search full width: stacked singly,
            five controls filled a whole screen before the first car. */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(0,1fr))]">
          <Field label="Search" className="col-span-2 lg:col-span-1">
            <div className="relative">
              <Search
                aria-hidden
                className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400"
              />
              <input
                type="search"
                value={searchDraft}
                onChange={(event) => setSearchDraft(event.target.value)}
                placeholder="Brand or model"
                className="field-control field-control-icon"
              />
            </div>
          </Field>

          <Field label="Transmission">
            <select
              value={searchParams.get('transmission') ?? ''}
              onChange={(event) => setFilter('transmission', event.target.value)}
              className="field-control"
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
              className="field-control"
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
              className="field-control"
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
              className="field-control"
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
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-ink-200 px-1 pt-4">
            <span className="text-xs font-medium text-ink-500">Filtering by</span>
            {activeFilters.map(([key, value]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key, '')}
                className="group inline-flex items-center gap-1.5 rounded-full border border-ink-200 bg-white py-1 pl-3 pr-2 text-xs font-medium capitalize text-ink-800 transition-colors hover:border-ink-950"
              >
                {CHIP_LABEL[key]?.(value) ?? value}
                <X aria-hidden className="h-3.5 w-3.5 text-ink-400 group-hover:text-ink-950" />
                <span className="sr-only">Remove this filter</span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => setSearchParams(new URLSearchParams())}
              className="ml-1 text-xs font-semibold text-ink-700 underline underline-offset-4 hover:text-ink-950"
            >
              Clear all
            </button>
          </div>
        )}
      </div>

      {isError && (
        <div role="alert" className="mt-8 rounded-card border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error.message}
        </div>
      )}

      <div className="mt-10">
        {isPending ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <VehicleCardSkeleton key={index} />
            ))}
          </div>
        ) : data && data.items.length > 0 ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {data.items.map((vehicle) => (
              <VehicleCard key={vehicle.id} vehicle={vehicle} />
            ))}
          </div>
        ) : (
          <div className="rounded-card border border-dashed border-ink-300 px-6 py-16 text-center">
            <p className="text-lg font-semibold text-ink-950">No vehicles match your filters</p>
            <p className="mx-auto mt-1.5 max-w-sm text-sm text-ink-500">
              Try removing one of the filters above, or widen the price range.
            </p>
            <Link to="/cars" className="btn btn-primary mt-6">
              Clear all filters
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
            disabled={data.pagination.page <= 1}
            onClick={() => setFilter('page', String(data.pagination.page - 1))}
            className="btn btn-outline"
          >
            Previous
          </button>
          <span className="tabular text-ink-500">
            Page {data.pagination.page} of {data.pagination.totalPages}
          </span>
          <button
            type="button"
            disabled={data.pagination.page >= data.pagination.totalPages}
            onClick={() => setFilter('page', String(data.pagination.page + 1))}
            className="btn btn-outline"
          >
            Next
          </button>
        </nav>
      )}
    </div>
  );
}
