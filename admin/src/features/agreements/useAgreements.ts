/**
 * features/agreements/useAgreements.ts
 * ---------------------------------------------------------------------------
 * The rental agreement, from the staff side.
 *
 * `useBookingAgreement` resolves to `null` rather than erroring when a booking
 * has no agreement yet - that is the normal state of every new booking, not a
 * failure, and treating it as one would put a red box on half the screens in
 * the app.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getData, postData } from '../../services/api';
import type { NormalisedApiError } from '../../types/api';

export interface RentalAgreement {
  id: string;
  agreementNumber: string;
  bookingId: string;
  bookingNumber: string | null;
  status: 'DRAFT' | 'ISSUED' | 'SIGNED' | 'VOID';

  customerName: string;
  customerEmail: string;
  vehicleDescription: string;
  registrationNumber: string;

  pickupAt: string;
  returnAt: string;
  rentalDays: number;

  totalAmount: string;
  securityDeposit: string;
  currency: string;

  mileageLimitPerDay: number | null;
  excessAmount: string | null;

  customerSignedName: string | null;
  customerSignedAt: string | null;
  staffSignedName: string | null;
  staffSignedAt: string | null;

  voidReason: string | null;
  voidedAt: string | null;
  issuedAt: string;
}

const key = (bookingId: string) => ['agreement', bookingId] as const;

export function useBookingAgreement(bookingId: string | undefined) {
  return useQuery<RentalAgreement | null, NormalisedApiError>({
    queryKey: key(bookingId ?? ''),
    queryFn: () => getData<RentalAgreement | null>(`/agreements/booking/${bookingId}`),
    enabled: Boolean(bookingId),
  });
}

export function useIssueAgreement(bookingId: string) {
  const queryClient = useQueryClient();
  return useMutation<RentalAgreement, NormalisedApiError, void>({
    mutationFn: () => postData<RentalAgreement>('/agreements', { bookingId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key(bookingId) }),
  });
}

export function useSignAgreement(bookingId: string) {
  const queryClient = useQueryClient();
  return useMutation<
    RentalAgreement,
    NormalisedApiError,
    { id: string; signedName: string; as: 'customer' | 'company' }
  >({
    mutationFn: ({ id, signedName, as }) =>
      postData<RentalAgreement>(
        `/agreements/${id}/${as === 'customer' ? 'sign' : 'countersign'}`,
        { signedName },
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key(bookingId) }),
  });
}

export function useVoidAgreement(bookingId: string) {
  const queryClient = useQueryClient();
  return useMutation<RentalAgreement, NormalisedApiError, { id: string; reason: string }>({
    mutationFn: ({ id, reason }) => postData<RentalAgreement>(`/agreements/${id}/void`, { reason }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key(bookingId) }),
  });
}
