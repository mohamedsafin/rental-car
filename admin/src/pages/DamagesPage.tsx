/**
 * pages/DamagesPage.tsx
 * ---------------------------------------------------------------------------
 * The damage queue (BRD 30, 38).
 *
 * Three deliberate steps, in three separate clicks: report -> assess ->
 * charge. Collapsing them would let a scratch noticed at 6pm become money off
 * a customer's deposit before anyone senior has looked at it.
 *
 * The estimate and the approved amount are shown side by side on purpose. The
 * estimate is what the inspector first thought; the approved amount is what
 * the customer is actually asked to pay, and only the second one ever reaches
 * a charge.
 */
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  useAssessDamage,
  useChargeDamage,
  useDamages,
} from '../features/fleetOps/useFleetOps';
import { useAuth } from '../hooks/useAuth';
import type { Damage } from '../types/fleetOps';

const STATUSES = ['REPORTED', 'ASSESSED', 'APPROVED', 'DISMISSED', 'CHARGED'];

const STATUS_STYLE: Record<string, string> = {
  REPORTED: 'bg-slate-100 text-slate-700',
  ASSESSED: 'bg-amber-100 text-amber-800',
  APPROVED: 'bg-blue-100 text-blue-800',
  DISMISSED: 'bg-slate-100 text-slate-500',
  CHARGED: 'bg-emerald-100 text-emerald-800',
};

export default function DamagesPage() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const page = Number(params.get('page') ?? '1');

  const { user } = useAuth();
  // Assessment is admin-only on the backend. Hiding the controls from staff is
  // a courtesy so nobody clicks a button that will 403 - it is NOT the check.
  const canAssess = user?.role === 'ADMIN';

  const { data, isPending } = useDamages({ page, limit: 20, status: status || undefined });
  const assess = useAssessDamage();
  const charge = useChargeDamage();

  const [openId, setOpenId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next);
  }

  function openAssessor(damage: Damage) {
    setOpenId(damage.id);
    // Pre-filled with the estimate as a starting point, not as the answer.
    // Negotiating a bodyshop quote down is normal.
    setAmount(damage.approvedAmount ?? damage.estimatedAmount ?? '');
    setNotes(damage.assessmentNotes ?? '');
    setError(null);
  }

  function decide(approve: boolean) {
    if (!openId) return;
    setError(null);

    assess.mutate(
      { id: openId, approve, approvedAmount: approve ? amount : undefined, notes: notes || undefined },
      {
        onSuccess: () => setOpenId(null),
        onError: (err) => setError(err.message),
      },
    );
  }

  const items = data?.items ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Damages</h2>
        <p className="text-sm text-slate-500">
          Report at inspection, approve an amount, then charge it to the rental.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setParam('status', '')}
          className={
            status === ''
              ? 'rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white'
              : 'rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700'
          }
        >
          All
        </button>
        {STATUSES.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setParam('status', value)}
            className={
              status === value
                ? 'rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white'
                : 'rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700'
            }
          >
            {value.toLowerCase()}
          </button>
        ))}
      </div>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        {isPending && <p className="px-5 py-8 text-sm text-slate-500">Loading...</p>}

        {!isPending && items.length === 0 && (
          <p className="px-5 py-8 text-sm text-slate-500">
            No damage recorded. Damage is normally reported from a return inspection.
          </p>
        )}

        <ul className="divide-y divide-slate-100">
          {items.map((damage) => (
            <li key={damage.id} className="px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-900">{damage.description}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        STATUS_STYLE[damage.status] ?? 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {damage.status.toLowerCase()}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {damage.vehicle ?? damage.vehicleId}
                    {damage.location ? ` - ${damage.location}` : ''}
                    {damage.bookingNumber ? ` - booking ${damage.bookingNumber}` : ' - no booking attached'}
                  </p>
                </div>

                <div className="text-right text-sm">
                  <p className="text-slate-500">
                    Estimate: {damage.estimatedAmount ? `${damage.currency} ${damage.estimatedAmount}` : '-'}
                  </p>
                  <p className="font-medium text-slate-900">
                    Approved: {damage.approvedAmount ? `${damage.currency} ${damage.approvedAmount}` : '-'}
                  </p>
                </div>
              </div>

              {damage.photos.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {damage.photos.map((photo) => (
                    <img
                      key={photo.id}
                      src={photo.url}
                      alt={photo.caption ?? 'Damage photo'}
                      className="h-20 w-28 rounded-md border border-slate-200 object-cover"
                    />
                  ))}
                </div>
              )}

              {damage.assessmentNotes && (
                <p className="mt-2 text-xs text-slate-500">Note: {damage.assessmentNotes}</p>
              )}

              {canAssess && damage.status !== 'CHARGED' && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {openId === damage.id ? (
                    <>
                      <input
                        aria-label="Approved amount"
                        inputMode="decimal"
                        value={amount}
                        onChange={(event) => setAmount(event.target.value)}
                        placeholder="Amount"
                        className="w-32 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                      />
                      <input
                        aria-label="Assessment notes"
                        value={notes}
                        onChange={(event) => setNotes(event.target.value)}
                        placeholder="Reason / notes"
                        className="w-64 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                      />
                      <button
                        type="button"
                        disabled={assess.isPending}
                        onClick={() => decide(true)}
                        className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        disabled={assess.isPending}
                        onClick={() => decide(false)}
                        className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-700"
                      >
                        Dismiss as wear and tear
                      </button>
                      <button
                        type="button"
                        onClick={() => setOpenId(null)}
                        className="text-xs text-slate-500 underline"
                      >
                        Close
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => openAssessor(damage)}
                      className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-700"
                    >
                      Assess
                    </button>
                  )}

                  {damage.status === 'APPROVED' && (
                    <button
                      type="button"
                      disabled={charge.isPending}
                      onClick={() =>
                        charge.mutate(damage.id, { onError: (err) => setError(err.message) })
                      }
                      className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
                    >
                      Charge {damage.currency} {damage.approvedAmount} to the rental
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
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
