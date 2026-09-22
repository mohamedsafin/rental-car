/**
 * layouts/AdminLayout.tsx
 * ---------------------------------------------------------------------------
 * Sidebar + content shell for the admin/staff dashboard.
 *
 * ===========================================================================
 * WHAT CHANGED AND WHY
 * ===========================================================================
 * The sidebar was `hidden lg:block` with no alternative, so on a phone or a
 * narrow window this app had NO NAVIGATION AT ALL - you could reach a page
 * only by typing its URL. Counter staff check bookings on a phone constantly.
 * It is now a slide-over drawer under `lg`, reachable from a button that is
 * always there.
 *
 * Every item carries an icon. Twenty-two text links in six groups is a list
 * you read; with icons it becomes a shape you remember, which is the
 * difference between hunting for "Fines & tolls" and going straight to it on
 * the fortieth visit of the day.
 *
 * The header names the page you are on. It used to say "Admin Dashboard" on
 * all twenty-two screens - a title that is the same everywhere is decoration,
 * not information.
 *
 * Sections that exist are real NavLinks; the rest stay greyed with a note on
 * where to find that work instead. "Users & roles" is admin-only in the
 * sidebar, which matches - but does not replace - `authorize('ADMIN')` on the
 * backend.
 */
import { useEffect, useState, type ComponentType } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  AlertOctagon,
  AlertTriangle,
  BadgePercent,
  BookOpen,
  Building2,
  CalendarCheck,
  CalendarDays,
  Car,
  ClipboardCheck,
  CreditCard,
  FileText,
  Gauge,
  KeyRound,
  LayoutGrid,
  LogOut,
  Mail,
  Menu,
  PiggyBank,
  Receipt,
  Scale,
  ScrollText,
  Settings,
  ShieldCheck,
  Tags,
  Undo2,
  Users,
  Wrench,
  X,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import type { Role } from '../types/auth';

interface NavItem {
  label: string;
  to?: string;
  roles?: Role[];
  /** Shown greyed, with a note on where that work actually happens. */
  phase?: string;
  icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
}

const NAV_SECTIONS: { title: string; items: NavItem[] }[] = [
  { title: 'Overview', items: [{ label: 'Dashboard', to: '/', icon: LayoutGrid }] },
  {
    title: 'Fleet',
    items: [
      { label: 'Vehicles', to: '/vehicles', icon: Car },
      { label: 'Categories', to: '/categories', icon: Tags },
      { label: 'Maintenance', to: '/maintenance', icon: Wrench },
      { label: 'Insurance & expiries', to: '/insurance', icon: ShieldCheck },
    ],
  },
  {
    title: 'Rentals',
    items: [
      { label: 'Bookings', to: '/bookings', icon: BookOpen },
      { label: 'Fleet calendar', to: '/calendar', icon: CalendarDays },
      { label: 'Pickups', to: '/pickups', icon: KeyRound },
      { label: 'Returns', to: '/returns', icon: Undo2 },
      { label: 'Inspections', to: '/inspections', icon: ClipboardCheck },
    ],
  },
  {
    title: 'Finance',
    items: [
      { label: 'Payments', to: '/payments', icon: CreditCard },
      { label: 'Deposits', to: '/deposits', icon: PiggyBank },
      { label: 'Damages', to: '/damages', icon: AlertTriangle },
      { label: 'Accidents & claims', to: '/accidents', icon: AlertOctagon },
      { label: 'Fines & tolls', to: '/fines', icon: Receipt },
      { label: 'Invoices', to: '/invoices', icon: FileText },
      { label: 'Promo codes', to: '/coupons', roles: ['ADMIN'], icon: BadgePercent },
    ],
  },
  {
    title: 'People',
    items: [
      { label: 'Customers', to: '/customers', icon: Users },
      { label: 'Users & roles', to: '/users', roles: ['ADMIN'], icon: ShieldCheck },
    ],
  },
  {
    title: 'System',
    items: [
      { label: 'Pricing', to: '/pricing', icon: Gauge },
      { label: 'Locations', to: '/locations', icon: Building2 },
      { label: 'Reports', to: '/reports', icon: CalendarCheck },
      { label: 'Notifications', to: '/notifications', icon: Mail },
      { label: 'Legal documents', to: '/legal', roles: ['ADMIN'], icon: Scale },
      { label: 'Settings', to: '/settings', icon: Settings },
      { label: 'Audit logs', to: '/audit', roles: ['ADMIN'], icon: ScrollText },
    ],
  },
];

/** Every route's title, so the header can name where you are. */
const PAGE_TITLES: { match: RegExp; title: string }[] = [
  { match: /^\/$/, title: 'Dashboard' },
  { match: /^\/vehicles/, title: 'Vehicles' },
  { match: /^\/categories/, title: 'Categories' },
  { match: /^\/maintenance/, title: 'Maintenance' },
  { match: /^\/insurance/, title: 'Insurance & expiries' },
  // Ahead of the /bookings/.+ line: "new" is a page, not a booking id.
  { match: /^\/bookings\/new/, title: 'New booking' },
  { match: /^\/bookings\/.+/, title: 'Booking' },
  { match: /^\/bookings/, title: 'Bookings' },
  { match: /^\/calendar/, title: 'Fleet calendar' },
  { match: /^\/pickups/, title: 'Pickups' },
  { match: /^\/returns/, title: 'Returns' },
  { match: /^\/inspections/, title: 'Inspections' },
  { match: /^\/payments/, title: 'Payments' },
  { match: /^\/deposits/, title: 'Deposits' },
  { match: /^\/damages/, title: 'Damages' },
  { match: /^\/accidents/, title: 'Accidents & claims' },
  { match: /^\/fines/, title: 'Fines & tolls' },
  { match: /^\/invoices/, title: 'Invoices' },
  { match: /^\/coupons/, title: 'Promo codes' },
  { match: /^\/customers\/.+/, title: 'Customer' },
  { match: /^\/customers/, title: 'Customers' },
  { match: /^\/users/, title: 'Users & roles' },
  { match: /^\/pricing/, title: 'Pricing' },
  { match: /^\/locations/, title: 'Locations' },
  { match: /^\/reports/, title: 'Reports' },
  { match: /^\/notifications/, title: 'Notifications' },
  { match: /^\/legal/, title: 'Legal documents' },
  { match: /^\/settings/, title: 'Settings' },
  { match: /^\/audit/, title: 'Audit logs' },
];

const titleFor = (pathname: string): string =>
  PAGE_TITLES.find((entry) => entry.match.test(pathname))?.title ?? 'Admin';

/** Two letters from a name, for the avatar. "MOHAMED SAFIN" -> "MS". */
function initialsOf(name: string | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { user } = useAuth();

  return (
    <nav className="flex-1 overflow-y-auto px-3 pb-6">
      {NAV_SECTIONS.map((section) => {
        const items = section.items.filter(
          (item) => !item.roles || (user && item.roles.includes(user.role)),
        );
        if (items.length === 0) return null;

        return (
          <div key={section.title} className="mt-5 first:mt-3">
            <p className="px-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-400">
              {section.title}
            </p>

            <ul className="mt-1.5 space-y-0.5">
              {items.map((item) => {
                const Icon = item.icon;

                if (!item.to) {
                  return (
                    <li key={item.label}>
                      <span
                        title={`Handled ${item.phase}`}
                        className="flex cursor-default items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-ink-400"
                      >
                        <Icon aria-hidden className="h-4 w-4 shrink-0" />
                        <span className="truncate">{item.label}</span>
                        <span className="ml-auto text-[10px] text-ink-300">{item.phase}</span>
                      </span>
                    </li>
                  );
                }

                return (
                  <li key={item.label}>
                    <NavLink
                      to={item.to}
                      end={item.to === '/'}
                      onClick={onNavigate}
                      className={({ isActive }) =>
                        [
                          'group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors',
                          isActive
                            ? 'bg-ink-100 font-semibold text-ink-950'
                            : 'text-ink-600 hover:bg-ink-50 hover:text-ink-950',
                        ].join(' ')
                      }
                    >
                      {({ isActive }) => (
                        <>
                          {/*
                            A short accent rule on the active item. The whole
                            row used to invert to near-black, which on a list
                            this long shouted louder than the page content it
                            was pointing at.
                          */}
                          <span
                            aria-hidden
                            className={[
                              'absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-accent-500 transition-opacity',
                              isActive ? 'opacity-100' : 'opacity-0',
                            ].join(' ')}
                          />
                          <Icon
                            aria-hidden
                            className={[
                              'h-4 w-4 shrink-0 transition-colors',
                              isActive ? 'text-ink-950' : 'text-ink-400 group-hover:text-ink-600',
                            ].join(' ')}
                          />
                          <span className="truncate">{item.label}</span>
                        </>
                      )}
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function Brand({ appName }: { appName: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        aria-hidden
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ink-950 text-[13px] font-bold text-white"
      >
        UC
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-semibold leading-tight text-ink-950">
          {appName}
        </span>
        <span className="block text-[11px] leading-tight text-ink-400">Operations</span>
      </span>
    </div>
  );
}

export default function AdminLayout() {
  /*
   * The env name is "UAE Car Rental - Admin", and the mark already says
   * Operations underneath it - so printing both left the word Admin twice in
   * one corner. The suffix is dropped for display only.
   */
  const appName = (import.meta.env.VITE_APP_NAME ?? 'UAE Car Rental')
    .replace(/\s*[-–—]\s*admin$/i, '')
    .trim();
  const { user, logout } = useAuth();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Navigating closes the drawer. Without this, tapping a link on a phone
  // leaves the menu covering the page you just asked for.
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  /*
   * Escape closes it, and the page behind stops scrolling while it is open.
   *
   * Without the scroll lock, a thumb that misses the menu drags the booking
   * list underneath instead - so the menu closes onto a page that has moved,
   * and whatever you were looking at is gone.
   */
  useEffect(() => {
    if (!drawerOpen) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', onKey);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [drawerOpen]);

  return (
    <div className="flex min-h-full">
      {/* --- Sidebar, from lg up ------------------------------------------ */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-ink-100 bg-white lg:flex">
        <div
          className="flex items-center border-b border-ink-100 px-4"
          style={{ height: 'var(--topbar-height)' }}
        >
          <Brand appName={appName} />
        </div>
        <SidebarContent />
      </aside>

      {/* --- The same sidebar as a drawer, below lg ----------------------- */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 bg-ink-950/40 backdrop-blur-[2px]"
          />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-white shadow-float">
            <div
              className="flex items-center justify-between border-b border-ink-100 px-4"
              style={{ height: 'var(--topbar-height)' }}
            >
              <Brand appName={appName} />
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="btn btn-ghost btn-sm"
                aria-label="Close menu"
              >
                <X aria-hidden className="h-4 w-4" />
              </button>
            </div>
            <SidebarContent onNavigate={() => setDrawerOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/*
          Sticky and translucent. Long tables are the norm here, and a header
          that scrolls away takes the page name and the sign-out with it.
        */}
        <header
          className="sticky top-0 z-30 flex items-center gap-3 border-b border-ink-100 bg-white/85 px-4 backdrop-blur-md sm:px-6"
          style={{ height: 'var(--topbar-height)' }}
        >
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="btn btn-ghost btn-sm -ml-1 lg:hidden"
            aria-label="Open menu"
          >
            <Menu aria-hidden className="h-4.5 w-4.5" />
          </button>

          <h1 className="min-w-0 truncate text-[15px] font-semibold tracking-tight text-ink-950">
            {titleFor(location.pathname)}
          </h1>

          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <div className="hidden items-center gap-2.5 sm:flex">
              <span
                aria-hidden
                className="flex h-7 w-7 items-center justify-center rounded-full bg-ink-100 text-[11px] font-semibold text-ink-700"
              >
                {initialsOf(user?.fullName)}
              </span>
              <span className="leading-tight">
                <span className="block max-w-[14rem] truncate text-[13px] font-medium text-ink-900">
                  {user?.fullName}
                </span>
                <span className="block text-[11px] text-ink-400">
                  {user?.role === 'ADMIN' ? 'Administrator' : 'Staff'}
                </span>
              </span>
            </div>

            <button type="button" onClick={() => void logout()} className="btn btn-outline btn-sm">
              <LogOut aria-hidden className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </header>

        {/*
          Keyed on the path so each navigation replays the fade. Without the
          key React reuses the element and the animation never runs again.
        */}
        <main key={location.pathname} className="animate-page flex-1 px-4 py-5 sm:px-6 sm:py-6">
          <div className="mx-auto w-full max-w-[90rem]">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
