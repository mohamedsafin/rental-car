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
 *   PENDING ──► DOCUMENT_VERIFICATION ──► CONFIRMED ──► PAYMENT_PENDING
 *                                             │                │
 *                                             └──► READY_FOR_PICKUP ◄┘
 *                                                        │
 *                                                     ACTIVE ◄──► EXTENSION_REQUESTED
 *                                                        │
 *                                                 RETURN_PENDING
 *                                                        │
 *                                                    RETURNED ──► COMPLETED
 *
 * WHAT "CONFIRMED" MEANS, AND WHAT IT NO LONGER MEANS
 *
 * Confirmation is the moment the COMPANY accepts the customer: their documents
 * passed, and the car is being held for them. It is deliberately NOT a receipt.
 * Payment comes after it, which is how the counter actually works - nobody is
 * asked for money before being told they qualify to rent.
 *
 * This inverts the previous order, and one assumption died with it: CONFIRMED
 * used to imply "paid" for an online booking, and the handover leaned on that
 * to decide whether to release keys. It no longer can. The money check now
 * lives in two places instead:
 *
 *   1. an ONLINE booking cannot REACH `READY_FOR_PICKUP` without a successful
 *      rental payment (enforced in the booking service), and
 *   2. no booking of any kind is handed over until a payment is on file
 *      (enforced in the rental service, for cash and card alike).
 *
 * The cash path is unchanged in spirit and now shares the main line:
 * CONFIRMED ──► READY_FOR_PICKUP, with the notes counted at the counter.
 *
 * CANCELLED is reachable from anything before the car is handed over. Once a
 * rental is ACTIVE the vehicle is with the customer, so it must be RETURNED -
 * "cancelling" a car that is currently being driven is not a thing.
 */
import type { BookingStatus } from '@prisma/client';

export const ALLOWED_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  PENDING: ['DOCUMENT_VERIFICATION', 'CONFIRMED', 'CANCELLED'],
  /*
   * Approving the documents IS the confirmation, for card and cash alike.
   * There is no longer a payment status wedged in between, so no customer
   * gets asked for money before being told they qualify.
   */
  DOCUMENT_VERIFICATION: ['CONFIRMED', 'CANCELLED'],
  /*
   * Two ways out, and which one is legitimate depends on how they are paying:
   *
   *   PAYMENT_PENDING  - an online customer has started checkout.
   *   READY_FOR_PICKUP - nothing is owed online, i.e. pay-at-pickup.
   *
   * An ONLINE booking taking the second door without a cleared payment is the
   * hole this reordering could have opened, so `changeStatus` closes it.
   */
  CONFIRMED: ['PAYMENT_PENDING', 'READY_FOR_PICKUP', 'CANCELLED'],
  PAYMENT_PENDING: ['READY_FOR_PICKUP', 'CANCELLED'],
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
