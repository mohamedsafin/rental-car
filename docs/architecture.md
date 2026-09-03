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
