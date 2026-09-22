/**
 * modules/bookings/driversRoutes.ts
 * ---------------------------------------------------------------------------
 * Additional drivers on a booking.
 *
 * ===========================================================================
 * WHY THIS IS PER BOOKING AND NOT PER CUSTOMER
 * ===========================================================================
 * Permission to drive is granted for ONE rental, not for ever. A colleague
 * listed on last March's hire has no business being on the car this March, and
 * a per-customer list would quietly carry them forward.
 *
 * It matters because an unlisted driver is an UNINSURED driver: if the person
 * at the wheel is not named on the agreement, the insurer's first question
 * after an accident is who was driving, and the answer decides whether anyone
 * pays. So the counter needs somewhere to put them, and the agreement prints
 * them.
 *
 * Staff-only. A customer adding drivers to their own booking without anyone
 * checking a licence would defeat the point of recording them.
 */
import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate';
import { authorizeStaff } from '../../middleware/authorize';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendCreated, sendSuccess } from '../../utils/apiResponse';
import { ApiError } from '../../utils/ApiError';
import { prisma } from '../../config/prisma';
import { auditService, requestContext } from '../audit/service';

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD');

const bookingParam = z.object({ bookingId: z.string().uuid('Invalid booking id') });
const driverParam = bookingParam.extend({ driverId: z.string().uuid('Invalid driver id') });

const createSchema = z.object({
  fullName: z.string().min(2, 'Enter the driver’s full name').max(120).trim(),
  // Required. A driver with no licence number on file is exactly the record
  // this table exists to prevent.
  licenceNumber: z.string().min(1, 'Enter their licence number').max(60).trim(),
  licenceIssuingCountry: z.string().length(2, 'Use a 2-letter code, e.g. AE').toUpperCase().optional(),
  licenceExpiry: dateOnly.optional(),
  dateOfBirth: dateOnly.optional(),
  phone: z.string().regex(/^\+?[1-9]\d{7,14}$/, 'Enter a valid phone number').optional(),
});

const router = Router({ mergeParams: true });

router.use(authenticate, authorizeStaff);

router.get(
  '/',
  validate({ params: bookingParam }),
  asyncHandler(async (req, res) => {
    const drivers = await prisma.additionalDriver.findMany({
      where: { bookingId: req.params.bookingId as string },
      orderBy: { createdAt: 'asc' },
    });
    sendSuccess(res, { drivers: drivers.map(toPublicDriver) });
  }),
);

router.post(
  '/',
  validate({ params: bookingParam, body: createSchema }),
  asyncHandler(async (req, res) => {
    const bookingId = req.params.bookingId as string;
    const input = req.body as z.infer<typeof createSchema>;

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { bookingNumber: true, status: true, returnAt: true },
    });
    if (!booking) throw ApiError.notFound('That booking does not exist');

    if (booking.status === 'CANCELLED' || booking.status === 'COMPLETED') {
      throw ApiError.conflict(
        `Booking ${booking.bookingNumber} is ${booking.status.toLowerCase()}. Adding a driver to it would authorise nobody to drive anything.`,
      );
    }

    /*
     * A licence that expires mid-rental is refused, for the same reason the
     * main hirer's is: the insurer tests the licence on the day of the
     * accident, not on the day it was typed in.
     */
    if (input.licenceExpiry && new Date(input.licenceExpiry) < booking.returnAt) {
      throw ApiError.badRequest(
        `That licence expires on ${input.licenceExpiry}, before this rental ends. They cannot be added as a driver.`,
      );
    }

    const driver = await prisma.additionalDriver.create({
      data: {
        bookingId,
        fullName: input.fullName,
        licenceNumber: input.licenceNumber,
        licenceIssuingCountry: input.licenceIssuingCountry ?? null,
        licenceExpiry: input.licenceExpiry ? new Date(input.licenceExpiry) : null,
        dateOfBirth: input.dateOfBirth ? new Date(input.dateOfBirth) : null,
        phone: input.phone ?? null,
      },
    });

    await auditService.record({
      action: 'booking.driver.added',
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      actorRole: req.user!.role,
      entityType: 'AdditionalDriver',
      entityId: driver.id,
      metadata: { bookingNumber: booking.bookingNumber, fullName: input.fullName },
      ...requestContext(req),
    });

    sendCreated(res, { driver: toPublicDriver(driver) }, `${input.fullName} added as a driver`);
  }),
);

/**
 * Remove a driver.
 *
 * A hard delete, unlike almost everything else here. An additional driver is a
 * permission, not a transaction: withdrawing it should leave no trace that
 * they are still allowed to drive, and the audit log keeps the history.
 */
router.delete(
  '/:driverId',
  validate({ params: driverParam }),
  asyncHandler(async (req, res) => {
    const driver = await prisma.additionalDriver.findUnique({
      where: { id: req.params.driverId as string },
    });
    if (!driver || driver.bookingId !== req.params.bookingId) {
      throw ApiError.notFound('That driver is not on this booking');
    }

    await prisma.additionalDriver.delete({ where: { id: driver.id } });

    await auditService.record({
      action: 'booking.driver.removed',
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      actorRole: req.user!.role,
      entityType: 'AdditionalDriver',
      entityId: driver.id,
      metadata: { fullName: driver.fullName },
      ...requestContext(req),
    });

    sendSuccess(res, { removed: true }, `${driver.fullName} removed`);
  }),
);

function toPublicDriver(driver: {
  id: string;
  bookingId: string;
  fullName: string;
  licenceNumber: string;
  licenceIssuingCountry: string | null;
  licenceExpiry: Date | null;
  dateOfBirth: Date | null;
  phone: string | null;
  createdAt: Date;
}) {
  return {
    id: driver.id,
    bookingId: driver.bookingId,
    fullName: driver.fullName,
    licenceNumber: driver.licenceNumber,
    licenceIssuingCountry: driver.licenceIssuingCountry,
    licenceExpiry: driver.licenceExpiry?.toISOString().slice(0, 10) ?? null,
    dateOfBirth: driver.dateOfBirth?.toISOString().slice(0, 10) ?? null,
    phone: driver.phone,
    createdAt: driver.createdAt.toISOString(),
  };
}

export const bookingDriverRoutes = router;
