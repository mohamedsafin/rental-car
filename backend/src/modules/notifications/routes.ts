/**
 * modules/notifications/routes.ts
 * ---------------------------------------------------------------------------
 * The outbound message log and its templates (BRD 42-44).
 *
 * Back-office only. There is no endpoint to send an arbitrary message: every
 * notification is triggered by something that happened in the system, and an
 * open "send this text to this address" endpoint would be a spam relay wearing
 * our domain.
 */
import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate';
import { authorizeAdmin, authorizeStaff } from '../../middleware/authorize';
import { getValidatedQuery, validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendPaginated, sendSuccess } from '../../utils/apiResponse';
import { notificationsService } from './service';

const idParam = z.object({ id: z.string().uuid('Invalid id') });

const listSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.enum(['PENDING', 'SENT', 'FAILED', 'SKIPPED']).optional(),
  channel: z.enum(['EMAIL', 'SMS', 'WHATSAPP', 'IN_APP']).optional(),
  relatedId: z.string().uuid().optional(),
});

const templateSchema = z.object({
  subject: z.string().max(200).trim().optional(),
  body: z.string().min(1, 'A template needs a body').max(5000).optional(),
  isActive: z.boolean().optional(),
});

const router = Router();

router.use(authenticate, authorizeStaff);

router.get(
  '/',
  validate({ query: listSchema }),
  asyncHandler(async (req, res) => {
    const query = getValidatedQuery<z.infer<typeof listSchema>>(req);
    const { items, total } = await notificationsService.list(query);
    sendPaginated(res, items, query.page, query.limit, total);
  }),
);

/**
 * POST /notifications/:id/retry
 *
 * Re-sends the stored body verbatim, not a freshly composed one. Recomposing
 * would send different text from the one the log says failed.
 */
router.post(
  '/:id/retry',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const result = await notificationsService.retry(req.params.id as string);
    sendSuccess(res, { id: result.id, status: result.status, attempts: result.attempts });
  }),
);

router.get(
  '/templates',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, await notificationsService.listTemplates());
  }),
);

/** PATCH /notifications/templates/:id - the wording is the client's. */
router.patch(
  '/templates/:id',
  authorizeAdmin,
  validate({ params: idParam, body: templateSchema }),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof templateSchema>;
    sendSuccess(res, await notificationsService.updateTemplate(req.params.id as string, input));
  }),
);

export const notificationRoutes = router;
