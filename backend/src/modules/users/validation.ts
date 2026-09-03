/**
 * modules/users/validation.ts
 * ---------------------------------------------------------------------------
 * Schemas for admin user management.
 *
 * Unlike the auth module, `role` IS accepted here - but only because every
 * route in this module is behind `authorize('ADMIN')`. The difference between
 * this file and auth/validation.ts is the whole lesson of RBAC: the same field
 * is dangerous on a public endpoint and routine on a protected one.
 */
import { z } from 'zod';

export const listUsersQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  role: z.enum(['CUSTOMER', 'ADMIN', 'STAFF']).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'DEACTIVATED']).optional(),
  /** Free-text match on name or email. */
  search: z.string().trim().max(120).optional(),
});

export const userIdParamSchema = z.object({
  id: z.string().uuid('Invalid user id'),
});

export const createStaffSchema = z.object({
  fullName: z.string().min(2).max(120).trim(),
  email: z.string().email().max(255).transform((v) => v.trim().toLowerCase()),
  password: z
    .string()
    .min(8)
    .max(128)
    .regex(/[a-z]/, 'Password must contain a lowercase letter')
    .regex(/[A-Z]/, 'Password must contain an uppercase letter')
    .regex(/[0-9]/, 'Password must contain a number'),
  role: z.enum(['ADMIN', 'STAFF']),
  phone: z.string().regex(/^\+?[1-9]\d{7,14}$/).optional(),
});

export const updateUserSchema = z
  .object({
    fullName: z.string().min(2).max(120).trim().optional(),
    phone: z.string().regex(/^\+?[1-9]\d{7,14}$/).optional(),
    country: z.string().length(2).toUpperCase().optional(),
    role: z.enum(['CUSTOMER', 'ADMIN', 'STAFF']).optional(),
    status: z.enum(['ACTIVE', 'SUSPENDED', 'DEACTIVATED']).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update',
  });

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
export type CreateStaffInput = z.infer<typeof createStaffSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
