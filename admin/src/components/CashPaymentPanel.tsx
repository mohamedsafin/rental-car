/**
 * components/CashPaymentPanel.tsx
 * ---------------------------------------------------------------------------
 * Taking cash at the counter (BRD 19).
 *
 * Only appears on a pay-at-pickup booking, because recording cash against a
 * booking that was already paid online would double-count the rental - which
 * the API refuses anyway, but a button that exists only to be rejected is a
 * trap rather than a safeguard.
 *
 * The amount is NOT an editable field by default. It is what the booking says
 * is owed, shown plainly, because a till that accepts whatever figure the form
 * posts is not a till. Staff can override it - part payments happen - but that
 * is a deliberate second action, and the override is recorded in the audit log
 * with the name of whoever took the money.
 */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { postData } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import type { NormalisedApiError } from '../types/api';
import type { Booking } from '../types/booking';

interface CashPayment {
  id: string;
  type: string;
  amount: string;
  currency: string;
  status: string;
}

export default function CashPaymentPanel({ booking }: { booking: Booking }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canTakeCash = user?.role === 'ADMIN' || user?.role === 'STAFF';

  const [type, setType] = useState<'RENTAL' | 'SECURITY_DEPOSIT'>('RENTAL');
  const [reference, setReference] = useState('');
  const [override, setOverride] = useState('');
  const [showOverride, setShowOverride] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const owed = type === 'RENTAL' ? booking.pricing.totalAmount : booking.pricing.securityDeposit;

  const record = useMutation<CashPayment, NormalisedApiError, Record<string, unknown>>({
    mutationFn: (payload) => postData<CashPayment>(`/payments/booking/${booking.id}/cash`, payload),
    onSuccess: (payment) => {
      void queryClient.invalidateQueries({ queryKey: ['admin-booking'] });
      void queryClient.invalidateQueries({ queryKey: ['deposit'] });
      setDone(`${payment.currency} ${payment.amount} recorded`);
      setReference('');
      setOverride('');
      setShowOverride(false);
    },
    onError: (err) => setError(err.message),
  });

  /*
   * Only for bookings taken as pay-at-pickup.
   *
   * Below every hook, deliberately. This used to sit above `useMutation`, so
   * a booking whose payment method changed between renders changed the NUMBER
   * of hooks React saw - which is the one thing hooks cannot survive, and it
   * fails as a corrupted component rather than as an error pointing here.
   */
  if (booking.paymentMethod !== 'CASH_ON_PICKUP') return null;


  return (
    <section className="rounded-lg border border-amber-300 bg-amber-50 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-amber-900">Pay at pickup</h2>
          <p className="mt-1 text-sm text-amber-800">
            This booking was reserved without an online payment. The vehicle cannot be handed over
            until the cash is recorded here.
          </p>
        </div>
        <span className="rounded-full bg-amber-200 px-2.5 py-1 text-xs font-semibold text-amber-900">
          cash
        </span>
      </div>

      {error && (
        <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}
      {done && (
        <p className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{done}</p>
      )}

      {canTakeCash && (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-amber-900">Taking payment for</span>
              <select
                value={type}
                onChange={(event) => {
                  setType(event.target.value as 'RENTAL' | 'SECURITY_DEPOSIT');
                  setDone(null);
                }}
                className="rounded-md border border-amber-300 bg-white px-3 py-1.5 text-sm"
              >
                <option value="RENTAL">Rental</option>
                <option value="SECURITY_DEPOSIT">Security deposit</option>
              </select>
            </label>

            <div>
              <p className="text-xs font-medium text-amber-900">Amount due</p>
              <p className="text-xl font-bold text-amber-900">
                {booking.pricing.currency} {owed}
              </p>
            </div>

            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-amber-900">Receipt number</span>
              <input
                value={reference}
                onChange={(event) => setReference(event.target.value)}
                placeholder="Optional"
                className="w-40 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-sm"
              />
            </label>
          </div>

          {showOverride && (
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-amber-900">
                Amount actually taken (part payment)
              </span>
              <input
                value={override}
                inputMode="decimal"
                onChange={(event) => setOverride(event.target.value)}
                placeholder={owed}
                className="w-40 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-sm"
              />
            </label>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={record.isPending}
              onClick={() => {
                setError(null);
                setDone(null);
                record.mutate({
                  type,
                  reference: reference || undefined,
                  ...(showOverride && override ? { amount: override } : {}),
                });
              }}
              className="rounded-md bg-amber-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {record.isPending
                ? 'Recording...'
                : `Record ${booking.pricing.currency} ${showOverride && override ? override : owed} received`}
            </button>

            <button
              type="button"
              onClick={() => setShowOverride((open) => !open)}
              className="text-xs text-amber-900 underline"
            >
              {showOverride ? 'Use the full amount' : 'Took a different amount'}
            </button>
          </div>

          <p className="text-xs text-amber-800">
            Recorded immediately as received, with your name against it. There is no gateway behind
            a cash payment, so this entry and the audit log are the only record of it.
          </p>
        </div>
      )}
    </section>
  );
}
