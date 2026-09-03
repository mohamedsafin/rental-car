/**
 * pages/HomePage.tsx
 * ---------------------------------------------------------------------------
 * Placeholder home page for Phase 1. Its only job right now is to prove the
 * React -> Axios -> Express -> Prisma -> PostgreSQL chain works end to end.
 *
 * The real home page (search widget, featured cars, categories, offers, how it
 * works, locations, reviews, FAQ) is built in Phase 3/4.
 */
import ConnectionStatus from '../components/ConnectionStatus';

export default function HomePage() {
  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl font-bold text-slate-900">Project foundation is running</h1>
        <p className="mt-2 max-w-2xl text-slate-600">
          This page confirms the customer website can reach the backend API and that the backend
          can reach PostgreSQL. Car search, listings and booking are built in the phases ahead.
        </p>
      </section>

      <ConnectionStatus />

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="font-semibold text-slate-900">Coming next</h2>
        <ul className="mt-3 list-inside list-disc space-y-1 text-sm text-slate-600">
          <li>Phase 2 - authentication, users, roles, RBAC</li>
          <li>Phase 3 - vehicles, categories, locations, images</li>
          <li>Phase 4 - availability engine, search, pricing engine</li>
        </ul>
      </section>
    </div>
  );
}
