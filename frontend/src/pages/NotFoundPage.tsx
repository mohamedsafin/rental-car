/**
 * pages/NotFoundPage.tsx
 * ---------------------------------------------------------------------------
 * Catch-all route. Every SPA needs one so an unknown URL shows a friendly page
 * instead of a blank screen.
 */
import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <div className="py-16 text-center">
      <p className="text-sm font-semibold text-ink-400">404</p>
      <h1 className="mt-2 text-2xl font-bold text-ink-900">Page not found</h1>
      <Link to="/" className="mt-6 inline-block rounded-md bg-ink-900 px-4 py-2 text-sm font-medium text-white">
        Back to home
      </Link>
    </div>
  );
}
