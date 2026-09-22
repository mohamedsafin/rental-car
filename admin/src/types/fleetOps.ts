/**
 * types/fleetOps.ts
 * ---------------------------------------------------------------------------
 * Shapes returned by the Phase 9 endpoints.
 *
 * Every money field is a STRING. The backend serialises Decimal(10,2) as a
 * fixed two-decimal string precisely so it never passes through a JS float,
 * and mirroring that here means TypeScript stops anyone doing arithmetic on it
 * in a component.
 */

export type DamageStatus = 'REPORTED' | 'ASSESSED' | 'APPROVED' | 'DISMISSED' | 'CHARGED';
export type RecoveryStatus = 'RECORDED' | 'ASSIGNED' | 'RECOVERED' | 'WAIVED' | 'DISPUTED';
export type MaintenanceStatus = 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

export interface Damage {
  id: string;
  vehicleId: string;
  bookingId: string | null;
  type: string;
  status: DamageStatus;
  description: string;
  location: string | null;
  estimatedAmount: string | null;
  approvedAmount: string | null;
  assessmentNotes: string | null;
  currency: string;
  photos: { id: string; caption: string | null; url: string }[];
  approvedAt: string | null;
  vehicle?: string;
  bookingNumber?: string | null;
  createdAt: string;
}

export interface TrafficFine {
  id: string;
  vehicleId: string;
  bookingId: string | null;
  fineNumber: string;
  /**
   * Traffic or parking - which decides who the customer disputes it with.
   *
   * A traffic fine comes from the police and can carry black points against
   * whoever was driving; a parking fine comes from the municipality or a mall
   * and never does.
   */
  fineType: 'TRAFFIC' | 'PARKING' | 'OTHER';
  violationAt: string;
  violation: string | null;
  location: string | null;
  amount: string;
  serviceFee: string;
  total: string;
  currency: string;
  status: RecoveryStatus;
  notes: string | null;
  vehicle?: string;
  bookingNumber?: string | null;
  /** Its rental is finished or cancelled, so nothing further can be charged. */
  bookingClosed?: boolean;
}

export interface TollCharge {
  id: string;
  vehicleId: string;
  bookingId: string | null;
  crossedAt: string;
  gate: string | null;
  reference: string | null;
  amount: string;
  serviceFee: string;
  total: string;
  currency: string;
  status: RecoveryStatus;
  vehicle?: string;
  bookingNumber?: string | null;
  /** Its rental is finished or cancelled, so nothing further can be charged. */
  bookingClosed?: boolean;
}

export interface MaintenanceRecord {
  id: string;
  vehicleId: string;
  type: string;
  status: MaintenanceStatus;
  startsAt: string;
  endsAt: string;
  description: string;
  provider: string | null;
  mileage: number | null;
  cost: string | null;
  currency: string;
  nextServiceAt: string | null;
  nextServiceMileage: number | null;
  notes: string | null;
  vehicle?: string;
}

export interface InsurancePolicy {
  id: string;
  vehicleId: string;
  provider: string;
  policyNumber: string;
  coverType: string | null;
  startDate: string;
  expiryDate: string;
  premium: string | null;
  /** The hirer's exposure before the insurer pays. Null where not recorded. */
  excessAmount: string | null;
  currency: string;
  isActive: boolean;
  notes: string | null;
}

export interface VehicleDocument {
  id: string;
  vehicleId: string;
  type: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  documentNumber: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  notes: string | null;
  createdAt: string;
}

export interface ExpiryItem {
  kind: 'INSURANCE' | 'DOCUMENT';
  id: string;
  vehicleId: string;
  vehicle: string;
  label: string;
  expiryDate: string;
  /** Negative means it has already lapsed. */
  daysRemaining: number;
}

/**
 * A car due a service, by date or by odometer.
 *
 * Both targets are optional and reported separately rather than combined: a
 * car can be four months early on time and 900km late on distance, and one
 * number would hide both.
 */
export interface ServiceDueItem {
  kind: 'SERVICE';
  id: string;
  vehicleId: string;
  vehicle: string;
  label: string;
  dueDate: string | null;
  daysRemaining: number | null;
  dueMileage: number | null;
  currentMileage: number;
  kmRemaining: number | null;
  overdue: boolean;
}

export interface ExpiryDashboard {
  reminderDays: number[];
  horizonDays: number;
  expired: ExpiryItem[];
  dueSoon: ExpiryItem[];
  serviceDue: ServiceDueItem[];
}
