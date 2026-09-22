/**
 * pages/CustomerDetailPage.tsx
 * ---------------------------------------------------------------------------
 * The document verification screen (BRD 13).
 *
 * Staff see the uploaded file next to the details the customer typed, so they
 * can check the two match - which is the entire point of verification. A
 * rejection cannot be submitted without a reason: the UI blocks it and, more
 * importantly, so does the backend.
 */
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import DocumentViewer from '../components/DocumentViewer';
import CustomerHistory from '../components/CustomerHistory';
import CustomerEditForm from '../components/CustomerEditForm';
import EraseCustomer from '../components/EraseCustomer';
import { useCustomer, useReviewDocument } from '../features/customer/useCustomerAdmin';
import { DOCUMENT_LABELS, STATUS_STYLE, type CustomerDocument } from '../types/customer';

function DocumentCard({ document }: { document: CustomerDocument }) {
  const review = useReviewDocument();
  const [reason, setReason] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSuperseded = document.supersededAt !== null;
  const canReview = !isSuperseded && document.status === 'PENDING';

  return (
    <article
      className={
        isSuperseded
          ? 'rounded-lg border border-slate-200 bg-slate-50 p-4 opacity-70'
          : 'rounded-lg border border-slate-200 bg-white p-4'
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="font-medium text-slate-900">{DOCUMENT_LABELS[document.type]}</h4>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[document.status]}`}
            >
              {document.status}
            </span>
            {isSuperseded && (
              <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-600">
                replaced by a newer upload
              </span>
            )}
            {document.isExpired && (
              <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs text-orange-800">
                past expiry
              </span>
            )}
          </div>
        </div>
        <p className="text-xs text-slate-500">
          Uploaded {new Date(document.uploadedAt).toLocaleString()}
        </p>
      </div>

      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-slate-500">Document number</dt>
          <dd className="font-medium text-slate-900">{document.documentNumber ?? 'Not provided'}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Expiry</dt>
          <dd className="font-medium text-slate-900">{document.expiryDate ?? 'Not provided'}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">File</dt>
          <dd className="truncate font-medium text-slate-900">{document.fileName}</dd>
        </div>
      </dl>

      {document.rejectionReason && (
        <p className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">
          <span className="font-medium">Rejected:</span> {document.rejectionReason}
        </p>
      )}

      {!isSuperseded && (
        <div className="mt-4">
          <DocumentViewer document={document} />
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {canReview && (
        <div className="mt-4 flex flex-wrap items-start gap-3">
          <button
            type="button"
            disabled={review.isPending}
            onClick={() => {
              setError(null);
              review.mutate(
                { id: document.id, status: 'APPROVED' },
                { onError: (e) => setError(e.message) },
              );
            }}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            Approve
          </button>

          {rejecting ? (
            <div className="flex-1 space-y-2">
              <textarea
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why is this being rejected? The customer sees this."
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={reason.trim().length < 3 || review.isPending}
                  onClick={() => {
                    setError(null);
                    review.mutate(
                      { id: document.id, status: 'REJECTED', rejectionReason: reason.trim() },
                      {
                        onSuccess: () => {
                          setRejecting(false);
                          setReason('');
                        },
                        onError: (e) => setError(e.message),
                      },
                    );
                  }}
                  className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  Confirm rejection
                </button>
                <button
                  type="button"
                  onClick={() => setRejecting(false)}
                  className="text-sm text-slate-600 hover:underline"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setRejecting(true)}
              className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
            >
              Reject
            </button>
          )}
        </div>
      )}
    </article>
  );
}

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isPending, isError, error } = useCustomer(id);
  const [editing, setEditing] = useState(false);

  if (isPending) return <div className="h-96 animate-pulse rounded-lg bg-slate-200" />;

  if (isError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6">
        <h2 className="font-semibold text-red-800">Could not load this customer</h2>
        <p className="mt-1 text-sm text-red-700">{error.message}</p>
        <Link to="/customers" className="mt-4 inline-block text-sm text-red-900 underline">
          Back to customers
        </Link>
      </div>
    );
  }

  const { customer, verification, documents } = data;
  const live = documents.filter((d) => !d.supersededAt);
  const superseded = documents.filter((d) => d.supersededAt);

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <Link to="/customers" className="text-sm text-slate-500 hover:underline">
          &larr; Customers
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold text-slate-900">{customer.user.fullName}</h2>
          {verification.isVerified ? (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
              Verified
            </span>
          ) : (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
              Not verified
            </span>
          )}
        </div>
        <p className="text-sm text-slate-600">{customer.user.email}</p>
      </div>

      {/*
        Everything the counter needs before handing over keys: how often they
        rent, what they have spent, and above all what is still owed.
      */}
      {id && <CustomerHistory customerId={id} />}

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold text-slate-900">Profile</h3>
          {!editing && (
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setEditing(true)}>
              Edit details
            </button>
          )}
        </div>

        {editing && id ? (
          <CustomerEditForm
            customer={{
              id,
              fullName: customer.user.fullName,
              phone: customer.user.phone,
              residencyStatus: customer.residencyStatus,
              dateOfBirth: customer.dateOfBirth,
              nationality: customer.nationality,
              addressLine1: customer.address.line1,
              city: customer.address.city,
              emirate: customer.address.emirate,
              licenceNumber: customer.licence.number,
              licenceIssuingCountry: customer.licence.issuingCountry,
              licenceExpiryDate: customer.licence.expiryDate,
            }}
            onDone={() => setEditing(false)}
          />
        ) : null}

        <dl className="mt-3 grid gap-3 sm:grid-cols-3">
          <Detail label="Phone" value={customer.user.phone ?? 'Not provided'} />
          <Detail
            label="Residency"
            value={
              customer.residencyStatus === 'UAE_RESIDENT'
                ? 'UAE resident'
                : customer.residencyStatus === 'VISITOR'
                  ? 'Visitor'
                  : 'Not stated'
            }
          />
          <Detail label="Nationality" value={customer.nationality ?? 'Not provided'} />
          <Detail label="Date of birth" value={customer.dateOfBirth ?? 'Not provided'} />
          <Detail label="Licence number" value={customer.licence.number ?? 'Not provided'} />
          <Detail label="Licence expiry" value={customer.licence.expiryDate ?? 'Not provided'} />
        </dl>
      </section>

      {verification.warnings.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-4">
          {verification.warnings.map((warning) => (
            <p key={warning} className="text-sm text-amber-900">
              {warning}
            </p>
          ))}
        </div>
      )}

      <section>
        <h3 className="font-semibold text-slate-900">Required documents</h3>
        <ul className="mt-3 flex flex-wrap gap-2">
          {verification.requirements.map((requirement) => (
            <li
              key={requirement.type}
              className={`rounded-full px-3 py-1 text-xs font-medium ${STATUS_STYLE[requirement.status]}`}
            >
              {requirement.label}: {requirement.status}
            </li>
          ))}
          {verification.requirements.length === 0 && (
            <li className="text-sm text-slate-500">No requirements configured.</li>
          )}
        </ul>
      </section>

      <section>
        <h3 className="font-semibold text-slate-900">Documents ({live.length})</h3>
        <div className="mt-3 space-y-4">
          {live.map((document) => (
            <DocumentCard key={document.id} document={document} />
          ))}
          {live.length === 0 && (
            <p className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
              This customer has not uploaded any documents.
            </p>
          )}
        </div>
      </section>

      {/* Replaced documents are kept and shown: a rejected passport plus its
          replacement together are the record of what was checked and when. */}
      {superseded.length > 0 && (
        <section>
          <h3 className="font-semibold text-slate-900">
            Previous uploads ({superseded.length})
          </h3>
          <p className="mt-1 text-sm text-slate-600">
            Replaced by newer uploads. Kept as part of the verification record.
          </p>
          <div className="mt-3 space-y-4">
            {superseded.map((document) => (
              <DocumentCard key={document.id} document={document} />
            ))}
          </div>
        </section>
      )}

      {/*
        Last on the page, and behind a typed confirmation, because it cannot be
        undone. Admins only - the server enforces that too.
      */}
      {id && <EraseCustomer customerId={id} customerName={customer.user.fullName} />}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-sm font-medium text-slate-900">{value}</dd>
    </div>
  );
}
