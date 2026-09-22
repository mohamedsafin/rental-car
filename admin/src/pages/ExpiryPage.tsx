/**
 * pages/ExpiryPage.tsx
 * ---------------------------------------------------------------------------
 * Insurance and document expiry dashboard (BRD 40, 41).
 *
 * Two things this page insists on:
 *
 *  1. Already-expired items are shown FIRST and are never hidden by the
 *     window filter. A policy that lapsed 90 days ago is the most urgent row
 *     here, not the least; a filter that hides it is worse than no filter.
 *
 *  2. The reminder schedule is displayed, not assumed. BRD 41 gives 30/15/7/0
 *     as the client's example and it is stored as a setting - so the page
 *     shows what is actually configured rather than implying a rule the client
 *     never agreed to.
 */
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAddPolicy, useExpiring } from '../features/fleetOps/useFleetOps';
import { useVehicleOptions } from '../features/fleet/useFleetAdmin';
import FormField from '../components/FormField';
import type { ExpiryItem, ServiceDueItem } from '../types/fleetOps';

const EMPTY = {
  vehicleId: '',
  provider: '',
  policyNumber: '',
  coverType: '',
  startDate: '',
  expiryDate: '',
  premium: '',
  excessAmount: '',
};

function ExpiryRow({ item, urgent }: { item: ExpiryItem; urgent: boolean }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
      <div>
        <p className="text-sm font-medium text-slate-900">{item.label}</p>
        <p className="text-xs text-slate-500">
          {item.kind === 'INSURANCE' ? 'Insurance policy' : 'Document'} -{' '}
          <Link to={`/vehicles/${item.vehicleId}`} className="underline">
            {item.vehicle}
          </Link>
        </p>
      </div>
      <div className="text-right">
        <p className={urgent ? 'text-sm font-semibold text-red-700' : 'text-sm text-slate-900'}>
          {item.expiryDate}
        </p>
        <p className="text-xs text-slate-500">
          {item.daysRemaining < 0
            ? `expired ${Math.abs(item.daysRemaining)} days ago`
            : item.daysRemaining === 0
              ? 'expires today'
              : `${item.daysRemaining} days left`}
        </p>
      </div>
    </li>
  );
}

/**
 * One car's service position, in whichever units were actually recorded.
 *
 * "Due in 12 days" and "due in 340km" are different sentences, and a car with
 * both gets both - joined rather than reduced to whichever sounds worse.
 */
function serviceWhen(item: ServiceDueItem): string {
  const parts: string[] = [];

  if (item.daysRemaining !== null) {
    parts.push(
      item.daysRemaining < 0
        ? `${Math.abs(item.daysRemaining)} days overdue`
        : item.daysRemaining === 0
          ? 'due today'
          : `in ${item.daysRemaining} days`,
    );
  }

  if (item.kmRemaining !== null) {
    parts.push(
      item.kmRemaining < 0
        ? `${Math.abs(item.kmRemaining).toLocaleString()} km past due`
        : `in ${item.kmRemaining.toLocaleString()} km`,
    );
  }

  return parts.join(' · ') || 'no target recorded';
}

function ServiceRow({ item }: { item: ServiceDueItem }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
      <div>
        <p className="text-sm font-medium text-slate-900">{item.label}</p>
        <p className="text-xs text-slate-500">
          Service -{' '}
          <Link to={`/vehicles/${item.vehicleId}`} className="underline">
            {item.vehicle}
          </Link>
        </p>
      </div>
      <div className="text-right">
        <p className={item.overdue ? 'text-sm font-semibold text-red-700' : 'text-sm text-slate-900'}>
          {serviceWhen(item)}
        </p>
        <p className="text-xs text-slate-500">
          {item.dueMileage !== null
            ? `${item.currentMileage.toLocaleString()} of ${item.dueMileage.toLocaleString()} km`
            : item.dueDate}
        </p>
      </div>
    </li>
  );
}

export default function ExpiryPage() {
  const [withinDays, setWithinDays] = useState<number | undefined>(undefined);
  const { data, isPending } = useExpiring(withinDays);
  const { data: vehicles } = useVehicleOptions();
  const addPolicy = useAddPolicy();

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    addPolicy.mutate(
      {
        vehicleId: form.vehicleId,
        provider: form.provider,
        policyNumber: form.policyNumber,
        coverType: form.coverType || undefined,
        startDate: form.startDate,
        expiryDate: form.expiryDate,
        premium: form.premium || undefined,
        excessAmount: form.excessAmount || undefined,
      },
      {
        onSuccess: () => {
          setShowForm(false);
          setForm(EMPTY);
        },
        onError: (err) => setError(err.message),
      },
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Insurance and expiries</h2>
          <p className="text-sm text-slate-500">
            {data
              ? `Reminders are configured for ${data.reminderDays.join(', ')} days before expiry.`
              : 'Registration, insurance and document expiry dates.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((open) => !open)}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          {showForm ? 'Cancel' : 'Add policy'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={submit} className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
          {error && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
              {error}
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="policy-vehicle" className="block text-sm font-medium text-slate-700">
                Vehicle
              </label>
              <select
                id="policy-vehicle"
                required
                value={form.vehicleId}
                onChange={(event) => setForm({ ...form, vehicleId: event.target.value })}
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">Select a vehicle</option>
                {(vehicles ?? []).map((vehicle) => (
                  <option key={vehicle.id} value={vehicle.id}>
                    {vehicle.registrationNumber} - {vehicle.brand} {vehicle.model}
                  </option>
                ))}
              </select>
            </div>

            <FormField
              label="Insurer"
              name="provider"
              required
              value={form.provider}
              onChange={(event) => setForm({ ...form, provider: event.target.value })}
            />
            <FormField
              label="Policy number"
              name="policyNumber"
              required
              value={form.policyNumber}
              onChange={(event) => setForm({ ...form, policyNumber: event.target.value })}
            />
            <FormField
              label="Cover type"
              name="coverType"
              value={form.coverType}
              onChange={(event) => setForm({ ...form, coverType: event.target.value })}
              hint="Free text - the client has not confirmed a list."
            />
            <FormField
              label="Starts"
              name="startDate"
              type="date"
              required
              value={form.startDate}
              onChange={(event) => setForm({ ...form, startDate: event.target.value })}
            />
            <FormField
              label="Expires"
              name="expiryDate"
              type="date"
              required
              value={form.expiryDate}
              onChange={(event) => setForm({ ...form, expiryDate: event.target.value })}
            />
            <FormField
              label="Premium (AED)"
              name="premium"
              inputMode="decimal"
              value={form.premium}
              onChange={(event) => setForm({ ...form, premium: event.target.value })}
            />
            <FormField
              label="Excess (AED)"
              name="excessAmount"
              inputMode="decimal"
              hint="What the hirer pays before the insurer pays anything. Printed on the agreement."
              value={form.excessAmount}
              onChange={(event) => setForm({ ...form, excessAmount: event.target.value })}
            />
          </div>

          <p className="text-xs text-slate-500">
            Adding a policy supersedes the current one. The old policy stays on file - a claim about
            last year needs last year's cover.
          </p>

          <button
            type="submit"
            disabled={addPolicy.isPending}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {addPolicy.isPending ? 'Saving...' : 'Save policy'}
          </button>
        </form>
      )}

      <div className="flex gap-2">
        {[undefined, 7, 15, 30, 90].map((value) => (
          <button
            key={String(value)}
            type="button"
            onClick={() => setWithinDays(value)}
            className={
              withinDays === value
                ? 'rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white'
                : 'rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700'
            }
          >
            {value === undefined ? 'Default window' : `Next ${value} days`}
          </button>
        ))}
      </div>

      {isPending && <p className="text-sm text-slate-500">Loading...</p>}

      {data && (
        <div className="space-y-4">
          <section className="overflow-hidden rounded-lg border border-red-200 bg-white">
            <header className="border-b border-red-200 bg-red-50 px-5 py-3">
              <h3 className="text-sm font-semibold text-red-800">
                Expired ({data.expired.length})
              </h3>
              <p className="text-xs text-red-700">
                A vehicle with lapsed cover should not be on the road, whatever the filter says.
              </p>
            </header>
            {data.expired.length === 0 ? (
              <p className="px-5 py-6 text-sm text-slate-500">Nothing has lapsed.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {data.expired.map((item) => (
                  <ExpiryRow key={`${item.kind}-${item.id}`} item={item} urgent />
                ))}
              </ul>
            )}
          </section>

          <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <header className="border-b border-slate-200 bg-slate-50 px-5 py-3">
              <h3 className="text-sm font-semibold text-slate-900">
                Due within {data.horizonDays} days ({data.dueSoon.length})
              </h3>
            </header>
            {data.dueSoon.length === 0 ? (
              <p className="px-5 py-6 text-sm text-slate-500">Nothing due in this window.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {data.dueSoon.map((item) => (
                  <ExpiryRow key={`${item.kind}-${item.id}`} item={item} urgent={item.daysRemaining <= 7} />
                ))}
              </ul>
            )}
          </section>

          {/*
            Services sit with the expiries because they answer the same
            question in a different unit: what is about to make a car
            unrentable? Rendered only when there is something to say - an
            empty panel on every visit is a panel staff learn to skip.
          */}
          {data.serviceDue.length > 0 && (
            <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <header className="border-b border-slate-200 bg-slate-50 px-5 py-3">
                <h3 className="text-sm font-semibold text-slate-900">
                  Service due ({data.serviceDue.length})
                </h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  By date, or within 1,000 km of the odometer target set at the last service.
                </p>
              </header>
              <ul className="divide-y divide-slate-100">
                {data.serviceDue.map((item) => (
                  <ServiceRow key={item.id} item={item} />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
