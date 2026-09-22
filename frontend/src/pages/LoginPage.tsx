/**
 * pages/LoginPage.tsx
 * ---------------------------------------------------------------------------
 * Customer sign-in.
 *
 * React Hook Form handles the form state and Zod the rules, so this component
 * contains no validation logic of its own - it wires inputs to a schema and
 * renders whatever errors come back.
 *
 * Note the two error channels: `errors.email` is a client-side rule, while
 * `serverError` is what the API said (wrong password, account locked, account
 * suspended). Both are shown, because only the server knows the second kind.
 */
import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import FormField from '../components/FormField';
import AuthVisual from '../components/AuthVisual';
import { loginSchema, type LoginFormValues } from '../features/auth/schemas';
import type { NormalisedApiError } from '../types/api';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({ resolver: zodResolver(loginSchema) });

  /** Where ProtectedRoute wanted to send them before the redirect to login. */
  const from = (location.state as { from?: { pathname: string } } | null)?.from?.pathname ?? '/account';

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      await login(values);
      navigate(from, { replace: true });
    } catch (error) {
      setServerError((error as NormalisedApiError).message);
    }
  });

  return (
    <div className="page-container pt-8 sm:pt-12">
      <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
        <div className="mx-auto flex w-full max-w-md flex-col justify-center py-6 lg:py-16">
          <p className="section-eyebrow">Welcome back</p>
          <h1 className="display-heading mt-4 text-[2.5rem] sm:text-5xl">
            Sign <span className="font-editorial">in.</span>
          </h1>
          <p className="mt-3 text-[15px] text-ink-500">Access your bookings and documents.</p>

          <form onSubmit={onSubmit} className="mt-10 space-y-5" noValidate>
            {serverError && (
              <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm text-red-700">
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
            <FormField
              label="Password"
              type="password"
              autoComplete="current-password"
              error={errors.password?.message}
              {...register('password')}
            />

            {/*
              * Under the password field, where somebody who has just failed to
              * remember it is already looking. There was no way out of this
              * screen at all before: a forgotten password meant a phone call.
              */}
            <p className="-mt-2 text-right">
              <Link
                to="/forgot-password"
                className="text-sm font-medium text-ink-500 underline-offset-4 hover:text-ink-950 hover:underline"
              >
                Forgot your password?
              </Link>
            </p>

            <button type="submit" disabled={isSubmitting} className="btn btn-primary btn-lg w-full">
              {isSubmitting ? 'Signing in…' : 'Sign in'}
              {!isSubmitting && <ArrowRight aria-hidden className="btn-arrow h-4 w-4" />}
            </button>
          </form>

          <p className="mt-8 text-sm text-ink-500">
            No account?{' '}
            <Link to="/register" className="font-semibold text-ink-950 underline underline-offset-4">
              Create one
            </Link>
          </p>
        </div>

        <AuthVisual />
      </div>
    </div>
  );
}
