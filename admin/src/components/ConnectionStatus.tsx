/**
 * components/ConnectionStatus.tsx
 * ---------------------------------------------------------------------------
 * Phase 1 proof that this React app can reach the backend, and that the
 * backend can reach PostgreSQL.
 *
 * Note what this component does NOT do: no fetching logic, no URL, no business
 * rules. It renders whatever the useHealth hook gives it. That separation is
 * the rule for every component in this project.
 */
import { useHealth } from '../hooks/useHealth';

function Row({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 pb-2 last:border-0">
      <dt className="text-slate-600">{label}</dt>
      <dd className="flex items-center gap-2 font-medium text-slate-900">
        <span
          aria-hidden="true"
          className={ok ? 'inline-block h-2 w-2 rounded-full bg-emerald-500' : 'inline-block h-2 w-2 rounded-full bg-red-500'}
        />
        {value}
      </dd>
    </div>
  );
}

export default function ConnectionStatus() {
  const { data, isPending, isError, error, refetch, isFetching } = useHealth();

  if (isPending) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <p className="text-sm text-slate-500">Checking backend connection...</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-5">
        <h2 className="font-semibold text-red-800">Backend unreachable</h2>
        <p className="mt-1 text-sm text-red-700">{error.message}</p>
        <p className="mt-2 text-xs text-red-600">
          Is the backend running on port 4000? Start it with
          <code className="ml-1 rounded bg-red-100 px-1 py-0.5">npm run dev:backend</code>
        </p>
        <button
          type="button"
          onClick={() => void refetch()}
          className="mt-3 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
        >
          Retry
        </button>
      </div>
    );
  }

  const dbUp = data.dependencies.database === 'up';

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-slate-900">System status</h2>
        {isFetching && <span className="text-xs text-slate-400">refreshing...</span>}
      </div>

      <dl className="mt-4 space-y-2 text-sm">
        <Row label="API" value="connected" ok />
        <Row label="Database" value={data.dependencies.database} ok={dbUp} />
        <Row label="Environment" value={data.environment} ok />
        <Row label="API version" value={data.version} ok />
        <Row label="Uptime" value={String(data.uptimeSeconds) + 's'} ok />
      </dl>
    </div>
  );
}
