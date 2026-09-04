/**
 * pages/MaintenancePage.tsx
 * ---------------------------------------------------------------------------
 * Workshop scheduling (BRD 39).
 *
 * The form asks for a START and an END, not a checkbox. That is the whole
 * design: booking a car in for a service next month must not remove it from
 * search today. If a booking already covers the window the API answers 409,
 * and its message is shown as-is - it names the booking and its dates, which
 * is exactly what the person scheduling needs in order to decide what to do.
 */
import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  useMaintenance,
  useScheduleMaintenance,
  useUpdateMaintenanceStatus,
} from '../features/fleetOps/useFleetOps';
import { useAdminVehicles } from '../features/fleet/useFleetAdmin';
import FormField from '../components/FormField';

const TYPES = ['ROUTINE_SERVICE', 'REPAIR', 'TYRE_CHANGE', 'BODYWORK', 'INSPECTION', 'OTHER'];
const STATUSES = ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];

const STATUS_STYLE: Record<string, string> = {
  SCHEDULED: 'bg-amber-100 text-amber-800',
  IN_PROGRESS: 'bg-blue-100 text-blue-800',
  COMPLETED: 'bg-emerald-100 text-emerald-800',
  CANCELLED: 'bg-slate-100 text-slate-600',
};

const EMPTY = {
  vehicleId: '',
  type: 'ROUTINE_SERVICE',
  startsAt: '',
  endsAt: '',
  description: '',
  provider: '',
  cost: '',
  mileage: '',
};

function formatWindow(startsAt: string, endsAt: string): string {
  const from = new Date(startsAt);
  const to = new Date(endsAt);
  return `${from.toLocaleDateString()} ${from.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${to.toLocaleDateString()} ${to.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

export default function MaintenancePage() {
  // Filter state lives in the URL, so "everything in the workshop right now"
  // is a shareable link and the Back button behaves.
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const page = Number(params.get('page') ?? '1');

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);

  const { data, isPending } = useMaintenance({ page, limit: 20, status: status || undefined });
  const { data: vehicles } = useAdminVehicles({ page: 1, limit: 100 });
  const schedule = useScheduleMaintenance();
  const updateStatus = useUpdateMaintenanceStatus();

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    schedule.mutate(
      {
        vehicleId: form.vehicleId,
        type: form.type,
        startsAt: new Date(form.startsAt).toISOString(),
        endsAt: new Date(form.endsAt).toISOString(),
        description: form.description,
        provider: form.provider || undefined,
        cost: form.cost || undefined,
        mileage: form.mileage ? Number(form.mileage) : undefined,
      },
      {
        onSuccess: () => {
          setShowForm(false);
          setForm(EMPTY);
        },
        // The 409 body names the clashing booking. Passing it through
        // unchanged is far more useful than "could not schedule".
        onError: (err) => setError(err.message),
      },
    );
  }

  const items = data?.items ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Maintenance</h2>
          <p className="text-sm text-slate-500">
            A scheduled window takes the vehicle off the calendar for those dates only.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((open) => !open)}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          {showForm ? 'Cancel' : 'Schedule work'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={submit} className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
          {error && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
              {error}
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="vehicleId" className="block text-sm font-medium text-slate-700">
                Vehicle
              </label>
              <select
                id="vehicleId"
                required
                value={form.vehicleId}
                onChange={(event) => setForm({ ...form, vehicleId: event.target.value })}
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">Select a vehicle</option>
                {(vehicles?.items ?? []).map((vehicle) => (
                  <option key={vehicle.id} value={vehicle.id}>
                    {vehicle.brand} {vehicle.model} ({vehicle.registrationNumber})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="type" className="block text-sm font-medium text-slate-700">
                Type
              </label>
              <select
                id="type"
                value={form.type}
                onChange={(event) => setForm({ ...form, type: event.target.value })}
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                {TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type.replace(/_/g, ' ').toLowerCase()}
                  </option>
                ))}
              </select>
            </div>

            <FormField
              label="Off the road from"
              name="startsAt"
              type="datetime-local"
              required
              value={form.startsAt}
              onChange={(event) => setForm({ ...form, startsAt: event.target.value })}
            />
            <FormField
              label="Back on the road"
              name="endsAt"
              type="datetime-local"
              required
              value={form.endsAt}
              onChange={(event) => setForm({ ...form, endsAt: event.target.value })}
              hint="The vehicle is bookable again from this moment."
            />
            <FormField
              label="Work required"
              name="description"
              required
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
            <FormField
              label="Garage / provider"
              name="provider"
              value={form.provider}
              onChange={(event) => setForm({ ...form, provider: event.target.value })}
            />
            <FormField
              label="Cost (AED)"
              name="cost"
              inputMode="decimal"
              value={form.cost}
              onChange={(event) => setForm({ ...form, cost: event.target.value })}
            />
            <FormField
              label="Odometer (km)"
              name="mileage"
              inputMode="numeric"
              value={form.mileage}
              onChange={(event) => setForm({ ...form, mileage: event.target.value })}
            />
          </div>

          <button
            type="submit"
            disabled={schedule.isPending}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {schedule.isPending ? 'Scheduling...' : 'Schedule'}
          </button>
        </form>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setParam('status', '')}
          className={
            status === ''
              ? 'rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white'
              : 'rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700'
          }
        >
          All
        </button>
        {STATUSES.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setParam('status', value)}
            className={
              status === value
                ? 'rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white'
                : 'rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700'
            }
          >
            {value.replace(/_/g, ' ').toLowerCase()}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        {isPending && <p className="px-5 py-8 text-sm text-slate-500">Loading...</p>}

        {!isPending && items.length === 0 && (
          <p className="px-5 py-8 text-sm text-slate-500">No maintenance recorded.</p>
        )}

        {items.length > 0 && (
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Vehicle</th>
                <th className="px-4 py-3">Work</th>
                <th className="px-4 py-3">Off the road</th>
                <th className="px-4 py-3">Cost</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((record) => (
                <tr key={record.id}>
                  <td className="px-4 py-3 text-slate-900">{record.vehicle ?? record.vehicleId}</td>
                  <td className="px-4 py-3">
                    <p className="text-slate-900">{record.description}</p>
                    <p className="text-xs text-slate-500">
                      {record.type.replace(/_/g, ' ').toLowerCase()}
                      {record.provider ? ` - ${record.provider}` : ''}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {formatWindow(record.startsAt, record.endsAt)}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {record.cost ? `${record.currency} ${record.cost}` : '-'}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        STATUS_STYLE[record.status] ?? 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {record.status.replace(/_/g, ' ').toLowerCase()}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {(record.status === 'SCHEDULED' || record.status === 'IN_PROGRESS') && (
                      <div className="flex justify-end gap-2">
                        {record.status === 'SCHEDULED' && (
                          <button
                            type="button"
                            onClick={() => updateStatus.mutate({ id: record.id, status: 'IN_PROGRESS' })}
                            className="rounded-md border border-slate-300 px-3 py-1 text-xs text-slate-700"
                          >
                            Start
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => updateStatus.mutate({ id: record.id, status: 'COMPLETED' })}
                          className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white"
                        >
                          Complete
                        </button>
                        <button
                          type="button"
                          onClick={() => updateStatus.mutate({ id: record.id, status: 'CANCELLED' })}
                          className="rounded-md border border-slate-300 px-3 py-1 text-xs text-slate-700"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
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
