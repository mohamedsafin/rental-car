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
  PAYMENT_PENDING: 'Your documents are approved. Payment is the next step.',
  CONFIRMED: 'Your booking is confirmed. We are preparing your vehicle.',
  READY_FOR_PICKUP: 'Your vehicle is ready for collection.',
  ACTIVE: 'Your rental is under way.',
  EXTENSION_REQUESTED: 'We are reviewing your extension request.',
  RETURN_PENDING: 'Awaiting return of the vehicle.',
  RETURNED: 'Vehicle returned. We are finalising the charges.',
  COMPLETED: 'This rental is complete.',
  CANCELLED: 'This booking was cancelled.',
};
