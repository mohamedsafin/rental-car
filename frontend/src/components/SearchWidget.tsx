/**
 * components/SearchWidget.tsx
 * ---------------------------------------------------------------------------
 * The car search form from BRD 6: pickup location, drop-off location, pickup
 * date, pickup time, return date, return time.
 *
 * Submitting navigates to /search with the criteria in the query string rather
 * than holding them in component state. That makes a search shareable and
 * bookmarkable, survives a refresh, and means the results page can be linked
 * to directly - the same reasoning as the filters on /cars.
 */
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLocations } from '../features/fleet/useFleet';

/** YYYY-MM-DD for a date N days from today, in the user's own timezone. */
function dateOffset(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

const TODAY = new Date().toISOString().slice(0, 10);

/** One class string, so every control in the form lines up and matches. */
const inputClass =
  'w-full rounded-lg border border-ink-200 px-3 py-2 text-sm text-ink-800 transition hover:border-ink-300';

export interface SearchWidgetProps {
  /** Pre-fill from the URL when the widget is shown on the results page. */
  initial?: Partial<{
    pickupDate: string;
    pickupTime: string;
    returnDate: string;
    returnTime: string;
    pickupLocationId: string;
    dropoffLocationId: string;
  }>;
  /**
   * When true the form draws its own card. The home page passes false because
   * the hero already wraps it in one, and two nested bordered boxes look like
   * a mistake rather than a design.
   */
  framed?: boolean;
}

export default function SearchWidget({ initial, framed = false }: SearchWidgetProps) {
  const navigate = useNavigate();
  const { data: locationData } = useLocations();

  const [form, setForm] = useState({
    pickupDate: initial?.pickupDate ?? dateOffset(1),
    pickupTime: initial?.pickupTime ?? '10:00',
    returnDate: initial?.returnDate ?? dateOffset(4),
    returnTime: initial?.returnTime ?? '10:00',
    pickupLocationId: initial?.pickupLocationId ?? '',
    dropoffLocationId: initial?.dropoffLocationId ?? '',
  });

  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    // A quick client-side sanity check for instant feedback. The backend
    // validates the same thing properly - this is convenience, not the rule.
    const pickup = new Date(`${form.pickupDate}T${form.pickupTime}`);
    const dropoff = new Date(`${form.returnDate}T${form.returnTime}`);

    if (dropoff <= pickup) {
      setError('Return date and time must be after pickup.');
      return;
    }

    const params = new URLSearchParams();
    Object.entries(form).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });

    navigate(`/search?${params.toString()}`);
  }

  const pickupPoints = locationData?.locations.filter((l) => l.isPickupPoint) ?? [];
  const dropoffPoints = locationData?.locations.filter((l) => l.isDropoffPoint) ?? [];

  return (
    <form
      onSubmit={submit}
      className={framed ? 'rounded-card border border-ink-100 bg-white p-5 shadow-card' : ''}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Pickup location">
          <select
            value={form.pickupLocationId}
            onChange={(e) => setForm({ ...form, pickupLocationId: e.target.value })}
            className={inputClass}
          >
            <option value="">Any location</option>
            {pickupPoints.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Drop-off location">
          <select
            value={form.dropoffLocationId}
            onChange={(e) => setForm({ ...form, dropoffLocationId: e.target.value })}
            className={inputClass}
          >
            <option value="">Same as pickup</option>
            {dropoffPoints.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        </Field>

        <div className="hidden lg:block" />

        <Field label="Pickup date">
          <input
            type="date"
            required
            min={TODAY}
            value={form.pickupDate}
            onChange={(e) => setForm({ ...form, pickupDate: e.target.value })}
            className={inputClass}
          />
        </Field>

        <Field label="Pickup time">
          <input
            type="time"
            required
            value={form.pickupTime}
            onChange={(e) => setForm({ ...form, pickupTime: e.target.value })}
            className={inputClass}
          />
        </Field>

        <div className="hidden lg:block" />

        <Field label="Return date">
          <input
            type="date"
            required
            min={form.pickupDate}
            value={form.returnDate}
            onChange={(e) => setForm({ ...form, returnDate: e.target.value })}
            className={inputClass}
          />
        </Field>

        <Field label="Return time">
          <input
            type="time"
            required
            value={form.returnTime}
            onChange={(e) => setForm({ ...form, returnTime: e.target.value })}
            className={inputClass}
          />
        </Field>

        <div className="flex items-end">
          <button
            type="submit"
            className="w-full rounded-lg bg-ink-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-ink-800"
          >
            Search available cars
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {error}
        </p>
      )}

      {pickupPoints.length === 0 && (
        <p className="mt-3 text-xs text-ink-500">
          No pickup locations are set up yet - searching across the whole fleet.
        </p>
      )}
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-ink-500">{label}</span>
      {children}
    </label>
  );
}
