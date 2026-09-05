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
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import PriceBreakdown from './PriceBreakdown';
import { toIso, useAdditionalServices, usePaymentOptions, useQuote } from '../features/booking/useBooking';
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

  // Two pieces of state, not one. `draft` is what the customer is typing;
  // `applied` is what has been sent to the engine. Requoting on every keystroke
  // would fire a request per character and flash a "not valid" error at
  // somebody halfway through typing a perfectly good code.
  const [couponDraft, setCouponDraft] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState('');
  /*
   * A rejected code is remembered SEPARATELY from the quote's error state.
   *
   * The engine refuses the whole quote when a code does not apply - correctly,
   * since it cannot price a booking it was asked to discount. But the panel is
   * gated on `data`, so a customer who mistyped a code watched the price, the
   * availability notice and the Book button all vanish, as though the site had
   * broken. Now the code is dropped from the request and the reason is shown
   * beside the field, leaving the quote intact.
   */
  const [rejectedCoupon, setRejectedCoupon] = useState<{ code: string; reason: string } | null>(null);

  // Which methods are on offer comes from the SERVER, not a constant here.
  // Switching cash off in Settings has to actually remove the option.
  const { data: paymentOptions } = usePaymentOptions();
  const [paymentMethod, setPaymentMethod] = useState<'ONLINE' | 'CASH_ON_PICKUP'>('ONLINE');

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
    // Omit a code the engine has already refused, or every requote would fail
    // again for the same reason and the price would stay hidden.
    couponCode: appliedCoupon && appliedCoupon !== rejectedCoupon?.code ? appliedCoupon : undefined,
  });

  /*
   * Move a coupon failure out of the quote's error state and into its own.
   * Dropping `appliedCoupon` here makes the next render request a quote
   * without it, which succeeds - so the customer keeps their price and gains
   * an explanation, instead of losing both.
   */
  useEffect(() => {
    if (!isError || !appliedCoupon || appliedCoupon === rejectedCoupon?.code) return;

    setRejectedCoupon({ code: appliedCoupon, reason: error.message });
    setAppliedCoupon('');
  }, [isError, error, appliedCoupon, rejectedCoupon]);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-ink-200 bg-white p-5">
        <h3 className="font-semibold text-ink-900">Your rental dates</h3>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-600">Pickup date</span>
            <input
              type="date"
              min={TODAY}
              value={dates.pickupDate}
              onChange={(e) => setDates({ ...dates, pickupDate: e.target.value })}
              className="w-full rounded-md border border-ink-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-600">Pickup time</span>
            <input
              type="time"
              value={dates.pickupTime}
              onChange={(e) => setDates({ ...dates, pickupTime: e.target.value })}
              className="w-full rounded-md border border-ink-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-600">Return date</span>
            <input
              type="date"
              min={dates.pickupDate}
              value={dates.returnDate}
              onChange={(e) => setDates({ ...dates, returnDate: e.target.value })}
              className="w-full rounded-md border border-ink-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-600">Return time</span>
            <input
              type="time"
              value={dates.returnTime}
              onChange={(e) => setDates({ ...dates, returnTime: e.target.value })}
              className="w-full rounded-md border border-ink-300 px-2 py-1.5 text-sm"
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
        <div className="rounded-lg border border-ink-200 bg-white p-5">
          <h3 className="font-semibold text-ink-900">Optional extras</h3>
          <ul className="mt-3 space-y-2">
            {serviceData.services.map((service) => (
              <li key={service.id} className="flex items-center justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium text-ink-800">{service.name}</p>
                  <p className="text-xs text-ink-500">
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
                  className="w-16 rounded-md border border-ink-300 px-2 py-1 text-sm"
                />
              </li>
            ))}
          </ul>
        </div>
      )}

      {/*
        Promo code. The input holds a CODE and nothing else - there is no field
        anywhere in this component for a discount amount, because the amount is
        the server's answer, not the customer's input.
      */}
      <div className="rounded-lg border border-ink-200 bg-white p-5">
        <label htmlFor="couponCode" className="block text-sm font-semibold text-ink-900">
          Promo code
        </label>

        {appliedCoupon && data?.quote.coupon ? (
          <div className="mt-3 flex items-center justify-between rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2">
            <div className="text-sm text-emerald-900">
              <span className="font-mono font-semibold">{data.quote.coupon.code}</span> applied
              <span className="block text-xs">
                {data.quote.coupon.label} - saves {data.quote.currency}{' '}
                {data.quote.coupon.discountAmount}
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setAppliedCoupon('');
                setCouponDraft('');
                setRejectedCoupon(null);
              }}
              className="text-xs font-medium text-emerald-900 underline"
            >
              Remove
            </button>
          </div>
        ) : (
          <div className="mt-3 flex gap-2">
            <input
              id="couponCode"
              value={couponDraft}
              onChange={(event) => {
                setCouponDraft(event.target.value.toUpperCase());
                // Editing the code clears the previous verdict; it no longer
                // describes what is in the box.
                setRejectedCoupon(null);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  setAppliedCoupon(couponDraft.trim());
                }
              }}
              placeholder="Enter a code"
              className="w-full rounded-md border border-ink-300 px-3 py-2 font-mono text-sm uppercase"
            />
            <button
              type="button"
              disabled={!couponDraft.trim()}
              onClick={() => setAppliedCoupon(couponDraft.trim())}
              className="shrink-0 rounded-md border border-ink-300 px-4 py-2 text-sm font-medium text-ink-700 hover:border-ink-400 disabled:opacity-40"
            >
              Apply
            </button>
          </div>
        )}

        {/*
          A refused code returns 400 with a reason - "this code needs a 7-day
          rental" - which is far more use than "invalid code". Shown here
          rather than as a page-level error, next to the field that caused it.
        */}
        {rejectedCoupon && (
          <p className="mt-2 text-sm text-red-700" role="alert">
            {rejectedCoupon.reason}
          </p>
        )}
      </div>

      {/* A genuine quote failure - bad dates, vehicle gone. A refused promo
          code is handled above and never reaches here. */}
      {isError && !appliedCoupon && !rejectedCoupon && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error.message}
        </div>
      )}

      {isPending && datesValid && (
        <div className="h-48 animate-pulse rounded-lg bg-ink-200" />
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

          {/*
            How to pay. Only rendered when there is a real choice - a single
            radio button is a decision the customer does not have.
          */}
          {(paymentOptions?.options.filter((option) => option.available).length ?? 0) > 1 && (
            <fieldset className="rounded-card border border-ink-200 bg-white p-5">
              <legend className="px-1 text-sm font-semibold text-ink-900">How would you like to pay?</legend>

              <div className="mt-2 space-y-2">
                {paymentOptions?.options
                  .filter((option) => option.available)
                  .map((option) => (
                    <label
                      key={option.value}
                      className={
                        paymentMethod === option.value
                          ? 'flex cursor-pointer gap-3 rounded-lg border border-ink-900 bg-ink-50/60 p-3'
                          : 'flex cursor-pointer gap-3 rounded-lg border border-ink-200 p-3 hover:border-ink-300'
                      }
                    >
                      <input
                        type="radio"
                        name="paymentMethod"
                        value={option.value}
                        checked={paymentMethod === option.value}
                        onChange={() => setPaymentMethod(option.value)}
                        className="mt-0.5"
                      />
                      <span>
                        <span className="block text-sm font-medium text-ink-900">{option.label}</span>
                        <span className="block text-xs text-ink-500">{option.detail}</span>
                      </span>
                    </label>
                  ))}
              </div>

              {paymentMethod === 'CASH_ON_PICKUP' && (
                <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  The vehicle is reserved for you now. Bring {data.quote.currency}{' '}
                  {data.quote.totals.totalPayable} in cash - the rental plus the refundable deposit -
                  when you collect it. The keys are handed over once payment is taken.
                </p>
              )}
            </fieldset>
          )}

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
                    // Re-checked server-side here. A code that expired between
                    // the quote and this click is refused at this point.
                    couponCode: appliedCoupon || undefined,
                    paymentMethod,
                  },
                  {
                    onSuccess: (result) => navigate(`/account/bookings/${result.booking.id}`),
                    onError: (error) => setBookingError(error.message),
                  },
                );
              }}
              className="w-full rounded-md bg-ink-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-ink-800 disabled:cursor-not-allowed disabled:bg-ink-300 disabled:text-ink-600"
            >
              {createBooking.isPending ? 'Creating booking...' : 'Book this vehicle'}
            </button>
          ) : (
            <Link
              to="/login"
              className="block w-full rounded-md bg-ink-900 px-4 py-2.5 text-center text-sm font-medium text-white hover:bg-ink-800"
            >
              Sign in to book
            </Link>
          )}

          <p className="text-center text-xs text-ink-500">
            Payment is taken at the next step (coming with the payment module).
          </p>
        </>
      )}
    </div>
  );
}
