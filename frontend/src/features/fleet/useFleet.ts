/**
 * features/fleet/useFleet.ts
 * ---------------------------------------------------------------------------
 * TanStack Query hooks for the customer-facing fleet.
 *
 * Categories and locations change rarely, so they get a long staleTime - no
 * point refetching the category list on every navigation.
 */
import { useQuery } from '@tanstack/react-query';
import { fleetService } from '../../services/fleet.service';
import type { NormalisedApiError, PaginatedData } from '../../types/api';
import type { Location, Vehicle, VehicleCategory, VehicleFilters } from '../../types/vehicle';

export function useVehicles(filters: VehicleFilters) {
  return useQuery<PaginatedData<Vehicle>, NormalisedApiError>({
    queryKey: ['vehicles', filters],
    queryFn: () => fleetService.listVehicles(filters),
    // Keep the current results on screen while the next page loads, instead of
    // flashing an empty grid every time a filter changes.
    placeholderData: (previous) => previous,
  });
}

export function useVehicle(id: string | undefined) {
  return useQuery<{ vehicle: Vehicle }, NormalisedApiError>({
    queryKey: ['vehicle', id],
    queryFn: () => fleetService.getVehicle(id as string),
    enabled: Boolean(id),
  });
}

export function useCategories() {
  return useQuery<{ categories: VehicleCategory[] }, NormalisedApiError>({
    queryKey: ['categories'],
    queryFn: fleetService.listCategories,
    staleTime: 5 * 60 * 1000,
  });
}

export function useLocations() {
  return useQuery<{ locations: Location[] }, NormalisedApiError>({
    queryKey: ['locations'],
    queryFn: fleetService.listLocations,
    staleTime: 5 * 60 * 1000,
  });
}
