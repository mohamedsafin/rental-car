/**
 * pages/BookingDetailPage.tsx
 * ---------------------------------------------------------------------------
 * One booking, from the customer's side.
 *
 * The price shown is the SNAPSHOT taken when the booking was made, not a live
 * quote. If the daily rate has changed since, this still shows what the
 * customer agreed to - the whole reason those columns exist on the booking.
 */
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import BookingStatusBadge from '../components/BookingStatusBadge';
import PaymentPanel from '../components/PaymentPanel';
import DepositPanel from '../components/DepositPanel';
import InvoicePanel from '../components/InvoicePanel';
import ExtensionRequest from '../components/ExtensionRequest';
import { useBooking, useCancelBooking } from '../features/bookings/useBookings';
import { BOOKING_STATUS_HELP } from '../types/booking';

const CANCELLABLE = ['PENDING', 'DOCUMENT_VERIFICATION', 'PAYMENT_PENDING', 'CONFIRMED'];
const API_ORIGIN = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000/api/v1').replace(
  /\/api\/v1$/,
  '',
);

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-ink-500">{label}</dt>
      <dd className="text-sm font-medium text-ink-900">{value}</dd>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-ink-600">{label}</dt>
      <dd className="font-medium text-ink-900">{value}</dd>
    </div>
  );
}

export default function BookingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isPending, isError, error } = useBooking(id);
  const cancelBooking = useCancelBooking();

  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [cancelError, setCancelError] = useState<string | null>(null);

  if (isPending) return <div className="h-96 animate-pulse rounded-lg bg-ink-200" />;

  if (isError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6">
        <h1 className="font-semibold text-red-800">Booking not found</h1>
        <p className="mt-1 text-sm text-red-700">{error.message}</p>
        <Link to="/account/bookings" className="mt-4 inline-block text-sm text-red-900 underline">
          Back to my bookings
        </Link>
      </div>
    );
  }

  const booking = data.booking;
  const currency = booking.pricing.currency;
  const canCancel = CANCELLABLE.includes(booking.status);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link to="/account/bookings" className="text-sm text-ink-500 hover:underline">
          &larr; My bookings
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-ink-900">{booking.bookingNumber}</h1>
          <BookingStatusBadge status={booking.status} label={booking.statusLabel} />
        </div>
        <p className="mt-1 text-sm text-ink-600">{BOOKING_STATUS_HELP[booking.status]}</p>
      </div>

      {booking.status === 'DOCUMENT_VERIFICATION' && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          We need your documents before this booking can proceed to payment.{' '}
          <Link to="/account/documents" className="font-medium underline">
            Upload documents
          </Link>
        </div>
      )}

      <section className="flex gap-4 rounded-lg border border-ink-200 bg-white p-5">
        <div className="h-24 w-32 shrink-0 overflow-hidden rounded bg-ink-100">
          {booking.vehicle.imageUrl && (
            <img
              src={`${API_ORIGIN}${booking.vehicle.imageUrl}`}
              alt=""
              className="h-full w-full object-cover"
            />
          )}
        </div>
        <div>
          <h2 className="font-semibold text-ink-900">{booking.vehicle.name}</h2>
          <p className="text-sm text-ink-600">
            {booking.vehicle.year} - {booking.vehicle.category}
          </p>
        </div>
      </section>

      <section className="rounded-lg border border-ink-200 bg-white p-5">
        <h2 className="font-semibold text-ink-900">Rental period</h2>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          <Detail label="Pickup" value={formatDate(booking.period.pickupAt)} />
          <Detail label="Return" value={formatDate(booking.period.returnAt)} />
          <Detail label="Pickup location" value={booking.locations.pickup?.name ?? 'To be arranged'} />
          <Detail label="Drop-off location" value={booking.locations.dropoff?.name ?? 'Same as pickup'} />
        </dl>
      </section>

      <section className="rounded-lg border border-ink-200 bg-white p-5">
        <h2 className="font-semibold text-ink-900">Price</h2>
        <dl className="mt-3 space-y-2 text-sm">
          <Row
            label={`Vehicle rental (${booking.period.rentalDays} days)`}
            value={`${currency} ${booking.pricing.vehicleSubtotal}`}
          />
          {booking.services.map((service) => (
            <Row
              key={service.id}
              label={service.quantity > 1 ? `${service.name} x${service.quantity}` : service.name}
              value={`${currency} ${service.lineTotal}`}
            />
          ))}
          {booking.pricing.deliveryFee !== '0.00' && (
            <Row label="Delivery" value={`${currency} ${booking.pricing.deliveryFee}`} />
          )}
          {booking.pricing.discountAmount !== '0.00' && (
            <Row label="Discount" value={`- ${currency} ${booking.pricing.discountAmount}`} />
          )}
          {booking.pricing.taxAmount !== '0.00' && (
            <Row label="VAT" value={`${currency} ${booking.pricing.taxAmount}`} />
          )}
        </dl>

        <div className="mt-4 space-y-2 border-t border-ink-200 pt-3 text-sm">
          <div className="flex justify-between font-semibold text-ink-900">
            <span>Rental total</span>
            <span>
              {currency} {booking.pricing.totalAmount}
            </span>
          </div>
          <div className="flex justify-between text-ink-600">
            <span>Security deposit (refundable)</span>
            <span>
              {currency} {booking.pricing.securityDeposit}
            </span>
          </div>
          <div className="flex justify-between border-t border-ink-200 pt-2 text-base font-bold text-ink-900">
            <span>Total payable</span>
            <span>
              {currency} {booking.pricing.totalPayable}
            </span>
          </div>
        </div>
      </section>

      <ExtensionRequest booking={booking} />

      <PaymentPanel booking={booking} />

      <DepositPanel bookingId={booking.id} />

      <InvoicePanel bookingId={booking.id} />

      {booking.cancellation && (
        <section className="rounded-lg border border-red-200 bg-red-50 p-5">
          <h2 className="font-semibold text-red-900">Cancelled</h2>
          <p className="mt-1 text-sm text-red-800">
            {formatDate(booking.cancellation.cancelledAt)}
            {booking.cancellation.reason ? ` - ${booking.cancellation.reason}` : ''}
          </p>
          <dl className="mt-3 space-y-1 text-sm text-red-800">
            <div className="flex justify-between">
              <dt>Cancellation fee</dt>
              <dd>
                {currency} {booking.cancellation.fee}
              </dd>
            </div>
            <div className="flex justify-between font-medium">
              <dt>Refund due</dt>
              <dd>
                {currency} {booking.cancellation.refundDue}
              </dd>
            </div>
          </dl>
        </section>
      )}

      {canCancel && (
        <section className="rounded-lg border border-ink-200 bg-white p-5">
          {cancelError && (
            <p
              role="alert"
              className="mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
            >
              {cancelError}
            </p>
          )}

          {cancelling ? (
            <div className="space-y-3">
              <label className="block">
                <span className="text-sm font-medium text-ink-700">
                  Why are you cancelling? (optional)
                </span>
                <textarea
                  rows={2}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="mt-1 w-full rounded-md border border-ink-300 px-3 py-2 text-sm"
                />
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={cancelBooking.isPending}
                  onClick={() => {
                    setCancelError(null);
                    cancelBooking.mutate(
                      { id: booking.id, reason: reason.trim() || undefined },
                      {
                        onSuccess: () => setCancelling(false),
                        onError: (err) => setCancelError(err.message),
                      },
                    );
                  }}
                  className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  Confirm cancellation
                </button>
                <button
                  type="button"
                  onClick={() => setCancelling(false)}
                  className="text-sm text-ink-600 hover:underline"
                >
                  Keep my booking
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setCancelling(true)}
              className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
            >
              Cancel this booking
            </button>
          )}
        </section>
      )}
    </div>
  );
}
