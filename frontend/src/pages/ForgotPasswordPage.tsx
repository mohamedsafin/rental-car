/**
 * pages/ForgotPasswordPage.tsx
 * ---------------------------------------------------------------------------
 * "I cannot get in."
 *
 * ===========================================================================
 * WHY THIS PAGE NEVER SAYS WHETHER THE ACCOUNT EXISTS
 * ===========================================================================
 * The API answers identically for a known address and an unknown one, on
 * purpose: a form that says "no account with that email" is a tool for testing
 * a leaked address list against our customer base. So this page cannot show a
 * "we don't know that email" state - there is nothing to show it from, and
 * inventing one would leak exactly what the API refuses to.
 *
 * What it can do is be honest about that: the confirmation says "IF that
 * address has an account", which is true, sets the right expectation, and
 * quietly tells somebody who mistyped their address why nothing arrived.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, MailCheck } from 'lucide-react';
import FormField from '../components/FormField';
import AuthVisual from '../components/AuthVisual';
import { authService } from '../services/auth.service';
import { forgotPasswordSchema, type ForgotPasswordFormValues } from '../features/auth/schemas';
import type { NormalisedApiError } from '../types/api';

export default function ForgotPasswordPage() {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordFormValues>({ resolver: zodResolver(forgotPasswordSchema) });

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      await authService.forgotPassword(values.email);
      setSentTo(values.email);
    } catch (error) {
      // Only a network failure or the rate limiter can land here - the request
      // itself succeeds whether or not the address is known.
      setServerError((error as NormalisedApiError).message);
    }
  });

  return (
    <div className="page-container pt-8 sm:pt-12">
      <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
        <div className="mx-auto flex w-full max-w-md flex-col justify-center py-6 lg:py-16">
          {sentTo ? (
            <>
              <span
                aria-hidden
                className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-50 text-accent-600"
              >
                <MailCheck className="h-5 w-5" />
              </span>
              <h1 className="display-heading mt-6 text-[2rem] sm:text-[2.5rem]">Check your inbox</h1>
              <p className="mt-4 text-[15px] leading-relaxed text-ink-600">
                If <strong className="font-semibold text-ink-950">{sentTo}</strong> has an account,
                a link to set a new password is on its way. It expires in an hour.
              </p>
              <p className="mt-3 text-sm text-ink-500">
                Nothing after a few minutes? Check your spam folder, and that the address above is
                the one you signed up with.
              </p>

              <div className="mt-8 flex flex-wrap gap-3">
                <Link to="/login" className="btn btn-primary">
                  Back to sign in
                </Link>
                <button type="button" onClick={() => setSentTo(null)} className="btn btn-outline">
                  Try another address
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="section-eyebrow">Account recovery</p>
              <h1 className="display-heading mt-4 text-[2.5rem] sm:text-5xl">
                Forgot your <span className="font-editorial">password?</span>
              </h1>
              <p className="mt-3 text-[15px] text-ink-500">
                Enter the email you signed up with and we will send you a link to set a new one.
              </p>

              <form onSubmit={onSubmit} className="mt-10 space-y-5" noValidate>
                {serverError && (
                  <div
                    role="alert"
                    className="rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm text-red-700"
                  >
                    {serverError}
                  </div>
                )}

                <FormField
                  label="Email"
                  type="email"
                  autoComplete="email"
                  error={errors.email?.message}
                  {...register('email')}
                />

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="btn btn-primary btn-lg w-full"
                >
                  {isSubmitting ? 'Sending…' : 'Send the link'}
                  {!isSubmitting && <ArrowRight aria-hidden className="btn-arrow h-4 w-4" />}
                </button>
              </form>

              <p className="mt-8 text-sm text-ink-500">
                Remembered it?{' '}
                <Link
                  to="/login"
                  className="font-semibold text-ink-950 underline underline-offset-4"
                >
                  Sign in
                </Link>
              </p>
            </>
          )}
        </div>

        <AuthVisual />
      </div>
    </div>
  );
}
