/**
 * components/RentalPanel.tsx
 * ---------------------------------------------------------------------------
 * The counter's view of a rental: handover, return, inspection photos, charges
 * and extension requests, all keyed off where the booking has got to.
 *
 * It shows ONE action at a time. A screen offering both "hand over" and "take
 * back" is a screen where a tired member of staff at 7am clicks the wrong one.
 */
import { useRef, useState } from 'react';
import HandoverForm from './HandoverForm';
import ReturnForm from './ReturnForm';
import {
  useCloseRental,
  useRental,
  useReviewExtension,
  useSettleCharge,
  useUploadInspectionPhotos,
  useWaiveCharge,
} from '../features/rentals/useRentals';
import {
  CHARGE_LABELS,
  CHARGE_STATUS_STYLE,
  PHOTO_TYPES,
  type ChargeType,
  type Inspection,
} from '../types/rental';
import type { Booking } from '../types/booking';

const API_ORIGIN = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000/api/v1').replace(
  /\/api\/v1$/,
  '',
);

/**
 * Booking says the car is out (or back) but no rental exists - the handover
 * was never recorded, so the counter can still capture it late.
 */
const NEVER_RECORDED_STATUSES: string[] = [
  'ACTIVE',
  'EXTENSION_REQUESTED',
  'RETURN_PENDING',
  'RETURNED',
];

/** Finished business. Reopening these would be worse than leaving them be. */
const TERMINAL_STATUSES: string[] = ['COMPLETED', 'CANCELLED'];

function InspectionCard({
  inspection,
  bookingId,
}: {
  inspection: Inspection;
  bookingId: string;
}) {
  const upload = useUploadInspectionPhotos(bookingId);
  const fileInput = useRef<HTMLInputElement>(null);
  const [photoType, setPhotoType] = useState('FRONT');
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-medium text-slate-900">
          {inspection.type === 'PICKUP' ? 'Pickup inspection' : 'Return inspection'}
        </h4>
        <span className="text-xs text-slate-500">
          {new Date(inspection.createdAt).toLocaleString()}
        </span>
      </div>

      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-slate-500">Odometer</dt>
          <dd className="font-medium">{inspection.mileage.toLocaleString()} km</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Fuel</dt>
          <dd className="font-medium">{inspection.fuelPercent}%</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Customer verified</dt>
          <dd className="font-medium">{inspection.customerVerified ? 'Yes' : '-'}</dd>
        </div>
      </dl>

      {inspection.damageNotes && (
        <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
          <span className="font-medium">
            {inspection.type === 'PICKUP' ? 'Existing damage:' : 'New damage:'}
          </span>{' '}
          {inspection.damageNotes}
        </p>
      )}
      {inspection.conditionNotes && (
        <p className="mt-2 text-xs text-slate-600">{inspection.conditionNotes}</p>
      )}
      {inspection.cleanliness && (
        <p className="mt-1 text-xs text-slate-600">Cleanliness: {inspection.cleanliness}</p>
      )}

      {inspection.photos.length > 0 && (
        <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {inspection.photos.map((photo) => (
            <li key={photo.id} className="overflow-hidden rounded border border-slate-200">
              <img
                src={`${API_ORIGIN}${photo.url}`}
                alt={photo.type}
                className="aspect-[4/3] w-full object-cover"
              />
              <p className="p-1 text-center text-[10px] text-slate-500">
                {photo.type.replace(/_/g, ' ').toLowerCase()}
              </p>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p role="alert" className="mt-2 text-xs text-red-600">
          {error}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          value={photoType}
          onChange={(e) => setPhotoType(e.target.value)}
          className="rounded-md border border-slate-300 px-2 py-1 text-xs"
        >
          {PHOTO_TYPES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          disabled={upload.isPending}
          onChange={(e) => {
            const files = e.target.files;
            if (!files || files.length === 0) return;
            setError(null);
            upload.mutate(
              { inspectionId: inspection.id, files: Array.from(files), type: photoType },
              {
                onError: (err) => setError(err.message),
                onSettled: () => {
                  if (fileInput.current) fileInput.current.value = '';
                },
              },
            );
          }}
          className="text-xs file:mr-2 file:rounded file:border-0 file:bg-slate-900 file:px-2 file:py-1 file:text-xs file:text-white"
        />
        {upload.isPending && <span className="text-xs text-slate-500">Uploading...</span>}
      </div>
    </div>
  );
}

export default function RentalPanel({
  booking,
  vehicleMileage,
}: {
  booking: Booking;
  vehicleMileage: number;
}) {
  const { data, isPending } = useRental(booking.id);
  const settle = useSettleCharge(booking.id);
  const waive = useWaiveCharge(booking.id);
  const close = useCloseRental(booking.id);
  const reviewExtension = useReviewExtension(booking.id);

  const [error, setError] = useState<string | null>(null);
  const [waivingId, setWaivingId] = useState<string | null>(null);
  const [waiveReason, setWaiveReason] = useState('');
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  if (isPending) return <div className="h-40 animate-pulse rounded-lg bg-slate-200" />;

  const rental = data?.rental ?? null;
  const extensions = data?.extensions ?? [];
  const pendingExtension = extensions.find((extension) => extension.status === 'REQUESTED');

  return (
    <section className="space-y-4">
      <h3 className="font-semibold text-slate-900">Rental</h3>

      {error && (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {/* An extension request outranks everything else: the customer is
          waiting on an answer and the car may be due back today. */}
      {pendingExtension && (
        <div className="rounded-lg border border-purple-200 bg-purple-50 p-4">
          <h4 className="font-medium text-purple-900">Extension requested</h4>
          <p className="mt-1 text-sm text-purple-800">
            Until {new Date(pendingExtension.requestedReturnAt).toLocaleString()} -{' '}
            {pendingExtension.additionalDays} extra day(s) at {pendingExtension.currency}{' '}
            {pendingExtension.additionalAmount}
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={reviewExtension.isPending}
              onClick={() => {
                setError(null);
                reviewExtension.mutate(
                  { extensionId: pendingExtension.id, approve: true },
                  { onError: (err) => setError(err.message) },
                );
              }}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              Approve
            </button>
            {rejectingId === pendingExtension.id ? (
              <div className="flex-1 space-y-2">
                <input
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Why not? The customer sees this."
                  className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                />
                <button
                  type="button"
                  disabled={rejectReason.trim().length < 3}
                  onClick={() => {
                    setError(null);
                    reviewExtension.mutate(
                      {
                        extensionId: pendingExtension.id,
                        approve: false,
                        rejectionReason: rejectReason.trim(),
                      },
                      {
                        onSuccess: () => setRejectingId(null),
                        onError: (err) => setError(err.message),
                      },
                    );
                  }}
                  className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                >
                  Confirm rejection
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setRejectingId(pendingExtension.id)}
                className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50"
              >
                Reject
              </button>
            )}
          </div>
        </div>
      )}

      {/* Exactly one primary action, decided by where the booking has got to. */}
      {!rental && booking.status === 'READY_FOR_PICKUP' && (
        <HandoverForm bookingId={booking.id} currentMileage={vehicleMileage} />
      )}

      {/*
        Two very different situations used to share one misleading message.
        A booking that says the car is out or back, with no rental behind it,
        is not "waiting to be handed over" - it is inconsistent, and telling
        staff to move it back to "ready for pickup" sent them looking for a
        transition the status machine does not have.
      */}
      {!rental && booking.status !== 'READY_FOR_PICKUP' && (
        <>
          {NEVER_RECORDED_STATUSES.includes(booking.status) ? (
            <>
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm">
                <p className="font-medium text-amber-900">
                  This booking says {booking.status.replace(/_/g, ' ').toLowerCase()}, but the
                  handover was never recorded.
                </p>
                <p className="mt-1 text-amber-800">
                  Record it below with the readings the car actually went out on. The booking
                  returns to active, and the return and its inspection then work normally.
                </p>
              </div>
              <HandoverForm bookingId={booking.id} currentMileage={vehicleMileage} />
            </>
          ) : (
            <p className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
              {TERMINAL_STATUSES.includes(booking.status)
                ? `This booking is ${booking.status.toLowerCase()} and has no rental attached, so there is nothing to inspect or close.`
                : 'The vehicle has not been handed over yet. Move the booking to “ready for pickup” first.'}
            </p>
          )}
        </>
      )}

      {rental?.status === 'ACTIVE' && <ReturnForm bookingId={booking.id} rental={rental} />}

      {rental && (
        <>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <dl className="grid gap-3 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-xs text-slate-500">Picked up</dt>
                <dd className="font-medium">{new Date(rental.pickedUpAt).toLocaleString()}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Due back</dt>
                <dd className="font-medium">{new Date(rental.dueBackAt).toLocaleString()}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Returned</dt>
                <dd className="font-medium">
                  {rental.returnedAt ? new Date(rental.returnedAt).toLocaleString() : 'Not yet'}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Distance</dt>
                <dd className="font-medium">
                  {rental.distanceDriven === null
                    ? '-'
                    : rental.distanceDriven.toLocaleString() + ' km'}
                </dd>
              </div>
            </dl>
          </div>

          <div className="space-y-3">
            {rental.inspections.map((inspection) => (
              <InspectionCard key={inspection.id} inspection={inspection} bookingId={booking.id} />
            ))}
          </div>
        </>
      )}

      {rental && rental.charges.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h4 className="font-medium text-slate-900">Additional charges</h4>
          <ul className="mt-3 divide-y divide-slate-100">
            {rental.charges.map((charge) => (
              <li key={charge.id} className="py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900">
                      {CHARGE_LABELS[charge.type as ChargeType]}
                    </p>
                    <p className="text-xs text-slate-500">{charge.description}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-semibold text-slate-900">
                      {charge.currency} {charge.amount}
                    </p>
                    <span
                      className={
                        'mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ' +
                        CHARGE_STATUS_STYLE[charge.status]
                      }
                    >
                      {charge.status.replace(/_/g, ' ').toLowerCase()}
                    </span>
                  </div>
                </div>

                {charge.status === 'PENDING' && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={settle.isPending}
                      onClick={() => {
                        setError(null);
                        settle.mutate(charge.id, { onError: (err) => setError(err.message) });
                      }}
                      className="rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
                    >
                      Take from deposit
                    </button>

                    {waivingId === charge.id ? (
                      <div className="flex flex-1 gap-2">
                        <input
                          value={waiveReason}
                          onChange={(e) => setWaiveReason(e.target.value)}
                          placeholder="Why is this being written off?"
                          className="flex-1 rounded-md border border-slate-300 px-2 py-1 text-xs"
                        />
                        <button
                          type="button"
                          disabled={waiveReason.trim().length < 3}
                          onClick={() => {
                            setError(null);
                            waive.mutate(
                              { chargeId: charge.id, reason: waiveReason.trim() },
                              {
                                onSuccess: () => {
                                  setWaivingId(null);
                                  setWaiveReason('');
                                },
                                onError: (err) => setError(err.message),
                              },
                            );
                          }}
                          className="rounded-md border border-red-300 px-2 py-1 text-xs text-red-700 disabled:opacity-50"
                        >
                          Confirm
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setWaivingId(charge.id)}
                        className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700"
                      >
                        Waive
                      </button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {rental?.status === 'RETURNED' && (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h4 className="font-medium text-slate-900">Finish up</h4>
          <p className="mt-1 text-sm text-slate-600">
            Settle or waive any outstanding charges, then close the rental to put the vehicle back
            in service.
          </p>
          <button
            type="button"
            disabled={close.isPending}
            onClick={() => {
              setError(null);
              close.mutate(undefined, { onError: (err) => setError(err.message) });
            }}
            className="mt-3 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            Close rental and return the car to service
          </button>
        </div>
      )}
    </section>
  );
}
