/**
 * modules/bookings/routes.ts
 * ---------------------------------------------------------------------------
 * Same split as the customers module: `/me` addresses the caller's own
 * bookings via their token; `/` is staff territory.
 *
 * GET-by-id and cancel are shared by both audiences - the service checks
 * ownership there and returns 404 (not 403) to a stranger, so a booking id
 * cannot be probed for existence.
 */
import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { authorizeStaff } from '../../middleware/authorize';
import { getValidatedQuery, validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendCreated, sendPaginated, sendSuccess } from '../../utils/apiResponse';
import { requestContext } from '../audit/service';
import { bookingsService, type BookingActor } from './service';
import {
  bookingIdParamSchema,
  cancelBookingSchema,
  changeStatusSchema,
  createBookingSchema,
  listBookingsQuerySchema,
  myBookingsQuerySchema,
  type ChangeStatusInput,
  type ListBookingsQuery,
  type MyBookingsQuery,
} from './validation';

function actorFrom(req: Parameters<typeof requestContext>[0]): BookingActor {
  return {
    id: req.user!.id,
    email: req.user!.email,
    role: req.user!.role,
    ...requestContext(req),
  };
}

const router = Router();

router.use(authenticate);

// --- Customer --------------------------------------------------------------

/** POST /bookings - create. The price is computed here, never accepted. */
router.post(
  '/',
  validate({ body: createBookingSchema }),
  asyncHandler(async (req, res) => {
    const booking = await bookingsService.create(req.body, actorFrom(req));
    sendCreated(res, { booking }, `Booking ${booking.bookingNumber} created`);
  }),
);

/** GET /bookings/me - the caller's own bookings (BRD 22). */
router.get(
  '/me',
  validate({ query: myBookingsQuerySchema }),
  asyncHandler(async (req, res) => {
    const query = getValidatedQuery<MyBookingsQuery>(req);
    const { items, total } = await bookingsService.listForCustomer(req.user!.id, query);
    sendPaginated(res, items, query.page, query.limit, total, 'Bookings retrieved');
  }),
);

// --- Staff -----------------------------------------------------------------

router.get(
  '/',
  authorizeStaff,
  validate({ query: listBookingsQuerySchema }),
  asyncHandler(async (req, res) => {
    const query = getValidatedQuery<ListBookingsQuery>(req);
    const { items, total } = await bookingsService.list(query);
    sendPaginated(res, items, query.page, query.limit, total, 'Bookings retrieved');
  }),
);

router.post(
  '/release-expired-holds',
  authorizeStaff,
  asyncHandler(async (_req, res) => {
    const released = await bookingsService.releaseExpiredHolds();
    sendSuccess(res, { released }, `${released} expired hold(s) released`);
  }),
);

// --- Either audience (ownership checked inside the service) ----------------

router.get(
  '/:id',
  validate({ params: bookingIdParamSchema }),
  asyncHandler(async (req, res) => {
    const booking = await bookingsService.getById(req.params.id as string, actorFrom(req));
    sendSuccess(res, { booking }, 'Booking retrieved');
  }),
);

router.post(
  '/:id/cancel',
  validate({ params: bookingIdParamSchema, body: cancelBookingSchema }),
  asyncHandler(async (req, res) => {
    const booking = await bookingsService.cancel(
      req.params.id as string,
      (req.body as { reason?: string }).reason,
      actorFrom(req),
    );
    sendSuccess(res, { booking }, 'Booking cancelled');
  }),
);

/** PATCH /bookings/:id/status - staff move a booking through its lifecycle. */
router.patch(
  '/:id/status',
  authorizeStaff,
  validate({ params: bookingIdParamSchema, body: changeStatusSchema }),
  asyncHandler(async (req, res) => {
    const input = req.body as ChangeStatusInput;
    const booking = await bookingsService.changeStatus(
      req.params.id as string,
      input.status,
      actorFrom(req),
      input.reason,
    );
    sendSuccess(res, { booking }, `Booking is now ${booking.statusLabel.toLowerCase()}`);
  }),
);

export const bookingRoutes = router;
