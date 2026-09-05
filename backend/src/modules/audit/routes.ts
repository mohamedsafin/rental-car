/**
 * modules/audit/routes.ts
 * ---------------------------------------------------------------------------
 * Reading the audit trail (BRD 36).
 *
 * The log has been written since Phase 2 and, until now, could only be read
 * with SQL. That is a trail nobody consults, which is nearly as good as not
 * having one: "who approved that document?", "who set VAT to zero?" and "who
 * looked at this customer's passport?" are support questions, not DBA
 * questions.
 *
 * READ ONLY. There is no create, no update and no delete - not because the
 * routes were forgotten, but because an audit trail that can be edited from
 * the application it audits is worthless. Entries are written by the services
 * themselves; the only way to remove one is a database administrator, which is
 * exactly the level of friction it should take.
 */
import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { authenticate } from '../../middleware/authenticate';
import { authorizeAdmin } from '../../middleware/authorize';
import { getValidatedQuery, validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendPaginated, sendSuccess } from '../../utils/apiResponse';
import { prisma } from '../../config/prisma';

const listSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  /** Exact action, e.g. "document.approved". */
  action: z.string().max(80).optional(),
  /** Everything about one record, e.g. entityType=Booking. */
  entityType: z.string().max(60).optional(),
  entityId: z.string().uuid().optional(),
  actorId: z.string().uuid().optional(),
  /** Free text across actor email and action. */
  search: z.string().max(120).trim().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

const router = Router();

/*
 * ADMIN only, not staff.
 *
 * The trail records who viewed which customer's identity documents. Handing
 * that to every staff member turns an accountability record into a surveillance
 * feed on their colleagues.
 */
router.use(authenticate, authorizeAdmin);

router.get(
  '/',
  validate({ query: listSchema }),
  asyncHandler(async (req, res) => {
    const query = getValidatedQuery<z.infer<typeof listSchema>>(req);

    const where: Prisma.AuditLogWhereInput = {
      ...(query.action ? { action: query.action } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lte: query.to } : {}),
            },
          }
        : {}),
      ...(query.search
        ? {
            OR: [
              { actorEmail: { contains: query.search, mode: 'insensitive' } },
              { action: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await prisma.$transaction([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      prisma.auditLog.count({ where }),
    ]);

    sendPaginated(
      res,
      items.map((entry) => ({
        id: entry.id,
        action: entry.action,
        // The snapshot, not a join - the entry has to survive the actor being
        // deleted, which is the whole reason it was denormalised.
        actorEmail: entry.actorEmail,
        actorRole: entry.actorRole,
        actorId: entry.actorId,
        entityType: entry.entityType,
        entityId: entry.entityId,
        metadata: entry.metadata,
        ipAddress: entry.ipAddress,
        createdAt: entry.createdAt.toISOString(),
      })),
      query.page,
      query.limit,
      total,
    );
  }),
);

/**
 * GET /audit/actions
 *
 * The distinct actions actually present, so the filter offers what exists
 * rather than a hardcoded list that drifts as modules are added.
 */
router.get(
  '/actions',
  asyncHandler(async (_req, res) => {
    const rows = await prisma.auditLog.groupBy({
      by: ['action'],
      _count: true,
      orderBy: { _count: { action: 'desc' } },
    });

    sendSuccess(
      res,
      rows.map((row) => ({ action: row.action, count: row._count })),
      'Actions retrieved',
    );
  }),
);

export const auditRoutes = router;
