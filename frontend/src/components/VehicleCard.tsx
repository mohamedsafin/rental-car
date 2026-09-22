/**
 * components/VehicleCard.tsx
 * ---------------------------------------------------------------------------
 * One car in a listing grid (BRD 7).
 *
 * Purely presentational: it takes a Vehicle and renders it. No fetching, no
 * price arithmetic - amounts are displayed from the strings the backend sent.
 *
 * DESIGN
 *
 * The photograph is the card. It sits inset on a shared neutral "stage" (see
 * `.image-stage` in index.css), which is what makes a studio shot, a street
 * shot and a generated illustration look like members of one fleet rather
 * than three different websites. Everything under it is quiet: a name, four
 * small facts, and a price with a clear hierarchy - the daily rate large, the
 * deposit small but never hidden. A refundable AED 2,500 hold discovered at
 * checkout is the most common complaint in car rental; one line here removes
 * the surprise.
 *
 * The call to action is a text link, not a filled button. Twelve black buttons
 * in a grid shout over the photographs they are meant to be selling.
 *
 * The whole card is one link (a stretched ::after on the title), so the target
 * is the card rather than a 40px title, and screen readers announce it once.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Cog, DoorOpen, Fuel, Users } from 'lucide-react';
import VehicleArtwork from './VehicleArtwork';
import { displayMoney } from '../utils/displayMoney';
import type { Vehicle } from '../types/vehicle';

const TRANSMISSION_LABEL: Record<string, string> = {
  AUTOMATIC: 'Automatic',
  MANUAL: 'Manual',
};

const FUEL_LABEL: Record<string, string> = {
  PETROL: 'Petrol',
  DIESEL: 'Diesel',
  HYBRID: 'Hybrid',
  ELECTRIC: 'Electric',
};

interface VehicleCardProps {
  vehicle: Vehicle;
  /**
   * Query string appended to the details link, used to carry the searched
   * dates through so the details page can quote straight away rather than
   * asking the customer to enter them a second time.
   */
  detailsQuery?: string;
}

export default function VehicleCard({ vehicle, detailsQuery }: VehicleCardProps) {
  const detailsHref = detailsQuery ? `/cars/${vehicle.id}?${detailsQuery}` : `/cars/${vehicle.id}`;

  /*
   * A broken image URL falls back to the generated artwork rather than an
   * empty grey box, so a card always looks deliberate whether the photo is
   * missing from the database or the file itself has gone.
   */
  const [imageFailed, setImageFailed] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const showPhoto = Boolean(vehicle.primaryImageUrl) && !imageFailed;
  const currency = vehicle.pricing.currency;

  const specs = [
    { icon: Users, label: `${vehicle.seats} seats` },
    { icon: Cog, label: TRANSMISSION_LABEL[vehicle.transmission] ?? vehicle.transmission },
    { icon: Fuel, label: FUEL_LABEL[vehicle.fuelType] ?? vehicle.fuelType },
    { icon: DoorOpen, label: `${vehicle.doors} doors` },
  ];

  return (
    <article className="group surface surface-interactive relative flex h-full flex-col p-2 has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-accent-600 has-[a:focus-visible]:ring-offset-2">
      <div className="image-stage relative aspect-16/10 overflow-hidden rounded-[12px]">
        {showPhoto ? (
          <>
            {/* Holds the space and shimmers until the photo decodes, so the
                grid does not jump as images arrive one by one. */}
            {!imageLoaded && <div className="absolute inset-0 animate-pulse bg-ink-100" />}
            <img
              src={vehicle.primaryImageUrl as string}
              alt={vehicle.images[0]?.altText ?? vehicle.name}
              onLoad={() => setImageLoaded(true)}
              onError={() => setImageFailed(true)}
              className={`h-full w-full object-cover transition duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.04] ${
                imageLoaded ? 'opacity-100' : 'opacity-0'
              }`}
              loading="lazy"
              decoding="async"
            />
          </>
        ) : (
          <VehicleArtwork
            categorySlug={vehicle.category.slug}
            doors={vehicle.doors}
            seats={vehicle.seats}
            label={vehicle.category.name}
            className="h-full w-full transition duration-700 group-hover:scale-[1.04]"
          />
        )}

        <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
          <span className="badge badge-neutral">{vehicle.category.name}</span>
          {vehicle.isFeatured && <span className="badge badge-accent">Featured</span>}
        </div>
      </div>

      <div className="flex flex-1 flex-col px-3 pb-3 pt-4">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="min-w-0 text-[17px] font-semibold leading-snug tracking-tight text-ink-950">
            <Link
              to={detailsHref}
              className="after:absolute after:inset-0 after:rounded-card after:content-[''] focus-visible:outline-none"
            >
              {vehicle.name}
            </Link>
          </h3>
          <span className="tabular shrink-0 text-xs font-medium text-ink-500">{vehicle.year}</span>
        </div>

        <ul className="mt-2.5 flex flex-wrap gap-x-3.5 gap-y-1.5 text-[13px] text-ink-500">
          {specs.map(({ icon: Icon, label }) => (
            <li key={label} className="flex items-center gap-1.5">
              <Icon aria-hidden className="h-3.5 w-3.5 shrink-0 text-ink-400" strokeWidth={1.75} />
              {label}
            </li>
          ))}
        </ul>

        {/* `mt-auto` keeps the price row on one baseline across a grid row even
            when one card's name wraps to two lines. */}
        <div className="mt-auto pt-5">
          <div className="flex items-end justify-between gap-3 border-t border-ink-100 pt-4">
            <div className="min-w-0">
              <p className="tabular leading-none text-ink-950">
                <span className="text-xs font-medium text-ink-500">{currency}</span>{' '}
                <span className="text-[1.375rem] font-semibold tracking-tight">
                  {displayMoney(vehicle.pricing.daily)}
                </span>{' '}
                <span className="text-xs font-medium text-ink-500">/ day</span>
              </p>
              <p className="tabular mt-2 text-xs text-ink-500">
                {currency} {displayMoney(vehicle.pricing.securityDeposit)} refundable deposit
              </p>
            </div>

            {/* The affordance only - the stretched title link above is the
                real target, and a second link would give keyboard users two
                stops for one destination. */}
            <span aria-hidden className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-ink-950">
              View car
              <ArrowRight className="link-arrow-icon h-4 w-4" />
            </span>
          </div>
        </div>
      </div>
    </article>
  );
}

/** The loading placeholder, shaped like the real card so the grid does not jump. */
export function VehicleCardSkeleton() {
  return (
    <div aria-hidden className="surface flex flex-col p-2">
      <div className="aspect-16/10 animate-pulse rounded-[12px] bg-ink-100" />
      <div className="space-y-3 px-3 pb-3 pt-4">
        <div className="h-4 w-2/3 animate-pulse rounded bg-ink-100" />
        <div className="h-3 w-1/2 animate-pulse rounded bg-ink-100" />
        <div className="!mt-6 h-px bg-ink-100" />
        <div className="h-6 w-1/3 animate-pulse rounded bg-ink-100" />
      </div>
    </div>
  );
}
