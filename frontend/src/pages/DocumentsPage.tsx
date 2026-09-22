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
import { useEffect, useState } from 'react';
import { BadgeCheck, CircleAlert, FileText, Upload } from 'lucide-react';
import DocumentUpload from '../components/DocumentUpload';
import PageHeader from '../components/PageHeader';
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

  /*
   * Seeded from the profile once it loads, so the field shows what is stored
   * rather than sitting empty next to a "Saved" line.
   */
  const [dateOfBirth, setDateOfBirth] = useState('');
  useEffect(() => {
    if (profile?.customer.dateOfBirth) setDateOfBirth(profile.customer.dateOfBirth);
  }, [profile?.customer.dateOfBirth]);

  const [uploadingFor, setUploadingFor] = useState<DocumentType | null>(null);
  const [showGeneral, setShowGeneral] = useState(false);

  if (isPending) {
    return (
      <div className="page-container pt-10 sm:pt-14" aria-busy="true">
        <div className="animate-pulse space-y-6">
          <div className="h-12 w-1/2 rounded-lg bg-ink-100" />
          <div className="h-64 rounded-card bg-ink-100" />
        </div>
      </div>
    );
  }
  if (!profile) return null;

  const { verification } = profile;

  return (
    <div className="page-container pt-10 sm:pt-14">
      <PageHeader
        back={{ to: '/account', label: 'My account' }}
        eyebrow="Verification"
        title={
          <>
            My <span className="font-editorial">documents.</span>
          </>
        }
        description="We verify these before your first rental. They are stored privately."
      />

      {verification.isVerified ? (
        <div className="mt-10 flex items-center gap-3 rounded-card bg-emerald-50 p-5 text-sm text-emerald-900">
          <BadgeCheck aria-hidden className="h-5 w-5 shrink-0 text-emerald-600" />
          <p>
            <span className="font-semibold">You are verified.</span> All required documents are approved.
          </p>
        </div>
      ) : (
        <div className="mt-10 flex items-center gap-3 rounded-card bg-amber-50 p-5 text-sm text-amber-900">
          <CircleAlert aria-hidden className="h-5 w-5 shrink-0 text-amber-600" />
          <p>
            <span className="font-semibold">Verification incomplete.</span> Upload the documents listed
            below so we can check them.
          </p>
        </div>
      )}

      <section aria-labelledby="residency-title" className="surface mt-6 p-5 sm:p-6">
        <h2 id="residency-title" className="text-[15px] font-semibold text-ink-950">
          Are you a UAE resident?
        </h2>
        <p className="mt-1 text-sm text-ink-500">This decides which documents we need from you.</p>
        <div className="mt-4 inline-flex rounded-full bg-ink-100 p-1">
          {(['UAE_RESIDENT', 'VISITOR'] as const).map((value) => {
            const active = verification.residencyStatus === value;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={active}
                onClick={() => updateProfile.mutate({ residencyStatus: value })}
                className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                  active ? 'bg-white text-ink-950 shadow-card' : 'text-ink-600 hover:text-ink-950'
                }`}
              >
                {value === 'UAE_RESIDENT' ? 'UAE resident' : 'Visitor / tourist'}
              </button>
            );
          })}
        </div>
      </section>


      {/*
        Date of birth sits with residency rather than on the account page,
        because both answer the same question: what do we need from you before
        you can rent. It was collectable NOWHERE before this - not at
        registration, not in a profile form - while the booking refused
        without it and told customers to "add it to your profile".
      */}
      <section aria-labelledby="dob-title" className="surface mt-6 p-5 sm:p-6">
        <h2 id="dob-title" className="text-[15px] font-semibold text-ink-950">
          Your date of birth
        </h2>
        <p className="mt-1 text-sm text-ink-500">
          Checked against the pickup date, because a minimum driving age applies on the day you
          collect the car.
        </p>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="date-of-birth" className="field-label">
              Date of birth
            </label>
            <input
              id="date-of-birth"
              type="date"
              max={new Date().toISOString().slice(0, 10)}
              value={dateOfBirth}
              onChange={(event) => setDateOfBirth(event.target.value)}
              className="field-control"
            />
          </div>

          <button
            type="button"
            disabled={!dateOfBirth || dateOfBirth === (profile?.customer.dateOfBirth ?? '') || updateProfile.isPending}
            onClick={() => updateProfile.mutate({ dateOfBirth })}
            className="btn btn-primary"
          >
            {updateProfile.isPending ? 'Saving\u2026' : 'Save'}
          </button>
        </div>

        {profile?.customer.dateOfBirth && dateOfBirth === profile.customer.dateOfBirth && (
          <p className="mt-2 text-sm text-ink-500">Saved.</p>
        )}
      </section>

      {verification.warnings.length > 0 && (
        <div className="mt-6 rounded-card bg-ink-50 p-5">
          {verification.warnings.map((warning) => (
            <p key={warning} className="text-sm text-ink-600">
              {warning}
            </p>
          ))}
        </div>
      )}

      {verification.requirements.length > 0 && (
        <section aria-labelledby="required-title" className="mt-14">
          <h2 id="required-title" className="text-xl font-semibold tracking-tight text-ink-950">
            Required documents
          </h2>
          <ul className="surface mt-5 divide-y divide-ink-100">
            {verification.requirements.map((requirement) => (
              <li key={requirement.type} className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="flex min-w-0 items-start gap-3.5">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ink-50 text-ink-700">
                      <FileText aria-hidden className="h-4 w-4" strokeWidth={1.6} />
                    </span>
                    <div className="min-w-0">
                      <p className="font-medium text-ink-950">
                        {requirement.label}
                        {!requirement.required && (
                          <span className="ml-2 text-xs font-normal text-ink-500">optional</span>
                        )}
                      </p>
                      <span
                        className={`mt-1.5 inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[requirement.status]}`}
                      >
                        {STATUS_TEXT[requirement.status]}
                      </span>

                      {/* BRD 13: the customer must be told WHY, so they can fix it. */}
                      {requirement.rejectionReason && (
                        <p className="mt-2.5 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                          <span className="font-semibold">Reason:</span> {requirement.rejectionReason}
                        </p>
                      )}
                    </div>
                  </div>

                  {requirement.status !== 'APPROVED' && (
                    <button
                      type="button"
                      onClick={() =>
                        setUploadingFor(uploadingFor === requirement.type ? null : requirement.type)
                      }
                      className="btn btn-outline btn-sm shrink-0"
                    >
                      <Upload aria-hidden className="h-3.5 w-3.5" />
                      {requirement.status === 'MISSING' ? 'Upload' : 'Re-upload'}
                    </button>
                  )}
                </div>

                {uploadingFor === requirement.type && (
                  <div className="mt-5">
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

      <section aria-labelledby="uploaded-title" className="mt-14">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 id="uploaded-title" className="text-xl font-semibold tracking-tight text-ink-950">
            Uploaded <span className="tabular text-ink-500">({documentData?.documents.length ?? 0})</span>
          </h2>
          <button type="button" onClick={() => setShowGeneral((s) => !s)} className="btn btn-outline btn-sm">
            {showGeneral ? 'Cancel' : 'Upload another'}
          </button>
        </div>

        {showGeneral && (
          <div className="mt-5">
            <DocumentUpload onDone={() => setShowGeneral(false)} onCancel={() => setShowGeneral(false)} />
          </div>
        )}

        {documentData && documentData.documents.length > 0 ? (
          <ul className="surface mt-5 divide-y divide-ink-100">
            {documentData.documents.map((document) => (
              <li key={document.id} className="flex items-center justify-between gap-4 p-5">
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink-950">{DOCUMENT_LABELS[document.type]}</p>
                  <p className="truncate text-xs text-ink-500">
                    {document.fileName} - uploaded {new Date(document.uploadedAt).toLocaleDateString()}
                    {document.expiryDate ? ` - expires ${document.expiryDate}` : ''}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[document.status]}`}
                >
                  {STATUS_TEXT[document.status]}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-5 rounded-card border border-dashed border-ink-300 p-10 text-center text-sm text-ink-500">
            You have not uploaded any documents yet.
          </p>
        )}
      </section>
    </div>
  );
}
