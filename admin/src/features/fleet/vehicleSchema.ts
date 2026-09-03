/**
 * features/fleet/vehicleSchema.ts
 * ---------------------------------------------------------------------------
 * Client-side mirror of the backend's vehicle schema.
 *
 * Money stays a STRING here, exactly as on the backend. An <input type="number">
 * would hand us a JavaScript float and lose the precision the DECIMAL column
 * exists to preserve, so prices use text inputs with a pattern instead.
 */
import { z } from 'zod';

const money = z
  .string()
  .min(1, 'Required')
  .regex(/^\d{1,8}(\.\d{1,2})?$/, 'Use a number like 250 or 249.50');

const optionalMoney = z
  .string()
  .regex(/^\d{1,8}(\.\d{1,2})?$/, 'Use a number like 250 or 249.50')
  .optional()
  .or(z.literal(''));

export const vehicleFormSchema = z.object({
  brand: z.string().min(1, 'Brand is required').max(60),
  model: z.string().min(1, 'Model is required').max(60),
  year: z.coerce.number().int().min(1980).max(new Date().getFullYear() + 1),
  variant: z.string().max(60).optional().or(z.literal('')),
  registrationNumber: z.string().min(1, 'Registration number is required').max(20),

  categoryId: z.string().uuid('Select a category'),
  locationId: z.string().optional().or(z.literal('')),

  seats: z.coerce.number().int().min(1).max(50),
  doors: z.coerce.number().int().min(1).max(10),
  transmission: z.enum(['AUTOMATIC', 'MANUAL']),
  fuelType: z.enum(['PETROL', 'DIESEL', 'HYBRID', 'ELECTRIC']),
  color: z.string().max(40).optional().or(z.literal('')),

  dailyPrice: money,
  weeklyPrice: optionalMoney,
  monthlyPrice: optionalMoney,
  securityDeposit: money,
  mileageLimitPerDay: z.string().optional().or(z.literal('')),
  extraMileageCharge: optionalMoney,

  status: z.enum([
    'AVAILABLE',
    'RESERVED',
    'RENTED',
    'UNDER_INSPECTION',
    'UNDER_MAINTENANCE',
    'UNAVAILABLE',
  ]),
  isFeatured: z.boolean(),
  isPublished: z.boolean(),
  description: z.string().max(2000).optional().or(z.literal('')),
});

export type VehicleFormValues = z.infer<typeof vehicleFormSchema>;

/**
 * Turn form values into an API payload.
 *
 * Empty strings become `undefined`, because '' is not a valid optional value on
 * the backend - it would fail the money regex or be stored as an empty variant.
 */
export function toApiPayload(
  values: VehicleFormValues,
  featureIds: string[],
): Record<string, unknown> {
  const clean = (value: string | undefined) => (value === '' || value === undefined ? undefined : value);

  return {
    brand: values.brand,
    model: values.model,
    year: values.year,
    variant: clean(values.variant),
    registrationNumber: values.registrationNumber,
    categoryId: values.categoryId,
    locationId: clean(values.locationId),
    seats: values.seats,
    doors: values.doors,
    transmission: values.transmission,
    fuelType: values.fuelType,
    color: clean(values.color),
    dailyPrice: values.dailyPrice,
    weeklyPrice: clean(values.weeklyPrice),
    monthlyPrice: clean(values.monthlyPrice),
    securityDeposit: values.securityDeposit,
    mileageLimitPerDay: clean(values.mileageLimitPerDay)
      ? Number(values.mileageLimitPerDay)
      : undefined,
    extraMileageCharge: clean(values.extraMileageCharge),
    status: values.status,
    isFeatured: values.isFeatured,
    isPublished: values.isPublished,
    description: clean(values.description),
    featureIds,
  };
}
