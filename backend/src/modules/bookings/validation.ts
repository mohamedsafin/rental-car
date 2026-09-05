/**
 * modules/bookings/validation.ts
 * ---------------------------------------------------------------------------
 * There is deliberately NO price field on the create schema.
 *
 * `validate` replaces req.body with the parsed result, so a client sending
 * `totalAmount: 1` has it stripped before the service runs - and the service
 * recomputes everything from the pricing engine anyway. Two independent
 * defences against the same attack.
 */
import { z } from 'zod';

const isoDateTime = z
  .string()
  .datetime({ offset: true })
  .or(z.string().datetime())
  .transform((value) => new Date(value));

const ALL_STATUSES = [
  'PENDING',
  'PAYMENT_PENDING',
  'DOCUMENT_VERIFICATION',
  'CONFIRMED',
  'READY_FOR_PICKUP',
  'ACTIVE',
  'EXTENSION_REQUESTED',
  'RETURN_PENDING',
  'RETURNED',
  'COMPLETED',
  'CANCELLED',
] as const;

export const createBookingSchema = z
  .object({
    vehicleId: z.string().uuid('Choose a vehicle'),
    pickupAt: isoDateTime,
    returnAt: isoDateTime,
    pickupLocationId: z.string().uuid().optional(),
    dropoffLocationId: z.string().uuid().optional(),
    services: z
      .array(
        z.object({
          serviceId: z.string().uuid(),
          quantity: z.coerce.number().int().min(1).max(20).default(1),
        }),
      )
      .max(20)
      .default([]),
    customerNotes: z.string().max(1000).trim().optional(),
    /// The promo code as typed. Re-validated server-side at this point, so a
    /// code that expired between quote and checkout is refused here.
    couponCode: z.string().min(1).max(40).trim().optional(),
    /// How the customer intends to pay. CASH_ON_PICKUP is refused unless the
    /// client has switched it on - the browser offering the option does not
    /// make it available.
    paymentMethod: z.enum(['ONLINE', 'CASH_ON_PICKUP']).default('ONLINE'),
  })
  .refine((data) => data.returnAt > data.pickupAt, {
    message: 'Return must be after pickup',
    path: ['returnAt'],
  });

export const bookingIdParamSchema = z.object({ id: z.string().uuid('Invalid booking id') });

export const cancelBookingSchema = z.object({
  reason: z.string().max(500).trim().optional(),
});

export const changeStatusSchema = z.object({
  // CANCELLED is absent on purpose: cancelling has its own endpoint because it
  // must also compute the fee and the refund due.
  status: z.enum([
    'PENDING',
    'PAYMENT_PENDING',
    'DOCUMENT_VERIFICATION',
    'CONFIRMED',
    'READY_FOR_PICKUP',
    'ACTIVE',
    'EXTENSION_REQUESTED',
    'RETURN_PENDING',
    'RETURNED',
    'COMPLETED',
  ]),
  reason: z.string().max(500).trim().optional(),
});

export const myBookingsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(50).default(10),
  scope: z.enum(['upcoming', 'active', 'previous', 'cancelled']).optional(),
});

export const listBookingsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.enum(ALL_STATUSES).optional(),
  vehicleId: z.string().uuid().optional(),
  search: z.string().trim().max(120).optional(),
  from: isoDateTime.optional(),
  to: isoDateTime.optional(),
  /**
   * Which date `from`/`to` apply to.
   *
   * "Due for handover today" and "due back today" are different questions
   * about the same booking, and the answer hinges on which timestamp you
   * filter. Defaults to `pickup` so existing callers are unaffected.
   */
  dateField: z.enum(['pickup', 'return']).default('pickup'),
});

export type CreateBookingInput = z.infer<typeof createBookingSchema>;
export type CancelBookingInput = z.infer<typeof cancelBookingSchema>;
export type ChangeStatusInput = z.infer<typeof changeStatusSchema>;
export type MyBookingsQuery = z.infer<typeof myBookingsQuerySchema>;
export type ListBookingsQuery = z.infer<typeof listBookingsQuerySchema>;
