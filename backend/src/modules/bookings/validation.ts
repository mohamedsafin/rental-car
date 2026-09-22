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
    /*
     * Who the booking is for, when staff are booking for a walk-in.
     *
     * IGNORED for a customer - the service reads their id from the token
     * instead. Accepting it here and enforcing it there is deliberate: the
     * schema describes the shape of the request, and who may use a field is a
     * question about the caller, which only the service knows.
     */
    customerId: z.string().uuid('Choose a customer').optional(),
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
    /*
     * How the rental is paid for.
     *
     * MONTHLY is the normal arrangement for a long-term fleet: the first month
     * and the deposit confirm the booking, and each later month falls due on
     * its own start date. UPFRONT stays the default so short rentals are
     * unaffected.
     *
     * The TERM is not taken from here - it is derived from the dates, so the
     * schedule cannot disagree with the booking it belongs to.
     */
    billingCycle: z.enum(['UPFRONT', 'MONTHLY']).default('UPFRONT'),
    customerNotes: z.string().max(1000).trim().optional(),
    /// Counter notes. Ignored for a customer - see `customerId` above.
    staffNotes: z.string().max(1000).trim().optional(),
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

/**
 * Changing a booking before the car goes out.
 *
 * Everything optional: the common edit is one field. What is NOT here is as
 * important - no price, no status, no customer. The price is recalculated by
 * the engine, the status has its own endpoint, and moving a booking to a
 * different customer is not an edit, it is a different booking.
 */
export const editBookingSchema = z
  .object({
    pickupAt: isoDateTime.optional(),
    returnAt: isoDateTime.optional(),
    vehicleId: z.string().uuid('Choose a vehicle').optional(),
    pickupLocationId: z.string().uuid().optional(),
    dropoffLocationId: z.string().uuid().optional(),
    reason: z.string().max(500).trim().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one thing to change',
  })
  .refine((data) => !data.pickupAt || !data.returnAt || data.returnAt > data.pickupAt, {
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
  /**
   * "Owes us money for the rental."
   *
   * Not expressible as a single `status` any more. Confirmation happens before
   * payment, so a booking awaiting payment is CONFIRMED *or* PAYMENT_PENDING,
   * and only when it is paid online - a cash booking owes nothing until the
   * counter. The dashboard tile and the outstanding report both mean exactly
   * this, and before this filter existed they answered it differently: the
   * tile counted PAYMENT_PENDING alone and quietly disagreed with the report.
   */
  awaitingPayment: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
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

export type EditBookingInput = z.infer<typeof editBookingSchema>;
