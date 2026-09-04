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

  if (isPending) return <div className="h-32 animate-pulse rounded-lg bg-ink-200" />;
  if (!data?.deposit) return null;

  const deposit = data.deposit;
  const currency = deposit.currency;

  const entryLabel = (type: string, category: string | null): string => {
    if (type === 'HOLD') return 'Deposit received';
    if (type === 'RELEASE') return 'Returned to you';
    return DEDUCTION_LABELS[category as DeductionCategory] ?? 'Deduction';
  };

  return (
    <section className="rounded-lg border border-ink-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-ink-900">Security deposit</h2>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${DEPOSIT_STATUS_STYLE[deposit.status]}`}
        >
          {deposit.status.replace(/_/g, ' ').toLowerCase()}
        </span>
      </div>

      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-ink-500">Held</dt>
          <dd className="text-base font-semibold text-ink-900">
            {currency} {deposit.held}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-ink-500">Deducted</dt>
          <dd className="text-base font-semibold text-ink-900">
            {currency} {deposit.deducted}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-ink-500">Remaining</dt>
          <dd className="text-base font-semibold text-emerald-700">
            {currency} {deposit.balance}
          </dd>
        </div>
      </dl>

      {deposit.transactions.length > 0 && (
        <>
          <h3 className="mt-5 text-sm font-medium text-ink-700">Every movement</h3>
          <ul className="mt-2 divide-y divide-ink-100 text-sm">
            {deposit.transactions.map((entry) => (
              <li key={entry.id} className="flex items-start justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="font-medium text-ink-800">
                    {entryLabel(entry.type, entry.category)}
                  </p>
                  {entry.reason && <p className="text-xs text-ink-500">{entry.reason}</p>}
                  <p className="text-xs text-ink-400">
                    {new Date(entry.createdAt).toLocaleString()}
                  </p>
                </div>
                <span
                  className={
                    entry.type === 'DEDUCTION'
                      ? 'shrink-0 font-medium text-red-700'
                      : entry.type === 'RELEASE'
                        ? 'shrink-0 font-medium text-emerald-700'
                        : 'shrink-0 font-medium text-ink-900'
                  }
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
        <p className="mt-4 text-xs text-ink-500">
          The deposit has not been collected yet. It is refundable and is returned after the vehicle
          is inspected, less any approved charges.
        </p>
      )}
    </section>
  );
}
