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
    <form onSubmit={submit} className="rounded-card border border-ink-200 bg-ink-50/60 p-5 sm:p-6">
      <h3 className="text-[15px] font-semibold text-ink-950">Upload a document</h3>
      <p className="mt-1 text-xs leading-relaxed text-ink-500">
        JPEG, PNG, WebP or PDF. Your documents are stored privately and are only visible to you and our
        verification team.
      </p>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="field-label">Document type</span>
          <select value={type} onChange={(e) => setType(e.target.value as DocumentType)} className="field-control">
            {(Object.keys(DOCUMENT_LABELS) as DocumentType[]).map((key) => (
              <option key={key} value={key}>
                {DOCUMENT_LABELS[key]}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="field-label">Document number</span>
          <input
            value={documentNumber}
            onChange={(e) => setDocumentNumber(e.target.value)}
            placeholder="Optional"
            className="field-control"
          />
        </label>

        <label className="block">
          <span className="field-label">Expiry date</span>
          <input
            type="date"
            min={TODAY}
            value={expiryDate}
            onChange={(e) => setExpiryDate(e.target.value)}
            className="field-control"
          />
          <span className="mt-1.5 block text-xs text-ink-500">We will remind you before it expires.</span>
        </label>

        <label className="block">
          <span className="field-label">File</span>
          <input
            ref={fileInput}
            type="file"
            required
            accept="image/jpeg,image/png,image/webp,application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full rounded-xl border border-dashed border-ink-300 bg-white p-2 text-sm text-ink-600 file:mr-3 file:cursor-pointer file:rounded-full file:border-0 file:bg-ink-950 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-ink-800"
          />
        </label>
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={upload.isPending} className="btn btn-primary">
          {upload.isPending ? 'Uploading…' : 'Upload document'}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="btn btn-ghost">
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
