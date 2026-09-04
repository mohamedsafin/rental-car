/**
 * types/payment.ts
 * ---------------------------------------------------------------------------
 * Payment, refund and deposit contracts.
 *
 * There is no card data here, and there never will be. The customer enters
 * their card on the PROVIDER's page; this app only ever sees references and
 * amounts (BRD 19 and 46).
 */

export type PaymentType = 'RENTAL' | 'SECURITY_DEPOSIT' | 'ADDITIONAL_CHARGE' | 'EXTENSION';
export type PaymentStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'REFUNDED' | 'PARTIALLY_REFUNDED';
export type RefundStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
export type DepositStatus = 'PENDING' | 'HELD' | 'PARTIALLY_RELEASED' | 'RELEASED' | 'FORFEITED';

export type DeductionCategory =
  | 'DAMAGE'
  | 'TRAFFIC_FINE'
  | 'TOLL'
  | 'FUEL'
  | 'CLEANING'
  | 'LATE_RETURN'
  | 'OTHER';

export interface RefundRecord {
  id: string;
  amount: string;
  status: RefundStatus;
  reason: string | null;
  completedAt: string | null;
}

export interface PaymentRecord {
  id: string;
  type: PaymentType;
  status: PaymentStatus;
  amount: string;
  currency: string;
  provider: string;
  reference: string | null;
  failureReason: string | null;
  paidAt: string | null;
  createdAt: string;
  refunds: RefundRecord[];
}

export interface DepositTransactionRecord {
  id: string;
  type: 'HOLD' | 'DEDUCTION' | 'RELEASE';
  amount: string;
  category: string | null;
  reason: string | null;
  createdAt: string;
}

export interface DepositSummary {
  id: string;
  bookingId: string;
  bookingNumber: string;
  currency: string;
  status: DepositStatus;
  amount: string;
  held: string;
  deducted: string;
  released: string;
  /** Derived from the ledger, never a stored figure. */
  balance: string;
  heldAt: string | null;
  settledAt: string | null;
  transactions: DepositTransactionRecord[];
}

export const PAYMENT_STATUS_STYLE: Record<PaymentStatus, string> = {
  PENDING: 'bg-amber-100 text-amber-800',
  SUCCESS: 'bg-emerald-100 text-emerald-800',
  FAILED: 'bg-red-100 text-red-800',
  REFUNDED: 'bg-slate-200 text-slate-700',
  PARTIALLY_REFUNDED: 'bg-sky-100 text-sky-800',
};

export const DEPOSIT_STATUS_STYLE: Record<DepositStatus, string> = {
  PENDING: 'bg-slate-100 text-slate-700',
  HELD: 'bg-blue-100 text-blue-800',
  PARTIALLY_RELEASED: 'bg-sky-100 text-sky-800',
  RELEASED: 'bg-emerald-100 text-emerald-800',
  FORFEITED: 'bg-red-100 text-red-800',
};

export const DEDUCTION_LABELS: Record<DeductionCategory, string> = {
  DAMAGE: 'Vehicle damage',
  TRAFFIC_FINE: 'Traffic fine',
  TOLL: 'Toll / Salik',
  FUEL: 'Fuel',
  CLEANING: 'Cleaning',
  LATE_RETURN: 'Late return',
  OTHER: 'Other approved charge',
};
