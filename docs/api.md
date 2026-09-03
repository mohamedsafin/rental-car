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

## Planned endpoints

| Phase | Prefix |
| --- | --- |
| 3 | `/vehicles`, `/categories`, `/locations` |
| 4 | `/availability`, `/pricing` |
| 5 | `/customers`, `/documents` |
| 6 | `/bookings` |
| 7 | `/payments`, `/deposits` |
| 8 | `/rentals`, `/inspections` |
| 9 | `/damages`, `/fines`, `/tolls`, `/maintenance`, `/insurance` |
| 10 | `/coupons`, `/invoices`, `/notifications`, `/reports` |
