/**
 * pages/CarDetailsPage.tsx
 * ---------------------------------------------------------------------------
 * One vehicle in full (BRD 9): gallery, specification, features, rental terms.
 *
 * The "Book now" button is deliberately disabled. Booking needs the
 * availability engine (Phase 4) and the booking module (Phase 6) - and a button
 * that looks live but silently does nothing is worse than one that says so.
 */
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useVehicle } from '../features/fleet/useFleet';

const SPEC_LABELS: Record<string, string> = {
  AUTOMATIC: 'Automatic',
  MANUAL: 'Manual',
  PETROL: 'Petrol',
  DIESEL: 'Diesel',
  HYBRID: 'Hybrid',
  ELECTRIC: 'Electric',
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-slate-600">{label}</dt>
      <dd className="font-medium text-slate-900">{value}</dd>
    </div>
  );
}

function Spec({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-sm font-medium text-slate-900">{value}</dd>
    </div>
  );
}

export default function CarDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isPending, isError, error } = useVehicle(id);
  const [activeImage, setActiveImage] = useState(0);

  if (isPending) {
    return <div className="h-96 animate-pulse rounded-lg bg-slate-200" />;
  }

  if (isError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6">
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
  const currency = vehicle.pricing.currency;
  const images = vehicle.images;

  return (
    <div className="space-y-8">
      <nav className="text-sm text-slate-500">
        <Link to="/cars" className="hover:underline">
          Fleet
        </Link>
        <span className="mx-2">/</span>
        <span className="text-slate-900">{vehicle.name}</span>
      </nav>

      <div className="grid gap-8 lg:grid-cols-[3fr_2fr]">
        <div>
          <div className="aspect-[4/3] overflow-hidden rounded-lg bg-slate-100">
            {images.length > 0 ? (
              <img
                src={images[activeImage]?.url}
                alt={images[activeImage]?.altText ?? vehicle.name}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-slate-400">
                No images yet
              </div>
            )}
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
                      ? 'h-16 w-20 shrink-0 overflow-hidden rounded-md ring-2 ring-slate-900'
                      : 'h-16 w-20 shrink-0 overflow-hidden rounded-md ring-1 ring-slate-200'
                  }
                >
                  <img src={image.url} alt={image.altText} className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <h1 className="text-2xl font-bold text-slate-900">{vehicle.name}</h1>
          <p className="mt-1 text-sm text-slate-600">
            {vehicle.year} - {vehicle.category.name}
            {vehicle.color ? ` - ${vehicle.color}` : ''}
          </p>

          <div className="mt-5 rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-2xl font-bold text-slate-900">
              {currency} {vehicle.pricing.daily}
              <span className="ml-1 text-sm font-normal text-slate-500">/ day</span>
            </p>

            <dl className="mt-3 space-y-1 text-sm">
              {vehicle.pricing.weekly && (
                <Row label="Weekly rate" value={`${currency} ${vehicle.pricing.weekly}`} />
              )}
              {vehicle.pricing.monthly && (
                <Row label="Monthly rate" value={`${currency} ${vehicle.pricing.monthly}`} />
              )}
              <Row label="Security deposit" value={`${currency} ${vehicle.pricing.securityDeposit}`} />
              <Row
                label="Mileage"
                value={vehicle.mileage.limitPerDay ? `${vehicle.mileage.limitPerDay} km/day` : 'Unlimited'}
              />
              {vehicle.mileage.extraCharge && (
                <Row label="Extra mileage" value={`${currency} ${vehicle.mileage.extraCharge} / km`} />
              )}
            </dl>

            <button
              type="button"
              disabled
              title="Booking opens once the availability and booking modules are built"
              className="mt-4 w-full cursor-not-allowed rounded-md bg-slate-300 px-4 py-2 text-sm font-medium text-slate-600"
            >
              Book now
            </button>
            <p className="mt-2 text-center text-xs text-slate-500">Booking opens in a later phase</p>
          </div>

          {vehicle.location && (
            <p className="mt-3 text-sm text-slate-600">
              Available from <span className="font-medium">{vehicle.location.name}</span>
            </p>
          )}
        </div>
      </div>

      <section>
        <h2 className="font-semibold text-slate-900">Specification</h2>
        <dl className="mt-3 grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-3">
          <Spec label="Seats" value={String(vehicle.seats)} />
          <Spec label="Doors" value={String(vehicle.doors)} />
          <Spec label="Transmission" value={SPEC_LABELS[vehicle.transmission] ?? vehicle.transmission} />
          <Spec label="Fuel type" value={SPEC_LABELS[vehicle.fuelType] ?? vehicle.fuelType} />
          <Spec label="Model year" value={String(vehicle.year)} />
          <Spec label="Category" value={vehicle.category.name} />
        </dl>
      </section>

      {vehicle.features.length > 0 && (
        <section>
          <h2 className="font-semibold text-slate-900">Features</h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {vehicle.features.map((feature) => (
              <li
                key={feature.id}
                className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm text-slate-700"
              >
                {feature.name}
              </li>
            ))}
          </ul>
        </section>
      )}

      {vehicle.description && (
        <section>
          <h2 className="font-semibold text-slate-900">About this vehicle</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-700">{vehicle.description}</p>
        </section>
      )}
    </div>
  );
}
