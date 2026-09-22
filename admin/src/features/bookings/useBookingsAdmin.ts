/**
 * features/bookings/useBookingsAdmin.ts
 * ---------------------------------------------------------------------------
 * Staff booking hooks.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { bookingsService } from '../../services/bookings.service';
import type { NormalisedApiError, PaginatedData } from '../../types/api';
import type { Booking, BookingStatus } from '../../types/booking';

export interface BookingFilters {
  page?: number;
  limit?: number;
  status?: BookingStatus;
  /**
   * Bookings that owe money for the rental: CONFIRMED or PAYMENT_PENDING, and
   * online only. Not expressible as a single `status`, and defined once on the
   * server so this cannot drift from the outstanding report.
   */
  awaitingPayment?: boolean;
  search?: string;
  from?: string;
  to?: string;
}

export function useAdminBookings(filters: BookingFilters) {
  return useQuery<PaginatedData<Booking>, NormalisedApiError>({
    queryKey: ['admin-bookings', filters],
    queryFn: () => bookingsService.list(filters as Record<string, unknown>),
    placeholderData: (previous) => previous,
  });
}

export function useAdminBooking(id: string | undefined) {
  return useQuery<{ booking: Booking }, NormalisedApiError>({
    queryKey: ['admin-booking', id],
    queryFn: () => bookingsService.getById(id as string),
    enabled: Boolean(id),
  });
}

export function useChangeBookingStatus() {
  const queryClient = useQueryClient();

  return useMutation<
    { booking: Booking },
    NormalisedApiError,
    { id: string; status: BookingStatus; reason?: string }
  >({
    mutationFn: ({ id, status, reason }) => bookingsService.changeStatus(id, status, reason),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-bookings'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-booking'] });
    },
  });
}

export function useCancelBookingAdmin() {
  const queryClient = useQueryClient();

  return useMutation<{ booking: Booking }, NormalisedApiError, { id: string; reason?: string }>({
    mutationFn: ({ id, reason }) => bookingsService.cancel(id, reason),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-bookings'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-booking'] });
    },
  });
}

/**
 * The transitions the API will accept from a given status.
 *
 * A MIRROR of the backend's machine, used only to decide which buttons to
 * show. The backend is what actually enforces it - if these two ever disagree,
 * the server wins and the UI shows its 409.
 */
export const NEXT_STATUSES: Record<BookingStatus, BookingStatus[]> = {
  PENDING: ['DOCUMENT_VERIFICATION', 'CONFIRMED'],
  // Approving the documents IS the confirmation, for card and cash alike.
  DOCUMENT_VERIFICATION: ['CONFIRMED'],
  /*
   * Only READY_FOR_PICKUP is offered by hand. PAYMENT_PENDING is reached when
   * the customer starts checkout, not by a staff click - putting a button here
   * would let staff shunt a booking onto a payment step the customer has not
   * begun, and nothing would move it off again.
   *
   * For an ONLINE booking the server refuses READY_FOR_PICKUP until the money
   * clears, so the page disables that button rather than offering a refusal.
   */
  CONFIRMED: ['READY_FOR_PICKUP'],
  PAYMENT_PENDING: ['READY_FOR_PICKUP'],
  READY_FOR_PICKUP: ['ACTIVE'],
  ACTIVE: ['EXTENSION_REQUESTED', 'RETURN_PENDING'],
  EXTENSION_REQUESTED: ['ACTIVE', 'RETURN_PENDING'],
  RETURN_PENDING: ['RETURNED'],
  RETURNED: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
};
