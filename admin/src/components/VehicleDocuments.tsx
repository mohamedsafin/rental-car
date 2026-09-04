/**
 * components/VehicleDocuments.tsx
 * ---------------------------------------------------------------------------
 * Mulkiya, insurance certificates and inspection reports for one vehicle
 * (BRD 40).
 *
 * These are stored PRIVATELY, like customer identity documents - a
 * registration card carries the chassis number and the owner's details, and it
 * is not marketing material. So there is no image src to point at: the file is
 * fetched through the authorised route with the Authorization header and shown
 * as a blob URL, and the blob is revoked as soon as the panel closes.
 *
 * Uploading is multipart, which is the one request in the app where the
 * Content-Type header must be REMOVED - the browser has to set it itself
 * because a multipart body needs a `boundary` only it can generate.
 */
import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api';
import { useVehicleDocuments } from '../features/fleetOps/useFleetOps';
import type { NormalisedApiError } from '../types/api';
import type { VehicleDocument } from '../types/fleetOps';

const TYPES = [
  'REGISTRATION',
  'INSURANCE',
  'REGISTRATION_RENEWAL',
  'INSURANCE_RENEWAL',
  'MAINTENANCE_RECORD',
  'INSPECTION_REPORT',
  'OTHER',
];

function DocumentPreview({ document, onClose }: { document: VehicleDocument; onClose: () => void }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Deliberately a click-to-load rather than an effect on mount: opening a
  // vehicle page should not pull every scanned document over the wire.
  async function load() {
    try {
      const response = await api.get(`/fleet/documents/${document.id}/file`, { responseType: 'blob' });
      setBlobUrl(URL.createObjectURL(response.data as Blob));
    } catch {
      setError('Could not load this document.');
    }
  }

  function close() {
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    setBlobUrl(null);
    onClose();
  }

  return (
    <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-3">
      {error && <p className="text-sm text-red-700">{error}</p>}

      {!blobUrl && !error && (
        <button type="button" onClick={load} className="text-sm text-slate-700 underline">
          Load {document.fileName}
        </button>
      )}

      {blobUrl && (
        <div className="space-y-2">
          {document.mimeType === 'application/pdf' ? (
            <iframe title={document.fileName} src={blobUrl} className="h-96 w-full rounded border" />
          ) : (
            <img src={blobUrl} alt={document.fileName} className="max-h-96 rounded border" />
          )}
          <button type="button" onClick={close} className="text-xs text-slate-500 underline">
            Close
          </button>
        </div>
      )}
    </div>
  );
}

export default function VehicleDocuments({ vehicleId }: { vehicleId: string }) {
  const queryClient = useQueryClient();
  const { data: documents, isPending } = useVehicleDocuments(vehicleId);

  const [type, setType] = useState('REGISTRATION');
  const [documentNumber, setDocumentNumber] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const upload = useMutation<VehicleDocument, NormalisedApiError, FormData>({
    mutationFn: async (formData) => {
      const response = await api.post(`/fleet/vehicles/${vehicleId}/documents`, formData, {
        // The browser sets multipart/form-data itself, with the boundary.
        headers: { 'Content-Type': undefined },
      });
      return response.data.data as VehicleDocument;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['vehicle-documents', vehicleId] });
      void queryClient.invalidateQueries({ queryKey: ['expiring'] });
      setFile(null);
      setDocumentNumber('');
      setExpiryDate('');
    },
    onError: (err) => setError(err.message),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!file) {
      setError('Choose a file first.');
      return;
    }

    const formData = new FormData();
    formData.append('document', file);
    formData.append('type', type);
    if (documentNumber) formData.append('documentNumber', documentNumber);
    if (expiryDate) formData.append('expiryDate', expiryDate);

    upload.mutate(formData);
  }

  return (
    <section className="mt-6 rounded-lg border border-slate-200 bg-white p-5">
      <h3 className="text-sm font-semibold text-slate-900">Vehicle documents</h3>
      <p className="mt-1 text-xs text-slate-500">
        Stored privately. There is no public URL - the file is only reachable through an authorised
        request, and every view is written to the audit log.
      </p>

      <form onSubmit={submit} className="mt-4 grid gap-3 sm:grid-cols-4">
        <div>
          <label htmlFor="doc-type" className="block text-xs font-medium text-slate-700">
            Type
          </label>
          <select
            id="doc-type"
            value={type}
            onChange={(event) => setType(event.target.value)}
            className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          >
            {TYPES.map((value) => (
              <option key={value} value={value}>
                {value.replace(/_/g, ' ').toLowerCase()}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="doc-number" className="block text-xs font-medium text-slate-700">
            Document number
          </label>
          <input
            id="doc-number"
            value={documentNumber}
            onChange={(event) => setDocumentNumber(event.target.value)}
            className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
        </div>

        <div>
          <label htmlFor="doc-expiry" className="block text-xs font-medium text-slate-700">
            Expires
          </label>
          <input
            id="doc-expiry"
            type="date"
            value={expiryDate}
            onChange={(event) => setExpiryDate(event.target.value)}
            className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
        </div>

        <div>
          <label htmlFor="doc-file" className="block text-xs font-medium text-slate-700">
            File
          </label>
          <input
            id="doc-file"
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            className="mt-1 block w-full text-xs"
          />
        </div>

        <div className="sm:col-span-4">
          {error && (
            <p className="mb-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={upload.isPending}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {upload.isPending ? 'Uploading...' : 'Upload document'}
          </button>
        </div>
      </form>

      <div className="mt-5">
        {isPending && <p className="text-sm text-slate-500">Loading...</p>}

        {!isPending && (documents ?? []).length === 0 && (
          <p className="text-sm text-slate-500">No documents on file for this vehicle.</p>
        )}

        <ul className="divide-y divide-slate-100">
          {(documents ?? []).map((document) => (
            <li key={document.id} className="py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-slate-900">
                    {document.type.replace(/_/g, ' ').toLowerCase()}
                    {document.documentNumber ? ` - ${document.documentNumber}` : ''}
                  </p>
                  <p className="text-xs text-slate-500">
                    {document.fileName}
                    {document.expiryDate ? ` - expires ${document.expiryDate}` : ' - no expiry recorded'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpenId(openId === document.id ? null : document.id)}
                  className="rounded-md border border-slate-300 px-3 py-1 text-xs text-slate-700"
                >
                  {openId === document.id ? 'Hide' : 'View'}
                </button>
              </div>

              {openId === document.id && (
                <DocumentPreview document={document} onClose={() => setOpenId(null)} />
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
