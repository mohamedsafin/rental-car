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

/** A rental that also covers the moment, when more than one does. */
export interface AmbiguousOption {
  bookingNumber: string;
  customerName: string;
}

interface ChargeMatch {
  /**
   * Who the timestamp says was driving. Mirrors `toMatchedCustomer` on the
   * server - this is a hand-written mirror of a server shape, so it drifts
   * silently when the server changes: it already did once, and printed
   * "undefined had this car on booking undefined" until someone noticed.
   */
  matchedCustomer: {
    id: string;
    fullName: string;
    email: string;
    bookingNumber: string;
  } | null;
  /**
   * Non-empty when two or more rentals cover that moment. The server attaches
   * nothing in that case rather than picking one - it once picked whichever
   * the database returned first, and billed the wrong customer.
   */
  ambiguousBetween: AmbiguousOption[];
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

/** A rental this charge could belong to. Only ever rentals of the same car. */
export interface BookingOption {
  id: string;
  bookingNumber: string;
  customerName: string;
  customerEmail: string;
  pickupAt: string;
  returnAt: string;
  status: string;
  billingCycle: 'UPFRONT' | 'MONTHLY';
  /** Finished or cancelled: shown for context, but nothing can be added to it. */
  closed: boolean;
  /** The car was actually signed out to them at that moment. Evidence. */
  hadTheCar: boolean;
  /** Their BOOKED dates cover it - which is not the same thing. */
  bookedOverIt: boolean;
  /** No handover was ever recorded, so nobody drove anything on this booking. */
  neverHandedOver: boolean;
  handedOverAt: string | null;
  returnedAt: string | null;
}

/**
 * Fetched only when the staff member opens the picker (`enabled`), not for
 * every row in the table - a page of twenty unattached charges would otherwise
 * fire twenty lookups nobody asked for.
 */
export function useBookingOptions(kind: 'fines' | 'tolls', chargeId: string | null) {
  return useQuery<{ at: string; options: BookingOption[] }, NormalisedApiError>({
    queryKey: ['booking-options', kind, chargeId],
    queryFn: () => getData(`/fleet/${kind}/${chargeId}/booking-options`),
    enabled: Boolean(chargeId),
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
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [kind] });
      // Attaching a charge changes what a booking owes, and what the counter
      // sees before releasing that booking's deposit.
      void queryClient.invalidateQueries({ queryKey: ['admin-booking'] });
      void queryClient.invalidateQueries({ queryKey: ['settlement-check'] });
    },
  });
}

/** What `recover` reports back: recovery is now a charge AND a deduction. */
export interface RecoverResult {
  chargeId: string;
  amount: string;
  recoveredFromDeposit: string;
  leftToInvoice: string;
  /** Deposit left after the deduction. Null when there was no held deposit. */
  depositBalance: string | null;
  /**
   * The month this was billed with, on a long-term rental. Null when it came
   * out of the deposit instead - the two paths share one shape so this page
   * has one thing to read.
   */
  billedWithInstalment: number | null;
}

export function useRecoverCharge(kind: 'fines' | 'tolls') {
  const queryClient = useQueryClient();
  return useMutation<RecoverResult, NormalisedApiError, string>({
    mutationFn: (id) => postData<RecoverResult>(`/fleet/${kind}/${id}/recover`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [kind] });
      void queryClient.invalidateQueries({ queryKey: ['admin-booking'] });
      // The deposit ledger and its balance have both moved.
      void queryClient.invalidateQueries({ queryKey: ['deposit'] });
      void queryClient.invalidateQueries({ queryKey: ['rental'] });
      void queryClient.invalidateQueries({ queryKey: ['settlement-check'] });
    },
  });
}

// --- The check before a deposit goes back ----------------------------------

export interface SettlementItem {
  id: string;
  kind: 'fine' | 'toll';
  what: string;
  at: string;
  amount: string;
  serviceFee: string;
  total: string;
  status: string;
}

export interface SettlementCheckData {
  bookingId: string;
  bookingNumber: string;
  currency: string;
  billingCycle: 'UPFRONT' | 'MONTHLY';
  /** The rental is over: anything still outstanding is the company's now. */
  closed: boolean;
  outstanding: SettlementItem[];
  outstandingTotal: string;
  unattached: SettlementItem[];
  unattachedTotal: string;
  tollsKnownUntil: string | null;
  uncoveredDays: number;
  suggestedHold: string | null;
  suggestionBasis: string | null;
  depositBalance: string | null;
}

/**
 * Re-read whenever a charge or the deposit moves, because it is read at the
 * counter with the customer waiting - a stale "nothing outstanding" here is
 * money walking out of the door.
 */
export function useSettlementCheck(bookingId: string) {
  return useQuery<SettlementCheckData, NormalisedApiError>({
    queryKey: ['settlement-check', bookingId],
    queryFn: () => getData<SettlementCheckData>(`/fleet/bookings/${bookingId}/settlement-check`),
    enabled: Boolean(bookingId),
  });
}

// --- Salik statement import ------------------------------------------------

/** One row of the statement, and what the server decided to do with it. */
export interface ImportRow {
  line: number;
  plate: string;
  crossedAt: string;
  gate: string | null;
  /** The fine number. Null on a Salik row, which has no such thing. */
  reference: string | null;
  violation: string | null;
  amount: string;
  serviceFee: string;
  total: string;
  outcome: 'billable' | 'unattached' | 'written_off' | 'duplicate' | 'unknown_vehicle';
  vehicleName: string | null;
  bookingNumber: string | null;
  customerName: string | null;
}

export interface ImportSummary {
  rows: ImportRow[];
  problems: { line: number; reason: string; raw: string }[];
  counts: Record<ImportRow['outcome'], number>;
  billableTotal: string;
  writtenOffTotal: string;
  currency: string;
  /** Only on a committed import: how many rows were actually written. */
  imported?: number;
}

/** Read the file and report what WOULD happen. Writes nothing. */
export function usePreviewStatement(kind: 'fines' | 'tolls') {
  return useMutation<ImportSummary, NormalisedApiError, string>({
    mutationFn: (text) => postData<ImportSummary>(`/fleet/${kind}/import/preview`, { text }),
  });
}

export function useImportStatement(kind: 'fines' | 'tolls') {
  const queryClient = useQueryClient();
  return useMutation<ImportSummary, NormalisedApiError, string>({
    mutationFn: (text) => postData<ImportSummary>(`/fleet/${kind}/import`, { text }),
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
