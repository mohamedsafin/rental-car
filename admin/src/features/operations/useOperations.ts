/**
 * features/operations/useOperations.ts
 * ---------------------------------------------------------------------------
 * Data hooks for the day-to-day boards: pickups, returns and inspections.
 *
 * Pickups and returns are the SAME endpoint with different filters. They are
 * two boards rather than one because they are two jobs done by different
 * people at different times of day, and merging them would mean every row
 * needing a badge to say which it was.
 */
import { useQuery } from '@tanstack/react-query';
import { getData } from '../../services/api';
import type { NormalisedApiError, PaginatedData } from '../../types/api';
import type { Booking } from '../../types/booking';
import type { Inspection } from '../../types/operations';

/** Start and end of a day, as the API expects. */
export function dayBounds(date: string): { from: string; to: string } {
  return {
    from: new Date(`${date}T00:00:00`).toISOString(),
    to: new Date(`${date}T23:59:59`).toISOString(),
  };
}

/**
 * Cars going OUT: confirmed and ready bookings whose pickup falls in range.
 *
 * Both statuses, because a booking sits at CONFIRMED until someone marks it
 * ready - and a car that has not been prepared is exactly the one the pickup
 * board needs to show.
 */
export function usePickups(range: { from: string; to: string }, status?: string) {
  return useQuery<PaginatedData<Booking>, NormalisedApiError>({
    queryKey: ['pickups', range, status],
    queryFn: () =>
      getData<PaginatedData<Booking>>('/bookings', {
        ...range,
        dateField: 'pickup',
        status: status || 'READY_FOR_PICKUP',
        limit: 100,
      }),
    placeholderData: (previous) => previous,
  });
}

/** Cars coming BACK: active rentals whose return time falls in range. */
export function useReturns(range: { from: string; to: string }) {
  return useQuery<PaginatedData<Booking>, NormalisedApiError>({
    queryKey: ['returns', range],
    queryFn: () =>
      getData<PaginatedData<Booking>>('/bookings', {
        ...range,
        // The whole reason `dateField` exists: "due back today" is a question
        // about returnAt, not pickupAt.
        dateField: 'return',
        status: 'ACTIVE',
        limit: 100,
      }),
    placeholderData: (previous) => previous,
  });
}

export function useInspections(filters: { page: number; limit: number; type?: string; withFindings?: boolean }) {
  return useQuery<PaginatedData<Inspection>, NormalisedApiError>({
    queryKey: ['inspections', filters],
    queryFn: () =>
      getData<PaginatedData<Inspection>>('/rentals/inspections', filters as Record<string, unknown>),
    placeholderData: (previous) => previous,
  });
}
