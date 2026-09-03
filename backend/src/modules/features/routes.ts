/**
 * modules/features/routes.ts
 * ---------------------------------------------------------------------------
 * Vehicle features (BRD 9: Bluetooth, GPS, CarPlay, ...).
 *
 * A deliberately tiny module - the whole thing is one file, because a lookup
 * table with four endpoints does not need the five-file structure that
 * vehicles or bookings do. Consistency should not become ceremony.
 */
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/prisma';
import { authenticate } from '../../middleware/authenticate';
import { authorizeAdmin } from '../../middleware/authorize';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendCreated, sendSuccess } from '../../utils/apiResponse';
import { ApiError } from '../../utils/ApiError';
import { slugify } from '../../utils/slug';

const createFeatureSchema = z.object({
  name: z.string().min(2).max(60).trim(),
  icon: z.string().max(40).trim().optional(),
});

const featureIdParamSchema = z.object({ id: z.string().uuid('Invalid feature id') });

const router = Router();

// --- Public: the customer site renders these on the car details page --------
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const features = await prisma.vehicleFeature.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
    sendSuccess(res, { features }, 'Features retrieved');
  }),
);

// --- Admin ----------------------------------------------------------------
router.post(
  '/',
  authenticate,
  authorizeAdmin,
  validate({ body: createFeatureSchema }),
  asyncHandler(async (req, res) => {
    const { name, icon } = req.body as z.infer<typeof createFeatureSchema>;

    const existing = await prisma.vehicleFeature.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
    });
    if (existing) throw ApiError.conflict('A feature with this name already exists');

    const feature = await prisma.vehicleFeature.create({
      data: { name, slug: slugify(name), icon: icon ?? null },
    });
    sendCreated(res, { feature }, 'Feature created');
  }),
);

router.delete(
  '/:id',
  authenticate,
  authorizeAdmin,
  validate({ params: featureIdParamSchema }),
  asyncHandler(async (req, res) => {
    // Deactivate rather than delete: the join rows on existing vehicles would
    // cascade away and silently strip features from cars already listed.
    await prisma.vehicleFeature.update({
      where: { id: req.params.id as string },
      data: { isActive: false },
    });
    sendSuccess(res, null, 'Feature deactivated');
  }),
);

export const featureRoutes = router;
