/**
 * modules/payments/routes.ts
 * ---------------------------------------------------------------------------
 * Note what is NOT here: any endpoint a browser can call to say "the payment
 * worked". The webhook is the only path to SUCCESS, and it is authenticated by
 * an HMAC signature rather than by a session.
 */
import { Router, raw } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate';
import { authorizeAdmin } from '../../middleware/authorize';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendCreated, sendSuccess } from '../../utils/apiResponse';
import { ApiError } from '../../utils/ApiError';
import { prisma } from '../../config/prisma';
import { requestContext } from '../audit/service';
import { paymentProvider } from '../../services/payment';
import { paymentsService, type PaymentActor } from './service';

const bookingIdParam = z.object({ id: z.string().uuid('Invalid booking id') });
const paymentIdParam = z.object({ id: z.string().uuid('Invalid payment id') });

const initiateSchema = z.object({
  bookingId: z.string().uuid('Invalid booking id'),
  type: z.enum(['RENTAL', 'SECURITY_DEPOSIT']).default('RENTAL'),
  // There is deliberately NO amount field. The figure comes from the booking.
});

const refundSchema = z.object({
  amount: z
    .string()
    .regex(/^\d{1,8}(\.\d{1,2})?$/, 'Enter an amount like 250 or 249.50')
    .optional(),
  reason: z.string().max(500).trim().optional(),
});

function actorFrom(req: Parameters<typeof requestContext>[0]): PaymentActor {
  return {
    id: req.user!.id,
    email: req.user!.email,
    role: req.user!.role,
    ...requestContext(req),
  };
}

const router = Router();

/**
 * POST /payments/webhook
 *
 * PUBLIC by design: the provider has no session with us. It is authenticated
 * by an HMAC signature over the raw body, which only someone holding the
 * shared secret can produce.
 *
 * `raw()` is essential. The signature covers the exact bytes sent; letting
 * express.json() parse and re-serialise the body would change whitespace and
 * key order, and every signature would fail.
 */
router.post(
  '/webhook',
  raw({ type: '*/*', limit: '1mb' }),
  asyncHandler(async (req, res) => {
    const signature =
      req.header('x-webhook-signature') ??
      req.header('stripe-signature') ??
      req.header('x-signature');

    // Throws 401 on a bad or missing signature, before anything is trusted.
    const event = paymentProvider.verifyWebhook(req.body as Buffer, signature);

    const result = await paymentsService.handleWebhook(event);

    // Always 200 once the signature checks out, even when we decline to act.
    // A non-2xx makes the provider retry, and retrying cannot fix an unknown
    // reference or a mismatched amount - it would just repeat forever.
    sendSuccess(res, result, result.handled ? 'Webhook processed' : 'Webhook acknowledged');
  }),
);

// Everything below needs a signed-in user.
router.use(authenticate);

/** POST /payments/initiate - returns a checkout URL. Changes no status. */
router.post(
  '/initiate',
  validate({ body: initiateSchema }),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof initiateSchema>;
    const result = await paymentsService.initiate(input.bookingId, input.type, actorFrom(req));
    sendCreated(res, result, 'Payment session created');
  }),
);

/** GET /payments/booking/:id - payment history for one booking (BRD 22). */
router.get(
  '/booking/:id',
  validate({ params: bookingIdParam }),
  asyncHandler(async (req, res) => {
    const bookingId = req.params.id as string;

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { customerId: true },
    });

    const isBackOffice = req.user!.role === 'ADMIN' || req.user!.role === 'STAFF';
    if (!booking || (!isBackOffice && booking.customerId !== req.user!.id)) {
      throw ApiError.notFound('Booking not found');
    }

    const payments = await paymentsService.listForBooking(bookingId);

    sendSuccess(
      res,
      {
        payments: payments.map((payment) => ({
          id: payment.id,
          type: payment.type,
          status: payment.status,
          amount: payment.amount.toFixed(2),
          currency: payment.currency,
          provider: payment.provider,
          reference: payment.providerReference,
          failureReason: payment.failureReason,
          paidAt: payment.paidAt?.toISOString() ?? null,
          createdAt: payment.createdAt.toISOString(),
          refunds: payment.refunds.map((refund) => ({
            id: refund.id,
            amount: refund.amount.toFixed(2),
            status: refund.status,
            reason: refund.reason,
            completedAt: refund.completedAt?.toISOString() ?? null,
          })),
        })),
      },
      'Payments retrieved',
    );
  }),
);

/** POST /payments/:id/refund - admin only (BRD 32). */
router.post(
  '/:id/refund',
  authorizeAdmin,
  validate({ params: paymentIdParam, body: refundSchema }),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof refundSchema>;
    const refund = await paymentsService.refund(req.params.id as string, input, actorFrom(req));

    sendCreated(
      res,
      {
        refund: {
          id: refund.id,
          amount: refund.amount.toFixed(2),
          status: refund.status,
          reason: refund.reason,
        },
      },
      'Refund requested',
    );
  }),
);

export const paymentRoutes = router;
