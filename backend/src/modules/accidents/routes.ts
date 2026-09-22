/**
 * modules/accidents/routes.ts
 * ---------------------------------------------------------------------------
 * Accidents and insurance claims. Back-office only.
 *
 * Nothing here is customer-facing. A claim carries the other party's details,
 * an insurer's reference and an internal view of who is liable - none of which
 * belongs on a customer's screen. What the customer owes reaches them through
 * a damage charge, which has its own module and its own explanation.
 */
import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate';
import { authorizeStaff } from '../../middleware/authorize';
import { getValidatedQuery, validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendCreated, sendPaginated, sendSuccess } from '../../utils/apiResponse';
import { requestContext } from '../audit/service';
import { accidentsService, type AccidentActor } from './service';

const STATUSES = [
  'REPORTED',
  'CLAIM_SUBMITTED',
  'ASSESSED',
  'IN_REPAIR',
  'COMPLETED',
  'CLOSED',
] as const;

const money = z
  .string()
  .regex(/^\d{1,8}(\.\d{1,2})?$/, 'Enter an amount like 1500 or 1500.00');
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD');
const instant = z.string().datetime({ offset: true }).or(z.string().datetime()).transform((v) => new Date(v));

const idParam = z.object({ id: z.string().uuid('Invalid accident id') });

const listSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.enum(STATUSES).optional(),
  vehicleId: z.string().uuid().optional(),
});

const createSchema = z.object({
  vehicleId: z.string().uuid('Choose the vehicle'),
  /// Optional: a car can be hit in the yard between rentals.
  bookingId: z.string().uuid().optional(),
  occurredAt: instant,
  location: z.string().max(200).trim().optional(),
  description: z.string().min(5, 'Say what happened').max(2000).trim(),
  policeReportNumber: z.string().max(60).trim().optional(),
  policeReportDate: dateOnly.optional(),
  insurerName: z.string().max(120).trim().optional(),
  policyNumber: z.string().max(60).trim().optional(),
  excessAmount: money.optional(),
  garageName: z.string().max(120).trim().optional(),
  repairEstimate: money.optional(),
  offRoadFrom: instant.optional(),
  notes: z.string().max(2000).trim().optional(),
});

const updateSchema = z
  .object({
    status: z.enum(STATUSES).optional(),
    location: z.string().max(200).trim().optional(),
    description: z.string().min(5).max(2000).trim().optional(),
    policeReportNumber: z.string().max(60).trim().optional(),
    policeReportDate: dateOnly.optional(),
    insurerName: z.string().max(120).trim().optional(),
    policyNumber: z.string().max(60).trim().optional(),
    claimNumber: z.string().max(60).trim().optional(),
    claimSubmittedAt: instant.optional(),
    claimSettledAt: instant.optional(),
    claimPaidAmount: money.optional(),
    excessAmount: money.optional(),
    customerLiability: money.optional(),
    garageName: z.string().max(120).trim().optional(),
    repairEstimate: money.optional(),
    repairCost: money.optional(),
    offRoadFrom: instant.optional(),
    offRoadUntil: instant.optional(),
    notes: z.string().max(2000).trim().optional(),
    damageId: z.string().uuid().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update',
  });

function actorFrom(req: Parameters<typeof requestContext>[0]): AccidentActor {
  return {
    id: req.user!.id,
    email: req.user!.email,
    role: req.user!.role,
    ...requestContext(req),
  };
}

const router = Router();

router.use(authenticate, authorizeStaff);

router.get(
  '/',
  validate({ query: listSchema }),
  asyncHandler(async (req, res) => {
    const query = getValidatedQuery<z.infer<typeof listSchema>>(req);
    const { items, total } = await accidentsService.list(query);
    sendPaginated(res, items, query.page, query.limit, total);
  }),
);

router.get(
  '/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    sendSuccess(res, { accident: await accidentsService.getById(req.params.id as string) });
  }),
);

router.post(
  '/',
  validate({ body: createSchema }),
  asyncHandler(async (req, res) => {
    const accident = await accidentsService.create(req.body, actorFrom(req));
    sendCreated(res, { accident }, `Accident ${accident.reference} reported`);
  }),
);

router.patch(
  '/:id',
  validate({ params: idParam, body: updateSchema }),
  asyncHandler(async (req, res) => {
    const accident = await accidentsService.update(
      req.params.id as string,
      req.body,
      actorFrom(req),
    );
    sendSuccess(res, { accident }, 'Accident report updated');
  }),
);

export const accidentRoutes = router;
