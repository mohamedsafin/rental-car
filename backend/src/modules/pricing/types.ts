/**
 * modules/pricing/types.ts
 * ---------------------------------------------------------------------------
 * The quote shape (BRD 15) and the rules for producing it.
 *
 * ===========================================================================
 * DAY COUNTING
 * ===========================================================================
 * Rental days are billed as 24-hour periods, and ANY part of a period counts
 * as a whole one. Pick up Monday 10:00, return Tuesday 11:00 -> 2 days.
 *
 * This is the near-universal rental convention, but the BRD does not state it,
 * so it is written down here and surfaced in the quote as `dayCountingRule`
 * for the client to confirm. It is not silently assumed.
 *
 * ===========================================================================
 * TIER SELECTION
 * ===========================================================================
 * A 10-day rental is NOT 10 x daily. It is decomposed into the cheapest
 * combination of the monthly, weekly and daily rates the vehicle offers:
 *
 *   10 days = 1 week + 3 days   (if a weekly rate exists and that is cheaper)
 *
 * We compute every sensible decomposition and take the lowest. Charging a
 * customer 10 daily rates when a weekly rate would have been cheaper is the
 * kind of quiet overcharge that generates chargebacks.
 *
 * ===========================================================================
 * MONEY
 * ===========================================================================
 * Every amount is a Prisma.Decimal internally and a fixed 2-decimal STRING on
 * the way out. No stage of this engine uses a JavaScript number for money.
 */
import type { Prisma } from '@prisma/client';

export interface QuoteLineItem {
  /** Machine key, e.g. 'vehicle_rental', 'service:child-seat', 'vat'. */
  key: string;
  label: string;
  /** Signed: negative for discounts. */
  amount: string;
  detail?: string;
}

export interface PriceQuote {
  currency: string;

  period: {
    pickupAt: string;
    returnAt: string;
    /** Billable 24-hour periods, rounded up. */
    rentalDays: number;
    /** Exact duration, so the UI can show "5 days 2 hours". */
    durationHours: number;
    dayCountingRule: string;
  };

  /** How the rental total was reached - weeks + days, or a flat month. */
  rateBreakdown: {
    tier: string;
    quantity: number;
    unitPrice: string;
    subtotal: string;
  }[];

  lineItems: QuoteLineItem[];

  totals: {
    vehicleSubtotal: string;
    servicesSubtotal: string;
    deliveryFee: string;
    discountAmount: string;
    /** Base the tax is applied to: rental + services + delivery - discount. */
    taxableAmount: string;
    taxAmount: string;
    /** Everything payable EXCLUDING the refundable deposit. */
    rentalTotal: string;
    /** Held, not earned. Shown separately per BRD 15 and 20. */
    securityDeposit: string;
    /** What actually leaves the customer's card today. */
    totalPayable: string;
  };

  /**
   * Anything the client has not yet configured, surfaced rather than guessed.
   * e.g. "VAT is not configured, so no tax has been applied."
   */
  warnings: string[];
}

export interface SelectedService {
  serviceId: string;
  quantity: number;
}

export interface QuoteRequest {
  vehicleId: string;
  pickupAt: Date;
  returnAt: Date;
  services?: SelectedService[];
  pickupLocationId?: string;
  dropoffLocationId?: string;
}

/** Internal accumulator; converted to strings only at the very end. */
export interface QuoteWorkings {
  vehicleSubtotal: Prisma.Decimal;
  servicesSubtotal: Prisma.Decimal;
  deliveryFee: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  securityDeposit: Prisma.Decimal;
}
