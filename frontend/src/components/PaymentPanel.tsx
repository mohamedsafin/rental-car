/**
 * components/PaymentPanel.tsx
 * ---------------------------------------------------------------------------
 * Payment status and the "pay now" action for one booking.
 *
 * The important thing this component does NOT do: decide that a payment
 * succeeded. It sends the customer to the provider, then reports whatever the
 * SERVER says, refreshing while anything is still pending. Coming back from
 * the gateway proves nothing - only the webhook does.
 */
import { useState } from 'react';
import { useInitiatePayment, usePayments } from '../features/payments/usePayments';
import { PAYMENT_STATUS_STYLE, type PaymentType } from '../types/payment';
import type { Booking } from '../types/booking';

const TYPE_LABEL: Record<string, string> = {
  RENTAL: 'Rental',
  SECURITY_DEPOSIT: 'Security deposit',
  ADDITIONAL_CHARGE: 'Additional charge',
  EXTENSION: 'Extension',
};

/** Which payments make sense to offer, given where the booking has got to. */
function payableTypes(status: string): PaymentType[] {
  if (status === 'PENDING' || status === 'PAYMENT_PENDING') return ['RENTAL', 'SECURITY_DEPOSIT'];
  if (status === 'CONFIRMED' || status === 'READY_FOR_PICKUP') return ['SECURITY_DEPOSIT'];
  return [];
}

export default function PaymentPanel({ booking }: { booking: Booking }) {
  const { data, isPending } = usePayments(booking.id);
  const initiate = useInitiatePayment();
  const [error, setError] = useState<string | null>(null);

  const payments = data?.payments ?? [];
  const paidTypes = new Set(
    payments.filter((p) => p.status === 'SUCCESS').map((p) => p.type as string),
  );
  const outstanding = payableTypes(booking.status).filter((type) => !paidTypes.has(type));
  const hasPending = payments.some((p) => p.status === 'PENDING');

  function pay(type: PaymentType) {
    setError(null);
    initiate.mutate(
      { bookingId: booking.id, type },
      {
        // The provider's hosted page. In production the real gateway; in
        // development, the local simulator.
        onSuccess: (result) => {
          window.location.href = result.checkoutUrl;
        },
        onError: (err) => setError(err.message),
      },
    );
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="font-semibold text-slate-900">Payments</h2>

      {error && (
        <p role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {isPending ? (
        <div className="mt-3 h-16 animate-pulse rounded bg-slate-100" />
      ) : payments.length > 0 ? (
        <ul className="mt-3 divide-y divide-slate-100">
          {payments.map((payment) => (
            <li key={payment.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="font-medium text-slate-900">
                  {TYPE_LABEL[payment.type] ?? payment.type}
                </p>
                <p className="text-xs text-slate-500">
                  {payment.paidAt
                    ? `Paid ${new Date(payment.paidAt).toLocaleString()}`
                    : `Created ${new Date(payment.createdAt).toLocaleString()}`}
                </p>
                {payment.failureReason && (
                  <p className="mt-1 text-xs text-red-600">{payment.failureReason}</p>
                )}
                {payment.refunds.map((refund) => (
                  <p key={refund.id} className="mt-1 text-xs text-emerald-700">
                    Refund {payment.currency} {refund.amount} - {refund.status.toLowerCase()}
                  </p>
                ))}
              </div>
              <div className="shrink-0 text-right">
                <p className="font-semibold text-slate-900">
                  {payment.currency} {payment.amount}
                </p>
                <span
                  className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${PAYMENT_STATUS_STYLE[payment.status]}`}
                >
                  {payment.status.replace(/_/g, ' ').toLowerCase()}
                </span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-slate-500">No payments yet.</p>
      )}

      {hasPending && (
        <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          A payment is awaiting confirmation from the payment provider. This page updates itself
          when it arrives - we confirm from the provider, never from your browser.
        </p>
      )}

      {outstanding.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {outstanding.map((type) => (
            <button
              key={type}
              type="button"
              disabled={initiate.isPending}
              onClick={() => pay(type)}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {initiate.isPending ? 'Opening...' : `Pay ${TYPE_LABEL[type].toLowerCase()}`}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
