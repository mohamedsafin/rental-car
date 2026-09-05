/**
 * docs/descriptions.ts
 * ---------------------------------------------------------------------------
 * The hand-written half of the OpenAPI document.
 *
 * Paths and security requirements are generated from the router; this file
 * supplies what a generator cannot know - WHY an endpoint behaves the way it
 * does. "POST /payments/webhook" is easy to generate and useless without the
 * sentence explaining that it is the only thing in the system permitted to
 * confirm a booking.
 *
 * Keyed by "METHOD /path" exactly as `routeInventory` reports it. A key that
 * matches nothing is silently ignored; an endpoint with no key is counted and
 * reported by the generator, so gaps are visible rather than invisible.
 */

export interface EndpointDoc {
  summary: string;
  description?: string;
  requestBody?: unknown;
}

export const TAG_DESCRIPTIONS: Record<string, string> = {
  auth: 'Registration, login, token refresh and password changes.',
  users: 'Staff and admin account management. Admin only.',
  customers: 'Customer profiles and their verification state.',
  documents: 'Identity documents. Stored privately and served only through an authorised route.',
  vehicles: 'The fleet catalogue.',
  categories: 'Vehicle categories.',
  features: 'Vehicle features used for filtering.',
  locations: 'Pickup, drop-off and delivery points.',
  availability: 'Dated search. Only returns vehicles genuinely free for the window.',
  pricing: 'Quotes and additional services. The only place a price is calculated.',
  bookings: 'Booking creation, status lifecycle and cancellation.',
  payments: 'Payment sessions, the provider webhook, and refunds.',
  deposits: 'Security deposits and their append-only ledger.',
  rentals: 'Handover, inspections, extensions and return charges.',
  damages: 'Damage assessment. Back-office only.',
  fleet: 'Fines, tolls, maintenance, insurance and document expiry.',
  coupons: 'Promo codes. Back-office only - a customer presents a code, never a list.',
  invoices: 'Tax invoices and credit notes. Issued documents are immutable.',
  notifications: 'The outbound message log and its templates.',
  reports: 'Revenue, bookings and fleet utilisation.',
  legal: 'Versioned terms and policies. Reads are public.',
  admin: 'Administrative configuration.',
  health: 'Liveness and readiness probes.',
};

export const ENDPOINT_DOCS: Record<string, EndpointDoc> = {
  // --- Health -------------------------------------------------------------
  'GET /health/': {
    summary: 'Readiness probe',
    description:
      'Reports whether the API can reach its database. Returns 503 when it cannot, so a load balancer stops sending traffic to an instance that would fail every request.',
  },
  'GET /health/live': {
    summary: 'Liveness probe',
    description:
      'Answers as long as the process is running. Deliberately does NOT touch the database - a liveness probe that fails on a database blip gets the container killed and restarted, which fixes nothing.',
  },

  // --- Auth ---------------------------------------------------------------
  'POST /auth/register': {
    summary: 'Create a customer account',
    description:
      'Always creates a CUSTOMER. A `role` field in the body is stripped before it reaches the handler, so self-promotion is not possible. Rate limited to 5 accounts per hour per address.',
  },
  'POST /auth/login': {
    summary: 'Sign in',
    description:
      'Returns a 15-minute access token and sets a 7-day refresh token as an httpOnly cookie. The response is identical for an unknown email and a wrong password, and takes the same time - a fast "no such user" is an account-enumeration oracle. Locks out after 5 failures in 15 minutes.',
  },
  'POST /auth/refresh': {
    summary: 'Rotate the token pair',
    description:
      'Authenticated by the refresh cookie, not a bearer token. Each refresh issues a new pair and invalidates the old one. Presenting an already-used refresh token revokes the entire token family - the only way that happens is if a token was stolen.',
  },
  'POST /auth/logout': {
    summary: 'End the session',
    description:
      'Revokes the refresh token and clears the cookie. Works with an expired access token on purpose: otherwise a session could not be ended once its access token lapsed.',
  },
  'GET /auth/me': { summary: 'The signed-in user' },
  'PATCH /auth/me': { summary: 'Update your own profile' },
  'POST /auth/change-password': {
    summary: 'Change your password',
    description: 'Requires the current password, and revokes every other session on success.',
  },

  // --- Vehicles and search ------------------------------------------------
  'GET /vehicles/': {
    summary: 'Browse the fleet',
    description:
      'Public catalogue. Staff and admin additionally see unpublished vehicles and registration plates; a customer never receives a plate.',
  },
  'GET /vehicles/:id': { summary: 'One vehicle' },
  'GET /availability/search': {
    summary: 'Search by date',
    description:
      'Returns only vehicles that can actually be booked for the window - bookings, maintenance windows and vehicle status are all applied. Showing a car and revealing at checkout that it is taken is the failure this endpoint exists to prevent.',
  },
  'GET /availability/check': {
    summary: 'Is this vehicle free?',
    description:
      'Two periods overlap when `existingStart < requestedEnd AND existingEnd > requestedStart`. Both comparisons are strict, so a rental ending at 10:00 and another starting at 10:00 do not clash.',
  },
  'GET /availability/:vehicleId/blocked-dates': {
    summary: 'Dates to grey out on a calendar',
  },

  // --- Pricing ------------------------------------------------------------
  'POST /pricing/quote': {
    summary: 'Price a rental',
    description:
      'THE ONLY place a total is calculated. The request carries what the customer CHOSE - vehicle, dates, services, promo code - and receives the arithmetic back. Any total, discount or amount in the body is stripped before the handler sees it. Public: BRD 14 has the customer reviewing the price before signing in.',
  },
  'GET /pricing/services': { summary: 'Optional extras a customer can add' },

  // --- Bookings -----------------------------------------------------------
  'POST /bookings/': {
    summary: 'Create a booking',
    description:
      'Runs in a SERIALIZABLE transaction behind a PostgreSQL exclusion constraint, so two customers booking the same car for overlapping dates cannot both succeed - one gets 409 VEHICLE_UNAVAILABLE. Pricing is recalculated server-side; the client cannot influence the total. Also pins which version of the terms was live at this moment.',
  },
  'POST /bookings/:id/cancel': {
    summary: 'Cancel a booking',
    description:
      'Applies the configured cancellation policy. If no policy is configured no fee is charged and the response says so - a fee is never invented. Any promo code used is released back.',
  },
  'PATCH /bookings/:id/status': {
    summary: 'Move a booking through its lifecycle',
    description: 'Staff only. Transitions are checked against an explicit state machine.',
  },

  // --- Payments -----------------------------------------------------------
  'POST /payments/initiate': {
    summary: 'Start a payment',
    description:
      'Creates a payment session with the provider. Creating a session confirms nothing - only the webhook can do that.',
  },
  'POST /payments/webhook': {
    summary: 'Provider callback - the only thing that confirms a booking',
    description:
      'Authenticated by an HMAC signature over the RAW request bytes, compared with a timing-safe equality check. Four gates must pass: valid signature, known event, not already processed (idempotency), and the amount matches what we recorded. The browser never confirms a payment; a client saying "it worked" is the single most common way rental systems get defrauded.',
  },
  'POST /payments/:id/refund': { summary: 'Refund a payment. Admin only.' },

  // --- Deposits and rentals ----------------------------------------------
  'GET /deposits/booking/:bookingId': {
    summary: 'A deposit and its ledger',
    description:
      'The balance is the sum of an append-only ledger, never an edited number. When a customer disputes a deduction, the ledger is the answer.',
  },
  'POST /rentals/booking/:bookingId/pickup': { summary: 'Hand the vehicle over' },
  'POST /rentals/booking/:bookingId/return': {
    summary: 'Take the vehicle back and calculate charges',
    description:
      'Late fees, fuel, mileage and cleaning are computed from the configured rates. Any rate that is not configured produces a warning and no charge, rather than a guessed figure.',
  },

  // --- Invoices -----------------------------------------------------------
  'POST /invoices/': {
    summary: 'Issue an invoice',
    description:
      'Snapshots every figure, the company details and the tax rate at this moment. Nothing is read live afterwards, so raising a price next month cannot rewrite this invoice. Refuses if the booking already has a live invoice.',
  },
  'GET /invoices/:id/pdf': {
    summary: 'Download the PDF',
    description:
      'Rendered on demand from the stored snapshot, so the same invoice downloaded next year is the same document. A non-owner gets 404, not 403.',
  },
  'POST /invoices/:id/credit-note': {
    summary: 'Correct an invoice',
    description:
      'The ONLY way to correct an issued invoice - there is no update and no delete. Copies every line negated so the pair sums to zero, and marks the original cancelled without altering it.',
  },

  // --- Coupons ------------------------------------------------------------
  'POST /coupons/': {
    summary: 'Create a promo code',
    description:
      'Admin only. The discount type and value cannot be edited afterwards: codes already redeemed were redeemed at a particular value, and changing it would make those bookings’ paperwork wrong.',
  },
  'PATCH /coupons/:id': {
    summary: 'Change a code’s availability',
    description: 'Availability only - never the economics. Withdraw and reissue to change an offer.',
  },

  // --- Reports ------------------------------------------------------------
  'GET /reports/revenue': {
    summary: 'Money received',
    description:
      'Revenue is what was PAID, from completed payments less refunds. It is deliberately NOT the sum of booking totals, which includes bookings never paid for. Security deposits are reported separately and never counted as income.',
  },
  'GET /reports/bookings': {
    summary: 'Booking volumes',
    description:
      '`bookedValue` is what customers agreed to pay, which is usually more than revenue. The two are separate fields with separate names so nobody conflates them.',
  },
  'GET /reports/fleet': {
    summary: 'Utilisation per vehicle',
    description:
      'Rented days over AVAILABLE days. Workshop time comes out of the denominator, so a well-maintained car is not scored as idle.',
  },

  // --- Notifications ------------------------------------------------------
  'GET /notifications/': {
    summary: 'The outbound message log',
    description:
      'Every message is written here before it is handed to a provider, so a message that failed to send still leaves evidence of what it was. SKIPPED means we chose not to send; FAILED means we tried.',
  },
  'PATCH /notifications/templates/:id': {
    summary: 'Reword a message',
    description: 'The wording is the client’s. Changing it is a settings edit, not a deployment.',
  },

  // --- Legal --------------------------------------------------------------
  'GET /legal/': {
    summary: 'The live version of every policy',
    description: 'Public. Terms you must sign in to read are terms you cannot read before signing up.',
  },
  'POST /legal/:id/publish': {
    summary: 'Publish a version',
    description:
      'Supersedes the previous version without deleting it - bookings point at specific versions, and those references have to keep resolving.',
  },
  'PATCH /legal/:id/draft': {
    summary: 'Edit a draft',
    description:
      'Returns 409 once a version is published. Customers agreed to that exact text; editing it in place would destroy the only record of what they agreed to.',
  },

  // --- Documents ----------------------------------------------------------
  'POST /documents/': {
    summary: 'Upload an identity document',
    description:
      'Goes to PRIVATE storage. File type is verified by reading the leading bytes, not by trusting the declared MIME type, which the client controls.',
  },
  'GET /documents/:id/file': {
    summary: 'Stream a stored document',
    description:
      'The only way to read the bytes. There is no URL to guess, because no URL exists - the file is reached by an authorised request, and every access is written to the audit log.',
  },
};
