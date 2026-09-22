/**
 * modules/agreements/routes.ts
 * ---------------------------------------------------------------------------
 * The rental agreement.
 *
 * There is no PUT and no DELETE below, for the same reason there is none on
 * invoices: an issued agreement cannot be edited or removed, because a signed
 * document that changes afterwards is worthless. `POST /:id/void` is the only
 * way to retire one, and it leaves the row behind.
 *
 * The customer-facing half is deliberately small: read your own agreement,
 * download it, sign it. Everything else is back-office.
 */
import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate';
import { authorizeAdmin, authorizeStaff } from '../../middleware/authorize';
import { getValidatedQuery, validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendCreated, sendPaginated, sendSuccess } from '../../utils/apiResponse';
import { ApiError } from '../../utils/ApiError';
import { prisma } from '../../config/prisma';
import { requestContext } from '../audit/service';
import { agreementsService, type AgreementActor } from './service';
import { renderAgreementPdf } from './pdf';

const idParam = z.object({ id: z.string().uuid('Invalid agreement id') });
const bookingParam = z.object({ bookingId: z.string().uuid('Invalid booking id') });

const listSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.enum(['DRAFT', 'ISSUED', 'SIGNED', 'VOID']).optional(),
  bookingId: z.string().uuid().optional(),
});

const issueSchema = z.object({ bookingId: z.string().uuid('Choose a booking') });

const signSchema = z.object({
  /*
   * The typed name IS the signature. Required, and required to be a real name
   * rather than a tick: "I agree" in a name box is not a signature, and a box
   * that accepts it produces a document that proves nothing.
   */
  signedName: z
    .string()
    .trim()
    .min(3, 'Type your full name as it appears on your licence')
    .max(120),
});

const voidSchema = z.object({
  reason: z.string().trim().min(3, 'Say why this agreement is being voided').max(500),
});

function actorFrom(req: Parameters<typeof requestContext>[0]): AgreementActor {
  return {
    id: req.user!.id,
    email: req.user!.email,
    role: req.user!.role,
    ...requestContext(req),
  };
}

const router = Router();

router.use(authenticate);

/** GET /agreements - back-office list. */
router.get(
  '/',
  authorizeStaff,
  validate({ query: listSchema }),
  asyncHandler(async (req, res) => {
    const query = getValidatedQuery<z.infer<typeof listSchema>>(req);
    const { items, total } = await agreementsService.list(query);
    sendPaginated(res, items, query.page, query.limit, total);
  }),
);

/**
 * GET /agreements/booking/:bookingId
 *
 * Returns null rather than 404 when none has been drawn up: "this booking has
 * no agreement yet" is a normal state the admin screen has to render, not an
 * error it has to handle.
 */
router.get(
  '/booking/:bookingId',
  validate({ params: bookingParam }),
  asyncHandler(async (req, res) => {
    sendSuccess(
      res,
      await agreementsService.forBooking(req.params.bookingId as string, actorFrom(req)),
    );
  }),
);

router.get(
  '/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    sendSuccess(res, await agreementsService.getForActor(req.params.id as string, actorFrom(req)));
  }),
);

/**
 * GET /agreements/:id/pdf
 *
 * Rendered on demand from the stored snapshot, so the same agreement
 * downloaded next year is the same document.
 */
router.get(
  '/:id/pdf',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    // Ownership check first, and it 404s for a non-owner - confirming that
    // AGR-2026-000042 exists is itself a leak.
    const summary = await agreementsService.getForActor(req.params.id as string, actorFrom(req));

    const agreement = await prisma.rentalAgreement.findUnique({ where: { id: summary.id } });
    if (!agreement) throw ApiError.notFound('Agreement not found');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${agreement.agreementNumber}.pdf"`);
    // A contract carrying licence and ID numbers must not sit in a shared cache.
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');

    renderAgreementPdf(agreement).pipe(res);
  }),
);

/** POST /agreements - draw up the agreement for a booking. */
router.post(
  '/',
  authorizeStaff,
  validate({ body: issueSchema }),
  asyncHandler(async (req, res) => {
    const { bookingId } = req.body as z.infer<typeof issueSchema>;
    sendCreated(res, await agreementsService.issueForBooking(bookingId, actorFrom(req)));
  }),
);

/**
 * POST /agreements/:id/sign
 *
 * The hirer signs. Open to the customer themselves and to staff capturing it
 * at the counter - which is recorded as such, so "signed by the customer" and
 * "typed in by a clerk while the customer watched" stay distinguishable.
 */
router.post(
  '/:id/sign',
  validate({ params: idParam, body: signSchema }),
  asyncHandler(async (req, res) => {
    const { signedName } = req.body as z.infer<typeof signSchema>;
    sendSuccess(
      res,
      await agreementsService.signByCustomer(req.params.id as string, { signedName }, actorFrom(req)),
    );
  }),
);

/** POST /agreements/:id/countersign - the company signs. */
router.post(
  '/:id/countersign',
  authorizeStaff,
  validate({ params: idParam, body: signSchema }),
  asyncHandler(async (req, res) => {
    const { signedName } = req.body as z.infer<typeof signSchema>;
    sendSuccess(
      res,
      await agreementsService.signByStaff(req.params.id as string, signedName, actorFrom(req)),
    );
  }),
);

/**
 * POST /agreements/:id/void
 *
 * ADMIN only, with a reason. Retiring a signed contract is not routine, and
 * the void has to explain itself.
 */
router.post(
  '/:id/void',
  authorizeAdmin,
  validate({ params: idParam, body: voidSchema }),
  asyncHandler(async (req, res) => {
    const { reason } = req.body as z.infer<typeof voidSchema>;
    sendSuccess(
      res,
      await agreementsService.voidAgreement(req.params.id as string, reason, actorFrom(req)),
    );
  }),
);

export const agreementRoutes = router;
