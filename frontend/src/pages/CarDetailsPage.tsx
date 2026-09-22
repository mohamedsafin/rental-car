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
 * On phones the quote comes straight after the gallery rather than after the
 * whole specification, via grid placement: the page's first job is "can I have
 * it, and for how much", and the spec is supporting detail.
 *
 * The mileage allowance gets its own section rather than a cell in the spec
 * grid. It is the single most common source of a disputed charge at return,
 * and a customer who has read it before booking is a customer who is not
 * arguing about it afterwards.
 */
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { CalendarDays, Check, ChevronRight, Cog, DoorOpen, Fuel, Gauge, MapPin, Tag, Users } from 'lucide-react';
import { useVehicle } from '../features/fleet/useFleet';
import QuotePanel from '../components/QuotePanel';
import VehicleArtwork from '../components/VehicleArtwork';

const SPEC_LABELS: Record<string, string> = {
  AUTOMATIC: 'Automatic',
  MANUAL: 'Manual',
  PETROL: 'Petrol',
  DIESEL: 'Diesel',
  HYBRID: 'Hybrid',
  ELECTRIC: 'Electric',
};

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
      <div className="page-container pt-10 sm:pt-14" aria-busy="true">
        <div className="grid animate-pulse gap-10 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] lg:gap-14">
          <div className="space-y-5">
            <div className="h-5 w-24 rounded-full bg-ink-100" />
            <div className="h-12 w-2/3 rounded-lg bg-ink-100" />
            <div className="aspect-16/10 rounded-[20px] bg-ink-100" />
          </div>
          <div className="h-[28rem] rounded-[20px] bg-ink-100" />
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="page-container pt-14">
        <div className="rounded-card border border-red-200 bg-red-50 p-6">
          <h1 className="font-semibold text-red-800">
            {error.status === 404 ? 'Vehicle not found' : 'Could not load this vehicle'}
          </h1>
          <p className="mt-1 text-sm text-red-700">{error.message}</p>
          <Link to="/cars" className="mt-4 inline-block text-sm font-medium text-red-900 underline">
            Back to all cars
          </Link>
        </div>
      </div>
    );
  }

  const vehicle = data.vehicle;
  const images = vehicle.images;

  const specs = [
    { icon: Users, label: 'Seats', value: String(vehicle.seats) },
    { icon: DoorOpen, label: 'Doors', value: String(vehicle.doors) },
    { icon: Cog, label: 'Transmission', value: SPEC_LABELS[vehicle.transmission] ?? vehicle.transmission },
    { icon: Fuel, label: 'Fuel type', value: SPEC_LABELS[vehicle.fuelType] ?? vehicle.fuelType },
    { icon: CalendarDays, label: 'Model year', value: String(vehicle.year) },
    { icon: Tag, label: 'Category', value: vehicle.category.name },
  ];

  return (
    <div className="page-container pt-8 sm:pt-10">
      <nav aria-label="Breadcrumb">
        <ol className="flex flex-wrap items-center gap-1.5 text-sm text-ink-500">
          <li>
            <Link to="/cars" className="transition-colors hover:text-ink-950">
              Fleet
            </Link>
          </li>
          <li aria-hidden>
            <ChevronRight className="h-3.5 w-3.5 text-ink-300" />
          </li>
          <li>
            <Link
              to={`/cars?category=${vehicle.category.slug}`}
              className="transition-colors hover:text-ink-950"
            >
              {vehicle.category.name}
            </Link>
          </li>
          <li aria-hidden>
            <ChevronRight className="h-3.5 w-3.5 text-ink-300" />
          </li>
          <li aria-current="page" className="truncate font-medium text-ink-950">
            {vehicle.name}
          </li>
        </ol>
      </nav>

      <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] lg:gap-x-14 lg:gap-y-0">
        {/* Title and gallery */}
        <div className="min-w-0 lg:col-start-1 lg:row-start-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="badge badge-outline">{vehicle.category.name}</span>
            {vehicle.isFeatured && <span className="badge badge-accent">Featured</span>}
          </div>
          <h1 className="display-heading mt-4 text-[2.25rem] sm:text-5xl lg:text-[3.5rem]">{vehicle.name}</h1>
          <p className="mt-3 text-[15px] text-ink-500">
            {vehicle.year} · {vehicle.category.name}
            {vehicle.color ? ` · ${vehicle.color}` : ''}
          </p>

          <div className="mt-8">
            <div className="image-stage aspect-16/10 overflow-hidden rounded-[20px]">
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

            {images.length > 1 && (
              <div className="no-scrollbar mt-3 flex gap-2 overflow-x-auto p-1">
                {images.map((image, index) => (
                  <button
                    key={image.id}
                    type="button"
                    onClick={() => setActiveImage(index)}
                    aria-label={`Show image ${index + 1}`}
                    aria-current={index === activeImage}
                    className={`image-stage h-16 w-24 shrink-0 overflow-hidden rounded-xl transition ${
                      index === activeImage
                        ? 'ring-2 ring-ink-950 ring-offset-2'
                        : 'opacity-70 hover:opacity-100'
                    }`}
                  >
                    <img src={image.url} alt={image.altText} className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {vehicle.location && (
            <p className="mt-6 inline-flex items-center gap-2 rounded-full border border-ink-200 px-4 py-2 text-sm text-ink-600">
              <MapPin aria-hidden className="h-4 w-4 text-ink-400" />
              Collect from <span className="font-medium text-ink-950">{vehicle.location.name}</span>
            </p>
          )}
        </div>

        {/* Sticky on desktop: the quote is why the page exists. */}
        <aside
          aria-label="Price and booking"
          className="lg:sticky lg:top-24 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start"
        >
          <QuotePanel vehicle={vehicle} initial={carriedDates} />
        </aside>

        {/* Supporting detail */}
        <div className="min-w-0 lg:col-start-1 lg:row-start-2">
          <section aria-labelledby="spec-title" className="lg:pt-16">
            <h2 id="spec-title" className="text-xl font-semibold tracking-tight text-ink-950">
              Specification
            </h2>
            <dl className="mt-6 grid grid-cols-2 gap-x-6 border-t border-ink-100 sm:grid-cols-3">
              {specs.map(({ icon: Icon, label, value }) => (
                <div key={label} className="border-b border-ink-100 py-5">
                  <dt className="flex items-center gap-2 text-[13px] text-ink-500">
                    <Icon aria-hidden className="h-4 w-4 text-ink-400" strokeWidth={1.6} />
                    {label}
                  </dt>
                  <dd className="mt-1.5 text-[15px] font-semibold text-ink-950">{value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section aria-labelledby="mileage-title" className="mt-14">
            <h2
              id="mileage-title"
              className="flex items-center gap-2.5 text-xl font-semibold tracking-tight text-ink-950"
            >
              <Gauge aria-hidden className="h-5 w-5 text-ink-400" strokeWidth={1.6} />
              Mileage allowance
            </h2>
            {vehicle.mileage.limitPerDay ? (
              <p className="mt-4 max-w-2xl text-[15px] leading-7 text-ink-600">
                <span className="font-semibold text-ink-950">{vehicle.mileage.limitPerDay} km per day</span>{' '}
                included.
                {vehicle.mileage.extraCharge ? (
                  <>
                    {' '}
                    Beyond that, {vehicle.pricing.currency} {vehicle.mileage.extraCharge} per extra
                    kilometre, calculated from the odometer readings taken at handover and return.
                  </>
                ) : (
                  ' The charge for extra kilometres is confirmed at handover.'
                )}
              </p>
            ) : (
              <p className="mt-4 text-[15px] text-ink-600">
                <span className="font-semibold text-ink-950">Unlimited mileage</span> on this vehicle.
              </p>
            )}
          </section>

          {vehicle.features.length > 0 && (
            <section aria-labelledby="features-title" className="mt-14">
              <h2 id="features-title" className="text-xl font-semibold tracking-tight text-ink-950">
                Features
              </h2>
              <ul className="mt-5 flex flex-wrap gap-2">
                {vehicle.features.map((feature) => (
                  <li
                    key={feature.id}
                    className="inline-flex items-center gap-2 rounded-full border border-ink-200 px-4 py-2 text-sm text-ink-700"
                  >
                    <Check aria-hidden className="h-3.5 w-3.5 text-accent-600" strokeWidth={2.25} />
                    {feature.name}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {vehicle.description && (
            <section aria-labelledby="about-title" className="mt-14">
              <h2 id="about-title" className="text-xl font-semibold tracking-tight text-ink-950">
                About this vehicle
              </h2>
              <p className="mt-4 max-w-2xl text-[15px] leading-7 text-ink-600">{vehicle.description}</p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
