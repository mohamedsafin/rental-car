/**
 * components/RentalAgreementPanel.tsx
 * ---------------------------------------------------------------------------
 * The contract, on the booking screen.
 *
 * ===========================================================================
 * WHAT THIS IS FOR
 * ===========================================================================
 * A customer is at the counter and the keys are about to change hands. Until
 * both names are on the agreement, the company has no written record of the
 * mileage allowance, the fuel rule, the insurance excess or who is liable for
 * a fine - and every one of those is the thing that gets argued about later.
 *
 * So the panel is a checklist with one obvious next step at a time: draw it
 * up, print or show it, take the hirer's name, countersign. It refuses to look
 * finished while a signature is missing, because a half-signed contract that
 * looks complete on screen is worse than no contract at all.
 */
import { useState } from 'react';
import { FileSignature, Download, Loader2 } from 'lucide-react';
import { api } from '../services/api';
import {
  useBookingAgreement,
  useIssueAgreement,
  useSignAgreement,
  useVoidAgreement,
  type RentalAgreement,
} from '../features/agreements/useAgreements';

const dateTime = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

/** Bookings where a contract makes sense. Before this, nothing is agreed. */
const AGREEABLE = [
  'CONFIRMED',
  'PAYMENT_PENDING',
  'READY_FOR_PICKUP',
  'ACTIVE',
  'EXTENSION_REQUESTED',
  'RETURN_PENDING',
  'RETURNED',
  'COMPLETED',
];

export default function RentalAgreementPanel({
  bookingId,
  bookingStatus,
  customerName,
  staffName,
}: {
  bookingId: string;
  bookingStatus: string;
  customerName: string;
  staffName: string;
}) {
  const { data: agreement, isPending } = useBookingAgreement(bookingId);
  const issue = useIssueAgreement(bookingId);
  const sign = useSignAgreement(bookingId);
  const voidIt = useVoidAgreement(bookingId);

  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [signingAs, setSigningAs] = useState<'customer' | 'company' | null>(null);
  const [typedName, setTypedName] = useState('');
  const [voiding, setVoiding] = useState(false);
  const [voidReason, setVoidReason] = useState('');

  if (!AGREEABLE.includes(bookingStatus)) return null;
  if (isPending) return <div className="skeleton h-32 rounded-xl" />;

  /**
   * Fetch the PDF with the auth header, then hand the browser a blob URL.
   * A plain link cannot work: the endpoint needs the bearer token.
   */
  async function openPdf(record: RentalAgreement) {
    setDownloading(true);
    setError(null);
    try {
      const response = await api.get(`/agreements/${record.id}/pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(response.data as Blob);
      const opened = window.open(url, '_blank');

      if (!opened) {
        // Pop-up blocked - fall back to a download so the click still does
        // something rather than silently failing.
        const link = document.createElement('a');
        link.href = url;
        link.download = `${record.agreementNumber}.pdf`;
        link.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      setError('Could not open the agreement PDF.');
    } finally {
      setDownloading(false);
    }
  }

  // --- Nothing drawn up yet ------------------------------------------------
  if (!agreement || agreement.status === 'VOID') {
    return (
      <section className="card p-5">
        <div className="flex items-start gap-3">
          <FileSignature className="mt-0.5 h-5 w-5 text-slate-400" aria-hidden />
          <div className="flex-1">
            <h3 className="section-title">Rental agreement</h3>
            <p className="mt-1 text-sm text-slate-500">
              {agreement
                ? `${agreement.agreementNumber} was voided${agreement.voidReason ? ` - ${agreement.voidReason}` : ''}. Draw up a replacement before the keys change hands.`
                : 'No agreement has been drawn up for this booking. The hirer should sign one before the keys change hands.'}
            </p>

            {error && (
              <p role="alert" className="mt-2 text-sm text-red-700">
                {error}
              </p>
            )}

            <button
              type="button"
              className="btn btn-primary btn-sm mt-3"
              disabled={issue.isPending}
              onClick={() => {
                setError(null);
                issue.mutate(undefined, { onError: (err) => setError(err.message) });
              }}
            >
              {issue.isPending ? 'Drawing up…' : 'Draw up the agreement'}
            </button>
          </div>
        </div>
      </section>
    );
  }

  const bothSigned = Boolean(agreement.customerSignedAt && agreement.staffSignedAt);

  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <FileSignature className="mt-0.5 h-5 w-5 text-slate-400" aria-hidden />
          <div>
            <h3 className="section-title">Rental agreement</h3>
            <p className="mt-0.5 text-sm text-slate-500">
              {agreement.agreementNumber} · issued {dateTime(agreement.issuedAt)}
            </p>
          </div>
        </div>

        <span className={`badge ${bothSigned ? 'badge-positive' : 'badge-caution'}`}>
          {bothSigned ? 'Signed' : 'Awaiting signature'}
        </span>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {/* --- The two signatures, side by side ------------------------------ */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <SignatureSlot
          role="The hirer"
          name={agreement.customerSignedName}
          at={agreement.customerSignedAt}
          onSign={() => {
            setSigningAs('customer');
            setTypedName(customerName);
          }}
        />
        <SignatureSlot
          role="For the company"
          name={agreement.staffSignedName}
          at={agreement.staffSignedAt}
          onSign={() => {
            setSigningAs('company');
            setTypedName(staffName);
          }}
        />
      </div>

      {signingAs && (
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <label className="block text-sm font-medium text-slate-800">
            {signingAs === 'customer'
              ? 'Type the hirer’s full name, as it appears on their licence'
              : 'Type your full name'}
          </label>
          <p className="mt-1 text-xs text-slate-500">
            {signingAs === 'customer'
              ? 'The typed name, the time and the address it came from are recorded together. Only type this with the hirer present and the agreement in front of them.'
              : 'This countersigns the agreement on the company’s behalf.'}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              className="input max-w-xs"
              value={typedName}
              onChange={(e) => setTypedName(e.target.value)}
              placeholder="Full name"
            />
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={sign.isPending || typedName.trim().length < 3}
              onClick={() => {
                setError(null);
                sign.mutate(
                  { id: agreement.id, signedName: typedName.trim(), as: signingAs },
                  {
                    onSuccess: () => {
                      setSigningAs(null);
                      setTypedName('');
                    },
                    onError: (err) => setError(err.message),
                  },
                );
              }}
            >
              {sign.isPending ? 'Recording…' : 'Record signature'}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setSigningAs(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* --- Terms at a glance, so nobody has to open the PDF to check ----- */}
      <dl className="mt-4 grid gap-3 border-t border-slate-100 pt-4 text-sm sm:grid-cols-3">
        <Fact
          label="Mileage"
          value={
            agreement.mileageLimitPerDay === null
              ? 'Unlimited'
              : `${agreement.mileageLimitPerDay} km/day`
          }
        />
        <Fact
          label="Deposit"
          value={`${agreement.currency} ${agreement.securityDeposit}`}
        />
        <Fact
          label="Insurance excess"
          value={
            agreement.excessAmount
              ? `${agreement.currency} ${agreement.excessAmount}`
              : 'Not recorded'
          }
          muted={!agreement.excessAmount}
        />
      </dl>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn btn-outline btn-sm"
          disabled={downloading}
          onClick={() => void openPdf(agreement)}
        >
          {downloading ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Download className="h-4 w-4" aria-hidden />
          )}
          Open the PDF
        </button>

        {!voiding && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setVoiding(true)}>
            Void and replace
          </button>
        )}
      </div>

      {voiding && (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-slate-500">
            Voiding keeps this agreement on record and lets you draw up a new one. Say why - the
            reason is part of the trail.
          </p>
          <textarea
            rows={2}
            className="input"
            value={voidReason}
            onChange={(e) => setVoidReason(e.target.value)}
            placeholder="Why is this agreement being replaced?"
          />
          <div className="flex gap-2">
            <button
              type="button"
              className="btn btn-danger btn-sm"
              disabled={voidIt.isPending || voidReason.trim().length < 3}
              onClick={() => {
                setError(null);
                voidIt.mutate(
                  { id: agreement.id, reason: voidReason.trim() },
                  {
                    onSuccess: () => {
                      setVoiding(false);
                      setVoidReason('');
                    },
                    onError: (err) => setError(err.message),
                  },
                );
              }}
            >
              Void it
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setVoiding(false)}>
              Keep it
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function SignatureSlot({
  role,
  name,
  at,
  onSign,
}: {
  role: string;
  name: string | null;
  at: string | null;
  onSign: () => void;
}) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <p className="text-xs uppercase tracking-wide text-slate-400">{role}</p>
      {at ? (
        <>
          <p className="mt-1 text-sm font-medium text-slate-900">{name}</p>
          <p className="text-xs text-slate-500">Signed {dateTime(at)}</p>
        </>
      ) : (
        <button type="button" className="btn btn-outline btn-sm mt-2" onClick={onSign}>
          Take signature
        </button>
      )}
    </div>
  );
}

function Fact({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className={`font-medium ${muted ? 'text-slate-400' : 'text-slate-900'}`}>{value}</dd>
    </div>
  );
}
