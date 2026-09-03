/**
 * layouts/AdminLayout.tsx
 * ---------------------------------------------------------------------------
 * Sidebar + content shell for the admin/staff dashboard.
 *
 * The sidebar links are stubs in Phase 1. From Phase 2 this layout also
 * enforces "must be logged in as ADMIN or STAFF" - but remember: that check is
 * only a convenience. The backend is what actually enforces permissions.
 */
import { Link, Outlet } from 'react-router-dom';

const NAV_SECTIONS = [
  { title: 'Overview', items: ['Dashboard'] },
  { title: 'Fleet', items: ['Vehicles', 'Categories', 'Maintenance', 'Insurance'] },
  { title: 'Rentals', items: ['Bookings', 'Pickups', 'Returns', 'Inspections'] },
  { title: 'Finance', items: ['Payments', 'Deposits', 'Damages', 'Fines', 'Tolls', 'Invoices'] },
  { title: 'People', items: ['Customers', 'Documents', 'Users & Roles'] },
  { title: 'System', items: ['Pricing', 'Coupons', 'Locations', 'Reports', 'Settings', 'Audit Logs'] },
];

export default function AdminLayout() {
  const appName = import.meta.env.VITE_APP_NAME ?? 'Admin';

  return (
    <div className="flex min-h-full bg-slate-100">
      <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-white lg:block">
        <div className="border-b border-slate-200 px-5 py-4">
          <Link to="/" className="text-sm font-semibold text-slate-900">
            {appName}
          </Link>
        </div>
        <nav className="px-3 py-4">
          {NAV_SECTIONS.map((section) => (
            <div key={section.title} className="mb-5">
              <p className="px-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                {section.title}
              </p>
              <ul className="mt-2 space-y-1">
                {section.items.map((item) => (
                  <li
                    key={item}
                    className="cursor-not-allowed rounded-md px-2 py-1.5 text-sm text-slate-400"
                    title="Available in a later phase"
                  >
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-b border-slate-200 bg-white px-6 py-4">
          <h1 className="text-base font-semibold text-slate-900">Admin Dashboard</h1>
        </header>
        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
