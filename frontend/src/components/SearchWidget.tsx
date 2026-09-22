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
 *
 * LAYOUT
 *
 * A booking BAR, not a boxed form. Each control lives in a soft filled "cell"
 * with its own small label, so the fields read as one instrument rather than
 * six bordered boxes. The cells reflow with the width available:
 *
 *   phone   one column: where, then when, then the button
 *   tablet  two columns: the two locations side by side, then the two
 *           date+time pairs side by side
 *   desktop (xl) one row, the button closing it on the right
 *
 * A date and its time share a cell, because a date without its time is half an
 * answer. The button is the only orange element, so on a white page there is
 * never a question about what to press next.
 */
import { useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarDays, ChevronDown, Clock, MapPin, Search } from 'lucide-react';
import { useLocations } from '../features/fleet/useFleet';

/** YYYY-MM-DD for a date N days from today, in the user's own timezone. */
function dateOffset(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

const TODAY = new Date().toISOString().slice(0, 10);

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
   * When true (the default) the bar draws its own elevated panel. Pass false
   * to embed the fields inside a container that already provides one.
   */
  framed?: boolean;
}

/*
 * The controls inside a cell are borderless and transparent - the CELL is the
 * visible field. Its focus state is on `focus-within`, so keyboard and pointer
 * users both see which cell is active, and the control's own outline is
 * switched off to avoid a ring inside a ring.
 */
const controlClass =
  'w-full min-w-0 appearance-none bg-transparent text-[15px] font-medium text-ink-950 outline-none disabled:text-ink-400 [color-scheme:light]';

export default function SearchWidget({ initial, framed = true }: SearchWidgetProps) {
  const navigate = useNavigate();
  const { data: locationData, isPending: locationsPending } = useLocations();

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

  /* The date/time pair is invalid as a unit, so both halves are flagged. */
  const invalid = error ? true : undefined;

  return (
    <form
      onSubmit={submit}
      aria-label="Search for a car"
      className={framed ? 'rounded-[20px] border border-ink-100 bg-white p-2 shadow-float sm:p-2.5' : ''}
    >
      <div className="grid gap-1.5 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1.3fr)_auto]">
        <Cell label="Pick-up location" htmlFor="pickup-location" icon={MapPin} invalid={false}>
          <div className="relative">
            <select
              id="pickup-location"
              value={form.pickupLocationId}
              onChange={(e) => setForm({ ...form, pickupLocationId: e.target.value })}
              className={`${controlClass} truncate pr-6`}
              disabled={locationsPending}
            >
              <option value="">Any location</option>
              {pickupPoints.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
            <ChevronDown aria-hidden className="pointer-events-none absolute right-0 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          </div>
        </Cell>

        <Cell label="Drop-off location" htmlFor="dropoff-location" icon={MapPin} invalid={false}>
          <div className="relative">
            <select
              id="dropoff-location"
              value={form.dropoffLocationId}
              onChange={(e) => setForm({ ...form, dropoffLocationId: e.target.value })}
              className={`${controlClass} truncate pr-6`}
              disabled={locationsPending}
            >
              <option value="">Same as pick-up</option>
              {dropoffPoints.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
            <ChevronDown aria-hidden className="pointer-events-none absolute right-0 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          </div>
        </Cell>

        <Cell label="Pick-up" groupId="pickup-when" icon={CalendarDays} invalid={Boolean(invalid)}>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
            <label htmlFor="pickup-date" className="sr-only">
              Pick-up date
            </label>
            <input
              id="pickup-date"
              type="date"
              required
              min={TODAY}
              aria-invalid={invalid}
              value={form.pickupDate}
              onChange={(e) => setForm({ ...form, pickupDate: e.target.value })}
              className={controlClass}
            />
            <label htmlFor="pickup-time" className="sr-only">
              Pick-up time
            </label>
            <input
              id="pickup-time"
              type="time"
              required
              aria-invalid={invalid}
              value={form.pickupTime}
              onChange={(e) => setForm({ ...form, pickupTime: e.target.value })}
              className={`${controlClass} w-auto border-l border-ink-200 pl-3`}
            />
          </div>
        </Cell>

        <Cell label="Return" groupId="return-when" icon={Clock} invalid={Boolean(invalid)}>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
            <label htmlFor="return-date" className="sr-only">
              Return date
            </label>
            <input
              id="return-date"
              type="date"
              required
              min={form.pickupDate}
              aria-invalid={invalid}
              value={form.returnDate}
              onChange={(e) => setForm({ ...form, returnDate: e.target.value })}
              className={controlClass}
            />
            <label htmlFor="return-time" className="sr-only">
              Return time
            </label>
            <input
              id="return-time"
              type="time"
              required
              aria-invalid={invalid}
              value={form.returnTime}
              onChange={(e) => setForm({ ...form, returnTime: e.target.value })}
              className={`${controlClass} w-auto border-l border-ink-200 pl-3`}
            />
          </div>
        </Cell>

        <div className="flex md:col-span-2 xl:col-span-1">
          <button
            type="submit"
            className="btn btn-accent btn-lg w-full rounded-[14px] xl:h-full xl:px-8"
          >
            <Search aria-hidden className="h-4 w-4" strokeWidth={2.25} />
            Search Cars
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="mx-2 mb-1 mt-3 text-sm font-medium text-red-700">
          {error}
        </p>
      )}

      {!locationsPending && pickupPoints.length === 0 && (
        <p className="mx-2 mb-1 mt-3 text-xs text-ink-500">
          No pickup locations are set up yet - searching across the whole fleet.
        </p>
      )}
    </form>
  );
}

/**
 * One field of the bar: a small label with its icon, and the control(s).
 *
 * Pass `htmlFor` for a single control (the label is a real <label>), or
 * `groupId` for a date+time pair (the label names a role="group" and each
 * input carries its own visually hidden label).
 */
function Cell({
  label,
  htmlFor,
  groupId,
  icon: Icon,
  invalid,
  children,
}: {
  label: string;
  htmlFor?: string;
  groupId?: string;
  icon: typeof MapPin;
  invalid: boolean;
  children: ReactNode;
}) {
  const labelContent = (
    <>
      <Icon aria-hidden className="h-3.5 w-3.5 text-ink-400" strokeWidth={1.75} />
      {label}
    </>
  );
  const labelClass =
    'mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-500';

  return (
    <div
      role={groupId ? 'group' : undefined}
      aria-labelledby={groupId}
      className={`rounded-[14px] border px-4 py-3 transition-colors duration-200 ${
        invalid
          ? 'border-red-300 bg-red-50/60'
          : 'border-transparent bg-ink-50 hover:bg-ink-100/70 focus-within:border-ink-900 focus-within:bg-white'
      }`}
    >
      {htmlFor ? (
        <label htmlFor={htmlFor} className={labelClass}>
          {labelContent}
        </label>
      ) : (
        <span id={groupId} className={labelClass}>
          {labelContent}
        </span>
      )}
      {children}
    </div>
  );
}
