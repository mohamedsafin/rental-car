/**
 * components/QuotePanel.tsx
 * ---------------------------------------------------------------------------
 * Date pickers, optional extras, and the live price for one vehicle.
 *
 * Every change re-asks the BACKEND for the price. That looks chatty, and it
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
 *
 * One panel with hairline-separated sections, rather than the five stacked
 * boxes it used to be: the quote reads as a single decision, top to bottom.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, CircleAlert, CircleCheck, Minus, Plus } from 'lucide-react';
import PriceBreakdown from './PriceBreakdown';
import DateOfBirthPrompt from './DateOfBirthPrompt';
import { toIso, useAdditionalServices, usePaymentOptions, useQuote } from '../features/booking/useBooking';
import { useCreateBooking } from '../features/bookings/useBookings';
import { useAuth } from '../hooks/useAuth';
import { displayMoney } from '../utils/displayMoney';
import type { Vehicle } from '../types/vehicle';

function dateOffset(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * The same day of the month, N months on - clamped to the end of a short one.
 *
 * 31 January + 1 month is 28 February, not 3 March. This mirrors the rule the
 * backend bills by, so the dates the customer picks here and the months they
 * are charged for cannot disagree.
 */
function monthOffset(months: number, from: string): string {
  const start = new Date(`${from}T00:00:00`);
  const day = start.getDate();
  const shifted = new Date(start);
  shifted.setDate(1);
  shifted.setMonth(shifted.getMonth() + months);
  const lastDay = new Date(shifted.getFullYear(), shifted.getMonth() + 1, 0).getDate();
  shifted.setDate(Math.min(day, lastDay));
  return shifted.toISOString().slice(0, 10);
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

/** One titled block of the panel, separated from the one above by a hairline. */
function Section({ title, labelFor, children }: { title: string; labelFor?: string; children: ReactNode }) {
  const titleClass = 'block text-[13px] font-semibold uppercase tracking-[0.12em] text-ink-500';
  return (
    <div className="mt-6 border-t border-ink-100 pt-6">
      {labelFor ? (
        <label htmlFor={labelFor} className={titleClass}>
          {title}
        </label>
      ) : (
        <h3 className={titleClass}>{title}</h3>
      )}
      <div className="mt-4">{children}</div>
    </div>
  );
}

export default function QuotePanel({ vehicle, initial }: QuotePanelProps) {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const createBooking = useCreateBooking();
  const [bookingError, setBookingError] = useState<string | null>(null);
  /*
   * The one refusal that is not really an error: the customer has done nothing
   * wrong, we simply never asked for their date of birth. Held separately so
   * it can be answered here rather than shown as a red wall.
   */
  const [needsDateOfBirth, setNeedsDateOfBirth] = useState<number | null>(null);

  const [dates, setDates] = useState({
    pickupDate: initial?.pickupDate || dateOffset(1),
    pickupTime: initial?.pickupTime || '10:00',
    returnDate: initial?.returnDate || dateOffset(4),
    returnTime: initial?.returnTime || '10:00',
  });

  /*
   * Daily or monthly.
   *
   * Not a cosmetic toggle: it decides `billingCycle`, and therefore whether
   * the customer is asked for the whole term before collection or one month
   * at a time. Monthly also takes over the return date, because "3 months"
   * and "a return date 91 days away" are the same thing said two ways, and
   * letting the customer set both invites them to disagree.
   */
  const [mode, setMode] = useState<'DAILY' | 'MONTHLY'>('DAILY');
  const [months, setMonths] = useState(1);

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
  // On a monthly rental the return date is derived, so the term and the dates
  // are always the same statement.
  const effectiveReturnDate =
    mode === 'MONTHLY' ? monthOffset(months, dates.pickupDate) : dates.returnDate;
  const returnAt = toIso(effectiveReturnDate, dates.returnTime);
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

  const availableMethods = paymentOptions?.options.filter((option) => option.available) ?? [];

  /*
   * Placing the booking, and the one refusal worth handling specially.
   *
   * The server asks for a date of birth when a minimum driving age is set and
   * the customer has none on file. That is not a mistake they made - nothing
   * ever asked them - so it becomes an inline field here instead of a red
   * error pointing at a profile page.
   */
  function book() {
    createBooking.mutate(
      {
        vehicleId: vehicle.id,
        pickupAt,
        returnAt,
        services,
        pickupLocationId: initial?.pickupLocationId,
        // Re-checked server-side here. A code that expired between the quote
        // and this click is refused at this point.
        couponCode: appliedCoupon || undefined,
        paymentMethod,
        billingCycle: mode === 'MONTHLY' ? 'MONTHLY' : 'UPFRONT',
      },
      {
        onSuccess: (result) => navigate(`/account/bookings/${result.booking.id}`),
        onError: (error) => {
          const message = error.message;

          // Matched on the server's own words, and the age is read out of
          // them, so the two can never quote different numbers.
          if (/date of birth/i.test(message)) {
            const age = /at least (\d+)/.exec(message);
            setNeedsDateOfBirth(age ? Number(age[1]) : null);
            return;
          }

          setBookingError(message);
        },
      },
    );
  }

  return (
    <div className="rounded-[20px] border border-ink-100 bg-white p-5 shadow-card sm:p-7">
      {/* The listed rate, for orientation. The quote below is the real price. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="tabular text-ink-950">
          <span className="text-sm font-medium text-ink-500">{vehicle.pricing.currency}</span>{' '}
          <span className="text-[2rem] font-semibold leading-none tracking-tight">
            {displayMoney(vehicle.pricing.daily)}
          </span>{' '}
          <span className="text-sm font-medium text-ink-500">/ day</span>
        </p>
        <p className="tabular text-[13px] text-ink-500">
          + {vehicle.pricing.currency} {displayMoney(vehicle.pricing.securityDeposit)} refundable deposit
        </p>
      </div>

      {/*
        Daily or monthly, before anything else.
        --------------------------------------------------------------------
        It comes first because it changes what the rest of the panel means:
        the price shown, the dates asked for, and - most of all - what the
        customer is asked to pay at checkout. A monthly customer pays one
        month; a daily one pays the lot.

        The monthly rate is only offered where the vehicle HAS one. Showing
        the choice on a car with no monthly price would quote the daily rate
        thirty times over and call it a monthly deal.
      */}
      {vehicle.pricing.monthly && Number(vehicle.pricing.monthly) > 0 && (
        <Section title="How long do you need it?">
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="Rental type">
            {(
              [
                ['DAILY', 'By the day', `${vehicle.pricing.currency} ${displayMoney(vehicle.pricing.daily)} / day`],
                ['MONTHLY', 'By the month', `${vehicle.pricing.currency} ${displayMoney(vehicle.pricing.monthly)} / month`],
              ] as const
            ).map(([value, label, rate]) => (
              <button
                key={value}
                type="button"
                aria-pressed={mode === value}
                onClick={() => setMode(value)}
                className={`rounded-xl border p-3 text-left transition-colors ${
                  mode === value
                    ? 'border-accent-500 bg-accent-50'
                    : 'border-ink-200 hover:border-ink-300'
                }`}
              >
                <span className="block text-sm font-semibold text-ink-950">{label}</span>
                <span className="tabular mt-0.5 block text-xs text-ink-500">{rate}</span>
              </button>
            ))}
          </div>

          {mode === 'MONTHLY' && (
            <div className="mt-3">
              <label className="block">
                <span className="field-label">How many months?</span>
                <select
                  value={months}
                  onChange={(event) => setMonths(Number(event.target.value))}
                  className="field-control px-3 text-sm"
                >
                  {[1, 2, 3, 4, 5, 6, 9, 12].map((count) => (
                    <option key={count} value={count}>
                      {count} {count === 1 ? 'month' : 'months'}
                    </option>
                  ))}
                </select>
              </label>
              <p className="mt-2 text-xs leading-relaxed text-ink-500">
                {/*
                  The reassurance that matters on a long term: they are not
                  being asked for the whole thing today.
                */}
                Pay one month at a time. The first month and the deposit are due
                now; each later month is due on the day it starts.
              </p>
            </div>
          )}
        </Section>
      )}

      <Section title="Your rental dates">
        <div className="grid grid-cols-2 gap-3">
          <label className="block min-w-0">
            <span className="field-label">Pick-up date</span>
            <input
              type="date"
              min={TODAY}
              value={dates.pickupDate}
              onChange={(e) => setDates({ ...dates, pickupDate: e.target.value })}
              className="field-control px-3 text-sm"
            />
          </label>
          <label className="block min-w-0">
            <span className="field-label">Pick-up time</span>
            <input
              type="time"
              value={dates.pickupTime}
              onChange={(e) => setDates({ ...dates, pickupTime: e.target.value })}
              className="field-control px-3 text-sm"
            />
          </label>
          <label className="block min-w-0">
            <span className="field-label">Return date</span>
            <input
              type="date"
              min={dates.pickupDate}
              value={effectiveReturnDate}
              // Derived from the term on a monthly rental. Editable here AND
              // set by the month count would be two controls fighting over one
              // value, and the customer would win an argument with themselves.
              readOnly={mode === 'MONTHLY'}
              onChange={(e) => setDates({ ...dates, returnDate: e.target.value })}
              className={`field-control px-3 text-sm ${mode === 'MONTHLY' ? 'bg-ink-50 text-ink-500' : ''}`}
            />
          </label>
          <label className="block min-w-0">
            <span className="field-label">Return time</span>
            <input
              type="time"
              value={dates.returnTime}
              onChange={(e) => setDates({ ...dates, returnTime: e.target.value })}
              className="field-control px-3 text-sm"
            />
          </label>
        </div>

        {!datesValid && (
          <p role="alert" className="mt-3 text-sm font-medium text-red-700">
            Return must be after pickup.
          </p>
        )}
      </Section>

      {serviceData && serviceData.services.length > 0 && (
        <Section title="Optional extras">
          <ul className="space-y-3">
            {serviceData.services.map((service) => {
              const quantity = selected[service.id] ?? 0;
              const max = service.maxQuantity ?? 99;
              return (
                <li key={service.id} className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink-950">{service.name}</p>
                    <p className="tabular text-xs text-ink-500">
                      {vehicle.pricing.currency} {service.price}
                      {service.chargeType === 'PER_DAY' ? ' per day' : ' one-off'}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center rounded-full border border-ink-200">
                    <button
                      type="button"
                      aria-label={`Remove one ${service.name}`}
                      disabled={quantity <= 0}
                      onClick={() => setSelected({ ...selected, [service.id]: Math.max(0, quantity - 1) })}
                      className="flex h-9 w-9 items-center justify-center rounded-full text-ink-700 transition-colors hover:bg-ink-50 disabled:opacity-30"
                    >
                      <Minus aria-hidden className="h-3.5 w-3.5" />
                    </button>
                    <span className="tabular w-6 text-center text-sm font-semibold text-ink-950" aria-live="polite">
                      {quantity}
                    </span>
                    <button
                      type="button"
                      aria-label={`Add one ${service.name}`}
                      disabled={quantity >= max}
                      onClick={() => setSelected({ ...selected, [service.id]: Math.min(max, quantity + 1) })}
                      className="flex h-9 w-9 items-center justify-center rounded-full text-ink-700 transition-colors hover:bg-ink-50 disabled:opacity-30"
                    >
                      <Plus aria-hidden className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {/*
        Promo code. The input holds a CODE and nothing else - there is no field
        anywhere in this component for a discount amount, because the amount is
        the server's answer, not the customer's input.
      */}
      <Section title="Promo code" labelFor="couponCode">
        {appliedCoupon && data?.quote.coupon ? (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
            <div className="text-sm text-emerald-900">
              <span className="font-mono font-semibold">{data.quote.coupon.code}</span> applied
              <span className="block text-xs">
                {data.quote.coupon.label} - saves {data.quote.currency} {data.quote.coupon.discountAmount}
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setAppliedCoupon('');
                setCouponDraft('');
                setRejectedCoupon(null);
              }}
              className="text-xs font-semibold text-emerald-900 underline underline-offset-2"
            >
              Remove
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
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
              className="field-control font-mono text-sm uppercase"
            />
            <button
              type="button"
              disabled={!couponDraft.trim()}
              onClick={() => setAppliedCoupon(couponDraft.trim())}
              className="btn btn-outline shrink-0"
            >
              Apply
            </button>
          </div>
        )}

        {/*
          A refused code returns 400 with a reason - "this code needs a 7-day
          rental" - which is far more use than "invalid code". Shown here,
          next to the field that caused it.
        */}
        {rejectedCoupon && (
          <p className="mt-2 text-sm text-red-700" role="alert">
            {rejectedCoupon.reason}
          </p>
        )}
      </Section>

      {/* A genuine quote failure - bad dates, vehicle gone. A refused promo
          code is handled above and never reaches here. */}
      {isError && !appliedCoupon && !rejectedCoupon && (
        <div role="alert" className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error.message}
        </div>
      )}

      {isPending && datesValid && (
        <div className="mt-6 h-48 animate-pulse rounded-2xl bg-ink-100" aria-hidden />
      )}

      {data && (
        <div className="mt-6 space-y-4 border-t border-ink-100 pt-6">
          {data.availability.available ? (
            <p className="flex items-center gap-2 text-sm font-medium text-emerald-800">
              <CircleCheck aria-hidden className="h-4 w-4 text-emerald-600" />
              Available for these dates
            </p>
          ) : (
            <p role="alert" className="flex items-start gap-2 text-sm font-medium text-amber-900">
              <CircleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              {data.availability.reason ?? 'Not available for these dates.'}
            </p>
          )}

          <PriceBreakdown
              quote={data.quote}
              monthly={mode === 'MONTHLY' ? { months } : null}
            />

          {/*
            How to pay. Only rendered when there is a real choice - a single
            radio button is a decision the customer does not have.
          */}
          {availableMethods.length > 1 && (
            <fieldset>
              <legend className="text-[13px] font-semibold uppercase tracking-[0.12em] text-ink-500">
                How would you like to pay?
              </legend>

              <div className="mt-3 space-y-2">
                {availableMethods.map((option) => (
                  <label
                    key={option.value}
                    className={`flex cursor-pointer gap-3 rounded-xl border p-3.5 transition-colors ${
                      paymentMethod === option.value
                        ? 'border-ink-950 bg-ink-50/60'
                        : 'border-ink-200 hover:border-ink-400'
                    }`}
                  >
                    <input
                      type="radio"
                      name="paymentMethod"
                      value={option.value}
                      checked={paymentMethod === option.value}
                      onChange={() => setPaymentMethod(option.value)}
                      className="mt-0.5 accent-ink-950"
                    />
                    <span>
                      <span className="block text-sm font-medium text-ink-950">{option.label}</span>
                      <span className="block text-xs text-ink-500">{option.detail}</span>
                    </span>
                  </label>
                ))}
              </div>

              {paymentMethod === 'CASH_ON_PICKUP' && (
                <p className="mt-3 rounded-xl bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900">
                  The vehicle is reserved for you now. Bring {data.quote.currency}{' '}
                  {data.quote.totals.totalPayable} in cash - the rental plus the refundable deposit -
                  when you collect it. The keys are handed over once payment is taken.
                </p>
              )}
            </fieldset>
          )}

          {bookingError && (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm text-red-700">
              {bookingError}
            </div>
          )}

          {/*
            Asked here, with the dates and the price still on screen. Saving it
            retries the booking straight away, so answering costs one field and
            not a trip to another page.
          */}
          {needsDateOfBirth !== null && (
            <DateOfBirthPrompt
              minimumAge={needsDateOfBirth}
              onSaved={() => {
                setNeedsDateOfBirth(null);
                book();
              }}
            />
          )}

          {isAuthenticated ? (
            <button
              type="button"
              disabled={!data.availability.available || createBooking.isPending}
              onClick={() => {
                setBookingError(null);
                setNeedsDateOfBirth(null);
                book();
              }}
              className="btn btn-accent btn-lg w-full"
            >
              {createBooking.isPending
                ? 'Creating booking…'
                : data.availability.available
                  ? 'Book this vehicle'
                  : 'Not available for these dates'}
              {data.availability.available && !createBooking.isPending && (
                <ArrowRight aria-hidden className="btn-arrow h-4 w-4" />
              )}
            </button>
          ) : (
            // Sends them back to THIS car after signing in, via the same
            // `state.from` the route guard uses.
            <Link
              to="/login"
              state={{ from: { pathname: `/cars/${vehicle.id}` } }}
              className="btn btn-accent btn-lg w-full"
            >
              Sign in to book
              <ArrowRight aria-hidden className="btn-arrow h-4 w-4" />
            </Link>
          )}

          {/*
            The reason sits BESIDE the button, not only in the notice at the
            top. On a long page the customer scrolls straight past that notice,
            reaches a greyed-out button with nothing next to it, and concludes
            the site is broken - which is what happened.
          */}
          {!data.availability.available && (
            <p className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-sm text-amber-900">
              {data.availability.reason ?? 'This vehicle is not free for the dates you picked.'} Change
              the dates above, or{' '}
              <Link to="/search" className="font-semibold underline underline-offset-2">
                see what is free
              </Link>
              .
            </p>
          )}

          <p className="text-center text-xs text-ink-500">
            {paymentMethod === 'CASH_ON_PICKUP'
              ? 'You will pay in cash when you collect the vehicle.'
              : 'You will be taken to secure payment at the next step.'}
          </p>
        </div>
      )}
    </div>
  );
}
