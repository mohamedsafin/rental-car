/**
 * pages/NotFoundPage.tsx
 * ---------------------------------------------------------------------------
 * Catch-all route. Every SPA needs one so an unknown URL shows a friendly page
 * instead of a blank screen - and offers the two ways back into the product.
 */
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

export default function NotFoundPage() {
  return (
    <div className="page-container flex min-h-[60vh] flex-col items-center justify-center py-20 text-center">
      <p className="section-eyebrow">Error 404</p>
      <h1 className="display-heading mt-5 text-[3rem] sm:text-7xl">
        Wrong <span className="font-editorial">turn.</span>
      </h1>
      <p className="mt-5 max-w-md text-[15px] text-ink-500">
        The page you were looking for does not exist, or has moved.
      </p>
      <div className="mt-9 flex flex-wrap justify-center gap-3">
        <Link to="/" className="btn btn-primary btn-lg">
          Back to home
        </Link>
        <Link to="/cars" className="btn btn-outline btn-lg">
          Browse cars
          <ArrowRight aria-hidden className="btn-arrow h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}
