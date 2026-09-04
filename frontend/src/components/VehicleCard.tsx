/**
 * components/VehicleCard.tsx
 * ---------------------------------------------------------------------------
 * One car in the listing grid (BRD 7).
 *
 * Purely presentational: it takes a Vehicle and renders it. No fetching, no
 * price arithmetic - the daily rate is displayed exactly as the backend sent
 * it, because the string "650.00" is already correct and parsing it into a
 * float to reformat would be the one place precision could be lost.
 *
 * The card leads with the price because that is what a customer is actually
 * comparing across a grid of twelve cars. Everything else - seats, gearbox,
 * fuel - is there to answer "will it do?", so it sits underneath as small
 * icon-led facts rather than a paragraph nobody reads.
 */
import { Link } from 'react-router-dom';
import VehicleArtwork from './VehicleArtwork';
import { SeatIcon, GearIcon, FuelIcon, DoorIcon } from './icons';
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

  return (
    <article className="group relative flex flex-col overflow-hidden rounded-card border border-ink-100 bg-white shadow-card transition duration-200 hover:-translate-y-0.5 hover:border-ink-200 hover:shadow-card-hover">
      <div className="relative aspect-16/10 overflow-hidden bg-ink-50">
        {vehicle.primaryImageUrl ? (
          <img
            src={vehicle.primaryImageUrl}
            alt={vehicle.images[0]?.altText ?? vehicle.name}
            className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
            loading="lazy"
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

        <div className="absolute left-3 top-3 flex gap-1.5">
          <span className="rounded-full bg-white/85 px-2.5 py-1 text-[11px] font-semibold text-ink-700 backdrop-blur">
            {vehicle.category.name}
          </span>
          {vehicle.isFeatured && (
            <span className="rounded-full bg-accent-500 px-2.5 py-1 text-[11px] font-semibold text-ink-950">
              Featured
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="min-w-0 truncate text-base font-semibold text-ink-900">
            {/*
              The whole card is clickable via this stretched link, so the
              target is the card rather than a 40px title. One link, not three
              pointing at the same page - screen readers announce it once.
            */}
            <Link to={detailsHref} className="after:absolute after:inset-0 after:content-['']">
              {vehicle.name}
            </Link>
          </h3>
          <span className="shrink-0 text-xs text-ink-400">{vehicle.year}</span>
        </div>

        <ul className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs text-ink-600">
          <li className="flex items-center gap-1.5">
            <SeatIcon className="h-3.5 w-3.5 shrink-0 text-ink-400" />
            {vehicle.seats} seats
          </li>
          <li className="flex items-center gap-1.5">
            <GearIcon className="h-3.5 w-3.5 shrink-0 text-ink-400" />
            {TRANSMISSION_LABEL[vehicle.transmission] ?? vehicle.transmission}
          </li>
          <li className="flex items-center gap-1.5">
            <FuelIcon className="h-3.5 w-3.5 shrink-0 text-ink-400" />
            {FUEL_LABEL[vehicle.fuelType] ?? vehicle.fuelType}
          </li>
          <li className="flex items-center gap-1.5">
            <DoorIcon className="h-3.5 w-3.5 shrink-0 text-ink-400" />
            {vehicle.doors} doors
          </li>
        </ul>

        <div className="mt-4 flex items-end justify-between border-t border-ink-100 pt-3">
          <div>
            <p className="text-xl font-bold tracking-tight text-ink-900">
              <span className="text-sm font-medium text-ink-500">{vehicle.pricing.currency} </span>
              {vehicle.pricing.daily}
              <span className="ml-1 text-xs font-normal text-ink-500">/ day</span>
            </p>
            <p className="mt-0.5 text-[11px] text-ink-400">
              {vehicle.pricing.currency} {vehicle.pricing.securityDeposit} deposit
            </p>
          </div>

          {/*
            Not a <Link>. The stretched link above already covers the card, and
            nesting a second link inside it would be invalid HTML and give
            keyboard users two stops for one destination. This is the visual
            affordance only.
          */}
          <span className="rounded-lg bg-ink-900 px-3.5 py-2 text-sm font-medium text-white transition group-hover:bg-ink-800">
            View
          </span>
        </div>
      </div>
    </article>
  );
}
