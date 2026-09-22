/**
 * components/SetupChecklist.tsx
 * ---------------------------------------------------------------------------
 * "These are switched off, and here is what that means."
 *
 * ===========================================================================
 * WHY IT SAYS CONSEQUENCE, NOT "EMPTY"
 * ===========================================================================
 * The fields below it are already visibly blank. An empty box says nothing
 * about what that costs - it looks like something somebody has not got round
 * to, not like a rule that is currently not being applied. A blank minimum
 * driver age does not throw an error; it means nobody's age is checked, and
 * nothing else on this screen would ever tell you that.
 *
 * It disappears entirely once the blanks that matter are filled. A permanent
 * banner is furniture, and furniture is invisible.
 *
 * Optional items are listed but never counted as a problem, so the panel does
 * not spend its credibility nagging about a setting that is fine left blank.
 */
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CircleAlert, Info } from 'lucide-react';
import { getData } from '../services/api';
import type { NormalisedApiError } from '../types/api';

type Severity = 'blocking' | 'degraded' | 'optional';

interface ReadinessItem {
  key: string;
  label: string;
  severity: Severity;
  consequence: string;
}

interface Readiness {
  ready: boolean;
  blocking: number;
  items: ReadinessItem[];
}

const STYLE: Record<Severity, { icon: typeof AlertTriangle; chip: string; note: string }> = {
  blocking: {
    icon: CircleAlert,
    chip: 'bg-critical-50 text-critical-700',
    note: 'Exposed today',
  },
  degraded: {
    icon: AlertTriangle,
    chip: 'bg-caution-50 text-caution-700',
    note: 'Doing nothing',
  },
  optional: {
    icon: Info,
    chip: 'bg-ink-100 text-ink-600',
    note: 'Optional',
  },
};

export default function SetupChecklist() {
  const { data } = useQuery<Readiness, NormalisedApiError>({
    queryKey: ['settings-readiness'],
    queryFn: () => getData<Readiness>('/settings/readiness'),
    // It changes only when somebody edits a setting on this very page, so
    // re-asking on every visit is wasted work.
    staleTime: 5 * 60 * 1000,
  });

  if (!data) return null;

  // Nothing that matters is missing. Say nothing at all.
  const needsAttention = data.items.filter((item) => item.severity !== 'optional');
  if (needsAttention.length === 0) return null;

  return (
    <section aria-labelledby="setup-heading">
      <h3 id="setup-heading" className="section-title">
        Finish setting up
      </h3>

      <div className="card card-raised mt-3 overflow-hidden">
        <div className="border-b border-ink-100 bg-ink-50/60 px-5 py-3">
          <p className="text-[13px] text-ink-600">
            {data.blocking > 0 ? (
              <>
                <strong className="font-semibold text-ink-950">
                  {data.blocking} {data.blocking === 1 ? 'setting is' : 'settings are'} leaving you
                  exposed
                </strong>{' '}
                — these are values only you can supply.
              </>
            ) : (
              <>
                <strong className="font-semibold text-ink-950">
                  {needsAttention.length} {needsAttention.length === 1 ? 'feature is' : 'features are'}{' '}
                  switched off
                </strong>{' '}
                — each is waiting on a number from you.
              </>
            )}
          </p>
        </div>

        <ul className="divide-y divide-ink-100">
          {needsAttention.map((item) => {
            const style = STYLE[item.severity];
            const Icon = style.icon;

            return (
              <li key={item.key} className="flex gap-3 px-5 py-3.5">
                <span aria-hidden className="mt-0.5 shrink-0 text-ink-400">
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-medium text-ink-950">{item.label}</span>
                    <span className={`badge ${style.chip}`}>{style.note}</span>
                  </p>
                  <p className="mt-0.5 text-[12px] leading-snug text-ink-500">{item.consequence}</p>
                </div>
              </li>
            );
          })}
        </ul>

        <div className="border-t border-ink-100 px-5 py-2.5">
          <p className="text-[12px] text-ink-500">Fill these in below.</p>
        </div>
      </div>
    </section>
  );
}
