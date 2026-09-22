/**
 * types/vehicle.ts
 * ---------------------------------------------------------------------------
 * Fleet contracts, mirroring the backend's PublicVehicle.
 *
 * Note every money field is a STRING. That is deliberate all the way from
 * Postgres' DECIMAL through to here: parsing "650.00" into a JavaScript number
 * to display it would reintroduce the floating-point error the backend went to
 * trouble to avoid. Display it; do not compute with it. Totals come from the
 * backend's pricing engine in Phase 4.
 */

export type Transmission = 'AUTOMATIC' | 'MANUAL';
export type FuelType = 'PETROL' | 'DIESEL' | 'HYBRID' | 'ELECTRIC';
export type VehicleStatus =
  | 'AVAILABLE'
  | 'RESERVED'
  | 'RENTED'
  | 'UNDER_INSPECTION'
  | 'UNDER_MAINTENANCE'
  | 'UNAVAILABLE';

export interface VehicleCategory {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  displayOrder?: number;
  isActive?: boolean;
  _count?: { vehicles: number };
}

export interface VehicleFeature {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
}

export interface VehicleImage {
  id: string;
  url: string;
  type: string;
  altText: string;
  isPrimary: boolean;
  sortOrder: number;
}

export interface Vehicle {
  id: string;
  brand: string;
  model: string;
  year: number;
  variant: string | null;
  name: string;
  /** Null on the public view; only admins receive the plate. */
  registrationNumber: string | null;
  /** Chassis number. Staff only, like the plate. */
  vin: string | null;
  category: { id: string; name: string; slug: string };
  location: { id: string; name: string } | null;
  seats: number;
  doors: number;
  transmission: Transmission;
  fuelType: FuelType;
  color: string | null;
  pricing: {
    daily: string;
    weekly: string | null;
    monthly: string | null;
    securityDeposit: string;
    currency: 'AED';
  };
  mileage: { limitPerDay: number | null; extraCharge: string | null };
  status: VehicleStatus;
  /** Odometer. Staff only, and null where it was never recorded. */
  currentMileage: number | null;
  /** What the car cost and is worth. Staff only; null on the public view. */
  purchase: { price: string | null; date: string | null; currentValue: string | null } | null;
  isFeatured: boolean;
  isPublished: boolean;
  description: string | null;
  images: VehicleImage[];
  primaryImageUrl: string | null;
  features: VehicleFeature[];
  createdAt: string;
}

export interface Location {
  id: string;
  name: string;
  slug: string;
  type: 'OFFICE' | 'AIRPORT' | 'HOTEL' | 'DELIVERY_AREA';
  address: string | null;
  emirate: string | null;
  phone: string | null;
  email: string | null;
  workingHours: unknown;
  latitude: string | null;
  longitude: string | null;
  deliveryCharge: string;
  isPickupPoint: boolean;
  isDropoffPoint: boolean;
  isActive: boolean;
}

export interface VehicleFilters {
  page?: number;
  limit?: number;
  category?: string;
  categoryId?: string;
  transmission?: Transmission;
  fuelType?: FuelType;
  seats?: number;
  minPrice?: number;
  maxPrice?: number;
  search?: string;
  sort?: 'price_asc' | 'price_desc' | 'newest' | 'year_desc';
  status?: VehicleStatus;
  includeUnpublished?: boolean;
}
