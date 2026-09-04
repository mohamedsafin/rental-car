/**
 * features/rentals/useRentals.ts
 * ---------------------------------------------------------------------------
 * Pickup, return, photo, charge and extension hooks.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { rentalsService, type RentalResponse } from '../../services/rentals.service';
import type { NormalisedApiError } from '../../types/api';
import type { Extension, Rental } from '../../types/rental';

export function useRental(bookingId: string | undefined) {
  return useQuery<RentalResponse, NormalisedApiError>({
    queryKey: ['rental', bookingId],
    queryFn: () => rentalsService.getForBooking(bookingId as string),
    enabled: Boolean(bookingId),
  });
}

/**
 * Anything that touches a rental can also change the booking, the vehicle and
 * the deposit, so they are all invalidated together. Being generous here is
 * cheaper than a stale screen showing a car as RENTED after it came back.
 */
function useInvalidateRental(bookingId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['rental', bookingId] });
    void queryClient.invalidateQueries({ queryKey: ['admin-booking'] });
    void queryClient.invalidateQueries({ queryKey: ['admin-bookings'] });
    void queryClient.invalidateQueries({ queryKey: ['deposit', bookingId] });
    void queryClient.invalidateQueries({ queryKey: ['admin-vehicles'] });
  };
}

export function useRecordPickup(bookingId: string) {
  const invalidate = useInvalidateRental(bookingId);

  return useMutation<
    { rental: Rental },
    NormalisedApiError,
    {
      mileage: number;
      fuelPercent: number;
      customerVerified: boolean;
      conditionNotes?: string;
      damageNotes?: string;
      accessories?: string[];
    }
  >({
    mutationFn: (body) => rentalsService.recordPickup(bookingId, body),
    onSuccess: invalidate,
  });
}

export function useRecordReturn(bookingId: string) {
  const invalidate = useInvalidateRental(bookingId);

  return useMutation<
    {
      rental: Rental;
      charges: { type: string; amount: string; description: string }[];
      chargeTotal: string;
      warnings: string[];
    },
    NormalisedApiError,
    {
      mileage: number;
      fuelPercent: number;
      conditionNotes?: string;
      damageNotes?: string;
      cleanliness?: string;
      needsCleaning: boolean;
      missingAccessories?: string[];
    }
  >({
    mutationFn: (body) => rentalsService.recordReturn(bookingId, body),
    onSuccess: invalidate,
  });
}

export function useCloseRental(bookingId: string) {
  const invalidate = useInvalidateRental(bookingId);
  return useMutation<{ rental: Rental }, NormalisedApiError, void>({
    mutationFn: () => rentalsService.close(bookingId),
    onSuccess: invalidate,
  });
}

export function useUploadInspectionPhotos(bookingId: string) {
  const invalidate = useInvalidateRental(bookingId);
  return useMutation<
    { rental: Rental },
    NormalisedApiError,
    { inspectionId: string; files: File[]; type: string }
  >({
    mutationFn: ({ inspectionId, files, type }) =>
      rentalsService.uploadPhotos(inspectionId, files, type),
    onSuccess: invalidate,
  });
}

export function useSettleCharge(bookingId: string) {
  const invalidate = useInvalidateRental(bookingId);
  return useMutation<{ rental: Rental }, NormalisedApiError, string>({
    mutationFn: (chargeId) => rentalsService.settleCharge(chargeId),
    onSuccess: invalidate,
  });
}

export function useWaiveCharge(bookingId: string) {
  const invalidate = useInvalidateRental(bookingId);
  return useMutation<{ rental: Rental }, NormalisedApiError, { chargeId: string; reason: string }>({
    mutationFn: ({ chargeId, reason }) => rentalsService.waiveCharge(chargeId, reason),
    onSuccess: invalidate,
  });
}

export function useReviewExtension(bookingId: string) {
  const invalidate = useInvalidateRental(bookingId);
  return useMutation<
    { extension: Extension },
    NormalisedApiError,
    { extensionId: string; approve: boolean; rejectionReason?: string }
  >({
    mutationFn: ({ extensionId, approve, rejectionReason }) =>
      rentalsService.reviewExtension(extensionId, approve, rejectionReason),
    onSuccess: invalidate,
  });
}

export function useRequestExtension(bookingId: string) {
  const invalidate = useInvalidateRental(bookingId);
  return useMutation<{ extension: Extension }, NormalisedApiError, string>({
    mutationFn: (requestedReturnAt) =>
      rentalsService.requestExtension(bookingId, requestedReturnAt),
    onSuccess: invalidate,
  });
}
