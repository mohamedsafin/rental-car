/**
 * modules/vehicles/validation.ts
 * ---------------------------------------------------------------------------
 * Schemas for the fleet.
 *
 * Prices arrive as strings, not numbers. JSON numbers are IEEE-754 doubles, so
 * a price sent as a number has already lost precision before we see it. Keeping
 * money as a decimal string all the way into Postgres' DECIMAL column is the
 * only way a 30-day total adds up to the fils.
 */
import { z } from 'zod';

/** A non-negative money amount with at most 2 decimal places, e.g. "249.50". */
const moneySchema = z
  .string()
  .regex(/^\d{1,8}(\.\d{1,2})?$/, 'Enter an amount like 250 or 249.50')
  .refine((value) => Number(value) >= 0, 'Amount cannot be negative');

const currentYear = new Date().getFullYear();

export const createVehicleSchema = z.object({
  brand: z.string().min(1, 'Brand is required').max(60).trim(),
  model: z.string().min(1, 'Model is required').max(60).trim(),
  // Next year's models go on sale this year, hence +1.
  year: z.coerce.number().int().min(1980).max(currentYear + 1),
  variant: z.string().max(60).trim().optional(),
  registrationNumber: z
    .string()
    .min(1, 'Registration number is required')
    .max(20)
    .trim()
    .toUpperCase(),

  categoryId: z.string().uuid('Select a category'),
  locationId: z.string().uuid().optional(),

  seats: z.coerce.number().int().min(1).max(50),
  doors: z.coerce.number().int().min(1).max(10).default(4),
  transmission: z.enum(['AUTOMATIC', 'MANUAL']),
  fuelType: z.enum(['PETROL', 'DIESEL', 'HYBRID', 'ELECTRIC']),
  color: z.string().max(40).trim().optional(),

  dailyPrice: moneySchema,
  weeklyPrice: moneySchema.optional(),
  monthlyPrice: moneySchema.optional(),
  securityDeposit: moneySchema,
  /// Null/omitted means unlimited mileage.
  mileageLimitPerDay: z.coerce.number().int().min(0).max(10000).optional(),
  extraMileageCharge: moneySchema.optional(),

  status: z
    .enum(['AVAILABLE', 'RESERVED', 'RENTED', 'UNDER_INSPECTION', 'UNDER_MAINTENANCE', 'UNAVAILABLE'])
    .default('AVAILABLE'),
  currentMileage: z.coerce.number().int().min(0).default(0),

  isFeatured: z.boolean().default(false),
  isPublished: z.boolean().default(true),
  description: z.string().max(2000).trim().optional(),

  /// Feature ids to attach. Replaces the whole set on update.
  featureIds: z.array(z.string().uuid()).max(40).default([]),
});

export const updateVehicleSchema = createVehicleSchema
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update',
  });

export const vehicleIdParamSchema = z.object({
  id: z.string().uuid('Invalid vehicle id'),
});

export const imageIdParamSchema = z.object({
  id: z.string().uuid('Invalid vehicle id'),
  imageId: z.string().uuid('Invalid image id'),
});

export const listVehiclesQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(60).default(12),
  categoryId: z.string().uuid().optional(),
  /// Category slug, so the customer site can link /cars?category=suv.
  category: z.string().max(80).optional(),
  transmission: z.enum(['AUTOMATIC', 'MANUAL']).optional(),
  fuelType: z.enum(['PETROL', 'DIESEL', 'HYBRID', 'ELECTRIC']).optional(),
  seats: z.coerce.number().int().min(1).max(50).optional(),
  minPrice: z.coerce.number().min(0).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
  locationId: z.string().uuid().optional(),
  search: z.string().trim().max(80).optional(),
  sort: z.enum(['price_asc', 'price_desc', 'newest', 'year_desc']).default('newest'),

  // --- Admin-only filters. The controller strips these for public callers,
  // so a customer cannot list unpublished or deleted vehicles by guessing.
  status: z
    .enum(['AVAILABLE', 'RESERVED', 'RENTED', 'UNDER_INSPECTION', 'UNDER_MAINTENANCE', 'UNAVAILABLE'])
    .optional(),
  includeUnpublished: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

export const uploadImagesQuerySchema = z.object({
  type: z
    .enum([
      'EXTERIOR_FRONT',
      'EXTERIOR_REAR',
      'EXTERIOR_LEFT',
      'EXTERIOR_RIGHT',
      'INTERIOR_DASHBOARD',
      'INTERIOR_FRONT',
      'INTERIOR_REAR',
      'INTERIOR_SEATS',
      'OTHER',
    ])
    .default('OTHER'),
});

export type CreateVehicleInput = z.infer<typeof createVehicleSchema>;
export type UpdateVehicleInput = z.infer<typeof updateVehicleSchema>;
export type ListVehiclesQuery = z.infer<typeof listVehiclesQuerySchema>;
export type UploadImagesQuery = z.infer<typeof uploadImagesQuerySchema>;
