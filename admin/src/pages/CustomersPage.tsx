/**
 * pages/CustomersPage.tsx
 * ---------------------------------------------------------------------------
 * Customer list with a verification queue (BRD 37).
 *
 * The "Awaiting review" filter is the one staff will actually live in - it is
 * the work queue BRD 13 describes, and the admin dashboard's "Pending Document
 * Verification" tile will link straight here.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useCustomers } from '../features/customer/useCustomerAdmin';

export default function CustomersPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [pendingOnly, setPendingOnly] = useState(false);

  const { data, isPending, isError, error } = useCustomers({
    page,
    limit: 20,
    search: search || undefined,
    pendingDocuments: pendingOnly || undefined,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Customers</h2>
          <p className="text-sm text-slate-600">
            {data ? `${data.pagination.total} customer(s)` : 'Loading...'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={pendingOnly}
              onChange={(e) => {
                setPendingOnly(e.target.checked);
                setPage(1);
              }}
              className="rounded border-slate-300"
            />
            Awaiting document review
          </label>
          <input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Name, email or phone"
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          />
        </div>
      </div>

      {isError && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error.message}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Residency</th>
              <th className="px-4 py-3">Verification</th>
              <th className="px-4 py-3">Pending docs</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {isPending && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                  Loading customers...
                </td>
              </tr>
            )}

            {data?.items.map((customer) => (
              <tr key={customer.id} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-3">
                  <p className="font-medium text-slate-900">{customer.user.fullName}</p>
                  <p className="text-xs text-slate-500">{customer.user.email}</p>
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {customer.residencyStatus === 'UAE_RESIDENT'
                    ? 'UAE resident'
                    : customer.residencyStatus === 'VISITOR'
                      ? 'Visitor'
                      : '-'}
                </td>
                <td className="px-4 py-3">
                  {customer.isVerified ? (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                      Verified
                    </span>
                  ) : (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                      Not verified
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {customer.pendingDocumentCount > 0 ? (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                      {customer.pendingDocumentCount} to review
                    </span>
                  ) : (
                    <span className="text-xs text-slate-400">-</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    to={`/customers/${customer.id}`}
                    className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Open
                  </Link>
                </td>
              </tr>
            ))}

            {data?.items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-500">
                  {pendingOnly ? 'Nothing waiting for review.' : 'No customers yet.'}
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
