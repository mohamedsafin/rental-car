/**
 * pages/VerifyEmailPage.tsx
 * ---------------------------------------------------------------------------
 * The landing page for the "confirm your email" link.
 *
 * It verifies on arrival rather than asking for a click. The person already
 * clicked - in their inbox - and a second button asking them to confirm that
 * they meant it is the kind of step that makes people close the tab.
 *
 * The one guard that matters: React 18's StrictMode mounts effects twice in
 * development, and this effect SPENDS A SINGLE-USE TOKEN. Without the ref the
 * second run would find the token already used and show a failure on a
 * verification that had just succeeded.
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { MailCheck, TriangleAlert } from 'lucide-react';
import { authService } from '../services/auth.service';
import { useAuth } from '../hooks/useAuth';
import type { NormalisedApiError } from '../types/api';

type State = { status: 'working' } | { status: 'done' } | { status: 'failed'; message: string };

export default function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const { user } = useAuth();
  const [state, setState] = useState<State>({ status: 'working' });
  const attempted = useRef(false);

  useEffect(() => {
    if (!token) {
      setState({ status: 'failed', message: 'This link is missing its token.' });
      return;
    }

    // See the note above: the token can only be spent once.
    if (attempted.current) return;
    attempted.current = true;

    authService
      .verifyEmail(token)
      .then(() => setState({ status: 'done' }))
      .catch((error) =>
        setState({ status: 'failed', message: (error as NormalisedApiError).message }),
      );
  }, [token]);

  return (
    <div className="page-container flex min-h-[60vh] items-center justify-center py-16">
      <div className="mx-auto w-full max-w-md text-center">
        {state.status === 'working' && (
          <>
            <span aria-hidden className="skeleton mx-auto block h-12 w-12 rounded-full" />
            <p className="mt-6 text-[15px] text-ink-500">Confirming your email address…</p>
          </>
        )}

        {state.status === 'done' && (
          <>
            <span
              aria-hidden
              className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600"
            >
              <MailCheck className="h-5 w-5" />
            </span>
            <h1 className="display-heading mt-6 text-[2rem]">Email confirmed</h1>
            <p className="mt-4 text-[15px] text-ink-600">
              Thank you. We will use it for booking confirmations, pickup reminders and invoices.
            </p>
            <Link to={user ? '/account' : '/login'} className="btn btn-primary mt-8">
              {user ? 'Go to my account' : 'Sign in'}
            </Link>
          </>
        )}

        {state.status === 'failed' && (
          <>
            <span
              aria-hidden
              className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-600"
            >
              <TriangleAlert className="h-5 w-5" />
            </span>
            <h1 className="display-heading mt-6 text-[2rem]">We could not confirm it</h1>
            <p className="mt-4 text-[15px] leading-relaxed text-ink-600">{state.message}</p>
            <p className="mt-3 text-sm text-ink-500">
              {user
                ? 'You can send yourself a new link from your account page.'
                : 'Sign in and send yourself a new link from your account page.'}
            </p>
            <Link to={user ? '/account' : '/login'} className="btn btn-primary mt-8">
              {user ? 'Go to my account' : 'Sign in'}
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
