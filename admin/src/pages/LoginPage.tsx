/**
 * pages/LoginPage.tsx
 * ---------------------------------------------------------------------------
 * Admin/staff sign-in.
 *
 * Same form as the customer site, one important difference: after a successful
 * login we check the role and immediately sign out a CUSTOMER who ends up here.
 *
 * That check is cosmetic - it stops a customer seeing an empty, broken-looking
 * dashboard. It is NOT what keeps them out of admin data. Every admin endpoint
 * is behind `authorize('ADMIN')` on the backend, so a customer's token gets a
 * 403 whether or not this page exists.
 *
 * There is deliberately no "create an account" link. Admin and staff accounts
 * are created only by an existing admin.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useAuth } from '../hooks/useAuth';
import FormField from '../components/FormField';
import { loginSchema, type LoginFormValues } from '../features/auth/schemas';
import type { NormalisedApiError } from '../types/api';

export default function LoginPage() {
  const { login, logout } = useAuth();
  const navigate = useNavigate();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({ resolver: zodResolver(loginSchema) });

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      const user = await login(values);

      if (user.role === 'CUSTOMER') {
        await logout();
        setServerError('This account does not have access to the admin dashboard.');
        return;
      }

      navigate('/', { replace: true });
    } catch (error) {
      setServerError((error as NormalisedApiError).message);
    }
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-bold text-slate-900">Admin sign in</h1>
        <p className="mt-1 text-sm text-slate-600">Staff and administrators only.</p>

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
            className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {isSubmitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
