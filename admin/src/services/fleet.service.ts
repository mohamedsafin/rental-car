/**
 * services/fleet.service.ts
 * ---------------------------------------------------------------------------
 * Fleet API calls. The only file in the app that knows these URLs.
 */
import { getData } from './api';
import type { PaginatedData } from '../types/api';
import type { Location, Vehicle, VehicleCategory, VehicleFeature, VehicleFilters } from '../types/vehicle';

export const fleetService = {
  listVehicles: (filters: VehicleFilters) =>
    getData<PaginatedData<Vehicle>>('/vehicles', filters as Record<string, unknown>),

  getVehicle: (id: string) => getData<{ vehicle: Vehicle }>(`/vehicles/${id}`),

  listCategories: () => getData<{ categories: VehicleCategory[] }>('/categories'),

  listFeatures: () => getData<{ features: VehicleFeature[] }>('/features'),

  listLocations: () => getData<{ locations: Location[] }>('/locations'),
};
