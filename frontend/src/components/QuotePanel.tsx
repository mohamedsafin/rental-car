/**
 * components/QuotePanel.tsx
 * ---------------------------------------------------------------------------
 * Date pickers, optional extras, and the live price for one vehicle.
 *
 * Every keystroke re-asks the BACKEND for the price. That looks chatty, and it
 * is deliberate: the alternative is duplicating the tier-selection, discount
 * and VAT logic in the browser, where it would drift from the engine and show
 * customers a number they are not actually charged.
 *
 * It also asks about availability in the same call, so the panel can say "not
 * available for these dates" the moment the dates change rather than at
 * checkout.
 *
 * The Book button sends only the CHOICE - vehicle, dates, services. The total
 * shown here is for the customer's benefit; the backend recomputes it.
 */
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import PriceBreakdown from './PriceBreakdown';
import { toIso, useAdditionalServices, useQuote } from '../features/booking/useBooking';
import { useCreateBooking } from '../features/bookings/useBookings';
import { useAuth } from '../hooks/useAuth';
import type { Vehicle } from '../types/vehicle';

function dateOffset(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

const TODAY = new Date().toISOString().slice(0, 10);

export interface QuotePanelProps {
  vehicle: Vehicle;
  /** Dates carried over from a search, if the customer arrived that way. */
  initial?: {
    pickupDate?: string;
    pickupTime?: string;
    returnDate?: string;
    returnTime?: string;
    pickupLocationId?: string;
  };
}

export default function QuotePanel({ vehicle, initial }: QuotePanelProps) {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const createBooking = useCreateBooking();
  const [bookingError, setBookingError] = useState<string | null>(null);

  const [dates, setDates] = useState({
    pickupDate: initial?.pickupDate || dateOffset(1),
    pickupTime: initial?.pickupTime || '10:00',
    returnDate: initial?.returnDate || dateOffset(4),
    returnTime: initial?.returnTime || '10:00',
  });

  const [selected, setSelected] = useState<Record<string, number>>({});

  const { data: serviceData } = useAdditionalServices();

  const services = useMemo(
    () =>
      Object.entries(selected)
        .filter(([, quantity]) => quantity > 0)
        .map(([serviceId, quantity]) => ({ serviceId, quantity })),
    [selected],
  );

  const pickupAt = toIso(dates.pickupDate, dates.pickupTime);
  const returnAt = toIso(dates.returnDate, dates.returnTime);
  const datesValid = new Date(returnAt) > new Date(pickupAt);

  const { data, isPending, isError, error } = useQuote({
    vehicleId: vehicle.id,
    pickupAt: datesValid ? pickupAt : null,
    returnAt: datesValid ? returnAt : null,
    services,
    pickupLocationId: initial?.pickupLocationId,
  });

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <h3 className="font-semibold text-slate-900">Your rental dates</h3>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Pickup date</span>
            <input
              type="date"
              min={TODAY}
              value={dates.pickupDate}
              onChange={(e) => setDates({ ...dates, pickupDate: e.target.value })}
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Pickup time</span>
            <input
              type="time"
              value={dates.pickupTime}
              onChange={(e) => setDates({ ...dates, pickupTime: e.target.value })}
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Return date</span>
            <input
              type="date"
              min={dates.pickupDate}
              value={dates.returnDate}
              onChange={(e) => setDates({ ...dates, returnDate: e.target.value })}
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Return time</span>
            <input
              type="time"
              value={dates.returnTime}
              onChange={(e) => setDates({ ...dates, returnTime: e.target.value })}
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
        </div>

        {!datesValid && (
          <p role="alert" className="mt-3 text-sm text-red-600">
            Return must be after pickup.
          </p>
        )}
      </div>

      {serviceData && serviceData.services.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <h3 className="font-semibold text-slate-900">Optional extras</h3>
          <ul className="mt-3 space-y-2">
            {serviceData.services.map((service) => (
              <li key={service.id} className="flex items-center justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium text-slate-800">{service.name}</p>
                  <p className="text-xs text-slate-500">
                    {vehicle.pricing.currency} {service.price}
                    {service.chargeType === 'PER_DAY' ? ' per day' : ' one-off'}
                  </p>
                </div>
                <input
                  type="number"
                  min={0}
                  max={service.maxQuantity}
                  value={selected[service.id] ?? 0}
                  onChange={(e) =>
                    setSelected({ ...selected, [service.id]: Number(e.target.value) })
                  }
                  className="w-16 rounded-md border border-slate-300 px-2 py-1 text-sm"
                />
              </li>
            ))}
          </ul>
        </div>
      )}

      {isError && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error.message}
        </div>
      )}

      {isPending && datesValid && (
        <div className="h-48 animate-pulse rounded-lg bg-slate-200" />
      )}

      {data && (
        <>
          {data.availability.available ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
              Available for these dates.
            </div>
          ) : (
            <div role="alert" className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              {data.availability.reason ?? 'Not available for these dates.'}
            </div>
          )}

          <PriceBreakdown quote={data.quote} />

          {bookingError && (
            <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {bookingError}
            </div>
          )}

          {isAuthenticated ? (
            <button
              type="button"
              disabled={!data.availability.available || createBooking.isPending}
              onClick={() => {
                setBookingError(null);
                createBooking.mutate(
                  {
                    vehicleId: vehicle.id,
                    pickupAt,
                    returnAt,
                    services,
                    pickupLocationId: initial?.pickupLocationId,
                  },
                  {
                    onSuccess: (result) => navigate(`/account/bookings/${result.booking.id}`),
                    onError: (error) => setBookingError(error.message),
                  },
                );
              }}
              className="w-full rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600"
            >
              {createBooking.isPending ? 'Creating booking...' : 'Book this vehicle'}
            </button>
          ) : (
            <Link
              to="/login"
              className="block w-full rounded-md bg-slate-900 px-4 py-2.5 text-center text-sm font-medium text-white hover:bg-slate-800"
            >
              Sign in to book
            </Link>
          )}

          <p className="text-center text-xs text-slate-500">
            Payment is taken at the next step (coming with the payment module).
          </p>
        </>
      )}
    </div>
  );
}
