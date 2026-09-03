/**
 * pages/VehiclesPage.tsx
 * ---------------------------------------------------------------------------
 * The fleet list (BRD 36).
 *
 * Shows what customers cannot see: registration numbers, unpublished vehicles
 * and operational status. All of that comes from the same /vehicles endpoint -
 * the backend widens the response because the caller holds an admin token, not
 * because this page asked nicely.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAdminCategories, useAdminVehicles } from '../features/fleet/useFleetAdmin';
import type { VehicleStatus } from '../types/vehicle';

const STATUS_STYLE: Record<VehicleStatus, string> = {
  AVAILABLE: 'bg-emerald-100 text-emerald-800',
  RESERVED: 'bg-amber-100 text-amber-800',
  RENTED: 'bg-blue-100 text-blue-800',
  UNDER_INSPECTION: 'bg-purple-100 text-purple-800',
  UNDER_MAINTENANCE: 'bg-orange-100 text-orange-800',
  UNAVAILABLE: 'bg-slate-200 text-slate-700',
};

export default function VehiclesPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');

  const { data: categoryData } = useAdminCategories();
  const { data, isPending, isError, error } = useAdminVehicles({
    page,
    limit: 20,
    search: search || undefined,
    category: category || undefined,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Vehicles</h2>
          <p className="text-sm text-slate-600">
            {data ? `${data.pagination.total} in the fleet` : 'Loading...'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Brand, model or plate"
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          />
          <select
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setPage(1);
            }}
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          >
            <option value="">All categories</option>
            {categoryData?.categories.map((c) => (
              <option key={c.id} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>
          <Link
            to="/vehicles/new"
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
          >
            Add vehicle
          </Link>
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
              <th className="px-4 py-3">Vehicle</th>
              <th className="px-4 py-3">Plate</th>
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3">Daily rate</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Published</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {isPending && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                  Loading vehicles...
                </td>
              </tr>
            )}

            {data?.items.map((vehicle) => (
              <tr key={vehicle.id} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-14 shrink-0 overflow-hidden rounded bg-slate-100">
                      {vehicle.primaryImageUrl && (
                        <img src={vehicle.primaryImageUrl} alt="" className="h-full w-full object-cover" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-900">{vehicle.name}</p>
                      <p className="text-xs text-slate-500">
                        {vehicle.year} - {vehicle.seats} seats
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-slate-600">
                  {vehicle.registrationNumber ?? '-'}
                </td>
                <td className="px-4 py-3 text-slate-600">{vehicle.category.name}</td>
                <td className="px-4 py-3 font-medium text-slate-900">
                  {vehicle.pricing.currency} {vehicle.pricing.daily}
                </td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[vehicle.status]}`}>
                    {vehicle.status.replace(/_/g, ' ')}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {vehicle.isPublished ? (
                    <span className="text-xs text-emerald-700">Live</span>
                  ) : (
                    <span className="text-xs text-slate-400">Hidden</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    to={`/vehicles/${vehicle.id}`}
                    className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Edit
                  </Link>
                </td>
              </tr>
            ))}

            {data?.items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center">
                  <p className="font-medium text-slate-700">No vehicles yet</p>
                  <Link to="/vehicles/new" className="mt-2 inline-block text-sm text-slate-900 underline">
                    Add your first vehicle
                  </Link>
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
