/**
 * pages/InspectionsPage.tsx
 * ---------------------------------------------------------------------------
 * Every inspection across the fleet (BRD 25).
 *
 * Read-only, deliberately. An inspection is recorded at pickup and at return by
 * the person standing at the car; there is no way to create one from this
 * screen, because an inspection recorded away from the vehicle is a fiction and
 * a fabricated baseline is what makes a damage charge indefensible.
 *
 * What this board IS for: spotting the handover nobody photographed, and the
 * return whose damage notes never became a damage record. Both are how a
 * chargeable dent quietly turns into a write-off.
 */
import { useSearchParams, Link } from 'react-router-dom';
import { useInspections } from '../features/operations/useOperations';

export default function InspectionsPage() {
  const [params, setParams] = useSearchParams();
  const type = params.get('type') ?? '';
  const withFindings = params.get('findings') === 'true';
  const page = Number(params.get('page') ?? '1');

  const { data, isPending } = useInspections({
    page,
    limit: 25,
    type: type || undefined,
    withFindings: withFindings || undefined,
  });

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next);
  }

  const items = data?.items ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Inspections</h2>
        <p className="text-sm text-slate-500">
          The condition record at each end of a rental. Recorded at the car, never from here.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {[
          { value: '', label: 'All' },
          { value: 'PICKUP', label: 'At pickup' },
          { value: 'RETURN', label: 'At return' },
        ].map((option) => (
          <button
            key={option.value || 'all'}
            type="button"
            onClick={() => setParam('type', option.value)}
            className={
              type === option.value
                ? 'rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white'
                : 'rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700'
            }
          >
            {option.label}
          </button>
        ))}

        <label className="ml-2 flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={withFindings}
            onChange={(event) => setParam('findings', event.target.checked ? 'true' : '')}
            className="rounded border-slate-300"
          />
          Only ones with notes or damage
        </label>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        {isPending && <p className="px-5 py-8 text-sm text-slate-500">Loading...</p>}

        {!isPending && items.length === 0 && (
          <p className="px-5 py-10 text-center text-sm text-slate-500">
            No inspections recorded yet. They appear here once a vehicle is handed over.
          </p>
        )}

        <ul className="divide-y divide-slate-100">
          {items.map((inspection) => (
            <li key={inspection.id} className="px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={
                        inspection.type === 'PICKUP'
                          ? 'rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800'
                          : 'rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800'
                      }
                    >
                      {inspection.type === 'PICKUP' ? 'at pickup' : 'at return'}
                    </span>
                    <span className="font-medium text-slate-900">{inspection.vehicle}</span>
                    <span className="text-xs text-slate-500">{inspection.registrationNumber}</span>
                    {/*
                      No photographs is worth flagging on its own. Photos are
                      what make a damage charge defensible three months later.
                    */}
                    {inspection.photoCount === 0 && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                        no photos
                      </span>
                    )}
                  </div>

                  <p className="mt-1 text-xs text-slate-500">
                    {inspection.bookingNumber} · {inspection.customer} ·{' '}
                    {new Date(inspection.createdAt).toLocaleString()}
                    {inspection.inspectedBy ? ` · by ${inspection.inspectedBy}` : ''}
                  </p>

                  {inspection.damageNotes && (
                    <p className="mt-2 rounded-md bg-red-50 px-3 py-1.5 text-xs text-red-800">
                      Damage: {inspection.damageNotes}
                    </p>
                  )}
                  {inspection.conditionNotes && (
                    <p className="mt-1 text-xs text-slate-600">
                      Condition: {inspection.conditionNotes}
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 items-start gap-4">
                  <div className="text-right text-xs text-slate-600">
                    <p>{inspection.mileage.toLocaleString()} km</p>
                    <p>{inspection.fuelPercent}% fuel</p>
                    <p className="text-slate-400">{inspection.photoCount} photo(s)</p>
                  </div>
                  <Link
                    to={`/bookings/${inspection.bookingId}`}
                    className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-700"
                  >
                    Open booking
                  </Link>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {data && data.pagination.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-slate-600">
          <span>
            Page {data.pagination.page} of {data.pagination.totalPages}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setParam('page', String(page - 1))}
              className="rounded-md border border-slate-300 px-3 py-1.5 disabled:opacity-50"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={page >= data.pagination.totalPages}
              onClick={() => setParam('page', String(page + 1))}
              className="rounded-md border border-slate-300 px-3 py-1.5 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
