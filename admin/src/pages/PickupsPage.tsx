/**
 * pages/PickupsPage.tsx
 * ---------------------------------------------------------------------------
 * Cars going out today (BRD 24).
 *
 * A day board, not a search screen. The question it answers is "what do I need
 * to have ready, and by when" - so it defaults to today, sorts by pickup time,
 * and every row leads to the one action that matters: recording the handover.
 *
 * Handover itself deliberately stays on the booking's own page. It needs
 * mileage, fuel, condition notes and photographs taken at the car, and a
 * one-click "mark as collected" button on a list would encourage recording a
 * handover that nobody actually performed.
 */
import { useSearchParams, Link } from 'react-router-dom';
import { usePickups, dayBounds } from '../features/operations/useOperations';
import BookingStatusBadge from '../components/BookingStatusBadge';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Overdue collections are the ones worth shouting about. */
function isLate(pickupAt: string): boolean {
  return new Date(pickupAt) < new Date();
}

export default function PickupsPage() {
  const [params, setParams] = useSearchParams();
  const date = params.get('date') ?? today();
  const status = params.get('status') ?? 'READY_FOR_PICKUP';

  const { data, isPending } = usePickups(dayBounds(date), status);

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
  }

  const items = [...(data?.items ?? [])].sort(
    (a, b) => new Date(a.period.pickupAt).getTime() - new Date(b.period.pickupAt).getTime(),
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Pickups</h2>
          <p className="text-sm text-slate-500">
            Vehicles due to be collected. Record the handover from the booking, at the car.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-600">Date</span>
            <input
              type="date"
              value={date}
              onChange={(event) => setParam('date', event.target.value)}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            />
          </label>
          <button
            type="button"
            onClick={() => setParam('date', today())}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
          >
            Today
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {[
          { value: 'READY_FOR_PICKUP', label: 'Ready for pickup' },
          { value: 'CONFIRMED', label: 'Confirmed, not yet prepared' },
        ].map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setParam('status', option.value)}
            className={
              status === option.value
                ? 'rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white'
                : 'rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700'
            }
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        {isPending && <p className="px-5 py-8 text-sm text-slate-500">Loading...</p>}

        {!isPending && items.length === 0 && (
          <p className="px-5 py-10 text-center text-sm text-slate-500">
            Nothing due for collection on {date}.
          </p>
        )}

        {items.length > 0 && (
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Time</th>
                <th className="px-4 py-3">Booking</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Vehicle</th>
                <th className="px-4 py-3">From</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((booking) => {
                const late = isLate(booking.period.pickupAt);
                return (
                  <tr key={booking.id} className={late ? 'bg-amber-50/60' : undefined}>
                    <td className="px-4 py-3">
                      <span className={late ? 'font-semibold text-amber-900' : 'text-slate-900'}>
                        {timeOf(booking.period.pickupAt)}
                      </span>
                      {late && <span className="block text-[11px] text-amber-800">overdue</span>}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">
                      {booking.bookingNumber}
                    </td>
                    <td className="px-4 py-3 text-slate-900">
                      {booking.customer?.fullName ?? '-'}
                      <span className="block text-xs text-slate-500">
                        {booking.customer?.phone ?? booking.customer?.email ?? ''}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-900">
                      {booking.vehicle.name}
                      <span className="block text-xs text-slate-500">
                        {booking.vehicle.registrationNumber ?? ''}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {booking.locations.pickup?.name ?? 'Office'}
                    </td>
                    <td className="px-4 py-3">
                      <BookingStatusBadge status={booking.status} label={booking.statusLabel} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        to={`/bookings/${booking.id}`}
                        className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white"
                      >
                        Hand over
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {data && <p className="text-xs text-slate-500">{data.pagination.total} due on {date}.</p>}
    </div>
  );
}
