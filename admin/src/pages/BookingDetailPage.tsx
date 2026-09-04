/**
 * pages/BookingDetailPage.tsx
 * ---------------------------------------------------------------------------
 * One booking from the staff side, with the lifecycle controls.
 *
 * The action buttons come from a MIRROR of the backend's status machine. It
 * decides which buttons to draw; it does not decide what is allowed. If the
 * two ever disagree the server wins and its 409 appears in the error box -
 * which is why that box exists rather than the UI assuming it was right.
 */
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import BookingStatusBadge from '../components/BookingStatusBadge';
import {
  NEXT_STATUSES,
  useAdminBooking,
  useCancelBookingAdmin,
  useChangeBookingStatus,
} from '../features/bookings/useBookingsAdmin';
import type { BookingStatus } from '../types/booking';

const CANCELLABLE: BookingStatus[] = [
  'PENDING',
  'DOCUMENT_VERIFICATION',
  'PAYMENT_PENDING',
  'CONFIRMED',
  'READY_FOR_PICKUP',
];

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
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-sm font-medium text-slate-900">{value}</dd>
    </div>
  );
}

export default function BookingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isPending, isError, error } = useAdminBooking(id);
  const changeStatus = useChangeBookingStatus();
  const cancelBooking = useCancelBookingAdmin();

  const [actionError, setActionError] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);

  if (isPending) return <div className="h-96 animate-pulse rounded-lg bg-slate-200" />;

  if (isError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6">
        <h2 className="font-semibold text-red-800">Could not load this booking</h2>
        <p className="mt-1 text-sm text-red-700">{error.message}</p>
        <Link to="/bookings" className="mt-4 inline-block text-sm text-red-900 underline">
          Back to bookings
        </Link>
      </div>
    );
  }

  const booking = data.booking;
  const currency = booking.pricing.currency;
  const nextStatuses = NEXT_STATUSES[booking.status];
  const canCancel = CANCELLABLE.includes(booking.status);

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <Link to="/bookings" className="text-sm text-slate-500 hover:underline">
          &larr; Bookings
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold text-slate-900">{booking.bookingNumber}</h2>
          <BookingStatusBadge status={booking.status} label={booking.statusLabel} />
        </div>
      </div>

      {actionError && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {actionError}
        </div>
      )}

      {(nextStatuses.length > 0 || canCancel) && (
        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <h3 className="font-semibold text-slate-900">Move this booking on</h3>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {nextStatuses.map((next) => (
              <button
                key={next}
                type="button"
                disabled={changeStatus.isPending}
                onClick={() => {
                  setActionError(null);
                  changeStatus.mutate(
                    { id: booking.id, status: next },
                    { onError: (err) => setActionError(err.message) },
                  );
                }}
                className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                Mark {next.replace(/_/g, ' ').toLowerCase()}
              </button>
            ))}

            {canCancel && !cancelling && (
              <button
                type="button"
                onClick={() => setCancelling(true)}
                className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50"
              >
                Cancel booking
              </button>
            )}
          </div>

          {cancelling && (
            <div className="mt-3 space-y-2">
              <textarea
                rows={2}
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Reason for cancellation (the customer sees this)"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={cancelBooking.isPending}
                  onClick={() => {
                    setActionError(null);
                    cancelBooking.mutate(
                      { id: booking.id, reason: cancelReason.trim() || undefined },
                      {
                        onSuccess: () => setCancelling(false),
                        onError: (err) => setActionError(err.message),
                      },
                    );
                  }}
                  className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  Confirm cancellation
                </button>
                <button
                  type="button"
                  onClick={() => setCancelling(false)}
                  className="text-sm text-slate-600 hover:underline"
                >
                  Keep it
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <h3 className="font-semibold text-slate-900">Customer</h3>
          <dl className="mt-3 space-y-3">
            <Detail label="Name" value={booking.customer?.fullName ?? '-'} />
            <Detail label="Email" value={booking.customer?.email ?? '-'} />
            <Detail label="Phone" value={booking.customer?.phone ?? 'Not provided'} />
          </dl>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <h3 className="font-semibold text-slate-900">Vehicle and period</h3>
          <dl className="mt-3 space-y-3">
            <Detail label="Vehicle" value={`${booking.vehicle.name} (${booking.vehicle.year})`} />
            <Detail label="Plate" value={booking.vehicle.registrationNumber ?? '-'} />
            <Detail label="Pickup" value={formatDate(booking.period.pickupAt)} />
            <Detail label="Return" value={formatDate(booking.period.returnAt)} />
            <Detail label="Pickup location" value={booking.locations.pickup?.name ?? 'Not set'} />
          </dl>
        </section>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h3 className="font-semibold text-slate-900">Price as booked</h3>
        <p className="mt-1 text-xs text-slate-500">
          Snapshot taken when the booking was created. Rate changes since do not affect it.
        </p>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-slate-600">Vehicle rental ({booking.period.rentalDays} days)</dt>
            <dd className="font-medium">
              {currency} {booking.pricing.vehicleSubtotal}
            </dd>
          </div>
          {booking.services.map((service) => (
            <div key={service.id} className="flex justify-between">
              <dt className="text-slate-600">
                {service.quantity > 1 ? `${service.name} x${service.quantity}` : service.name}
              </dt>
              <dd className="font-medium">
                {currency} {service.lineTotal}
              </dd>
            </div>
          ))}
          {booking.pricing.taxAmount !== '0.00' && (
            <div className="flex justify-between">
              <dt className="text-slate-600">VAT</dt>
              <dd className="font-medium">
                {currency} {booking.pricing.taxAmount}
              </dd>
            </div>
          )}
          <div className="flex justify-between border-t border-slate-200 pt-2 font-semibold">
            <dt>Rental total</dt>
            <dd>
              {currency} {booking.pricing.totalAmount}
            </dd>
          </div>
          <div className="flex justify-between text-slate-600">
            <dt>Security deposit</dt>
            <dd>
              {currency} {booking.pricing.securityDeposit}
            </dd>
          </div>
        </dl>
      </section>

      {booking.cancellation && (
        <section className="rounded-lg border border-red-200 bg-red-50 p-5">
          <h3 className="font-semibold text-red-900">Cancellation</h3>
          <p className="mt-1 text-sm text-red-800">
            {formatDate(booking.cancellation.cancelledAt)}
            {booking.cancellation.reason ? ` - ${booking.cancellation.reason}` : ''}
          </p>
          <p className="mt-2 text-sm text-red-800">
            Fee {currency} {booking.cancellation.fee} - refund due {currency}{' '}
            {booking.cancellation.refundDue}
          </p>
        </section>
      )}

      {booking.customerNotes && (
        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <h3 className="font-semibold text-slate-900">Customer notes</h3>
          <p className="mt-2 text-sm text-slate-700">{booking.customerNotes}</p>
        </section>
      )}

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h3 className="font-semibold text-slate-900">History</h3>
        <ol className="mt-3 space-y-2 text-sm">
          {booking.statusHistory.map((entry, index) => (
            <li
              key={index}
              className="flex flex-wrap items-baseline gap-2 border-b border-slate-100 pb-2 last:border-0"
            >
              <span className="text-xs text-slate-400">{new Date(entry.at).toLocaleString()}</span>
              <span className="text-slate-700">
                {entry.from ? `${entry.from.replace(/_/g, ' ')} -> ` : ''}
                <span className="font-medium">{entry.to.replace(/_/g, ' ')}</span>
              </span>
              {entry.reason && <span className="text-xs text-slate-500">{entry.reason}</span>}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
