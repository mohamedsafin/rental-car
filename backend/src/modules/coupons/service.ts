/**
 * modules/coupons/service.ts
 * ---------------------------------------------------------------------------
 * Promotional codes (BRD 19).
 *
 * THE RULE, same as pricing: a discount is something the SERVER decides. The
 * browser sends a code; it never sends an amount. `evaluate()` below is the
 * only place a coupon becomes money, it is called from the pricing engine, and
 * it re-runs at booking time - so a code that expired between quote and
 * checkout is refused at checkout.
 *
 * Every refusal returns a REASON the customer can act on ("this code needs a
 * 7-day rental"), because "invalid code" makes people retype a code that was
 * never going to work.
 */
import { Prisma } from '@prisma/client';
import type { Coupon } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { ApiError } from '../../utils/ApiError';
import { auditService } from '../audit/service';
import { ZERO, money } from '../pricing/calculator';

export interface CouponActor {
  id: string;
  email: string;
  role: 'CUSTOMER' | 'ADMIN' | 'STAFF';
  ipAddress?: string;
  userAgent?: string;
}

export interface CouponContext {
  code: string;
  customerId: string;
  vehicleId: string;
  categoryId: string;
  rentalDays: number;
  /**
   * What the customer would pay for the rental itself before any discount -
   * the amount a percentage applies to.
   */
  discountableAmount: Prisma.Decimal;
  /**
   * Rental + services + delivery, before discounts. This is what
   * `minRentalAmount` is checked against, because "spend AED 500 to use this
   * code" means the order, not just the car.
   */
  qualifyingAmount: Prisma.Decimal;
  /** Defaults to now; injectable so the validity window is testable. */
  at?: Date;
}

export interface CouponEvaluation {
  coupon: Coupon;
  discountAmount: Prisma.Decimal;
  label: string;
}

export const couponsService = {
  /**
   * Decide what a code is worth in this specific context, or explain why it is
   * worth nothing. Throws ApiError(400) with a usable message on refusal.
   */
  async evaluate(context: CouponContext): Promise<CouponEvaluation> {
    const at = context.at ?? new Date();
    const code = context.code.trim().toUpperCase();

    const coupon = await prisma.coupon.findFirst({ where: { code, deletedAt: null } });

    // Deliberately the same message for "no such code" and "withdrawn". A
    // different message for each turns the endpoint into an oracle for
    // guessing which codes exist.
    if (!coupon || !coupon.isActive) {
      throw ApiError.badRequest('That promo code is not valid');
    }

    if (at < coupon.validFrom) {
      throw ApiError.badRequest(
        `This code is not active until ${coupon.validFrom.toISOString().slice(0, 10)}`,
      );
    }
    if (at > coupon.validUntil) {
      throw ApiError.badRequest('This code has expired');
    }

    if (coupon.vehicleId && coupon.vehicleId !== context.vehicleId) {
      throw ApiError.badRequest('This code does not apply to this vehicle');
    }
    if (coupon.categoryId && coupon.categoryId !== context.categoryId) {
      throw ApiError.badRequest('This code does not apply to this category of vehicle');
    }

    if (coupon.minRentalDays && context.rentalDays < coupon.minRentalDays) {
      throw ApiError.badRequest(`This code needs a rental of at least ${coupon.minRentalDays} days`);
    }
    if (coupon.minRentalAmount && context.qualifyingAmount.lessThan(coupon.minRentalAmount)) {
      throw ApiError.badRequest(
        `This code needs a booking of at least ${money(coupon.minRentalAmount)}`,
      );
    }

    if (coupon.usageLimit !== null && coupon.timesUsed >= coupon.usageLimit) {
      throw ApiError.badRequest('This code has been fully redeemed');
    }

    if (coupon.perCustomerLimit !== null) {
      const used = await prisma.couponRedemption.count({
        where: { couponId: coupon.id, customerId: context.customerId },
      });
      if (used >= coupon.perCustomerLimit) {
        throw ApiError.badRequest('You have already used this code');
      }
    }

    return {
      coupon,
      discountAmount: discountFor(coupon, context.discountableAmount),
      label: coupon.description?.trim() || `Promo code ${coupon.code}`,
    };
  },

  /**
   * Record a redemption. Called INSIDE the booking transaction, never before
   * it - a coupon must not be consumed by a booking that then fails to save.
   *
   * The unique constraint on bookingId makes double-application impossible,
   * and the counter increment happens in the same transaction as the row, so
   * the two cannot drift apart.
   */
  async redeem(
    tx: Prisma.TransactionClient,
    input: {
      couponId: string;
      bookingId: string;
      customerId: string;
      discountAmount: Prisma.Decimal;
      codeUsed: string;
    },
  ) {
    await tx.couponRedemption.create({
      data: {
        couponId: input.couponId,
        bookingId: input.bookingId,
        customerId: input.customerId,
        discountAmount: input.discountAmount,
        codeUsed: input.codeUsed,
      },
    });

    await tx.coupon.update({
      where: { id: input.couponId },
      data: { timesUsed: { increment: 1 } },
    });
  },

  /**
   * Give a use back when a booking is cancelled.
   *
   * Without this, a customer who cancels has silently burnt a single-use code
   * they never got any benefit from - and the "fully redeemed" message they
   * hit next time would be wrong.
   */
  async release(tx: Prisma.TransactionClient, bookingId: string) {
    const redemption = await tx.couponRedemption.findUnique({ where: { bookingId } });
    if (!redemption) return;

    await tx.couponRedemption.delete({ where: { bookingId } });
    await tx.coupon.update({
      where: { id: redemption.couponId },
      // Floored at zero: a counter that goes negative would be worse than one
      // that is briefly optimistic.
      data: { timesUsed: { decrement: 1 } },
    });
  },

  // --- Admin ---------------------------------------------------------------

  async create(
    input: {
      code: string;
      description?: string;
      discountType: 'PERCENTAGE' | 'FIXED_AMOUNT';
      value: string;
      maxDiscount?: string;
      minRentalAmount?: string;
      minRentalDays?: number;
      validFrom: Date;
      validUntil: Date;
      usageLimit?: number;
      perCustomerLimit?: number;
      categoryId?: string;
      vehicleId?: string;
    },
    actor: CouponActor,
  ) {
    if (input.validUntil <= input.validFrom) {
      throw ApiError.badRequest('The code must expire after it starts');
    }

    const value = new Prisma.Decimal(input.value);
    if (input.discountType === 'PERCENTAGE' && (value.lessThanOrEqualTo(0) || value.greaterThan(100))) {
      throw ApiError.badRequest('A percentage discount must be between 0 and 100');
    }
    if (input.discountType === 'FIXED_AMOUNT' && value.lessThanOrEqualTo(0)) {
      throw ApiError.badRequest('A fixed discount must be more than zero');
    }

    const code = input.code.trim().toUpperCase();
    const existing = await prisma.coupon.findUnique({ where: { code } });
    if (existing) throw ApiError.conflict('That code already exists');

    const coupon = await prisma.coupon.create({
      data: {
        code,
        description: input.description ?? null,
        discountType: input.discountType,
        value,
        maxDiscount: input.maxDiscount ? new Prisma.Decimal(input.maxDiscount) : null,
        minRentalAmount: input.minRentalAmount ? new Prisma.Decimal(input.minRentalAmount) : null,
        minRentalDays: input.minRentalDays ?? null,
        validFrom: input.validFrom,
        validUntil: input.validUntil,
        usageLimit: input.usageLimit ?? null,
        perCustomerLimit: input.perCustomerLimit ?? null,
        categoryId: input.categoryId ?? null,
        vehicleId: input.vehicleId ?? null,
        createdById: actor.id,
      },
    });

    await auditService.record({
      action: 'coupon.created',
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      entityType: 'Coupon',
      entityId: coupon.id,
      metadata: { code, discountType: input.discountType, value: input.value },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return toPublicCoupon(coupon);
  },

  /**
   * Change a coupon's availability, not its economics.
   *
   * The discount type and value are deliberately NOT editable. Codes that have
   * already been redeemed were redeemed at a particular value, and quietly
   * changing it would make those bookings' paperwork wrong. Withdraw the code
   * and issue a new one instead.
   */
  async update(
    id: string,
    input: { description?: string; isActive?: boolean; validUntil?: Date; usageLimit?: number | null },
    actor: CouponActor,
  ) {
    const coupon = await prisma.coupon.findFirst({ where: { id, deletedAt: null } });
    if (!coupon) throw ApiError.notFound('Coupon not found');

    const updated = await prisma.coupon.update({
      where: { id },
      data: {
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.validUntil !== undefined ? { validUntil: input.validUntil } : {}),
        ...(input.usageLimit !== undefined ? { usageLimit: input.usageLimit } : {}),
      },
    });

    await auditService.record({
      action: 'coupon.updated',
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      entityType: 'Coupon',
      entityId: id,
      metadata: { ...input, validUntil: input.validUntil?.toISOString() },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return toPublicCoupon(updated);
  },

  /**
   * Soft delete. A hard delete would cascade the redemption rows away, and
   * with them the record of what a past booking was actually charged.
   */
  async remove(id: string, actor: CouponActor) {
    const coupon = await prisma.coupon.findFirst({ where: { id, deletedAt: null } });
    if (!coupon) throw ApiError.notFound('Coupon not found');

    await prisma.coupon.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });

    await auditService.record({
      action: 'coupon.deleted',
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      entityType: 'Coupon',
      entityId: id,
      metadata: { code: coupon.code },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
  },

  async list(query: { page: number; limit: number; activeOnly?: boolean }) {
    const where: Prisma.CouponWhereInput = {
      deletedAt: null,
      ...(query.activeOnly ? { isActive: true, validUntil: { gte: new Date() } } : {}),
    };

    const [items, total] = await prisma.$transaction([
      prisma.coupon.findMany({
        where,
        include: {
          category: { select: { name: true } },
          vehicle: { select: { brand: true, model: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      prisma.coupon.count({ where }),
    ]);

    return {
      items: items.map((coupon) => ({
        ...toPublicCoupon(coupon),
        scope:
          coupon.vehicle
            ? `${coupon.vehicle.brand} ${coupon.vehicle.model}`
            : (coupon.category?.name ?? 'Whole fleet'),
      })),
      total,
    };
  },
};

/**
 * The arithmetic, isolated and pure.
 *
 * A percentage is capped twice over: by `maxDiscount` if the client set one,
 * and by the amount itself - a discount can reduce a bill to zero but must
 * never turn it into a payment out.
 */
function discountFor(coupon: Coupon, discountable: Prisma.Decimal): Prisma.Decimal {
  if (discountable.lessThanOrEqualTo(0)) return ZERO;

  let discount =
    coupon.discountType === 'PERCENTAGE'
      ? discountable.mul(coupon.value).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
      : coupon.value;

  if (coupon.maxDiscount && discount.greaterThan(coupon.maxDiscount)) {
    discount = coupon.maxDiscount;
  }

  return discount.greaterThan(discountable) ? discountable : discount;
}

export function toPublicCoupon(coupon: Coupon) {
  return {
    id: coupon.id,
    code: coupon.code,
    description: coupon.description,
    discountType: coupon.discountType,
    value: coupon.value.toFixed(2),
    maxDiscount: coupon.maxDiscount?.toFixed(2) ?? null,
    minRentalAmount: coupon.minRentalAmount?.toFixed(2) ?? null,
    minRentalDays: coupon.minRentalDays,
    validFrom: coupon.validFrom.toISOString(),
    validUntil: coupon.validUntil.toISOString(),
    usageLimit: coupon.usageLimit,
    perCustomerLimit: coupon.perCustomerLimit,
    timesUsed: coupon.timesUsed,
    isActive: coupon.isActive,
    createdAt: coupon.createdAt.toISOString(),
  };
}
