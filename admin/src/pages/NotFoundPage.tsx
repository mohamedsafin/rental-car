import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <div className="py-16 text-center">
      <p className="text-sm font-semibold text-slate-400">404</p>
      <h1 className="mt-2 text-2xl font-bold text-slate-900">Page not found</h1>
      <Link to="/" className="mt-6 inline-block rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white">
        Back to dashboard
      </Link>
    </div>
  );
}
