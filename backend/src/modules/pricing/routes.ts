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
import { optionalAuthenticate } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendSuccess } from '../../utils/apiResponse';
import { prisma } from '../../config/prisma';
import { availabilityService } from '../availability/service';
import { SettingKey, settingsService } from '../settings/service';
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

  /// A promo CODE, never an amount. The engine decides what it is worth.
  couponCode: z.string().min(1).max(40).trim().optional(),

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
  // Optional, not required: BRD 14 has the customer reviewing the price before
  // logging in. Signing in only adds the per-customer coupon check.
  optionalAuthenticate,
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
      couponCode: input.couponCode,
      // Present when the quote is requested by a signed-in customer, so a
      // per-customer usage limit is checked here too rather than only at
      // checkout. optionalAuthenticate leaves this undefined for a guest.
      customerId: req.user?.id,
    });

    const availability = await availabilityService.checkVehicle(input.vehicleId, {
      pickupAt: input.pickupAt,
      returnAt: input.returnAt,
    });

    sendSuccess(res, { quote, availability }, 'Quote calculated');
  }),
);

/**
 * GET /pricing/payment-options
 *
 * What the checkout may offer. Public, because the customer sees it before
 * signing in - and it is derived from settings rather than hardcoded in the
 * browser, so switching cash off actually removes the option.
 */
router.get(
  '/payment-options',
  asyncHandler(async (_req, res) => {
    const cashAllowed = await settingsService.getBoolean(SettingKey.ALLOW_CASH_ON_PICKUP);

    sendSuccess(
      res,
      {
        options: [
          {
            value: 'ONLINE',
            label: 'Pay now, online',
            detail: 'Card payment. Your booking is confirmed as soon as it clears.',
            available: true,
          },
          {
            value: 'CASH_ON_PICKUP',
            label: 'Pay at pickup',
            detail: 'Reserve now and pay in cash when you collect the vehicle.',
            available: cashAllowed === true,
          },
        ],
      },
      'Payment options retrieved',
    );
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
