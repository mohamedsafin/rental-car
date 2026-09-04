/**
 * components/ExtensionRequest.tsx
 * ---------------------------------------------------------------------------
 * "I would like to keep the car longer" (BRD 23), from the customer's side.
 *
 * The availability check happens on the BACKEND when the request is submitted,
 * so a customer is told straight away that the car is spoken for rather than
 * waiting on a request that was never going to be approved.
 */
import { useState, type FormEvent } from 'react';
import { useRental, useRequestExtension } from '../features/rentals/useRentals';
import type { Booking } from '../types/booking';

export default function ExtensionRequest({ booking }: { booking: Booking }) {
  const { data } = useRental(booking.id);
  const requestExtension = useRequestExtension(booking.id);

  const [newDate, setNewDate] = useState('');
  const [newTime, setNewTime] = useState('10:00');
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  // Only an active rental can be extended - before pickup the customer should
  // just change the booking dates instead.
  if (booking.status !== 'ACTIVE' && booking.status !== 'EXTENSION_REQUESTED') return null;

  const extensions = data?.extensions ?? [];
  const pending = extensions.find((extension) => extension.status === 'REQUESTED');
  const lastDecided = extensions.find(
    (extension) => extension.status === 'APPROVED' || extension.status === 'REJECTED',
  );

  const currentReturn = new Date(booking.period.returnAt);
  const minDate = currentReturn.toISOString().slice(0, 10);

  function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    requestExtension.mutate(`${newDate}T${newTime}:00.000Z`, {
      onSuccess: () => setOpen(false),
      onError: (err) => setError(err.message),
    });
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="font-semibold text-slate-900">Need the car for longer?</h2>

      {pending ? (
        <div className="mt-3 rounded-md border border-purple-200 bg-purple-50 p-3 text-sm text-purple-900">
          <p className="font-medium">Request awaiting review</p>
          <p className="mt-1">
            Until {new Date(pending.requestedReturnAt).toLocaleString()} -{' '}
            {pending.additionalDays} extra day(s), {pending.currency} {pending.additionalAmount}
          </p>
        </div>
      ) : (
        <>
          {lastDecided?.status === 'REJECTED' && lastDecided.rejectionReason && (
            <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <span className="font-medium">Your last request was declined:</span>{' '}
              {lastDecided.rejectionReason}
            </p>
          )}

          {open ? (
            <form onSubmit={submit} className="mt-3 space-y-3">
              {error && (
                <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {error}
                </p>
              )}

              <p className="text-sm text-slate-600">
                Currently due back {currentReturn.toLocaleString()}.
              </p>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">New return date</span>
                  <input
                    type="date"
                    required
                    min={minDate}
                    value={newDate}
                    onChange={(e) => setNewDate(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">New return time</span>
                  <input
                    type="time"
                    required
                    value={newTime}
                    onChange={(e) => setNewTime(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
              </div>

              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={requestExtension.isPending || !newDate}
                  className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {requestExtension.isPending ? 'Checking availability...' : 'Request extension'}
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="text-sm text-slate-600 hover:underline"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <>
              <p className="mt-1 text-sm text-slate-600">
                We will check the vehicle is free and tell you the extra cost before anything is
                charged.
              </p>
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="mt-3 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Request an extension
              </button>
            </>
          )}
        </>
      )}
    </section>
  );
}
