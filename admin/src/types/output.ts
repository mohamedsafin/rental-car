/**
 * types/output.ts
 * ---------------------------------------------------------------------------
 * Shapes returned by the Phase 10 endpoints.
 *
 * Money is a STRING throughout, as everywhere else in this app: the backend
 * serialises Decimal(10,2) as a fixed two-decimal string so it never passes
 * through a float, and mirroring that here stops anyone doing arithmetic on it
 * in a component.
 *
 * Note `bookedValue` and `grossRevenue` are deliberately different fields with
 * different names. One is what customers agreed to pay; the other is what
 * actually arrived. Conflating them is the single easiest way to produce a
 * report nobody can reconcile.
 */

export interface RevenueReport {
  period: { from: string; to: string };
  grossRevenue: string;
  refunds: string;
  netRevenue: string;
  paymentCount: number;
  refundCount: number;
  /** Held, not earned - reported outside every revenue figure. */
  depositsHeld: string;
  depositPaymentCount: number;
  byProvider: { provider: string; amount: string; count: number }[];
}

export interface BookingsReport {
  period: { from: string; to: string };
  totalBookings: number;
  /** Agreed value, NOT revenue. Much of it may never be paid. */
  bookedValue: string;
  discountsGiven: string;
  averageRentalDays: number;
  cancellations: number;
  cancellationRate: number;
  cancellationFees: string;
  byStatus: { status: string; count: number; value: string }[];
}

export interface FleetReportRow {
  vehicleId: string;
  vehicle: string;
  registrationNumber: string;
  category: string;
  bookings: number;
  rentedDays: number;
  maintenanceDays: number;
  availableDays: number;
  utilisation: number;
  bookedValue: string;
}

export interface FleetReport {
  period: { from: string; to: string };
  windowDays: number;
  fleetSize: number;
  fleetUtilisation: number;
  vehicles: FleetReportRow[];
}

export interface OutstandingReport {
  asOf: string;
  unrecoveredCharges: string;
  chargesByType: { type: string; amount: string; count: number }[];
  depositsHeld: string;
  depositCount: number;
  awaitingPayment: string;
  awaitingPaymentCount: number;
}

export interface DashboardReport {
  month: { from: string; to: string };
  revenue: RevenueReport;
  bookings: BookingsReport;
  outstanding: OutstandingReport;
  activeRentals: number;
  fleetSize: number;
}

export interface InvoiceLine {
  description: string;
  detail: string | null;
  quantity: string;
  unitPrice: string;
  lineTotal: string;
  isTaxable: boolean;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  type: 'INVOICE' | 'CREDIT_NOTE';
  status: 'ISSUED' | 'PAID' | 'CANCELLED';
  bookingId: string;
  bookingNumber?: string;
  customerId: string;
  company: {
    name: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
    trn: string | null;
  };
  customer: { name: string; email: string; phone: string | null; address: string | null };
  subtotal: string;
  discountTotal: string;
  taxableAmount: string;
  taxPercentage: string | null;
  taxTotal: string;
  total: string;
  currency: string;
  correctsId: string | null;
  reason: string | null;
  notes: string | null;
  issuedAt: string;
  lineItems: InvoiceLine[];
}

export interface Coupon {
  id: string;
  code: string;
  description: string | null;
  discountType: 'PERCENTAGE' | 'FIXED_AMOUNT';
  value: string;
  maxDiscount: string | null;
  minRentalAmount: string | null;
  minRentalDays: number | null;
  validFrom: string;
  validUntil: string;
  usageLimit: number | null;
  perCustomerLimit: number | null;
  timesUsed: number;
  isActive: boolean;
  createdAt: string;
  scope?: string;
}

export interface NotificationLog {
  id: string;
  channel: string;
  templateKey: string;
  to: string;
  subject: string | null;
  preview: string;
  status: 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED';
  attempts: number;
  provider: string | null;
  lastError: string | null;
  sentAt: string | null;
  createdAt: string;
}

export interface NotificationTemplate {
  id: string;
  key: string;
  channel: string;
  subject: string | null;
  body: string;
  description: string | null;
  isActive: boolean;
}

export interface LegalDocument {
  id: string;
  type:
    | 'TERMS_AND_CONDITIONS'
    | 'PRIVACY_POLICY'
    | 'RENTAL_AGREEMENT'
    | 'CANCELLATION_POLICY'
    | 'REFUND_POLICY';
  version: number;
  title: string;
  content: string;
  isPublished: boolean;
  publishedAt: string | null;
  effectiveFrom: string | null;
  updatedAt: string;
}
