/**
 * pages/CarsPage.tsx
 * ---------------------------------------------------------------------------
 * The car listing with filters (BRD 7).
 *
 * Filter state lives in the URL query string, not in useState. That is
 * deliberate: it makes a filtered listing shareable, bookmarkable, and correct
 * when the user presses Back. Copy the URL after filtering to "SUV, automatic"
 * and the person you send it to sees exactly that view.
 */
import type { ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useCategories, useVehicles } from '../features/fleet/useFleet';
import VehicleCard from '../components/VehicleCard';
import type { VehicleFilters } from '../types/vehicle';

const SORT_OPTIONS = [
  { value: 'newest', label: 'Featured first' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' },
  { value: 'year_desc', label: 'Newest model year' },
] as const;

const FILTER_KEYS = ['category', 'transmission', 'fuelType', 'seats', 'maxPrice', 'search'];

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}

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

  /** Set or clear one filter. Changing a filter always resets to page 1. */
  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setSearchParams(next);
  }

  const hasFilters = FILTER_KEYS.some((key) => searchParams.get(key));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Our fleet</h1>
        <p className="mt-1 text-sm text-slate-600">
          {data
            ? `${data.pagination.total} vehicle${data.pagination.total === 1 ? '' : 's'} available`
            : 'Loading...'}
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <Field label="Search">
          <input
            type="search"
            defaultValue={searchParams.get('search') ?? ''}
            onChange={(e) => setFilter('search', e.target.value)}
            placeholder="Brand or model"
            className="w-44 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
        </Field>

        <Field label="Category">
          <select
            value={searchParams.get('category') ?? ''}
            onChange={(e) => setFilter('category', e.target.value)}
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          >
            <option value="">All</option>
            {categoryData?.categories.map((category) => (
              <option key={category.id} value={category.slug}>
                {category.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Transmission">
          <select
            value={searchParams.get('transmission') ?? ''}
            onChange={(e) => setFilter('transmission', e.target.value)}
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          >
            <option value="">Any</option>
            <option value="AUTOMATIC">Automatic</option>
            <option value="MANUAL">Manual</option>
          </select>
        </Field>

        <Field label="Fuel">
          <select
            value={searchParams.get('fuelType') ?? ''}
            onChange={(e) => setFilter('fuelType', e.target.value)}
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          >
            <option value="">Any</option>
            <option value="PETROL">Petrol</option>
            <option value="DIESEL">Diesel</option>
            <option value="HYBRID">Hybrid</option>
            <option value="ELECTRIC">Electric</option>
          </select>
        </Field>

        <Field label="Sort by">
          <select
            value={filters.sort}
            onChange={(e) => setFilter('sort', e.target.value)}
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>

        {hasFilters && (
          <button
            type="button"
            onClick={() => setSearchParams(new URLSearchParams())}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
          >
            Clear filters
          </button>
        )}
      </div>

      {isError && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error.message}
        </div>
      )}

      {isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="h-72 animate-pulse rounded-lg bg-slate-200" />
          ))}
        </div>
      ) : data && data.items.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.items.map((vehicle) => (
            <VehicleCard key={vehicle.id} vehicle={vehicle} />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center">
          <p className="font-medium text-slate-700">No vehicles match your filters</p>
          <p className="mt-1 text-sm text-slate-500">Try widening your search.</p>
          <Link to="/cars" className="mt-4 inline-block text-sm font-medium text-slate-900 underline">
            Clear filters
          </Link>
        </div>
      )}

      {data && data.pagination.totalPages > 1 && (
        <nav className="flex items-center justify-between text-sm" aria-label="Pagination">
          <button
            type="button"
            disabled={data.pagination.page <= 1}
            onClick={() => setFilter('page', String(data.pagination.page - 1))}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-slate-600">
            Page {data.pagination.page} of {data.pagination.totalPages}
          </span>
          <button
            type="button"
            disabled={data.pagination.page >= data.pagination.totalPages}
            onClick={() => setFilter('page', String(data.pagination.page + 1))}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 disabled:opacity-40"
          >
            Next
          </button>
        </nav>
      )}
    </div>
  );
}
