/**
 * components/InvoicePanel.tsx
 * ---------------------------------------------------------------------------
 * The customer's invoices for one booking (BRD 28).
 *
 * The PDF cannot be a plain <a href>: the download route needs the
 * Authorization header, and a bare link arrives without a token and 401s. So
 * the bytes are fetched through Axios and handed to the browser as a blob URL.
 * That indirection IS the access control - there is no URL anyone can paste.
 *
 * The panel renders nothing at all when there are no invoices. An empty
 * "Invoices (0)" box on every booking is noise on the majority of pages where
 * an invoice has not been issued yet.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { api, getData } from '../services/api';
import type { NormalisedApiError, PaginatedData } from '../types/api';

interface CustomerInvoice {
  id: string;
  invoiceNumber: string;
  type: 'INVOICE' | 'CREDIT_NOTE';
  status: 'ISSUED' | 'PAID' | 'CANCELLED';
  total: string;
  currency: string;
  taxTotal: string;
  taxPercentage: string | null;
  issuedAt: string;
  reason: string | null;
}

export default function InvoicePanel({ bookingId }: { bookingId: string }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data } = useQuery<PaginatedData<CustomerInvoice>, NormalisedApiError>({
    queryKey: ['my-invoices', bookingId],
    queryFn: () => getData<PaginatedData<CustomerInvoice>>('/invoices', { bookingId, limit: 20 }),
  });

  const invoices = data?.items ?? [];
  if (invoices.length === 0) return null;

  async function download(invoice: CustomerInvoice) {
    setBusyId(invoice.id);
    setError(null);

    try {
      const response = await api.get(`/invoices/${invoice.id}/pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(response.data as Blob);

      const link = document.createElement('a');
      link.href = url;
      link.download = `${invoice.invoiceNumber}.pdf`;
      link.click();

      // Revoked after the browser has had a chance to start the download.
      // Holding it would keep the document in memory for the session.
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch {
      setError('Could not download that invoice. Please try again.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section aria-labelledby="invoices-title" className="surface p-5 sm:p-6">
      <h2 id="invoices-title" className="text-[15px] font-semibold text-ink-950">
        Invoices
      </h2>

      {error && (
        <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
          {error}
        </p>
      )}

      <ul className="mt-3 divide-y divide-ink-100">
        {invoices.map((invoice) => (
          <li key={invoice.id} className="flex flex-wrap items-center justify-between gap-3 py-3.5">
            <div>
              <p className="font-mono text-sm font-medium text-ink-950">
                {invoice.invoiceNumber}
                {invoice.type === 'CREDIT_NOTE' && (
                  <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 font-sans text-xs font-medium text-amber-800">
                    credit note
                  </span>
                )}
                {invoice.status === 'CANCELLED' && (
                  <span className="ml-2 rounded-full bg-ink-100 px-2 py-0.5 font-sans text-xs font-medium text-ink-600">
                    superseded
                  </span>
                )}
              </p>
              <p className="mt-0.5 text-xs text-ink-500">
                Issued {invoice.issuedAt.slice(0, 10)}
                {invoice.taxPercentage ? ` · includes ${invoice.currency} ${invoice.taxTotal} VAT` : ''}
                {invoice.reason ? ` · ${invoice.reason}` : ''}
              </p>
            </div>

            <div className="flex items-center gap-3">
              <span className="tabular text-sm font-semibold text-ink-950">
                {invoice.currency} {invoice.total}
              </span>
              <button
                type="button"
                disabled={busyId === invoice.id}
                onClick={() => download(invoice)}
                className="btn btn-outline btn-sm"
              >
                <Download aria-hidden className="h-3.5 w-3.5" />
                {busyId === invoice.id ? 'Preparing…' : 'PDF'}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
