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

export type LoginFormValues = z.infer<typeof loginSchema>;
export type RegisterFormValues = z.infer<typeof registerSchema>;
