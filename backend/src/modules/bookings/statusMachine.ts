/**
 * modules/bookings/statusMachine.ts
 * ---------------------------------------------------------------------------
 * The booking lifecycle from BRD 21, written as data rather than scattered
 * `if` statements.
 *
 * Why a transition map instead of ad-hoc checks: without one, "can this
 * booking be cancelled?" gets re-answered slightly differently in the customer
 * route, the admin route and the return flow - and eventually a COMPLETED
 * booking gets cancelled, or an ACTIVE rental jumps straight to COMPLETED
 * without anyone recording the car coming back.
 *
 * The order follows BRD 3 and 53: documents are verified BEFORE payment.
 *
 *   PENDING ─────────────► DOCUMENT_VERIFICATION ──► PAYMENT_PENDING
 *      │                            │                      │
 *      └──────────────────────── CONFIRMED ◄───────────────┘
 *                                   │
 *                          READY_FOR_PICKUP
 *                                   │
 *                                ACTIVE ◄──► EXTENSION_REQUESTED
 *                                   │
 *                            RETURN_PENDING
 *                                   │
 *                               RETURNED ──► COMPLETED
 *
 * CANCELLED is reachable from anything before the car is handed over. Once a
 * rental is ACTIVE the vehicle is with the customer, so it must be RETURNED -
 * "cancelling" a car that is currently being driven is not a thing.
 */
import type { BookingStatus } from '@prisma/client';

export const ALLOWED_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  PENDING: ['DOCUMENT_VERIFICATION', 'PAYMENT_PENDING', 'CANCELLED'],
  DOCUMENT_VERIFICATION: ['PAYMENT_PENDING', 'CANCELLED'],
  PAYMENT_PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['READY_FOR_PICKUP', 'CANCELLED'],
  READY_FOR_PICKUP: ['ACTIVE', 'CANCELLED'],
  ACTIVE: ['EXTENSION_REQUESTED', 'RETURN_PENDING'],
  EXTENSION_REQUESTED: ['ACTIVE', 'RETURN_PENDING'],
  RETURN_PENDING: ['RETURNED'],
  RETURNED: ['COMPLETED'],
  // Terminal.
  COMPLETED: [],
  CANCELLED: [],
};

/** Statuses a customer may cancel from themselves (BRD 31). */
export const CUSTOMER_CANCELLABLE: BookingStatus[] = [
  'PENDING',
  'DOCUMENT_VERIFICATION',
  'PAYMENT_PENDING',
  'CONFIRMED',
];

/** Statuses that mean the rental has not started and the car is still ours. */
export const PRE_PICKUP: BookingStatus[] = [
  'PENDING',
  'DOCUMENT_VERIFICATION',
  'PAYMENT_PENDING',
  'CONFIRMED',
  'READY_FOR_PICKUP',
];

export const TERMINAL: BookingStatus[] = ['COMPLETED', 'CANCELLED'];

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** Human-readable labels, matching the BRD's own wording. */
export const STATUS_LABELS: Record<BookingStatus, string> = {
  PENDING: 'Pending',
  PAYMENT_PENDING: 'Payment pending',
  DOCUMENT_VERIFICATION: 'Document verification',
  CONFIRMED: 'Confirmed',
  READY_FOR_PICKUP: 'Ready for pickup',
  ACTIVE: 'Active',
  EXTENSION_REQUESTED: 'Extension requested',
  RETURN_PENDING: 'Return pending',
  RETURNED: 'Returned',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};
