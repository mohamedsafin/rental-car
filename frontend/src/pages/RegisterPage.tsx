/**
 * pages/RegisterPage.tsx
 * ---------------------------------------------------------------------------
 * Customer sign-up. Collects the fields BRD 11 lists: full name, email, mobile,
 * password, country.
 *
 * There is no role selector, and there never will be. Registration always
 * creates a CUSTOMER; the backend hardcodes it and ignores any role field in
 * the request body. Staff and admin accounts are created only by an existing
 * admin from the admin dashboard.
 */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useAuth } from '../hooks/useAuth';
import FormField from '../components/FormField';
import { registerSchema, type RegisterFormValues } from '../features/auth/schemas';
import type { NormalisedApiError } from '../types/api';

export default function RegisterPage() {
  const { register: registerUser } = useAuth();
  const navigate = useNavigate();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormValues>({ resolver: zodResolver(registerSchema) });

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      await registerUser({
        fullName: values.fullName,
        email: values.email,
        password: values.password,
        // Send undefined rather than '' so the optional fields stay optional.
        phone: values.phone || undefined,
        country: values.country || undefined,
      });
      navigate('/account', { replace: true });
    } catch (error) {
      const apiError = error as NormalisedApiError;

      // Map the backend's per-field errors onto the matching inputs, so a
      // server-side rule we forgot to mirror still lands next to its field.
      if (apiError.errors.length > 0) {
        apiError.errors.forEach((fieldError) => {
          setError(fieldError.field as keyof RegisterFormValues, { message: fieldError.message });
        });
      } else {
        setServerError(apiError.message);
      }
    }
  });

  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-2xl font-bold text-slate-900">Create your account</h1>
      <p className="mt-1 text-sm text-slate-600">Book vehicles and manage your rentals.</p>

      <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
        {serverError && (
          <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {serverError}
          </div>
        )}

        <FormField
          label="Full name"
          autoComplete="name"
          error={errors.fullName?.message}
          {...register('fullName')}
        />
        <FormField
          label="Email"
          type="email"
          autoComplete="email"
          error={errors.email?.message}
          {...register('email')}
        />
        <FormField
          label="Mobile number"
          type="tel"
          autoComplete="tel"
          hint="Optional. Include the country code, e.g. +971501234567"
          error={errors.phone?.message}
          {...register('phone')}
        />
        <FormField
          label="Country"
          hint="Optional. 2-letter code, e.g. AE"
          maxLength={2}
          error={errors.country?.message}
          {...register('country')}
        />
        <FormField
          label="Password"
          type="password"
          autoComplete="new-password"
          hint="At least 8 characters, with upper case, lower case and a number"
          error={errors.password?.message}
          {...register('password')}
        />
        <FormField
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          error={errors.confirmPassword?.message}
          {...register('confirmPassword')}
        />

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {isSubmitting ? 'Creating account…' : 'Create account'}
        </button>
      </form>

      <p className="mt-4 text-sm text-slate-600">
        Already registered?{' '}
        <Link to="/login" className="font-medium text-slate-900 underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
