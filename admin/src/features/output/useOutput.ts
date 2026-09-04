/**
 * features/output/useOutput.ts
 * ---------------------------------------------------------------------------
 * Data hooks for Phase 10: reports, invoices, coupons, notifications and
 * legal documents.
 *
 * Reports get a longer `staleTime` than the rest. A revenue figure for last
 * month does not change while you look at it, and refetching an aggregate over
 * every payment row on window focus is a lot of database work to redraw the
 * same number.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getData, patchData, postData } from '../../services/api';
import type { NormalisedApiError, PaginatedData } from '../../types/api';
import type {
  Coupon,
  DashboardReport,
  FleetReport,
  Invoice,
  LegalDocument,
  NotificationLog,
  NotificationTemplate,
  RevenueReport,
  BookingsReport,
} from '../../types/output';

const REPORT_STALE_TIME = 60_000;

function rangeParams(range: { from?: string; to?: string }) {
  return {
    ...(range.from ? { from: range.from } : {}),
    ...(range.to ? { to: range.to } : {}),
  };
}

// --- Reports ---------------------------------------------------------------

export function useDashboardReport() {
  return useQuery<DashboardReport, NormalisedApiError>({
    queryKey: ['report-dashboard'],
    queryFn: () => getData<DashboardReport>('/reports/dashboard'),
    staleTime: REPORT_STALE_TIME,
  });
}

export function useRevenueReport(range: { from?: string; to?: string }) {
  return useQuery<RevenueReport, NormalisedApiError>({
    queryKey: ['report-revenue', range],
    queryFn: () => getData<RevenueReport>('/reports/revenue', rangeParams(range)),
    staleTime: REPORT_STALE_TIME,
    placeholderData: (previous) => previous,
  });
}

export function useBookingsReport(range: { from?: string; to?: string }) {
  return useQuery<BookingsReport, NormalisedApiError>({
    queryKey: ['report-bookings', range],
    queryFn: () => getData<BookingsReport>('/reports/bookings', rangeParams(range)),
    staleTime: REPORT_STALE_TIME,
    placeholderData: (previous) => previous,
  });
}

export function useFleetReport(range: { from?: string; to?: string }) {
  return useQuery<FleetReport, NormalisedApiError>({
    queryKey: ['report-fleet', range],
    queryFn: () => getData<FleetReport>('/reports/fleet', rangeParams(range)),
    staleTime: REPORT_STALE_TIME,
    placeholderData: (previous) => previous,
  });
}

// --- Invoices --------------------------------------------------------------

export function useInvoices(filters: { page: number; limit: number; bookingId?: string }) {
  return useQuery<PaginatedData<Invoice>, NormalisedApiError>({
    queryKey: ['invoices', filters],
    queryFn: () => getData<PaginatedData<Invoice>>('/invoices', filters as Record<string, unknown>),
    placeholderData: (previous) => previous,
  });
}

export function useIssueInvoice() {
  const queryClient = useQueryClient();
  return useMutation<Invoice, NormalisedApiError, string>({
    mutationFn: (bookingId) => postData<Invoice>('/invoices', { bookingId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['invoices'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-booking'] });
    },
  });
}

export function useCreditNote() {
  const queryClient = useQueryClient();
  return useMutation<Invoice, NormalisedApiError, { id: string; reason: string }>({
    mutationFn: ({ id, reason }) => postData<Invoice>(`/invoices/${id}/credit-note`, { reason }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['invoices'] }),
  });
}

// --- Coupons ---------------------------------------------------------------

export function useCoupons(filters: { page: number; limit: number; activeOnly?: boolean }) {
  return useQuery<PaginatedData<Coupon>, NormalisedApiError>({
    queryKey: ['coupons', filters],
    queryFn: () => getData<PaginatedData<Coupon>>('/coupons', filters as Record<string, unknown>),
    placeholderData: (previous) => previous,
  });
}

export function useCreateCoupon() {
  const queryClient = useQueryClient();
  return useMutation<Coupon, NormalisedApiError, Record<string, unknown>>({
    mutationFn: (payload) => postData<Coupon>('/coupons', payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['coupons'] }),
  });
}

export function useUpdateCoupon() {
  const queryClient = useQueryClient();
  return useMutation<Coupon, NormalisedApiError, { id: string; isActive?: boolean }>({
    mutationFn: ({ id, ...body }) => patchData<Coupon>(`/coupons/${id}`, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['coupons'] }),
  });
}

// --- Notifications ---------------------------------------------------------

export function useNotifications(filters: { page: number; limit: number; status?: string }) {
  return useQuery<PaginatedData<NotificationLog>, NormalisedApiError>({
    queryKey: ['notifications', filters],
    queryFn: () =>
      getData<PaginatedData<NotificationLog>>('/notifications', filters as Record<string, unknown>),
    placeholderData: (previous) => previous,
  });
}

export function useRetryNotification() {
  const queryClient = useQueryClient();
  return useMutation<unknown, NormalisedApiError, string>({
    mutationFn: (id) => postData(`/notifications/${id}/retry`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });
}

export function useNotificationTemplates() {
  return useQuery<NotificationTemplate[], NormalisedApiError>({
    queryKey: ['notification-templates'],
    queryFn: () => getData<NotificationTemplate[]>('/notifications/templates'),
  });
}

export function useUpdateTemplate() {
  const queryClient = useQueryClient();
  return useMutation<
    NotificationTemplate,
    NormalisedApiError,
    { id: string; subject?: string; body?: string; isActive?: boolean }
  >({
    mutationFn: ({ id, ...body }) => patchData<NotificationTemplate>(`/notifications/templates/${id}`, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notification-templates'] }),
  });
}

// --- Legal documents -------------------------------------------------------

export function useLegalVersions() {
  return useQuery<LegalDocument[], NormalisedApiError>({
    queryKey: ['legal-versions'],
    queryFn: () => getData<LegalDocument[]>('/legal/versions'),
  });
}

export function useCreateLegalVersion() {
  const queryClient = useQueryClient();
  return useMutation<LegalDocument, NormalisedApiError, Record<string, unknown>>({
    mutationFn: (payload) => postData<LegalDocument>('/legal', payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['legal-versions'] }),
  });
}

export function useUpdateLegalDraft() {
  const queryClient = useQueryClient();
  return useMutation<LegalDocument, NormalisedApiError, { id: string; title?: string; content?: string }>({
    mutationFn: ({ id, ...body }) => patchData<LegalDocument>(`/legal/${id}/draft`, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['legal-versions'] }),
  });
}

export function usePublishLegal() {
  const queryClient = useQueryClient();
  return useMutation<LegalDocument, NormalisedApiError, string>({
    mutationFn: (id) => postData<LegalDocument>(`/legal/${id}/publish`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['legal-versions'] }),
  });
}
