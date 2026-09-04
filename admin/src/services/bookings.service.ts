/**
 * services/bookings.service.ts
 * ---------------------------------------------------------------------------
 * Booking API calls.
 *
 * Note what `create` sends: the CHOICE, never a price. The backend recomputes
 * every amount from its own pricing engine.
 */
import { getData, postData, patchData } from './api';
import type { PaginatedData } from '../types/api';
import type { Booking, BookingStatus } from '../types/booking';

export const bookingsService = {
  create: (input: {
    vehicleId: string;
    pickupAt: string;
    returnAt: string;
    pickupLocationId?: string;
    dropoffLocationId?: string;
    services?: { serviceId: string; quantity: number }[];
    customerNotes?: string;
  }) => postData<{ booking: Booking }>('/bookings', input),

  myBookings: (params: { page?: number; limit?: number; scope?: string }) =>
    getData<PaginatedData<Booking>>('/bookings/me', params),

  getById: (id: string) => getData<{ booking: Booking }>(`/bookings/${id}`),

  cancel: (id: string, reason?: string) =>
    postData<{ booking: Booking }>(`/bookings/${id}/cancel`, { reason }),

  // --- Staff ---------------------------------------------------------------

  list: (params: Record<string, unknown>) => getData<PaginatedData<Booking>>('/bookings', params),

  changeStatus: (id: string, status: BookingStatus, reason?: string) =>
    patchData<{ booking: Booking }>(`/bookings/${id}/status`, { status, reason }),
};
