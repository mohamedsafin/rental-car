/**
 * pages/DocumentsPage.tsx
 * ---------------------------------------------------------------------------
 * "My documents" (BRD 22), driven by the checklist the backend computes.
 *
 * The requirement list is NOT hardcoded here. It comes from the API, which
 * reads it from settings the operator configures - BRD 12 says the exact
 * document list is client-approved, so the UI renders whatever it is told
 * rather than assuming Emirates ID + licence.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import DocumentUpload from '../components/DocumentUpload';
import { useMyDocuments, useMyProfile, useUpdateMyProfile } from '../features/customer/useCustomer';
import { DOCUMENT_LABELS, STATUS_STYLE, type DocumentType } from '../types/customer';

const STATUS_TEXT: Record<string, string> = {
  APPROVED: 'Approved',
  PENDING: 'Awaiting review',
  REJECTED: 'Rejected',
  EXPIRED: 'Expired',
  MISSING: 'Not uploaded',
};

export default function DocumentsPage() {
  const { data: profile, isPending } = useMyProfile();
  const { data: documentData } = useMyDocuments();
  const updateProfile = useUpdateMyProfile();

  const [uploadingFor, setUploadingFor] = useState<DocumentType | null>(null);
  const [showGeneral, setShowGeneral] = useState(false);

  if (isPending) return <div className="h-64 animate-pulse rounded-lg bg-slate-200" />;
  if (!profile) return null;

  const { verification } = profile;

  return (
    <div className="space-y-6">
      <div>
        <Link to="/account" className="text-sm text-slate-500 hover:underline">
          &larr; My account
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">My documents</h1>
        <p className="mt-1 text-sm text-slate-600">
          We verify these before your first rental. They are stored privately.
        </p>
      </div>

      {verification.isVerified ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          <span className="font-medium">You are verified.</span> All required documents are approved.
        </div>
      ) : (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <span className="font-medium">Verification incomplete.</span> Upload the documents listed
          below so we can check them.
        </div>
      )}

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="font-semibold text-slate-900">Are you a UAE resident?</h2>
        <p className="mt-1 text-sm text-slate-600">This decides which documents we need from you.</p>
        <div className="mt-3 flex gap-2">
          {(['UAE_RESIDENT', 'VISITOR'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => updateProfile.mutate({ residencyStatus: value })}
              className={
                verification.residencyStatus === value
                  ? 'rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white'
                  : 'rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50'
              }
            >
              {value === 'UAE_RESIDENT' ? 'UAE resident' : 'Visitor / tourist'}
            </button>
          ))}
        </div>
      </section>

      {verification.warnings.length > 0 && (
        <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
          {verification.warnings.map((warning) => (
            <p key={warning} className="text-sm text-slate-600">
              {warning}
            </p>
          ))}
        </div>
      )}

      {verification.requirements.length > 0 && (
        <section>
          <h2 className="font-semibold text-slate-900">Required documents</h2>
          <ul className="mt-3 space-y-3">
            {verification.requirements.map((requirement) => (
              <li key={requirement.type} className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900">
                      {requirement.label}
                      {!requirement.required && (
                        <span className="ml-2 text-xs font-normal text-slate-400">optional</span>
                      )}
                    </p>
                    <span
                      className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[requirement.status]}`}
                    >
                      {STATUS_TEXT[requirement.status]}
                    </span>

                    {/* BRD 13: the customer must be told WHY, so they can fix it. */}
                    {requirement.rejectionReason && (
                      <p className="mt-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                        <span className="font-medium">Reason:</span> {requirement.rejectionReason}
                      </p>
                    )}
                  </div>

                  {requirement.status !== 'APPROVED' && (
                    <button
                      type="button"
                      onClick={() =>
                        setUploadingFor(uploadingFor === requirement.type ? null : requirement.type)
                      }
                      className="shrink-0 rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      {requirement.status === 'MISSING' ? 'Upload' : 'Re-upload'}
                    </button>
                  )}
                </div>

                {uploadingFor === requirement.type && (
                  <div className="mt-4">
                    <DocumentUpload
                      defaultType={requirement.type}
                      onDone={() => setUploadingFor(null)}
                      onCancel={() => setUploadingFor(null)}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-slate-900">
            Uploaded ({documentData?.documents.length ?? 0})
          </h2>
          <button
            type="button"
            onClick={() => setShowGeneral((s) => !s)}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            {showGeneral ? 'Cancel' : 'Upload another'}
          </button>
        </div>

        {showGeneral && (
          <div className="mt-3">
            <DocumentUpload
              onDone={() => setShowGeneral(false)}
              onCancel={() => setShowGeneral(false)}
            />
          </div>
        )}

        {documentData && documentData.documents.length > 0 ? (
          <ul className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
            {documentData.documents.map((document) => (
              <li key={document.id} className="flex items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-900">
                    {DOCUMENT_LABELS[document.type]}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {document.fileName} - uploaded{' '}
                    {new Date(document.uploadedAt).toLocaleDateString()}
                    {document.expiryDate ? ` - expires ${document.expiryDate}` : ''}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[document.status]}`}
                >
                  {STATUS_TEXT[document.status]}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
            You have not uploaded any documents yet.
          </p>
        )}
      </section>
    </div>
  );
}
