/**
 * components/EmailVerificationNotice.tsx
 * ---------------------------------------------------------------------------
 * "We are not sure this address reaches you."
 *
 * Shown only while the address is unconfirmed, and framed as what it actually
 * costs the customer rather than as a rule they have broken: every booking
 * confirmation, pickup reminder and invoice goes to this address, so an
 * unconfirmed one means a rental they hear nothing about.
 *
 * It does not block anything. Verification is not a gate here - documents are -
 * and a notice that blocks is a notice people work around.
 */
import { useState } from 'react';
import { MailWarning } from 'lucide-react';
import { authService } from '../services/auth.service';
import type { NormalisedApiError } from '../types/api';

export default function EmailVerificationNotice({ email }: { email: string }) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function resend() {
    setState('sending');
    setError(null);
    try {
      await authService.resendVerification();
      setState('sent');
    } catch (caught) {
      // Most often the hourly limit - which is a real answer, so it is shown.
      setError((caught as NormalisedApiError).message);
      setState('idle');
    }
  }

  return (
    <div className="surface mt-6 border-amber-200 bg-amber-50/70 p-5">
      <div className="flex gap-3">
        <span aria-hidden className="mt-0.5 shrink-0 text-amber-600">
          <MailWarning className="h-5 w-5" />
        </span>

        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-amber-900">Confirm your email address</h2>
          <p className="mt-1 text-sm leading-relaxed text-amber-900/90">
            We have not confirmed that <strong className="font-semibold">{email}</strong> reaches
            you. Booking confirmations, pickup reminders and invoices all go there.
          </p>

          {state === 'sent' ? (
            <p className="mt-3 text-sm font-medium text-amber-900">
              Sent. Check your inbox — and your spam folder.
            </p>
          ) : (
            <button
              type="button"
              onClick={() => void resend()}
              disabled={state === 'sending'}
              className="btn btn-outline btn-sm mt-3"
            >
              {state === 'sending' ? 'Sending…' : 'Send me the link'}
            </button>
          )}

          {error && (
            <p role="alert" className="mt-2 text-sm text-red-700">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
