/**
 * pages/DepositsPage.tsx
 * ---------------------------------------------------------------------------
 * Whose money are we holding, and how much of it.
 *
 * ===========================================================================
 * WHY THIS IS A LIST AND NOT A LEDGER
 * ===========================================================================
 * A deposit is the only money in this system that belongs to somebody else,
 * and the question an owner asks about it is a total: how much of what is in
 * the account tonight is not ours. That was unanswerable without opening every
 * booking, which is why the sidebar entry used to read "Deposits - see a
 * booking".
 *
 * Deliberately read-only. Deducting from a deposit is a decision about one
 * rental - what was damaged, what was agreed at the counter - and it belongs
 * on that booking, next to the return inspection and the photographs. A bulk
 * screen that lets somebody take AED 400 from a row in a table is a screen
 * that will eventually be used that way.
 */
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, PiggyBank } from 'lucide-react';
import { useDeposits, type DepositRow } from '../features/finance/useFinance';
import { formatMoney } from '../utils/format';

const STATUS_STYLE: Record<DepositRow['status'], string> = {
  HELD: 'badge-caution',
  PARTIALLY_RELEASED: 'badge-caution',
  RELEASED: 'badge-positive',
  PENDING: 'badge-neutral',
  FORFEITED: 'badge-critical',
};

const STATUS_LABEL: Record<DepositRow['status'], string> = {
  HELD: 'holding',
  PARTIALLY_RELEASED: 'part released',
  RELEASED: 'returned',
  PENDING: 'not collected',
  FORFEITED: 'forfeited',
};

export default function DepositsPage() {
  const [params, setParams] = useSearchParams();
  const page = Number(params.get('page') ?? '1');
  const status = params.get('status') ?? '';

  const { data, isPending, isError, error } = useDeposits({
    page,
    limit: 25,
    status: status || undefined,
  });

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next);
  }

  const rows = data?.items ?? [];

  /*
   * The total on THIS page, and it says so.
   *
   * Summing the visible rows and calling it "total held" would be a number
   * that changes when you turn the page - which is worse than no number,
   * because somebody will write it down.
   */
  const onThisPage = rows
    .filter((deposit) => deposit.status === 'HELD' || deposit.status === 'PARTIALLY_RELEASED')
    .reduce((sum, deposit) => sum + Number(deposit.balance), 0);

  const currency = rows[0]?.currency ?? 'AED';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[17px] font-semibold tracking-tight text-ink-950">Deposits</h2>
          <p className="mt-0.5 text-[13px] text-ink-500">
            Customers&apos; money, held against damage. Deduct or release from the booking itself.
          </p>
        </div>

        {rows.length > 0 && (
          <div className="flex items-center gap-2.5 rounded-lg border border-ink-100 bg-white px-3 py-2">
            <PiggyBank aria-hidden className="h-4 w-4 text-ink-400" />
            <span className="text-[13px] text-ink-600">
              Still holding on this page:{' '}
              <strong className="tabular font-semibold text-ink-950">
                {currency} {formatMoney(onThisPage)}
              </strong>
            </span>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={status}
          onChange={(event) => setParam('status', event.target.value)}
          className="input w-auto"
          aria-label="Filter by status"
        >
          <option value="">Any status</option>
          <option value="HELD">Still holding</option>
          <option value="PARTIALLY_RELEASED">Part released</option>
          <option value="RELEASED">Returned</option>
          <option value="PENDING">Not collected</option>
          <option value="FORFEITED">Forfeited</option>
        </select>
      </div>

      {isError && (
        <p role="alert" className="rounded-lg bg-critical-50 px-3 py-2 text-[13px] text-critical-700">
          {error.message}
        </p>
      )}

      <div className="card card-raised overflow-hidden">
        {isPending && <p className="px-5 py-10 text-center text-[13px] text-ink-500">Loading…</p>}

        {!isPending && rows.length === 0 && (
          <p className="px-5 py-10 text-center text-[13px] text-ink-500">
            {status ? 'No deposits match that filter.' : 'No deposits have been taken yet.'}
          </p>
        )}

        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-ink-100 text-sm">
              <thead className="table-head text-left">
                <tr>
                  <th className="px-4 py-2.5">Booking</th>
                  <th className="px-4 py-2.5">Customer</th>
                  <th className="px-4 py-2.5 text-right">Taken</th>
                  <th className="px-4 py-2.5 text-right">Deducted</th>
                  <th className="px-4 py-2.5 text-right">Returned</th>
                  <th className="px-4 py-2.5 text-right">Still holding</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {rows.map((deposit) => (
                  <tr key={deposit.id} className="table-row">
                    <td className="whitespace-nowrap px-4 py-2.5 font-medium text-ink-950">
                      {deposit.bookingNumber}
                    </td>
                    <td className="px-4 py-2.5 text-ink-700">{deposit.customerName}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right text-ink-600">
                      {formatMoney(deposit.held)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right text-ink-600">
                      {Number(deposit.deducted) > 0 ? (
                        <span className="text-critical-700">−{formatMoney(deposit.deducted)}</span>
                      ) : (
                        <span className="text-ink-300">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right text-ink-600">
                      {Number(deposit.released) > 0 ? formatMoney(deposit.released) : (
                        <span className="text-ink-300">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right font-semibold text-ink-950">
                      {formatMoney(deposit.balance)}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`badge ${STATUS_STYLE[deposit.status]}`}>
                        {STATUS_LABEL[deposit.status]}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Link
                        to={`/bookings/${deposit.bookingId}`}
                        className="inline-flex items-center gap-1 text-[12px] font-medium text-ink-600 hover:text-ink-950"
                      >
                        Open
                        <ArrowRight aria-hidden className="h-3 w-3" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {data && data.pagination.totalPages > 1 && (
        <div className="flex items-center justify-between text-[13px] text-ink-600">
          <span>
            Page {data.pagination.page} of {data.pagination.totalPages}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setParam('page', String(page - 1))}
              className="btn btn-outline btn-sm"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={page >= data.pagination.totalPages}
              onClick={() => setParam('page', String(page + 1))}
              className="btn btn-outline btn-sm"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
