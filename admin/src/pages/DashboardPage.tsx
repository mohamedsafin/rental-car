/**
 * pages/DashboardPage.tsx
 * ---------------------------------------------------------------------------
 * The admin overview (BRD 35).
 *
 * Fleet tiles are live now that vehicles exist. The rest stay greyed out with
 * the phase that delivers them - a dashboard showing a confident "0" for
 * today's pickups when the booking module does not exist yet would be a lie,
 * not a placeholder.
 */
import { Link } from 'react-router-dom';
import ConnectionStatus from '../components/ConnectionStatus';
import { useAdminVehicles } from '../features/fleet/useFleetAdmin';

const PENDING_TILES = [
  { label: "Today's Pickups", phase: 'Phase 8' },
  { label: "Today's Returns", phase: 'Phase 8' },
  { label: 'Upcoming Bookings', phase: 'Phase 6' },
  { label: 'Active Rentals', phase: 'Phase 6' },
  { label: 'Pending Documents', phase: 'Phase 5' },
  { label: 'Pending Payments', phase: 'Phase 7' },
  { label: 'Pending Extensions', phase: 'Phase 8' },
  { label: 'Revenue', phase: 'Phase 10' },
];

export default function DashboardPage() {
  // limit 60 is enough to count the tiles honestly on a small fleet; Phase 10
  // replaces this with a proper aggregate endpoint.
  const { data } = useAdminVehicles({ page: 1, limit: 60 });

  const vehicles = data?.items ?? [];
  const total = data?.pagination.total ?? 0;
  const available = vehicles.filter((v) => v.status === 'AVAILABLE').length;
  const rented = vehicles.filter((v) => v.status === 'RENTED').length;
  const maintenance = vehicles.filter((v) => v.status === 'UNDER_MAINTENANCE').length;

  return (
    <div className="space-y-6">
      <section>
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-slate-900">Fleet</h2>
          <Link to="/vehicles" className="text-sm text-slate-600 underline">
            Manage vehicles
          </Link>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile label="Total Vehicles" value={total} />
          <Tile label="Available" value={available} />
          <Tile label="Currently Rented" value={rented} />
          <Tile label="Under Maintenance" value={maintenance} />
        </div>
      </section>

      <section>
        <h2 className="font-semibold text-slate-900">Awaiting later phases</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          {PENDING_TILES.map((tile) => (
            <div
              key={tile.label}
              className="rounded-lg border border-dashed border-slate-300 bg-white p-4"
            >
              <p className="text-xs font-medium text-slate-500">{tile.label}</p>
              <p className="mt-1 text-xl font-semibold text-slate-300">--</p>
              <p className="text-[10px] text-slate-400">{tile.phase}</p>
            </div>
          ))}
        </div>
      </section>

      <ConnectionStatus />
    </div>
  );
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
    </div>
  );
}
