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

/**
 * Date of birth, asked at REGISTRATION.
 *
 * ===========================================================================
 * WHY HERE AND NOT AT BOOKING
 * ===========================================================================
 * It used to be collected on the profile screen, which meant the first time
 * most customers were asked was halfway through a booking - the minimum-age
 * rule would fire, the booking would stop, and somebody who had already chosen
 * a car and picked dates was sent off to fill in a form. That is the worst
 * possible moment to ask: the customer is committed, and the question looks
 * like the system failing rather than a rule being applied.
 *
 * Asking at sign-up costs one field on a form somebody is already filling in,
 * and means the age rule can be checked silently ever after.
 *
 * REQUIRED, because a rental business cannot hand a car to somebody whose age
 * it does not know, and an optional field here just moves the interruption
 * back to the booking screen for anybody who skipped it.
 *
 * The bounds are deliberately wide: 16 to 110 only rejects dates that cannot
 * describe a living driver. The REAL minimum age is a client setting, enforced
 * at booking time against the PICKUP date - a 20-year-old signing up today is
 * allowed to hold an account, and may or may not be allowed to rent, and those
 * are different questions.
 */
const dateOfBirthSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD')
  .refine(
    (value) => {
      const years = (Date.now() - new Date(value).getTime()) / (365.25 * 24 * 60 * 60 * 1000);
      return years >= 16 && years <= 110;
    },
    { message: 'Enter a valid date of birth' },
  );

export const registerSchema = z.object({
  fullName: z.string().min(2, 'Full name is required').max(120).trim(),
  email: emailSchema,
  password: passwordSchema,
  dateOfBirth: dateOfBirthSchema,
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
/*
 * Asking for a reset takes an email and nothing else.
 *
 * The response is identical whether or not the address is known (see
 * verificationService), so there is nothing here to validate beyond "is this
 * shaped like an email at all".
 */
export const forgotPasswordSchema = z.object({
  email: z.string().email('Enter a valid email address').toLowerCase().trim(),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, 'This link is missing its token'),
  // The FULL password rules: a reset is where a weak password would otherwise
  // sneak in, since the change-password endpoint's leniency is only about
  // accepting an OLD password, never about setting a new one.
  password: passwordSchema,
});

export const verifyEmailSchema = z.object({
  token: z.string().min(1, 'This link is missing its token'),
});

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
