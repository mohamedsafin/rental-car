/**
 * components/DateOfBirthPrompt.tsx
 * ---------------------------------------------------------------------------
 * "We need your date of birth" — asked where the answer is needed.
 *
 * ===========================================================================
 * WHY THIS IS NOT JUST AN ERROR MESSAGE
 * ===========================================================================
 * A minimum driving age is a real rule and the booking must refuse without it.
 * But the refusal used to read "add it to your profile and try again" while
 * the profile HAD NO SUCH FIELD — not at registration, not on the account
 * page, nowhere. Every customer who reached that message was stuck, and the
 * message confidently pointed them at a dead end.
 *
 * Even with the field added elsewhere, sending somebody out of a half-finished
 * booking to hunt for a form is how a booking gets abandoned. So it is asked
 * for here, in the panel, with the dates and the price still on screen: one
 * field, save, and the booking goes through.
 *
 * The age is checked against the PICKUP DATE, not today, because that is the
 * rule the server enforces — somebody turning 25 next week can book for the
 * week after and not for tomorrow, and being told that here beats being told
 * it after they have typed everything again.
 */
import { useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { useUpdateMyProfile } from '../features/customer/useCustomer';
import type { NormalisedApiError } from '../types/api';

export default function DateOfBirthPrompt({
  minimumAge,
  onSaved,
}: {
  /** Pulled out of the server's own message, so the two can never disagree. */
  minimumAge: number | null;
  /** Called once it is stored, so the caller can retry the booking. */
  onSaved: () => void;
}) {
  const updateProfile = useUpdateMyProfile();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  /*
   * Nobody old enough to rent a car was born after today, and the date picker
   * should not offer a century of irrelevant years either side.
   */
  const today = new Date().toISOString().slice(0, 10);
  const earliest = new Date(Date.now() - 100 * 365.25 * 86_400_000).toISOString().slice(0, 10);

  function save() {
    if (!value) return;
    setError(null);

    updateProfile.mutate(
      { dateOfBirth: value },
      {
        onSuccess: () => onSaved(),
        onError: (caught) => setError((caught as NormalisedApiError).message),
      },
    );
  }

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
      <div className="flex gap-3">
        <span aria-hidden className="mt-0.5 shrink-0 text-amber-600">
          <CalendarDays className="h-4 w-4" />
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-amber-900">One thing before you book</p>
          <p className="mt-1 text-sm leading-relaxed text-amber-900/90">
            We need your date of birth
            {minimumAge !== null ? ` — drivers must be at least ${minimumAge}` : ''}. We only ask
            once.
          </p>

          <div className="mt-3 flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1">
              <label
                htmlFor="quote-date-of-birth"
                className="block text-xs font-medium text-amber-900"
              >
                Date of birth
              </label>
              <input
                id="quote-date-of-birth"
                type="date"
                value={value}
                max={today}
                min={earliest}
                onChange={(event) => setValue(event.target.value)}
                className="field-control mt-1 min-h-0 py-2 text-sm"
              />
            </div>

            <button
              type="button"
              onClick={save}
              disabled={!value || updateProfile.isPending}
              className="btn btn-primary btn-sm"
            >
              {updateProfile.isPending ? 'Saving…' : 'Save and continue'}
            </button>
          </div>

          {error && (
            <p role="alert" className="mt-2 text-sm text-red-700">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
