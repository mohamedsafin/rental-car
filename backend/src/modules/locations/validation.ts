/**
 * modules/locations/validation.ts
 * ---------------------------------------------------------------------------
 * Offices, airports, hotels and delivery areas (BRD 38).
 */
import { z } from 'zod';

const moneySchema = z
  .string()
  .regex(/^\d{1,8}(\.\d{1,2})?$/, 'Enter an amount like 0 or 75.00');

/**
 * Working hours, keyed by weekday. `null` means closed that day.
 *
 * JSON rather than seven pairs of columns because BRD 38 only says "working
 * hours" - the real shape (split shifts? public holidays?) is unconfirmed, and
 * inventing a rigid schema now would mean a migration when the client answers.
 */
const dayHoursSchema = z
  .object({
    open: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour time, e.g. 08:00'),
    close: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour time, e.g. 20:00'),
  })
  .nullable();

const workingHoursSchema = z.object({
  mon: dayHoursSchema,
  tue: dayHoursSchema,
  wed: dayHoursSchema,
  thu: dayHoursSchema,
  fri: dayHoursSchema,
  sat: dayHoursSchema,
  sun: dayHoursSchema,
});

export const createLocationSchema = z.object({
  name: z.string().min(2, 'Location name is required').max(120).trim(),
  type: z.enum(['OFFICE', 'AIRPORT', 'HOTEL', 'DELIVERY_AREA']).default('OFFICE'),
  address: z.string().max(300).trim().optional(),
  emirate: z.string().max(60).trim().optional(),
  phone: z.string().regex(/^\+?[1-9]\d{7,14}$/, 'Enter a valid phone number').optional(),
  email: z.string().email().max(255).optional(),
  workingHours: workingHoursSchema.optional(),
  // Latitude/longitude as strings for the same reason as money: JSON numbers
  // lose precision, and 7 decimal places is roughly 1cm of accuracy.
  latitude: z.string().regex(/^-?\d{1,2}(\.\d{1,7})?$/, 'Invalid latitude').optional(),
  longitude: z.string().regex(/^-?\d{1,3}(\.\d{1,7})?$/, 'Invalid longitude').optional(),
  deliveryCharge: moneySchema.default('0'),
  isPickupPoint: z.boolean().default(true),
  isDropoffPoint: z.boolean().default(true),
  isActive: z.boolean().default(true),
});

export const updateLocationSchema = createLocationSchema.partial().refine(
  (data) => Object.keys(data).length > 0,
  { message: 'Provide at least one field to update' },
);

export const locationIdParamSchema = z.object({
  id: z.string().uuid('Invalid location id'),
});

export const listLocationsQuerySchema = z.object({
  type: z.enum(['OFFICE', 'AIRPORT', 'HOTEL', 'DELIVERY_AREA']).optional(),
  /// Filters to locations customers may pick up from - what the search form wants.
  pickupOnly: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  includeInactive: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
});

export type CreateLocationInput = z.infer<typeof createLocationSchema>;
export type UpdateLocationInput = z.infer<typeof updateLocationSchema>;
export type ListLocationsQuery = z.infer<typeof listLocationsQuerySchema>;
