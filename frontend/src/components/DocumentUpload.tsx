/**
 * components/DocumentUpload.tsx
 * ---------------------------------------------------------------------------
 * Upload one identity document (BRD 12).
 *
 * Deliberately one document at a time, each with its own type, number and
 * expiry. A batch picker would either lose that detail or need a parallel list
 * of metadata that drifts out of step with the files.
 */
import { useRef, useState, type FormEvent } from 'react';
import { useUploadDocument } from '../features/customer/useCustomer';
import { DOCUMENT_LABELS, type DocumentType } from '../types/customer';

const TODAY = new Date().toISOString().slice(0, 10);

export interface DocumentUploadProps {
  /** Pre-selects the type when uploading against a specific requirement. */
  defaultType?: DocumentType;
  onDone?: () => void;
  onCancel?: () => void;
}

export default function DocumentUpload({ defaultType, onDone, onCancel }: DocumentUploadProps) {
  const upload = useUploadDocument();
  const fileInput = useRef<HTMLInputElement>(null);

  const [type, setType] = useState<DocumentType>(defaultType ?? 'EMIRATES_ID');
  const [file, setFile] = useState<File | null>(null);
  const [documentNumber, setDocumentNumber] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!file) {
      setError('Choose a file to upload.');
      return;
    }

    upload.mutate(
      {
        file,
        type,
        documentNumber: documentNumber || undefined,
        expiryDate: expiryDate || undefined,
      },
      {
        onSuccess: () => {
          setFile(null);
          setDocumentNumber('');
          setExpiryDate('');
          if (fileInput.current) fileInput.current.value = '';
          onDone?.();
        },
        onError: (err) => setError(err.message),
      },
    );
  }

  return (
    <form onSubmit={submit} className="rounded-lg border border-ink-200 bg-white p-5">
      <h3 className="font-semibold text-ink-900">Upload a document</h3>
      <p className="mt-1 text-xs text-ink-500">
        JPEG, PNG, WebP or PDF. Your documents are stored privately and are only visible to you and
        our verification team.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-sm font-medium text-ink-700">Document type</span>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as DocumentType)}
            className="mt-1 w-full rounded-md border border-ink-300 px-3 py-2 text-sm"
          >
            {(Object.keys(DOCUMENT_LABELS) as DocumentType[]).map((key) => (
              <option key={key} value={key}>
                {DOCUMENT_LABELS[key]}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-sm font-medium text-ink-700">Document number</span>
          <input
            value={documentNumber}
            onChange={(e) => setDocumentNumber(e.target.value)}
            placeholder="Optional"
            className="mt-1 w-full rounded-md border border-ink-300 px-3 py-2 text-sm"
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium text-ink-700">Expiry date</span>
          <input
            type="date"
            min={TODAY}
            value={expiryDate}
            onChange={(e) => setExpiryDate(e.target.value)}
            className="mt-1 w-full rounded-md border border-ink-300 px-3 py-2 text-sm"
          />
          <span className="mt-1 block text-xs text-ink-500">
            We will remind you before it expires.
          </span>
        </label>

        <label className="block">
          <span className="text-sm font-medium text-ink-700">File</span>
          <input
            ref={fileInput}
            type="file"
            required
            accept="image/jpeg,image/png,image/webp,application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="mt-1 w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-ink-900 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white"
          />
        </label>
      </div>

      {error && (
        <p role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="mt-4 flex items-center gap-3">
        <button
          type="submit"
          disabled={upload.isPending}
          className="rounded-md bg-ink-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {upload.isPending ? 'Uploading...' : 'Upload document'}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="text-sm text-ink-600 hover:underline">
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
