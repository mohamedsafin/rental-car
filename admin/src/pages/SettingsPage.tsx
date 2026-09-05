/**
 * pages/SettingsPage.tsx
 * ---------------------------------------------------------------------------
 * The client-owned configuration (BRD 51).
 *
 * Every value the BRD marks "to be provided by the client" lives here: VAT,
 * deposits, cancellation windows and fees, late and fuel rates, required
 * documents, the company's registered address and its Tax Registration Number.
 *
 * They ship BLANK on purpose, and this screen says so out loud. A blank VAT
 * rate makes the pricing engine apply no tax and warn; a blank TRN makes every
 * invoice print "this is not a valid tax invoice". Both are recoverable. An
 * invented figure quietly charged to a real customer is not, which is why
 * nothing here was pre-filled with a plausible-looking default.
 *
 * So the page leads with what is still MISSING rather than burying it in a
 * list of eighty rows that all look alike.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getData, patchData } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import type { NormalisedApiError } from '../types/api';

interface Setting {
  key: string;
  value: string;
  valueType: 'STRING' | 'NUMBER' | 'BOOLEAN' | 'JSON';
  category: string;
  label: string;
  description: string | null;
  isSystem: boolean;
  isConfigured: boolean;
  updatedAt: string;
}

interface SettingsResponse {
  groups: { category: string; settings: Setting[] }[];
  unconfigured: number;
}

const CATEGORY_BLURB: Record<string, string> = {
  COMPANY: 'Printed on invoices. The TRN is legally required on a UAE tax invoice.',
  PRICING: 'Applied by the quote engine. A blank VAT rate means no tax is charged.',
  RENTAL_POLICY: 'Cancellation windows, deposits, and the rates used at return.',
  DOCUMENTS: 'Which documents a customer must supply before they can be verified.',
  PAYMENT: 'Gateway configuration. Secrets live in the environment, not here.',
  NOTIFICATION: 'Message defaults. The wording itself is under Notifications.',
  LEGAL: 'Pointers to the versioned legal documents.',
  SYSTEM: 'Structural values. Mostly not editable.',
};

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canEdit = user?.role === 'ADMIN';

  const { data, isPending } = useQuery<SettingsResponse, NormalisedApiError>({
    queryKey: ['settings'],
    queryFn: () => getData<SettingsResponse>('/settings'),
  });

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);

  const save = useMutation<unknown, NormalisedApiError, { key: string; value: string }>({
    mutationFn: ({ key, value }) => patchData(`/settings/${key}`, { value }),
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
      // Quotes and invoices read these, so anything showing money is stale.
      void queryClient.invalidateQueries({ queryKey: ['report-dashboard'] });
      setSavedKey(variables.key);
      setDrafts((current) => {
        const next = { ...current };
        delete next[variables.key];
        return next;
      });
      setTimeout(() => setSavedKey(null), 2500);
    },
    onError: (err) => setError(err.message),
  });

  if (isPending) return <p className="text-sm text-slate-500">Loading settings...</p>;

  return (
    <div className="max-w-4xl space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Settings</h2>
        <p className="text-sm text-slate-500">
          The values the BRD leaves to the client. Blank means &ldquo;not confirmed yet&rdquo;, and
          the system treats it that way rather than guessing.
        </p>
      </div>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}

      {data && data.unconfigured > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-900">
            {data.unconfigured} setting{data.unconfigured === 1 ? '' : 's'} still unconfigured
          </p>
          <p className="mt-1 text-xs text-amber-800">
            Until each is filled in, the system omits rather than invents: no VAT is applied, no
            cancellation fee is charged, and invoices state that they are not valid tax invoices.
            Every one of those is visible to a customer.
          </p>
        </div>
      )}

      {!canEdit && (
        <p className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-600">
          Read-only. These values decide what customers are charged, so only an admin can change
          them.
        </p>
      )}

      {(data?.groups ?? []).map((group) => (
        <section key={group.category} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <header className="border-b border-slate-200 px-5 py-3">
            <h3 className="text-sm font-semibold text-slate-900">
              {group.category.replace(/_/g, ' ').toLowerCase()}
            </h3>
            {CATEGORY_BLURB[group.category] && (
              <p className="mt-0.5 text-xs text-slate-500">{CATEGORY_BLURB[group.category]}</p>
            )}
          </header>

          <ul className="divide-y divide-slate-100">
            {group.settings.map((setting) => {
              const draft = drafts[setting.key];
              const current = draft ?? setting.value;
              const dirty = draft !== undefined && draft !== setting.value;

              return (
                <li key={setting.key} className="px-5 py-3.5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <label
                          htmlFor={setting.key}
                          className="text-sm font-medium text-slate-900"
                        >
                          {setting.label}
                        </label>
                        {!setting.isConfigured && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                            not set
                          </span>
                        )}
                        {setting.isSystem && (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
                            system
                          </span>
                        )}
                      </div>
                      <code className="text-[11px] text-slate-400">{setting.key}</code>
                      {setting.description && (
                        <p className="mt-1 text-xs text-slate-500">{setting.description}</p>
                      )}
                    </div>

                    <div className="flex w-full items-center gap-2 sm:w-auto">
                      {setting.valueType === 'BOOLEAN' ? (
                        <select
                          id={setting.key}
                          disabled={!canEdit || setting.isSystem}
                          value={current}
                          onChange={(event) =>
                            setDrafts({ ...drafts, [setting.key]: event.target.value })
                          }
                          className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm sm:w-56"
                        >
                          <option value="">Not set</option>
                          <option value="true">Yes</option>
                          <option value="false">No</option>
                        </select>
                      ) : (
                        <input
                          id={setting.key}
                          disabled={!canEdit || setting.isSystem}
                          value={current}
                          inputMode={setting.valueType === 'NUMBER' ? 'decimal' : undefined}
                          placeholder={setting.valueType === 'JSON' ? '[]' : 'Not set'}
                          onChange={(event) =>
                            setDrafts({ ...drafts, [setting.key]: event.target.value })
                          }
                          className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm disabled:bg-slate-50 sm:w-56"
                        />
                      )}

                      {dirty ? (
                        <button
                          type="button"
                          disabled={save.isPending}
                          onClick={() => {
                            setError(null);
                            save.mutate({ key: setting.key, value: current });
                          }}
                          className="shrink-0 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
                        >
                          Save
                        </button>
                      ) : (
                        <span className="w-12 shrink-0 text-xs text-emerald-700">
                          {savedKey === setting.key ? 'saved' : ''}
                        </span>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
