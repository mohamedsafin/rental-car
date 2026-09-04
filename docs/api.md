# API reference

Base URL: `http://localhost:4000/api/v1`

Machine-readable OpenAPI/Swagger is generated in Phase 11. Until then this file
is maintained by hand as each phase lands.

## Response envelope

Every response has the same shape, which is why the React apps can share one
Axios layer.

Success:
```json
{ "success": true, "data": { }, "message": "Success" }
```

Paginated success (`data` payload):
```json
{ "items": [], "pagination": { "page": 1, "limit": 20, "total": 0, "totalPages": 1 } }
```

Failure:
```json
{
  "success": false,
  "message": "Validation failed",
  "code": "VALIDATION_ERROR",
  "errors": [{ "field": "email", "message": "Invalid email" }],
  "requestId": "2f1c..."
}
```

`code` is what clients branch on. `message` is for humans and may be reworded.
`requestId` matches the `X-Request-Id` response header and the server logs.

## Status codes

| Code | Meaning |
| --- | --- |
| 200 | OK |
| 201 | Created |
| 400 | Validation error |
| 401 | Not authenticated |
| 403 | Authenticated but not permitted |
| 404 | Not found |
| 409 | Conflict (duplicate, or vehicle no longer available) |
| 429 | Rate limited |
| 500 | Server error (generic message only) |
| 503 | A dependency such as the database is down |

## Error codes

`VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`,
`VEHICLE_UNAVAILABLE`, `PAYMENT_ERROR`, `FILE_UPLOAD_ERROR`,
`EXTERNAL_SERVICE_ERROR`, `RATE_LIMITED`, `INTERNAL_ERROR`

---

## Phase 1 endpoints

### `GET /health/live`
Liveness probe. No database access, never rate-limited. Use for container
liveness checks.

```json
{
  "success": true,
  "data": { "status": "ok", "service": "uae-car-rental-api", "timestamp": "..." },
  "message": "Service is live"
}
```

### `GET /health`
Readiness probe. Checks PostgreSQL. Returns **200** when healthy, **503** when a
dependency is down — so a load balancer stops sending customers to a broken
instance.

```json
{
  "success": true,
  "data": {
    "status": "ok",
    "service": "uae-car-rental-api",
    "version": "0.1.0",
    "environment": "development",
    "timestamp": "2026-01-01T00:00:00.000Z",
    "uptimeSeconds": 42,
    "dependencies": { "database": "up" }
  },
  "message": "Service is healthy"
}
```

---

## Phase 2 endpoints

### Authentication

| Method | Endpoint | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/auth/register` | public | Create a CUSTOMER account. A `role` field in the body is **ignored**. |
| POST | `/auth/login` | public | Sign in. Sets the `refreshToken` httpOnly cookie. |
| POST | `/auth/refresh` | cookie | Rotate the refresh token, get a new access token. |
| POST | `/auth/logout` | cookie | Revoke this session. |
| GET | `/auth/me` | bearer | The signed-in user. |
| PATCH | `/auth/me` | bearer | Update own name / phone / country. |
| POST | `/auth/change-password` | bearer | Change password; revokes **all** sessions. |
| POST | `/auth/logout-all` | bearer | Sign out on every device. |

### User management (ADMIN only)

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/users` | Paginated list; filter by `role`, `status`, `search`. |
| POST | `/users` | Create an ADMIN or STAFF account. |
| GET | `/users/:id` | One user. |
| PATCH | `/users/:id` | Change name, role or status. |
| DELETE | `/users/:id` | Soft delete (deactivate). |

### Tokens

- **Access token** — 15 minutes, sent as `Authorization: Bearer <token>`. Self-contained, so verifying it costs no database query. Cannot be revoked early; a suspended user keeps working for at most 15 minutes.
- **Refresh token** — 7 days, delivered as an httpOnly cookie scoped to `/api/v1/auth`. Page JavaScript cannot read it, so XSS cannot steal it. Its SHA-256 hash is stored in `refresh_tokens`, which is what makes revocation possible.

**Rotation and theft detection.** Every `/auth/refresh` issues a new refresh token and revokes the old one. Presenting an already-revoked token means either a race or a stolen token being replayed; we cannot tell which, so we assume theft and revoke **every** token for that user.

### Auth-specific status codes

| Code | Meaning |
| --- | --- |
| 401 | Not authenticated — no token, bad token, or expired session |
| 403 | Authenticated but not permitted (wrong role), or account suspended |
| 423 | Account locked after 5 failed login attempts (15 minutes) |
| 429 | Rate limited — 10 failed logins / 15 min, 5 registrations / hour, per IP |

---

## Phase 3 endpoints

Every fleet resource follows the same shape: **public reads, admin writes.**

### Vehicles

| Method | Endpoint | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/vehicles` | optional | Paginated, filterable listing |
| GET | `/vehicles/:id` | optional | One vehicle |
| POST | `/vehicles` | ADMIN | Add to the fleet |
| PATCH | `/vehicles/:id` | ADMIN | Update |
| DELETE | `/vehicles/:id` | ADMIN | Soft delete |
| POST | `/vehicles/:id/images` | ADMIN | Upload up to 10 images (multipart) |
| PATCH | `/vehicles/:id/images/:imageId/primary` | ADMIN | Set the card thumbnail |
| DELETE | `/vehicles/:id/images/:imageId` | ADMIN | Remove an image |

`optional` auth means the endpoint works anonymously, but a valid ADMIN/STAFF token widens the response. The **same** endpoint serves both audiences:

| | Public caller | ADMIN / STAFF caller |
| --- | --- | --- |
| `registrationNumber` | `null` | the plate |
| Unpublished vehicles | invisible (404 / absent) | visible with `includeUnpublished=true` |
| `status` filter | ignored | applied |
| Search matches plate | no | yes |

The flag is derived from the verified JWT, never from a query parameter — a customer sending `includeUnpublished=true` gets the public view regardless.

**Filters:** `category` (slug), `categoryId`, `transmission`, `fuelType`, `seats`, `minPrice`, `maxPrice`, `locationId`, `search`, `sort` (`newest` | `price_asc` | `price_desc` | `year_desc`), `page`, `limit`.

### Categories, features, locations

| Method | Endpoint | Auth |
| --- | --- | --- |
| GET | `/categories`, `/features`, `/locations` | public |
| POST / PATCH / DELETE | same paths | ADMIN |

### Money format

Every monetary value crosses the API as a **fixed 2-decimal string**, not a number:

```json
"pricing": { "daily": "650.00", "securityDeposit": "3000.00", "currency": "AED" }
```

JSON numbers are IEEE-754 doubles. Sending `650.00` as a number and reading it back can yield `649.9999999999999`, and a 30-day total built from that is wrong by real money. The string survives Postgres `DECIMAL(10,2)` → API → browser unchanged. **Display it; never compute with it** — totals come from the pricing engine in Phase 4.

### File uploads

`POST /vehicles/:id/images` takes `multipart/form-data` with an `images` field (up to 10 files, 10 MB each) and an optional `?type=` query naming the shot (`EXTERIOR_FRONT`, `INTERIOR_DASHBOARD`, …).

Two validation layers: multer checks the declared MIME type and size; the service then checks the file's **magic bytes**. A declared content type is a string the client chose — `shell.php` sent as `image/jpeg` passes the first check and fails the second.

Images are stored under an opaque provider key and served from `/uploads/...`. The URL is built at read time, so moving to S3 changes one file and no data.

---

## Phase 4 endpoints

### Availability and search

| Method | Endpoint | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/availability/search` | optional | Vehicles bookable for a date range (BRD 6) |
| GET | `/availability/check` | optional | One vehicle, one window |
| GET | `/availability/:vehicleId/blocked-dates` | public | Dates to grey out in a calendar |

Search accepts the BRD's six form fields (`pickupDate`, `pickupTime`, `returnDate`, `returnTime`, `pickupLocationId`, `dropoffLocationId`) **or** ISO instants (`pickupAt`, `returnAt`), plus every `/vehicles` filter. Times without an offset are read as UTC, never as the server's local zone.

An ADMIN/STAFF token on `/availability/check` adds the conflicting booking numbers; customers get a plain yes/no.

### Pricing

| Method | Endpoint | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/pricing/quote` | public | Full price breakdown + availability in one call |
| GET | `/pricing/services` | public | Bookable add-ons (BRD 17) |
| GET/PATCH | `/admin/pricing/settings` | ADMIN | VAT rate, rental limits |
| GET/POST/PATCH | `/admin/pricing/services` | ADMIN | Add-on prices and activation |
| GET/POST/DELETE | `/admin/pricing/rules` | ADMIN | Weekend, seasonal, long-term rules (BRD 16) |

`/pricing/quote` is a POST because the body carries selected services, but it has no side effects. **It has no `total` field** — a total sent by a client is stripped by the validation middleware and the engine recalculates from scratch.

---

## The overlap rule (BRD 34)

Two rental periods overlap when:

```
existingStart < requestedEnd  AND  existingEnd > requestedStart
```

Both comparisons are **strict**, making the rental window half-open — `[pickupAt, returnAt)`. The vehicle is held from pickup up to but *not including* the return instant, so a return time is an available pickup time for the next customer.

| Booking A | Booking B | Result |
| --- | --- | --- |
| 10 Sep → 15 Sep | 12 Sep → 18 Sep | **Rejected** — overlap |
| 10 Sep → 15 Sep | 15 Sep → 20 Sep | **Allowed** — periods touch |

Enforced at three layers: the search filter, a re-check inside the booking transaction (Phase 6), and a PostgreSQL **exclusion constraint** (`bookings_no_overlapping_rental`) that cannot lose a race because the database evaluates it inside the INSERT.

`rental.turnaround_buffer_hours` (default 0) widens each check for cleaning and inspection time. It lives in the service, not the constraint, because a value read at request time cannot sit in an immutable index.

## Pricing conventions

**Day counting** — billed as 24-hour periods; any part of a period is a full day. Returning one hour late costs a whole extra day. Surfaced in every quote as `period.dayCountingRule` for the client to confirm.

**Tier selection** — a 10-day rental is not 10 daily rates. Every sensible decomposition of months/weeks/days is computed and the **cheapest** wins, including rounding up to the next whole tier when that is cheaper.

**Order of operations** — rental → surcharges → services → delivery → discount → **tax on that base** → deposit reported separately. Discounts precede tax so customers are not taxed on money they did not pay; the refundable deposit is outside the tax base entirely.

**Unconfigured values are reported, never guessed.** With no VAT rate set, quotes carry a `warnings` entry rather than a silently invented 5%.

---

## Phase 5 endpoints

### Customer profile

| Method | Endpoint | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/customers/me` | any | Own profile + verification checklist |
| PATCH | `/customers/me` | any | Update own profile |
| GET | `/customers/me/documents` | any | Own documents |
| GET | `/customers` | STAFF/ADMIN | Paginated list, `?pendingDocuments=true` for the review queue |
| GET | `/customers/:id` | STAFF/ADMIN | One customer + documents |

The `/me` routes carry **no id** — the record is identified by the token, so there is nothing to tamper with. That is why this module needs no ownership middleware on the self routes.

### Documents

| Method | Endpoint | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/documents` | any | Upload one document (multipart, field `document`) |
| GET | `/documents/:id/file` | owner or STAFF/ADMIN | **The only way to read a stored file** |
| PATCH | `/documents/:id/review` | STAFF/ADMIN | Approve or reject (BRD 13) |
| POST | `/documents/expire-overdue` | STAFF/ADMIN | Sweep expired approvals |

## Private document storage (BRD 12)

Identity documents are stored under the storage root's `private/` folder, which `express.static` never mounts. There is **no URL column anywhere** — only an opaque `storageKey` that never leaves the server.

```
uploads/private/customers/<id>/<uuid>.png    identity documents  — no URL exists
uploads/public/vehicles/<id>/<uuid>.png      vehicle images      — served at /uploads/...
```

Every guessed path returns 404. Reading a document requires `GET /documents/:id/file`, which authenticates the caller, checks ownership, writes an audit row, and only then streams the bytes with `Cache-Control: private, no-store`.

**A non-owner gets 404, not 403.** A 403 would confirm the document exists; the responses for a real id and a fabricated one are byte-identical.

The browser cannot use `<img src>` on these paths — the request needs an `Authorization` header — so the admin viewer fetches the bytes and creates a blob URL, revoking it on unmount.

## Verification workflow

Statuses are `PENDING → APPROVED | REJECTED | EXPIRED`.

- A rejection **requires** a reason (400 without one), which the customer sees so they can correct it.
- Re-uploading the same type **supersedes** the old document rather than deleting it — a rejected passport plus its replacement is the record of what was checked.
- A customer is verified only when **every** required document is APPROVED *and* unexpired. An APPROVED-but-expired licence does not count.
- Required documents come from `documents.required_uae_resident` / `documents.required_visitor`, both seeded `[]`. With nothing configured the system asks for nothing **and says so** — it never invents a requirement, and never defaults verification to `true`.

---

## Phase 6 endpoints

| Method | Endpoint | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/bookings` | any | Create a booking |
| GET | `/bookings/me` | any | Own bookings, `?scope=upcoming\|active\|previous\|cancelled` |
| GET | `/bookings/:id` | owner or STAFF | One booking |
| POST | `/bookings/:id/cancel` | owner or STAFF | Cancel, computing the fee |
| GET | `/bookings` | STAFF/ADMIN | Filterable list |
| PATCH | `/bookings/:id/status` | STAFF/ADMIN | Move through the lifecycle |
| POST | `/bookings/release-expired-holds` | STAFF/ADMIN | Free abandoned checkouts |

### The create request carries no price

```json
{ "vehicleId": "...", "pickupAt": "...", "returnAt": "...",
  "services": [{ "serviceId": "...", "quantity": 1 }] }
```

A `totalAmount` in the body is stripped by the validation middleware, and the
service recomputes every figure from the pricing engine regardless. Verified:
posting `totalAmount: "1.00"` produced a booking stored at **3748.50**.

### Status lifecycle (BRD 21)

```
PENDING ──► DOCUMENT_VERIFICATION ──► PAYMENT_PENDING ──► CONFIRMED
                                                              │
                                                     READY_FOR_PICKUP
                                                              │
                                            ACTIVE ◄──► EXTENSION_REQUESTED
                                                              │
                                                      RETURN_PENDING
                                                              │
                                                   RETURNED ──► COMPLETED
```

Documents are verified **before** payment, per BRD 3 and 53. A newly created
booking starts at `PAYMENT_PENDING` if the customer is already verified, and at
`DOCUMENT_VERIFICATION` otherwise.

`CANCELLED` is reachable from anything before handover. Once a rental is
`ACTIVE` the car is with the customer, so it must be **returned** — cancelling a
vehicle someone is currently driving is not a state the machine allows.

Transitions live in one map (`statusMachine.ts`) rather than scattered `if`
statements, so "can this be cancelled?" has exactly one answer. Every change
writes a `booking_status_history` row: who, when, from, to, why.

### Concurrency

Booking creation runs in a **SERIALIZABLE** transaction that re-checks
availability after acquiring locks, on top of the Phase 4 exclusion constraint.
Two simultaneous requests for the same window return **201 and 409** — never two
201s, and the loser gets a clean `VEHICLE_UNAVAILABLE`, not a raw Postgres error.

### Cancellation (BRD 31)

The fee is computed from `cancellation.free_window_hours` and
`cancellation.fee_percentage`, then **frozen** onto the booking. Recomputing it
later from the live policy would rewrite what a customer was told. Both settings
seed empty; unset means **no fee**, the same rule as VAT.

---

## Phase 7 endpoints

| Method | Endpoint | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/payments/webhook` | **HMAC signature** | The only path to a successful payment |
| POST | `/payments/initiate` | any | Create a session, return a checkout URL |
| GET | `/payments/booking/:id` | owner or STAFF | Payment history (BRD 22) |
| POST | `/payments/:id/refund` | ADMIN | Full or partial refund (BRD 32) |
| GET | `/deposits/booking/:bookingId` | owner or STAFF | Deposit + full ledger |
| GET | `/deposits` | STAFF/ADMIN | Deposits list |
| POST | `/deposits/booking/:bookingId/deduct` | STAFF/ADMIN | Deduct, with category + reason |
| POST | `/deposits/booking/:bookingId/release` | STAFF/ADMIN | Return the balance |

## Only a webhook can confirm a payment

There is **no endpoint a browser can call** to mark a payment successful — no
`/confirm`, no `/success`, no status parameter on the return URL. The customer's
browser is under the customer's control, and *"the frontend said it worked"* is
how rental systems get defrauded.

A webhook must clear four gates:

1. **Signature** — HMAC-SHA256 over the RAW bytes, compared with
   `timingSafeEqual`. A missing or forged signature is a 401.
2. **Idempotency** — every event is inserted into `webhook_events` with a
   UNIQUE `(provider, eventId)`. The *database* rejects a repeat, not an
   application check two concurrent deliveries could both pass.
3. **Known payment** — an unrecognised reference is acknowledged and discarded.
4. **Amount match** — compared against our own record.

Gate 4 is the one people skip. A signature proves the message came from the
provider; it does **not** prove the amount is what we asked for. Verified live:

```
forged signature              -> 401  Invalid webhook signature
no signature                  -> 401  Missing webhook signature
VALID signature, amount 1.00  -> 200  { handled: false, reason: "amount_mismatch" }
booking status after all three -> PAYMENT_PENDING

correct signature + amount    -> 200  { handled: true }
booking status                 -> CONFIRMED
same webhook twice more        -> { handled: true, reason: "duplicate" }
```

`express.json()` is deliberately **skipped** for the webhook path. Parsing and
re-serialising the body changes the bytes and breaks every signature.

## The deposit ledger (BRD 20)

The balance is **derived**, never stored:

```
balance = sum(HOLD) - sum(DEDUCTION) - sum(RELEASE)
```

`deposit_transactions` is append-only, and every deduction carries a category
and a reason the customer can read. A stored balance can be silently
overwritten; a ledger cannot.

```
HOLD        3000.00               Security deposit received
DEDUCTION    450.00  DAMAGE       Scratch on the rear bumper, photographed at return
DEDUCTION    120.00  FUEL         Returned with three-quarters of a tank
RELEASE     2430.00               Deposit returned to customer
```

Deductions beyond the balance are refused — excess charges become a separate
invoice, never a negative deposit.

## No card data, anywhere

The `PaymentProvider` interface has no field for a card number, CVV or expiry —
not even optionally. The surest way to honour BRD 19 and 46 is for the types to
have nowhere to put them. Only provider references are stored.

The gateway itself is unchosen (BRD 19). `PAYMENT_PROVIDER=mock` is a
development driver that signs webhooks with the same HMAC scheme and **refuses
to boot in production**.

---

## Phase 8 endpoints

| Method | Endpoint | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/rentals/booking/:bookingId` | owner or STAFF | Rental, inspections, charges, extensions |
| POST | `/rentals/booking/:bookingId/pickup` | STAFF | Hand over (BRD 24) |
| POST | `/rentals/booking/:bookingId/return` | STAFF | Take back + calculate charges (BRD 26) |
| POST | `/rentals/booking/:bookingId/close` | STAFF | Car back in service, booking completed |
| POST | `/rentals/inspections/:id/photos` | STAFF | Inspection photos (BRD 25) |
| POST | `/rentals/charges/:chargeId/settle` | STAFF | Take a charge from the deposit |
| POST | `/rentals/charges/:chargeId/waive` | ADMIN | Write a charge off, with a reason |
| POST | `/rentals/booking/:bookingId/extensions` | owner or STAFF | Request an extension (BRD 23) |
| PATCH | `/rentals/extensions/:id/review` | STAFF | Approve or reject |

## Booking vs rental

A **booking** is what was agreed. A **rental** is what actually happened. They
usually match; when they do not — collected two hours late, returned a day
early, 2,500 km driven — the rental records reality, and the *difference*
between the two inspections is what gets charged.

Both inspections are kept, never one row that gets updated: *"the scratch was
already there"* has to be an answerable question.

## Return charges

Every rate is a **setting** (BRD 51). An unset rate produces **no charge** and a
warning, never a guessed default. Verified live with a full policy configured:

```
LATE_RETURN         300.00  Returned 24h late (1 extra day)
EXCESS_MILEAGE     1875.00  1250km over the 1250km allowance
FUEL                200.00  Returned 40% below the fuel level at pickup
CLEANING            200.00  Vehicle required cleaning beyond normal use
TOTAL              2575.00
```

Each charge stores a `calculation` object showing how the figure was reached —
these are the numbers customers dispute at the counter.

Two rules worth stating:

- **Late return is charged in whole days**, matching how the rental itself is
  priced. Two different day-counting conventions inside one system is a bug
  waiting to happen.
- **Fuel is charged on the shortfall only.** A customer who returns the car
  fuller is neither refunded nor charged.

## Charges are separate from the deposit ledger

A charge is a **decision** (*"3 hours late, that is one extra day"*). A deposit
transaction is a **movement of money**. Keeping them apart means an admin can
waive a charge without unpicking a ledger entry:

```
settle LATE_RETURN  -> deposit DEDUCTION 300.00
waive  EXCESS_MILEAGE (reason recorded, no ledger entry)
settle FUEL         -> deposit DEDUCTION 200.00
settle CLEANING     -> deposit DEDUCTION 200.00

held 3000.00   deducted 700.00   balance 2300.00
```

## Vehicle status through the lifecycle

```
AVAILABLE -> (pickup) -> RENTED -> (return) -> UNDER_INSPECTION -> (close) -> AVAILABLE
```

`UNDER_INSPECTION` deliberately does **not** block future bookings — a car
being checked over today is bookable for next month, exactly like a car
currently out on hire.

## Extensions (BRD 23)

Availability is checked at request time **and again on approval** — the car may
have been booked by someone else in between. The booking being extended is
excluded from the check, or a rental would always conflict with itself.
Approval moves the booking's `returnAt`, so availability, late fees and the
mileage allowance all use the new date.

---

## Planned endpoints

| Phase | Prefix |
| --- | --- |
| 9 | `/damages`, `/fines`, `/tolls`, `/maintenance`, `/insurance` |
| 10 | `/coupons`, `/invoices`, `/notifications`, `/reports` |
