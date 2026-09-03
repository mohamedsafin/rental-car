/**
 * modules/auth/validation.ts
 * ---------------------------------------------------------------------------
 * Zod schemas for every auth endpoint. These run before the controller, so by
 * the time the service sees the data it is already the right shape.
 *
 * Note there is no `role` field on the register schema. `validate` strips
 * unknown keys, so a client posting `role: "ADMIN"` has it discarded - the
 * service hardcodes CUSTOMER. Staff and admin accounts are created only by an
 * existing admin, through the users module.
 */
import { z } from 'zod';

/**
 * Password policy. Length does more for security than symbol requirements, so
 * we require a real minimum and a mix, without the unmemorable-password theatre
 * that pushes people towards "Passw0rd!".
 */
const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(/[a-z]/, 'Password must contain a lowercase letter')
  .regex(/[A-Z]/, 'Password must contain an uppercase letter')
  .regex(/[0-9]/, 'Password must contain a number');

const emailSchema = z
  .string()
  .min(1, 'Email is required')
  .email('Enter a valid email address')
  .max(255)
  // Stored lowercase so Ahmed@x.com and ahmed@x.com cannot become two accounts.
  .transform((value) => value.trim().toLowerCase());

/**
 * E.164, e.g. +971501234567. Optional at registration: the BRD requires a
 * mobile number, but the exact format is client-confirmed, and blocking
 * sign-up on it now would be inventing a rule.
 */
const phoneSchema = z
  .string()
  .regex(/^\+?[1-9]\d{7,14}$/, 'Enter a valid mobile number, e.g. +971501234567')
  .optional();

export const registerSchema = z.object({
  fullName: z.string().min(2, 'Full name is required').max(120).trim(),
  email: emailSchema,
  password: passwordSchema,
  phone: phoneSchema,
  country: z
    .string()
    .length(2, 'Country must be a 2-letter code, e.g. AE')
    .toUpperCase()
    .optional(),
});

export const loginSchema = z.object({
  email: emailSchema,
  // Deliberately NOT passwordSchema: an existing password set under an older
  // policy must still be able to log in. Validating format on login would also
  // tell an attacker what the policy is.
  password: z.string().min(1, 'Password is required'),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: passwordSchema,
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: 'New password must be different from the current password',
    path: ['newPassword'],
  });

export const updateProfileSchema = z.object({
  fullName: z.string().min(2).max(120).trim().optional(),
  phone: phoneSchema,
  country: z.string().length(2).toUpperCase().optional(),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
