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
import { bookingDriverRoutes } from './driversRoutes';
import {
  bookingIdParamSchema,
  cancelBookingSchema,
  changeStatusSchema,
  createBookingSchema,
  listBookingsQuerySchema,
  editBookingSchema,
  myBookingsQuerySchema,
  type ChangeStatusInput,
  type EditBookingInput,
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

/**
 * PATCH /bookings/:id - change the dates, the car or the locations.
 *
 * Staff only, and only before the car has gone out. The price is recalculated
 * from the pricing engine rather than taken from the request, so an edit
 * cannot produce a figure the booking flow would have refused.
 */
router.patch(
  '/:id',
  authorizeStaff,
  validate({ params: bookingIdParamSchema, body: editBookingSchema }),
  asyncHandler(async (req, res) => {
    const booking = await bookingsService.edit(
      req.params.id as string,
      req.body as EditBookingInput,
      actorFrom(req),
    );
    sendSuccess(res, { booking }, `Booking ${booking.bookingNumber} updated`);
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

/*
 * Additional drivers, mounted as a sub-router.
 *
 * Nested under the booking because that is what they belong to - a driver
 * authorised on nothing is not a record worth having - and kept in its own
 * file because permission to drive has nothing to do with the booking
 * lifecycle this file is otherwise about.
 */
router.use('/:bookingId/drivers', bookingDriverRoutes);

export const bookingRoutes = router;
