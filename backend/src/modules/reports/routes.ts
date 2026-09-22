/**
 * modules/reports/routes.ts
 * ---------------------------------------------------------------------------
 * Management reports (BRD 48-50). Back-office only.
 *
 * Every report takes an explicit date range rather than a "last 30 days"
 * shortcut. A figure someone screenshots and puts in a board pack needs to say
 * exactly which days it covers - "last 30 days" means something different
 * tomorrow.
 */
import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate';
import { authorizeReports } from '../../middleware/authorize';
import { getValidatedQuery, validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendSuccess } from '../../utils/apiResponse';
import { reportsService } from './service';

/** Defaults to the current month, so a bare request still answers something. */
function defaultRange() {
  const now = new Date();
  return {
    from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    to: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  };
}

const rangeSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

const router = Router();

router.use(authenticate, authorizeReports);

/** GET /reports/dashboard - this month at a glance. */
router.get(
  '/dashboard',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, await reportsService.dashboard());
  }),
);

/**
 * GET /reports/revenue
 *
 * Revenue is what was PAID, not what was booked. Deposits are reported
 * separately and never counted as income.
 */
router.get(
  '/revenue',
  validate({ query: rangeSchema }),
  asyncHandler(async (req, res) => {
    const query = getValidatedQuery<z.infer<typeof rangeSchema>>(req);
    const range = defaultRange();
    sendSuccess(
      res,
      await reportsService.revenue({ from: query.from ?? range.from, to: query.to ?? range.to }),
    );
  }),
);

/**
 * GET /reports/revenue-series - the same money, day by day.
 *
 * A total says how much; this says what shape the month had, which is the part
 * a pricing or fleet decision actually turns on.
 */
router.get(
  '/revenue-series',
  validate({ query: rangeSchema }),
  asyncHandler(async (req, res) => {
    const query = getValidatedQuery<z.infer<typeof rangeSchema>>(req);
    const range = defaultRange();
    sendSuccess(
      res,
      await reportsService.revenueSeries({ from: query.from ?? range.from, to: query.to ?? range.to }),
    );
  }),
);

/**
 * GET /reports/vehicles - which cars earn and which cost.
 *
 * Costs come from the vehicle expense ledger, so a fleet that has never
 * recorded one sees every car showing its full revenue as profit. The response
 * flags that rather than letting the screen imply it.
 */
router.get(
  '/vehicles',
  validate({ query: rangeSchema }),
  asyncHandler(async (req, res) => {
    const query = getValidatedQuery<z.infer<typeof rangeSchema>>(req);
    const range = defaultRange();
    sendSuccess(
      res,
      await reportsService.vehicleProfitability({
        from: query.from ?? range.from,
        to: query.to ?? range.to,
      }),
    );
  }),
);

/** GET /reports/customers - who rents the most. */
router.get(
  '/customers',
  validate({ query: rangeSchema }),
  asyncHandler(async (req, res) => {
    const query = getValidatedQuery<z.infer<typeof rangeSchema>>(req);
    const range = defaultRange();
    sendSuccess(
      res,
      await reportsService.customers({ from: query.from ?? range.from, to: query.to ?? range.to }),
    );
  }),
);

router.get(
  '/bookings',
  validate({ query: rangeSchema }),
  asyncHandler(async (req, res) => {
    const query = getValidatedQuery<z.infer<typeof rangeSchema>>(req);
    const range = defaultRange();
    sendSuccess(
      res,
      await reportsService.bookings({ from: query.from ?? range.from, to: query.to ?? range.to }),
    );
  }),
);

router.get(
  '/fleet',
  validate({ query: rangeSchema }),
  asyncHandler(async (req, res) => {
    const query = getValidatedQuery<z.infer<typeof rangeSchema>>(req);
    const range = defaultRange();
    sendSuccess(
      res,
      await reportsService.fleetUtilisation({
        from: query.from ?? range.from,
        to: query.to ?? range.to,
      }),
    );
  }),
);

/** GET /reports/outstanding - a snapshot, so no date range. */
router.get(
  '/outstanding',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, await reportsService.outstanding());
  }),
);

export const reportRoutes = router;
