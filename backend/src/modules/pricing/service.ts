/**
 * modules/pricing/service.ts
 * ---------------------------------------------------------------------------
 * Produces the price breakdown a customer sees before paying (BRD 15).
 *
 * THE RULE THAT MATTERS: this runs on the backend, and only on the backend.
 * The checkout page never sends a total. It sends what the customer CHOSE -
 * vehicle, dates, services, locations - and receives the arithmetic back. A
 * total in a request body is ignored, because a value the client controls is
 * not a price, it is a suggestion.
 *
 * Order of operations, which materially changes the result:
 *
 *   1. rental      = cheapest tier decomposition of the billable days
 *   2. + surcharges (weekend / seasonal rules)
 *   3. + services   (per-booking or per-day)
 *   4. + delivery
 *   5. - discounts  (long-term rule, then promo code)
 *   6. = taxable base
 *   7. + VAT on that base
 *   8. deposit reported SEPARATELY - it is held, not earned
 *
 * Discounts come before tax so the customer is not taxed on money they did not
 * pay. The deposit sits outside the tax base entirely: a refundable security
 * hold is not a supply of services.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { ApiError } from '../../utils/ApiError';
import { SettingKey, settingsService } from '../settings/service';
import {
  ZERO,
  applyPercentage,
  calculateDurationHours,
  calculateRentalDays,
  money,
  selectBestRate,
} from './calculator';
import { couponsService } from '../coupons/service';
import type { PriceQuote, QuoteLineItem, QuoteRequest } from './types';

const DAY_COUNTING_RULE =
  'Rental days are billed as 24-hour periods; any part of a period counts as a full day.';

/** ISO weekday, 1 = Monday ... 7 = Sunday. */
function isoWeekday(date: Date): number {
  const day = date.getUTCDay();
  return day === 0 ? 7 : day;
}

/** Does the rental window touch any of the given weekdays? */
function touchesWeekday(pickupAt: Date, returnAt: Date, weekdays: number[]): boolean {
  if (weekdays.length === 0) return false;

  const cursor = new Date(pickupAt);
  cursor.setUTCHours(0, 0, 0, 0);

  while (cursor <= returnAt) {
    if (weekdays.includes(isoWeekday(cursor))) return true;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return false;
}

export const pricingService = {
  async quote(request: QuoteRequest): Promise<PriceQuote> {
    const warnings: string[] = [];

    const vehicle = await prisma.vehicle.findFirst({
      where: { id: request.vehicleId, deletedAt: null },
      include: { category: true },
    });
    if (!vehicle) throw ApiError.notFound('Vehicle not found');

    const rentalDays = calculateRentalDays(request.pickupAt, request.returnAt);
    if (rentalDays === 0) throw ApiError.badRequest('Return must be after pickup');

    const durationHours = calculateDurationHours(request.pickupAt, request.returnAt);

    // --- 1. Base rental --------------------------------------------------
    const rate = selectBestRate(rentalDays, {
      daily: vehicle.dailyPrice,
      weekly: vehicle.weeklyPrice,
      monthly: vehicle.monthlyPrice,
    });

    let vehicleSubtotal = rate.total;
    const lineItems: QuoteLineItem[] = [
      {
        key: 'vehicle_rental',
        label: `${vehicle.brand} ${vehicle.model} rental`,
        amount: money(rate.total),
        detail: rate.blocks
          .map((block) => `${block.quantity} x ${block.tier} @ ${money(block.unitPrice)}`)
          .join(' + '),
      },
    ];

    // --- 2. Pricing rules: weekend and seasonal surcharges ---------------
    const rules = await prisma.pricingRule.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        OR: [
          { vehicleId: vehicle.id },
          { categoryId: vehicle.categoryId },
          { vehicleId: null, categoryId: null },
        ],
      },
      orderBy: { priority: 'desc' },
    });

    for (const rule of rules) {
      if (rule.type === 'SEASONAL') {
        const overlapsSeason =
          rule.startDate && rule.endDate
            ? request.pickupAt < rule.endDate && request.returnAt > rule.startDate
            : false;
        if (!overlapsSeason) continue;
      } else if (rule.type === 'WEEKEND') {
        if (!touchesWeekday(request.pickupAt, request.returnAt, rule.weekdays)) continue;
      } else {
        // LONG_TERM_DISCOUNT is applied at step 5, after services.
        continue;
      }

      const adjustment = applyPercentage(rate.total, rule.adjustmentPercentage);
      if (adjustment.isZero()) continue;

      vehicleSubtotal = vehicleSubtotal.add(adjustment);
      lineItems.push({
        key: `rule:${rule.id}`,
        label: rule.name,
        amount: money(adjustment),
        detail: `${rule.adjustmentPercentage.toFixed(2)}% adjustment`,
      });
    }

    // --- 3. Additional services (BRD 17) ---------------------------------
    let servicesSubtotal = ZERO;

    if (request.services && request.services.length > 0) {
      const ids = request.services.map((s) => s.serviceId);
      const services = await prisma.additionalService.findMany({
        where: { id: { in: ids }, isActive: true, deletedAt: null },
      });

      if (services.length !== ids.length) {
        throw ApiError.badRequest('One or more selected services are not available');
      }

      for (const selected of request.services) {
        const service = services.find((s) => s.id === selected.serviceId);
        if (!service) continue;

        if (selected.quantity < 1 || selected.quantity > service.maxQuantity) {
          throw ApiError.badRequest(`${service.name}: choose between 1 and ${service.maxQuantity}`);
        }

        // PER_DAY multiplies by billable days; PER_BOOKING is charged once.
        const units = service.chargeType === 'PER_DAY' ? rentalDays : 1;
        const amount = service.price.mul(selected.quantity).mul(units);

        servicesSubtotal = servicesSubtotal.add(amount);
        lineItems.push({
          key: `service:${service.slug}`,
          label: service.name + (selected.quantity > 1 ? ` x${selected.quantity}` : ''),
          amount: money(amount),
          detail:
            service.chargeType === 'PER_DAY'
              ? `${money(service.price)} per day x ${rentalDays} day(s)`
              : `${money(service.price)} one-off`,
        });
      }
    }

    // --- 4. Delivery fee (BRD 18) ----------------------------------------
    let deliveryFee = ZERO;

    if (request.pickupLocationId) {
      const location = await prisma.location.findFirst({
        where: { id: request.pickupLocationId, deletedAt: null, isActive: true },
      });
      if (!location) throw ApiError.badRequest('Selected pickup location is not available');

      if (!location.deliveryCharge.isZero()) {
        deliveryFee = location.deliveryCharge;
        lineItems.push({
          key: 'delivery_fee',
          label: `Delivery to ${location.name}`,
          amount: money(deliveryFee),
        });
      }
    }

    // --- 5. Long-term discount -------------------------------------------
    let discountAmount = ZERO;

    const discountRule = rules
      .filter((rule) => rule.type === 'LONG_TERM_DISCOUNT' && (rule.minDays ?? 0) <= rentalDays)
      // Longest qualifying threshold wins: the 30-day tier beats the 7-day.
      .sort((a, b) => (b.minDays ?? 0) - (a.minDays ?? 0))[0];

    if (discountRule) {
      // Applies to the rental only, not to services or delivery - a "15% off
      // long rentals" offer is about the car.
      const raw = applyPercentage(vehicleSubtotal, discountRule.adjustmentPercentage).abs();
      if (!raw.isZero()) {
        discountAmount = raw;
        lineItems.push({
          key: `discount:${discountRule.id}`,
          label: discountRule.name,
          amount: `-${money(raw)}`,
          detail: `${discountRule.minDays}+ day rental`,
        });
      }
    }

    // --- 5b. Promo code (BRD 19) -----------------------------------------
    //
    // Applied AFTER the long-term rule and to the same base - the rental
    // itself, not services or delivery. A "20% off" code is understood to be
    // about the car; discounting a child seat and an airport delivery with it
    // would be a different, more expensive offer than the client agreed.
    //
    // The two discounts stack. They are capped jointly below so the taxable
    // base can reach zero but never go negative.
    let coupon: PriceQuote['coupon'];

    if (request.couponCode?.trim()) {
      const discountableAfterRule = vehicleSubtotal.sub(discountAmount);

      const evaluated = await couponsService.evaluate({
        code: request.couponCode,
        // An anonymous quote cannot be checked against a per-customer limit.
        // It is re-evaluated with the real customer at booking time, which is
        // the point where consuming a use actually matters.
        customerId: request.customerId ?? '00000000-0000-0000-0000-000000000000',
        vehicleId: vehicle.id,
        categoryId: vehicle.categoryId,
        rentalDays,
        discountableAmount: discountableAfterRule,
        qualifyingAmount: vehicleSubtotal.add(servicesSubtotal).add(deliveryFee),
      });

      if (!evaluated.discountAmount.isZero()) {
        discountAmount = discountAmount.add(evaluated.discountAmount);
        lineItems.push({
          key: `coupon:${evaluated.coupon.code}`,
          label: evaluated.label,
          amount: `-${money(evaluated.discountAmount)}`,
          detail: `Promo code ${evaluated.coupon.code}`,
        });
      }

      coupon = {
        code: evaluated.coupon.code,
        label: evaluated.label,
        discountAmount: money(evaluated.discountAmount),
      };
    }

    // --- 6 and 7. Tax ----------------------------------------------------
    const grossBeforeDiscount = vehicleSubtotal.add(servicesSubtotal).add(deliveryFee);
    if (discountAmount.greaterThan(grossBeforeDiscount)) {
      // Reachable when a long-term rule and a fixed-amount code stack past the
      // bill. Free is the floor; a negative invoice is not a thing.
      discountAmount = grossBeforeDiscount;
    }

    const taxableAmount = vehicleSubtotal
      .add(servicesSubtotal)
      .add(deliveryFee)
      .sub(discountAmount);

    let taxAmount = ZERO;
    const vatPercentage = await settingsService.getNumber(SettingKey.VAT_PERCENTAGE);

    if (vatPercentage === null) {
      // NOT defaulted to 5%. BRD 38 forbids inventing a tax rate, and an
      // invoice carrying a rate nobody approved is a compliance problem, not a
      // rounding detail.
      warnings.push(
        'VAT is not configured, so no tax has been applied. Set pricing.vat_percentage in Settings.',
      );
    } else if (vatPercentage > 0) {
      taxAmount = applyPercentage(taxableAmount, new Prisma.Decimal(vatPercentage));
      lineItems.push({
        key: 'vat',
        label: `VAT (${vatPercentage}%)`,
        amount: money(taxAmount),
      });
    }

    // --- 8. Totals -------------------------------------------------------
    const rentalTotal = taxableAmount.add(taxAmount);
    const securityDeposit = vehicle.securityDeposit;
    const currency = (await settingsService.getString(SettingKey.CURRENCY)) ?? 'AED';

    return {
      currency,
      period: {
        pickupAt: request.pickupAt.toISOString(),
        returnAt: request.returnAt.toISOString(),
        rentalDays,
        durationHours: Math.round(durationHours * 100) / 100,
        dayCountingRule: DAY_COUNTING_RULE,
      },
      rateBreakdown: rate.blocks.map((block) => ({
        tier: block.tier,
        quantity: block.quantity,
        unitPrice: money(block.unitPrice),
        subtotal: money(block.subtotal),
      })),
      lineItems,
      coupon,
      totals: {
        vehicleSubtotal: money(vehicleSubtotal),
        servicesSubtotal: money(servicesSubtotal),
        deliveryFee: money(deliveryFee),
        discountAmount: money(discountAmount),
        taxableAmount: money(taxableAmount),
        taxAmount: money(taxAmount),
        rentalTotal: money(rentalTotal),
        securityDeposit: money(securityDeposit),
        totalPayable: money(rentalTotal.add(securityDeposit)),
      },
      warnings,
    };
  },
};
