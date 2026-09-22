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
import { useVehicleOptions } from '../features/fleet/useFleetAdmin';
import { useAuth } from '../hooks/useAuth';
import FormField from '../components/FormField';
import StatementImport from '../components/StatementImport';
import AttachCharge from '../components/AttachCharge';

const STATUS_STYLE: Record<string, string> = {
  RECORDED: 'bg-slate-100 text-slate-700',
  ASSIGNED: 'bg-amber-100 text-amber-800',
  RECOVERED: 'bg-emerald-100 text-emerald-800',
  WAIVED: 'bg-slate-100 text-slate-500',
  DISPUTED: 'bg-red-100 text-red-700',
};

/**
 * What the server made of the timestamp, in words.
 *
 * The ambiguous case earns its own sentence. When two rentals cover one
 * moment the server deliberately attaches nothing - it used to pick whichever
 * the database returned first, which billed a fine to a customer who had never
 * collected the car - and staff need to be told that a decision is waiting for
 * them, not left thinking nothing matched.
 */
function describeMatch(
  result: {
    matchedCustomer: { fullName: string; bookingNumber: string } | null;
    ambiguousBetween: { bookingNumber: string; customerName: string }[];
  },
  noun: string,
): string {
  if (result.matchedCustomer) {
    return `${result.matchedCustomer.fullName} had this car on booking ${result.matchedCustomer.bookingNumber}, so the ${noun} has been attached to it. Recover it when you are ready.`;
  }

  if (result.ambiguousBetween.length > 0) {
    const list = result.ambiguousBetween
      .map((option) => `${option.customerName} (${option.bookingNumber})`)
      .join(' and ');
    return `More than one rental covers that time - ${list} - so nothing was attached. Use Attach on the row below to say which one it was.`;
  }

  return `No rental covered that time, so this ${noun} stays with the company. Use Attach on the row below if you know who had the car.`;
}

const EMPTY_FINE = {
  vehicleId: '',
  fineNumber: '',
  fineType: 'TRAFFIC',
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
  const { data: vehicles } = useVehicleOptions();

  const recordFine = useRecordFine();
  const recordToll = useRecordToll();
  const recover = useRecoverCharge(tab);
  const update = useUpdateCharge(tab);

  const [fineForm, setFineForm] = useState(EMPTY_FINE);
  const [tollForm, setTollForm] = useState(EMPTY_TOLL);
  const [error, setError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<string | null>(null);

  /**
   * Recovering takes the customer's money, so the outcome is spelled out
   * rather than left as a silent success - especially the partial case, where
   * the deposit covered only some of it and the rest still has to be invoiced.
   */
  function recoverRow(id: string) {
    setError(null);
    setSuggestion(null);
    recover.mutate(id, {
      onSuccess: (result) => {
        const fromDeposit = Number(result.recoveredFromDeposit);
        const toInvoice = Number(result.leftToInvoice);

        /*
         * A long-term customer is billed, not deducted.
         *
         * Reported first because the deposit wording below would otherwise
         * read as a failure - "nothing could be taken from the deposit" is
         * alarming when not touching the deposit was the intention.
         */
        if (result.billedWithInstalment !== null) {
          setSuggestion(
            `AED ${result.amount} has been added to month ${result.billedWithInstalment} of this rental. The customer pays it with that month's rent, and the deposit is untouched.`,
          );
          return;
        }

        if (fromDeposit === 0) {
          setError(
            `Nothing could be taken from the deposit (${
              result.depositBalance === null ? 'none is being held' : 'it is already spent'
            }). The full AED ${result.amount} remains as a charge to invoice.`,
          );
          return;
        }

        setSuggestion(
          toInvoice > 0
            ? `AED ${result.recoveredFromDeposit} taken from the deposit, which is now empty. AED ${result.leftToInvoice} is beyond it and stays as a charge to invoice.`
            : `AED ${result.recoveredFromDeposit} taken from the deposit. AED ${result.depositBalance} still held.`,
        );
      },
      onError: (err) => setError(err.message),
    });
  }

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
        fineType: fineForm.fineType,
        violationAt: new Date(fineForm.violationAt).toISOString(),
        violation: fineForm.violation || undefined,
        location: fineForm.location || undefined,
        amount: fineForm.amount,
        serviceFee: fineForm.serviceFee || undefined,
      },
      {
        onSuccess: (result) => {
          setFineForm(EMPTY_FINE);
          setSuggestion(describeMatch(result, 'fine'));
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
          setSuggestion(describeMatch(result, 'crossing'));
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
        <>
          {/* Same reasoning as the tolls tab: the bulk path first, and the
              one-at-a-time form for whatever the export missed. */}
          <StatementImport kind="fines" />

          <form onSubmit={submitFine} className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
          <h3 className="text-sm font-semibold text-slate-900">Record one fine by hand</h3>
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
                {(vehicles ?? []).map((vehicle) => (
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
            <div>
              <label htmlFor="fine-type" className="block text-sm font-medium text-slate-700">
                Issued by
              </label>
              <select
                id="fine-type"
                value={fineForm.fineType}
                onChange={(event) => setFineForm({ ...fineForm, fineType: event.target.value })}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="TRAFFIC">Police - traffic</option>
                <option value="PARKING">Municipality or mall - parking</option>
                <option value="OTHER">Something else</option>
              </select>
              <p className="mt-1 text-xs text-slate-500">
                Decides who the customer disputes it with, and whether a driver has to be
                nominated.
              </p>
            </div>

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
        </>
      ) : (
        <>
          {/*
           * The importer comes first because it is what staff should reach for:
           * one car crosses a gate sixty times a month, and the form below is
           * for the one crossing the statement missed, not for the sixty.
           */}
          <StatementImport kind="tolls" />

          <form onSubmit={submitToll} className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
          <h3 className="text-sm font-semibold text-slate-900">Record one crossing by hand</h3>
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
                {(vehicles ?? []).map((vehicle) => (
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
        </>
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
                        <p className="text-slate-900">
                          {row.fineNumber}
                          {row.fineType === 'PARKING' && (
                            <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                              Parking
                            </span>
                          )}
                        </p>
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
                    {row.bookingNumber ?? (
                      <span className="text-slate-400" title="No rental covered this timestamp, so the company pays it unless you attach it.">
                        nobody yet
                      </span>
                    )}
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
                    <div className="flex flex-wrap items-start justify-end gap-2">
                      {/*
                        * Attaching comes before recovering, in both the layout
                        * and the workflow: an unattached charge has nobody to
                        * recover from, and the page used to say so without
                        * offering any way to fix it.
                        */}
                      {row.status !== 'RECOVERED' && row.status !== 'WAIVED' && !row.bookingClosed && (
                        <AttachCharge
                          kind={tab}
                          chargeId={row.id}
                          attachedTo={row.bookingNumber ?? null}
                          onDone={(message) => {
                            setError(null);
                            setSuggestion(message);
                          }}
                          onError={(message) => {
                            setSuggestion(null);
                            setError(message);
                          }}
                        />
                      )}
                      {row.bookingClosed && row.status !== 'RECOVERED' && row.status !== 'WAIVED' && (
                        <span
                          className="text-xs text-slate-400"
                          title="The rental is finished. Charges had to be settled before it was completed, so this one stays with the company."
                        >
                          rental closed
                        </span>
                      )}
                      {canRecover && row.bookingId && !row.bookingClosed && row.status !== 'RECOVERED' && (
                        <button
                          type="button"
                          onClick={() => recoverRow(row.id)}
                          disabled={recover.isPending}
                          className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
                        >
                          {recover.isPending && recover.variables === row.id
                            ? 'Recovering...'
                            : 'Recover & deduct'}
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
