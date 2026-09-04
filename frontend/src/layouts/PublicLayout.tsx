/**
 * layouts/PublicLayout.tsx
 * ---------------------------------------------------------------------------
 * Shared chrome for every public customer page. Pages render into <Outlet />,
 * so navigating does not re-render the header.
 *
 * The header reflects auth state: signed-out visitors get Sign in / Register,
 * signed-in customers get their name and a link to the account area.
 *
 * It is sticky and translucent because the listing page is long and the
 * "Cars" link is the main way back out of it - a header you have to scroll to
 * the top to reach is a header you stop using.
 */
import { Link, NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  isActive
    ? 'rounded-lg bg-ink-100 px-3 py-1.5 text-sm font-semibold text-ink-900'
    : 'rounded-lg px-3 py-1.5 text-sm font-medium text-ink-600 transition hover:bg-ink-50 hover:text-ink-900';

export default function PublicLayout() {
  const appName = import.meta.env.VITE_APP_NAME ?? 'UAE Car Rental';
  const { user, isAuthenticated, isLoading } = useAuth();

  return (
    <div className="flex min-h-full flex-col bg-ink-50/40">
      {/*
        A skip link is the cheapest accessibility win there is: a keyboard user
        landing on the listing page should not have to tab through the whole
        header on every navigation.
      */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-ink-900 focus:px-4 focus:py-2 focus:text-sm focus:text-white"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-40 border-b border-ink-100 bg-white/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3.5">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-ink-900 text-sm font-bold text-accent-400">
              {appName.trim().charAt(0).toUpperCase()}
            </span>
            <span className="text-base font-semibold tracking-tight text-ink-900">{appName}</span>
          </Link>

          <nav className="flex items-center gap-1.5">
            <NavLink to="/cars" className={navLinkClass}>
              Browse cars
            </NavLink>

            {isLoading ? (
              <span className="px-3 text-sm text-ink-300">…</span>
            ) : isAuthenticated ? (
              <>
                <NavLink to="/account/bookings" className={navLinkClass}>
                  My bookings
                </NavLink>
                <NavLink
                  to="/account"
                  className={({ isActive }) =>
                    isActive
                      ? 'ml-1 flex items-center gap-2 rounded-lg bg-ink-900 px-3 py-1.5 text-sm font-medium text-white'
                      : 'ml-1 flex items-center gap-2 rounded-lg border border-ink-200 px-3 py-1.5 text-sm font-medium text-ink-700 transition hover:border-ink-300'
                  }
                >
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent-500 text-[10px] font-bold text-ink-950">
                    {user?.fullName?.trim().charAt(0).toUpperCase() ?? '?'}
                  </span>
                  <span className="hidden sm:inline">Account</span>
                </NavLink>
              </>
            ) : (
              <>
                <Link
                  to="/login"
                  className="rounded-lg px-3 py-1.5 text-sm font-medium text-ink-600 transition hover:bg-ink-50 hover:text-ink-900"
                >
                  Sign in
                </Link>
                <Link
                  to="/register"
                  className="rounded-lg bg-ink-900 px-3.5 py-1.5 text-sm font-medium text-white transition hover:bg-ink-800"
                >
                  Register
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <Outlet />
      </main>

      <footer className="mt-12 border-t border-ink-100 bg-white">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-3">
          <div>
            <p className="text-sm font-semibold text-ink-900">{appName}</p>
            <p className="mt-2 text-sm text-ink-500">
              Browse the fleet, check real availability for your dates and book online.
            </p>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">Explore</p>
            <ul className="mt-3 space-y-2 text-sm text-ink-600">
              <li>
                <Link to="/cars" className="hover:text-ink-900">
                  All vehicles
                </Link>
              </li>
              <li>
                <Link to="/cars?category=suv" className="hover:text-ink-900">
                  SUVs
                </Link>
              </li>
              <li>
                <Link to="/cars?category=luxury" className="hover:text-ink-900">
                  Luxury
                </Link>
              </li>
              <li>
                <Link to="/cars?category=electric" className="hover:text-ink-900">
                  Electric
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">Account</p>
            <ul className="mt-3 space-y-2 text-sm text-ink-600">
              <li>
                <Link to="/account/bookings" className="hover:text-ink-900">
                  My bookings
                </Link>
              </li>
              <li>
                <Link to="/account/documents" className="hover:text-ink-900">
                  My documents
                </Link>
              </li>
              <li>
                <Link to="/account" className="hover:text-ink-900">
                  Profile
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="border-t border-ink-100">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4">
            <p className="text-xs text-ink-400">
              Development build. The company's real details come from Settings.
            </p>
            <ul className="flex flex-wrap gap-4 text-xs text-ink-500">
              <li>
                <Link to="/legal/terms" className="hover:text-ink-900">
                  Terms
                </Link>
              </li>
              <li>
                <Link to="/legal/privacy" className="hover:text-ink-900">
                  Privacy
                </Link>
              </li>
              <li>
                <Link to="/legal/cancellation" className="hover:text-ink-900">
                  Cancellation policy
                </Link>
              </li>
              <li>
                <Link to="/legal/refunds" className="hover:text-ink-900">
                  Refunds
                </Link>
              </li>
            </ul>
          </div>
        </div>
      </footer>
    </div>
  );
}
