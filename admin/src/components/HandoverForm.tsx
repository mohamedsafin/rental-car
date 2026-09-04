/**
 * components/HandoverForm.tsx
 * ---------------------------------------------------------------------------
 * The counter form for handing a vehicle over (BRD 24).
 *
 * The customer-verification checkbox is required and starts UNTICKED. BRD 24
 * puts identity checking first in the handover list, and a form that pre-ticks
 * it is not enforcing anything - it is just recording that a box was already
 * ticked when staff arrived at it.
 */
import { useState, type FormEvent } from 'react';
import { useRecordPickup } from '../features/rentals/useRentals';

/** BRD 24 asks staff to record accessories. Common ones, plus free text. */
const COMMON_ACCESSORIES = [
  'Spare tyre',
  'Jack',
  'Wheel spanner',
  'First aid kit',
  'Warning triangle',
  'Charging cable',
];

export default function HandoverForm({
  bookingId,
  currentMileage,
}: {
  bookingId: string;
  currentMileage: number;
}) {
  const pickup = useRecordPickup(bookingId);

  const [mileage, setMileage] = useState(String(currentMileage));
  const [fuelPercent, setFuelPercent] = useState('100');
  const [customerVerified, setCustomerVerified] = useState(false);
  const [conditionNotes, setConditionNotes] = useState('');
  const [damageNotes, setDamageNotes] = useState('');
  const [accessories, setAccessories] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    pickup.mutate(
      {
        mileage: Number(mileage),
        fuelPercent: Number(fuelPercent),
        customerVerified,
        conditionNotes: conditionNotes.trim() || undefined,
        damageNotes: damageNotes.trim() || undefined,
        accessories,
      },
      { onError: (err) => setError(err.message) },
    );
  }

  return (
    <form onSubmit={submit} className="rounded-lg border border-slate-200 bg-white p-5">
      <h3 className="font-semibold text-slate-900">Hand over the vehicle</h3>
      <p className="mt-1 text-sm text-slate-600">
        Record the car&rsquo;s condition now. This is the baseline the return is judged against.
      </p>

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
            min={currentMileage}
            value={mileage}
            onChange={(e) => setMileage(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <span className="mt-1 block text-xs text-slate-500">
            Last recorded reading: {currentMileage.toLocaleString()} km
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
        </label>
      </div>

      <fieldset className="mt-4">
        <legend className="text-sm font-medium text-slate-700">Accessories handed over</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {COMMON_ACCESSORIES.map((item) => (
            <label
              key={item}
              className={
                accessories.includes(item)
                  ? 'cursor-pointer rounded-full border border-slate-900 bg-slate-900 px-3 py-1 text-sm text-white'
                  : 'cursor-pointer rounded-full border border-slate-300 px-3 py-1 text-sm text-slate-700'
              }
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={accessories.includes(item)}
                onChange={() =>
                  setAccessories((current) =>
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
      </fieldset>

      <label className="mt-4 block">
        <span className="text-sm font-medium text-slate-700">Existing damage</span>
        <textarea
          rows={2}
          value={damageNotes}
          onChange={(e) => setDamageNotes(e.target.value)}
          placeholder="Anything already marked, scratched or chipped. Photograph it too."
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

      <label className="mt-4 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3">
        <input
          type="checkbox"
          checked={customerVerified}
          onChange={(e) => setCustomerVerified(e.target.checked)}
          className="mt-0.5 rounded border-slate-400"
        />
        <span className="text-sm text-amber-900">
          I have checked the customer&rsquo;s identity and driving licence against their approved
          documents.
        </span>
      </label>

      <button
        type="submit"
        disabled={pickup.isPending || !customerVerified}
        className="mt-4 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
      >
        {pickup.isPending ? 'Recording...' : 'Hand over vehicle'}
      </button>
    </form>
  );
}
