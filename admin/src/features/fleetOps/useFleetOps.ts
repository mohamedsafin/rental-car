/**
 * features/fleetOps/useFleetOps.ts
 * ---------------------------------------------------------------------------
 * Data hooks for Phase 9: damages, fines, tolls, maintenance, insurance and
 * the expiry dashboard.
 *
 * All server state, so all TanStack Query - no useState mirroring a list the
 * server owns. Every mutation invalidates the queries its change can affect,
 * which is why scheduling maintenance also invalidates availability: taking a
 * car off the road changes what the calendar should show.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getData, patchData, postData } from '../../services/api';
import type { NormalisedApiError, PaginatedData } from '../../types/api';
import type {
  Damage,
  ExpiryDashboard,
  InsurancePolicy,
  MaintenanceRecord,
  TollCharge,
  TrafficFine,
  VehicleDocument,
} from '../../types/fleetOps';

// --- Damages ---------------------------------------------------------------

export function useDamages(filters: { page: number; limit: number; status?: string }) {
  return useQuery<PaginatedData<Damage>, NormalisedApiError>({
    queryKey: ['damages', filters],
    queryFn: () => getData<PaginatedData<Damage>>('/damages', filters as Record<string, unknown>),
    placeholderData: (previous) => previous,
  });
}

export function useReportDamage() {
  const queryClient = useQueryClient();
  return useMutation<Damage, NormalisedApiError, Record<string, unknown>>({
    mutationFn: (payload) => postData<Damage>('/damages', payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['damages'] }),
  });
}

export function useAssessDamage() {
  const queryClient = useQueryClient();
  return useMutation<
    Damage,
    NormalisedApiError,
    { id: string; approve: boolean; approvedAmount?: string; notes?: string }
  >({
    mutationFn: ({ id, ...body }) => patchData<Damage>(`/damages/${id}/assess`, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['damages'] }),
  });
}

export function useChargeDamage() {
  const queryClient = useQueryClient();
  return useMutation<unknown, NormalisedApiError, string>({
    mutationFn: (id) => postData(`/damages/${id}/charge`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['damages'] });
      // The charge lands on a booking, so anything showing that booking's
      // money is now stale.
      void queryClient.invalidateQueries({ queryKey: ['admin-booking'] });
    },
  });
}

// --- Fines and tolls -------------------------------------------------------

export function useFines(filters: { page: number; limit: number; status?: string }) {
  return useQuery<PaginatedData<TrafficFine>, NormalisedApiError>({
    queryKey: ['fines', filters],
    queryFn: () => getData<PaginatedData<TrafficFine>>('/fleet/fines', filters as Record<string, unknown>),
    placeholderData: (previous) => previous,
  });
}

export function useTolls(filters: { page: number; limit: number; status?: string }) {
  return useQuery<PaginatedData<TollCharge>, NormalisedApiError>({
    queryKey: ['tolls', filters],
    queryFn: () => getData<PaginatedData<TollCharge>>('/fleet/tolls', filters as Record<string, unknown>),
    placeholderData: (previous) => previous,
  });
}

interface ChargeMatch {
  matchedCustomer: { id: string; name: string; bookingNumber: string } | null;
}

export function useRecordFine() {
  const queryClient = useQueryClient();
  return useMutation<{ fine: TrafficFine } & ChargeMatch, NormalisedApiError, Record<string, unknown>>({
    mutationFn: (payload) => postData('/fleet/fines', payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['fines'] }),
  });
}

export function useRecordToll() {
  const queryClient = useQueryClient();
  return useMutation<{ toll: TollCharge } & ChargeMatch, NormalisedApiError, Record<string, unknown>>({
    mutationFn: (payload) => postData('/fleet/tolls', payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tolls'] }),
  });
}

export function useUpdateCharge(kind: 'fines' | 'tolls') {
  const queryClient = useQueryClient();
  return useMutation<
    unknown,
    NormalisedApiError,
    { id: string; bookingId?: string; status?: string; notes?: string }
  >({
    mutationFn: ({ id, ...body }) => patchData(`/fleet/${kind}/${id}`, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [kind] }),
  });
}

export function useRecoverCharge(kind: 'fines' | 'tolls') {
  const queryClient = useQueryClient();
  return useMutation<unknown, NormalisedApiError, string>({
    mutationFn: (id) => postData(`/fleet/${kind}/${id}/recover`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [kind] });
      void queryClient.invalidateQueries({ queryKey: ['admin-booking'] });
    },
  });
}

// --- Maintenance -----------------------------------------------------------

export function useMaintenance(filters: { page: number; limit: number; status?: string }) {
  return useQuery<PaginatedData<MaintenanceRecord>, NormalisedApiError>({
    queryKey: ['maintenance', filters],
    queryFn: () =>
      getData<PaginatedData<MaintenanceRecord>>('/fleet/maintenance', filters as Record<string, unknown>),
    placeholderData: (previous) => previous,
  });
}

export function useScheduleMaintenance() {
  const queryClient = useQueryClient();
  return useMutation<MaintenanceRecord, NormalisedApiError, Record<string, unknown>>({
    mutationFn: (payload) => postData<MaintenanceRecord>('/fleet/maintenance', payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['maintenance'] });
      // A car off the road for three days is three days off the calendar.
      void queryClient.invalidateQueries({ queryKey: ['availability'] });
    },
  });
}

export function useUpdateMaintenanceStatus() {
  const queryClient = useQueryClient();
  return useMutation<MaintenanceRecord, NormalisedApiError, { id: string; status: string }>({
    mutationFn: ({ id, status }) =>
      patchData<MaintenanceRecord>(`/fleet/maintenance/${id}/status`, { status }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['maintenance'] });
      void queryClient.invalidateQueries({ queryKey: ['availability'] });
    },
  });
}

// --- Insurance, documents and expiries -------------------------------------

export function useVehiclePolicies(vehicleId: string | undefined) {
  return useQuery<InsurancePolicy[], NormalisedApiError>({
    queryKey: ['insurance', vehicleId],
    queryFn: () => getData<InsurancePolicy[]>(`/fleet/vehicles/${vehicleId}/insurance`),
    enabled: Boolean(vehicleId),
  });
}

export function useVehicleDocuments(vehicleId: string | undefined) {
  return useQuery<VehicleDocument[], NormalisedApiError>({
    queryKey: ['vehicle-documents', vehicleId],
    queryFn: () => getData<VehicleDocument[]>(`/fleet/vehicles/${vehicleId}/documents`),
    enabled: Boolean(vehicleId),
  });
}

export function useAddPolicy() {
  const queryClient = useQueryClient();
  return useMutation<InsurancePolicy, NormalisedApiError, Record<string, unknown>>({
    mutationFn: (payload) => postData<InsurancePolicy>('/fleet/insurance', payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['insurance'] });
      void queryClient.invalidateQueries({ queryKey: ['expiring'] });
    },
  });
}

export function useExpiring(withinDays?: number) {
  return useQuery<ExpiryDashboard, NormalisedApiError>({
    queryKey: ['expiring', withinDays],
    queryFn: () => getData<ExpiryDashboard>('/fleet/expiring', withinDays ? { withinDays } : undefined),
  });
}
