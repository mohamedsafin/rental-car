/**
 * modules/bookings/types.ts
 * ---------------------------------------------------------------------------
 * The public booking shape.
 *
 * Every money field is the SNAPSHOT stored on the booking, not a live lookup.
 * If the admin raises the daily rate tomorrow, this booking still shows what
 * the customer agreed to today - which is the whole reason those columns exist
 * rather than being derived on read.
 */
import type {
  Booking,
  BookingService,
  BookingStatus,
  BookingStatusHistory,
  Location,
  Prisma,
  User,
  Vehicle,
  VehicleImage,
} from '@prisma/client';
import { STATUS_LABELS } from './statusMachine';

export const bookingInclude = {
  vehicle: { include: { images: true, category: true } },
  customer: { select: { id: true, fullName: true, email: true, phone: true } },
  pickupLocation: true,
  dropoffLocation: true,
  services: true,
  statusHistory: { orderBy: { createdAt: 'asc' } },
} as const;

export type BookingWithRelations = Booking & {
  vehicle: Vehicle & { images: VehicleImage[]; category: { id: string; name: string } };
  customer: Pick<User, 'id' | 'fullName' | 'email' | 'phone'>;
  pickupLocation: Location | null;
  dropoffLocation: Location | null;
  services: BookingService[];
  statusHistory: BookingStatusHistory[];
};

const money = (value: Prisma.Decimal): string => value.toFixed(2);

export interface PublicBooking {
  id: string;
  bookingNumber: string;
  status: BookingStatus;
  statusLabel: string;

  vehicle: {
    id: string;
    name: string;
    year: number;
    category: string;
    /** Admin view only - internal fleet data. */
    registrationNumber: string | null;
    /** Admin view only. The handover form validates the new reading against it. */
    currentMileage: number | null;
    imageUrl: string | null;
  };

  /** Present for staff; a customer already knows who they are. */
  customer: { id: string; fullName: string; email: string; phone: string | null } | null;

  period: {
    pickupAt: string;
    returnAt: string;
    rentalDays: number;
  };

  locations: {
    pickup: { id: string; name: string } | null;
    dropoff: { id: string; name: string } | null;
  };

  services: {
    id: string;
    name: string;
    quantity: number;
    unitPrice: string;
    chargeType: string;
    lineTotal: string;
  }[];

  pricing: {
    currency: string;
    vehicleSubtotal: string;
    servicesSubtotal: string;
    deliveryFee: string;
    discountAmount: string;
    taxAmount: string;
    /** Rental total, excluding the refundable deposit. */
    totalAmount: string;
    securityDeposit: string;
    totalPayable: string;
  };

  cancellation: {
    cancelledAt: string | null;
    reason: string | null;
    fee: string;
    refundDue: string;
  } | null;

  /** When an unpaid booking loses its hold on the vehicle. */
  holdExpiresAt: string | null;
  customerNotes: string | null;
  /** Internal - never sent to a customer. */
  staffNotes: string | null;

  statusHistory: {
    from: BookingStatus | null;
    to: BookingStatus;
    reason: string | null;
    at: string;
  }[];

  createdAt: string;
}

/**
 * @param includePrivate  Staff view. Adds the plate, the customer block and
 *   internal staff notes - none of which a customer needs or should see.
 */
export function toPublicBooking(
  booking: BookingWithRelations,
  includePrivate = false,
): PublicBooking {
  const primaryImage =
    booking.vehicle.images.find((image) => image.isPrimary) ?? booking.vehicle.images[0];

  const name = [booking.vehicle.brand, booking.vehicle.model, booking.vehicle.variant]
    .filter(Boolean)
    .join(' ');

  return {
    id: booking.id,
    bookingNumber: booking.bookingNumber,
    status: booking.status,
    statusLabel: STATUS_LABELS[booking.status],

    vehicle: {
      id: booking.vehicle.id,
      name,
      year: booking.vehicle.year,
      category: booking.vehicle.category.name,
      registrationNumber: includePrivate ? booking.vehicle.registrationNumber : null,
      currentMileage: includePrivate ? booking.vehicle.currentMileage : null,
      // Built here rather than stored: the storage provider owns URL shape.
      imageUrl: primaryImage ? `/uploads/${primaryImage.storageKey.replace(/^public\//, '')}` : null,
    },

    customer: includePrivate ? booking.customer : null,

    period: {
      pickupAt: booking.pickupAt.toISOString(),
      returnAt: booking.returnAt.toISOString(),
      rentalDays: booking.rentalDays,
    },

    locations: {
      pickup: booking.pickupLocation
        ? { id: booking.pickupLocation.id, name: booking.pickupLocation.name }
        : null,
      dropoff: booking.dropoffLocation
        ? { id: booking.dropoffLocation.id, name: booking.dropoffLocation.name }
        : null,
    },

    services: booking.services.map((service) => ({
      id: service.id,
      name: service.name,
      quantity: service.quantity,
      unitPrice: money(service.unitPrice),
      chargeType: service.chargeType,
      lineTotal: money(service.lineTotal),
    })),

    pricing: {
      currency: booking.currency,
      vehicleSubtotal: money(booking.vehicleSubtotal),
      servicesSubtotal: money(booking.servicesSubtotal),
      deliveryFee: money(booking.deliveryFee),
      discountAmount: money(booking.discountAmount),
      taxAmount: money(booking.taxAmount),
      totalAmount: money(booking.totalAmount),
      securityDeposit: money(booking.securityDeposit),
      totalPayable: money(booking.totalAmount.add(booking.securityDeposit)),
    },

    cancellation: booking.cancelledAt
      ? {
          cancelledAt: booking.cancelledAt.toISOString(),
          reason: booking.cancellationReason,
          fee: money(booking.cancellationFee),
          refundDue: money(booking.refundDueAmount),
        }
      : null,

    holdExpiresAt: booking.holdExpiresAt?.toISOString() ?? null,
    customerNotes: booking.customerNotes,
    staffNotes: includePrivate ? booking.staffNotes : null,

    statusHistory: booking.statusHistory.map((entry) => ({
      from: entry.fromStatus,
      to: entry.toStatus,
      reason: entry.reason,
      at: entry.createdAt.toISOString(),
    })),

    createdAt: booking.createdAt.toISOString(),
  };
}
