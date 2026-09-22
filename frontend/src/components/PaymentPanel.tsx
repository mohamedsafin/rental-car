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
import { ArrowRight } from 'lucide-react';
import { useInitiatePayment, usePayments } from '../features/payments/usePayments';
import { PAYMENT_STATUS_STYLE, type PaymentType } from '../types/payment';
import type { Booking } from '../types/booking';

const TYPE_LABEL: Record<string, string> = {
  RENTAL: 'Rental',
  SECURITY_DEPOSIT: 'Security deposit',
  ADDITIONAL_CHARGE: 'Additional charge',
  EXTENSION: 'Extension',
};

/**
 * Which payments make sense to offer, given where the booking has got to.
 *
 * CONFIRMED used to sit on the deposit-only line, on the old assumption that
 * a confirmed booking had already paid for its rental. Confirmation now comes
 * BEFORE payment, so that line left a confirmed customer looking at a page
 * that said "payment is the next step" above a button offering only the
 * deposit - with no way to pay the rental at all.
 *
 * READY_FOR_PICKUP stays deposit-only, and that assumption still holds: an
 * online booking only gets there once the rental payment has cleared.
 */
function payableTypes(status: string): PaymentType[] {
  if (status === 'PENDING' || status === 'CONFIRMED' || status === 'PAYMENT_PENDING') {
    return ['RENTAL', 'SECURITY_DEPOSIT'];
  }
  if (status === 'READY_FOR_PICKUP') return ['SECURITY_DEPOSIT'];
  return [];
}

export default function PaymentPanel({ booking }: { booking: Booking }) {
  const { data, isPending } = usePayments(booking.id);
  const initiate = useInitiatePayment();
  const [error, setError] = useState<string | null>(null);

  const payments = data?.payments ?? [];
  const paidTypes = new Set(payments.filter((p) => p.status === 'SUCCESS').map((p) => p.type as string));
  const outstanding = payableTypes(booking.status).filter((type) => {
    if (paidTypes.has(type)) return false;
    // A pay-at-pickup customer settles the rental itself at the counter, so
    // offering them an online rental checkout contradicts the choice they
    // already made. The deposit is still collectable online.
    if (type === 'RENTAL' && booking.paymentMethod === 'CASH_ON_PICKUP') return false;
    /*
     * A monthly rental is paid month by month from its schedule, which has its
     * own Pay button against the month actually due. A "Pay rental" button
     * here would be ambiguous at best - and the figure beside it is the whole
     * term, which is precisely the number monthly billing exists to avoid
     * asking for.
     */
    if (type === 'RENTAL' && booking.billingCycle === 'MONTHLY') return false;
    return true;
  });
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
    <section aria-labelledby="payments-title" className="surface p-5 sm:p-6">
      <h2 id="payments-title" className="text-[15px] font-semibold text-ink-950">
        Payments
      </h2>

      {error && (
        <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm text-red-700">
          {error}
        </p>
      )}

      {isPending ? (
        <div className="mt-4 h-16 animate-pulse rounded-xl bg-ink-100" aria-hidden />
      ) : payments.length > 0 ? (
        <ul className="mt-3 divide-y divide-ink-100">
          {payments.map((payment) => (
            <li key={payment.id} className="flex items-center justify-between gap-3 py-3.5">
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink-950">{TYPE_LABEL[payment.type] ?? payment.type}</p>
                <p className="text-xs text-ink-500">
                  {payment.paidAt
                    ? `Paid ${new Date(payment.paidAt).toLocaleString()}`
                    : `Created ${new Date(payment.createdAt).toLocaleString()}`}
                </p>
                {payment.failureReason && <p className="mt-1 text-xs text-red-600">{payment.failureReason}</p>}
                {payment.refunds.map((refund) => (
                  <p key={refund.id} className="mt-1 text-xs text-emerald-700">
                    Refund {payment.currency} {refund.amount} - {refund.status.toLowerCase()}
                  </p>
                ))}
              </div>
              <div className="shrink-0 text-right">
                <p className="tabular text-sm font-semibold text-ink-950">
                  {payment.currency} {payment.amount}
                </p>
                <span
                  className={`mt-1 inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${PAYMENT_STATUS_STYLE[payment.status]}`}
                >
                  {payment.status.replace(/_/g, ' ').toLowerCase()}
                </span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-ink-500">No payments yet.</p>
      )}

      {hasPending && (
        <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-xs leading-relaxed text-amber-900">
          A payment is awaiting confirmation from the payment provider. This page updates itself when it
          arrives - we confirm from the provider, never from your browser.
        </p>
      )}

      {outstanding.length > 0 && (
        <div className="mt-5 grid gap-2">
          {outstanding.map((type) => (
            <button
              key={type}
              type="button"
              disabled={initiate.isPending}
              onClick={() => pay(type)}
              className="btn btn-accent w-full"
            >
              {initiate.isPending ? 'Opening…' : `Pay ${TYPE_LABEL[type].toLowerCase()}`}
              {!initiate.isPending && <ArrowRight aria-hidden className="btn-arrow h-4 w-4" />}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
