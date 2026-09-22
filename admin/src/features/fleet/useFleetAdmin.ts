/**
 * features/fleet/useFleetAdmin.ts
 * ---------------------------------------------------------------------------
 * Admin mutations for the fleet.
 *
 * Image upload is the one call that does NOT send JSON. FormData must be built
 * by hand and the Content-Type header REMOVED - the browser has to set it
 * itself, because a multipart request needs a `boundary` parameter that only it
 * can generate. Setting 'multipart/form-data' manually produces a request the
 * server cannot parse.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, getData, patchData, postData } from '../../services/api';
import type { NormalisedApiError, PaginatedData } from '../../types/api';
import type { Location, Vehicle, VehicleCategory, VehicleFeature, VehicleFilters } from '../../types/vehicle';

export function useAdminVehicles(filters: VehicleFilters) {
  return useQuery<PaginatedData<Vehicle>, NormalisedApiError>({
    queryKey: ['admin-vehicles', filters],
    queryFn: () =>
      getData<PaginatedData<Vehicle>>('/vehicles', {
        ...filters,
        // Admins must see vehicles hidden from customers - that is the point of
        // the dashboard. The backend still checks the caller's role.
        includeUnpublished: true,
      } as Record<string, unknown>),
    placeholderData: (previous) => previous,
  });
}

/**
 * Every vehicle, for a "pick a car" dropdown.
 *
 * The list endpoint caps `limit` at 60. Asking for 100 does not simply return
 * a smaller page - it fails validation, the whole request 400s, and the
 * dropdown renders with nothing in it but the placeholder. Three pages did
 * exactly that, which is why this exists instead of a literal on each one.
 *
 * It also pages, so a fleet larger than 60 cars does not silently lose the
 * tail - a fine recorded against the wrong car because the right one was not
 * listed is worse than a slow dropdown.
 */
const OPTIONS_PAGE_SIZE = 60;

export function useVehicleOptions() {
  return useQuery<Vehicle[], NormalisedApiError>({
    queryKey: ['vehicle-options'],
    queryFn: async () => {
      const query = (page: number) =>
        getData<PaginatedData<Vehicle>>('/vehicles', {
          page,
          limit: OPTIONS_PAGE_SIZE,
          includeUnpublished: true,
        });

      const first = await query(1);
      const items = [...first.items];

      for (let page = 2; page <= first.pagination.totalPages; page += 1) {
        const next = await query(page);
        items.push(...next.items);
      }

      return items;
    },
    staleTime: 60_000,
  });
}

export function useAdminVehicle(id: string | undefined) {
  return useQuery<{ vehicle: Vehicle }, NormalisedApiError>({
    queryKey: ['admin-vehicle', id],
    queryFn: () => getData<{ vehicle: Vehicle }>(`/vehicles/${id}`),
    enabled: Boolean(id),
  });
}

export function useAdminCategories() {
  return useQuery<{ categories: VehicleCategory[] }, NormalisedApiError>({
    queryKey: ['admin-categories'],
    queryFn: () => getData<{ categories: VehicleCategory[] }>('/categories', { includeInactive: true }),
    staleTime: 60_000,
  });
}

export function useFeatures() {
  return useQuery<{ features: VehicleFeature[] }, NormalisedApiError>({
    queryKey: ['features'],
    queryFn: () => getData<{ features: VehicleFeature[] }>('/features'),
    staleTime: 5 * 60 * 1000,
  });
}

export function useAdminLocations() {
  return useQuery<{ locations: Location[] }, NormalisedApiError>({
    queryKey: ['admin-locations'],
    queryFn: () => getData<{ locations: Location[] }>('/locations', { includeInactive: true }),
    staleTime: 60_000,
  });
}

/**
 * Soft-deletes a location. The backend refuses (409) while vehicles are still
 * assigned to it, so the caller must surface the error rather than assume the
 * row is gone.
 */
export function useDeleteLocation() {
  const queryClient = useQueryClient();
  return useMutation<null, NormalisedApiError, string>({
    mutationFn: async (id) => {
      await api.delete(`/locations/${id}`);
      return null;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-locations'] });
      // The customer site's pickup dropdown reads this one.
      void queryClient.invalidateQueries({ queryKey: ['locations'] });
    },
  });
}

/** Invalidate everything that could show a vehicle after a change. */
function useInvalidateFleet() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['admin-vehicles'] });
    void queryClient.invalidateQueries({ queryKey: ['admin-vehicle'] });
    void queryClient.invalidateQueries({ queryKey: ['vehicles'] });
  };
}

export function useCreateVehicle() {
  const invalidate = useInvalidateFleet();
  return useMutation<{ vehicle: Vehicle }, NormalisedApiError, Record<string, unknown>>({
    mutationFn: (data) => postData<{ vehicle: Vehicle }>('/vehicles', data),
    onSuccess: invalidate,
  });
}

export function useUpdateVehicle() {
  const invalidate = useInvalidateFleet();
  return useMutation<
    { vehicle: Vehicle },
    NormalisedApiError,
    { id: string; changes: Record<string, unknown> }
  >({
    mutationFn: ({ id, changes }) => patchData<{ vehicle: Vehicle }>(`/vehicles/${id}`, changes),
    onSuccess: invalidate,
  });
}

export function useDeleteVehicle() {
  const invalidate = useInvalidateFleet();
  return useMutation<null, NormalisedApiError, string>({
    mutationFn: async (id) => {
      await api.delete(`/vehicles/${id}`);
      return null;
    },
    onSuccess: invalidate,
  });
}

export function useUploadVehicleImages() {
  const invalidate = useInvalidateFleet();

  return useMutation<
    { vehicle: Vehicle },
    NormalisedApiError,
    { vehicleId: string; files: File[]; type: string }
  >({
    mutationFn: async ({ vehicleId, files, type }) => {
      const form = new FormData();
      files.forEach((file) => form.append('images', file));

      const response = await api.post(`/vehicles/${vehicleId}/images?type=${type}`, form, {
        // Undefined, not 'multipart/form-data': the browser must add the
        // boundary parameter, and it only does that if we stay out of the way.
        headers: { 'Content-Type': undefined },
      });
      return response.data.data;
    },
    onSuccess: invalidate,
  });
}

export function useSetPrimaryImage() {
  const invalidate = useInvalidateFleet();
  return useMutation<{ vehicle: Vehicle }, NormalisedApiError, { vehicleId: string; imageId: string }>({
    mutationFn: ({ vehicleId, imageId }) =>
      patchData<{ vehicle: Vehicle }>(`/vehicles/${vehicleId}/images/${imageId}/primary`),
    onSuccess: invalidate,
  });
}

export function useDeleteImage() {
  const invalidate = useInvalidateFleet();
  return useMutation<null, NormalisedApiError, { vehicleId: string; imageId: string }>({
    mutationFn: async ({ vehicleId, imageId }) => {
      await api.delete(`/vehicles/${vehicleId}/images/${imageId}`);
      return null;
    },
    onSuccess: invalidate,
  });
}
