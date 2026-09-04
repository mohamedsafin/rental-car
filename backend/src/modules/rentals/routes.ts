/**
 * modules/rentals/routes.ts
 * ---------------------------------------------------------------------------
 * Pickup, return, inspection photos, charges and extensions.
 *
 * Almost everything here is STAFF work - it happens at the counter, with the
 * car present. The two exceptions are a customer viewing their own rental and
 * requesting an extension, both of which check ownership in the service.
 */
import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate';
import { authorizeStaff, authorizeAdmin } from '../../middleware/authorize';
import { getValidatedQuery, validate } from '../../middleware/validate';
import { uploadVehicleImages } from '../../middleware/upload';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendCreated, sendSuccess } from '../../utils/apiResponse';
import { ApiError } from '../../utils/ApiError';
import { prisma } from '../../config/prisma';
import { requestContext } from '../audit/service';
import { rentalsService, type RentalActor } from './service';
import { extensionsService } from './extensionService';
import { inspectionPhotoService } from './photoService';

const bookingIdParam = z.object({ bookingId: z.string().uuid('Invalid booking id') });
const chargeIdParam = z.object({ chargeId: z.string().uuid('Invalid charge id') });
const extensionIdParam = z.object({ extensionId: z.string().uuid('Invalid extension id') });

/** Fuel is recorded as a percentage, 0-100 (BRD 30). */
const fuelPercent = z.coerce.number().int().min(0).max(100);
const mileage = z.coerce.number().int().min(0).max(2_000_000);

const pickupSchema = z.object({
  mileage,
  fuelPercent,
  // Not optional and not defaulted: BRD 24 puts customer verification first in
  // the handover checklist, so staff must actively confirm it.
  customerVerified: z.boolean(),
  conditionNotes: z.string().max(2000).trim().optional(),
  damageNotes: z.string().max(2000).trim().optional(),
  accessories: z.array(z.string().max(60)).max(30).optional(),
});

const returnSchema = z.object({
  mileage,
  fuelPercent,
  conditionNotes: z.string().max(2000).trim().optional(),
  damageNotes: z.string().max(2000).trim().optional(),
  cleanliness: z.string().max(200).trim().optional(),
  needsCleaning: z.boolean().default(false),
  missingAccessories: z.array(z.string().max(60)).max(30).optional(),
});

const photoQuerySchema = z.object({
  type: z
    .enum([
      'FRONT',
      'REAR',
      'LEFT_SIDE',
      'RIGHT_SIDE',
      'INTERIOR',
      'DASHBOARD',
      'ODOMETER',
      'DAMAGE',
      'OTHER',
    ])
    .default('OTHER'),
});

const isoDateTime = z
  .string()
  .datetime({ offset: true })
  .or(z.string().datetime())
  .transform((value) => new Date(value));

const extensionRequestSchema = z.object({ requestedReturnAt: isoDateTime });

const extensionReviewSchema = z
  .object({
    approve: z.boolean(),
    rejectionReason: z.string().max(500).trim().optional(),
  })
  .refine((data) => data.approve || (data.rejectionReason?.length ?? 0) >= 3, {
    message: 'Give a reason so the customer knows why',
    path: ['rejectionReason'],
  });

const waiveSchema = z.object({
  reason: z.string().min(3, 'Say why this charge is being written off').max(500).trim(),
});

function actorFrom(req: Parameters<typeof requestContext>[0]): RentalActor {
  return {
    id: req.user!.id,
    email: req.user!.email,
    role: req.user!.role,
    ...requestContext(req),
  };
}

/** Customers may read their own rental; staff may read any. */
async function assertCanView(bookingId: string, actor: RentalActor): Promise<void> {
  if (actor.role === 'ADMIN' || actor.role === 'STAFF') return;

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { customerId: true },
  });
  // 404 rather than 403, so a booking id cannot be probed for existence.
  if (!booking || booking.customerId !== actor.id) throw ApiError.notFound('Booking not found');
}

const router = Router();

router.use(authenticate);

/** GET /rentals/booking/:bookingId - the rental, inspections and charges. */
router.get(
  '/booking/:bookingId',
  validate({ params: bookingIdParam }),
  asyncHandler(async (req, res) => {
    const bookingId = req.params.bookingId as string;
    await assertCanView(bookingId, actorFrom(req));

    const rental = await rentalsService.getByBookingId(bookingId);
    const extensions = await extensionsService.listForBooking(bookingId);

    sendSuccess(res, { rental, extensions }, rental ? 'Rental retrieved' : 'Not handed over yet');
  }),
);

// --- Handover and return (staff) ------------------------------------------

router.post(
  '/booking/:bookingId/pickup',
  authorizeStaff,
  validate({ params: bookingIdParam, body: pickupSchema }),
  asyncHandler(async (req, res) => {
    const rental = await rentalsService.recordPickup(
      req.params.bookingId as string,
      req.body as z.infer<typeof pickupSchema>,
      actorFrom(req),
    );
    sendCreated(res, { rental }, 'Vehicle handed over');
  }),
);

router.post(
  '/booking/:bookingId/return',
  authorizeStaff,
  validate({ params: bookingIdParam, body: returnSchema }),
  asyncHandler(async (req, res) => {
    const result = await rentalsService.recordReturn(
      req.params.bookingId as string,
      req.body as z.infer<typeof returnSchema>,
      actorFrom(req),
    );
    sendSuccess(
      res,
      result,
      result.charges.length > 0
        ? `Vehicle returned with ${result.charges.length} charge(s)`
        : 'Vehicle returned with no additional charges',
    );
  }),
);

router.post(
  '/booking/:bookingId/close',
  authorizeStaff,
  validate({ params: bookingIdParam }),
  asyncHandler(async (req, res) => {
    const rental = await rentalsService.closeRental(req.params.bookingId as string, actorFrom(req));
    sendSuccess(res, { rental }, 'Rental closed and vehicle back in service');
  }),
);

// --- Inspection photos (BRD 25) -------------------------------------------

router.post(
  '/inspections/:inspectionId/photos',
  authorizeStaff,
  validate({ params: z.object({ inspectionId: z.string().uuid('Invalid inspection id') }) }),
  uploadVehicleImages,
  validate({ query: photoQuerySchema }),
  asyncHandler(async (req, res) => {
    const files = req.files as Express.Multer.File[] | undefined;
    if (!files || files.length === 0) throw ApiError.badRequest('Attach at least one photo');

    const { type } = getValidatedQuery<z.infer<typeof photoQuerySchema>>(req);

    const rental = await inspectionPhotoService.upload(
      req.params.inspectionId as string,
      files,
      type,
      actorFrom(req),
    );

    sendCreated(res, { rental }, `${files.length} photo(s) added`);
  }),
);

// --- Charges ---------------------------------------------------------------

router.post(
  '/charges/:chargeId/settle',
  authorizeStaff,
  validate({ params: chargeIdParam }),
  asyncHandler(async (req, res) => {
    const rental = await rentalsService.settleChargeFromDeposit(
      req.params.chargeId as string,
      actorFrom(req),
    );
    sendSuccess(res, { rental }, 'Charge settled from the security deposit');
  }),
);

router.post(
  '/charges/:chargeId/waive',
  // Writing off money is an admin decision, not a counter one.
  authorizeAdmin,
  validate({ params: chargeIdParam, body: waiveSchema }),
  asyncHandler(async (req, res) => {
    const rental = await rentalsService.waiveCharge(
      req.params.chargeId as string,
      (req.body as z.infer<typeof waiveSchema>).reason,
      actorFrom(req),
    );
    sendSuccess(res, { rental }, 'Charge waived');
  }),
);

// --- Extensions (BRD 23) ---------------------------------------------------

/** Customers request their own; staff can request on their behalf. */
router.post(
  '/booking/:bookingId/extensions',
  validate({ params: bookingIdParam, body: extensionRequestSchema }),
  asyncHandler(async (req, res) => {
    const extension = await extensionsService.request(
      req.params.bookingId as string,
      (req.body as z.infer<typeof extensionRequestSchema>).requestedReturnAt,
      actorFrom(req),
    );
    sendCreated(res, { extension }, 'Extension requested');
  }),
);

router.patch(
  '/extensions/:extensionId/review',
  authorizeStaff,
  validate({ params: extensionIdParam, body: extensionReviewSchema }),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof extensionReviewSchema>;
    const extension = await extensionsService.review(
      req.params.extensionId as string,
      input,
      actorFrom(req),
    );
    sendSuccess(res, { extension }, input.approve ? 'Extension approved' : 'Extension rejected');
  }),
);

export const rentalRoutes = router;
