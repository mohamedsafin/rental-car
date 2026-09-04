/**
 * pages/CarDetailsPage.tsx
 * ---------------------------------------------------------------------------
 * One vehicle in full (BRD 9): gallery, specification, features, rental terms.
 *
 * The right-hand column is a LIVE quote: pick dates, choose extras, and the
 * backend prices it. It is sticky on desktop, because the page is long and the
 * quote is the reason the customer is on it - scrolling down to read the
 * specification should not scroll the price away.
 *
 * The mileage allowance sits in its own panel rather than buried in the spec
 * grid. It is the single most common source of a disputed charge at return,
 * and a customer who has read it before booking is a customer who is not
 * arguing about it afterwards.
 */
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useVehicle } from '../features/fleet/useFleet';
import QuotePanel from '../components/QuotePanel';
import VehicleArtwork from '../components/VehicleArtwork';
import { PinIcon, SeatIcon, GearIcon, FuelIcon, DoorIcon, ClockIcon } from '../components/icons';

const SPEC_LABELS: Record<string, string> = {
  AUTOMATIC: 'Automatic',
  MANUAL: 'Manual',
  PETROL: 'Petrol',
  DIESEL: 'Diesel',
  HYBRID: 'Hybrid',
  ELECTRIC: 'Electric',
};

function Spec({
  icon: Icon,
  label,
  value,
}: {
  icon?: (props: { className?: string }) => React.ReactElement;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-2.5">
      {Icon && (
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ink-50 text-ink-500">
          <Icon className="h-4 w-4" />
        </span>
      )}
      <div>
        <dt className="text-xs text-ink-500">{label}</dt>
        <dd className="text-sm font-semibold text-ink-900">{value}</dd>
      </div>
    </div>
  );
}

export default function CarDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const { data, isPending, isError, error } = useVehicle(id);
  const [activeImage, setActiveImage] = useState(0);

  // Dates carried over from a search, so someone arriving from results does
  // not have to type them again.
  const carriedDates = {
    pickupDate: searchParams.get('pickupDate') ?? undefined,
    pickupTime: searchParams.get('pickupTime') ?? undefined,
    returnDate: searchParams.get('returnDate') ?? undefined,
    returnTime: searchParams.get('returnTime') ?? undefined,
    pickupLocationId: searchParams.get('pickupLocationId') ?? undefined,
  };

  if (isPending) {
    return (
      <div className="grid animate-pulse gap-8 lg:grid-cols-[3fr_2fr]">
        <div className="aspect-16/10 rounded-card bg-ink-100" />
        <div className="space-y-4">
          <div className="h-8 w-2/3 rounded bg-ink-100" />
          <div className="h-64 rounded-card bg-ink-100" />
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-card border border-red-200 bg-red-50 p-6">
        <h1 className="font-semibold text-red-800">
          {error.status === 404 ? 'Vehicle not found' : 'Could not load this vehicle'}
        </h1>
        <p className="mt-1 text-sm text-red-700">{error.message}</p>
        <Link to="/cars" className="mt-4 inline-block text-sm font-medium text-red-900 underline">
          Back to all cars
        </Link>
      </div>
    );
  }

  const vehicle = data.vehicle;
  const images = vehicle.images;

  return (
    <div className="space-y-10">
      <nav className="text-sm text-ink-500" aria-label="Breadcrumb">
        <Link to="/cars" className="hover:text-ink-900 hover:underline">
          Fleet
        </Link>
        <span className="mx-2 text-ink-300">/</span>
        <Link
          to={`/cars?category=${vehicle.category.slug}`}
          className="hover:text-ink-900 hover:underline"
        >
          {vehicle.category.name}
        </Link>
        <span className="mx-2 text-ink-300">/</span>
        <span className="font-medium text-ink-900">{vehicle.name}</span>
      </nav>

      <div className="grid gap-8 lg:grid-cols-[3fr_2fr]">
        <div>
          <div className="overflow-hidden rounded-card border border-ink-100 bg-white shadow-card">
            <div className="aspect-16/10 bg-ink-50">
              {images.length > 0 ? (
                <img
                  src={images[activeImage]?.url}
                  alt={images[activeImage]?.altText ?? vehicle.name}
                  className="h-full w-full object-cover"
                />
              ) : (
                <VehicleArtwork
                  categorySlug={vehicle.category.slug}
                  doors={vehicle.doors}
                  seats={vehicle.seats}
                  label={vehicle.category.name}
                  className="h-full w-full"
                />
              )}
            </div>
          </div>

          {images.length > 1 && (
            <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
              {images.map((image, index) => (
                <button
                  key={image.id}
                  type="button"
                  onClick={() => setActiveImage(index)}
                  aria-label={`Show image ${index + 1}`}
                  aria-current={index === activeImage}
                  className={
                    index === activeImage
                      ? 'h-16 w-24 shrink-0 overflow-hidden rounded-lg ring-2 ring-ink-900'
                      : 'h-16 w-24 shrink-0 overflow-hidden rounded-lg ring-1 ring-ink-200 transition hover:ring-ink-400'
                  }
                >
                  <img src={image.url} alt={image.altText} className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}

          <div className="mt-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-ink-900 sm:text-3xl">
                  {vehicle.name}
                </h1>
                <p className="mt-1.5 text-sm text-ink-500">
                  {vehicle.year} · {vehicle.category.name}
                  {vehicle.color ? ` · ${vehicle.color}` : ''}
                </p>
              </div>
              {vehicle.isFeatured && (
                <span className="rounded-full bg-accent-100 px-3 py-1 text-xs font-semibold text-accent-700">
                  Featured
                </span>
              )}
            </div>

            {vehicle.location && (
              <p className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-sm text-ink-600 ring-1 ring-ink-100">
                <PinIcon className="h-4 w-4 text-ink-400" />
                Collect from <span className="font-medium text-ink-900">{vehicle.location.name}</span>
              </p>
            )}
          </div>
        </div>

        {/* Sticky on desktop: the quote is why the page exists, and reading
            the specification below should not scroll the price out of view. */}
        <div className="lg:sticky lg:top-24 lg:self-start">
          <QuotePanel vehicle={vehicle} initial={carriedDates} />
        </div>
      </div>

      <section>
        <h2 className="text-lg font-bold tracking-tight text-ink-900">Specification</h2>
        <dl className="mt-4 grid gap-5 rounded-card border border-ink-100 bg-white p-5 sm:grid-cols-2 lg:grid-cols-3">
          <Spec icon={SeatIcon} label="Seats" value={String(vehicle.seats)} />
          <Spec icon={DoorIcon} label="Doors" value={String(vehicle.doors)} />
          <Spec
            icon={GearIcon}
            label="Transmission"
            value={SPEC_LABELS[vehicle.transmission] ?? vehicle.transmission}
          />
          <Spec
            icon={FuelIcon}
            label="Fuel type"
            value={SPEC_LABELS[vehicle.fuelType] ?? vehicle.fuelType}
          />
          <Spec icon={ClockIcon} label="Model year" value={String(vehicle.year)} />
          <Spec icon={PinIcon} label="Category" value={vehicle.category.name} />
        </dl>
      </section>

      {/*
        Mileage in its own panel, not buried in the grid above. Excess mileage
        is the most commonly disputed charge at return; showing the allowance
        and the excess rate before booking is what makes that charge fair.
      */}
      <section className="rounded-card border border-ink-100 bg-white p-5">
        <h2 className="text-lg font-bold tracking-tight text-ink-900">Mileage allowance</h2>
        {vehicle.mileage.limitPerDay ? (
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-600">
            <span className="font-semibold text-ink-900">
              {vehicle.mileage.limitPerDay} km per day
            </span>{' '}
            included.
            {vehicle.mileage.extraCharge ? (
              <>
                {' '}
                Beyond that, {vehicle.pricing.currency} {vehicle.mileage.extraCharge} per
                extra kilometre, calculated from the odometer readings taken at handover and return.
              </>
            ) : (
              ' The charge for extra kilometres is confirmed at handover.'
            )}
          </p>
        ) : (
          <p className="mt-2 text-sm text-ink-600">
            <span className="font-semibold text-ink-900">Unlimited mileage</span> on this vehicle.
          </p>
        )}
      </section>

      {vehicle.features.length > 0 && (
        <section>
          <h2 className="text-lg font-bold tracking-tight text-ink-900">Features</h2>
          <ul className="mt-4 flex flex-wrap gap-2">
            {vehicle.features.map((feature) => (
              <li
                key={feature.id}
                className="rounded-full border border-ink-200 bg-white px-3.5 py-1.5 text-sm text-ink-700"
              >
                {feature.name}
              </li>
            ))}
          </ul>
        </section>
      )}

      {vehicle.description && (
        <section>
          <h2 className="text-lg font-bold tracking-tight text-ink-900">About this vehicle</h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-600">
            {vehicle.description}
          </p>
        </section>
      )}
    </div>
  );
}
