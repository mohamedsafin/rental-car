/**
 * pages/PricingPage.tsx
 * ---------------------------------------------------------------------------
 * Where the client supplies the numbers the BRD says only they can supply
 * (BRD 16, 17, 38): VAT rate, rental policy limits, add-on prices, and
 * weekend / seasonal / long-term rules.
 *
 * This page is the reason the seed leaves everything blank. Rather than
 * shipping a made-up 5% VAT and a 50 AED child seat that nobody approved, the
 * engine reports "not configured" until someone fills these in here.
 */
import { useState } from 'react';
import {
  useAdminServices,
  usePricingRules,
  usePricingSettings,
  useUpdateService,
  useUpdateSetting,
  useDeletePricingRule,
} from '../features/pricing/usePricingAdmin';
import PricingRuleForm from '../components/PricingRuleForm';

const RULE_LABEL: Record<string, string> = {
  WEEKEND: 'Weekend',
  SEASONAL: 'Seasonal',
  LONG_TERM_DISCOUNT: 'Long-term discount',
};

const WEEKDAY_SHORT = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function PricingPage() {
  const { data: settingsData } = usePricingSettings();
  const { data: serviceData } = useAdminServices();
  const { data: ruleData } = usePricingRules();

  const updateSetting = useUpdateSetting();
  const updateService = useUpdateService();
  const deleteRule = useDeletePricingRule();

  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const vatSetting = settingsData?.settings.find((s) => s.key === 'pricing.vat_percentage');
  const vatUnset = !vatSetting || vatSetting.value.trim() === '';

  return (
    <div className="max-w-5xl space-y-8">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Pricing</h2>
        <p className="text-sm text-slate-600">
          Values the BRD leaves to you. Nothing here is pre-filled with invented numbers.
        </p>
      </div>

      {error && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {vatUnset && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          VAT is not configured. Quotes currently show no tax and carry a warning. Set
          <span className="font-mono"> pricing.vat_percentage</span> below once the client confirms it.
        </div>
      )}

      <section>
        <h3 className="font-semibold text-slate-900">Settings</h3>
        <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Setting</th>
                <th className="px-4 py-3">Value</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {settingsData?.settings.map((setting) => (
                <tr key={setting.key} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-900">{setting.label}</p>
                    <p className="font-mono text-xs text-slate-400">{setting.key}</p>
                    {setting.description && (
                      <p className="mt-0.5 text-xs text-slate-500">{setting.description}</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <input
                      value={drafts[setting.key] ?? setting.value}
                      onChange={(e) => setDrafts({ ...drafts, [setting.key]: e.target.value })}
                      placeholder="Not set"
                      className="w-40 rounded-md border border-slate-300 px-2 py-1 text-sm"
                    />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      disabled={
                        drafts[setting.key] === undefined || drafts[setting.key] === setting.value
                      }
                      onClick={() => {
                        setError(null);
                        updateSetting.mutate(
                          { key: setting.key, value: drafts[setting.key] ?? '' },
                          { onError: (e) => setError(e.message) },
                        );
                      }}
                      className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 disabled:opacity-40"
                    >
                      Save
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h3 className="font-semibold text-slate-900">Additional services</h3>
        <p className="mt-1 text-sm text-slate-600">
          Seeded inactive at zero. Set a price, then activate - an active service priced at 0 would
          quietly give it away.
        </p>

        <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Service</th>
                <th className="px-4 py-3">Charged</th>
                <th className="px-4 py-3">Price (AED)</th>
                <th className="px-4 py-3">Max qty</th>
                <th className="px-4 py-3">Active</th>
              </tr>
            </thead>
            <tbody>
              {serviceData?.services.map((service) => (
                <tr key={service.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-3 font-medium text-slate-900">{service.name}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {service.chargeType === 'PER_DAY' ? 'Per day' : 'Per booking'}
                  </td>
                  <td className="px-4 py-3">
                    <input
                      defaultValue={service.price}
                      inputMode="decimal"
                      onBlur={(e) => {
                        if (e.target.value === service.price) return;
                        setError(null);
                        updateService.mutate(
                          { id: service.id, changes: { price: e.target.value } },
                          { onError: (err) => setError(err.message) },
                        );
                      }}
                      className="w-24 rounded-md border border-slate-300 px-2 py-1 text-sm"
                    />
                  </td>
                  <td className="px-4 py-3 text-slate-600">{service.maxQuantity}</td>
                  <td className="px-4 py-3">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={service.isActive}
                        onChange={(e) => {
                          setError(null);
                          updateService.mutate(
                            { id: service.id, changes: { isActive: e.target.checked } },
                            { onError: (err) => setError(err.message) },
                          );
                        }}
                        className="rounded border-slate-300"
                      />
                      <span className="text-xs text-slate-600">
                        {service.isActive ? 'Live' : 'Hidden'}
                      </span>
                    </label>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h3 className="font-semibold text-slate-900">Pricing rules</h3>
        <p className="mt-1 text-sm text-slate-600">
          Weekend surcharges, seasonal rates and long-term discounts. None are seeded - the UAE
          weekend itself varies by emirate, so these are yours to define.
        </p>

        <div className="mt-3">
          <PricingRuleForm onError={setError} />
        </div>

        <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Rule</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Applies</th>
                <th className="px-4 py-3">Adjustment</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {ruleData?.rules.map((rule) => (
                <tr key={rule.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-3 font-medium text-slate-900">{rule.name}</td>
                  <td className="px-4 py-3 text-slate-600">{RULE_LABEL[rule.type]}</td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {rule.type === 'WEEKEND' &&
                      rule.weekdays.map((d) => WEEKDAY_SHORT[d]).join(', ')}
                    {rule.type === 'SEASONAL' &&
                      rule.startDate &&
                      `${rule.startDate.slice(0, 10)} to ${rule.endDate?.slice(0, 10)}`}
                    {rule.type === 'LONG_TERM_DISCOUNT' && `${rule.minDays}+ days`}
                    <span className="block text-slate-400">
                      {rule.vehicle
                        ? `${rule.vehicle.brand} ${rule.vehicle.model}`
                        : rule.category
                          ? rule.category.name
                          : 'Whole fleet'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        rule.adjustmentPercentage.startsWith('-')
                          ? 'font-medium text-emerald-700'
                          : 'font-medium text-amber-700'
                      }
                    >
                      {rule.adjustmentPercentage}%
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => deleteRule.mutate(rule.id)}
                      className="rounded-md border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
              {ruleData?.rules.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-500">
                    No pricing rules yet. Rentals are priced from the vehicle's own rates.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
