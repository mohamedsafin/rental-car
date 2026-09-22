/**
 * components/DepositPanel.tsx
 * ---------------------------------------------------------------------------
 * The deposit ledger, as the customer sees it (BRD 20).
 *
 * Showing customers the individual entries - not just a balance - is the whole
 * point of keeping a ledger. "AED 150 deducted for a scratch on the rear
 * bumper, recorded on 4 September" is answerable. "We kept AED 150" is a
 * dispute.
 */
import { DEPOSIT_STATUS_STYLE, DEDUCTION_LABELS, type DeductionCategory } from '../types/payment';
import { useDeposit } from '../features/payments/usePayments';

export default function DepositPanel({ bookingId }: { bookingId: string }) {
  const { data, isPending } = useDeposit(bookingId);

  if (isPending) return <div className="h-32 animate-pulse rounded-card bg-ink-100" aria-hidden />;
  if (!data?.deposit) return null;

  const deposit = data.deposit;
  const currency = deposit.currency;

  const entryLabel = (type: string, category: string | null): string => {
    if (type === 'HOLD') return 'Deposit received';
    if (type === 'RELEASE') return 'Returned to you';
    return DEDUCTION_LABELS[category as DeductionCategory] ?? 'Deduction';
  };

  return (
    <section aria-labelledby="deposit-title" className="surface p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="deposit-title" className="text-[15px] font-semibold text-ink-950">
          Security deposit
        </h2>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${DEPOSIT_STATUS_STYLE[deposit.status]}`}>
          {deposit.status.replace(/_/g, ' ').toLowerCase()}
        </span>
      </div>

      <dl className="mt-5 grid grid-cols-3 gap-4 rounded-2xl bg-ink-50 p-4 text-sm">
        <div>
          <dt className="text-xs text-ink-500">Held</dt>
          <dd className="tabular mt-1 text-base font-semibold text-ink-950">
            {currency} {deposit.held}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-ink-500">Deducted</dt>
          <dd className="tabular mt-1 text-base font-semibold text-ink-950">
            {currency} {deposit.deducted}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-ink-500">Remaining</dt>
          <dd className="tabular mt-1 text-base font-semibold text-emerald-700">
            {currency} {deposit.balance}
          </dd>
        </div>
      </dl>

      {deposit.transactions.length > 0 && (
        <>
          <h3 className="mt-6 text-[13px] font-semibold uppercase tracking-[0.12em] text-ink-500">
            Every movement
          </h3>
          <ul className="mt-2 divide-y divide-ink-100 text-sm">
            {deposit.transactions.map((entry) => (
              <li key={entry.id} className="flex items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="font-medium text-ink-950">{entryLabel(entry.type, entry.category)}</p>
                  {entry.reason && <p className="text-xs text-ink-500">{entry.reason}</p>}
                  <p className="text-xs text-ink-500">{new Date(entry.createdAt).toLocaleString()}</p>
                </div>
                <span
                  className={`tabular shrink-0 font-medium ${
                    entry.type === 'DEDUCTION'
                      ? 'text-red-700'
                      : entry.type === 'RELEASE'
                        ? 'text-emerald-700'
                        : 'text-ink-950'
                  }`}
                >
                  {entry.type === 'HOLD' ? '' : '- '}
                  {currency} {entry.amount}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {deposit.status === 'PENDING' && (
        <p className="mt-4 text-xs leading-relaxed text-ink-500">
          The deposit has not been collected yet. It is refundable and is returned after the vehicle is
          inspected, less any approved charges.
        </p>
      )}
    </section>
  );
}
