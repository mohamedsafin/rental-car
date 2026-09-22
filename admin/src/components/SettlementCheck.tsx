/**
 * components/SettlementCheck.tsx
 * ---------------------------------------------------------------------------
 * The last look before the deposit goes back.
 *
 * ===========================================================================
 * THE MOMENT THIS EXISTS FOR
 * ===========================================================================
 * A short-rental customer is standing at the counter with their keys. Salik
 * for the days they just drove will not be published until the month ends. If
 * the deposit is released now, those crossings become the company's, because
 * nobody chases AED 24 across a border.
 *
 * So this sits directly above the deposit controls and answers three things in
 * the order a staff member needs them:
 *
 *   1. What is already recorded and still owed - press one button, it comes
 *      out of the deposit.
 *   2. What was imported but could not be matched to anyone - attachable.
 *   3. How much of the rental no statement has reached yet, and what that
 *      might cost, based on how this customer has actually been driving.
 *
 * Point 3 is advice, never an action. The suggestion is an estimate and is
 * labelled as one; holding part of a deposit on an estimate is a decision for
 * a person, and the reasoning is spelled out so that person can disagree with
 * it.
 *
 * It renders nothing when there is nothing to say. A panel that appears on
 * every booking to announce "all clear" is a panel staff learn to scroll past.
 */
import { ShieldAlert } from 'lucide-react';
import { useSettlementCheck } from '../features/fleetOps/useFleetOps';
import { useRecoverCharge } from '../features/fleetOps/useFleetOps';
import { useState } from 'react';

const time = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

const date = (iso: string): string =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

export default function SettlementCheck({ bookingId }: { bookingId: string }) {
  const { data: check } = useSettlementCheck(bookingId);
  const recoverFine = useRecoverCharge('fines');
  const recoverToll = useRecoverCharge('tolls');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!check) return null;

  const hasOutstanding = check.outstanding.length > 0;
  const hasUnattached = check.unattached.length > 0;
  const hasGap = !check.closed && check.uncoveredDays > 0 && check.suggestionBasis !== null;

  // Nothing owed, nothing loose, nothing missing: say nothing.
  if (!hasOutstanding && !hasUnattached && !hasGap) return null;

  function recover(kind: 'fine' | 'toll', id: string) {
    setMessage(null);
    setError(null);
    const mutation = kind === 'fine' ? recoverFine : recoverToll;
    mutation.mutate(id, {
      onSuccess: (result) => {
        setMessage(
          result.billedWithInstalment !== null
            ? `Added to month ${result.billedWithInstalment} of this rental. The deposit was not touched.`
            : Number(result.recoveredFromDeposit) > 0
              ? `${check!.currency} ${result.recoveredFromDeposit} taken from the deposit.${
                  Number(result.leftToInvoice) > 0
                    ? ` ${check!.currency} ${result.leftToInvoice} is beyond it and stays to invoice.`
                    : ''
                }`
              : `Nothing could come from the deposit, so the full ${check!.currency} ${result.amount} stays as a charge to invoice.`,
        );
      },
      onError: (err) => setError(err.message),
    });
  }

  const busy = recoverFine.isPending || recoverToll.isPending;

  return (
    <section className="rounded-lg border border-amber-200 bg-amber-50 p-5">
      <div className="flex items-center gap-2">
        <ShieldAlert aria-hidden className="h-4 w-4 text-amber-600" />
        <h3 className="font-semibold text-amber-900">
          {check.closed ? 'Left unsettled on this rental' : 'Before you release the deposit'}
        </h3>
      </div>

      {/*
        * Completing a booking closes it for good, so these can no longer be
        * recovered from the customer. They are still shown - what was missed
        * is worth seeing - but with no buttons that would only fail.
        */}
      {check.closed && (
        <p className="mt-2 text-sm text-amber-900">
          This rental is completed, so nothing further can be charged to it. Anything below stayed
          with the company. Settle charges at the return step, before completing a booking.
        </p>
      )}

      {message && (
        <p className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</p>
      )}
      {error && (
        <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}

      {hasOutstanding && (
        <div className="mt-4">
          <p className="text-sm font-medium text-amber-900">
            {check.outstanding.length} charge(s) recorded and not yet recovered - {check.currency}{' '}
            {check.outstandingTotal}
          </p>
          <ul className="mt-2 divide-y divide-amber-200 text-sm">
            {check.outstanding.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-amber-950">{item.what}</p>
                  <p className="text-xs text-amber-700">{time(item.at)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="tabular-nums font-medium text-amber-950">
                    {check.currency} {item.total}
                  </span>
                  {!check.closed && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => recover(item.kind, item.id)}
                      className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
                    >
                      {busy ? 'Working...' : 'Recover'}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {hasUnattached && (
        <div className="mt-4 rounded-md border border-amber-300 bg-white p-3">
          <p className="text-sm font-medium text-slate-900">
            {check.unattached.length} crossing(s) on this car during the rental are not attached to
            anyone - {check.currency} {check.unattachedTotal}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            An import recorded these but could not match them to a booking. Attach them to this
            rental on the Fines and tolls page if they belong to this customer.
          </p>
          <ul className="mt-2 space-y-1 text-xs text-slate-600">
            {check.unattached.slice(0, 5).map((item) => (
              <li key={item.id}>
                {time(item.at)} - {item.what} - {check.currency} {item.total}
              </li>
            ))}
          </ul>
        </div>
      )}

      {hasGap && (
        <div className="mt-4 rounded-md border border-amber-300 bg-white p-3">
          <p className="text-sm font-medium text-slate-900">
            Salik has not caught up with this rental yet
          </p>
          <p className="mt-1 text-sm text-slate-600">
            {check.tollsKnownUntil
              ? `Toll data for this car reaches ${date(check.tollsKnownUntil)}. `
              : 'No toll data has ever been recorded for this car. '}
            {check.suggestionBasis}
          </p>

          {check.suggestedHold ? (
            <p className="mt-2 text-sm text-slate-900">
              On that basis, roughly{' '}
              <strong>
                {check.currency} {check.suggestedHold}
              </strong>{' '}
              may still be coming.{' '}
              <span className="text-slate-500">
                This is an estimate, not a charge. Holding it back is your call - release the rest
                below, and settle the remainder when the statement arrives.
              </span>
            </p>
          ) : (
            <p className="mt-2 text-sm text-slate-500">
              There is nothing to estimate from, so no figure is suggested.
            </p>
          )}

          {check.depositBalance !== null && (
            <p className="mt-2 text-xs text-slate-500">
              Deposit balance right now: {check.currency} {check.depositBalance}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
