/**
 * pages/FinesPage.tsx
 * ---------------------------------------------------------------------------
 * Traffic fines and Salik tolls (BRD 38).
 *
 * The important behaviour is what happens after you record a fine: the API
 * SUGGESTS which rental the car was on at the moment of the violation, and
 * this page shows that suggestion rather than acting on it. A fine is money
 * taken from a named person, so a human confirms who was driving.
 *
 * "Recover" is admin-only and creates a charge on the booking, where the
 * authority's amount and our handling fee are described separately - so the
 * customer can see what the RTA charged and what we charged.
 */
import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  useFines,
  useRecordFine,
  useRecordToll,
  useRecoverCharge,
  useTolls,
  useUpdateCharge,
} from '../features/fleetOps/useFleetOps';
import { useAdminVehicles } from '../features/fleet/useFleetAdmin';
import { useAuth } from '../hooks/useAuth';
import FormField from '../components/FormField';

const STATUS_STYLE: Record<string, string> = {
  RECORDED: 'bg-slate-100 text-slate-700',
  ASSIGNED: 'bg-amber-100 text-amber-800',
  RECOVERED: 'bg-emerald-100 text-emerald-800',
  WAIVED: 'bg-slate-100 text-slate-500',
  DISPUTED: 'bg-red-100 text-red-700',
};

const EMPTY_FINE = {
  vehicleId: '',
  fineNumber: '',
  violationAt: '',
  violation: '',
  location: '',
  amount: '',
  serviceFee: '',
};

const EMPTY_TOLL = {
  vehicleId: '',
  crossedAt: '',
  gate: '',
  reference: '',
  amount: '',
  serviceFee: '',
};

export default function FinesPage() {
  // The tab lives in the URL so a colleague can be sent straight to tolls.
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'tolls' ? 'tolls' : 'fines';
  const page = Number(params.get('page') ?? '1');

  const { user } = useAuth();
  const canRecover = user?.role === 'ADMIN';

  const { data: fines, isPending: finesPending } = useFines({ page, limit: 20 });
  const { data: tolls, isPending: tollsPending } = useTolls({ page, limit: 20 });
  const { data: vehicles } = useAdminVehicles({ page: 1, limit: 100 });

  const recordFine = useRecordFine();
  const recordToll = useRecordToll();
  const recover = useRecoverCharge(tab);
  const update = useUpdateCharge(tab);

  const [fineForm, setFineForm] = useState(EMPTY_FINE);
  const [tollForm, setTollForm] = useState(EMPTY_TOLL);
  const [error, setError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<string | null>(null);

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next);
  }

  function submitFine(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSuggestion(null);

    recordFine.mutate(
      {
        vehicleId: fineForm.vehicleId,
        fineNumber: fineForm.fineNumber,
        violationAt: new Date(fineForm.violationAt).toISOString(),
        violation: fineForm.violation || undefined,
        location: fineForm.location || undefined,
        amount: fineForm.amount,
        serviceFee: fineForm.serviceFee || undefined,
      },
      {
        onSuccess: (result) => {
          setFineForm(EMPTY_FINE);
          setSuggestion(
            result.matchedCustomer
              ? `${result.matchedCustomer.name} had this car on booking ${result.matchedCustomer.bookingNumber}. Attach the fine to that booking to recover it.`
              : 'No rental covered that timestamp, so this fine stays with the company until someone attaches it.',
          );
        },
        onError: (err) => setError(err.message),
      },
    );
  }

  function submitToll(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSuggestion(null);

    recordToll.mutate(
      {
        vehicleId: tollForm.vehicleId,
        crossedAt: new Date(tollForm.crossedAt).toISOString(),
        gate: tollForm.gate || undefined,
        reference: tollForm.reference || undefined,
        amount: tollForm.amount,
        serviceFee: tollForm.serviceFee || undefined,
      },
      {
        onSuccess: (result) => {
          setTollForm(EMPTY_TOLL);
          setSuggestion(
            result.matchedCustomer
              ? `${result.matchedCustomer.name} had this car on booking ${result.matchedCustomer.bookingNumber}.`
              : 'No rental covered that crossing time.',
          );
        },
        onError: (err) => setError(err.message),
      },
    );
  }

  const rows = tab === 'fines' ? (fines?.items ?? []) : (tolls?.items ?? []);
  const pagination = tab === 'fines' ? fines?.pagination : tolls?.pagination;
  const isPending = tab === 'fines' ? finesPending : tollsPending;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Fines and tolls</h2>
        <p className="text-sm text-slate-500">
          Recording a charge suggests the rental it fell on. Attaching it to a customer is your call.
        </p>
      </div>

      <div className="flex gap-2">
        {(['fines', 'tolls'] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setParam('tab', value)}
            className={
              tab === value
                ? 'rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white'
                : 'rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700'
            }
          >
            {value === 'fines' ? 'Traffic fines' : 'Salik tolls'}
          </button>
        ))}
      </div>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}

      {suggestion && (
        <p className="rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-800">{suggestion}</p>
      )}

      {tab === 'fines' ? (
        <form onSubmit={submitFine} className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
          <h3 className="text-sm font-semibold text-slate-900">Record a fine</h3>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="sm:col-span-1">
              <label htmlFor="fine-vehicle" className="block text-sm font-medium text-slate-700">
                Vehicle
              </label>
              <select
                id="fine-vehicle"
                required
                value={fineForm.vehicleId}
                onChange={(event) => setFineForm({ ...fineForm, vehicleId: event.target.value })}
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">Select a vehicle</option>
                {(vehicles?.items ?? []).map((vehicle) => (
                  <option key={vehicle.id} value={vehicle.id}>
                    {vehicle.registrationNumber} - {vehicle.brand} {vehicle.model}
                  </option>
                ))}
              </select>
            </div>

            <FormField
              label="Fine number"
              name="fineNumber"
              required
              value={fineForm.fineNumber}
              onChange={(event) => setFineForm({ ...fineForm, fineNumber: event.target.value })}
              hint="Entering the same number twice is refused - one violation, one charge."
            />
            <FormField
              label="Violation time"
              name="violationAt"
              type="datetime-local"
              required
              value={fineForm.violationAt}
              onChange={(event) => setFineForm({ ...fineForm, violationAt: event.target.value })}
              hint="This is what decides which rental it fell on."
            />
            <FormField
              label="Violation"
              name="violation"
              value={fineForm.violation}
              onChange={(event) => setFineForm({ ...fineForm, violation: event.target.value })}
            />
            <FormField
              label="Location"
              name="fine-location"
              value={fineForm.location}
              onChange={(event) => setFineForm({ ...fineForm, location: event.target.value })}
            />
            <FormField
              label="Authority amount (AED)"
              name="fine-amount"
              inputMode="decimal"
              required
              value={fineForm.amount}
              onChange={(event) => setFineForm({ ...fineForm, amount: event.target.value })}
            />
            <FormField
              label="Our handling fee (AED)"
              name="fine-fee"
              inputMode="decimal"
              value={fineForm.serviceFee}
              onChange={(event) => setFineForm({ ...fineForm, serviceFee: event.target.value })}
              hint="Shown separately to the customer. Leave blank for none."
            />
          </div>
          <button
            type="submit"
            disabled={recordFine.isPending}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {recordFine.isPending ? 'Recording...' : 'Record fine'}
          </button>
        </form>
      ) : (
        <form onSubmit={submitToll} className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
          <h3 className="text-sm font-semibold text-slate-900">Record a toll crossing</h3>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="toll-vehicle" className="block text-sm font-medium text-slate-700">
                Vehicle
              </label>
              <select
                id="toll-vehicle"
                required
                value={tollForm.vehicleId}
                onChange={(event) => setTollForm({ ...tollForm, vehicleId: event.target.value })}
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">Select a vehicle</option>
                {(vehicles?.items ?? []).map((vehicle) => (
                  <option key={vehicle.id} value={vehicle.id}>
                    {vehicle.registrationNumber} - {vehicle.brand} {vehicle.model}
                  </option>
                ))}
              </select>
            </div>

            <FormField
              label="Crossed at"
              name="crossedAt"
              type="datetime-local"
              required
              value={tollForm.crossedAt}
              onChange={(event) => setTollForm({ ...tollForm, crossedAt: event.target.value })}
            />
            <FormField
              label="Gate"
              name="gate"
              value={tollForm.gate}
              onChange={(event) => setTollForm({ ...tollForm, gate: event.target.value })}
            />
            <FormField
              label="Reference"
              name="reference"
              value={tollForm.reference}
              onChange={(event) => setTollForm({ ...tollForm, reference: event.target.value })}
            />
            <FormField
              label="Amount (AED)"
              name="toll-amount"
              inputMode="decimal"
              required
              value={tollForm.amount}
              onChange={(event) => setTollForm({ ...tollForm, amount: event.target.value })}
            />
            <FormField
              label="Our handling fee (AED)"
              name="toll-fee"
              inputMode="decimal"
              value={tollForm.serviceFee}
              onChange={(event) => setTollForm({ ...tollForm, serviceFee: event.target.value })}
            />
          </div>
          <button
            type="submit"
            disabled={recordToll.isPending}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {recordToll.isPending ? 'Recording...' : 'Record toll'}
          </button>
        </form>
      )}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        {isPending && <p className="px-5 py-8 text-sm text-slate-500">Loading...</p>}

        {!isPending && rows.length === 0 && (
          <p className="px-5 py-8 text-sm text-slate-500">Nothing recorded yet.</p>
        )}

        {rows.length > 0 && (
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Vehicle</th>
                <th className="px-4 py-3">Detail</th>
                <th className="px-4 py-3">Amount + fee</th>
                <th className="px-4 py-3">Booking</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-3 text-slate-900">{row.vehicle ?? row.vehicleId}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {'fineNumber' in row ? (
                      <>
                        <p className="text-slate-900">{row.fineNumber}</p>
                        <p className="text-xs">
                          {row.violation ?? 'Violation'} - {new Date(row.violationAt).toLocaleString()}
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-slate-900">{row.gate ?? 'Toll gate'}</p>
                        <p className="text-xs">{new Date(row.crossedAt).toLocaleString()}</p>
                      </>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-900">
                    {row.currency} {row.total}
                    <span className="block text-xs text-slate-500">
                      {row.amount} authority + {row.serviceFee} handling
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {row.bookingNumber ?? <span className="text-slate-400">unattached</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        STATUS_STYLE[row.status] ?? 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {row.status.toLowerCase()}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      {canRecover && row.bookingId && row.status !== 'RECOVERED' && (
                        <button
                          type="button"
                          onClick={() => recover.mutate(row.id, { onError: (err) => setError(err.message) })}
                          className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white"
                        >
                          Recover
                        </button>
                      )}
                      {row.status !== 'WAIVED' && row.status !== 'RECOVERED' && (
                        <button
                          type="button"
                          onClick={() =>
                            update.mutate(
                              { id: row.id, status: 'WAIVED' },
                              { onError: (err) => setError(err.message) },
                            )
                          }
                          className="rounded-md border border-slate-300 px-3 py-1 text-xs text-slate-700"
                        >
                          Write off
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-slate-600">
          <span>
            Page {pagination.page} of {pagination.totalPages}
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
              disabled={page >= pagination.totalPages}
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
