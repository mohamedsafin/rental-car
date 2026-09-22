/**
 * components/RevenueTrend.tsx
 * ---------------------------------------------------------------------------
 * The month's money, day by day.
 *
 * "AED 84,000 in March" is the same number whether March was steady or was
 * three good weekends and nineteen dead days - and those two months call for
 * completely different decisions about pricing and fleet size. The shape is
 * the information; the total is only its sum.
 *
 * Drawn as bars in plain HTML rather than with a charting library: this is one
 * series of at most 31 values, and a 90KB dependency to draw 31 rectangles is
 * a page that loads slower for no one's benefit. Days with no money keep their
 * place in the row, because a chart that closes the gaps makes a dead week
 * look like a busy one.
 */
import { useQuery } from '@tanstack/react-query';
import { getData } from '../services/api';
import type { NormalisedApiError } from '../types/api';

interface Series {
  period: { from: string; to: string };
  days: { date: string; amount: string }[];
}

export default function RevenueTrend({
  range,
  currency,
}: {
  range: { from: string; to: string };
  currency: string;
}) {
  const { data, isPending } = useQuery<Series, NormalisedApiError>({
    queryKey: ['report-revenue-series', range],
    queryFn: () => getData<Series>('/reports/revenue-series', range),
    placeholderData: (previous) => previous,
  });

  if (isPending) return <div className="skeleton h-40 rounded-xl" />;
  if (!data || data.days.length === 0) return null;

  const amounts = data.days.map((day) => Number(day.amount));
  const peak = Math.max(...amounts, 0);
  const total = amounts.reduce((sum, value) => sum + value, 0);
  const busiest = data.days[amounts.indexOf(peak)];

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">Money in, day by day</h3>
        <p className="text-xs text-slate-500">
          {currency} {total.toFixed(2)} over {data.days.length} days
        </p>
      </div>

      {peak === 0 ? (
        <p className="mt-4 text-sm text-slate-500">Nothing was received in this period.</p>
      ) : (
        <>
          <div className="mt-4 flex h-32 items-end gap-[2px]">
            {data.days.map((day) => {
              const value = Number(day.amount);
              const height = peak === 0 ? 0 : Math.round((value / peak) * 100);
              return (
                <div
                  key={day.date}
                  className="group relative flex-1"
                  // The title is the whole tooltip - no library, and it works
                  // on a keyboard and a screen reader without extra markup.
                  title={`${day.date}: ${currency} ${day.amount}`}
                >
                  <div
                    className={`w-full rounded-t ${value > 0 ? 'bg-slate-900' : 'bg-slate-100'}`}
                    style={{ height: `${Math.max(height, value > 0 ? 3 : 2)}%` }}
                  />
                </div>
              );
            })}
          </div>

          <div className="mt-2 flex justify-between text-[11px] text-slate-400">
            <span>{data.days[0]?.date}</span>
            <span>{data.days[data.days.length - 1]?.date}</span>
          </div>

          <p className="mt-3 text-xs text-slate-500">
            Busiest day: {busiest?.date} at {currency} {busiest?.amount}. Bars are money received,
            so a booking paid for in advance shows on the day it was paid, not the day it starts.
          </p>
        </>
      )}
    </section>
  );
}
