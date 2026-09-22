/**
 * pages/NewBookingPage.tsx
 * ---------------------------------------------------------------------------
 * Booking for the person at the counter.
 *
 * ===========================================================================
 * THE GAP THIS FILLS
 * ===========================================================================
 * Every other screen in this app acts on a booking a customer already made on
 * the website. There was no way to make one. A walk-in had to be talked
 * through signing up on their own phone, or booked under a staff account -
 * which then puts a member of staff's name on the rental agreement, the
 * invoice and any fine that follows.
 *
 * So the page runs in the order the conversation actually happens: who is it
 * for, when do they want it, which car, and what does that come to. Each step
 * unlocks the next, because a vehicle list means nothing before there are
 * dates to check it against.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, UserPlus } from 'lucide-react';
import { useCustomers } from '../features/customer/useCustomerAdmin';
import {
  useAvailableVehicles,
  useCreateBookingForCustomer,
  useQuote,
} from '../features/counter/useCounter';
import NewCustomerForm from '../components/NewCustomerForm';

/** `datetime-local` gives "2026-09-18T10:00"; the API wants a real instant. */
const toIso = (local: string): string | undefined =>
  local ? new Date(local).toISOString() : undefined;

/** Today at 10:00, rounded sensibly - most counter rentals start now-ish. */
function defaultPickup(): string {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d.toISOString().slice(0, 16);
}

function defaultReturn(): string {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  d.setDate(d.getDate() + 3);
  return d.toISOString().slice(0, 16);
}

export default function NewBookingPage() {
  const navigate = useNavigate();

  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customerLabel, setCustomerLabel] = useState('');
  const [search, setSearch] = useState('');
  const [creatingCustomer, setCreatingCustomer] = useState(false);

  const [pickupLocal, setPickupLocal] = useState(defaultPickup);
  const [returnLocal, setReturnLocal] = useState(defaultReturn);
  const [vehicleSearch, setVehicleSearch] = useState('');
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'ONLINE' | 'CASH_ON_PICKUP'>('CASH_ON_PICKUP');
  const [staffNotes, setStaffNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const pickupAt = toIso(pickupLocal);
  const returnAt = toIso(returnLocal);
  const datesValid = Boolean(pickupAt && returnAt && new Date(returnLocal) > new Date(pickupLocal));

  const customers = useCustomers({ page: 1, limit: 8, search: search || undefined });
  const vehicles = useAvailableVehicles({
    pickupAt: datesValid ? pickupAt : undefined,
    returnAt: datesValid ? returnAt : undefined,
    search: vehicleSearch,
  });
  const quote = useQuote({
    vehicleId: vehicleId ?? undefined,
    pickupAt: datesValid ? pickupAt : undefined,
    returnAt: datesValid ? returnAt : undefined,
  });
  const createBooking = useCreateBookingForCustomer();

  const chosenVehicle = useMemo(
    () => vehicles.data?.items.find((v) => v.id === vehicleId) ?? null,
    [vehicles.data, vehicleId],
  );

  const ready = Boolean(customerId && vehicleId && datesValid);

  function submit() {
    if (!ready || !customerId || !vehicleId || !pickupAt || !returnAt) return;
    setError(null);

    createBooking.mutate(
      {
        customerId,
        vehicleId,
        pickupAt,
        returnAt,
        paymentMethod,
        staffNotes: staffNotes.trim() || undefined,
      },
      {
        onSuccess: (result) => navigate(`/bookings/${result.booking.id}`),
        onError: (err) => setError(err.message),
      },
    );
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">New booking</h2>
        <p className="text-sm text-slate-600">
          For a customer at the counter or on the phone. The booking is created in their name, not
          yours.
        </p>
      </div>

      {error && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* --- 1. Who is it for --------------------------------------------- */}
      <section className="card p-5">
        <Step n={1} title="Who is it for?" />

        {customerId ? (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span className="badge badge-positive">{customerLabel}</span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setCustomerId(null);
                setCustomerLabel('');
              }}
            >
              Change
            </button>
          </div>
        ) : creatingCustomer ? (
          <NewCustomerForm
            onCancel={() => setCreatingCustomer(false)}
            onCreated={(customer) => {
              setCustomerId(customer.user.id);
              setCustomerLabel(`${customer.user.fullName} · ${customer.user.email}`);
              setCreatingCustomer(false);
            }}
          />
        ) : (
          <div className="mt-3 space-y-3">
            <div className="flex flex-wrap gap-2">
              <div className="relative flex-1 min-w-[240px]">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                  aria-hidden
                />
                <input
                  className="input pl-9"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by name, email or phone"
                />
              </div>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => setCreatingCustomer(true)}
              >
                <UserPlus className="h-4 w-4" aria-hidden />
                New customer
              </button>
            </div>

            {search.length >= 2 && (
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {customers.data?.items.map((customer) => (
                  <li key={customer.id}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-slate-50"
                      onClick={() => {
                        setCustomerId(customer.userId);
                        setCustomerLabel(`${customer.user.fullName} · ${customer.user.email}`);
                      }}
                    >
                      <span>
                        <span className="block text-sm font-medium text-slate-900">
                          {customer.user.fullName}
                        </span>
                        <span className="block text-xs text-slate-500">{customer.user.email}</span>
                      </span>
                      {!customer.isVerified && (
                        <span className="badge badge-caution">Documents not verified</span>
                      )}
                    </button>
                  </li>
                ))}
                {customers.data?.items.length === 0 && (
                  <li className="px-3 py-3 text-sm text-slate-500">
                    Nobody matches that. Create them instead.
                  </li>
                )}
              </ul>
            )}
          </div>
        )}
      </section>

      {/* --- 2. When ------------------------------------------------------ */}
      <section className="card p-5">
        <Step n={2} title="When do they need it?" />
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs text-slate-500">Collection</span>
            <input
              type="datetime-local"
              className="input mt-1"
              value={pickupLocal}
              onChange={(e) => {
                setPickupLocal(e.target.value);
                setVehicleId(null);
              }}
            />
          </label>
          <label className="block">
            <span className="text-xs text-slate-500">Return</span>
            <input
              type="datetime-local"
              className="input mt-1"
              value={returnLocal}
              onChange={(e) => {
                setReturnLocal(e.target.value);
                setVehicleId(null);
              }}
            />
          </label>
        </div>
        {!datesValid && (
          <p className="mt-2 text-sm text-amber-700">The return has to be after the collection.</p>
        )}
      </section>

      {/* --- 3. Which car ------------------------------------------------- */}
      <section className="card p-5">
        <Step n={3} title="Which car is free?" />

        {!datesValid ? (
          <p className="mt-3 text-sm text-slate-500">Set the dates first.</p>
        ) : (
          <>
            <input
              className="input mt-3"
              value={vehicleSearch}
              onChange={(e) => setVehicleSearch(e.target.value)}
              placeholder="Filter by make, model or plate"
            />

            {vehicles.isPending && <div className="skeleton mt-3 h-24 rounded-lg" />}

            {vehicles.data && vehicles.data.items.length === 0 && (
              <p className="mt-3 text-sm text-slate-500">
                Nothing in the fleet is free for those dates.
              </p>
            )}

            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {vehicles.data?.items.map((vehicle) => {
                const selected = vehicle.id === vehicleId;
                return (
                  <button
                    key={vehicle.id}
                    type="button"
                    onClick={() => setVehicleId(vehicle.id)}
                    className={`rounded-lg border p-3 text-left transition ${
                      selected
                        ? 'border-slate-900 bg-slate-50'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <span className="block text-sm font-medium text-slate-900">
                      {vehicle.brand} {vehicle.model} ({vehicle.year})
                    </span>
                    <span className="block text-xs text-slate-500">
                      {vehicle.registrationNumber ?? 'No plate recorded'} · {vehicle.dailyPrice}/day
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </section>

      {/* --- 4. Confirm --------------------------------------------------- */}
      <section className="card p-5">
        <Step n={4} title="What does it come to?" />

        {!ready ? (
          <p className="mt-3 text-sm text-slate-500">
            Pick a customer, dates and a car to see the price.
          </p>
        ) : quote.isPending ? (
          <div className="skeleton mt-3 h-24 rounded-lg" />
        ) : quote.data ? (
          <>
            <dl className="mt-3 space-y-2 text-sm">
              <Row
                label={`${chosenVehicle?.brand} ${chosenVehicle?.model} · ${quote.data.quote.period.rentalDays} day(s)`}
                value={`${quote.data.quote.currency} ${quote.data.quote.totals.vehicleSubtotal}`}
              />
              {quote.data.quote.totals.taxAmount !== '0.00' && (
                <Row
                  label="VAT"
                  value={`${quote.data.quote.currency} ${quote.data.quote.totals.taxAmount}`}
                />
              )}
              <div className="flex justify-between border-t border-slate-200 pt-2 font-semibold">
                <dt>Rental total</dt>
                <dd>
                  {quote.data.quote.currency} {quote.data.quote.totals.rentalTotal}
                </dd>
              </div>
              <Row
                label="Refundable deposit"
                value={`${quote.data.quote.currency} ${quote.data.quote.totals.securityDeposit}`}
              />
            </dl>

            {quote.data.quote.warnings.map((warning) => (
              <p key={warning} className="mt-2 text-sm text-amber-700">
                {warning}
              </p>
            ))}

            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="text-xs text-slate-500">How are they paying?</span>
                <select
                  className="input mt-1 max-w-xs"
                  value={paymentMethod}
                  onChange={(e) =>
                    setPaymentMethod(e.target.value as 'ONLINE' | 'CASH_ON_PICKUP')
                  }
                >
                  <option value="CASH_ON_PICKUP">At the counter</option>
                  <option value="ONLINE">Online</option>
                </select>
              </label>

              <label className="block">
                <span className="text-xs text-slate-500">Counter notes (staff only)</span>
                <textarea
                  rows={2}
                  className="input mt-1"
                  value={staffNotes}
                  onChange={(e) => setStaffNotes(e.target.value)}
                  placeholder="Anything worth recording about this booking"
                />
              </label>

              <button
                type="button"
                className="btn btn-primary"
                disabled={createBooking.isPending}
                onClick={submit}
              >
                {createBooking.isPending ? 'Creating…' : 'Create the booking'}
              </button>

              <p className="text-xs text-slate-500">
                If the customer’s documents are not verified yet, the booking is created and held
                for verification rather than confirmed. That is the rule working, not a failure.
              </p>
            </div>
          </>
        ) : (
          <p className="mt-3 text-sm text-red-700">{quote.error?.message}</p>
        )}
      </section>
    </div>
  );
}

function Step({ n, title }: { n: number; title: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">
        {n}
      </span>
      <h3 className="section-title">{title}</h3>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-slate-600">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
