/**
 * modules/pricing/routes.ts
 * ---------------------------------------------------------------------------
 * POST, not GET, because a quote request carries a list of selected services -
 * a structured body, not a flat query string. It is still side-effect free.
 *
 * Public: BRD 14 has the customer reviewing the price BEFORE logging in.
 */
import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendSuccess } from '../../utils/apiResponse';
import { prisma } from '../../config/prisma';
import { availabilityService } from '../availability/service';
import { pricingService } from './service';

const isoDateTime = z
  .string()
  .datetime({ offset: true })
  .or(z.string().datetime())
  .transform((value) => new Date(value));

const quoteSchema = z.object({
  vehicleId: z.string().uuid('Invalid vehicle id'),
  pickupAt: isoDateTime,
  returnAt: isoDateTime,
  services: z
    .array(
      z.object({
        serviceId: z.string().uuid(),
        quantity: z.coerce.number().int().min(1).max(20).default(1),
      }),
    )
    .max(20)
    .default([]),
  pickupLocationId: z.string().uuid().optional(),
  dropoffLocationId: z.string().uuid().optional(),

  // NOTE: there is deliberately no `total` field. If a client sends one,
  // `validate` strips it before this schema is even applied, and the engine
  // recalculates from scratch. A price the browser controls is not a price.
});

const router = Router();

/**
 * POST /pricing/quote
 *
 * Returns the full breakdown from BRD 15, and also reports whether the vehicle
 * is actually free for those dates - so the checkout page can show the price
 * and the availability answer in a single round trip.
 */
router.post(
  '/quote',
  validate({ body: quoteSchema }),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof quoteSchema>;

    const quote = await pricingService.quote({
      vehicleId: input.vehicleId,
      pickupAt: input.pickupAt,
      returnAt: input.returnAt,
      services: input.services,
      pickupLocationId: input.pickupLocationId,
      dropoffLocationId: input.dropoffLocationId,
    });

    const availability = await availabilityService.checkVehicle(input.vehicleId, {
      pickupAt: input.pickupAt,
      returnAt: input.returnAt,
    });

    sendSuccess(res, { quote, availability }, 'Quote calculated');
  }),
);

/** GET /pricing/services - the add-ons a customer can choose (BRD 17). */
router.get(
  '/services',
  asyncHandler(async (_req, res) => {
    const services = await prisma.additionalService.findMany({
      where: { isActive: true, deletedAt: null },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });

    sendSuccess(
      res,
      {
        services: services.map((service) => ({
          id: service.id,
          name: service.name,
          slug: service.slug,
          description: service.description,
          price: service.price.toFixed(2),
          chargeType: service.chargeType,
          maxQuantity: service.maxQuantity,
        })),
      },
      'Additional services retrieved',
    );
  }),
);

export const pricingRoutes = router;
