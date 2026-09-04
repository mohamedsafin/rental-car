/**
 * components/DepositManager.tsx
 * ---------------------------------------------------------------------------
 * Staff controls for a booking's deposit (BRD 20).
 *
 * Every deduction needs an amount, a CATEGORY and a REASON. The reason is not
 * optional here or on the server: the customer sees it, and a deduction they
 * cannot understand becomes a chargeback.
 */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { postData } from '../services/api';
import { useDeposit } from '../features/payments/usePayments';
import {
  DEDUCTION_LABELS,
  DEPOSIT_STATUS_STYLE,
  type DeductionCategory,
  type DepositSummary,
} from '../types/payment';
import type { NormalisedApiError } from '../types/api';

const CATEGORIES = Object.keys(DEDUCTION_LABELS) as DeductionCategory[];

export default function DepositManager({ bookingId }: { bookingId: string }) {
  const queryClient = useQueryClient();
  const { data, isPending } = useDeposit(bookingId);

  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<DeductionCategory>('DAMAGE');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showDeduct, setShowDeduct] = useState(false);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['deposit', bookingId] });
  };

  const deduct = useMutation<{ deposit: DepositSummary }, NormalisedApiError, void>({
    mutationFn: () =>
      postData<{ deposit: DepositSummary }>(`/deposits/booking/${bookingId}/deduct`, {
        amount,
        category,
        reason,
      }),
    onSuccess: () => {
      invalidate();
      setShowDeduct(false);
      setAmount('');
      setReason('');
    },
    onError: (err) => setError(err.message),
  });

  const release = useMutation<{ deposit: DepositSummary }, NormalisedApiError, void>({
    mutationFn: () =>
      postData<{ deposit: DepositSummary }>(`/deposits/booking/${bookingId}/release`, {}),
    onSuccess: invalidate,
    onError: (err) => setError(err.message),
  });

  if (isPending) return <div className="h-40 animate-pulse rounded-lg bg-slate-200" />;

  if (!data?.deposit) {
    return (
      <section className="rounded-lg border border-dashed border-slate-300 bg-white p-5">
        <h3 className="font-semibold text-slate-900">Security deposit</h3>
        <p className="mt-1 text-sm text-slate-500">
          No deposit record yet. One opens when the rental is paid.
        </p>
      </section>
    );
  }

  const deposit = data.deposit;
  const currency = deposit.currency;
  const canAct = deposit.status === 'HELD' || deposit.status === 'PARTIALLY_RELEASED';

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-slate-900">Security deposit</h3>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${DEPOSIT_STATUS_STYLE[deposit.status]}`}
        >
          {deposit.status.replace(/_/g, ' ').toLowerCase()}
        </span>
      </div>

      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-slate-500">Agreed</dt>
          <dd className="font-semibold text-slate-900">
            {currency} {deposit.amount}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Held</dt>
          <dd className="font-semibold text-slate-900">
            {currency} {deposit.held}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Deducted</dt>
          <dd className="font-semibold text-red-700">
            {currency} {deposit.deducted}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Balance</dt>
          <dd className="font-semibold text-emerald-700">
            {currency} {deposit.balance}
          </dd>
        </div>
      </dl>

      {error && (
        <p role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {canAct && (
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setError(null);
              setShowDeduct((s) => !s);
            }}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            {showDeduct ? 'Cancel' : 'Record a deduction'}
          </button>
          <button
            type="button"
            disabled={release.isPending || deposit.balance === '0.00'}
            onClick={() => {
              setError(null);
              release.mutate();
            }}
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            Release {currency} {deposit.balance}
          </button>
        </div>
      )}

      {showDeduct && (
        <div className="mt-4 grid gap-3 rounded-md border border-slate-200 p-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Amount ({currency})</span>
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="150.00"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Category</span>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as DeductionCategory)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              {CATEGORIES.map((key) => (
                <option key={key} value={key}>
                  {DEDUCTION_LABELS[key]}
                </option>
              ))}
            </select>
          </label>
          <label className="block sm:col-span-2">
            <span className="text-sm font-medium text-slate-700">
              Reason (the customer sees this)
            </span>
            <textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Scratch on the rear bumper, photographed at return"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <div className="sm:col-span-2">
            <button
              type="button"
              disabled={deduct.isPending || !amount || reason.trim().length < 3}
              onClick={() => {
                setError(null);
                deduct.mutate();
              }}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              Record deduction
            </button>
          </div>
        </div>
      )}

      {deposit.transactions.length > 0 && (
        <>
          <h4 className="mt-5 text-sm font-medium text-slate-700">Ledger</h4>
          <ul className="mt-2 divide-y divide-slate-100 text-sm">
            {deposit.transactions.map((entry) => (
              <li key={entry.id} className="flex items-start justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="font-medium text-slate-800">
                    {entry.type}
                    {entry.category
                      ? ` - ${DEDUCTION_LABELS[entry.category as DeductionCategory]}`
                      : ''}
                  </p>
                  {entry.reason && <p className="text-xs text-slate-500">{entry.reason}</p>}
                  <p className="text-xs text-slate-400">
                    {new Date(entry.createdAt).toLocaleString()}
                  </p>
                </div>
                <span className="shrink-0 font-medium text-slate-900">
                  {currency} {entry.amount}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
