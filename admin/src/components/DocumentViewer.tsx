/**
 * components/DocumentViewer.tsx
 * ---------------------------------------------------------------------------
 * Shows an identity document so staff can check it against the entered details.
 *
 * Note it cannot simply be `<img src={path}>`. The file lives behind an
 * authorised route that needs the Authorization header, so the bytes are
 * fetched through Axios and turned into a blob URL. That indirection IS the
 * security property - there is no URL anyone can paste into a browser.
 *
 * The blob URL is revoked on unmount so the document does not linger in memory
 * after staff navigate away.
 */
import { useEffect, useState } from 'react';
import { customerService } from '../services/customer.service';
import type { CustomerDocument } from '../types/customer';

export default function DocumentViewer({ document }: { document: CustomerDocument }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let revoked = false;
    let url: string | null = null;

    customerService
      .getDocumentBlobUrl(document.downloadPath)
      .then((result) => {
        if (revoked) {
          URL.revokeObjectURL(result);
          return;
        }
        url = result;
        setBlobUrl(result);
      })
      .catch(() => setError('Could not load this document.'));

    return () => {
      revoked = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [document.downloadPath]);

  if (error) {
    return (
      <div className="flex h-64 items-center justify-center rounded-md border border-red-200 bg-red-50 text-sm text-red-700">
        {error}
      </div>
    );
  }

  if (!blobUrl) {
    return <div className="h-64 animate-pulse rounded-md bg-slate-200" />;
  }

  if (document.mimeType === 'application/pdf') {
    return (
      <object data={blobUrl} type="application/pdf" className="h-96 w-full rounded-md border border-slate-200">
        <p className="p-4 text-sm text-slate-600">
          This PDF cannot be previewed here.{' '}
          <a href={blobUrl} target="_blank" rel="noreferrer" className="underline">
            Open it in a new tab
          </a>
          .
        </p>
      </object>
    );
  }

  return (
    <img
      src={blobUrl}
      alt={`${document.type} document`}
      className="max-h-96 w-full rounded-md border border-slate-200 object-contain"
    />
  );
}
