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
import { ArrowRight } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import FormField from '../components/FormField';
import AuthVisual from '../components/AuthVisual';
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
        dateOfBirth: values.dateOfBirth,
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
    <div className="page-container pt-8 sm:pt-12">
      <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
        <div className="mx-auto flex w-full max-w-md flex-col justify-center py-6 lg:py-12">
          <p className="section-eyebrow">New here</p>
          <h1 className="display-heading mt-4 text-[2.5rem] sm:text-5xl">
            Create your <span className="font-editorial">account.</span>
          </h1>
          <p className="mt-3 text-[15px] text-ink-500">Book vehicles and manage your rentals.</p>

          <form onSubmit={onSubmit} className="mt-10 space-y-5" noValidate>
            {serverError && (
              <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm text-red-700">
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
              label="Date of birth"
              type="date"
              autoComplete="bday"
              hint="Drivers must meet our minimum age. We ask once, here, so it never interrupts a booking."
              error={errors.dateOfBirth?.message}
              {...register('dateOfBirth')}
            />
            <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_8rem]">
              <FormField
                label="Mobile number"
                type="tel"
                autoComplete="tel"
                hint="Optional. With country code, e.g. +971501234567"
                error={errors.phone?.message}
                {...register('phone')}
              />
              <FormField
                label="Country"
                hint="Optional, e.g. AE"
                maxLength={2}
                error={errors.country?.message}
                {...register('country')}
              />
            </div>
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

            <button type="submit" disabled={isSubmitting} className="btn btn-primary btn-lg w-full">
              {isSubmitting ? 'Creating account…' : 'Create account'}
              {!isSubmitting && <ArrowRight aria-hidden className="btn-arrow h-4 w-4" />}
            </button>
          </form>

          <p className="mt-8 text-sm text-ink-500">
            Already registered?{' '}
            <Link to="/login" className="font-semibold text-ink-950 underline underline-offset-4">
              Sign in
            </Link>
          </p>
        </div>

        <AuthVisual />
      </div>
    </div>
  );
}
