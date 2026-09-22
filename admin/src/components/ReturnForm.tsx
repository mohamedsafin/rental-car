/**
 * components/ReturnForm.tsx
 * ---------------------------------------------------------------------------
 * The counter form for taking a vehicle back (BRD 26).
 *
 * Pre-filled with the PICKUP readings, so staff correct a known baseline
 * rather than typing into empty boxes - and the difference between the two is
 * exactly what the charges are computed from.
 *
 * On submit it shows the charges the backend calculated, plus any policy it
 * could NOT apply because that rate is unconfigured. Surfacing the gap beats
 * silently charging nothing and leaving staff to wonder why.
 */
import { useState, type FormEvent } from 'react';
import { useRecordReturn } from '../features/rentals/useRentals';
import ConditionSignOff from './ConditionSignOff';
import {
  emptySignOff,
  signOffPayload,
  type SignOffState,
} from './conditionSignOff.helpers';
import type { Rental } from '../types/rental';

interface ReturnResult {
  charges: { type: string; amount: string; description: string }[];
  chargeTotal: string;
  warnings: string[];
}

/** What the pickup inspection recorded as handed over. Stored as JSON, so checked. */
function handedOverAccessories(rental: Rental): string[] {
  const pickup = rental.inspections.find((inspection) => inspection.type === 'PICKUP');
  const list = pickup?.accessories;
  return Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string') : [];
}

export default function ReturnForm({ bookingId, rental }: { bookingId: string; rental: Rental }) {
  const recordReturn = useRecordReturn(bookingId);
  const handedOver = handedOverAccessories(rental);

  // Starts with everything ticked, like the readings above: staff untick
  // whatever did not come back, and that difference is what gets recorded.
  const [returnedAccessories, setReturnedAccessories] = useState<string[]>(handedOver);
  const [mileage, setMileage] = useState(String(rental.pickupMileage));
  const [fuelPercent, setFuelPercent] = useState(String(rental.pickupFuelPercent));
  const [needsCleaning, setNeedsCleaning] = useState(false);
  const [damageNotes, setDamageNotes] = useState('');
  const [cleanliness, setCleanliness] = useState('');
  const [conditionNotes, setConditionNotes] = useState('');
  const [signOff, setSignOff] = useState<SignOffState>(emptySignOff);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReturnResult | null>(null);

  const overdue = new Date() > new Date(rental.dueBackAt);
  const missingAccessories = handedOver.filter((item) => !returnedAccessories.includes(item));

  function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    recordReturn.mutate(
      {
        mileage: Number(mileage),
        fuelPercent: Number(fuelPercent),
        needsCleaning,
        damageNotes: damageNotes.trim() || undefined,
        cleanliness: cleanliness.trim() || undefined,
        conditionNotes: conditionNotes.trim() || undefined,
        missingAccessories,
        ...signOffPayload(signOff),
      },
      {
        onSuccess: (data) =>
          setResult({
            charges: data.charges,
            chargeTotal: data.chargeTotal,
            warnings: data.warnings,
          }),
        onError: (err) => setError(err.message),
      },
    );
  }

  if (result) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h3 className="font-semibold text-slate-900">Vehicle returned</h3>

        {result.charges.length === 0 ? (
          <p className="mt-2 text-sm text-emerald-700">
            No additional charges - on time, within the allowance and clean.
          </p>
        ) : (
          <>
            <p className="mt-2 text-sm text-slate-600">
              {result.charges.length} charge(s) raised, totalling{' '}
              <strong>AED {result.chargeTotal}</strong>. Settle them from the deposit below.
            </p>
            <ul className="mt-3 divide-y divide-slate-100 text-sm">
              {result.charges.map((charge) => (
                <li key={charge.type} className="flex justify-between py-2">
                  <span className="text-slate-700">{charge.description}</span>
                  <span className="font-medium text-slate-900">{charge.amount}</span>
                </li>
              ))}
            </ul>
          </>
        )}

        {missingAccessories.length > 0 && (
          <p className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            Not returned: {missingAccessories.join(', ')}
          </p>
        )}

        {result.warnings.length > 0 && (
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3">
            {result.warnings.map((warning) => (
              <p key={warning} className="text-xs text-amber-900">
                {warning}
              </p>
            ))}
          </div>
        )}
      </section>
    );
  }

  return (
    <form onSubmit={submit} className="rounded-lg border border-slate-200 bg-white p-5">
      <h3 className="font-semibold text-slate-900">Take the vehicle back</h3>
      <p className="mt-1 text-sm text-slate-600">
        Pre-filled with the pickup readings. Correct them to what you see now.
      </p>

      {overdue && (
        <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          This rental is past its due-back time. A late charge may be raised, depending on the
          configured grace period.
        </p>
      )}

      {error && (
        <p role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Odometer (km)</span>
          <input
            type="number"
            required
            min={rental.pickupMileage}
            value={mileage}
            onChange={(e) => setMileage(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <span className="mt-1 block text-xs text-slate-500">
            At pickup: {rental.pickupMileage.toLocaleString()} km
            {Number(mileage) > rental.pickupMileage
              ? ` (${(Number(mileage) - rental.pickupMileage).toLocaleString()} km driven)`
              : ''}
          </span>
        </label>

        <label className="block">
          <span className="text-sm font-medium text-slate-700">Fuel level ({fuelPercent}%)</span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={fuelPercent}
            onChange={(e) => setFuelPercent(e.target.value)}
            className="mt-3 w-full"
          />
          <span className="mt-1 block text-xs text-slate-500">
            At pickup: {rental.pickupFuelPercent}%
          </span>
        </label>
      </div>

      <fieldset className="mt-4">
        <legend className="text-sm font-medium text-slate-700">Accessories returned</legend>
        {handedOver.length === 0 ? (
          <p className="mt-1 text-xs text-slate-500">No accessories were recorded at handover.</p>
        ) : (
          <>
            <div className="mt-2 flex flex-wrap gap-2">
              {handedOver.map((item) => (
                <label
                  key={item}
                  className={
                    returnedAccessories.includes(item)
                      ? 'cursor-pointer rounded-full border border-slate-900 bg-slate-900 px-3 py-1 text-sm text-white'
                      : 'cursor-pointer rounded-full border border-red-300 bg-red-50 px-3 py-1 text-sm text-red-700 line-through'
                  }
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={returnedAccessories.includes(item)}
                    onChange={() =>
                      setReturnedAccessories((current) =>
                        current.includes(item)
                          ? current.filter((a) => a !== item)
                          : [...current, item],
                      )
                    }
                  />
                  {item}
                </label>
              ))}
            </div>
            <span className="mt-1 block text-xs text-slate-500">
              {missingAccessories.length === 0
                ? 'Everything handed over at pickup. Untick anything that did not come back.'
                : `Missing: ${missingAccessories.join(', ')}`}
            </span>
          </>
        )}
      </fieldset>

      <label className="mt-4 block">
        <span className="text-sm font-medium text-slate-700">New damage</span>
        <textarea
          rows={2}
          value={damageNotes}
          onChange={(e) => setDamageNotes(e.target.value)}
          placeholder="Only damage that was NOT on the pickup inspection. Photograph it."
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </label>

      <label className="mt-4 block">
        <span className="text-sm font-medium text-slate-700">Cleanliness</span>
        <input
          value={cleanliness}
          onChange={(e) => setCleanliness(e.target.value)}
          placeholder="e.g. Sand throughout the interior"
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </label>

      <label className="mt-4 block">
        <span className="text-sm font-medium text-slate-700">General condition</span>
        <textarea
          rows={2}
          value={conditionNotes}
          onChange={(e) => setConditionNotes(e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </label>

      <label className="mt-4 flex items-center gap-2">
        <input
          type="checkbox"
          checked={needsCleaning}
          onChange={(e) => setNeedsCleaning(e.target.checked)}
          className="rounded border-slate-300"
        />
        <span className="text-sm text-slate-700">
          Needs cleaning beyond normal use (raises a cleaning charge)
        </span>
      </label>

      <ConditionSignOff value={signOff} onChange={setSignOff} moment="return" />

      <button
        type="submit"
        disabled={recordReturn.isPending}
        className="mt-4 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
      >
        {recordReturn.isPending ? 'Recording...' : 'Record return and calculate charges'}
      </button>
    </form>
  );
}
