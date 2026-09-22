/**
 * features/counter/useCounter.ts
 * ---------------------------------------------------------------------------
 * The counter: opening an account for a walk-in, and booking on their behalf.
 *
 * These two hooks exist because the busiest thing this business does had no
 * screen. Everything else in the admin app acts on a booking a customer made
 * themselves; this is the path for the person standing at the desk.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getData, postData } from '../../services/api';
import type { NormalisedApiError, PaginatedData } from '../../types/api';

export interface NewCustomerInput {
  fullName: string;
  email: string;
  phone: string;
  customerType: 'INDIVIDUAL' | 'CORPORATE';
  companyName?: string;
  companyTrn?: string;
  residencyStatus?: 'UAE_RESIDENT' | 'VISITOR';
  dateOfBirth?: string;
  nationality?: string;
  addressLine1?: string;
  city?: string;
  emirate?: string;
  licenceNumber?: string;
  licenceIssuingCountry?: string;
  licenceExpiryDate?: string;
}

export interface CreatedCustomer {
  id: string;
  userId: string;
  user: { id: string; fullName: string; email: string; phone: string | null };
  /** False means the account exists but no set-password email went out. */
  invitationSent: boolean;
}

export function useCreateCustomer() {
  const queryClient = useQueryClient();
  return useMutation<{ customer: CreatedCustomer }, NormalisedApiError, NewCustomerInput>({
    mutationFn: (input) => postData<{ customer: CreatedCustomer }>('/customers', input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['customers'] }),
  });
}

// --- Booking for a walk-in --------------------------------------------------

export interface AvailableVehicle {
  id: string;
  brand: string;
  model: string;
  year: number;
  registrationNumber?: string | null;
  dailyPrice: string;
  securityDeposit: string;
  category?: { name: string } | null;
}

export function useAvailableVehicles(params: {
  pickupAt?: string;
  returnAt?: string;
  search?: string;
}) {
  const ready = Boolean(params.pickupAt && params.returnAt);
  return useQuery<PaginatedData<AvailableVehicle>, NormalisedApiError>({
    queryKey: ['counter-availability', params],
    queryFn: () =>
      getData<PaginatedData<AvailableVehicle>>('/availability/search', {
        pickupAt: params.pickupAt,
        returnAt: params.returnAt,
        search: params.search || undefined,
        limit: 24,
      }),
    enabled: ready,
  });
}

export interface Quote {
  currency: string;
  period: { rentalDays: number };
  totals: {
    vehicleSubtotal: string;
    taxAmount: string;
    rentalTotal: string;
    securityDeposit: string;
    totalPayable: string;
  };
  warnings: string[];
}

export function useQuote(input: { vehicleId?: string; pickupAt?: string; returnAt?: string }) {
  const ready = Boolean(input.vehicleId && input.pickupAt && input.returnAt);
  return useQuery<{ quote: Quote }, NormalisedApiError>({
    queryKey: ['counter-quote', input],
    queryFn: () => postData<{ quote: Quote }>('/pricing/quote', input),
    enabled: ready,
  });
}

export function useCreateBookingForCustomer() {
  const queryClient = useQueryClient();
  return useMutation<
    { booking: { id: string; bookingNumber: string } },
    NormalisedApiError,
    {
      customerId: string;
      vehicleId: string;
      pickupAt: string;
      returnAt: string;
      paymentMethod: 'ONLINE' | 'CASH_ON_PICKUP';
      staffNotes?: string;
    }
  >({
    mutationFn: (input) =>
      postData<{ booking: { id: string; bookingNumber: string } }>('/bookings', input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bookings'] }),
  });
}
