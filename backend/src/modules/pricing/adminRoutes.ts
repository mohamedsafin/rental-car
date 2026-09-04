/**
 * modules/pricing/adminRoutes.ts
 * ---------------------------------------------------------------------------
 * Admin management of additional services, pricing rules and the settings the
 * pricing engine reads (BRD 16 and 17).
 *
 * These exist because the seed deliberately leaves every commercial number
 * blank: services are created inactive at price 0, no pricing rules are seeded,
 * and VAT is empty. Without these endpoints the admin has no way to supply the
 * values BRD 38 says only they can supply.
 */
import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { authenticate } from '../../middleware/authenticate';
import { authorizeAdmin } from '../../middleware/authorize';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendCreated, sendSuccess } from '../../utils/apiResponse';
import { ApiError } from '../../utils/ApiError';
import { slugify } from '../../utils/slug';
import { clearSettingsCache } from '../settings/service';

const money = z.string().regex(/^\d{1,8}(\.\d{1,2})?$/, 'Enter an amount like 50 or 49.50');
const idParam = z.object({ id: z.string().uuid('Invalid id') });

const router = Router();

// Every route in this file is admin-only. Applying it once at the top means a
// route added later cannot ship unprotected by accident.
router.use(authenticate, authorizeAdmin);

// --- Additional services ---------------------------------------------------

router.get(
  '/services',
  asyncHandler(async (_req, res) => {
    const services = await prisma.additionalService.findMany({
      where: { deletedAt: null },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });

    sendSuccess(
      res,
      {
        services: services.map((service) => ({
          ...service,
          price: service.price.toFixed(2),
        })),
      },
      'Services retrieved',
    );
  }),
);

const serviceInputSchema = z.object({
  name: z.string().min(2).max(80).trim(),
  description: z.string().max(500).trim().optional(),
  price: money,
  chargeType: z.enum(['PER_BOOKING', 'PER_DAY']),
  maxQuantity: z.coerce.number().int().min(1).max(20).default(1),
  displayOrder: z.coerce.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
});

router.post(
  '/services',
  validate({ body: serviceInputSchema }),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof serviceInputSchema>;

    const existing = await prisma.additionalService.findFirst({
      where: { name: { equals: input.name, mode: 'insensitive' }, deletedAt: null },
    });
    if (existing) throw ApiError.conflict('A service with this name already exists');

    const service = await prisma.additionalService.create({
      data: {
        ...input,
        slug: slugify(input.name),
        price: new Prisma.Decimal(input.price),
        description: input.description ?? null,
      },
    });

    sendCreated(res, { service: { ...service, price: service.price.toFixed(2) } }, 'Service created');
  }),
);

router.patch(
  '/services/:id',
  validate({ params: idParam, body: serviceInputSchema.partial() }),
  asyncHandler(async (req, res) => {
    const input = req.body as Partial<z.infer<typeof serviceInputSchema>>;

    const service = await prisma.additionalService.update({
      where: { id: req.params.id as string },
      data: {
        ...input,
        ...(input.price !== undefined ? { price: new Prisma.Decimal(input.price) } : {}),
      },
    });

    sendSuccess(res, { service: { ...service, price: service.price.toFixed(2) } }, 'Service updated');
  }),
);


// --- Pricing rules (BRD 16) ------------------------------------------------

const pricingRuleSchema = z
  .object({
    name: z.string().min(2).max(80).trim(),
    type: z.enum(['WEEKEND', 'SEASONAL', 'LONG_TERM_DISCOUNT']),
    vehicleId: z.string().uuid().optional(),
    categoryId: z.string().uuid().optional(),
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional(),
    /** ISO weekdays: 1 = Monday ... 7 = Sunday. */
    weekdays: z.array(z.coerce.number().int().min(1).max(7)).max(7).default([]),
    minDays: z.coerce.number().int().min(1).max(365).optional(),
    /** Positive = surcharge, negative = discount. */
    adjustmentPercentage: z
      .string()
      .regex(/^-?\d{1,3}(\.\d{1,2})?$/, 'Enter a percentage like 20 or -15'),
    priority: z.coerce.number().int().min(0).default(0),
    isActive: z.boolean().default(true),
  })
  // Each rule type needs different fields to be meaningful. Catching that here
  // means the engine never has to defend against a half-configured rule.
  .refine((data) => data.type !== 'SEASONAL' || (data.startDate && data.endDate), {
    message: 'A seasonal rule needs both a start and an end date',
    path: ['startDate'],
  })
  .refine((data) => data.type !== 'WEEKEND' || data.weekdays.length > 0, {
    message: 'A weekend rule needs at least one weekday',
    path: ['weekdays'],
  })
  .refine((data) => data.type !== 'LONG_TERM_DISCOUNT' || data.minDays !== undefined, {
    message: 'A long-term discount needs a minimum number of days',
    path: ['minDays'],
  })
  .refine((data) => data.type !== 'LONG_TERM_DISCOUNT' || data.adjustmentPercentage.startsWith('-'), {
    message: 'A discount must be negative, e.g. -15',
    path: ['adjustmentPercentage'],
  });

router.get(
  '/rules',
  asyncHandler(async (_req, res) => {
    const rules = await prisma.pricingRule.findMany({
      where: { deletedAt: null },
      orderBy: [{ type: 'asc' }, { priority: 'desc' }],
      include: {
        vehicle: { select: { id: true, brand: true, model: true } },
        category: { select: { id: true, name: true } },
      },
    });

    sendSuccess(
      res,
      {
        rules: rules.map((rule) => ({
          ...rule,
          adjustmentPercentage: rule.adjustmentPercentage.toFixed(2),
        })),
      },
      'Pricing rules retrieved',
    );
  }),
);

router.post(
  '/rules',
  validate({ body: pricingRuleSchema }),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof pricingRuleSchema>;

    const rule = await prisma.pricingRule.create({
      data: {
        name: input.name,
        type: input.type,
        vehicleId: input.vehicleId ?? null,
        categoryId: input.categoryId ?? null,
        startDate: input.startDate ? new Date(input.startDate) : null,
        endDate: input.endDate ? new Date(input.endDate) : null,
        weekdays: input.weekdays,
        minDays: input.minDays ?? null,
        adjustmentPercentage: new Prisma.Decimal(input.adjustmentPercentage),
        priority: input.priority,
        isActive: input.isActive,
      },
    });

    sendCreated(
      res,
      { rule: { ...rule, adjustmentPercentage: rule.adjustmentPercentage.toFixed(2) } },
      'Pricing rule created',
    );
  }),
);

router.delete(
  '/rules/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    await prisma.pricingRule.update({
      where: { id: req.params.id as string },
      data: { deletedAt: new Date(), isActive: false },
    });
    sendSuccess(res, null, 'Pricing rule removed');
  }),
);

// --- Settings the pricing engine reads -------------------------------------

router.get(
  '/settings',
  asyncHandler(async (_req, res) => {
    const settings = await prisma.systemSetting.findMany({
      where: { isSecret: false, category: { in: ['PRICING', 'RENTAL_POLICY', 'DOCUMENTS'] } },
      orderBy: [{ category: 'asc' }, { key: 'asc' }],
    });
    sendSuccess(res, { settings }, 'Settings retrieved');
  }),
);

router.patch(
  '/settings/:key',
  validate({
    params: z.object({ key: z.string().min(1).max(80) }),
    body: z.object({ value: z.string().max(2000) }),
  }),
  asyncHandler(async (req, res) => {
    const key = req.params.key as string;
    const { value } = req.body as { value: string };

    const existing = await prisma.systemSetting.findUnique({ where: { key } });
    if (!existing) throw ApiError.notFound('Setting not found');
    if (existing.isSystem) throw ApiError.forbidden('This setting cannot be changed here');

    const setting = await prisma.systemSetting.update({ where: { key }, data: { value } });

    // The settings service caches for 30 seconds; drop it so the very next
    // quote uses the new VAT rate rather than the old one.
    clearSettingsCache();

    sendSuccess(res, { setting }, 'Setting updated');
  }),
);

export const pricingAdminRoutes = router;
