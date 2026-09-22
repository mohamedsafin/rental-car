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
  AdditionalCharge,
  Booking,
  RentalInstalment,
  BookingService,
  BookingStatus,
  BookingStatusHistory,
  Location,
  Payment,
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
  /*
   * Enough to answer "has the rental been paid for?" and nothing else.
   *
   * Since confirmation moved ahead of payment, no status answers that question
   * any more - CONFIRMED means the documents passed, not that money arrived -
   * yet two rules depend on the answer: an online booking cannot be marked
   * ready for pickup unpaid, and nothing is handed over unpaid. A UI that
   * cannot see it can only offer the button and let the server say no, which
   * is how staff end up reading a refusal as a fault.
   */
  payments: { select: { type: true, status: true } },
  /*
   * Everything charged on top of the rental: fines, Salik, fuel, cleaning,
   * late return, damage.
   *
   * On the BOOKING rather than the rental, because that is where they are
   * recorded - and because a charge can outlive or precede a rental row. They
   * were previously reachable only through the rental endpoint, behind an
   * `if (!rental) return null`, so a fine recovered against a booking with no
   * rental was invisible to everyone including the customer who paid it.
   */
  /// The monthly payment schedule, for a long-term booking. Empty otherwise.
  instalments: { orderBy: { sequence: 'asc' } },
  additionalCharges: {
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      type: true,
      amount: true,
      currency: true,
      description: true,
      status: true,
      createdAt: true,
      // Which month it was billed with, so the schedule can show it under the
      // right row rather than as a loose charge nobody can place.
      instalmentId: true,
    },
  },
} as const;

export type BookingWithRelations = Booking & {
  vehicle: Vehicle & { images: VehicleImage[]; category: { id: string; name: string } };
  customer: Pick<User, 'id' | 'fullName' | 'email' | 'phone'>;
  pickupLocation: Location | null;
  dropoffLocation: Location | null;
  services: BookingService[];
  statusHistory: BookingStatusHistory[];
  payments: Pick<Payment, 'type' | 'status'>[];
  instalments: RentalInstalment[];
  additionalCharges: Pick<
    AdditionalCharge,
    'id' | 'type' | 'amount' | 'currency' | 'description' | 'status' | 'createdAt' | 'instalmentId'
  >[];
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

  /** How this booking is being paid for. Fixed at checkout. */
  paymentMethod: 'ONLINE' | 'CASH_ON_PICKUP';

  /**
   * UPFRONT, or MONTHLY for a long-term rental billed month by month.
   *
   * On a MONTHLY booking `totalAmount` is the whole term - useful for a
   * contract, useless as a thing to ask for at checkout. What is actually
   * payable now is the first unpaid row in `instalments`.
   */
  billingCycle: 'UPFRONT' | 'MONTHLY';
  termMonths: number | null;

  /** One row per month. Empty on an upfront booking. */
  instalments: {
    id: string;
    sequence: number;
    periodStart: string;
    periodEnd: string;
    dueAt: string;
    /** The rent. Fixed for the whole term. */
    amount: string;
    /** Salik, fines and anything else billed with this month. Usually 0.00. */
    extrasAmount: string;
    /** Rent + extras: what this month's payment will actually ask for. */
    totalDue: string;
    currency: string;
    status: string;
    paidAt: string | null;
  }[];
  /**
   * Has a rental payment actually cleared?
   *
   * Separate from `status`, because since confirmation moved ahead of payment
   * no status implies it. Refunded counts as cleared: the money did arrive,
   * and whether it was later sent back is a different question from whether
   * this booking ever got past the payment step.
   */
  rentalPaid: boolean;

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

  /**
   * Charges raised on top of the rental - fines, Salik, fuel, cleaning, late
   * return, damage - with what happened to each.
   *
   *   SETTLED_FROM_DEPOSIT  taken out of the deposit
   *   PENDING / INVOICED    still owed
   *   WAIVED                written off
   *
   * The customer sees these. Money leaving their deposit with no line
   * explaining it is how a recovery becomes a dispute.
   */
  additionalCharges: {
    id: string;
    type: string;
    amount: string;
    currency: string;
    description: string | null;
    status: string;
    at: string;
    /** Set when it was billed with a month of a long-term rental. */
    instalmentId: string | null;
  }[];

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

    paymentMethod: booking.paymentMethod,
    billingCycle: booking.billingCycle,
    termMonths: booking.termMonths,
    instalments: booking.instalments.map((row) => ({
      id: row.id,
      sequence: row.sequence,
      periodStart: row.periodStart.toISOString(),
      periodEnd: row.periodEnd.toISOString(),
      dueAt: row.dueAt.toISOString(),
      amount: money(row.amount),
      extrasAmount: money(row.extrasAmount),
      totalDue: money(row.amount.add(row.extrasAmount)),
      currency: row.currency,
      status: row.status,
      paidAt: row.paidAt?.toISOString() ?? null,
    })),
    rentalPaid: booking.payments.some(
      (payment) =>
        payment.type === 'RENTAL' &&
        (payment.status === 'SUCCESS' ||
          payment.status === 'REFUNDED' ||
          payment.status === 'PARTIALLY_REFUNDED'),
    ),

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

    additionalCharges: booking.additionalCharges.map((charge) => ({
      id: charge.id,
      type: charge.type,
      amount: money(charge.amount),
      currency: charge.currency,
      description: charge.description,
      status: charge.status,
      at: charge.createdAt.toISOString(),
      instalmentId: charge.instalmentId,
    })),

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
