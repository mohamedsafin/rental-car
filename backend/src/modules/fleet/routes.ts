/**
 * modules/fleet/routes.ts
 * ---------------------------------------------------------------------------
 * Fleet operations: traffic fines, Salik tolls, maintenance, insurance,
 * vehicle documents and the expiry dashboard (BRD 38-41).
 *
 * One router because these are one job - keeping cars legal, serviced and
 * earning - and splitting them into five modules would scatter that job across
 * five files that always change together.
 *
 * Everything here is back-office. A customer sees a fine only when it reaches
 * their booking as an additional charge, with the authority's amount and our
 * handling fee described separately.
 */
import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate';
import { authorizeStaff, authorizeAdmin } from '../../middleware/authorize';
import { getValidatedQuery, validate } from '../../middleware/validate';
import { uploadVehicleDocument } from '../../middleware/upload';
import { asyncHandler } from '../../utils/asyncHandler';
import { contentDisposition } from '../../utils/contentDisposition';
import { sendCreated, sendPaginated, sendSuccess } from '../../utils/apiResponse';
import { ApiError } from '../../utils/ApiError';
import { requestContext } from '../audit/service';
import type { FleetActor } from '../damages/service';
import { finesService } from './finesService';
import { statementImport } from './statementImport';
import { settlementCheck } from './settlementCheck';
import { maintenanceService } from './maintenanceService';
import { insuranceService } from './insuranceService';

const money = z.string().regex(/^\d{1,8}(\.\d{1,2})?$/, 'Enter an amount like 250 or 249.50');
const idParam = z.object({ id: z.string().uuid('Invalid id') });
const vehicleIdParam = z.object({ vehicleId: z.string().uuid('Invalid vehicle id') });

const recoveryStatus = z.enum(['RECORDED', 'ASSIGNED', 'RECOVERED', 'WAIVED', 'DISPUTED']);

const chargeListSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: recoveryStatus.optional(),
  vehicleId: z.string().uuid().optional(),
});

const fineSchema = z.object({
  vehicleId: z.string().uuid('Select a vehicle'),
  // Unique in the database. Entering the same fine twice is how a customer
  // gets billed twice for one violation, so the constraint catches it.
  fineNumber: z.string().min(1, 'Enter the fine number').max(60).trim(),
  /*
   * Traffic or parking, because they are not one thing.
   *
   * A traffic fine comes from the police, is disputed through them, and can
   * carry black points against whoever was driving. A parking fine comes from
   * the municipality or a mall operator, is disputed with them, and never
   * does. Recording both as "fine" meant staff could not tell a customer who
   * to argue with, or which ones needed a driver nominating.
   */
  fineType: z.enum(['TRAFFIC', 'PARKING', 'OTHER']).default('TRAFFIC'),
  violationAt: z.coerce.date(),
  violation: z.string().max(200).trim().optional(),
  location: z.string().max(200).trim().optional(),
  amount: money,
  serviceFee: money.optional(),
  notes: z.string().max(1000).trim().optional(),
});

const tollSchema = z.object({
  vehicleId: z.string().uuid('Select a vehicle'),
  crossedAt: z.coerce.date(),
  gate: z.string().max(120).trim().optional(),
  reference: z.string().max(120).trim().optional(),
  amount: money,
  serviceFee: money.optional(),
});

const chargeUpdateSchema = z.object({
  bookingId: z.string().uuid().optional(),
  status: recoveryStatus.optional(),
  notes: z.string().max(1000).trim().optional(),
});

/*
 * Bulk import of a Salik statement.
 *
 * Two endpoints rather than one with a flag: "show me what this would do" and
 * "do it" are different enough that a mistyped parameter should not turn one
 * into the other.
 */
const statementSchema = z.object({
  /// The file's contents. Text rather than multipart: a statement is a few
  /// hundred lines of CSV, and keeping it a string means the same endpoint
  /// serves a paste-in box and a file picker without branching.
  text: z.string().min(1, 'Paste or upload the statement first').max(2_000_000),
});

function actorFrom(req: Parameters<typeof requestContext>[0]): FleetActor {
  return {
    id: req.user!.id,
    email: req.user!.email,
    role: req.user!.role,
    ...requestContext(req),
  };
}

const router = Router();

router.use(authenticate, authorizeStaff);

// --- Traffic fines (BRD 38) ------------------------------------------------

router.get(
  '/fines',
  validate({ query: chargeListSchema }),
  asyncHandler(async (req, res) => {
    const query = getValidatedQuery<z.infer<typeof chargeListSchema>>(req);
    const { items, total } = await finesService.listFines(query);
    sendPaginated(res, items, query.page, query.limit, total);
  }),
);

/**
 * POST /fleet/fines
 *
 * The service SUGGESTS which rental the car was on at the moment of the
 * violation. It suggests rather than assigns, because the person who pays for
 * a fine should be chosen by a human looking at the timestamp, not inferred
 * silently by a lookup.
 */
router.post(
  '/fines',
  validate({ body: fineSchema }),
  asyncHandler(async (req, res) => {
    sendCreated(res, await finesService.recordFine(req.body as z.infer<typeof fineSchema>, actorFrom(req)));
  }),
);

router.patch(
  '/fines/:id',
  validate({ params: idParam, body: chargeUpdateSchema }),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof chargeUpdateSchema>;
    sendSuccess(res, await finesService.update('fine', req.params.id as string, input, actorFrom(req)));
  }),
);

/*
 * Bulk import of a fines export, through the same engine as Salik.
 *
 * A fines file is smaller than a month of Salik but the typing problem is the
 * same, and so is everything that makes the import safe: preview first, plate
 * matched by meaning, attributed by who actually had the car, and refused on a
 * closed rental.
 */
router.post(
  '/fines/import/preview',
  validate({ body: statementSchema }),
  asyncHandler(async (req, res) => {
    const { text } = req.body as z.infer<typeof statementSchema>;
    sendSuccess(res, await statementImport.preview(text, 'fine'), 'Fines file read');
  }),
);

router.post(
  '/fines/import',
  validate({ body: statementSchema }),
  asyncHandler(async (req, res) => {
    const { text } = req.body as z.infer<typeof statementSchema>;
    const result = await statementImport.commit(text, actorFrom(req), 'fine');
    sendCreated(res, result, `${result.imported} fine(s) imported`);
  }),
);

/*
 * GET /fleet/fines/:id/booking-options
 *
 * The rentals this fine could belong to - only ever rentals of the car it was
 * issued against. Staff-readable, because attaching is staff work; the
 * recovery that follows it is still admin-only.
 */
router.get(
  '/fines/:id/booking-options',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    sendSuccess(res, await finesService.bookingOptions('fine', req.params.id as string), 'Options');
  }),
);

/** POST /fleet/fines/:id/recover - pass the fine on to the renter's booking. */
router.post(
  '/fines/:id/recover',
  authorizeAdmin,
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    sendCreated(res, await finesService.recover('fine', req.params.id as string, actorFrom(req)));
  }),
);


router.post(
  '/tolls/import/preview',
  validate({ body: statementSchema }),
  asyncHandler(async (req, res) => {
    const { text } = req.body as z.infer<typeof statementSchema>;
    sendSuccess(res, await statementImport.preview(text), 'Statement read');
  }),
);

router.post(
  '/tolls/import',
  validate({ body: statementSchema }),
  asyncHandler(async (req, res) => {
    const { text } = req.body as z.infer<typeof statementSchema>;
    const result = await statementImport.commit(text, actorFrom(req));
    sendCreated(res, result, `${result.imported} crossing(s) imported`);
  }),
);

/*
 * GET /fleet/bookings/:id/settlement-check
 *
 * Everything the counter needs to know before handing a deposit back: what is
 * outstanding, what could not be matched, and how much of the rental no Salik
 * statement has reached yet.
 *
 * Read-only, and open to any staff member, because the whole value is that it
 * is checked at the counter by whoever is standing there. Acting on it - the
 * recovery - stays admin-only.
 */
router.get(
  '/bookings/:id/settlement-check',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    sendSuccess(res, await settlementCheck.forBooking(req.params.id as string), 'Settlement check');
  }),
);

// --- Salik tolls (BRD 38) --------------------------------------------------

router.get(
  '/tolls',
  validate({ query: chargeListSchema }),
  asyncHandler(async (req, res) => {
    const query = getValidatedQuery<z.infer<typeof chargeListSchema>>(req);
    const { items, total } = await finesService.listTolls(query);
    sendPaginated(res, items, query.page, query.limit, total);
  }),
);

router.post(
  '/tolls',
  validate({ body: tollSchema }),
  asyncHandler(async (req, res) => {
    sendCreated(res, await finesService.recordToll(req.body as z.infer<typeof tollSchema>, actorFrom(req)));
  }),
);

router.get(
  '/tolls/:id/booking-options',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    sendSuccess(res, await finesService.bookingOptions('toll', req.params.id as string), 'Options');
  }),
);

router.patch(
  '/tolls/:id',
  validate({ params: idParam, body: chargeUpdateSchema }),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof chargeUpdateSchema>;
    sendSuccess(res, await finesService.update('toll', req.params.id as string, input, actorFrom(req)));
  }),
);

router.post(
  '/tolls/:id/recover',
  authorizeAdmin,
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    sendCreated(res, await finesService.recover('toll', req.params.id as string, actorFrom(req)));
  }),
);

// --- Maintenance (BRD 39) --------------------------------------------------

const maintenanceSchema = z.object({
  vehicleId: z.string().uuid('Select a vehicle'),
  type: z.enum(['ROUTINE_SERVICE', 'REPAIR', 'TYRE_CHANGE', 'BODYWORK', 'INSPECTION', 'OTHER']),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  description: z.string().min(3, 'Describe the work').max(1000).trim(),
  provider: z.string().max(200).trim().optional(),
  mileage: z.coerce.number().int().nonnegative().optional(),
  cost: money.optional(),
  nextServiceAt: z.coerce.date().optional(),
  nextServiceMileage: z.coerce.number().int().nonnegative().optional(),
  notes: z.string().max(1000).trim().optional(),
});

const maintenanceListSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  vehicleId: z.string().uuid().optional(),
  status: z.enum(['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).optional(),
});

const maintenanceStatusSchema = z.object({
  status: z.enum(['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']),
});

router.get(
  '/maintenance',
  validate({ query: maintenanceListSchema }),
  asyncHandler(async (req, res) => {
    const query = getValidatedQuery<z.infer<typeof maintenanceListSchema>>(req);
    const { items, total } = await maintenanceService.list(query);
    sendPaginated(res, items, query.page, query.limit, total);
  }),
);

/**
 * POST /fleet/maintenance
 *
 * Returns 409 if a live booking overlaps the window. That refusal is the
 * feature: a car cannot be taken off the road out from under a customer who
 * has already paid without someone dealing with their booking first.
 */
router.post(
  '/maintenance',
  validate({ body: maintenanceSchema }),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof maintenanceSchema>;
    sendCreated(res, await maintenanceService.schedule(input, actorFrom(req)));
  }),
);

router.patch(
  '/maintenance/:id/status',
  validate({ params: idParam, body: maintenanceStatusSchema }),
  asyncHandler(async (req, res) => {
    const { status } = req.body as z.infer<typeof maintenanceStatusSchema>;
    sendSuccess(res, await maintenanceService.updateStatus(req.params.id as string, status, actorFrom(req)));
  }),
);

// --- Insurance and vehicle documents (BRD 40) ------------------------------

const policySchema = z.object({
  vehicleId: z.string().uuid('Select a vehicle'),
  provider: z.string().min(1, 'Enter the insurer').max(200).trim(),
  policyNumber: z.string().min(1, 'Enter the policy number').max(120).trim(),
  coverType: z.string().max(120).trim().optional(),
  startDate: z.coerce.date(),
  expiryDate: z.coerce.date(),
  premium: money.optional(),
  /// The hirer's exposure. Optional, but the agreement prints a gap without it.
  excessAmount: money.optional(),
  notes: z.string().max(1000).trim().optional(),
});

const documentMetaSchema = z.object({
  type: z.enum([
    'REGISTRATION',
    'INSURANCE',
    'REGISTRATION_RENEWAL',
    'INSURANCE_RENEWAL',
    'MAINTENANCE_RECORD',
    'INSPECTION_REPORT',
    'OTHER',
  ]),
  documentNumber: z.string().max(120).trim().optional(),
  issueDate: z.coerce.date().optional(),
  expiryDate: z.coerce.date().optional(),
  notes: z.string().max(1000).trim().optional(),
});

router.get(
  '/vehicles/:vehicleId/insurance',
  validate({ params: vehicleIdParam }),
  asyncHandler(async (req, res) => {
    sendSuccess(res, await insuranceService.listPolicies(req.params.vehicleId as string));
  }),
);

/**
 * POST /fleet/insurance
 *
 * Adding a policy supersedes the previous one instead of overwriting it, so
 * last year's cover is still on file when a claim about last year arrives.
 */
router.post(
  '/insurance',
  validate({ body: policySchema }),
  asyncHandler(async (req, res) => {
    sendCreated(res, await insuranceService.addPolicy(req.body as z.infer<typeof policySchema>, actorFrom(req)));
  }),
);

router.get(
  '/vehicles/:vehicleId/documents',
  validate({ params: vehicleIdParam }),
  asyncHandler(async (req, res) => {
    sendSuccess(res, await insuranceService.listDocuments(req.params.vehicleId as string));
  }),
);

/**
 * POST /fleet/vehicles/:vehicleId/documents
 *
 * Goes to PRIVATE storage. A Mulkiya carries the chassis number and the
 * owner's details; there is no URL for it anywhere, only the streaming route
 * below.
 */
router.post(
  '/vehicles/:vehicleId/documents',
  validate({ params: vehicleIdParam }),
  uploadVehicleDocument,
  asyncHandler(async (req, res) => {
    const file = req.file;
    if (!file) throw ApiError.badRequest('Attach a file');

    // Multer has parsed the multipart body, so the metadata is validated here
    // rather than by middleware that would have run before the fields existed.
    const meta = documentMetaSchema.parse(req.body);

    sendCreated(
      res,
      await insuranceService.uploadDocument(req.params.vehicleId as string, file, meta, actorFrom(req)),
    );
  }),
);

/** GET /fleet/documents/:id/file - the only way to read the bytes. */
router.get(
  '/documents/:id/file',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const { stream, mimeType, fileName } = await insuranceService.getDocumentFile(
      req.params.id as string,
      actorFrom(req),
    );

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', contentDisposition(fileName));
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    stream.pipe(res);
  }),
);

router.delete(
  '/documents/:id',
  authorizeAdmin,
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    await insuranceService.deleteDocument(req.params.id as string, actorFrom(req));
    sendSuccess(res, null, 'Document deleted');
  }),
);

// --- Expiry dashboard (BRD 41) ---------------------------------------------

const expirySchema = z.object({
  withinDays: z.coerce.number().int().nonnegative().max(365).optional(),
});

/**
 * GET /fleet/expiring
 *
 * Anything already expired is always returned, whatever the window. A policy
 * that lapsed 90 days ago is the most urgent row on the page, not one that
 * falls outside a 30-day filter.
 */
router.get(
  '/expiring',
  validate({ query: expirySchema }),
  asyncHandler(async (req, res) => {
    const query = getValidatedQuery<z.infer<typeof expirySchema>>(req);
    sendSuccess(res, await insuranceService.expiring(query));
  }),
);

export const fleetRoutes = router;
