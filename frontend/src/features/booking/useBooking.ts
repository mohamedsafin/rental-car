/**
 * features/booking/useBooking.ts
 * ---------------------------------------------------------------------------
 * Availability and pricing hooks.
 *
 * `useQuote` is a QUERY, not a mutation, even though it POSTs. A quote is
 * side-effect free and idempotent - asking twice changes nothing - so it wants
 * caching and refetching, which is what queries give us. The verb is POST only
 * because the request body carries a list of selected services.
 */
import { useQuery } from '@tanstack/react-query';
import { bookingService } from '../../services/booking.service';
import type { NormalisedApiError, PaginatedData } from '../../types/api';
import type { Vehicle } from '../../types/vehicle';
import type { AdditionalService, QuoteResponse, SearchCriteria } from '../../types/pricing';

/** Combine the form's separate date and time fields into an ISO instant. */
export function toIso(date: string, time: string): string {
  return `${date}T${time}:00.000Z`;
}

export function useAvailableVehicles(
  criteria: SearchCriteria | null,
  extra: Record<string, unknown> = {},
) {
  return useQuery<PaginatedData<Vehicle>, NormalisedApiError>({
    queryKey: ['available-vehicles', criteria, extra],
    queryFn: () => bookingService.searchAvailable({ ...(criteria as SearchCriteria), ...extra }),
    // No dates chosen yet means there is no search to run.
    enabled: Boolean(criteria?.pickupDate && criteria?.returnDate),
    placeholderData: (previous) => previous,
  });
}

export function useQuote(params: {
  vehicleId: string | undefined;
  pickupAt: string | null;
  returnAt: string | null;
  services?: { serviceId: string; quantity: number }[];
  pickupLocationId?: string;
}) {
  return useQuery<QuoteResponse, NormalisedApiError>({
    queryKey: ['quote', params],
    queryFn: () =>
      bookingService.getQuote({
        vehicleId: params.vehicleId as string,
        pickupAt: params.pickupAt as string,
        returnAt: params.returnAt as string,
        services: params.services,
        pickupLocationId: params.pickupLocationId,
      }),
    enabled: Boolean(params.vehicleId && params.pickupAt && params.returnAt),
    // A quote depends on live availability, so never serve a stale one.
    staleTime: 0,
    retry: false,
  });
}

export function useAdditionalServices() {
  return useQuery<{ services: AdditionalService[] }, NormalisedApiError>({
    queryKey: ['additional-services'],
    queryFn: bookingService.listServices,
    staleTime: 5 * 60 * 1000,
  });
}

export function useBlockedDates(vehicleId: string | undefined) {
  return useQuery<{ blockedDates: string[] }, NormalisedApiError>({
    queryKey: ['blocked-dates', vehicleId],
    queryFn: () => bookingService.getBlockedDates(vehicleId as string),
    enabled: Boolean(vehicleId),
    staleTime: 60_000,
  });
}
