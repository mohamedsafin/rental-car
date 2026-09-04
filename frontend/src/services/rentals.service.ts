/**
 * services/rentals.service.ts
 * ---------------------------------------------------------------------------
 * Pickup, return, inspection photos, charges and extensions.
 */
import { api, getData, postData, patchData } from './api';
import type { Extension, Rental } from '../types/rental';

export interface RentalResponse {
  rental: Rental | null;
  extensions: Extension[];
}

export const rentalsService = {
  getForBooking: (bookingId: string) =>
    getData<RentalResponse>(`/rentals/booking/${bookingId}`),

  recordPickup: (
    bookingId: string,
    body: {
      mileage: number;
      fuelPercent: number;
      customerVerified: boolean;
      conditionNotes?: string;
      damageNotes?: string;
      accessories?: string[];
    },
  ) => postData<{ rental: Rental }>(`/rentals/booking/${bookingId}/pickup`, body),

  recordReturn: (
    bookingId: string,
    body: {
      mileage: number;
      fuelPercent: number;
      conditionNotes?: string;
      damageNotes?: string;
      cleanliness?: string;
      needsCleaning: boolean;
      missingAccessories?: string[];
    },
  ) =>
    postData<{
      rental: Rental;
      charges: { type: string; amount: string; description: string }[];
      chargeTotal: string;
      warnings: string[];
    }>(`/rentals/booking/${bookingId}/return`, body),

  close: (bookingId: string) => postData<{ rental: Rental }>(`/rentals/booking/${bookingId}/close`),

  /**
   * Upload inspection photos.
   *
   * Content-Type is undefined so the browser adds the multipart boundary
   * itself - setting it by hand produces a request the server cannot parse.
   */
  async uploadPhotos(inspectionId: string, files: File[], type: string) {
    const form = new FormData();
    files.forEach((file) => form.append('images', file));

    const response = await api.post(`/rentals/inspections/${inspectionId}/photos?type=${type}`, form, {
      headers: { 'Content-Type': undefined },
    });
    return response.data.data as { rental: Rental };
  },

  settleCharge: (chargeId: string) =>
    postData<{ rental: Rental }>(`/rentals/charges/${chargeId}/settle`),

  waiveCharge: (chargeId: string, reason: string) =>
    postData<{ rental: Rental }>(`/rentals/charges/${chargeId}/waive`, { reason }),

  requestExtension: (bookingId: string, requestedReturnAt: string) =>
    postData<{ extension: Extension }>(`/rentals/booking/${bookingId}/extensions`, {
      requestedReturnAt,
    }),

  reviewExtension: (extensionId: string, approve: boolean, rejectionReason?: string) =>
    patchData<{ extension: Extension }>(`/rentals/extensions/${extensionId}/review`, {
      approve,
      rejectionReason,
    }),
};
