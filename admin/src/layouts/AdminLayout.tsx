/**
 * layouts/AdminLayout.tsx
 * ---------------------------------------------------------------------------
 * Sidebar + content shell for the admin/staff dashboard.
 *
 * Sections that exist are real NavLinks; the rest stay greyed out with the
 * phase that delivers them. "Users & roles" is admin-only in the sidebar, which
 * matches - but does not replace - `authorize('ADMIN')` on the backend.
 */
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import type { Role } from '../types/auth';

interface NavItem {
  label: string;
  to?: string;
  roles?: Role[];
  phase?: string;
}

const NAV_SECTIONS: { title: string; items: NavItem[] }[] = [
  { title: 'Overview', items: [{ label: 'Dashboard', to: '/' }] },
  {
    title: 'Fleet',
    items: [
      { label: 'Vehicles', to: '/vehicles' },
      { label: 'Categories', phase: 'Phase 4' },
      { label: 'Maintenance', phase: 'Phase 9' },
      { label: 'Insurance', phase: 'Phase 9' },
    ],
  },
  {
    title: 'Rentals',
    items: [
      { label: 'Bookings', to: '/bookings' },
      { label: 'Pickups', phase: 'Phase 8' },
      { label: 'Returns', phase: 'Phase 8' },
      { label: 'Inspections', phase: 'Phase 8' },
    ],
  },
  {
    title: 'Finance',
    items: [
      { label: 'Payments', phase: 'see a booking' },
      { label: 'Deposits', phase: 'see a booking' },
      { label: 'Damages', phase: 'Phase 9' },
      { label: 'Fines', phase: 'Phase 9' },
      { label: 'Invoices', phase: 'Phase 10' },
    ],
  },
  {
    title: 'People',
    items: [
      { label: 'Customers', to: '/customers' },
      { label: 'Users & roles', to: '/users', roles: ['ADMIN'] },
    ],
  },
  {
    title: 'System',
    items: [
      { label: 'Pricing', to: '/pricing' },
      { label: 'Locations', to: '/locations' },
      { label: 'Reports', phase: 'Phase 10' },
      { label: 'Settings', phase: 'Phase 10' },
      { label: 'Audit logs', phase: 'Phase 11' },
    ],
  },
];

export default function AdminLayout() {
  const appName = import.meta.env.VITE_APP_NAME ?? 'Admin';
  const { user, logout } = useAuth();

  return (
    <div className="flex min-h-full bg-slate-100">
      <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-white lg:block">
        <div className="border-b border-slate-200 px-5 py-4">
          <span className="text-sm font-semibold text-slate-900">{appName}</span>
        </div>

        <nav className="px-3 py-4">
          {NAV_SECTIONS.map((section) => (
            <div key={section.title} className="mb-5">
              <p className="px-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                {section.title}
              </p>
              <ul className="mt-2 space-y-1">
                {section.items
                  .filter((item) => !item.roles || (user && item.roles.includes(user.role)))
                  .map((item) =>
                    item.to ? (
                      <li key={item.label}>
                        <NavLink
                          to={item.to}
                          end
                          className={({ isActive }) =>
                            isActive
                              ? 'block rounded-md bg-slate-900 px-2 py-1.5 text-sm font-medium text-white'
                              : 'block rounded-md px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-100'
                          }
                        >
                          {item.label}
                        </NavLink>
                      </li>
                    ) : (
                      <li
                        key={item.label}
                        title={`Available in ${item.phase}`}
                        className="flex cursor-not-allowed items-center justify-between rounded-md px-2 py-1.5 text-sm text-slate-400"
                      >
                        {item.label}
                        <span className="text-[10px] text-slate-300">{item.phase}</span>
                      </li>
                    ),
                  )}
              </ul>
            </div>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
          <h1 className="text-base font-semibold text-slate-900">Admin Dashboard</h1>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-600">
              {user?.fullName}
              <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                {user?.role}
              </span>
            </span>
            <button
              type="button"
              onClick={() => void logout()}
              className="rounded-md border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
            >
              Sign out
            </button>
          </div>
        </header>

        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
