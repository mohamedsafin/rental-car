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
