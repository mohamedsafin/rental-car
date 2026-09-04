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
import { useAuth } from '../hooks/useAuth';
import FormField from '../components/FormField';
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
    <div className="mx-auto max-w-md">
      <h1 className="text-2xl font-bold text-ink-900">Sign in</h1>
      <p className="mt-1 text-sm text-ink-600">Access your bookings and documents.</p>

      <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
        {serverError && (
          <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
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

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-md bg-ink-900 px-4 py-2 text-sm font-medium text-white hover:bg-ink-800 disabled:opacity-50"
        >
          {isSubmitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <p className="mt-4 text-sm text-ink-600">
        No account?{' '}
        <Link to="/register" className="font-medium text-ink-900 underline">
          Create one
        </Link>
      </p>
    </div>
  );
}
