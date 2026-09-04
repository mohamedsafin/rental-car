/**
 * types/rental.ts
 * ---------------------------------------------------------------------------
 * Rental, inspection, charge and extension contracts.
 */

export type RentalStatus = 'ACTIVE' | 'RETURNED' | 'CLOSED';
export type InspectionType = 'PICKUP' | 'RETURN';
export type ChargeType = 'LATE_RETURN' | 'EXCESS_MILEAGE' | 'FUEL' | 'CLEANING' | 'DAMAGE' | 'OTHER';
export type ChargeStatus = 'PENDING' | 'SETTLED_FROM_DEPOSIT' | 'INVOICED' | 'WAIVED';
export type ExtensionStatus = 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'PAID';

export type InspectionPhotoType =
  | 'FRONT'
  | 'REAR'
  | 'LEFT_SIDE'
  | 'RIGHT_SIDE'
  | 'INTERIOR'
  | 'DASHBOARD'
  | 'ODOMETER'
  | 'DAMAGE'
  | 'OTHER';

export interface InspectionPhoto {
  id: string;
  type: InspectionPhotoType;
  caption: string | null;
  /** Public URL - these are pictures of a car, not identity documents. */
  url: string;
}

export interface Inspection {
  id: string;
  type: InspectionType;
  mileage: number;
  fuelPercent: number;
  conditionNotes: string | null;
  damageNotes: string | null;
  cleanliness: string | null;
  accessories: unknown;
  customerVerified: boolean;
  createdAt: string;
  photos: InspectionPhoto[];
}

export interface AdditionalCharge {
  id: string;
  type: ChargeType;
  status: ChargeStatus;
  amount: string;
  currency: string;
  description: string;
  /** How the figure was reached, kept for disputes. */
  calculation: unknown;
}

export interface Rental {
  id: string;
  bookingId: string;
  bookingNumber: string;
  status: RentalStatus;
  pickedUpAt: string;
  returnedAt: string | null;
  dueBackAt: string;
  pickupMileage: number;
  returnMileage: number | null;
  pickupFuelPercent: number;
  returnFuelPercent: number | null;
  distanceDriven: number | null;
  inspections: Inspection[];
  charges: AdditionalCharge[];
  chargeTotal: string;
}

export interface Extension {
  id: string;
  bookingId: string;
  originalReturnAt: string;
  requestedReturnAt: string;
  status: ExtensionStatus;
  additionalDays: number;
  additionalAmount: string;
  currency: string;
  rejectionReason: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

/** BRD 25's recommended shot list. */
export const PHOTO_TYPES: { value: InspectionPhotoType; label: string }[] = [
  { value: 'FRONT', label: 'Front' },
  { value: 'REAR', label: 'Rear' },
  { value: 'LEFT_SIDE', label: 'Left side' },
  { value: 'RIGHT_SIDE', label: 'Right side' },
  { value: 'INTERIOR', label: 'Interior' },
  { value: 'DASHBOARD', label: 'Dashboard' },
  { value: 'ODOMETER', label: 'Odometer' },
  { value: 'DAMAGE', label: 'Damage' },
  { value: 'OTHER', label: 'Other' },
];

export const CHARGE_LABELS: Record<ChargeType, string> = {
  LATE_RETURN: 'Late return',
  EXCESS_MILEAGE: 'Excess mileage',
  FUEL: 'Fuel',
  CLEANING: 'Cleaning',
  DAMAGE: 'Damage',
  OTHER: 'Other',
};

export const CHARGE_STATUS_STYLE: Record<ChargeStatus, string> = {
  PENDING: 'bg-amber-100 text-amber-800',
  SETTLED_FROM_DEPOSIT: 'bg-emerald-100 text-emerald-800',
  INVOICED: 'bg-sky-100 text-sky-800',
  WAIVED: 'bg-slate-200 text-slate-600',
};
