/**
 * modules/damages/routes.ts
 * ---------------------------------------------------------------------------
 * Damage recording and assessment (BRD 30, 38).
 *
 * Entirely back-office. A customer never files a damage report against
 * themselves, and letting them near these endpoints would only create a way to
 * dispute a charge by editing the record behind it. Customers see the OUTCOME
 * through their booking's additional charges and their deposit ledger, both of
 * which they can already read.
 *
 * The route order matters: `report` -> `assess` -> `raiseCharge` is a
 * deliberate three-step, so no single click turns a scratch into money taken
 * off a deposit.
 */
import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate';
import { authorizeStaff, authorizeAdmin } from '../../middleware/authorize';
import { getValidatedQuery, validate } from '../../middleware/validate';
import { uploadVehicleImages } from '../../middleware/upload';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendCreated, sendPaginated, sendSuccess } from '../../utils/apiResponse';
import { ApiError } from '../../utils/ApiError';
import { requestContext } from '../audit/service';
import { damagesService, type FleetActor } from './service';

const money = z.string().regex(/^\d{1,8}(\.\d{1,2})?$/, 'Enter an amount like 250 or 249.50');

const idParam = z.object({ id: z.string().uuid('Invalid id') });

const reportSchema = z.object({
  vehicleId: z.string().uuid('Select a vehicle'),
  bookingId: z.string().uuid().optional(),
  type: z.enum(['SCRATCH', 'DENT', 'BROKEN_PART', 'INTERIOR', 'TYRE', 'GLASS', 'MECHANICAL', 'OTHER']),
  description: z.string().min(3, 'Describe the damage').max(1000).trim(),
  location: z.string().max(120).trim().optional(),
  // An estimate, not a charge. The amount that reaches the customer is the
  // approved one, set at assessment.
  estimatedAmount: money.optional(),
});

const assessSchema = z.object({
  approve: z.boolean(),
  approvedAmount: money.optional(),
  notes: z.string().max(1000).trim().optional(),
});

const listSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  vehicleId: z.string().uuid().optional(),
  bookingId: z.string().uuid().optional(),
  status: z.enum(['REPORTED', 'ASSESSED', 'APPROVED', 'DISMISSED', 'CHARGED']).optional(),
});

function actorFrom(req: Parameters<typeof requestContext>[0]): FleetActor {
  return {
    id: req.user!.id,
    email: req.user!.email,
    role: req.user!.role,
    ...requestContext(req),
  };
}

const router = Router();

router.use(authenticate, authorizeStaff);

/** GET /damages - the damage queue. */
router.get(
  '/',
  validate({ query: listSchema }),
  asyncHandler(async (req, res) => {
    const query = getValidatedQuery<z.infer<typeof listSchema>>(req);
    const { items, total } = await damagesService.list(query);
    sendPaginated(res, items, query.page, query.limit, total);
  }),
);

/** POST /damages - record damage found at a return inspection. */
router.post(
  '/',
  validate({ body: reportSchema }),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof reportSchema>;
    sendCreated(res, await damagesService.report(input, actorFrom(req)));
  }),
);

/**
 * POST /damages/:id/photos - evidence.
 *
 * Photos are what makes a damage charge defensible three months later, so
 * they attach to the record rather than living in someone's phone.
 */
router.post(
  '/:id/photos',
  validate({ params: idParam }),
  uploadVehicleImages,
  asyncHandler(async (req, res) => {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length === 0) throw ApiError.badRequest('Attach at least one photo');

    sendCreated(res, await damagesService.addPhotos(req.params.id as string, files, actorFrom(req)));
  }),
);

/**
 * PATCH /damages/:id/assess - approve at an amount, or dismiss.
 *
 * ADMIN only. Deciding what a customer owes is a different authority from
 * noticing a scratch, and keeping the two roles apart means the person who
 * inspects the car cannot also set the price of the damage they found.
 */
router.patch(
  '/:id/assess',
  authorizeAdmin,
  validate({ params: idParam, body: assessSchema }),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof assessSchema>;
    sendSuccess(res, await damagesService.assess(req.params.id as string, input, actorFrom(req)));
  }),
);

/**
 * POST /damages/:id/charge - turn an approved damage into a charge.
 *
 * ADMIN only, and separate from assessment on purpose: approving an amount
 * and actually billing it are two decisions, and the second one is the one
 * that touches the customer's deposit.
 */
router.post(
  '/:id/charge',
  authorizeAdmin,
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    sendCreated(res, await damagesService.raiseCharge(req.params.id as string, actorFrom(req)));
  }),
);

export const damageRoutes = router;
