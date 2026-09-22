/**
 * features/auth/schemas.ts
 * ---------------------------------------------------------------------------
 * Client-side form validation, mirroring the backend's Zod schemas.
 *
 * Why validate twice? Different jobs. The frontend copy gives instant feedback
 * as you type - no round trip to be told the password is too short. The backend
 * copy is the one that actually enforces the rule, because the frontend can be
 * bypassed entirely.
 *
 * These two files must be kept in step. Phase 11 moves them into a shared
 * package so they cannot drift.
 */
import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

export const registerSchema = z
  .object({
    fullName: z.string().min(2, 'Please enter your full name').max(120),
    email: z.string().min(1, 'Email is required').email('Enter a valid email address'),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .regex(/[a-z]/, 'Include a lowercase letter')
      .regex(/[A-Z]/, 'Include an uppercase letter')
      .regex(/[0-9]/, 'Include a number'),
    confirmPassword: z.string().min(1, 'Please confirm your password'),
    /*
     * Asked here rather than at booking.
     *
     * It used to be collected on the profile page, so the first time most
     * customers were asked was halfway through a booking - car chosen, dates
     * picked, and then a stop to fill in a form. One field on a form somebody
     * is already completing is a far smaller ask than an interruption at the
     * moment they are trying to pay.
     *
     * The bounds only reject dates that cannot describe a living driver. The
     * real minimum rental age is a business setting checked at booking time
     * against the pickup date, which is a different question from whether
     * somebody may hold an account.
     */
    dateOfBirth: z
      .string()
      .min(1, 'Date of birth is required')
      .refine(
        (value) => {
          const years =
            (Date.now() - new Date(value).getTime()) / (365.25 * 24 * 60 * 60 * 1000);
          return years >= 16 && years <= 110;
        },
        { message: 'Enter a valid date of birth' },
      ),
    phone: z
      .string()
      .regex(/^\+?[1-9]\d{7,14}$/, 'Enter a valid mobile number, e.g. +971501234567')
      .optional()
      .or(z.literal('')),
    country: z.string().length(2, 'Use a 2-letter code, e.g. AE').optional().or(z.literal('')),
  })
  // Confirm-password exists only in the UI: the backend never sees it, because
  // "did the user type it twice" is a typing-mistake check, not a security rule.
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export const forgotPasswordSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Enter a valid email address'),
});

export const resetPasswordSchema = z
  .object({
    // The same rules the backend enforces on a reset. Mirrored so somebody
    // choosing a new password is told as they type, not after a round trip.
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .regex(/[a-z]/, 'Include a lowercase letter')
      .regex(/[A-Z]/, 'Include an uppercase letter')
      .regex(/[0-9]/, 'Include a number'),
    confirmPassword: z.string().min(1, 'Please confirm your password'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export type ForgotPasswordFormValues = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordFormValues = z.infer<typeof resetPasswordSchema>;
export type LoginFormValues = z.infer<typeof loginSchema>;
export type RegisterFormValues = z.infer<typeof registerSchema>;
