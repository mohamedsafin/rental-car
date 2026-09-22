/**
 * pages/ResetPasswordPage.tsx
 * ---------------------------------------------------------------------------
 * Setting a new password from an emailed link.
 *
 * ===========================================================================
 * TWO THINGS THIS PAGE OWES THE PERSON READING IT
 * ===========================================================================
 * 1. A DEAD LINK MUST SAY SO IMMEDIATELY. A link that has expired, been used,
 *    or been mangled by an email client produces exactly one server message -
 *    the API deliberately refuses to distinguish them, since telling somebody
 *    holding a stolen token which it is helps only them. So the page stops
 *    guessing and does the useful thing instead: offers to send a fresh one.
 *
 * 2. IT MUST SAY THAT EVERY DEVICE GETS SIGNED OUT. That is what a reset
 *    does, and finding out afterwards - on a phone that has silently logged
 *    itself out - reads as a fault rather than a safeguard.
 */
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, ShieldCheck, TriangleAlert } from 'lucide-react';
import FormField from '../components/FormField';
import AuthVisual from '../components/AuthVisual';
import { authService } from '../services/auth.service';
import { resetPasswordSchema, type ResetPasswordFormValues } from '../features/auth/schemas';
import type { NormalisedApiError } from '../types/api';

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token');

  const [serverError, setServerError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordFormValues>({ resolver: zodResolver(resetPasswordSchema) });

  const onSubmit = handleSubmit(async (values) => {
    if (!token) return;
    setServerError(null);
    try {
      await authService.resetPassword(token, values.password);
      setDone(true);
      // A moment on the confirmation, then to the sign-in form with the new
      // password fresh in mind.
      setTimeout(() => navigate('/login', { replace: true }), 2500);
    } catch (error) {
      setServerError((error as NormalisedApiError).message);
    }
  });

  return (
    <div className="page-container pt-8 sm:pt-12">
      <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
        <div className="mx-auto flex w-full max-w-md flex-col justify-center py-6 lg:py-16">
          {!token ? (
            <DeadLink reason="This link is missing its token. Email links sometimes get cut in half - try copying the whole address from the email." />
          ) : done ? (
            <>
              <span
                aria-hidden
                className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600"
              >
                <ShieldCheck className="h-5 w-5" />
              </span>
              <h1 className="display-heading mt-6 text-[2rem] sm:text-[2.5rem]">
                Password changed
              </h1>
              <p className="mt-4 text-[15px] text-ink-600">
                Taking you to sign in. Every other device has been signed out.
              </p>
              <Link to="/login" className="btn btn-primary mt-8 self-start">
                Sign in now
              </Link>
            </>
          ) : (
            <>
              <p className="section-eyebrow">Account recovery</p>
              <h1 className="display-heading mt-4 text-[2.5rem] sm:text-5xl">
                Set a new <span className="font-editorial">password.</span>
              </h1>
              <p className="mt-3 text-[15px] text-ink-500">
                Choose something you have not used here before. Saving it signs you out on every
                other device.
              </p>

              <form onSubmit={onSubmit} className="mt-10 space-y-5" noValidate>
                {serverError && (
                  <div
                    role="alert"
                    className="rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm text-red-700"
                  >
                    <p>{serverError}</p>
                    <Link
                      to="/forgot-password"
                      className="mt-1.5 inline-block font-semibold underline underline-offset-4"
                    >
                      Send me a new link
                    </Link>
                  </div>
                )}

                <FormField
                  label="New password"
                  type="password"
                  autoComplete="new-password"
                  hint="At least 8 characters, with an uppercase letter, a lowercase letter and a number."
                  error={errors.password?.message}
                  {...register('password')}
                />
                <FormField
                  label="Confirm new password"
                  type="password"
                  autoComplete="new-password"
                  error={errors.confirmPassword?.message}
                  {...register('confirmPassword')}
                />

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="btn btn-primary btn-lg w-full"
                >
                  {isSubmitting ? 'Saving…' : 'Save new password'}
                  {!isSubmitting && <ArrowRight aria-hidden className="btn-arrow h-4 w-4" />}
                </button>
              </form>
            </>
          )}
        </div>

        <AuthVisual />
      </div>
    </div>
  );
}

function DeadLink({ reason }: { reason: string }) {
  return (
    <>
      <span
        aria-hidden
        className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-600"
      >
        <TriangleAlert className="h-5 w-5" />
      </span>
      <h1 className="display-heading mt-6 text-[2rem] sm:text-[2.5rem]">This link will not work</h1>
      <p className="mt-4 text-[15px] leading-relaxed text-ink-600">{reason}</p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link to="/forgot-password" className="btn btn-primary">
          Send a new link
        </Link>
        <Link to="/login" className="btn btn-outline">
          Back to sign in
        </Link>
      </div>
    </>
  );
}
