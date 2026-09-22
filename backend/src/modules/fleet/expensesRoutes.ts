/**
 * modules/fleet/expensesRoutes.ts
 * ---------------------------------------------------------------------------
 * What a car costs its owner.
 *
 * ===========================================================================
 * WHY THIS LEDGER EXISTS
 * ===========================================================================
 * Revenue was recorded everywhere - payments, invoices, charges - and cost was
 * recorded nowhere. So "which of my cars makes money" had no answer, and fleet
 * decisions came down to a feeling that the big ones rent more.
 *
 * Maintenance, insurance and accident repairs post here by themselves, so the
 * common costs are captured without anybody typing them twice. This endpoint
 * is for the rest: finance instalments, registration renewal, the annual
 * depreciation write-down, a cleaning contract - the things that never had a
 * home in a rental system and quietly came out of the owner's pocket.
 *
 * A row posted by another module carries `sourceType`/`sourceId` and cannot be
 * created here: correcting a garage bill belongs on the maintenance record, not
 * in a second row that disagrees with it.
 */
import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate';
import { authorizeStaff, authorizeAdmin } from '../../middleware/authorize';
import { getValidatedQuery, validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendCreated, sendPaginated, sendSuccess } from '../../utils/apiResponse';
import { ApiError } from '../../utils/ApiError';
import { prisma } from '../../config/prisma';
import { auditService, requestContext } from '../audit/service';

const EXPENSE_TYPES = [
  'FINANCE',
  'DEPRECIATION',
  'INSURANCE',
  'MAINTENANCE',
  'TYRES',
  'REGISTRATION',
  'CLEANING',
  'ACCIDENT',
  'FUEL',
  'SALIK',
  'OTHER',
] as const;

const money = z.string().regex(/^\d{1,8}(\.\d{1,2})?$/, 'Enter an amount like 1500 or 1500.00');
const instant = z
  .string()
  .datetime({ offset: true })
  .or(z.string().datetime())
  .transform((value) => new Date(value));

const idParam = z.object({ id: z.string().uuid('Invalid expense id') });

const listSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  vehicleId: z.string().uuid().optional(),
  type: z.enum(EXPENSE_TYPES).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

const createSchema = z.object({
  vehicleId: z.string().uuid('Choose the vehicle'),
  type: z.enum(EXPENSE_TYPES),
  amount: money,
  /// The date the cost BELONGS to, which is not always the date it was typed.
  incurredAt: instant,
  description: z.string().max(500).trim().optional(),
  supplier: z.string().max(200).trim().optional(),
});

const router = Router();

router.use(authenticate, authorizeStaff);

router.get(
  '/',
  validate({ query: listSchema }),
  asyncHandler(async (req, res) => {
    const query = getValidatedQuery<z.infer<typeof listSchema>>(req);

    const where = {
      ...(query.vehicleId ? { vehicleId: query.vehicleId } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.from || query.to
        ? {
            incurredAt: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lt: query.to } : {}),
            },
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.vehicleExpense.findMany({
        where,
        include: {
          vehicle: { select: { brand: true, model: true, registrationNumber: true } },
        },
        orderBy: { incurredAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      prisma.vehicleExpense.count({ where }),
    ]);

    sendPaginated(
      res,
      items.map((expense) => ({
        id: expense.id,
        vehicleId: expense.vehicleId,
        vehicle: `${expense.vehicle.brand} ${expense.vehicle.model} (${expense.vehicle.registrationNumber})`,
        type: expense.type,
        amount: expense.amount.toFixed(2),
        currency: expense.currency,
        incurredAt: expense.incurredAt.toISOString(),
        description: expense.description,
        supplier: expense.supplier,
        /// Set when another module posted it. Such a row is corrected there,
        /// not here, which is why the screen shows it as read-only.
        sourceType: expense.sourceType,
      })),
      query.page,
      query.limit,
      total,
    );
  }),
);

router.post(
  '/',
  validate({ body: createSchema }),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof createSchema>;

    const vehicle = await prisma.vehicle.findFirst({
      where: { id: input.vehicleId, deletedAt: null },
      select: { registrationNumber: true },
    });
    if (!vehicle) throw ApiError.notFound('That vehicle does not exist');

    const expense = await prisma.vehicleExpense.create({
      data: {
        vehicleId: input.vehicleId,
        type: input.type,
        amount: input.amount,
        incurredAt: input.incurredAt,
        description: input.description ?? null,
        supplier: input.supplier ?? null,
        recordedById: req.user!.id,
      },
    });

    await auditService.record({
      action: 'vehicle.expense.recorded',
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      actorRole: req.user!.role,
      entityType: 'VehicleExpense',
      entityId: expense.id,
      metadata: {
        plate: vehicle.registrationNumber,
        type: input.type,
        amount: input.amount,
      },
      ...requestContext(req),
    });

    sendCreated(res, { expense: { id: expense.id } }, 'Cost recorded');
  }),
);

/**
 * DELETE /fleet/expenses/:id - remove a cost entered by mistake.
 *
 * ADMIN only, and never for a row another module posted: deleting the expense
 * behind a garage invoice would leave the maintenance record claiming a cost
 * the ledger has never heard of.
 */
router.delete(
  '/:id',
  authorizeAdmin,
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const expense = await prisma.vehicleExpense.findUnique({
      where: { id: req.params.id as string },
    });
    if (!expense) throw ApiError.notFound('That cost does not exist');

    if (expense.sourceType) {
      throw ApiError.conflict(
        `This came from a ${expense.sourceType.replace(/([A-Z])/g, ' $1').trim().toLowerCase()}. Correct it there and the ledger follows.`,
      );
    }

    await prisma.vehicleExpense.delete({ where: { id: expense.id } });

    await auditService.record({
      action: 'vehicle.expense.deleted',
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      actorRole: req.user!.role,
      entityType: 'VehicleExpense',
      entityId: expense.id,
      metadata: { type: expense.type, amount: expense.amount.toFixed(2) },
      ...requestContext(req),
    });

    sendSuccess(res, { removed: true }, 'Cost removed');
  }),
);

export const vehicleExpenseRoutes = router;
