/**
 * layouts/PublicLayout.tsx
 * ---------------------------------------------------------------------------
 * Shared chrome for every public customer page. Pages render into <Outlet />,
 * so navigating does not re-render the header.
 *
 * The header now reflects auth state: signed-out visitors get Sign in /
 * Register, signed-in customers get their name and a link to the account area.
 */
import { Link, NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export default function PublicLayout() {
  const appName = import.meta.env.VITE_APP_NAME ?? 'UAE Car Rental';
  const { user, isAuthenticated, isLoading } = useAuth();

  return (
    <div className="flex min-h-full flex-col bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4">
          <Link to="/" className="text-lg font-semibold text-slate-900">
            {appName}
          </Link>

          <nav className="flex items-center gap-3 text-sm">
            {isLoading ? (
              <span className="text-slate-400">…</span>
            ) : isAuthenticated ? (
              <>
                <span className="hidden text-slate-600 sm:inline">{user?.fullName}</span>
                <NavLink
                  to="/account"
                  className={({ isActive }) =>
                    isActive
                      ? 'rounded-md bg-slate-900 px-3 py-1.5 font-medium text-white'
                      : 'rounded-md px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-100'
                  }
                >
                  My account
                </NavLink>
              </>
            ) : (
              <>
                <Link to="/login" className="rounded-md px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-100">
                  Sign in
                </Link>
                <Link to="/register" className="rounded-md bg-slate-900 px-3 py-1.5 font-medium text-white hover:bg-slate-800">
                  Register
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <Outlet />
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-5xl px-4 py-4 text-xs text-slate-500">
          Customer website - development build. Legal pages are added in a later phase.
        </div>
      </footer>
    </div>
  );
}
