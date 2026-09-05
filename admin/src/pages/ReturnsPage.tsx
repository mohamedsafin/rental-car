/**
 * pages/ReturnsPage.tsx
 * ---------------------------------------------------------------------------
 * Cars due back today (BRD 26).
 *
 * The mirror of the pickups board, and the reason `dateField=return` exists on
 * the bookings endpoint: "due back today" is a question about `returnAt`, and
 * filtering on `pickupAt` would list whatever went out today instead - a
 * completely different set of cars.
 *
 * Overdue rows are called out because a late return is money. The charge is
 * calculated at the return itself from the configured rate; this board only
 * says which cars to chase.
 */
import { useSearchParams, Link } from 'react-router-dom';
import { useReturns, dayBounds } from '../features/operations/useOperations';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Hours a rental is past its return time. Negative means still in time. */
function hoursLate(returnAt: string): number {
  return (Date.now() - new Date(returnAt).getTime()) / 3_600_000;
}

export default function ReturnsPage() {
  const [params, setParams] = useSearchParams();
  const date = params.get('date') ?? today();

  const { data, isPending } = useReturns(dayBounds(date));

  function setDate(value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set('date', value);
    else next.delete('date');
    setParams(next);
  }

  const items = [...(data?.items ?? [])].sort(
    (a, b) => new Date(a.period.returnAt).getTime() - new Date(b.period.returnAt).getTime(),
  );

  const overdue = items.filter((booking) => hoursLate(booking.period.returnAt) > 0).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Returns</h2>
          <p className="text-sm text-slate-500">
            Active rentals due back. Record the return from the booking, with the car present.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-600">Due on</span>
            <input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            />
          </label>
          <button
            type="button"
            onClick={() => setDate(today())}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
          >
            Today
          </button>
        </div>
      </div>

      {overdue > 0 && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {overdue} rental{overdue === 1 ? ' is' : 's are'} past the agreed return time. Late-return
          charges are calculated at the return itself, from the configured rate.
        </p>
      )}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        {isPending && <p className="px-5 py-8 text-sm text-slate-500">Loading...</p>}

        {!isPending && items.length === 0 && (
          <p className="px-5 py-10 text-center text-sm text-slate-500">
            Nothing due back on {date}.
          </p>
        )}

        {items.length > 0 && (
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Due</th>
                <th className="px-4 py-3">Booking</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Vehicle</th>
                <th className="px-4 py-3">Back to</th>
                <th className="px-4 py-3">Deposit held</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((booking) => {
                const late = hoursLate(booking.period.returnAt);
                return (
                  <tr key={booking.id} className={late > 0 ? 'bg-amber-50/60' : undefined}>
                    <td className="px-4 py-3">
                      <span className={late > 0 ? 'font-semibold text-amber-900' : 'text-slate-900'}>
                        {timeOf(booking.period.returnAt)}
                      </span>
                      {late > 0 && (
                        <span className="block text-[11px] text-amber-800">
                          {Math.floor(late)}h overdue
                        </span>
                      )}
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
                      {booking.locations.dropoff?.name ?? booking.locations.pickup?.name ?? 'Office'}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {booking.pricing.currency} {booking.pricing.securityDeposit}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        to={`/bookings/${booking.id}`}
                        className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white"
                      >
                        Take back
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {data && <p className="text-xs text-slate-500">{data.pagination.total} due back on {date}.</p>}
    </div>
  );
}
