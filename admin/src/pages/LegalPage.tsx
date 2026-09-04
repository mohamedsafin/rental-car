/**
 * pages/LegalPage.tsx
 * ---------------------------------------------------------------------------
 * Terms, privacy and policy documents (BRD 45-47).
 *
 * A published version is read-only here, and the UI says why: customers agreed
 * to that exact text, and editing it in place would destroy the only record of
 * what they agreed to. Changing the terms means writing a new version, which
 * supersedes the old one without deleting it.
 *
 * Nothing ships pre-written. Drafting a cancellation clause on the client's
 * behalf would be worse than an empty page - an empty page gets filled in, an
 * invented clause gets relied upon.
 */
import { useState, type FormEvent } from 'react';
import {
  useCreateLegalVersion,
  useLegalVersions,
  usePublishLegal,
  useUpdateLegalDraft,
} from '../features/output/useOutput';
import type { LegalDocument } from '../types/output';

const TYPES = [
  { value: 'TERMS_AND_CONDITIONS', label: 'Terms & conditions' },
  { value: 'PRIVACY_POLICY', label: 'Privacy policy' },
  { value: 'RENTAL_AGREEMENT', label: 'Rental agreement' },
  { value: 'CANCELLATION_POLICY', label: 'Cancellation policy' },
  { value: 'REFUND_POLICY', label: 'Refund policy' },
] as const;

const EMPTY = { type: 'TERMS_AND_CONDITIONS', title: '', content: '' };

export default function LegalPage() {
  const { data: versions, isPending } = useLegalVersions();
  const create = useCreateLegalVersion();
  const updateDraft = useUpdateLegalDraft();
  const publish = usePublishLegal();

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftContent, setDraftContent] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    create.mutate(
      { type: form.type, title: form.title, content: form.content },
      {
        onSuccess: () => {
          setShowForm(false);
          setForm(EMPTY);
        },
        onError: (err) => setError(err.message),
      },
    );
  }

  const byType = new Map<string, LegalDocument[]>();
  for (const document of versions ?? []) {
    const list = byType.get(document.type) ?? [];
    list.push(document);
    byType.set(document.type, list);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Legal documents</h2>
          <p className="text-sm text-slate-500">
            Versioned, so a dispute can be answered with the text that was live on the day.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((open) => !open)}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          {showForm ? 'Cancel' : 'New version'}
        </button>
      </div>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}

      {showForm && (
        <form onSubmit={submit} className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="type" className="block text-sm font-medium text-slate-700">
                Document
              </label>
              <select
                id="type"
                value={form.type}
                onChange={(event) => setForm({ ...form, type: event.target.value })}
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                {TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="title" className="block text-sm font-medium text-slate-700">
                Title
              </label>
              <input
                id="title"
                required
                value={form.title}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div>
            <label htmlFor="content" className="block text-sm font-medium text-slate-700">
              Content
            </label>
            <textarea
              id="content"
              required
              rows={16}
              value={form.content}
              onChange={(event) => setForm({ ...form, content: event.target.value })}
              placeholder="Markdown. The customer site renders it."
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs"
            />
            <p className="mt-1 text-xs text-slate-500">
              Saved as a draft. Nothing is shown to customers until you publish it.
            </p>
          </div>

          <button
            type="submit"
            disabled={create.isPending}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {create.isPending ? 'Saving...' : 'Save draft'}
          </button>
        </form>
      )}

      {isPending && <p className="text-sm text-slate-500">Loading...</p>}

      {!isPending && (versions ?? []).length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center">
          <p className="font-medium text-slate-700">No legal documents yet</p>
          <p className="mx-auto mt-1 max-w-lg text-sm text-slate-500">
            Nothing is pre-written on purpose. Terms, privacy and cancellation policy carry legal
            weight and have to be the client&rsquo;s own words.
          </p>
        </div>
      )}

      {TYPES.map((type) => {
        const documents = byType.get(type.value);
        if (!documents || documents.length === 0) return null;

        return (
          <section key={type.value} className="rounded-lg border border-slate-200 bg-white">
            <header className="border-b border-slate-200 px-5 py-3">
              <h3 className="text-sm font-semibold text-slate-900">{type.label}</h3>
            </header>

            <ul className="divide-y divide-slate-100">
              {documents.map((document) => (
                <li key={document.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-slate-900">
                        {document.title}{' '}
                        <span className="text-slate-400">v{document.version}</span>
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {document.isPublished
                          ? `Live since ${document.publishedAt?.slice(0, 10)}`
                          : `Draft, last edited ${document.updatedAt.slice(0, 10)}`}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      {document.isPublished ? (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                          live
                        </span>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(editingId === document.id ? null : document.id);
                              setDraftContent(document.content);
                            }}
                            className="rounded-md border border-slate-300 px-3 py-1 text-xs text-slate-700"
                          >
                            {editingId === document.id ? 'Close' : 'Edit'}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              publish.mutate(document.id, { onError: (err) => setError(err.message) })
                            }
                            className="rounded-md bg-slate-900 px-3 py-1 text-xs font-medium text-white"
                          >
                            Publish
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {editingId === document.id ? (
                    <div className="mt-3 space-y-2">
                      <textarea
                        aria-label="Content"
                        rows={14}
                        value={draftContent}
                        onChange={(event) => setDraftContent(event.target.value)}
                        className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs"
                      />
                      <button
                        type="button"
                        disabled={updateDraft.isPending}
                        onClick={() =>
                          updateDraft.mutate(
                            { id: document.id, content: draftContent },
                            {
                              onSuccess: () => setEditingId(null),
                              onError: (err) => setError(err.message),
                            },
                          )
                        }
                        className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                      >
                        Save draft
                      </button>
                    </div>
                  ) : (
                    <pre className="mt-3 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md bg-slate-50 p-3 font-mono text-xs text-slate-600">
                      {document.content}
                    </pre>
                  )}

                  {document.isPublished && (
                    <p className="mt-2 text-xs text-slate-500">
                      Published text is read-only. Customers agreed to these exact words - to change
                      them, add a new version.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
