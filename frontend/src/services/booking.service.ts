/**
 * services/booking.service.ts
 * ---------------------------------------------------------------------------
 * Availability and pricing API calls.
 */
import { getData, postData } from './api';
import type { PaginatedData } from '../types/api';
import type { Vehicle } from '../types/vehicle';
import type {
  AdditionalService,
  AvailabilityResult,
  PaymentOption,
  QuoteResponse,
  SearchCriteria,
} from '../types/pricing';

export const bookingService = {
  /** Vehicles bookable for the given window. */
  searchAvailable: (criteria: SearchCriteria & Record<string, unknown>) =>
    getData<PaginatedData<Vehicle>>('/availability/search', criteria),

  checkAvailability: (params: { vehicleId: string; pickupAt: string; returnAt: string }) =>
    getData<AvailabilityResult>('/availability/check', params),

  getBlockedDates: (vehicleId: string) =>
    getData<{ blockedDates: string[] }>(`/availability/${vehicleId}/blocked-dates`),

  /**
   * Ask the backend what this rental costs.
   *
   * Note what is NOT sent: a total. The browser describes the CHOICE; the
   * server returns the price.
   */
  getQuote: (body: {
    vehicleId: string;
    pickupAt: string;
    returnAt: string;
    services?: { serviceId: string; quantity: number }[];
    pickupLocationId?: string;
    /** A CODE, never an amount. The engine decides what it is worth. */
    couponCode?: string;
  }) => postData<QuoteResponse>('/pricing/quote', body),

  listServices: () => getData<{ services: AdditionalService[] }>('/pricing/services'),

  /** What the checkout may offer. Derived from settings, not hardcoded here. */
  listPaymentOptions: () =>
    getData<{ options: PaymentOption[] }>('/pricing/payment-options'),
};
