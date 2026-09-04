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

## Planned endpoints

| Phase | Prefix |
| --- | --- |
| 5 | `/customers`, `/documents` |
| 6 | `/bookings` |
| 7 | `/payments`, `/deposits` |
| 8 | `/rentals`, `/inspections` |
| 9 | `/damages`, `/fines`, `/tolls`, `/maintenance`, `/insurance` |
| 10 | `/coupons`, `/invoices`, `/notifications`, `/reports` |
