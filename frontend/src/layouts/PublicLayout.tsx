/**
 * layouts/PublicLayout.tsx
 * ---------------------------------------------------------------------------
 * Shared chrome (header + footer) for every public customer page. Pages render
 * into the <Outlet />, so navigation never re-renders the header.
 *
 * Real navigation links and the full footer arrive in Phase 3 when there are
 * actual pages to link to.
 */
import { Link, Outlet } from 'react-router-dom';

export default function PublicLayout() {
  const appName = import.meta.env.VITE_APP_NAME ?? 'UAE Car Rental';

  return (
    <div className="flex min-h-full flex-col bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <Link to="/" className="text-lg font-semibold text-slate-900">
            {appName}
          </Link>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
            Phase 1
          </span>
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
