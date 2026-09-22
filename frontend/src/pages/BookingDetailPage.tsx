/**
 * pages/BookingDetailPage.tsx
 * ---------------------------------------------------------------------------
 * One booking, from the customer's side.
 *
 * The price shown is the SNAPSHOT taken when the booking was made, not a live
 * quote. If the daily rate has changed since, this still shows what the
 * customer agreed to - the whole reason those columns exist on the booking.
 *
 * Layout: the car and its dates first, then two columns - the record (price,
 * extension, deposit, invoices, cancellation) on the left and the payment
 * panel pinned on the right, because "what do I still owe, and how do I pay
 * it" is the question this page most often exists to answer. On phones the
 * payment panel comes straight after the price for the same reason.
 */
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CarFront } from 'lucide-react';
import BookingStatusBadge from '../components/BookingStatusBadge';
import BookingProgress from '../components/BookingProgress';
import PaymentPanel from '../components/PaymentPanel';
import DepositPanel from '../components/DepositPanel';
import ChargesPanel from '../components/ChargesPanel';
import InstalmentSchedule from '../components/InstalmentSchedule';
import InvoicePanel from '../components/InvoicePanel';
import ExtensionRequest from '../components/ExtensionRequest';
import PageHeader from '../components/PageHeader';
import { useBooking, useCancelBooking } from '../features/bookings/useBookings';
import { useInitiatePayment } from '../features/payments/usePayments';
import { BOOKING_STATUS_HELP } from '../types/booking';
import { API_ORIGIN } from '../utils/apiOrigin';

const CANCELLABLE = ['PENDING', 'DOCUMENT_VERIFICATION', 'PAYMENT_PENDING', 'CONFIRMED'];

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
      <dt className="text-[13px] text-ink-500">{label}</dt>
      <dd className="mt-1 text-[15px] font-medium text-ink-950">{value}</dd>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-ink-600">{label}</dt>
      <dd className="tabular shrink-0 font-medium text-ink-950">{value}</dd>
    </div>
  );
}

export default function BookingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isPending, isError, error } = useBooking(id);
  const cancelBooking = useCancelBooking();
  // The schedule pays the month the SERVER says is next; the request carries
  // no amount and no month, so a browser cannot choose which one it settles.
  const payMonth = useInitiatePayment();

  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [cancelError, setCancelError] = useState<string | null>(null);

  if (isPending) {
    return (
      <div className="page-container pt-10 sm:pt-14" aria-busy="true">
        <div className="animate-pulse space-y-6">
          <div className="h-12 w-1/2 rounded-lg bg-ink-100" />
          <div className="h-56 rounded-card bg-ink-100" />
          <div className="h-72 rounded-card bg-ink-100" />
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="page-container pt-14">
        <div className="rounded-card border border-red-200 bg-red-50 p-6">
          <h1 className="font-semibold text-red-800">Booking not found</h1>
          <p className="mt-1 text-sm text-red-700">{error.message}</p>
          <Link to="/account/bookings" className="mt-4 inline-block text-sm text-red-900 underline">
            Back to my bookings
          </Link>
        </div>
      </div>
    );
  }

  const booking = data.booking;
  const currency = booking.pricing.currency;

  /*
   * Why this booking is waiting on documents, if the server said.
   *
   * It lives on the first status-history entry - written when the booking was
   * created and the check actually ran - rather than being recomputed here,
   * because the answer depends on what the documents looked like at that
   * moment, not now.
   */
  const creationEntry = booking.statusHistory[0];
  const verificationReason =
    booking.status === 'DOCUMENT_VERIFICATION' &&
    creationEntry?.reason &&
    creationEntry.reason !== 'Booking created'
      ? creationEntry.reason.replace(/^Booking created\.\s*/, '')
      : null;
  const canCancel = CANCELLABLE.includes(booking.status);

  return (
    <div className="page-container pt-10 sm:pt-14">
      <PageHeader
        back={{ to: '/account/bookings', label: 'My bookings' }}
        eyebrow="Booking"
        title={<span className="tabular">{booking.bookingNumber}</span>}
        description={
          <span className="flex flex-wrap items-center gap-3">
            <BookingStatusBadge status={booking.status} label={booking.statusLabel} />
            <span>{BOOKING_STATUS_HELP[booking.status]}</span>
          </span>
        }
      />

      <BookingProgress booking={booking} />

      <InstalmentSchedule
        booking={booking}
        paying={payMonth.isPending}
        onPay={() => {
          payMonth.mutate(
            { bookingId: booking.id, type: 'RENTAL' },
            { onSuccess: (result) => { window.location.href = result.checkoutUrl; } },
          );
        }}
      />

      {booking.status === 'DOCUMENT_VERIFICATION' && (
        <div className="mt-8 flex flex-wrap items-center justify-between gap-4 rounded-card border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
          {/*
            The SPECIFIC reason, when the server recorded one.
            ----------------------------------------------------------------
            Documents are checked against the rental's RETURN date, so a
            customer whose papers are all approved today can still land here
            because something expires partway through the booking. The generic
            line - "upload anything still outstanding" - sent exactly that
            customer to a page showing every document approved, with nothing to
            do and no idea why. The reason names the document and the date.
          */}
          <p className="min-w-0 flex-1">
            {verificationReason ?? 'We need your documents before this booking can proceed to payment.'}
          </p>
          <Link to="/account/documents" className="btn btn-primary btn-sm shrink-0">
            {verificationReason ? 'Update documents' : 'Upload documents'}
          </Link>
        </div>
      )}

      <section
        aria-labelledby="vehicle-title"
        className="surface mt-8 grid gap-6 p-3 sm:p-4 md:grid-cols-[minmax(0,17rem)_minmax(0,1fr)] md:items-center md:gap-8"
      >
        <div className="image-stage aspect-16/10 overflow-hidden rounded-xl">
          {booking.vehicle.imageUrl ? (
            <img
              src={`${API_ORIGIN}${booking.vehicle.imageUrl}`}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="flex h-full items-center justify-center">
              <CarFront aria-hidden className="h-8 w-8 text-ink-400" strokeWidth={1.5} />
            </span>
          )}
        </div>
        <div className="px-2 pb-3 md:px-0 md:pb-0 md:pr-4">
          <h2 id="vehicle-title" className="text-xl font-semibold tracking-tight text-ink-950">
            {booking.vehicle.name}
          </h2>
          <p className="mt-1 text-sm text-ink-500">
            {booking.vehicle.year} · {booking.vehicle.category}
          </p>
          <h3 className="sr-only">Rental period</h3>
          <dl className="mt-6 grid gap-x-8 gap-y-5 sm:grid-cols-2">
            <Detail label="Pickup" value={formatDate(booking.period.pickupAt)} />
            <Detail label="Return" value={formatDate(booking.period.returnAt)} />
            <Detail label="Pickup location" value={booking.locations.pickup?.name ?? 'To be arranged'} />
            <Detail label="Drop-off location" value={booking.locations.dropoff?.name ?? 'Same as pickup'} />
          </dl>
        </div>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:gap-8">
        <section
          aria-labelledby="price-title"
          className="surface p-5 sm:p-6 lg:col-start-1 lg:row-start-1"
        >
          <h2 id="price-title" className="text-[15px] font-semibold text-ink-950">
            Price
          </h2>
          <dl className="mt-4 space-y-2.5 text-sm">
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

          <div className="mt-5 space-y-2.5 border-t border-ink-100 pt-4 text-sm">
            <div className="flex justify-between font-semibold text-ink-950">
              <span>Rental total</span>
              <span className="tabular">
                {currency} {booking.pricing.totalAmount}
              </span>
            </div>
            <div className="flex justify-between text-ink-600">
              <span>Security deposit (refundable)</span>
              <span className="tabular">
                {currency} {booking.pricing.securityDeposit}
              </span>
            </div>
            <div className="flex items-baseline justify-between border-t border-ink-100 pt-3 text-ink-950">
              <span className="font-semibold">Total payable</span>
              <span className="tabular text-xl font-semibold tracking-tight">
                {currency} {booking.pricing.totalPayable}
              </span>
            </div>
          </div>
        </section>

        <div className="lg:sticky lg:top-24 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start">
          <PaymentPanel booking={booking} />
        </div>

        <div className="space-y-6 lg:col-start-1 lg:row-start-2">
          <ExtensionRequest booking={booking} />

          <ChargesPanel booking={booking} />

          <DepositPanel bookingId={booking.id} />

          <InvoicePanel bookingId={booking.id} />

          {booking.cancellation && (
            <section className="rounded-card border border-red-200 bg-red-50 p-5 sm:p-6">
              <h2 className="font-semibold text-red-900">Cancelled</h2>
              <p className="mt-1 text-sm text-red-800">
                {formatDate(booking.cancellation.cancelledAt)}
                {booking.cancellation.reason ? ` - ${booking.cancellation.reason}` : ''}
              </p>
              <dl className="mt-3 space-y-1 text-sm text-red-800">
                <div className="flex justify-between">
                  <dt>Cancellation fee</dt>
                  <dd className="tabular">
                    {currency} {booking.cancellation.fee}
                  </dd>
                </div>
                <div className="flex justify-between font-medium">
                  <dt>Refund due</dt>
                  <dd className="tabular">
                    {currency} {booking.cancellation.refundDue}
                  </dd>
                </div>
              </dl>
            </section>
          )}

          {canCancel && (
            <section className="surface p-5 sm:p-6">
              {cancelError && (
                <p
                  role="alert"
                  className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm text-red-700"
                >
                  {cancelError}
                </p>
              )}

              {cancelling ? (
                <div className="space-y-4">
                  <label className="block">
                    <span className="field-label">Why are you cancelling? (optional)</span>
                    <textarea
                      rows={3}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      className="field-control"
                    />
                  </label>
                  <div className="flex flex-wrap items-center gap-3">
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
                      className="btn bg-red-600 text-white hover:bg-red-700"
                    >
                      Confirm cancellation
                    </button>
                    <button
                      type="button"
                      onClick={() => setCancelling(false)}
                      className="btn btn-ghost"
                    >
                      Keep my booking
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <p className="text-sm text-ink-600">Plans changed? Fees follow the cancellation policy.</p>
                  <button
                    type="button"
                    onClick={() => setCancelling(true)}
                    className="btn btn-outline border-red-200 text-red-700 hover:border-red-500"
                  >
                    Cancel this booking
                  </button>
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
