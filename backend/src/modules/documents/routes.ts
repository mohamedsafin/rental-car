/**
 * modules/documents/routes.ts
 * ---------------------------------------------------------------------------
 * Upload, review and - critically - SERVE identity documents.
 *
 * The file route is the whole point of this module. BRD 12 says private
 * documents must not be reachable by public URL, so:
 *
 *   - the files live under the storage root's `private/` folder, which
 *     express.static never mounts;
 *   - there is no URL stored anywhere, only an opaque key the server keeps;
 *   - GET /documents/:id/file authenticates the caller, checks ownership, logs
 *     the access, and only then streams the bytes.
 *
 * Guessing a URL cannot work, because there is no URL to guess.
 */
import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { authorizeStaff } from '../../middleware/authorize';
import { validate } from '../../middleware/validate';
import { uploadCustomerDocument } from '../../middleware/upload';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendCreated, sendSuccess } from '../../utils/apiResponse';
import { ApiError } from '../../utils/ApiError';
import { requestContext } from '../audit/service';
import { customersService } from '../customers/service';
import {
  documentIdParamSchema,
  reviewDocumentSchema,
  uploadDocumentSchema,
  type ReviewDocumentInput,
  type UploadDocumentInput,
} from '../customers/validation';
import { documentService, type DocumentActor } from './service';

function actorFrom(req: Parameters<typeof requestContext>[0]): DocumentActor {
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
 * POST /documents
 *
 * The customer uploads one of THEIR OWN documents. The owner comes from the
 * token, so there is no customerId in the body to tamper with.
 *
 * Middleware order matters: authenticate runs before multer, so an anonymous
 * request is rejected without first buffering a 10MB file into memory.
 */
router.post(
  '/',
  uploadCustomerDocument,
  validate({ body: uploadDocumentSchema }),
  asyncHandler(async (req, res) => {
    const file = req.file;
    if (!file) throw ApiError.badRequest('Attach a document file');

    const input = req.body as UploadDocumentInput;
    const customer = await customersService.getOrCreateForUser(req.user!.id);

    const document = await documentService.upload(
      customer.id,
      file,
      {
        type: input.type,
        documentNumber: input.documentNumber,
        issuingCountry: input.issuingCountry,
        issueDate: input.issueDate ? new Date(input.issueDate) : undefined,
        expiryDate: input.expiryDate ? new Date(input.expiryDate) : undefined,
      },
      actorFrom(req),
    );

    const verification = await customersService.getVerificationSummary(customer.id);
    sendCreated(res, { document, verification }, 'Document uploaded and awaiting review');
  }),
);

/**
 * GET /documents/:id/file
 *
 * The ONLY way to read a stored document. Owner or back-office only; every
 * access is written to the audit log.
 */
router.get(
  '/:id/file',
  validate({ params: documentIdParamSchema }),
  asyncHandler(async (req, res) => {
    const { stream, mimeType, fileName } = await documentService.getFileForActor(
      req.params.id as string,
      actorFrom(req),
    );

    res.setHeader('Content-Type', mimeType);
    // `inline` lets staff preview in the browser rather than downloading.
    // The filename is quoted because a document name can contain spaces.
    res.setHeader('Content-Disposition', `inline; filename="${fileName.replace(/"/g, '')}"`);
    // Identity documents must never be cached by a proxy or a shared browser.
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    stream.pipe(res);
  }),
);

/** PATCH /documents/:id/review - approve or reject (BRD 13). Staff and admin. */
router.patch(
  '/:id/review',
  authorizeStaff,
  validate({ params: documentIdParamSchema, body: reviewDocumentSchema }),
  asyncHandler(async (req, res) => {
    const input = req.body as ReviewDocumentInput;

    const document = await documentService.review(
      req.params.id as string,
      { status: input.status, rejectionReason: input.rejectionReason },
      actorFrom(req),
    );

    sendSuccess(res, { document }, `Document ${input.status.toLowerCase()}`);
  }),
);

/**
 * POST /documents/expire-overdue
 *
 * Sweeps APPROVED documents past their expiry into EXPIRED. Phase 10 runs this
 * on a schedule; exposing it now means the rule lives in one place rather than
 * being re-derived on every screen.
 */
router.post(
  '/expire-overdue',
  authorizeStaff,
  asyncHandler(async (_req, res) => {
    const count = await documentService.expireOverdueDocuments();
    sendSuccess(res, { expired: count }, `${count} document(s) marked expired`);
  }),
);

export const documentRoutes = router;
