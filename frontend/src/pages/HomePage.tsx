/**
 * pages/HomePage.tsx
 * ---------------------------------------------------------------------------
 * The customer landing page (BRD 5).
 *
 * Now real: featured vehicles and browsable categories come from the API.
 * The date/location search widget needs the availability engine (Phase 4) - it
 * cannot honestly say "available" until something can check that.
 */
import { Link } from 'react-router-dom';
import { useCategories, useVehicles } from '../features/fleet/useFleet';
import VehicleCard from '../components/VehicleCard';

export default function HomePage() {
  const { data: categoryData } = useCategories();
  const { data: featured, isPending } = useVehicles({ limit: 3, sort: 'newest' });

  return (
    <div className="space-y-12">
      <section className="rounded-lg border border-slate-200 bg-white p-8 text-center">
        <h1 className="text-3xl font-bold text-slate-900">Rent a car in the UAE</h1>
        <p className="mx-auto mt-2 max-w-xl text-slate-600">
          Browse the fleet, compare rates and pick the vehicle that fits your trip.
        </p>
        <Link
          to="/cars"
          className="mt-6 inline-block rounded-md bg-slate-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-slate-800"
        >
          Browse all cars
        </Link>
        <p className="mt-4 text-xs text-slate-500">
          Date and location search arrives with the availability engine
        </p>
      </section>

      {categoryData && categoryData.categories.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-slate-900">Browse by category</h2>
          <div className="mt-4 flex flex-wrap gap-2">
            {categoryData.categories.map((category) => (
              <Link
                key={category.id}
                to={`/cars?category=${category.slug}`}
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-400"
              >
                {category.name}
              </Link>
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="flex items-end justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Featured vehicles</h2>
          <Link to="/cars" className="text-sm font-medium text-slate-700 underline">
            View all
          </Link>
        </div>

        {isPending ? (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="h-72 animate-pulse rounded-lg bg-slate-200" />
            ))}
          </div>
        ) : featured && featured.items.length > 0 ? (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {featured.items.map((vehicle) => (
              <VehicleCard key={vehicle.id} vehicle={vehicle} />
            ))}
          </div>
        ) : (
          <div className="mt-4 rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center">
            <p className="font-medium text-slate-700">No vehicles published yet</p>
            <p className="mt-1 text-sm text-slate-500">
              Add vehicles from the admin dashboard and they will appear here.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
