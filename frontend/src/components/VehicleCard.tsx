/**
 * components/VehicleCard.tsx
 * ---------------------------------------------------------------------------
 * One car in the listing grid (BRD 7).
 *
 * Purely presentational: it takes a Vehicle and renders it. No fetching, no
 * price arithmetic - the daily rate is displayed exactly as the backend sent
 * it, because the string "650.00" is already correct and parsing it into a
 * float to reformat would be the one place precision could be lost.
 */
import { Link } from 'react-router-dom';
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

export default function VehicleCard({ vehicle }: { vehicle: Vehicle }) {
  return (
    <article className="overflow-hidden rounded-lg border border-slate-200 bg-white transition hover:shadow-md">
      <Link to={`/cars/${vehicle.id}`} className="block">
        <div className="relative aspect-[4/3] bg-slate-100">
          {vehicle.primaryImageUrl ? (
            <img
              src={vehicle.primaryImageUrl}
              alt={vehicle.images[0]?.altText ?? vehicle.name}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-slate-400">
              No image
            </div>
          )}

          {vehicle.isFeatured && (
            <span className="absolute left-2 top-2 rounded-full bg-slate-900 px-2 py-0.5 text-xs font-medium text-white">
              Featured
            </span>
          )}
        </div>
      </Link>

      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate font-semibold text-slate-900">
              <Link to={`/cars/${vehicle.id}`}>{vehicle.name}</Link>
            </h3>
            <p className="text-xs text-slate-500">
              {vehicle.year} - {vehicle.category.name}
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
            {vehicle.seats} seats
          </span>
        </div>

        <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600">
          <li>{TRANSMISSION_LABEL[vehicle.transmission] ?? vehicle.transmission}</li>
          <li>{FUEL_LABEL[vehicle.fuelType] ?? vehicle.fuelType}</li>
          <li>{vehicle.doors} doors</li>
        </ul>

        <div className="mt-4 flex items-end justify-between">
          <div>
            <p className="text-lg font-bold text-slate-900">
              {vehicle.pricing.currency} {vehicle.pricing.daily}
              <span className="ml-1 text-xs font-normal text-slate-500">/ day</span>
            </p>
            <p className="text-xs text-slate-500">
              Deposit {vehicle.pricing.currency} {vehicle.pricing.securityDeposit}
            </p>
          </div>
          <Link
            to={`/cars/${vehicle.id}`}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
          >
            View
          </Link>
        </div>
      </div>
    </article>
  );
}
