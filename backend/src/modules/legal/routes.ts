/**
 * modules/legal/routes.ts
 * ---------------------------------------------------------------------------
 * Terms, privacy and policy documents (BRD 45-47).
 *
 * The GET routes are PUBLIC and unauthenticated, deliberately: terms a
 * customer has to sign in to read are terms they cannot read before deciding
 * whether to sign up.
 *
 * Everything that writes is admin-only, and a published version can never be
 * edited - only superseded by a new one.
 */
import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate';
import { authorizeAdmin } from '../../middleware/authorize';
import { getValidatedQuery, validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendCreated, sendSuccess } from '../../utils/apiResponse';
import { requestContext } from '../audit/service';
import { legalService, type LegalActor } from './service';

const DOCUMENT_TYPES = [
  'TERMS_AND_CONDITIONS',
  'PRIVACY_POLICY',
  'RENTAL_AGREEMENT',
  'CANCELLATION_POLICY',
  'REFUND_POLICY',
] as const;

const idParam = z.object({ id: z.string().uuid('Invalid document id') });
const typeParam = z.object({ type: z.enum(DOCUMENT_TYPES) });

const createSchema = z.object({
  type: z.enum(DOCUMENT_TYPES),
  title: z.string().min(3, 'Give the document a title').max(200).trim(),
  content: z.string().min(1, 'The document needs content').max(200_000),
  effectiveFrom: z.coerce.date().optional(),
});

const updateSchema = z.object({
  title: z.string().min(3).max(200).trim().optional(),
  content: z.string().min(1).max(200_000).optional(),
  effectiveFrom: z.coerce.date().optional(),
});

const listSchema = z.object({ type: z.enum(DOCUMENT_TYPES).optional() });

function actorFrom(req: Parameters<typeof requestContext>[0]): LegalActor {
  return {
    id: req.user!.id,
    email: req.user!.email,
    role: req.user!.role,
    ...requestContext(req),
  };
}

const router = Router();

// --- Public ---------------------------------------------------------------

/** GET /legal - the live version of every document. */
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, await legalService.published());
  }),
);

/**
 * GET /legal/versions - every version, including drafts. Admin only.
 *
 * Registered BEFORE /:type, or "versions" would be parsed as a document type
 * and rejected by the enum.
 */
router.get(
  '/versions',
  authenticate,
  authorizeAdmin,
  validate({ query: listSchema }),
  asyncHandler(async (req, res) => {
    const query = getValidatedQuery<z.infer<typeof listSchema>>(req);
    sendSuccess(res, await legalService.listAll(query.type));
  }),
);

router.get(
  '/:type',
  validate({ params: typeParam }),
  asyncHandler(async (req, res) => {
    const { type } = req.params as z.infer<typeof typeParam>;
    sendSuccess(res, await legalService.getPublished(type));
  }),
);

// --- Admin ----------------------------------------------------------------

router.post(
  '/',
  authenticate,
  authorizeAdmin,
  validate({ body: createSchema }),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof createSchema>;
    sendCreated(res, await legalService.createVersion(input, actorFrom(req)));
  }),
);

/** PATCH /legal/:id - drafts only. A published version is immutable. */
router.patch(
  '/:id/draft',
  authenticate,
  authorizeAdmin,
  validate({ params: idParam, body: updateSchema }),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof updateSchema>;
    sendSuccess(res, await legalService.updateDraft(req.params.id as string, input, actorFrom(req)));
  }),
);

router.post(
  '/:id/publish',
  authenticate,
  authorizeAdmin,
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    sendSuccess(res, await legalService.publish(req.params.id as string, actorFrom(req)));
  }),
);

export const legalRoutes = router;
