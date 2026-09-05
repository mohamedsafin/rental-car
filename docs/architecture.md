# Architecture

## 1. System overview

```
   Customer browser                     Admin / Staff browser
          |                                      |
          v                                      v
  frontend (React SPA)                   admin (React SPA)
   Vite :5173                             Vite :5174
          |                                      |
          +------------------+-------------------+
                             |
                    HTTPS / REST (JSON)
                             |
                             v
             +-------------------------------+
             |   backend (Node + Express)    |
             |   :4000  /api/v1              |
             |                               |
             |  routing -> middleware        |
             |  -> controller -> service     |
             |  -> repository                |
             +-------------------------------+
                  |                    |
                  v                    v
          Business modules      External services
        (availability,          - Payment gateway
         pricing, bookings,     - Email
         documents, ...)        - SMS / WhatsApp
                  |             - File storage (S3 / Cloudinary)
                  v
             Prisma ORM
                  |
                  v
             PostgreSQL
```

Two React apps, one API, one database. The admin app is separate from the
customer app (not a `/admin` route inside it) so that admin JavaScript is never
shipped to the public, and the two can be deployed and secured independently.

## 2. The rule that matters most

**The backend is the source of truth.** The frontend may *display* a price or an
availability result, but it never *decides* one.

The backend alone owns:

- vehicle availability
- price calculation
- coupon validity
- booking creation and status transitions
- payment status (set from the gateway webhook, never from the browser)
- deposit settlement and additional charges
- authorization

Concretely: when the checkout page submits a booking, it sends the vehicle id,
dates, locations, selected services and a coupon code. It does **not** send a
total. The backend recalculates the total from its own pricing rules. If a user
edits the JavaScript and posts `total: 1`, nothing happens — that field is not
read.

## 3. Request flow

```
Client request
  -> requestId          attach a traceable id
  -> helmet             security headers
  -> cors               only our own origins may call from a browser
  -> body parser        JSON, size-capped
  -> morgan             access log
  -> rate limiter       abuse protection
  -> route              URL -> handler mapping
  -> authenticate       who is this? (Phase 2)
  -> authorize          may they do this? (Phase 2)
  -> validate           is the input well-formed? (Zod)
  -> controller         thin: read request, call service, send response
  -> service            ALL business logic lives here
  -> repository/Prisma  database access
  -> PostgreSQL
  <- response           { success, data, message }
  -- on any throw -->   central error handler -> { success: false, ... }
```

## 4. Backend layers

| Layer | File | Responsibility | Must NOT |
| --- | --- | --- | --- |
| Route | `routes.ts` | URL + middleware wiring | contain logic |
| Validation | `validation.ts` | Zod schemas for body/query/params | touch the DB |
| Controller | `controller.ts` | request in, response out | contain business rules |
| Service | `service.ts` | business rules, transactions, orchestration | know about `req`/`res` |
| Repository | `repository.ts` | Prisma queries | contain business rules |
| Types | `types.ts` | module-level TypeScript contracts | |

Why this costs a little more typing and is worth it: the availability check and
the pricing calculation are the two places where a bug costs real money. Both
live in plain functions that take data and return data, which means they can be
unit-tested exhaustively without HTTP or a browser.

## 5. Abstractions decided by the client later

The BRD leaves several vendors open. Each is behind an interface so the choice
is a config change, not a rewrite:

| Concern | Interface | Config | Chosen in |
| --- | --- | --- | --- |
| File storage | `StorageProvider` | `STORAGE_DRIVER` | Phase 5 |
| Payments | `PaymentProvider` | `PAYMENT_PROVIDER` | Phase 7 |
| Email | `EmailProvider` | `EMAIL_PROVIDER` | Phase 10 |
| SMS | `SmsProvider` | `SMS_PROVIDER` | Phase 10 |
| WhatsApp | `WhatsAppProvider` | `WHATSAPP_PROVIDER` | Phase 10 |

Business services depend on the interface only. `bookingService` calls
`notificationService.send(...)`; it has no idea whether that ends up as email,
SMS or WhatsApp.

## 6. Values that are configuration, not code

The BRD marks many values as "to be provided by the client": VAT rate, deposit
amounts, cancellation windows and fees, minimum rental age, mileage and fuel
policies, required documents, delivery charges.

None of these are hardcoded. They live in the `system_settings` table and are
edited from the Admin Dashboard. This is why `SystemSetting` is the very first
model in the schema.

### Guarantees enforced by tests, not by review

`utils/routeInventory.ts` walks the routers and reports every endpoint with the
guards protecting it. `tests/security.test.ts` asserts against that: every
mutating endpoint requires authentication, every back-office prefix demands a
role, and no `authorize()` ever admits a CUSTOMER.

The same inventory generates the OpenAPI paths, so the spec, the security tests
and the server all read from one source. `npm run openapi:check` fails if the
committed spec has drifted from the code — a committed spec nobody regenerates
is worse than none, because it looks authoritative while describing an API that
no longer exists.

The full review is in [security.md](security.md).

### Abstractions chosen by the client

| Concern | Interface | Development driver | Refuses in production |
| --- | --- | --- | --- |
| File storage | `StorageProvider` | `local` | no |
| Payments | `PaymentProvider` | `mock` | yes |
| Notifications | `NotificationProvider` | `log` | yes |

The payment and notification drivers refuse to boot in production for the same
reason: `mock` would "confirm" bookings nobody paid for, and `log` would report
every message as sent while delivering none. Both failures look like the system
working, which is what makes them worth refusing to start over.

### Demonstration data is quarantined

The same rule is why there are two seed scripts, not one.

`prisma/seed.ts` is the production seed: the admin account and the settings
rows, with every client-owned number left BLANK. `prisma/seedDemo.ts` holds the
28-vehicle demonstration fleet, and every rate in it is a placeholder.

Keeping them apart means an invented price cannot reach production by accident.
`seed.ts` runs on deploy; `seed:demo` is a separate command that prints a
banner, refuses to run when `NODE_ENV=production`, and tags every row it creates
with a `DEMO-` registration prefix so `seed:demo:clear` can remove exactly what
it added and nothing else.

## 7. Frontend structure (same in both apps)

| Folder | Holds | Rule |
| --- | --- | --- |
| `components/` | reusable presentational UI | no data fetching |
| `layouts/` | page chrome (header, sidebar, footer) | |
| `pages/` | one file per route | composition only |
| `features/` | feature-scoped logic (booking flow, ...) | |
| `hooks/` | TanStack Query hooks | |
| `services/` | Axios calls, one file per backend module | the only place URLs appear |
| `types/` | API contract types | |
| `routes/` | route map | |

Server state (anything from the API) is owned by TanStack Query. UI state
(is this modal open) uses `useState`. There is no manual `useEffect` fetching.

### Styling

Tailwind v4, with the palette defined once as `@theme` tokens in `index.css`:
an `ink` neutral ramp and an `accent` highlight. Components use `bg-ink-900`,
never a raw hex or an arbitrary value, so swapping in the client's real brand
colours (BRD 51) is an edit to one file rather than a hunt through forty
components. `--radius-card` and `--shadow-card` are tokens for the same reason.

Vehicles with no photograph render `VehicleArtwork`, an SVG body-style
silhouette tinted by category. The alternatives were a grey "No image" box,
which makes a real fleet look broken, and stock photography, which would put a
picture of a car that is not that car in front of a customer.
