/**
 * components/ProfitabilityReport.tsx
 * ---------------------------------------------------------------------------
 * Which cars earn, and which cost.
 *
 * ===========================================================================
 * THE QUESTION THAT HAD NO ANSWER
 * ===========================================================================
 * Utilisation says how BUSY a car was. It does not say whether being busy was
 * worth it: a car out 90% of the month that spent AED 6,000 at the garage is a
 * worse asset than one out 60% that spent nothing, and the utilisation table
 * ranks them the other way round.
 *
 * So this ranks by NET - revenue minus what the car cost over the same period.
 * Costs come from the vehicle expense ledger, which maintenance, insurance and
 * accident repairs post to by themselves.
 *
 * When no cost has ever been recorded, every car's net equals its revenue.
 * That looks like a working report and is really an empty one, so the panel
 * says so in as many words rather than letting somebody plan a fleet around it.
 */
import { useQuery } from '@tanstack/react-query';
import { getData } from '../services/api';
import type { NormalisedApiError } from '../types/api';

interface ProfitabilityRow {
  vehicleId: string;
  vehicle: string;
  registrationNumber: string;
  category: string;
  revenue: string;
  costs: string;
  net: string;
  rentals: number;
  daysRented: number;
  utilisation: number;
}

interface Profitability {
  period: { from: string; to: string; days: number };
  totals: { revenue: string; costs: string; net: string };
  vehicles: ProfitabilityRow[];
  noCostsRecorded: boolean;
}

export default function ProfitabilityReport({
  range,
  currency,
}: {
  range: { from: string; to: string };
  currency: string;
}) {
  const { data, isPending } = useQuery<Profitability, NormalisedApiError>({
    queryKey: ['report-vehicles', range],
    queryFn: () => getData<Profitability>('/reports/vehicles', range),
    placeholderData: (previous) => previous,
  });

  if (isPending) return <div className="skeleton h-64 rounded-xl" />;
  if (!data) return null;

  // Cars nobody rented in the period would fill the table with zeros and push
  // the interesting rows off the screen.
  const rows = data.vehicles.filter((row) => row.rentals > 0 || Number(row.costs) > 0);

  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <header className="border-b border-slate-200 px-5 py-3">
        <h3 className="text-sm font-semibold text-slate-900">Does each car make money?</h3>
        <p className="mt-1 text-xs text-slate-500">
          Revenue net of VAT, less what the car cost over the same {data.period.days} days. Costs
          are entered whole on the day they were paid, not spread - so an annual premium lands in
          one month, and this report says so rather than smoothing it.
        </p>
      </header>

      <div className="grid gap-4 border-b border-slate-200 px-5 py-4 sm:grid-cols-3">
        <Total label="Revenue" value={`${currency} ${data.totals.revenue}`} />
        <Total label="Costs" value={`${currency} ${data.totals.costs}`} />
        <Total
          label="Net"
          value={`${currency} ${data.totals.net}`}
          tone={Number(data.totals.net) < 0 ? 'bad' : 'good'}
        />
      </div>

      {data.noCostsRecorded && (
        <p className="border-b border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-900">
          No costs have been recorded for any vehicle in this period, so every car shows its full
          revenue as profit. Add servicing, insurance and finance costs against a vehicle for this
          to mean anything.
        </p>
      )}

      {rows.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-slate-500">
          Nothing was rented and nothing was spent in this period.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Vehicle</th>
                <th className="px-4 py-3">Rentals</th>
                <th className="px-4 py-3">Out</th>
                <th className="px-4 py-3">Revenue</th>
                <th className="px-4 py-3">Costs</th>
                <th className="px-4 py-3">Net</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => {
                const net = Number(row.net);
                return (
                  <tr key={row.vehicleId}>
                    <td className="px-4 py-3">
                      <p className="text-slate-900">{row.vehicle}</p>
                      <p className="text-xs text-slate-500">
                        {row.registrationNumber} · {row.category}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{row.rentals}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {row.daysRented}d
                      <span className="ml-1 text-xs text-slate-400">({row.utilisation}%)</span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {currency} {row.revenue}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {Number(row.costs) > 0 ? `${currency} ${row.costs}` : '—'}
                    </td>
                    <td
                      className={`px-4 py-3 font-medium ${net < 0 ? 'text-red-700' : 'text-slate-900'}`}
                    >
                      {currency} {row.net}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Total({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p
        className={`text-lg font-semibold ${
          tone === 'bad' ? 'text-red-700' : tone === 'good' ? 'text-emerald-700' : 'text-slate-900'
        }`}
      >
        {value}
      </p>
    </div>
  );
}
