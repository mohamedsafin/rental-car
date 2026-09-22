/**
 * modules/availability/routes.ts
 * ---------------------------------------------------------------------------
 * Search and availability are PUBLIC: a visitor must be able to check dates
 * before creating an account (BRD 6 puts search before login in the journey).
 *
 * `optionalAuthenticate` is still applied so that a staff or admin caller gets
 * the conflicting booking numbers back, which is what makes the admin calendar
 * useful. Customers get a plain yes/no.
 */
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, optionalAuthenticate } from '../../middleware/authenticate';
import { authorizeStaff } from '../../middleware/authorize';
import { ApiError } from '../../utils/ApiError';
import { getValidatedQuery, validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendPaginated, sendSuccess } from '../../utils/apiResponse';
import { availabilityService } from './service';
import { searchService } from './searchService';
import { isBackOffice } from '../../modules/auth/roles';
import {
  availabilityCheckSchema,
  blockedDatesParamSchema,
  searchQuerySchema,
  type AvailabilityCheckInput,
  type SearchQuery,
} from './validation';

/**
 * The planning window. Both ends optional - the common case is "the next month
 * from today", and a calendar that demands two dates before it will draw
 * anything is a calendar people stop opening.
 */
const calendarSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

/** Midnight UTC today. The calendar's default starting point. */
function startOfToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

const router = Router();

/**
 * GET /availability/search
 *
 * The endpoint BRD 6 describes: dates and locations in, bookable cars out.
 * Only vehicles that can ACTUALLY be booked are returned - never "here are
 * some cars, one of which will fail at checkout".
 */
router.get(
  '/search',
  optionalAuthenticate,
  validate({ query: searchQuerySchema }),
  asyncHandler(async (req, res) => {
    const query = getValidatedQuery<SearchQuery>(req);

    const result = await searchService.search({
      pickupAt: query.pickupAt,
      returnAt: query.returnAt,
      pickupLocationId: query.pickupLocationId,
      dropoffLocationId: query.dropoffLocationId,
      filters: {
        page: query.page,
        limit: query.limit,
        category: query.category,
        categoryId: query.categoryId,
        transmission: query.transmission,
        fuelType: query.fuelType,
        seats: query.seats,
        minPrice: query.minPrice,
        maxPrice: query.maxPrice,
        search: query.search,
        sort: query.sort,
        includeUnpublished: false,
      },
    });

    sendPaginated(
      res,
      result.items,
      query.page,
      query.limit,
      result.total,
      `${result.total} vehicle(s) available for these dates`,
    );
  }),
);

/** GET /availability/check - one vehicle, one window. */
router.get(
  '/check',
  optionalAuthenticate,
  validate({ query: availabilityCheckSchema }),
  asyncHandler(async (req, res) => {
    const query = getValidatedQuery<AvailabilityCheckInput>(req);
    const backOffice = isBackOffice(req.user?.role);

    const result = await availabilityService.checkVehicle(
      query.vehicleId,
      { pickupAt: query.pickupAt, returnAt: query.returnAt },
      { includeConflictDetail: backOffice },
    );

    sendSuccess(res, result, result.available ? 'Vehicle is available' : 'Vehicle is not available');
  }),
);

/**
 * GET /availability/:vehicleId/blocked-dates
 *
 * Feeds a calendar that greys out unavailable days - far better than letting
 * someone pick dates and only then telling them no.
 */
router.get(
  '/:vehicleId/blocked-dates',
  validate({ params: blockedDatesParamSchema }),
  asyncHandler(async (req, res) => {
    const blockedDates = await searchService.getBlockedDates(req.params.vehicleId as string);
    sendSuccess(res, { blockedDates }, 'Blocked dates retrieved');
  }),
);

/**
 * GET /availability/calendar - the whole fleet's commitments in one view.
 *
 * Staff only: it names customers and shows the workshop schedule, neither of
 * which belongs on the public site. Capped at 92 days because a calendar wider
 * than a quarter is a report, not a planning tool, and rendering one is slow
 * enough that somebody would ask for a year.
 */
router.get(
  '/calendar',
  authenticate,
  authorizeStaff,
  validate({ query: calendarSchema }),
  asyncHandler(async (req, res) => {
    const query = getValidatedQuery<z.infer<typeof calendarSchema>>(req);

    const from = query.from ?? startOfToday();
    const to = query.to ?? new Date(from.getTime() + 30 * 24 * 60 * 60 * 1000);

    if (to.getTime() - from.getTime() > 92 * 24 * 60 * 60 * 1000) {
      throw ApiError.badRequest('Ask for at most 92 days at a time.');
    }

    sendSuccess(res, await availabilityService.calendar({ from, to }));
  }),
);

export const availabilityRoutes = router;
