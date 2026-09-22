/**
 * features/accidents/useAccidents.ts
 * ---------------------------------------------------------------------------
 * Accidents and insurance claims.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getData, patchData, postData } from '../../services/api';
import type { NormalisedApiError, PaginatedData } from '../../types/api';

export type AccidentStatus =
  | 'REPORTED'
  | 'CLAIM_SUBMITTED'
  | 'ASSESSED'
  | 'IN_REPAIR'
  | 'COMPLETED'
  | 'CLOSED';

export interface Accident {
  id: string;
  reference: string;
  status: AccidentStatus;

  vehicleId: string;
  vehicle: { name: string; registrationNumber: string } | null;
  bookingId: string | null;
  bookingNumber: string | null;
  customerName: string | null;

  occurredAt: string;
  location: string | null;
  description: string;

  policeReportNumber: string | null;
  policeReportDate: string | null;

  insurerName: string | null;
  policyNumber: string | null;
  claimNumber: string | null;
  claimSubmittedAt: string | null;
  claimSettledAt: string | null;
  claimPaidAmount: string | null;

  excessAmount: string | null;
  customerLiability: string | null;

  garageName: string | null;
  repairEstimate: string | null;
  repairCost: string | null;
  currency: string;

  offRoadFrom: string | null;
  offRoadUntil: string | null;
  offRoadDays: number | null;

  notes: string | null;
}

export function useAccidents(filters: { page: number; limit: number; status?: string }) {
  return useQuery<PaginatedData<Accident>, NormalisedApiError>({
    queryKey: ['accidents', filters],
    queryFn: () => getData<PaginatedData<Accident>>('/accidents', filters as Record<string, unknown>),
    placeholderData: (previous) => previous,
  });
}

export function useReportAccident() {
  const queryClient = useQueryClient();
  return useMutation<{ accident: Accident }, NormalisedApiError, Record<string, unknown>>({
    mutationFn: (payload) => postData<{ accident: Accident }>('/accidents', payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['accidents'] }),
  });
}

export function useUpdateAccident() {
  const queryClient = useQueryClient();
  return useMutation<
    { accident: Accident },
    NormalisedApiError,
    { id: string; changes: Record<string, unknown> }
  >({
    mutationFn: ({ id, changes }) => patchData<{ accident: Accident }>(`/accidents/${id}`, changes),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['accidents'] }),
  });
}
