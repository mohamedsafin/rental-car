/**
 * modules/vehicles/types.ts
 * ---------------------------------------------------------------------------
 * The public shape of a vehicle, and the mapper that produces it.
 *
 * Two jobs beyond hiding fields:
 *
 *  1. Prisma returns `Decimal` objects for money columns. Serialised naively
 *     those become `{"s":1,"e":2,"d":[250]}` - useless to a browser. We convert
 *     to a fixed 2-decimal STRING, not a number, so no precision is lost on the
 *     way out either.
 *
 *  2. Image URLs are built here from the stored key. The database holds an
 *     opaque key; the URL is derived at read time, so moving from local disk to
 *     S3 changes one provider file and no data.
 */
import type {
  Prisma,
  Vehicle,
  VehicleCategory,
  VehicleImage,
  Location as PrismaLocation,
} from '@prisma/client';
import { storage } from '../../services/storage';

export type VehicleWithRelations = Vehicle & {
  category: VehicleCategory;
  location?: PrismaLocation | null;
  images: VehicleImage[];
  features: { feature: { id: string; name: string; slug: string; icon: string | null } }[];
};

export interface PublicVehicleImage {
  id: string;
  url: string;
  type: string;
  altText: string;
  isPrimary: boolean;
  sortOrder: number;
}

export interface PublicVehicle {
  id: string;
  brand: string;
  model: string;
  year: number;
  variant: string | null;
  name: string;
  /*
   * Null for the public site. A plate and a chassis number identify a specific
   * car to anyone who wants to look it up, and a browsing customer has no use
   * for either - they are shown to staff only.
   */
  registrationNumber: string | null;
  vin: string | null;
  category: { id: string; name: string; slug: string };
  location: { id: string; name: string } | null;
  seats: number;
  doors: number;
  transmission: string;
  fuelType: string;
  color: string | null;
  pricing: {
    daily: string;
    weekly: string | null;
    monthly: string | null;
    securityDeposit: string;
    currency: 'AED';
  };
  mileage: { limitPerDay: number | null; extraCharge: string | null };
  status: string;
  /// Odometer. Staff only - see `registrationNumber`.
  currentMileage: number | null;
  /*
   * What the car cost and what it is worth now. Staff only, and null where
   * nobody recorded it, which is different from zero.
   */
  purchase: {
    price: string | null;
    date: string | null;
    currentValue: string | null;
  } | null;
  isFeatured: boolean;
  isPublished: boolean;
  description: string | null;
  images: PublicVehicleImage[];
  primaryImageUrl: string | null;
  features: { id: string; name: string; slug: string; icon: string | null }[];
  createdAt: string;
}

/** Decimal -> "250.00". Fixed 2 places so the UI never has to format money. */
function money(value: Prisma.Decimal | null): string | null {
  return value === null ? null : value.toFixed(2);
}

/**
 * @param includePrivate  Admin view. Adds the registration number, which is
 *   internal fleet data with no reason to appear on a public listing.
 */
export async function toPublicVehicle(
  vehicle: VehicleWithRelations,
  includePrivate = false,
): Promise<PublicVehicle> {
  const name = [vehicle.brand, vehicle.model, vehicle.variant].filter(Boolean).join(' ');

  const sorted = [...vehicle.images].sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    return a.sortOrder - b.sortOrder;
  });

  const images = await Promise.all(
    sorted.map(async (image) => ({
      id: image.id,
      url: await storage.getUrl(image.storageKey),
      type: image.type,
      altText: image.altText ?? `${name} - ${image.type.toLowerCase().replace(/_/g, ' ')}`,
      isPrimary: image.isPrimary,
      sortOrder: image.sortOrder,
    })),
  );

  return {
    id: vehicle.id,
    brand: vehicle.brand,
    model: vehicle.model,
    year: vehicle.year,
    variant: vehicle.variant,
    name,
    registrationNumber: includePrivate ? vehicle.registrationNumber : null,
    vin: includePrivate ? vehicle.vin : null,
    category: {
      id: vehicle.category.id,
      name: vehicle.category.name,
      slug: vehicle.category.slug,
    },
    location: vehicle.location ? { id: vehicle.location.id, name: vehicle.location.name } : null,
    seats: vehicle.seats,
    doors: vehicle.doors,
    transmission: vehicle.transmission,
    fuelType: vehicle.fuelType,
    color: vehicle.color,
    pricing: {
      daily: money(vehicle.dailyPrice) as string,
      weekly: money(vehicle.weeklyPrice),
      monthly: money(vehicle.monthlyPrice),
      securityDeposit: money(vehicle.securityDeposit) as string,
      // AED is fixed by BRD 49. Other currencies are a client decision.
      currency: 'AED',
    },
    mileage: {
      limitPerDay: vehicle.mileageLimitPerDay,
      extraCharge: money(vehicle.extraMileageCharge),
    },
    status: vehicle.status,
    currentMileage: includePrivate ? vehicle.currentMileage : null,
    purchase: includePrivate
      ? {
          price: money(vehicle.purchasePrice),
          date: vehicle.purchaseDate?.toISOString().slice(0, 10) ?? null,
          currentValue: money(vehicle.currentValue),
        }
      : null,
    isFeatured: vehicle.isFeatured,
    isPublished: vehicle.isPublished,
    description: vehicle.description,
    images,
    primaryImageUrl: images[0]?.url ?? null,
    features: vehicle.features.map((link) => link.feature),
    createdAt: vehicle.createdAt.toISOString(),
  };
}

/** The relations every vehicle read needs. Reused so the shape never drifts. */
export const vehicleInclude = {
  category: true,
  location: true,
  images: true,
  features: { include: { feature: true } },
} as const;
