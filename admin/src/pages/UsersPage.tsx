/**
 * pages/UsersPage.tsx
 * ---------------------------------------------------------------------------
 * Admin user management (BRD 27 "Users/Roles").
 *
 * The role and status dropdowns send a PATCH straight to the API. Watch what
 * happens when you try to demote yourself: the request goes out, the backend
 * refuses with 403, and the error appears here. The UI does not pre-emptively
 * hide the option - the server's answer is the one that counts, and seeing the
 * refusal is more honest than pretending the option was never there.
 */
import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useUpdateUser, useUsers } from '../features/users/useUsers';
import type { Role, UserStatus } from '../types/auth';

const ROLES: Role[] = ['CUSTOMER', 'STAFF', 'ADMIN'];
const STATUSES: UserStatus[] = ['ACTIVE', 'SUSPENDED', 'DEACTIVATED'];

export default function UsersPage() {
  const { user: currentUser } = useAuth();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, isPending, isError, error } = useUsers({ page, limit: 20, search: search || undefined });
  const updateUser = useUpdateUser();

  function applyChange(id: string, changes: { role?: Role; status?: UserStatus }) {
    setActionError(null);
    updateUser.mutate({ id, changes }, { onError: (err) => setActionError(err.message) });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Users &amp; roles</h2>
          <p className="text-sm text-slate-600">
            {data ? `${data.pagination.total} accounts` : 'Loading…'}
          </p>
        </div>
        <input
          type="search"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
          placeholder="Search name or email"
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-slate-500"
        />
      </div>

      {actionError && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {actionError}
        </div>
      )}

      {isError && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error.message}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {isPending && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                  Loading users…
                </td>
              </tr>
            )}

            {data?.items.map((row) => (
              <tr key={row.id} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-3 font-medium text-slate-900">
                  {row.fullName}
                  {row.id === currentUser?.id && (
                    <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">you</span>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-600">{row.email}</td>
                <td className="px-4 py-3">
                  <select
                    value={row.role}
                    onChange={(event) => applyChange(row.id, { role: event.target.value as Role })}
                    className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                  >
                    {ROLES.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-3">
                  <select
                    value={row.status}
                    onChange={(event) => applyChange(row.id, { status: event.target.value as UserStatus })}
                    className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                  >
                    {STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}

            {data?.items.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                  No users match that search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {data && data.pagination.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-slate-600">
            Page {data.pagination.page} of {data.pagination.totalPages}
          </span>
          <button
            type="button"
            disabled={page >= data.pagination.totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
