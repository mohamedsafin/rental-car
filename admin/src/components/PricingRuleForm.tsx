/**
 * components/PricingRuleForm.tsx
 * ---------------------------------------------------------------------------
 * Create a weekend, seasonal or long-term-discount rule (BRD 16).
 *
 * The form changes shape with the rule type, because each type needs different
 * information: weekdays for a weekend rule, a date window for a seasonal one,
 * a day threshold for a discount. Showing all of them at once would invite
 * half-configured rules, which the backend rejects anyway.
 */
import { useState, type FormEvent } from 'react';
import { useCreatePricingRule } from '../features/pricing/usePricingAdmin';
import { useAdminCategories } from '../features/fleet/useFleetAdmin';

type RuleType = 'WEEKEND' | 'SEASONAL' | 'LONG_TERM_DISCOUNT';

const WEEKDAYS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 7, label: 'Sun' },
];

export default function PricingRuleForm({ onError }: { onError: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<RuleType>('WEEKEND');
  const [name, setName] = useState('');
  const [percentage, setPercentage] = useState('');
  const [weekdays, setWeekdays] = useState<number[]>([6, 7]);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [minDays, setMinDays] = useState('');
  const [categoryId, setCategoryId] = useState('');

  const { data: categoryData } = useAdminCategories();
  const createRule = useCreatePricingRule();

  function submit(event: FormEvent) {
    event.preventDefault();

    createRule.mutate(
      {
        name,
        type,
        adjustmentPercentage: percentage,
        categoryId: categoryId || undefined,
        ...(type === 'WEEKEND' ? { weekdays } : {}),
        ...(type === 'SEASONAL'
          ? {
              startDate: startDate ? new Date(`${startDate}T00:00:00.000Z`).toISOString() : undefined,
              endDate: endDate ? new Date(`${endDate}T23:59:59.000Z`).toISOString() : undefined,
            }
          : {}),
        ...(type === 'LONG_TERM_DISCOUNT' ? { minDays: Number(minDays) } : {}),
      },
      {
        onSuccess: () => {
          setOpen(false);
          setName('');
          setPercentage('');
          setMinDays('');
        },
        onError: (error) => onError(error.message),
      },
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
      >
        Add pricing rule
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Rule name</span>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Weekend surcharge"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium text-slate-700">Type</span>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as RuleType)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="WEEKEND">Weekend surcharge</option>
            <option value="SEASONAL">Seasonal rate</option>
            <option value="LONG_TERM_DISCOUNT">Long-term discount</option>
          </select>
        </label>

        {type === 'WEEKEND' && (
          <div className="sm:col-span-2">
            <span className="text-sm font-medium text-slate-700">Applies on</span>
            <div className="mt-2 flex flex-wrap gap-2">
              {WEEKDAYS.map((day) => (
                <label
                  key={day.value}
                  className={
                    weekdays.includes(day.value)
                      ? 'cursor-pointer rounded-full border border-slate-900 bg-slate-900 px-3 py-1 text-sm text-white'
                      : 'cursor-pointer rounded-full border border-slate-300 px-3 py-1 text-sm text-slate-700'
                  }
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={weekdays.includes(day.value)}
                    onChange={() =>
                      setWeekdays((current) =>
                        current.includes(day.value)
                          ? current.filter((d) => d !== day.value)
                          : [...current, day.value],
                      )
                    }
                  />
                  {day.label}
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              The UAE weekend varies by emirate - confirm with the client.
            </p>
          </div>
        )}

        {type === 'SEASONAL' && (
          <>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Season starts</span>
              <input
                type="date"
                required
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Season ends</span>
              <input
                type="date"
                required
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
          </>
        )}

        {type === 'LONG_TERM_DISCOUNT' && (
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Minimum rental days</span>
            <input
              type="number"
              min={1}
              required
              value={minDays}
              onChange={(e) => setMinDays(e.target.value)}
              placeholder="e.g. 7"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
        )}

        <label className="block">
          <span className="text-sm font-medium text-slate-700">Adjustment (%)</span>
          <input
            required
            inputMode="decimal"
            value={percentage}
            onChange={(e) => setPercentage(e.target.value)}
            placeholder={type === 'LONG_TERM_DISCOUNT' ? '-15' : '20'}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <span className="mt-1 block text-xs text-slate-500">
            Positive adds a surcharge, negative gives a discount.
          </span>
        </label>

        <label className="block">
          <span className="text-sm font-medium text-slate-700">Applies to</span>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">The whole fleet</option>
            {categoryData?.categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name} only
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="submit"
          disabled={createRule.isPending}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {createRule.isPending ? 'Saving...' : 'Create rule'}
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
  );
}
