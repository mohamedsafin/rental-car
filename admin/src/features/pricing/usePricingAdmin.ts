/**
 * features/pricing/usePricingAdmin.ts
 * ---------------------------------------------------------------------------
 * Admin hooks for services, pricing rules and the pricing settings.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, getData, patchData, postData } from '../../services/api';
import type { NormalisedApiError } from '../../types/api';

export interface AdminService {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  price: string;
  chargeType: 'PER_BOOKING' | 'PER_DAY';
  maxQuantity: number;
  displayOrder: number;
  isActive: boolean;
}

export interface PricingRule {
  id: string;
  name: string;
  type: 'WEEKEND' | 'SEASONAL' | 'LONG_TERM_DISCOUNT';
  weekdays: number[];
  minDays: number | null;
  startDate: string | null;
  endDate: string | null;
  adjustmentPercentage: string;
  priority: number;
  isActive: boolean;
  vehicle: { id: string; brand: string; model: string } | null;
  category: { id: string; name: string } | null;
}

export interface SystemSetting {
  key: string;
  value: string;
  label: string;
  description: string | null;
  category: string;
  valueType: string;
}

export function useAdminServices() {
  return useQuery<{ services: AdminService[] }, NormalisedApiError>({
    queryKey: ['admin-services'],
    queryFn: () => getData<{ services: AdminService[] }>('/admin/pricing/services'),
  });
}

export function useUpdateService() {
  const queryClient = useQueryClient();
  return useMutation<
    { service: AdminService },
    NormalisedApiError,
    { id: string; changes: Partial<AdminService> }
  >({
    mutationFn: ({ id, changes }) =>
      patchData<{ service: AdminService }>(`/admin/pricing/services/${id}`, changes),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-services'] });
      // The customer-facing list is a different endpoint and cache key, so it
      // has to be invalidated too or the storefront keeps the old price.
      void queryClient.invalidateQueries({ queryKey: ['additional-services'] });
    },
  });
}

export function usePricingRules() {
  return useQuery<{ rules: PricingRule[] }, NormalisedApiError>({
    queryKey: ['pricing-rules'],
    queryFn: () => getData<{ rules: PricingRule[] }>('/admin/pricing/rules'),
  });
}

export function useCreatePricingRule() {
  const queryClient = useQueryClient();
  return useMutation<{ rule: PricingRule }, NormalisedApiError, Record<string, unknown>>({
    mutationFn: (payload) => postData<{ rule: PricingRule }>('/admin/pricing/rules', payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pricing-rules'] }),
  });
}

export function useDeletePricingRule() {
  const queryClient = useQueryClient();
  return useMutation<null, NormalisedApiError, string>({
    mutationFn: async (id) => {
      await api.delete(`/admin/pricing/rules/${id}`);
      return null;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pricing-rules'] }),
  });
}

export function usePricingSettings() {
  return useQuery<{ settings: SystemSetting[] }, NormalisedApiError>({
    queryKey: ['pricing-settings'],
    queryFn: () => getData<{ settings: SystemSetting[] }>('/admin/pricing/settings'),
  });
}

export function useUpdateSetting() {
  const queryClient = useQueryClient();
  return useMutation<
    { setting: SystemSetting },
    NormalisedApiError,
    { key: string; value: string }
  >({
    mutationFn: ({ key, value }) =>
      patchData<{ setting: SystemSetting }>(`/admin/pricing/settings/${key}`, { value }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pricing-settings'] }),
  });
}
