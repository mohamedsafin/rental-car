/**
 * pages/PaymentsPage.tsx
 * ---------------------------------------------------------------------------
 * Every payment, across every booking.
 *
 * ===========================================================================
 * WHAT THIS ANSWERS
 * ===========================================================================
 * Two questions that had no screen at all: "what came in today" and "what
 * failed". The second is the one that costs money - a failed rental payment is
 * a customer who thinks they have a car and a car that is still available, and
 * nothing anywhere surfaced them as a group.
 *
 * So Failed is a filter, not a needle to find in a list, and a failed row
 * shows the provider's reason rather than making somebody open the booking to
 * learn why.
 *
 * Deposits are deliberately NOT actionable here. Taking money out of one is a
 * decision about a particular rental - what was damaged, what was agreed - and
 * it belongs on that booking, with the return inspection next to it.
 */
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, Search } from 'lucide-react';
import { usePayments, type PaymentRow } from '../features/finance/useFinance';
import { formatMoney } from '../utils/format';

const STATUS_STYLE: Record<PaymentRow['status'], string> = {
  SUCCESS: 'badge-positive',
  PENDING: 'badge-caution',
  FAILED: 'badge-critical',
  REFUNDED: 'badge-neutral',
  PARTIALLY_REFUNDED: 'badge-neutral',
};

const STATUS_LABEL: Record<PaymentRow['status'], string> = {
  SUCCESS: 'paid',
  PENDING: 'pending',
  FAILED: 'failed',
  REFUNDED: 'refunded',
  PARTIALLY_REFUNDED: 'part refunded',
};

const TYPE_LABEL: Record<PaymentRow['type'], string> = {
  RENTAL: 'Rental',
  SECURITY_DEPOSIT: 'Deposit',
  ADDITIONAL_CHARGE: 'Extra charge',
  EXTENSION: 'Extension',
};

const when = (iso: string | null): string =>
  iso
    ? new Date(iso).toLocaleString(undefined, {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';

export default function PaymentsPage() {
  // Filters live in the URL, like every other list here, so a colleague can be
  // sent straight to "the failed ones".
  const [params, setParams] = useSearchParams();
  const page = Number(params.get('page') ?? '1');
  const status = params.get('status') ?? '';
  const type = params.get('type') ?? '';
  const search = params.get('search') ?? '';

  const { data, isPending, isError, error } = usePayments({
    page,
    limit: 25,
    status: status || undefined,
    type: type || undefined,
    search: search || undefined,
  });

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next);
  }

  const rows = data?.items ?? [];

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-[17px] font-semibold tracking-tight text-ink-950">Payments</h2>
        <p className="mt-0.5 text-[13px] text-ink-500">
          Everything charged across every booking. Refunds are issued from the booking itself.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400"
          />
          <input
            type="search"
            defaultValue={search}
            onChange={(event) => setParam('search', event.target.value)}
            placeholder="Booking, customer or reference"
            className="input w-64 pl-8"
          />
        </div>

        <select
          value={status}
          onChange={(event) => setParam('status', event.target.value)}
          className="input w-auto"
          aria-label="Filter by status"
        >
          <option value="">Any status</option>
          <option value="SUCCESS">Paid</option>
          <option value="PENDING">Pending</option>
          <option value="FAILED">Failed</option>
          <option value="REFUNDED">Refunded</option>
          <option value="PARTIALLY_REFUNDED">Partly refunded</option>
        </select>

        <select
          value={type}
          onChange={(event) => setParam('type', event.target.value)}
          className="input w-auto"
          aria-label="Filter by type"
        >
          <option value="">Any type</option>
          <option value="RENTAL">Rental</option>
          <option value="SECURITY_DEPOSIT">Deposit</option>
          <option value="ADDITIONAL_CHARGE">Extra charge</option>
          <option value="EXTENSION">Extension</option>
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
            {search || status || type
              ? 'No payments match those filters.'
              : 'No payments have been taken yet.'}
          </p>
        )}

        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-ink-100 text-sm">
              <thead className="table-head text-left">
                <tr>
                  <th className="px-4 py-2.5">Booking</th>
                  <th className="px-4 py-2.5">Customer</th>
                  <th className="px-4 py-2.5">For</th>
                  <th className="px-4 py-2.5 text-right">Amount</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">When</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {rows.map((payment) => (
                  <tr key={payment.id} className="table-row">
                    <td className="whitespace-nowrap px-4 py-2.5 font-medium text-ink-950">
                      {payment.bookingNumber}
                    </td>
                    <td className="px-4 py-2.5 text-ink-700">
                      {payment.customerName}
                      <span className="block text-[11px] text-ink-400">{payment.customerEmail}</span>
                    </td>
                    <td className="px-4 py-2.5 text-ink-600">
                      {TYPE_LABEL[payment.type]}
                      {payment.instalmentSequence !== null && (
                        <span className="block text-[11px] text-ink-400">
                          month {payment.instalmentSequence}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right font-medium text-ink-950">
                      {payment.currency} {formatMoney(payment.amount)}
                      {Number(payment.refundedTotal) > 0 && (
                        <span className="block text-[11px] font-normal text-ink-400">
                          {formatMoney(payment.refundedTotal)} refunded
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`badge ${STATUS_STYLE[payment.status]}`}>
                        {STATUS_LABEL[payment.status]}
                      </span>
                      {/*
                        The provider's own words, on the row. A failed payment
                        without a reason means opening the booking to find out
                        whether to chase the customer or the gateway.
                      */}
                      {payment.failureReason && (
                        <span className="mt-0.5 block max-w-[16rem] truncate text-[11px] text-critical-700">
                          {payment.failureReason}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-ink-500">
                      {when(payment.paidAt ?? payment.createdAt)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Link
                        to={`/bookings/${payment.bookingId}`}
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
