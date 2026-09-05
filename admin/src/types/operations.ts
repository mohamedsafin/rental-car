/**
 * types/operations.ts
 * ---------------------------------------------------------------------------
 * Shapes for the day-to-day boards.
 */

export interface Inspection {
  id: string;
  type: 'PICKUP' | 'RETURN';
  mileage: number;
  fuelPercent: number;
  conditionNotes: string | null;
  cleanliness: string | null;
  damageNotes: string | null;
  photoCount: number;
  inspectedBy: string | null;
  bookingId: string;
  bookingNumber: string;
  customer: string;
  vehicle: string;
  registrationNumber: string;
  createdAt: string;
}
