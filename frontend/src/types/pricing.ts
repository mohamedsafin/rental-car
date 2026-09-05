/**
 * types/pricing.ts
 * ---------------------------------------------------------------------------
 * Quote and availability contracts.
 *
 * Every amount is a STRING, mirroring the backend. The rule for this file:
 * these values are for DISPLAY. Never parseFloat them, never add them up in
 * the browser - if you need a total, ask the API. The backend is the only
 * thing allowed to do arithmetic on money.
 */

export interface QuoteLineItem {
  key: string;
  label: string;
  /** Signed string, e.g. "3250.00" or "-487.50". */
  amount: string;
  detail?: string;
}

export interface RateBlock {
  tier: 'monthly' | 'weekly' | 'daily';
  quantity: number;
  unitPrice: string;
  subtotal: string;
}

export interface PriceQuote {
  currency: string;
  period: {
    pickupAt: string;
    returnAt: string;
    rentalDays: number;
    durationHours: number;
    dayCountingRule: string;
  };
  rateBreakdown: RateBlock[];
  lineItems: QuoteLineItem[];
  totals: {
    vehicleSubtotal: string;
    servicesSubtotal: string;
    deliveryFee: string;
    discountAmount: string;
    taxableAmount: string;
    taxAmount: string;
    rentalTotal: string;
    securityDeposit: string;
    totalPayable: string;
  };
  /** Things the client has not configured yet, e.g. VAT. Shown, not hidden. */
  /**
   * The code that was accepted, echoed back so the UI can show it as applied
   * rather than inferring success from the total having moved.
   */
  coupon?: {
    code: string;
    label: string;
    discountAmount: string;
  };

  warnings: string[];
}

export interface AvailabilityResult {
  available: boolean;
  reason?: string;
  conflicts?: {
    id: string;
    bookingNumber: string;
    pickupAt: string;
    returnAt: string;
    status: string;
  }[];
}

export interface QuoteResponse {
  quote: PriceQuote;
  availability: AvailabilityResult;
}

export interface AdditionalService {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  price: string;
  chargeType: 'PER_BOOKING' | 'PER_DAY';
  maxQuantity: number;
}

/** The six fields BRD 6 asks the search form to collect. */
export interface SearchCriteria {
  pickupDate: string;
  pickupTime: string;
  returnDate: string;
  returnTime: string;
  pickupLocationId?: string;
  dropoffLocationId?: string;
}


/** A way to pay, as offered by the server. */
export interface PaymentOption {
  value: 'ONLINE' | 'CASH_ON_PICKUP';
  label: string;
  detail: string;
  /**
   * False when the client has switched it off. The option is still described
   * so the UI can explain what is missing rather than silently hiding it.
   */
  available: boolean;
}
