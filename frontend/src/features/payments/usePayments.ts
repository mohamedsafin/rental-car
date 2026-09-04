/**
 * features/payments/usePayments.ts
 * ---------------------------------------------------------------------------
 * Payment and deposit hooks.
 *
 * `usePayments` polls while a payment is PENDING. That is deliberate: the
 * customer is redirected to the provider and comes back, and the webhook that
 * actually confirms the payment may land a second or two after they return.
 * Polling is how the page learns the truth from the SERVER rather than
 * assuming success because the browser came back.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { paymentsService } from '../../services/payments.service';
import type { NormalisedApiError } from '../../types/api';
import type { DepositSummary, PaymentRecord, PaymentType } from '../../types/payment';

export function usePayments(bookingId: string | undefined) {
  return useQuery<{ payments: PaymentRecord[] }, NormalisedApiError>({
    queryKey: ['payments', bookingId],
    queryFn: () => paymentsService.listForBooking(bookingId as string),
    enabled: Boolean(bookingId),
    // Poll only while something is still in flight; stop once it settles.
    refetchInterval: (query) =>
      query.state.data?.payments.some((payment) => payment.status === 'PENDING') ? 4000 : false,
  });
}

export function useDeposit(bookingId: string | undefined) {
  return useQuery<{ deposit: DepositSummary | null }, NormalisedApiError>({
    queryKey: ['deposit', bookingId],
    queryFn: () => paymentsService.getDeposit(bookingId as string),
    enabled: Boolean(bookingId),
  });
}

export function useInitiatePayment() {
  const queryClient = useQueryClient();

  return useMutation<
    { paymentId: string; checkoutUrl: string; amount: string },
    NormalisedApiError,
    { bookingId: string; type?: PaymentType }
  >({
    mutationFn: ({ bookingId, type }) => paymentsService.initiate(bookingId, type),
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['payments', variables.bookingId] });
    },
  });
}
