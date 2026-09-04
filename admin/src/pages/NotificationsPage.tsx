/**
 * pages/NotificationsPage.tsx
 * ---------------------------------------------------------------------------
 * The outbound message log and its templates (BRD 42-44).
 *
 * The log is the point. "Did the customer get the confirmation?" is a question
 * support gets asked constantly, and without a log the honest answer is "we
 * think so". Every message is written down before it is handed to a provider,
 * so even a message that failed to send has a row explaining what it was and
 * why it did not go.
 *
 * A SKIPPED row is different from a FAILED one: skipped means we decided not
 * to send (no template, no address on file), failed means we tried and the
 * provider refused.
 */
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  useNotificationTemplates,
  useNotifications,
  useRetryNotification,
  useUpdateTemplate,
} from '../features/output/useOutput';
import { useAuth } from '../hooks/useAuth';

const STATUS_STYLE: Record<string, string> = {
  SENT: 'bg-emerald-100 text-emerald-800',
  PENDING: 'bg-blue-100 text-blue-800',
  FAILED: 'bg-red-100 text-red-700',
  SKIPPED: 'bg-slate-100 text-slate-600',
};

const STATUSES = ['SENT', 'FAILED', 'SKIPPED', 'PENDING'];

export default function NotificationsPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'templates' ? 'templates' : 'log';
  const status = params.get('status') ?? '';
  const page = Number(params.get('page') ?? '1');

  const { user } = useAuth();
  const canEdit = user?.role === 'ADMIN';

  const { data, isPending } = useNotifications({ page, limit: 25, status: status || undefined });
  const { data: templates } = useNotificationTemplates();
  const retry = useRetryNotification();
  const updateTemplate = useUpdateTemplate();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ subject: '', body: '' });
  const [error, setError] = useState<string | null>(null);

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
        <h2 className="text-lg font-semibold text-slate-900">Notifications</h2>
        <p className="text-sm text-slate-500">
          Every message is recorded before it is sent, so a failure leaves evidence rather than
          silence.
        </p>
      </div>

      <div className="flex gap-2">
        {(['log', 'templates'] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setParam('tab', value)}
            className={
              tab === value
                ? 'rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white'
                : 'rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700'
            }
          >
            {value === 'log' ? 'Message log' : 'Templates'}
          </button>
        ))}
      </div>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}

      {tab === 'log' ? (
        <>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setParam('status', '')}
              className={
                status === ''
                  ? 'rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white'
                  : 'rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700'
              }
            >
              All
            </button>
            {STATUSES.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setParam('status', value)}
                className={
                  status === value
                    ? 'rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white'
                    : 'rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700'
                }
              >
                {value.toLowerCase()}
              </button>
            ))}
          </div>

          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            {isPending && <p className="px-5 py-8 text-sm text-slate-500">Loading...</p>}

            {!isPending && items.length === 0 && (
              <p className="px-5 py-8 text-sm text-slate-500">No messages logged yet.</p>
            )}

            <ul className="divide-y divide-slate-100">
              {items.map((notification) => (
                <li key={notification.id} className="px-5 py-3.5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-slate-900">
                          {notification.subject ?? notification.templateKey}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            STATUS_STYLE[notification.status] ?? 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {notification.status.toLowerCase()}
                        </span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                          {notification.channel.toLowerCase()}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-slate-500">
                        {notification.to} · {notification.templateKey} ·{' '}
                        {new Date(notification.createdAt).toLocaleString()}
                      </p>
                      <p className="mt-1 line-clamp-2 text-xs text-slate-600">
                        {notification.preview}
                      </p>
                      {notification.lastError && (
                        <p className="mt-1 text-xs text-red-600">{notification.lastError}</p>
                      )}
                    </div>

                    {notification.status === 'FAILED' && (
                      <button
                        type="button"
                        onClick={() =>
                          retry.mutate(notification.id, { onError: (err) => setError(err.message) })
                        }
                        className="shrink-0 rounded-md border border-slate-300 px-3 py-1 text-xs text-slate-700"
                      >
                        Retry
                      </button>
                    )}
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
        </>
      ) : (
        <div className="space-y-3">
          <p className="rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-800">
            The wording is yours. Placeholders in <code>{'{{braces}}'}</code> are filled from the
            booking - leave them in place or the message loses its detail.
          </p>

          {(templates ?? []).map((template) => (
            <div key={template.id} className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-900">
                    {template.key}{' '}
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                      {template.channel.toLowerCase()}
                    </span>
                  </p>
                  {template.description && (
                    <p className="mt-0.5 text-xs text-slate-500">{template.description}</p>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <span
                    className={
                      template.isActive
                        ? 'rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800'
                        : 'rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600'
                    }
                  >
                    {template.isActive ? 'on' : 'off'}
                  </span>
                  {canEdit && (
                    <>
                      <button
                        type="button"
                        onClick={() =>
                          updateTemplate.mutate(
                            { id: template.id, isActive: !template.isActive },
                            { onError: (err) => setError(err.message) },
                          )
                        }
                        className="rounded-md border border-slate-300 px-3 py-1 text-xs text-slate-700"
                      >
                        {template.isActive ? 'Switch off' : 'Switch on'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(editingId === template.id ? null : template.id);
                          setDraft({ subject: template.subject ?? '', body: template.body });
                        }}
                        className="rounded-md border border-slate-300 px-3 py-1 text-xs text-slate-700"
                      >
                        {editingId === template.id ? 'Close' : 'Edit'}
                      </button>
                    </>
                  )}
                </div>
              </div>

              {editingId === template.id ? (
                <div className="mt-3 space-y-2">
                  {template.channel === 'EMAIL' && (
                    <input
                      aria-label="Subject"
                      value={draft.subject}
                      onChange={(event) => setDraft({ ...draft, subject: event.target.value })}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    />
                  )}
                  <textarea
                    aria-label="Body"
                    rows={10}
                    value={draft.body}
                    onChange={(event) => setDraft({ ...draft, body: event.target.value })}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs"
                  />
                  <button
                    type="button"
                    disabled={updateTemplate.isPending}
                    onClick={() =>
                      updateTemplate.mutate(
                        {
                          id: template.id,
                          subject: template.channel === 'EMAIL' ? draft.subject : undefined,
                          body: draft.body,
                        },
                        {
                          onSuccess: () => setEditingId(null),
                          onError: (err) => setError(err.message),
                        },
                      )
                    }
                    className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                  >
                    Save wording
                  </button>
                </div>
              ) : (
                <pre className="mt-3 max-h-32 overflow-y-auto whitespace-pre-wrap rounded-md bg-slate-50 p-3 font-mono text-xs text-slate-600">
                  {template.body}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
