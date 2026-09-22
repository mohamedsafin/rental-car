/**
 * components/BookingEditPanel.tsx
 * ---------------------------------------------------------------------------
 * "They want Thursday instead of Wednesday."
 *
 * The most ordinary request at a rental desk, and until now there was no way
 * to do it: staff cancelled the booking and made a new one, losing the
 * reference number, the price snapshot and any payment attached to it.
 *
 * The price is NOT editable here. It is recalculated by the server from the
 * new dates and car, and the panel shows what it became - because a screen
 * that let somebody type a total would let them type the wrong one, and the
 * figure on an invoice has to be one the pricing engine actually produced.
 */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarClock } from 'lucide-react';
import { patchData } from '../services/api';
import { useVehicleOptions } from '../features/fleet/useFleetAdmin';
import type { NormalisedApiError } from '../types/api';

/** Bookings that can still be moved. Once the car is out, the dates are history. */
const EDITABLE = [
  'PENDING',
  'DOCUMENT_VERIFICATION',
  'PAYMENT_PENDING',
  'CONFIRMED',
  'READY_FOR_PICKUP',
];

/** An ISO instant as `datetime-local` wants it, in the viewer's own zone. */
function toLocalInput(iso: string): string {
  const date = new Date(iso);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export default function BookingEditPanel({
  bookingId,
  bookingStatus,
  pickupAt,
  returnAt,
  vehicleId,
}: {
  bookingId: string;
  bookingStatus: string;
  pickupAt: string;
  returnAt: string;
  vehicleId: string;
}) {
  const queryClient = useQueryClient();
  const vehicles = useVehicleOptions();

  const [open, setOpen] = useState(false);
  const [pickup, setPickup] = useState(() => toLocalInput(pickupAt));
  const [dropoff, setDropoff] = useState(() => toLocalInput(returnAt));
  const [vehicle, setVehicle] = useState(vehicleId);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const edit = useMutation<unknown, NormalisedApiError, Record<string, unknown>>({
    mutationFn: (changes) => patchData(`/bookings/${bookingId}`, changes),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['booking', bookingId] });
      void queryClient.invalidateQueries({ queryKey: ['bookings'] });
      void queryClient.invalidateQueries({ queryKey: ['agreement', bookingId] });
      setOpen(false);
    },
  });

  if (!EDITABLE.includes(bookingStatus)) return null;

  const changed =
    pickup !== toLocalInput(pickupAt) ||
    dropoff !== toLocalInput(returnAt) ||
    vehicle !== vehicleId;

  function submit() {
    setError(null);

    const changes: Record<string, unknown> = {};
    if (pickup !== toLocalInput(pickupAt)) changes.pickupAt = new Date(pickup).toISOString();
    if (dropoff !== toLocalInput(returnAt)) changes.returnAt = new Date(dropoff).toISOString();
    if (vehicle !== vehicleId) changes.vehicleId = vehicle;
    if (reason.trim()) changes.reason = reason.trim();

    edit.mutate(changes, { onError: (err) => setError(err.message) });
  }

  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <CalendarClock className="mt-0.5 h-5 w-5 text-slate-400" aria-hidden />
          <div>
            <h3 className="section-title">Change the dates or the car</h3>
            <p className="mt-0.5 text-sm text-slate-500">
              The price is worked out again from the new dates. Possible until the car goes out.
            </p>
          </div>
        </div>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => setOpen((o) => !o)}>
          {open ? 'Cancel' : 'Edit booking'}
        </button>
      </div>

      {open && (
        <div className="mt-4 space-y-3">
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs text-slate-500">Collection</span>
              <input
                type="datetime-local"
                className="input mt-1"
                value={pickup}
                onChange={(e) => setPickup(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="text-xs text-slate-500">Return</span>
              <input
                type="datetime-local"
                className="input mt-1"
                value={dropoff}
                onChange={(e) => setDropoff(e.target.value)}
              />
            </label>
          </div>

          <label className="block">
            <span className="text-xs text-slate-500">Vehicle</span>
            <select
              className="input mt-1"
              value={vehicle}
              onChange={(e) => setVehicle(e.target.value)}
            >
              {vehicles.data?.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.brand} {option.model} · {option.registrationNumber}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-slate-400">
              The server refuses a car that is already booked over those dates.
            </span>
          </label>

          <label className="block">
            <span className="text-xs text-slate-500">Why (shown on the booking's history)</span>
            <input
              className="input mt-1"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Customer asked to move it back a day"
            />
          </label>

          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!changed || edit.isPending}
            onClick={submit}
          >
            {edit.isPending ? 'Saving…' : 'Save the change'}
          </button>

          <p className="text-xs text-slate-500">
            If an agreement has already been signed for this booking, void it and issue a
            replacement afterwards - the old one names the old dates.
          </p>
        </div>
      )}
    </section>
  );
}
