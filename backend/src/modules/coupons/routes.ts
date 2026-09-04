/**
 * modules/coupons/routes.ts
 * ---------------------------------------------------------------------------
 * Promo code management (BRD 19).
 *
 * There is deliberately NO public "list all coupons" endpoint. Codes are
 * marketing: they go out in a campaign, not in a JSON array anyone can fetch.
 * The only thing a customer can do is present one, and that happens through
 * the pricing quote, where the engine decides what it is worth.
 */
import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate';
import { authorizeAdmin, authorizeStaff } from '../../middleware/authorize';
import { getValidatedQuery, validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendCreated, sendPaginated, sendSuccess } from '../../utils/apiResponse';
import { requestContext } from '../audit/service';
import { couponsService, type CouponActor } from './service';

const money = z.string().regex(/^\d{1,8}(\.\d{1,2})?$/, 'Enter an amount like 250 or 249.50');
const idParam = z.object({ id: z.string().uuid('Invalid id') });

const createSchema = z
  .object({
    code: z.string().min(3, 'A code needs at least 3 characters').max(40).trim(),
    description: z.string().max(200).trim().optional(),
    discountType: z.enum(['PERCENTAGE', 'FIXED_AMOUNT']),
    value: money,
    maxDiscount: money.optional(),
    minRentalAmount: money.optional(),
    minRentalDays: z.coerce.number().int().positive().max(365).optional(),
    validFrom: z.coerce.date(),
    validUntil: z.coerce.date(),
    usageLimit: z.coerce.number().int().positive().optional(),
    perCustomerLimit: z.coerce.number().int().positive().optional(),
    categoryId: z.string().uuid().optional(),
    vehicleId: z.string().uuid().optional(),
  })
  .refine((data) => !(data.categoryId && data.vehicleId), {
    message: 'Scope a code to a category or a vehicle, not both',
    path: ['vehicleId'],
  });

const updateSchema = z.object({
  description: z.string().max(200).trim().optional(),
  isActive: z.boolean().optional(),
  validUntil: z.coerce.date().optional(),
  usageLimit: z.coerce.number().int().positive().nullable().optional(),
});

const listSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  activeOnly: z.coerce.boolean().optional(),
});

function actorFrom(req: Parameters<typeof requestContext>[0]): CouponActor {
  return {
    id: req.user!.id,
    email: req.user!.email,
    role: req.user!.role,
    ...requestContext(req),
  };
}

const router = Router();

router.use(authenticate, authorizeStaff);

router.get(
  '/',
  validate({ query: listSchema }),
  asyncHandler(async (req, res) => {
    const query = getValidatedQuery<z.infer<typeof listSchema>>(req);
    const { items, total } = await couponsService.list(query);
    sendPaginated(res, items, query.page, query.limit, total);
  }),
);

/** POST /coupons - ADMIN only: a coupon is a decision to give money away. */
router.post(
  '/',
  authorizeAdmin,
  validate({ body: createSchema }),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof createSchema>;
    sendCreated(res, await couponsService.create(input, actorFrom(req)));
  }),
);

/**
 * PATCH /coupons/:id
 *
 * Availability only - the discount type and value are not editable. Codes
 * already redeemed were redeemed at a particular value, and changing it would
 * make those bookings' paperwork wrong. Withdraw and reissue instead.
 */
router.patch(
  '/:id',
  authorizeAdmin,
  validate({ params: idParam, body: updateSchema }),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof updateSchema>;
    sendSuccess(res, await couponsService.update(req.params.id as string, input, actorFrom(req)));
  }),
);

router.delete(
  '/:id',
  authorizeAdmin,
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    await couponsService.remove(req.params.id as string, actorFrom(req));
    sendSuccess(res, null, 'Coupon withdrawn');
  }),
);

export const couponRoutes = router;
