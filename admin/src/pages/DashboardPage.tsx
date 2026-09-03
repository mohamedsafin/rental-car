/**
 * pages/DashboardPage.tsx
 * ---------------------------------------------------------------------------
 * Phase 1 placeholder for the admin dashboard. The real KPI tiles (total
 * vehicles, today's pickups, pending documents, revenue, ...) need the vehicle
 * and booking modules to exist first, so they arrive in Phase 3 and Phase 6.
 */
import ConnectionStatus from '../components/ConnectionStatus';

const PLANNED_TILES = [
  'Total Vehicles',
  'Available Vehicles',
  'Currently Rented',
  "Today's Pickups",
  "Today's Returns",
  'Upcoming Bookings',
  'Active Rentals',
  'Pending Documents',
  'Pending Payments',
  'Pending Extensions',
  'Maintenance Vehicles',
  'Revenue',
];

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <ConnectionStatus />

      <section>
        <h2 className="font-semibold text-slate-900">Dashboard tiles (planned)</h2>
        <p className="mt-1 text-sm text-slate-600">
          These become live once the vehicle and booking modules exist.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          {PLANNED_TILES.map((tile) => (
            <div key={tile} className="rounded-lg border border-dashed border-slate-300 bg-white p-4">
              <p className="text-xs font-medium text-slate-500">{tile}</p>
              <p className="mt-1 text-xl font-semibold text-slate-300">--</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
