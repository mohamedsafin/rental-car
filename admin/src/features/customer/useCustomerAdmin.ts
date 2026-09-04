/**
 * features/customer/useCustomerAdmin.ts
 * ---------------------------------------------------------------------------
 * Staff-side customer and document-review hooks.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { customerService } from '../../services/customer.service';
import type { NormalisedApiError, PaginatedData } from '../../types/api';
import type { CustomerDocument, CustomerListItem, VerificationSummary } from '../../types/customer';

export interface CustomerFilters {
  page?: number;
  limit?: number;
  search?: string;
  pendingDocuments?: boolean;
}

export function useCustomers(filters: CustomerFilters) {
  return useQuery<PaginatedData<CustomerListItem>, NormalisedApiError>({
    queryKey: ['customers', filters],
    queryFn: () => customerService.listCustomers(filters as Record<string, unknown>),
    placeholderData: (previous) => previous,
  });
}

export function useCustomer(id: string | undefined) {
  return useQuery<
    { customer: CustomerListItem; verification: VerificationSummary; documents: CustomerDocument[] },
    NormalisedApiError
  >({
    queryKey: ['customer', id],
    queryFn: () => customerService.getCustomer(id as string),
    enabled: Boolean(id),
  });
}

export function useReviewDocument() {
  const queryClient = useQueryClient();

  return useMutation<
    { document: CustomerDocument },
    NormalisedApiError,
    { id: string; status: 'APPROVED' | 'REJECTED'; rejectionReason?: string }
  >({
    mutationFn: ({ id, status, rejectionReason }) =>
      customerService.reviewDocument(id, { status, rejectionReason }),
    onSuccess: () => {
      // A review can flip the customer's verified flag, so the list and the
      // detail view both go stale.
      void queryClient.invalidateQueries({ queryKey: ['customer'] });
      void queryClient.invalidateQueries({ queryKey: ['customers'] });
    },
  });
}
