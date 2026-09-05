/**
 * pages/AuditLogPage.tsx
 * ---------------------------------------------------------------------------
 * The audit trail (BRD 36).
 *
 * The log has been written since Phase 2 and, until now, could only be read
 * with SQL - which means it was a trail nobody consulted. "Who approved that
 * document?", "who set VAT to zero?" and "who looked at this customer's
 * passport?" are support questions, and they need an answer that does not
 * require a database client.
 *
 * READ ONLY, and admin-only. Not because staff cannot be trusted, but because
 * the trail records who VIEWED which customer's identity documents - handing
 * that to everyone turns an accountability record into a surveillance feed on
 * colleagues.
 *
 * There is no delete button anywhere on this page. A trail that can be edited
 * from the application it audits is worth nothing.
 */
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getData } from '../services/api';
import type { NormalisedApiError, PaginatedData } from '../types/api';

interface AuditEntry {
  id: string;
  action: string;
  actorEmail: string | null;
  actorRole: string | null;
  entityType: string | null;
  entityId: string | null;
  metadata: unknown;
  ipAddress: string | null;
  createdAt: string;
}

/** Colour by what the action DOES, so risk stands out without reading. */
function toneFor(action: string): string {
  if (/deleted|removed|cancelled|rejected|failed|waive/.test(action)) return 'bg-red-100 text-red-800';
  if (/viewed|retrieved|login/.test(action)) return 'bg-slate-100 text-slate-600';
  if (/approved|created|issued|paid|succeeded/.test(action)) return 'bg-emerald-100 text-emerald-800';
  if (/changed|updated|settled/.test(action)) return 'bg-amber-100 text-amber-800';
  return 'bg-blue-100 text-blue-800';
}

export default function AuditLogPage() {
  const [params, setParams] = useSearchParams();
  const page = Number(params.get('page') ?? '1');
  const action = params.get('action') ?? '';
  const search = params.get('search') ?? '';

  const { data, isPending } = useQuery<PaginatedData<AuditEntry>, NormalisedApiError>({
    queryKey: ['audit', page, action, search],
    queryFn: () =>
      getData<PaginatedData<AuditEntry>>('/audit', {
        page,
        limit: 50,
        ...(action ? { action } : {}),
        ...(search ? { search } : {}),
      }),
    placeholderData: (previous) => previous,
  });

  // Offers the actions that actually exist, rather than a hardcoded list that
  // drifts every time a module is added.
  const { data: actions } = useQuery<{ action: string; count: number }[], NormalisedApiError>({
    queryKey: ['audit-actions'],
    queryFn: () => getData<{ action: string; count: number }[]>('/audit/actions'),
    staleTime: 60_000,
  });

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next);
  }

  const items = data?.items ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Audit log</h2>
        <p className="text-sm text-slate-500">
          Every significant action, with who did it and from where. Written by the system and never
          editable from here.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">Action</span>
          <select
            value={action}
            onChange={(event) => setParam('action', event.target.value)}
            className="w-64 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          >
            <option value="">All actions</option>
            {(actions ?? []).map((row) => (
              <option key={row.action} value={row.action}>
                {row.action} ({row.count})
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">Who / what</span>
          <input
            type="search"
            defaultValue={search}
            onChange={(event) => setParam('search', event.target.value)}
            placeholder="Email or action"
            className="w-56 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          />
        </label>

        {(action || search) && (
          <button
            type="button"
            onClick={() => setParams(new URLSearchParams())}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
          >
            Clear
          </button>
        )}

        <span className="ml-auto text-xs text-slate-500">
          {data ? `${data.pagination.total.toLocaleString()} entries` : ''}
        </span>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        {isPending && <p className="px-5 py-8 text-sm text-slate-500">Loading...</p>}

        {!isPending && items.length === 0 && (
          <p className="px-5 py-10 text-center text-sm text-slate-500">No entries match.</p>
        )}

        <ul className="divide-y divide-slate-100">
          {items.map((entry) => (
            <li key={entry.id} className="px-5 py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${toneFor(entry.action)}`}
                    >
                      {entry.action}
                    </span>
                    {entry.entityType && (
                      <span className="text-xs text-slate-500">
                        {entry.entityType}
                        {entry.entityId ? ` ${entry.entityId.slice(0, 8)}` : ''}
                      </span>
                    )}
                  </div>

                  <p className="mt-1 text-xs text-slate-600">
                    {/*
                      The snapshot, not a join. The entry survives the actor
                      being deleted, which is why the email is stored on it.
                    */}
                    {entry.actorEmail ?? 'anonymous'}
                    {entry.actorRole ? ` (${entry.actorRole.toLowerCase()})` : ''}
                    {entry.ipAddress ? ` · ${entry.ipAddress}` : ''}
                  </p>

                  {entry.metadata != null && Object.keys(entry.metadata).length > 0 && (
                    <pre className="mt-1 max-w-2xl overflow-x-auto whitespace-pre-wrap rounded bg-slate-50 px-2 py-1 font-mono text-[11px] text-slate-600">
                      {JSON.stringify(entry.metadata)}
                    </pre>
                  )}
                </div>

                <time className="shrink-0 text-xs text-slate-400">
                  {new Date(entry.createdAt).toLocaleString()}
                </time>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {data && data.pagination.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-slate-600">
          <span>
            Page {data.pagination.page} of {data.pagination.totalPages}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setParam('page', String(page - 1))}
              className="rounded-md border border-slate-300 px-3 py-1.5 disabled:opacity-50"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={page >= data.pagination.totalPages}
              onClick={() => setParam('page', String(page + 1))}
              className="rounded-md border border-slate-300 px-3 py-1.5 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
