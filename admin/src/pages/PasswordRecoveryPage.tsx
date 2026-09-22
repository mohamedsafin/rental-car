/**
 * pages/PasswordRecoveryPage.tsx
 * ---------------------------------------------------------------------------
 * Forgotten staff passwords, both halves in one file.
 *
 * ===========================================================================
 * WHY BOTH STEPS LIVE TOGETHER HERE
 * ===========================================================================
 * The customer site splits them across two pages because each is a designed
 * moment in a sign-up funnel. This is a back office: the whole flow is "I
 * cannot get in, let me in", it is used a handful of times a year, and one
 * file that shows both halves side by side is easier to keep correct than two
 * that drift.
 *
 * Which half renders is decided by the URL - a `token` query parameter means
 * the person arrived from an email and is here to type a new password.
 *
 * The request goes through the shared API client, so it carries the
 * `X-Client-App: admin` header automatically - which is what makes the emailed
 * link point back at THIS app rather than at the customer site, where a staff
 * account would be no use.
 */
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { KeyRound, MailCheck, ShieldCheck, TriangleAlert } from 'lucide-react';
import { postData } from '../services/api';
import type { NormalisedApiError } from '../types/api';

export default function PasswordRecoveryPage() {
  const [params] = useSearchParams();
  const token = params.get('token');

  return (
    <div className="flex min-h-full items-center justify-center bg-ink-50 px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <span
            aria-hidden
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink-950 text-[13px] font-bold text-white"
          >
            UC
          </span>
          <span className="text-[13px] font-semibold text-ink-950">UAE Car Rental</span>
        </div>

        {token ? <SetNewPassword token={token} /> : <RequestLink />}
      </div>
    </div>
  );
}

/* --- Step one: ask for the email ----------------------------------------- */

function RequestLink() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await postData<null>('/auth/forgot-password', { email });
      setSent(true);
    } catch (caught) {
      setError((caught as NormalisedApiError).message);
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="card card-raised p-6">
        <span
          aria-hidden
          className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-50 text-accent-600"
        >
          <MailCheck className="h-5 w-5" />
        </span>
        <h1 className="mt-4 text-[17px] font-semibold text-ink-950">Check your inbox</h1>
        {/*
          "If" is doing real work: the API answers identically for an address
          it does not know, so that this form cannot be used to find out which
          staff addresses exist. The page must not claim more than that.
        */}
        <p className="mt-2 text-[13px] leading-relaxed text-ink-600">
          If <strong className="font-medium text-ink-900">{email}</strong> has an account, a link to
          set a new password is on its way. It expires in an hour.
        </p>
        <Link to="/login" className="btn btn-primary mt-5 w-full">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="card card-raised p-6">
      <span
        aria-hidden
        className="flex h-10 w-10 items-center justify-center rounded-lg bg-ink-100 text-ink-600"
      >
        <KeyRound className="h-5 w-5" />
      </span>
      <h1 className="mt-4 text-[17px] font-semibold text-ink-950">Forgot your password?</h1>
      <p className="mt-1 text-[13px] text-ink-500">
        We will email you a link to set a new one.
      </p>

      <form onSubmit={(event) => void submit(event)} className="mt-5 space-y-4" noValidate>
        {error && (
          <p role="alert" className="rounded-lg bg-critical-50 px-3 py-2 text-[13px] text-critical-700">
            {error}
          </p>
        )}

        <div>
          <label htmlFor="recovery-email" className="block text-[13px] font-medium text-ink-700">
            Email
          </label>
          <input
            id="recovery-email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="input mt-1.5"
          />
        </div>

        <button type="submit" disabled={busy || !email} className="btn btn-primary btn-lg w-full">
          {busy ? 'Sending…' : 'Send the link'}
        </button>
      </form>

      <p className="mt-5 text-center text-[13px] text-ink-500">
        <Link to="/login" className="font-medium text-ink-800 hover:underline">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}

/* --- Step two: set the new password -------------------------------------- */

function SetNewPassword({ token }: { token: string }) {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mismatch = confirm.length > 0 && password !== confirm;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (mismatch) return;

    setBusy(true);
    setError(null);
    try {
      await postData<null>('/auth/reset-password', { token, password });
      setDone(true);
      setTimeout(() => navigate('/login', { replace: true }), 2500);
    } catch (caught) {
      setError((caught as NormalisedApiError).message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="card card-raised p-6">
        <span
          aria-hidden
          className="flex h-10 w-10 items-center justify-center rounded-lg bg-positive-50 text-positive-600"
        >
          <ShieldCheck className="h-5 w-5" />
        </span>
        <h1 className="mt-4 text-[17px] font-semibold text-ink-950">Password changed</h1>
        <p className="mt-2 text-[13px] text-ink-600">
          Every other device has been signed out. Taking you to sign in.
        </p>
        <Link to="/login" className="btn btn-primary mt-5 w-full">
          Sign in now
        </Link>
      </div>
    );
  }

  return (
    <div className="card card-raised p-6">
      <h1 className="text-[17px] font-semibold text-ink-950">Set a new password</h1>
      <p className="mt-1 text-[13px] text-ink-500">
        Saving it signs you out on every other device.
      </p>

      <form onSubmit={(event) => void submit(event)} className="mt-5 space-y-4" noValidate>
        {error && (
          <div
            role="alert"
            className="rounded-lg bg-critical-50 px-3 py-2 text-[13px] text-critical-700"
          >
            <p className="flex items-start gap-1.5">
              <TriangleAlert aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {error}
            </p>
            <Link to="/forgot-password" className="mt-1 inline-block font-medium underline">
              Send a new link
            </Link>
          </div>
        )}

        <div>
          <label htmlFor="new-password" className="block text-[13px] font-medium text-ink-700">
            New password
          </label>
          <input
            id="new-password"
            type="password"
            required
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="input mt-1.5"
          />
          <p className="mt-1 text-[11px] text-ink-400">
            At least 8 characters, with an uppercase letter, a lowercase letter and a number.
          </p>
        </div>

        <div>
          <label htmlFor="confirm-password" className="block text-[13px] font-medium text-ink-700">
            Confirm new password
          </label>
          <input
            id="confirm-password"
            type="password"
            required
            autoComplete="new-password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            className="input mt-1.5"
            aria-invalid={mismatch}
          />
          {mismatch && <p className="mt-1 text-[12px] text-critical-700">Passwords do not match</p>}
        </div>

        <button
          type="submit"
          disabled={busy || !password || mismatch}
          className="btn btn-primary btn-lg w-full"
        >
          {busy ? 'Saving…' : 'Save new password'}
        </button>
      </form>
    </div>
  );
}
