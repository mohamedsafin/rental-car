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

## Planned endpoints

| Phase | Prefix |
| --- | --- |
| 2 | `/auth`, `/users` |
| 3 | `/vehicles`, `/categories`, `/locations` |
| 4 | `/availability`, `/pricing` |
| 5 | `/customers`, `/documents` |
| 6 | `/bookings` |
| 7 | `/payments`, `/deposits` |
| 8 | `/rentals`, `/inspections` |
| 9 | `/damages`, `/fines`, `/tolls`, `/maintenance`, `/insurance` |
| 10 | `/coupons`, `/invoices`, `/notifications`, `/reports` |
