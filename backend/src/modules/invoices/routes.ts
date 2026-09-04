/**
 * modules/invoices/routes.ts
 * ---------------------------------------------------------------------------
 * Invoices and credit notes (BRD 28).
 *
 * The PDF route is the reason this module exists from a customer's point of
 * view. Note there is no PUT and no DELETE anywhere below: an issued invoice
 * cannot be edited or removed through the API, because it cannot be edited or
 * removed at all. `POST /:id/credit-note` is the only correction mechanism.
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
import { invoicesService, type InvoiceActor } from './service';
import { renderInvoicePdf } from './pdf';

const idParam = z.object({ id: z.string().uuid('Invalid invoice id') });

const listSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  bookingId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  type: z.enum(['INVOICE', 'CREDIT_NOTE']).optional(),
});

const issueSchema = z.object({ bookingId: z.string().uuid('Choose a booking') });
const creditSchema = z.object({
  reason: z.string().min(3, 'Give a reason for the credit note').max(500).trim(),
});

function actorFrom(req: Parameters<typeof requestContext>[0]): InvoiceActor {
  return {
    id: req.user!.id,
    email: req.user!.email,
    role: req.user!.role,
    ...requestContext(req),
  };
}

const router = Router();

router.use(authenticate);

/**
 * GET /invoices
 *
 * A customer sees their own; back-office sees everything. The customerId
 * filter is IGNORED for customers - it is forced to their own id, so it cannot
 * be used to read somebody else's invoices.
 */
router.get(
  '/',
  validate({ query: listSchema }),
  asyncHandler(async (req, res) => {
    const query = getValidatedQuery<z.infer<typeof listSchema>>(req);
    const isBackOffice = req.user!.role === 'ADMIN' || req.user!.role === 'STAFF';

    const { items, total } = await invoicesService.list({
      ...query,
      customerId: isBackOffice ? query.customerId : req.user!.id,
    });

    sendPaginated(res, items, query.page, query.limit, total);
  }),
);

router.get(
  '/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    sendSuccess(res, await invoicesService.getForActor(req.params.id as string, actorFrom(req)));
  }),
);

/**
 * GET /invoices/:id/pdf
 *
 * Rendered on demand from the stored snapshot, so the same invoice downloaded
 * next year is byte-for-byte the same document.
 */
router.get(
  '/:id/pdf',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    // Ownership check first, and it 404s rather than 403s for a non-owner -
    // confirming INV-2026-000042 exists is itself a leak.
    const summary = await invoicesService.getForActor(req.params.id as string, actorFrom(req));

    const invoice = await prisma.invoice.findUnique({
      where: { id: summary.id },
      include: { lineItems: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!invoice) throw ApiError.notFound('Invoice not found');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${invoice.invoiceNumber}.pdf"`,
    );
    // A tax document must not sit in a shared proxy cache.
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');

    renderInvoicePdf(invoice).pipe(res);
  }),
);

/** POST /invoices - issue the invoice for a booking. */
router.post(
  '/',
  authorizeStaff,
  validate({ body: issueSchema }),
  asyncHandler(async (req, res) => {
    const { bookingId } = req.body as z.infer<typeof issueSchema>;
    sendCreated(res, await invoicesService.issueForBooking(bookingId, actorFrom(req)));
  }),
);

/**
 * POST /invoices/:id/credit-note
 *
 * ADMIN only. Reversing a tax document is not a routine correction, and the
 * reason is mandatory because the credit note has to explain itself.
 */
router.post(
  '/:id/credit-note',
  authorizeAdmin,
  validate({ params: idParam, body: creditSchema }),
  asyncHandler(async (req, res) => {
    const { reason } = req.body as z.infer<typeof creditSchema>;
    sendCreated(res, await invoicesService.creditNote(req.params.id as string, reason, actorFrom(req)));
  }),
);

export const invoiceRoutes = router;
