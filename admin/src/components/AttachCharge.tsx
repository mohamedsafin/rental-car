/**
 * components/AttachCharge.tsx
 * ---------------------------------------------------------------------------
 * "Nobody was driving this" - says who?
 *
 * ===========================================================================
 * WHY THIS EXISTS
 * ===========================================================================
 * A fine or a crossing is matched to a rental by its timestamp. That is right
 * most of the time, and silent when it is wrong: a rental extended by phone
 * and never updated in the system, a car released an hour early, a fine whose
 * stated time is the time it was PROCESSED rather than committed. The charge
 * then sits marked "unattached" forever - meaning the company pays it - and
 * the page had no way to say "no, it was this customer".
 *
 * Worse, the page would actively tell staff to do it: "Attach the fine to that
 * booking to recover it", next to no button that attaches anything.
 *
 * ===========================================================================
 * WHAT IT WILL AND WILL NOT OFFER
 * ===========================================================================
 * Only rentals OF THE SAME CAR, within a month either side. You cannot attach
 * a fine to a customer who never sat in that vehicle, because such a booking
 * is never in the list - and the server refuses it too, so the rule holds even
 * if the request is made by hand.
 *
 * Closed rentals appear but cannot be chosen. A completed rental takes no
 * further charges, and showing it greyed with the reason answers the question
 * a staff member is about to ask - which an empty list would not.
 *
 * Each option says WHY it might be the one, and the three reasons are not
 * equal: "the car was signed out to them" is evidence, "their contract covered
 * that date" is only paperwork, and a booking nobody ever collected on is
 * neither. Only the first is highlighted. Picking one of the others is allowed
 * but has to be deliberate - that is a staff member overriding the record,
 * which is the whole point of the button.
 */
import { useState } from 'react';
import { Link2 } from 'lucide-react';
import { useBookingOptions, useUpdateCharge } from '../features/fleetOps/useFleetOps';

const when = (iso: string): string =>
  new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: '2-digit' });

const moment = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

export default function AttachCharge({
  kind,
  chargeId,
  attachedTo,
  onDone,
  onError,
}: {
  kind: 'fines' | 'tolls';
  chargeId: string;
  /**
   * The booking it currently points at, if any.
   *
   * A charge attached to the WRONG customer was unfixable: the button only
   * appeared when nothing was attached, so a mistake - or a match the software
   * got wrong before it knew to check handover records - could be written off
   * or left billing the wrong person, and nothing else.
   */
  attachedTo: string | null;
  onDone: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const { data, isPending, isError, error } = useBookingOptions(kind, open ? chargeId : null);
  const update = useUpdateCharge(kind);

  function attach(bookingId: string, bookingNumber: string, customerName: string) {
    update.mutate(
      { id: chargeId, bookingId },
      {
        onSuccess: () => {
          setOpen(false);
          onDone(
            attachedTo && attachedTo !== bookingNumber
              ? `Moved from ${attachedTo} to ${bookingNumber} (${customerName}).`
              : `Attached to ${bookingNumber} (${customerName}). You can now recover it from that rental.`,
          );
        },
        onError: (err) => onError(err.message),
      },
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
      >
        <Link2 aria-hidden className="h-3 w-3" />
        {attachedTo ? 'Change' : 'Attach'}
      </button>
    );
  }

  return (
    <div className="w-80 rounded-md border border-slate-300 bg-white p-3 text-left shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-slate-900">
            {attachedTo ? 'Move to another rental' : 'Attach to a rental'}
          </p>
          {data && (
            <p className="text-xs text-slate-500">Charge timed {moment(data.at)}</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-slate-400 hover:text-slate-700"
        >
          Cancel
        </button>
      </div>

      {isPending && <p className="mt-2 text-xs text-slate-500">Looking up this car&apos;s rentals...</p>}

      {isError && <p className="mt-2 text-xs text-red-600">{error.message}</p>}

      {data && data.options.length === 0 && (
        <p className="mt-2 text-xs text-slate-500">
          This car had no rentals within a month of that time, so there is nobody to attach it to.
          It stays with the company.
        </p>
      )}

      {data && data.options.length > 0 && data.options.every((option) => option.closed) && (
        <p className="mt-2 rounded-md bg-slate-50 px-2 py-1.5 text-xs text-slate-600">
          Every rental around that time is already closed, so this one stays with the company.
        </p>
      )}

      {data && data.options.length > 0 && (
        <ul className="mt-2 space-y-1">
          {data.options.map((option) => (
            <li key={option.id}>
              <button
                type="button"
                disabled={update.isPending || option.closed}
                onClick={() => attach(option.id, option.bookingNumber, option.customerName)}
                className={`w-full rounded-md border px-2 py-1.5 text-left text-xs ${
                  option.closed
                    ? 'cursor-not-allowed border-slate-200 bg-slate-50 opacity-60'
                    : option.hadTheCar
                      ? 'border-emerald-300 bg-emerald-50 hover:bg-emerald-100'
                      : 'border-slate-200 hover:bg-slate-50'
                } disabled:opacity-60`}
              >
                <span className="block font-medium text-slate-900">
                  {option.customerName}
                  {option.billingCycle === 'MONTHLY' && (
                    <span className="ml-1 font-normal text-slate-500">(monthly)</span>
                  )}
                </span>
                <span className="block text-slate-500">
                  {option.bookingNumber} - {when(option.pickupAt)} to {when(option.returnAt)}
                  {option.bookingNumber === attachedTo && ' - attached now'}
                </span>
                {/*
                  * Three different things, said differently on purpose. Being
                  * signed out the car is evidence; a contract covering the date
                  * is not; and a booking nobody ever collected on is neither.
                  */}
                {option.closed && (
                  <span className="mt-0.5 block font-medium text-slate-500">
                    This rental is closed - nothing further can be charged to it
                  </span>
                )}
                {!option.closed && option.hadTheCar && (
                  <span className="mt-0.5 block font-medium text-emerald-700">
                    Car was signed out to them at that moment
                  </span>
                )}
                {!option.closed && !option.hadTheCar && option.neverHandedOver && (
                  <span className="mt-0.5 block text-amber-700">
                    Never collected - no handover was recorded
                  </span>
                )}
                {!option.closed && !option.hadTheCar && !option.neverHandedOver && option.bookedOverIt && (
                  <span className="mt-0.5 block text-slate-500">
                    Booked over that date, but the car was not out
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
