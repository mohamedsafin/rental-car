/**
 * modules/settings/routes.ts
 * ---------------------------------------------------------------------------
 * The full settings screen (BRD 51).
 *
 * There was already a settings endpoint under /admin/pricing, but it was
 * scoped to PRICING, RENTAL_POLICY and DOCUMENTS - which left COMPANY
 * unreachable from any screen. That is the category holding the registered
 * address and the Tax Registration Number, so every invoice was printing a
 * warning about a value no one could actually set. This exposes all of them.
 *
 * Two rules carried over and enforced here:
 *
 *  - `isSecret` settings are NEVER returned. An API key belongs in the
 *    environment, and a settings screen that displays one turns a session
 *    hijack into a credential leak.
 *  - `isSystem` settings cannot be written. They are structural, not
 *    commercial.
 *
 * Every change is audited, because these values decide what customers are
 * charged - "who set VAT to 0?" needs an answer.
 */
import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate';
import { authorizeAdmin, authorizeStaff } from '../../middleware/authorize';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendSuccess } from '../../utils/apiResponse';
import { ApiError } from '../../utils/ApiError';
import { prisma } from '../../config/prisma';
import { auditService, requestContext } from '../audit/service';
import { clearSettingsCache } from './service';
import { readinessService } from './readiness';

const keyParam = z.object({ key: z.string().min(1).max(80) });

const updateSchema = z.object({
  // Stored as text whatever the declared type - `valueType` says how to read
  // it back. An empty string is meaningful: it means "not configured yet",
  // which the engines treat as a warning rather than a zero.
  value: z.string().max(4000),
});

const router = Router();

router.use(authenticate, authorizeStaff);

/**
 * GET /settings
 *
 * Everything the client is allowed to see, grouped by category so the screen
 * can render sections without hardcoding which key belongs where.
 */
/**
 * GET /settings/readiness
 *
 * Which unset settings are actually switching something off, and what that
 * costs. Staff-readable because the dashboard shows it; only an admin can act
 * on it, which the PATCH below already enforces.
 */
router.get(
  '/readiness',
  asyncHandler(async (_req, res) => {
    sendSuccess(res, await readinessService.check(), 'Setup status');
  }),
);

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const settings = await prisma.systemSetting.findMany({
      where: { isSecret: false },
      orderBy: [{ category: 'asc' }, { key: 'asc' }],
      select: {
        key: true,
        value: true,
        valueType: true,
        category: true,
        label: true,
        description: true,
        isSystem: true,
        updatedAt: true,
      },
    });

    const groups = new Map<string, typeof settings>();
    for (const setting of settings) {
      const existing = groups.get(setting.category) ?? [];
      existing.push(setting);
      groups.set(setting.category, existing);
    }

    sendSuccess(
      res,
      {
        groups: [...groups.entries()].map(([category, items]) => ({
          category,
          settings: items.map((setting) => ({
            ...setting,
            updatedAt: setting.updatedAt.toISOString(),
            // Surfaced so the UI can mark what still needs the client's input
            // rather than letting a blank field look deliberate.
            isConfigured: setting.value.trim() !== '' && setting.value.trim() !== '[]',
          })),
        })),
        unconfigured: settings.filter(
          (setting) => setting.value.trim() === '' || setting.value.trim() === '[]',
        ).length,
      },
      'Settings retrieved',
    );
  }),
);

/** PATCH /settings/:key - ADMIN only. These values decide what customers pay. */
router.patch(
  '/:key',
  authorizeAdmin,
  validate({ params: keyParam, body: updateSchema }),
  asyncHandler(async (req, res) => {
    const key = req.params.key as string;
    const { value } = req.body as z.infer<typeof updateSchema>;

    const existing = await prisma.systemSetting.findUnique({ where: { key } });
    if (!existing) throw ApiError.notFound('Setting not found');
    if (existing.isSecret) throw ApiError.forbidden('Secrets are configured in the environment');
    if (existing.isSystem) throw ApiError.forbidden('This setting cannot be changed here');

    // Validate against the declared type before storing. A VAT rate of "five"
    // would otherwise sit in the database until the pricing engine tripped
    // over it mid-quote.
    if (existing.valueType === 'NUMBER' && value.trim() !== '' && Number.isNaN(Number(value))) {
      throw ApiError.badRequest('This setting must be a number');
    }
    if (existing.valueType === 'BOOLEAN' && !['true', 'false', ''].includes(value.trim())) {
      throw ApiError.badRequest('This setting must be true or false');
    }
    if (existing.valueType === 'JSON' && value.trim() !== '') {
      try {
        JSON.parse(value);
      } catch {
        throw ApiError.badRequest('This setting must be valid JSON');
      }
    }

    const setting = await prisma.systemSetting.update({ where: { key }, data: { value } });

    // The service caches for 30 seconds; drop it so the next quote uses this.
    clearSettingsCache();

    await auditService.record({
      action: 'setting.changed',
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      actorRole: req.user!.role,
      entityType: 'SystemSetting',
      entityId: setting.key,
      // Both values recorded: "who set VAT to 0, and what was it before?" is
      // the question this exists to answer.
      metadata: { key, from: existing.value, to: value },
      ...requestContext(req),
    });

    sendSuccess(res, { setting: { key: setting.key, value: setting.value } }, 'Setting updated');
  }),
);

export const settingsRoutes = router;
