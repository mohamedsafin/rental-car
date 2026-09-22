/**
 * components/ConnectionStatus.tsx
 * ---------------------------------------------------------------------------
 * Whether this app can reach the backend, and the backend its database.
 *
 * ===========================================================================
 * QUIET WHEN HEALTHY, LOUD WHEN NOT
 * ===========================================================================
 * This used to be a five-row card on the dashboard listing API version, uptime
 * in seconds and the environment name - permanent furniture reporting, every
 * day, that nothing was wrong. Staff stop reading a panel that never changes,
 * which is exactly the panel you need them to read on the morning it does.
 *
 * So healthy is a pill: a green dot and one word. Broken takes over - red,
 * named, with the command to start the backend and a retry button - because at
 * that moment it is the only thing on the page worth looking at.
 *
 * The detail is not lost, just demoted to the pill's tooltip, where it is
 * available to whoever is actually debugging.
 *
 * Note what this component does NOT do: no fetching logic, no URL, no business
 * rules. It renders whatever the useHealth hook gives it. That separation is
 * the rule for every component in this project.
 */
import { useHealth } from '../hooks/useHealth';

export default function ConnectionStatus() {
  const { data, isPending, isError, error, refetch, isFetching } = useHealth();

  if (isPending) {
    return <span className="skeleton inline-block h-6 w-28 rounded-full" aria-hidden />;
  }

  if (isError) {
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-critical-100 bg-critical-50 px-3 py-2"
      >
        <span className="flex items-center gap-2 text-[13px] font-semibold text-critical-700">
          <span aria-hidden className="h-2 w-2 rounded-full bg-critical-600" />
          Backend unreachable
        </span>
        <span className="text-[12px] text-critical-700/80">
          {error.message}. Start it with{' '}
          <code className="rounded bg-critical-100 px-1 py-0.5 font-mono text-[11px]">
            npm run dev:backend
          </code>
        </span>
        <button
          type="button"
          onClick={() => void refetch()}
          className="btn btn-danger btn-sm ml-auto"
        >
          Retry
        </button>
      </div>
    );
  }

  const dbUp = data.dependencies.database === 'up';

  // Reachable but the database is down is its own state, and a worse one than
  // being unable to reach the API at all: the app answers, and every page it
  // draws is empty.
  if (!dbUp) {
    return (
      <div
        role="alert"
        className="flex items-center gap-2 rounded-lg border border-critical-100 bg-critical-50 px-3 py-2 text-[13px] font-semibold text-critical-700"
      >
        <span aria-hidden className="h-2 w-2 rounded-full bg-critical-600" />
        Database is {data.dependencies.database}
      </div>
    );
  }

  return (
    <span
      title={`API ${data.version} · ${data.environment} · up ${Math.floor(data.uptimeSeconds / 60)} min`}
      className="inline-flex items-center gap-2 rounded-full border border-ink-100 bg-white px-2.5 py-1 text-[12px] font-medium text-ink-600"
    >
      <span
        aria-hidden
        className={`h-1.5 w-1.5 rounded-full bg-positive-600 ${isFetching ? 'animate-pulse' : ''}`}
      />
      All systems normal
    </span>
  );
}
