/**
 * modules/availability/validation.ts
 * ---------------------------------------------------------------------------
 * BRD 6 describes the search form as six separate fields: pickup date, pickup
 * time, return date, return time, plus locations. We accept them either as
 * separate date+time pairs (what an HTML form naturally produces) or as full
 * ISO timestamps (what an API client sends), and normalise to two Date objects
 * here so nothing downstream has to think about it.
 */
import { z } from 'zod';

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD');
const timeOnly = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour time, e.g. 10:00');

/**
 * A timestamp, from either an ISO string or a date+time pair.
 *
 * Times without an explicit offset are read as UTC, NOT as the server's local
 * zone. A server that moves region must not silently reinterpret every booking
 * by a few hours.
 */
function combine(date: string, time: string): Date {
  return new Date(`${date}T${time}:00.000Z`);
}

const isoDateTime = z
  .string()
  .datetime({ offset: true })
  .or(z.string().datetime())
  .transform((value) => new Date(value));

export const searchQuerySchema = z
  .object({
    // Either form is accepted.
    pickupAt: isoDateTime.optional(),
    returnAt: isoDateTime.optional(),
    pickupDate: dateOnly.optional(),
    pickupTime: timeOnly.default('10:00'),
    returnDate: dateOnly.optional(),
    returnTime: timeOnly.default('10:00'),

    pickupLocationId: z.string().uuid().optional(),
    dropoffLocationId: z.string().uuid().optional(),

    // Same catalogue filters as /vehicles, so search results can be narrowed.
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(60).default(12),
    category: z.string().max(80).optional(),
    categoryId: z.string().uuid().optional(),
    transmission: z.enum(['AUTOMATIC', 'MANUAL']).optional(),
    fuelType: z.enum(['PETROL', 'DIESEL', 'HYBRID', 'ELECTRIC']).optional(),
    seats: z.coerce.number().int().min(1).max(50).optional(),
    minPrice: z.coerce.number().min(0).optional(),
    maxPrice: z.coerce.number().min(0).optional(),
    search: z.string().trim().max(80).optional(),
    sort: z.enum(['price_asc', 'price_desc', 'newest', 'year_desc']).default('newest'),
  })
  .transform((data, ctx) => {
    const pickupAt = data.pickupAt ?? (data.pickupDate ? combine(data.pickupDate, data.pickupTime) : null);
    const returnAt = data.returnAt ?? (data.returnDate ? combine(data.returnDate, data.returnTime) : null);

    if (!pickupAt || !returnAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide pickup and return dates (pickupDate/returnDate or pickupAt/returnAt)',
      });
      return z.NEVER;
    }

    return { ...data, pickupAt, returnAt };
  });

export const availabilityCheckSchema = z
  .object({
    vehicleId: z.string().uuid('Invalid vehicle id'),
    pickupAt: isoDateTime.optional(),
    returnAt: isoDateTime.optional(),
    pickupDate: dateOnly.optional(),
    pickupTime: timeOnly.default('10:00'),
    returnDate: dateOnly.optional(),
    returnTime: timeOnly.default('10:00'),
  })
  .transform((data, ctx) => {
    const pickupAt = data.pickupAt ?? (data.pickupDate ? combine(data.pickupDate, data.pickupTime) : null);
    const returnAt = data.returnAt ?? (data.returnDate ? combine(data.returnDate, data.returnTime) : null);

    if (!pickupAt || !returnAt) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Provide pickup and return dates' });
      return z.NEVER;
    }

    return { vehicleId: data.vehicleId, pickupAt, returnAt };
  });

export const blockedDatesParamSchema = z.object({
  vehicleId: z.string().uuid('Invalid vehicle id'),
});

export type SearchQuery = z.infer<typeof searchQuerySchema>;
export type AvailabilityCheckInput = z.infer<typeof availabilityCheckSchema>;
