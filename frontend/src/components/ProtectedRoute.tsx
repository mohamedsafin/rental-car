/**
 * components/ProtectedRoute.tsx
 * ---------------------------------------------------------------------------
 * Route guard for pages that need a signed-in user.
 *
 * READ THIS BEFORE TRUSTING IT: this is a CONVENIENCE, not security. Anyone can
 * edit JavaScript in their own browser, or skip the browser entirely and call
 * the API with curl. What actually protects data is `authenticate` and
 * `authorize` on the backend. This component exists so honest users see a login
 * page instead of a screen full of failed requests.
 */
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import type { Role } from '../types/auth';

interface ProtectedRouteProps {
  /** If given, the user must hold one of these roles. */
  allowedRoles?: Role[];
  redirectTo?: string;
}

export default function ProtectedRoute({ allowedRoles, redirectTo = '/login' }: ProtectedRouteProps) {
  const { isAuthenticated, isLoading, user } = useAuth();
  const location = useLocation();

  // Wait for the boot-time silent refresh. Without this, a page reload would
  // bounce a logged-in user to /login for a split second before restoring them.
  if (isLoading) {
    return (
      <div className="page-container flex min-h-[50vh] flex-col items-center justify-center gap-4" role="status">
        <span
          aria-hidden
          className="h-6 w-6 animate-spin rounded-full border-2 border-ink-200 border-t-ink-950"
        />
        <p className="text-sm text-ink-500">Loading…</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    // Remember where they were headed, so login can send them back there.
    return <Navigate to={redirectTo} state={{ from: location }} replace />;
  }

  if (allowedRoles && user && !allowedRoles.includes(user.role)) {
    return (
      <div className="page-container pt-14">
        <div className="rounded-card border border-amber-200 bg-amber-50 p-6">
          <h2 className="font-semibold text-amber-900">Access denied</h2>
          <p className="mt-1 text-sm text-amber-800">
            Your account does not have permission to view this page.
          </p>
        </div>
      </div>
    );
  }

  return <Outlet />;
}
