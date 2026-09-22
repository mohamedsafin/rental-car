/**
 * pages/ReportsPage.tsx
 * ---------------------------------------------------------------------------
 * Revenue, bookings and fleet utilisation (BRD 48-50).
 *
 * The two headline numbers are shown side by side and LABELLED DIFFERENTLY on
 * purpose: "Revenue (paid)" and "Booked value". They are usually different,
 * and a dashboard that shows only one of them under the word "revenue" is how
 * a business ends up forecasting against money it never received.
 *
 * The date range lives in the URL, so a figure someone screenshots for a board
 * pack can be linked back to the exact query that produced it.
 */
import { useSearchParams } from 'react-router-dom';
import RevenueTrend from '../components/RevenueTrend';
import ProfitabilityReport from '../components/ProfitabilityReport';
import {
  useBookingsReport,
  useFleetReport,
  useRevenueReport,
} from '../features/output/useOutput';

/** Month boundaries in UTC, matching how the backend groups. */
function monthRange(offset = 0) {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset + 1, 1));
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

function Stat({
  label,
  value,
  hint,
  emphasis,
}: {
  label: string;
  value: string;
  hint?: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={
        emphasis
          ? 'rounded-lg border border-slate-900 bg-slate-900 p-4 text-white'
          : 'rounded-lg border border-slate-200 bg-white p-4'
      }
    >
      <p className={emphasis ? 'text-xs text-slate-300' : 'text-xs text-slate-500'}>{label}</p>
      <p className="mt-1 text-2xl font-bold tracking-tight">{value}</p>
      {hint && (
        <p className={emphasis ? 'mt-1 text-xs text-slate-400' : 'mt-1 text-xs text-slate-500'}>
          {hint}
        </p>
      )}
    </div>
  );
}

export default function ReportsPage() {
  const [params, setParams] = useSearchParams();
  const thisMonth = monthRange();

  const from = params.get('from') ?? thisMonth.from;
  const to = params.get('to') ?? thisMonth.to;
  const range = { from, to };

  const { data: revenue, isPending: revenuePending } = useRevenueReport(range);
  const { data: bookings } = useBookingsReport(range);
  const { data: fleet } = useFleetReport(range);

  function setRange(next: { from: string; to: string }) {
    const params = new URLSearchParams();
    params.set('from', next.from);
    params.set('to', next.to);
    setParams(params);
  }

  const currency = 'AED';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Reports</h2>
          <p className="text-sm text-slate-500">
            Revenue is what was <strong>paid</strong>. Booked value is what customers agreed to pay.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-600">From</span>
            <input
              type="date"
              value={from}
              onChange={(event) => setRange({ from: event.target.value, to })}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-600">To</span>
            <input
              type="date"
              value={to}
              onChange={(event) => setRange({ from, to: event.target.value })}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
          <button
            type="button"
            onClick={() => setRange(monthRange())}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
          >
            This month
          </button>
          <button
            type="button"
            onClick={() => setRange(monthRange(-1))}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
          >
            Last month
          </button>
        </div>
      </div>

      {revenuePending && <p className="text-sm text-slate-500">Loading...</p>}

      {revenue && (
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Revenue (paid)"
            value={`${currency} ${revenue.netRevenue}`}
            hint={`${revenue.paymentCount} payments, less ${currency} ${revenue.refunds} refunded`}
            emphasis
          />
          <Stat
            label="Booked value"
            value={`${currency} ${bookings?.bookedValue ?? '0.00'}`}
            hint="Agreed, not necessarily received"
          />
          <Stat
            label="Deposits held"
            value={`${currency} ${revenue.depositsHeld}`}
            hint="Customers' money, not income"
          />
          <Stat
            label="Fleet utilisation"
            value={`${fleet?.fleetUtilisation ?? 0}%`}
            hint={`${fleet?.fleetSize ?? 0} vehicles over ${fleet?.windowDays ?? 0} days`}
          />
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {bookings && (
          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <h3 className="text-sm font-semibold text-slate-900">Bookings</h3>
            <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-xs text-slate-500">Total</dt>
                <dd className="text-lg font-semibold text-slate-900">{bookings.totalBookings}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Cancellations</dt>
                <dd className="text-lg font-semibold text-slate-900">
                  {bookings.cancellations}{' '}
                  <span className="text-sm font-normal text-slate-500">
                    ({bookings.cancellationRate}%)
                  </span>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Average rental</dt>
                <dd className="text-lg font-semibold text-slate-900">
                  {bookings.averageRentalDays} days
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Discounts given</dt>
                <dd className="text-lg font-semibold text-slate-900">
                  {currency} {bookings.discountsGiven}
                </dd>
              </div>
            </dl>

            {bookings.byStatus.length > 0 && (
              <ul className="mt-5 space-y-2">
                {bookings.byStatus.map((row) => (
                  <li key={row.status} className="flex items-center justify-between text-sm">
                    <span className="text-slate-600">
                      {row.status.replace(/_/g, ' ').toLowerCase()}
                    </span>
                    <span className="text-slate-900">
                      {row.count}{' '}
                      <span className="text-xs text-slate-500">
                        ({currency} {row.value})
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {revenue && (
          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <h3 className="text-sm font-semibold text-slate-900">Money received</h3>
            <p className="mt-1 text-xs text-slate-500">
              Broken down by gateway. We never see a card scheme - no card data touches this system.
            </p>

            {revenue.byProvider.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">No payments in this period.</p>
            ) : (
              <ul className="mt-4 space-y-2">
                {revenue.byProvider.map((row) => (
                  <li key={row.provider} className="flex items-center justify-between text-sm">
                    <span className="text-slate-600">{row.provider}</span>
                    <span className="text-slate-900">
                      {currency} {row.amount}{' '}
                      <span className="text-xs text-slate-500">({row.count})</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>

      {/*
        The shape of the month, then whether each car was worth it. Both sit
        above utilisation because "busy" is only interesting once you know what
        busy earned.
      */}
      <RevenueTrend range={range} currency={currency} />

      <ProfitabilityReport range={range} currency={currency} />

      {fleet && fleet.vehicles.length > 0 && (
        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <header className="border-b border-slate-200 px-5 py-3">
            <h3 className="text-sm font-semibold text-slate-900">Fleet utilisation</h3>
            <p className="mt-1 text-xs text-slate-500">
              Rented days over <strong>available</strong> days. Workshop time is taken out of the
              denominator, so a well-maintained car is not penalised for being off the road.
            </p>
          </header>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Vehicle</th>
                  <th className="px-4 py-3">Bookings</th>
                  <th className="px-4 py-3">Rented</th>
                  <th className="px-4 py-3">Workshop</th>
                  <th className="px-4 py-3">Utilisation</th>
                  <th className="px-4 py-3">Booked value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {fleet.vehicles.map((row) => (
                  <tr key={row.vehicleId}>
                    <td className="px-4 py-3">
                      <p className="text-slate-900">{row.vehicle}</p>
                      <p className="text-xs text-slate-500">
                        {row.registrationNumber} - {row.category}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{row.bookings}</td>
                    <td className="px-4 py-3 text-slate-600">{row.rentedDays}d</td>
                    <td className="px-4 py-3 text-slate-600">
                      {row.maintenanceDays > 0 ? `${row.maintenanceDays}d` : '-'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className="h-full rounded-full bg-slate-900"
                            style={{ width: `${Math.min(100, row.utilisation)}%` }}
                          />
                        </div>
                        <span className="text-slate-900">{row.utilisation}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {currency} {row.bookedValue}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
