/**
 * pages/InvoicesPage.tsx
 * ---------------------------------------------------------------------------
 * Invoices and credit notes (BRD 28).
 *
 * There is no edit button and no delete button on this page, and that absence
 * is the feature. An issued invoice is a tax document; the only correction is
 * a credit note, which is why the credit action asks for a reason and says out
 * loud what it is about to do.
 *
 * The PDF opens through an authenticated fetch rather than a plain link,
 * because the download route needs the Authorization header - a bare <a href>
 * would arrive without a token and 401.
 */
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../services/api';
import { useCreditNote, useInvoices } from '../features/output/useOutput';
import { useAuth } from '../hooks/useAuth';

const STATUS_STYLE: Record<string, string> = {
  ISSUED: 'bg-blue-100 text-blue-800',
  PAID: 'bg-emerald-100 text-emerald-800',
  CANCELLED: 'bg-slate-100 text-slate-500',
};

export default function InvoicesPage() {
  const [params, setParams] = useSearchParams();
  const page = Number(params.get('page') ?? '1');

  const { user } = useAuth();
  const canCredit = user?.role === 'ADMIN';

  const { data, isPending } = useInvoices({ page, limit: 20 });
  const credit = useCreditNote();

  const [openId, setOpenId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function setPage(next: number) {
    const params = new URLSearchParams();
    params.set('page', String(next));
    setParams(params);
  }

  /**
   * Fetch the PDF with the auth header, then hand the browser a blob URL.
   * Revoked immediately after: the tab keeps its own reference, and holding
   * ours would leak the document into memory for the life of the session.
   */
  async function openPdf(id: string, invoiceNumber: string) {
    setBusyId(id);
    setError(null);

    try {
      const response = await api.get(`/invoices/${id}/pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(response.data as Blob);
      const opened = window.open(url, '_blank');

      if (!opened) {
        // Pop-up blocked. Fall back to a download so the click still does
        // something rather than silently failing.
        const link = document.createElement('a');
        link.href = url;
        link.download = `${invoiceNumber}.pdf`;
        link.click();
      }

      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      setError('Could not load that invoice.');
    } finally {
      setBusyId(null);
    }
  }

  function submitCredit(id: string) {
    setError(null);
    credit.mutate(
      { id, reason },
      {
        onSuccess: () => {
          setOpenId(null);
          setReason('');
        },
        onError: (err) => setError(err.message),
      },
    );
  }

  const items = data?.items ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Invoices</h2>
        <p className="text-sm text-slate-500">
          Issued documents are immutable. Corrections are credit notes, never edits.
        </p>
      </div>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        {isPending && <p className="px-5 py-8 text-sm text-slate-500">Loading...</p>}

        {!isPending && items.length === 0 && (
          <p className="px-5 py-8 text-sm text-slate-500">
            No invoices yet. Issue one from a booking&rsquo;s page once it is confirmed.
          </p>
        )}

        <ul className="divide-y divide-slate-100">
          {items.map((invoice) => (
            <li key={invoice.id} className="px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-medium text-slate-900">
                      {invoice.invoiceNumber}
                    </span>
                    {invoice.type === 'CREDIT_NOTE' && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                        credit note
                      </span>
                    )}
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        STATUS_STYLE[invoice.status] ?? 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {invoice.status.toLowerCase()}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {invoice.customer.name} · booking {invoice.bookingNumber ?? invoice.bookingId} ·
                    issued {invoice.issuedAt.slice(0, 10)}
                  </p>
                  {invoice.reason && (
                    <p className="mt-1 text-xs text-slate-500">Reason: {invoice.reason}</p>
                  )}
                </div>

                <div className="text-right">
                  <p className="text-lg font-semibold text-slate-900">
                    {invoice.currency} {invoice.total}
                  </p>
                  <p className="text-xs text-slate-500">
                    {invoice.taxPercentage
                      ? `incl. ${invoice.currency} ${invoice.taxTotal} VAT at ${Number(invoice.taxPercentage)}%`
                      : 'no VAT applied'}
                  </p>
                </div>
              </div>

              {!invoice.company.trn && (
                <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  No Tax Registration Number was configured when this was issued, so it is not a
                  valid UAE tax invoice. Set <code>company.trn</code> in Settings before issuing
                  more.
                </p>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={busyId === invoice.id}
                  onClick={() => openPdf(invoice.id, invoice.invoiceNumber)}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-700 disabled:opacity-60"
                >
                  {busyId === invoice.id ? 'Opening...' : 'Open PDF'}
                </button>

                {canCredit && invoice.type === 'INVOICE' && invoice.status !== 'CANCELLED' && (
                  openId === invoice.id ? (
                    <>
                      <input
                        aria-label="Reason for the credit note"
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                        placeholder="Why is this being corrected?"
                        className="w-72 rounded-md border border-slate-300 px-3 py-1.5 text-xs"
                      />
                      <button
                        type="button"
                        disabled={credit.isPending || reason.trim().length < 3}
                        onClick={() => submitCredit(invoice.id)}
                        className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
                      >
                        Issue credit note
                      </button>
                      <button
                        type="button"
                        onClick={() => setOpenId(null)}
                        className="text-xs text-slate-500 underline"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setOpenId(invoice.id);
                        setReason('');
                      }}
                      className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-700"
                    >
                      Correct with a credit note
                    </button>
                  )
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
              onClick={() => setPage(page - 1)}
              className="rounded-md border border-slate-300 px-3 py-1.5 disabled:opacity-50"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={page >= data.pagination.totalPages}
              onClick={() => setPage(page + 1)}
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
