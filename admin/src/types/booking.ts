/**
 * types/booking.ts
 * ---------------------------------------------------------------------------
 * Booking contracts.
 *
 * All money is the SNAPSHOT the backend stored at booking time, as a string.
 * Display it; never recompute it. If a customer's booking says AED 1050.00,
 * that is what they agreed to, regardless of what the live price would be now.
 */

export type BookingStatus =
  | 'PENDING'
  | 'PAYMENT_PENDING'
  | 'DOCUMENT_VERIFICATION'
  | 'CONFIRMED'
  | 'READY_FOR_PICKUP'
  | 'ACTIVE'
  | 'EXTENSION_REQUESTED'
  | 'RETURN_PENDING'
  | 'RETURNED'
  | 'COMPLETED'
  | 'CANCELLED';

export interface BookingServiceLine {
  id: string;
  name: string;
  quantity: number;
  unitPrice: string;
  chargeType: 'PER_BOOKING' | 'PER_DAY';
  lineTotal: string;
}

export interface Booking {
  id: string;
  bookingNumber: string;
  status: BookingStatus;
  statusLabel: string;

  vehicle: {
    id: string;
    name: string;
    year: number;
    category: string;
    /** Null on the customer view - internal fleet data. */
    registrationNumber: string | null;
    /** Null on the customer view. Staff use it as the handover baseline. */
    currentMileage: number | null;
    imageUrl: string | null;
  };

  /** Null on the customer view; present for staff. */
  customer: { id: string; fullName: string; email: string; phone: string | null } | null;

  period: { pickupAt: string; returnAt: string; rentalDays: number };

  /** How this booking is being paid for. Fixed at checkout. */
  paymentMethod: 'ONLINE' | 'CASH_ON_PICKUP';
  /**
   * Whether a rental payment has actually cleared.
   *
   * No status implies this any more - CONFIRMED means the documents passed,
   * not that money arrived - so anything gated on payment must read this.
   */
  rentalPaid: boolean;

  /** UPFRONT, or MONTHLY for a long-term rental billed month by month. */
  billingCycle: 'UPFRONT' | 'MONTHLY';
  termMonths: number | null;
  /** One row per month of the term. Empty on an upfront booking. */
  instalments: {
    id: string;
    sequence: number;
    periodStart: string;
    periodEnd: string;
    dueAt: string;
    /** The rent. Fixed for the whole term. */
    amount: string;
    /** Salik, fines and anything else billed with this month. Usually '0.00'. */
    extrasAmount: string;
    /** Rent + extras: what paying this month will actually charge. */
    totalDue: string;
    currency: string;
    status: string;
    paidAt: string | null;
  }[];


  /** Fines, Salik, fuel, cleaning, late return, damage. */
  additionalCharges: {
    id: string;
    type: string;
    amount: string;
    currency: string;
    description: string | null;
    status: string;
    at: string;
    /** Set when it was billed with a month of a long-term rental. */
    instalmentId: string | null;
  }[];
  locations: {
    pickup: { id: string; name: string } | null;
    dropoff: { id: string; name: string } | null;
  };
  services: BookingServiceLine[];

  pricing: {
    currency: string;
    vehicleSubtotal: string;
    servicesSubtotal: string;
    deliveryFee: string;
    discountAmount: string;
    taxAmount: string;
    totalAmount: string;
    securityDeposit: string;
    totalPayable: string;
  };

  cancellation: {
    cancelledAt: string;
    reason: string | null;
    fee: string;
    refundDue: string;
  } | null;

  holdExpiresAt: string | null;
  customerNotes: string | null;
  staffNotes: string | null;
  statusHistory: { from: BookingStatus | null; to: BookingStatus; reason: string | null; at: string }[];
  createdAt: string;
}

/** Colour per status, shared by both apps so a badge means the same thing. */
export const BOOKING_STATUS_STYLE: Record<BookingStatus, string> = {
  PENDING: 'bg-slate-100 text-slate-700',
  DOCUMENT_VERIFICATION: 'bg-amber-100 text-amber-800',
  PAYMENT_PENDING: 'bg-amber-100 text-amber-800',
  CONFIRMED: 'bg-emerald-100 text-emerald-800',
  READY_FOR_PICKUP: 'bg-sky-100 text-sky-800',
  ACTIVE: 'bg-blue-100 text-blue-800',
  EXTENSION_REQUESTED: 'bg-purple-100 text-purple-800',
  RETURN_PENDING: 'bg-orange-100 text-orange-800',
  RETURNED: 'bg-teal-100 text-teal-800',
  COMPLETED: 'bg-slate-200 text-slate-700',
  CANCELLED: 'bg-red-100 text-red-800',
};

/** What each status means to a customer, in plain words. */
export const BOOKING_STATUS_HELP: Record<BookingStatus, string> = {
  PENDING: 'We have received your booking.',
  DOCUMENT_VERIFICATION: 'We are checking your documents. Upload anything still outstanding.',
  CONFIRMED: 'Documents approved and the car is held. Payment is the next step.',
  PAYMENT_PENDING: 'Waiting for the payment to clear.',
  READY_FOR_PICKUP: 'Your vehicle is ready for collection.',
  ACTIVE: 'Your rental is under way.',
  EXTENSION_REQUESTED: 'We are reviewing your extension request.',
  RETURN_PENDING: 'Awaiting return of the vehicle.',
  RETURNED: 'Vehicle returned. We are finalising the charges.',
  COMPLETED: 'This rental is complete.',
  CANCELLED: 'This booking was cancelled.',
};
