/**
 * pages/CouponsPage.tsx
 * ---------------------------------------------------------------------------
 * Promo codes (BRD 19).
 *
 * Note what this page cannot do: change a live code's discount type or value.
 * Codes already redeemed were redeemed at a particular value, and editing it
 * would make those bookings' paperwork disagree with what the customer was
 * charged. The only levers here are availability - switch it off, shorten its
 * life, cap its usage - and creating a replacement.
 */
import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useCoupons, useCreateCoupon, useUpdateCoupon } from '../features/output/useOutput';
import FormField from '../components/FormField';

const EMPTY = {
  code: '',
  description: '',
  discountType: 'PERCENTAGE',
  value: '',
  maxDiscount: '',
  minRentalAmount: '',
  minRentalDays: '',
  validFrom: '',
  validUntil: '',
  usageLimit: '',
  perCustomerLimit: '',
};

function statusOf(coupon: { isActive: boolean; validUntil: string; usageLimit: number | null; timesUsed: number }) {
  if (!coupon.isActive) return { label: 'withdrawn', style: 'bg-slate-100 text-slate-600' };
  if (new Date(coupon.validUntil) < new Date())
    return { label: 'expired', style: 'bg-amber-100 text-amber-800' };
  if (coupon.usageLimit !== null && coupon.timesUsed >= coupon.usageLimit)
    return { label: 'fully used', style: 'bg-amber-100 text-amber-800' };
  return { label: 'live', style: 'bg-emerald-100 text-emerald-800' };
}

export default function CouponsPage() {
  const [params, setParams] = useSearchParams();
  const page = Number(params.get('page') ?? '1');
  const activeOnly = params.get('activeOnly') === 'true';

  const { data, isPending } = useCoupons({ page, limit: 20, activeOnly: activeOnly || undefined });
  const create = useCreateCoupon();
  const update = useUpdateCoupon();

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    create.mutate(
      {
        code: form.code,
        description: form.description || undefined,
        discountType: form.discountType,
        value: form.value,
        maxDiscount: form.maxDiscount || undefined,
        minRentalAmount: form.minRentalAmount || undefined,
        minRentalDays: form.minRentalDays ? Number(form.minRentalDays) : undefined,
        validFrom: form.validFrom,
        validUntil: form.validUntil,
        usageLimit: form.usageLimit ? Number(form.usageLimit) : undefined,
        perCustomerLimit: form.perCustomerLimit ? Number(form.perCustomerLimit) : undefined,
      },
      {
        onSuccess: () => {
          setShowForm(false);
          setForm(EMPTY);
        },
        onError: (err) => setError(err.message),
      },
    );
  }

  const items = data?.items ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Promo codes</h2>
          <p className="text-sm text-slate-500">
            The engine decides what a code is worth. A browser can present one; it can never send an
            amount.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((open) => !open)}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          {showForm ? 'Cancel' : 'New code'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={submit} className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
          {error && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
              {error}
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-3">
            <FormField
              label="Code"
              name="code"
              required
              value={form.code}
              onChange={(event) => setForm({ ...form, code: event.target.value })}
              hint="Stored uppercase, so SUMMER25 and summer25 are one code."
            />
            <FormField
              label="Description"
              name="description"
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
              hint="Shown to the customer on the price breakdown."
            />

            <div>
              <label htmlFor="discountType" className="block text-sm font-medium text-slate-700">
                Type
              </label>
              <select
                id="discountType"
                value={form.discountType}
                onChange={(event) => setForm({ ...form, discountType: event.target.value })}
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="PERCENTAGE">Percentage off</option>
                <option value="FIXED_AMOUNT">Fixed amount off</option>
              </select>
            </div>

            <FormField
              label={form.discountType === 'PERCENTAGE' ? 'Percentage' : 'Amount (AED)'}
              name="value"
              inputMode="decimal"
              required
              value={form.value}
              onChange={(event) => setForm({ ...form, value: event.target.value })}
            />
            <FormField
              label="Cap the discount at (AED)"
              name="maxDiscount"
              inputMode="decimal"
              value={form.maxDiscount}
              onChange={(event) => setForm({ ...form, maxDiscount: event.target.value })}
              hint="Without this, 20% off a Porsche is an expensive surprise."
            />
            <FormField
              label="Minimum booking (AED)"
              name="minRentalAmount"
              inputMode="decimal"
              value={form.minRentalAmount}
              onChange={(event) => setForm({ ...form, minRentalAmount: event.target.value })}
            />
            <FormField
              label="Minimum days"
              name="minRentalDays"
              inputMode="numeric"
              value={form.minRentalDays}
              onChange={(event) => setForm({ ...form, minRentalDays: event.target.value })}
            />
            <FormField
              label="Valid from"
              name="validFrom"
              type="date"
              required
              value={form.validFrom}
              onChange={(event) => setForm({ ...form, validFrom: event.target.value })}
            />
            <FormField
              label="Valid until"
              name="validUntil"
              type="date"
              required
              value={form.validUntil}
              onChange={(event) => setForm({ ...form, validUntil: event.target.value })}
            />
            <FormField
              label="Total uses"
              name="usageLimit"
              inputMode="numeric"
              value={form.usageLimit}
              onChange={(event) => setForm({ ...form, usageLimit: event.target.value })}
              hint="Blank = unlimited."
            />
            <FormField
              label="Uses per customer"
              name="perCustomerLimit"
              inputMode="numeric"
              value={form.perCustomerLimit}
              onChange={(event) => setForm({ ...form, perCustomerLimit: event.target.value })}
            />
          </div>

          <p className="text-xs text-slate-500">
            The discount type and value cannot be changed later - bookings that already used the code
            were charged at this value. To change the offer, withdraw this code and issue a new one.
          </p>

          <button
            type="submit"
            disabled={create.isPending}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {create.isPending ? 'Creating...' : 'Create code'}
          </button>
        </form>
      )}

      <label className="flex items-center gap-2 text-sm text-slate-600">
        <input
          type="checkbox"
          checked={activeOnly}
          onChange={(event) => setParam('activeOnly', event.target.checked ? 'true' : '')}
        />
        Live codes only
      </label>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        {isPending && <p className="px-5 py-8 text-sm text-slate-500">Loading...</p>}

        {!isPending && items.length === 0 && (
          <p className="px-5 py-8 text-sm text-slate-500">No promo codes yet.</p>
        )}

        {items.length > 0 && (
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Discount</th>
                <th className="px-4 py-3">Conditions</th>
                <th className="px-4 py-3">Used</th>
                <th className="px-4 py-3">Valid until</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((coupon) => {
                const status = statusOf(coupon);
                return (
                  <tr key={coupon.id}>
                    <td className="px-4 py-3">
                      <p className="font-mono font-medium text-slate-900">{coupon.code}</p>
                      {coupon.description && (
                        <p className="text-xs text-slate-500">{coupon.description}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-900">
                      {coupon.discountType === 'PERCENTAGE'
                        ? `${Number(coupon.value)}%`
                        : `AED ${coupon.value}`}
                      {coupon.maxDiscount && (
                        <span className="block text-xs text-slate-500">
                          max AED {coupon.maxDiscount}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {[
                        coupon.minRentalDays ? `${coupon.minRentalDays}+ days` : null,
                        coupon.minRentalAmount ? `AED ${coupon.minRentalAmount}+` : null,
                        coupon.perCustomerLimit ? `${coupon.perCustomerLimit}/customer` : null,
                        coupon.scope,
                      ]
                        .filter(Boolean)
                        .join(' · ') || 'None'}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {coupon.timesUsed}
                      {coupon.usageLimit !== null ? ` / ${coupon.usageLimit}` : ''}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {coupon.validUntil.slice(0, 10)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${status.style}`}
                      >
                        {status.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() =>
                          update.mutate({ id: coupon.id, isActive: !coupon.isActive })
                        }
                        className="rounded-md border border-slate-300 px-3 py-1 text-xs text-slate-700"
                      >
                        {coupon.isActive ? 'Withdraw' : 'Reinstate'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {data && data.pagination.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-slate-600">
          <span>
            Page {data.pagination.page} of {data.pagination.totalPages}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setParam('page', String(page - 1))}
              className="rounded-md border border-slate-300 px-3 py-1.5 disabled:opacity-50"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={page >= data.pagination.totalPages}
              onClick={() => setParam('page', String(page + 1))}
              className="rounded-md border border-slate-300 px-3 py-1.5 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
