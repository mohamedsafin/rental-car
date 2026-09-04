/**
 * features/bookings/useBookings.ts
 * ---------------------------------------------------------------------------
 * Customer booking hooks.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { bookingsService } from '../../services/bookings.service';
import type { NormalisedApiError, PaginatedData } from '../../types/api';
import type { Booking } from '../../types/booking';

export function useMyBookings(params: { page?: number; limit?: number; scope?: string }) {
  return useQuery<PaginatedData<Booking>, NormalisedApiError>({
    queryKey: ['my-bookings', params],
    queryFn: () => bookingsService.myBookings(params),
    placeholderData: (previous) => previous,
  });
}

export function useBooking(id: string | undefined) {
  return useQuery<{ booking: Booking }, NormalisedApiError>({
    queryKey: ['booking', id],
    queryFn: () => bookingsService.getById(id as string),
    enabled: Boolean(id),
  });
}

export function useCreateBooking() {
  const queryClient = useQueryClient();

  return useMutation<
    { booking: Booking },
    NormalisedApiError,
    {
      vehicleId: string;
      pickupAt: string;
      returnAt: string;
      pickupLocationId?: string;
      dropoffLocationId?: string;
      services?: { serviceId: string; quantity: number }[];
      customerNotes?: string;
    }
  >({
    mutationFn: bookingsService.create,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['my-bookings'] });
      // The vehicle is now unavailable for those dates, so any cached search
      // or quote is stale.
      void queryClient.invalidateQueries({ queryKey: ['available-vehicles'] });
      void queryClient.invalidateQueries({ queryKey: ['quote'] });
    },
  });
}

export function useCancelBooking() {
  const queryClient = useQueryClient();

  return useMutation<{ booking: Booking }, NormalisedApiError, { id: string; reason?: string }>({
    mutationFn: ({ id, reason }) => bookingsService.cancel(id, reason),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['my-bookings'] });
      void queryClient.invalidateQueries({ queryKey: ['booking'] });
      // Cancelling frees the dates again.
      void queryClient.invalidateQueries({ queryKey: ['available-vehicles'] });
    },
  });
}
