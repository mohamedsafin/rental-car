/**
 * pages/DashboardPage.tsx
 * ---------------------------------------------------------------------------
 * The admin overview (BRD 35).
 *
 * Every tile is now live. It previously carried eight greyed placeholders
 * labelled "Phase 5", "Phase 8", "Phase 10" and so on - honest while those
 * modules did not exist, and actively misleading once they did: the dashboard
 * was telling an admin that document verification was unbuilt while a customer
 * sat waiting for their passport to be reviewed.
 *
 * The tiles that represent WORK TO DO link straight to the screen that does
 * it. A count of documents awaiting review is only useful if the next click is
 * obvious; the whole reason this page was confusing is that it named a number
 * and left you to find the page yourself.
 */
import { Link } from 'react-router-dom';
import ConnectionStatus from '../components/ConnectionStatus';
import { useAdminVehicles } from '../features/fleet/useFleetAdmin';
import { useCustomers } from '../features/customer/useCustomerAdmin';
import { useDashboardReport } from '../features/output/useOutput';
import { useAdminBookings } from '../features/bookings/useBookingsAdmin';

export default function DashboardPage() {
  // limit 60 is enough to count statuses honestly on a small fleet. The
  // authoritative totals come from the report endpoint below.
  const { data: vehicleData } = useAdminVehicles({ page: 1, limit: 60 });
  const { data: report } = useDashboardReport();

  // Only the pagination total is used - one row is enough to learn "how many".
  const { data: pendingDocs } = useCustomers({ page: 1, limit: 1, pendingDocuments: true });
  const { data: awaitingPayment } = useAdminBookings({ page: 1, limit: 1, status: 'PAYMENT_PENDING' });
  const { data: activeRentals } = useAdminBookings({ page: 1, limit: 1, status: 'ACTIVE' });

  const vehicles = vehicleData?.items ?? [];
  const total = vehicleData?.pagination.total ?? 0;
  const available = vehicles.filter((vehicle) => vehicle.status === 'AVAILABLE').length;
  const rented = vehicles.filter((vehicle) => vehicle.status === 'RENTED').length;
  const maintenance = vehicles.filter((vehicle) => vehicle.status === 'UNDER_MAINTENANCE').length;

  const documentsWaiting = pendingDocs?.pagination.total ?? 0;
  const paymentsWaiting = awaitingPayment?.pagination.total ?? 0;
  const rentalsActive = activeRentals?.pagination.total ?? 0;

  const currency = 'AED';

  return (
    <div className="space-y-8">
      {/*
        Needs attention comes FIRST. A dashboard's job is to say what to do
        next, and a queue of customers waiting on verification matters more
        than a fleet count that has not changed since yesterday.
      */}
      <section>
        <h2 className="font-semibold text-slate-900">Needs attention</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <ActionTile
            label="Documents awaiting review"
            value={documentsWaiting}
            to="/customers?pending=true"
            action="Review documents"
            urgent={documentsWaiting > 0}
            hint="Open the customer, then approve or reject each document."
          />
          <ActionTile
            label="Bookings awaiting payment"
            value={paymentsWaiting}
            to="/bookings?status=PAYMENT_PENDING"
            action="View bookings"
          />
          <ActionTile
            label="Active rentals"
            value={rentalsActive}
            to="/bookings?status=ACTIVE"
            action="View rentals"
          />
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-slate-900">Fleet</h2>
          <Link to="/vehicles" className="text-sm text-slate-600 underline">
            Manage vehicles
          </Link>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile label="Total vehicles" value={String(total)} />
          <Tile label="Available" value={String(available)} />
          <Tile label="Currently rented" value={String(rented)} />
          <Tile label="Under maintenance" value={String(maintenance)} />
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-slate-900">This month</h2>
          <Link to="/reports" className="text-sm text-slate-600 underline">
            Full reports
          </Link>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile
            label="Revenue (paid)"
            value={report ? `${currency} ${report.revenue.netRevenue}` : '—'}
            hint="Money actually received"
          />
          <Tile
            label="Booked value"
            value={report ? `${currency} ${report.bookings.bookedValue}` : '—'}
            hint="Agreed, not all received"
          />
          <Tile
            label="Bookings"
            value={report ? String(report.bookings.totalBookings) : '—'}
            hint={report ? `${report.bookings.cancellations} cancelled` : undefined}
          />
          <Tile
            label="Deposits held"
            value={report ? `${currency} ${report.outstanding.depositsHeld}` : '—'}
            hint="Customers' money, not income"
          />
        </div>
      </section>

      <ConnectionStatus />
    </div>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-slate-400">{hint}</p>}
    </div>
  );
}

/**
 * A tile representing a queue. It links to the screen that clears it, because
 * a count with no route to act on it is just decoration.
 */
function ActionTile({
  label,
  value,
  to,
  action,
  hint,
  urgent,
}: {
  label: string;
  value: number;
  to: string;
  action: string;
  hint?: string;
  urgent?: boolean;
}) {
  return (
    <Link
      to={to}
      className={
        urgent
          ? 'block rounded-lg border border-amber-300 bg-amber-50 p-4 transition hover:border-amber-400'
          : 'block rounded-lg border border-slate-200 bg-white p-4 transition hover:border-slate-300'
      }
    >
      <p className={urgent ? 'text-xs font-medium text-amber-800' : 'text-xs font-medium text-slate-500'}>
        {label}
      </p>
      <p className={urgent ? 'mt-1 text-2xl font-bold text-amber-900' : 'mt-1 text-2xl font-semibold text-slate-900'}>
        {value}
      </p>
      {hint && value > 0 && (
        <p className={urgent ? 'mt-1 text-[11px] text-amber-800' : 'mt-1 text-[11px] text-slate-400'}>{hint}</p>
      )}
      <p className={urgent ? 'mt-2 text-xs font-medium text-amber-900 underline' : 'mt-2 text-xs font-medium text-slate-600 underline'}>
        {action} &rarr;
      </p>
    </Link>
  );
}
