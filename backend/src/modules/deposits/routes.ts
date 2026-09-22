/**
 * modules/deposits/routes.ts
 * ---------------------------------------------------------------------------
 * Customers can SEE their deposit and its ledger - that transparency is the
 * point of keeping one. Only staff can move money on it.
 */
import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate';
import { authorizeFinance } from '../../middleware/authorize';
import { getValidatedQuery, validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendPaginated, sendSuccess } from '../../utils/apiResponse';
import { ApiError } from '../../utils/ApiError';
import { prisma } from '../../config/prisma';
import { requestContext } from '../audit/service';
import { depositsService, type DepositActor } from './service';
import { isBackOffice } from '../../modules/auth/roles';

const bookingIdParam = z.object({ bookingId: z.string().uuid('Invalid booking id') });

const money = z.string().regex(/^\d{1,8}(\.\d{1,2})?$/, 'Enter an amount like 250 or 249.50');

const deductSchema = z.object({
  amount: money,
  category: z.enum([
    'DAMAGE',
    'TRAFFIC_FINE',
    'TOLL',
    'FUEL',
    'CLEANING',
    'LATE_RETURN',
    'OTHER',
  ]),
  // Required, and enforced again in the service. A deduction the customer
  // cannot understand is a chargeback waiting to happen.
  reason: z.string().min(3, 'Give a reason the customer will understand').max(500).trim(),
});

const releaseSchema = z.object({
  amount: money.optional(),
  reason: z.string().max(500).trim().optional(),
  /*
   * "I know there are unrecovered charges, release it anyway."
   *
   * The server refuses a release while fines or tolls are still outstanding,
   * because that is the exact moment the money becomes uncollectable - the
   * customer is at the counter now and gone in five minutes. But it is a
   * refusal, not a prohibition: a manager may have a reason, and a rule with
   * no override gets worked around by deducting nothing and releasing in two
   * steps. So the override exists, and it is recorded.
   */
  releaseAnyway: z.boolean().default(false),
});

const listSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.enum(['PENDING', 'HELD', 'PARTIALLY_RELEASED', 'RELEASED', 'FORFEITED']).optional(),
});

function actorFrom(req: Parameters<typeof requestContext>[0]): DepositActor {
  return {
    id: req.user!.id,
    email: req.user!.email,
    role: req.user!.role,
    ...requestContext(req),
  };
}

const router = Router();

router.use(authenticate);

/** GET /deposits/booking/:bookingId - the deposit and its full ledger. */
router.get(
  '/booking/:bookingId',
  validate({ params: bookingIdParam }),
  asyncHandler(async (req, res) => {
    const bookingId = req.params.bookingId as string;

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { customerId: true },
    });

    const backOffice = isBackOffice(req.user!.role);
    if (!booking || (!backOffice && booking.customerId !== req.user!.id)) {
      throw ApiError.notFound('Booking not found');
    }

    const deposit = await depositsService.getByBookingId(bookingId);
    sendSuccess(res, { deposit }, deposit ? 'Deposit retrieved' : 'No deposit for this booking');
  }),
);

// --- Staff only ------------------------------------------------------------

router.get(
  '/',
  authorizeFinance,
  validate({ query: listSchema }),
  asyncHandler(async (req, res) => {
    const query = getValidatedQuery<z.infer<typeof listSchema>>(req);
    const { items, total } = await depositsService.list(query);
    sendPaginated(res, items, query.page, query.limit, total, 'Deposits retrieved');
  }),
);

/** POST /deposits/booking/:bookingId/deduct - BRD 20. */
router.post(
  '/booking/:bookingId/deduct',
  authorizeFinance,
  validate({ params: bookingIdParam, body: deductSchema }),
  asyncHandler(async (req, res) => {
    const deposit = await depositsService.deduct(
      req.params.bookingId as string,
      req.body as z.infer<typeof deductSchema>,
      actorFrom(req),
    );
    sendSuccess(res, { deposit }, 'Deduction recorded');
  }),
);

/** POST /deposits/booking/:bookingId/release - return the balance. */
router.post(
  '/booking/:bookingId/release',
  authorizeFinance,
  validate({ params: bookingIdParam, body: releaseSchema }),
  asyncHandler(async (req, res) => {
    const deposit = await depositsService.release(
      req.params.bookingId as string,
      req.body as z.infer<typeof releaseSchema>,
      actorFrom(req),
    );
    sendSuccess(res, { deposit }, 'Deposit released');
  }),
);

export const depositRoutes = router;
