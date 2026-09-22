/**
 * features/finance/useFinance.ts
 * ---------------------------------------------------------------------------
 * Money across every booking, rather than one booking at a time.
 *
 * Both of these lists existed on the server and had no screen. The sidebar
 * said "Payments - see a booking" and "Deposits - see a booking", which is a
 * navigation item apologising for itself: answering "what came in today" or
 * "whose deposit are we still holding" meant opening bookings one by one until
 * you had counted them yourself.
 */
import { useQuery } from '@tanstack/react-query';
import { getData } from '../../services/api';
import type { NormalisedApiError, PaginatedData } from '../../types/api';

export interface PaymentRow {
  id: string;
  bookingId: string;
  bookingNumber: string;
  customerName: string;
  customerEmail: string;
  type: 'RENTAL' | 'SECURITY_DEPOSIT' | 'ADDITIONAL_CHARGE' | 'EXTENSION';
  status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'REFUNDED' | 'PARTIALLY_REFUNDED';
  amount: string;
  currency: string;
  provider: string;
  reference: string | null;
  failureReason: string | null;
  /** Which month of a long-term rental this settled, if any. */
  instalmentSequence: number | null;
  refundedTotal: string;
  paidAt: string | null;
  createdAt: string;
}

export interface DepositRow {
  id: string;
  bookingId: string;
  bookingNumber: string;
  customerName: string;
  currency: string;
  status: 'PENDING' | 'HELD' | 'PARTIALLY_RELEASED' | 'RELEASED' | 'FORFEITED';
  amount: string;
  held: string;
  deducted: string;
  released: string;
  balance: string;
}

export function usePayments(filters: {
  page: number;
  limit: number;
  status?: string;
  type?: string;
  search?: string;
}) {
  return useQuery<PaginatedData<PaymentRow>, NormalisedApiError>({
    queryKey: ['payments', filters],
    queryFn: () => getData<PaginatedData<PaymentRow>>('/payments', filters as Record<string, unknown>),
    // Keeps the table on screen while a filter change loads, instead of
    // collapsing to a spinner and jumping the page.
    placeholderData: (previous) => previous,
  });
}

export function useDeposits(filters: { page: number; limit: number; status?: string }) {
  return useQuery<PaginatedData<DepositRow>, NormalisedApiError>({
    queryKey: ['deposits-list', filters],
    queryFn: () => getData<PaginatedData<DepositRow>>('/deposits', filters as Record<string, unknown>),
    placeholderData: (previous) => previous,
  });
}
