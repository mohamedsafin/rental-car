# Development plan

One phase at a time. A phase is finished when its tests pass and you have seen
it work in the browser. We do not start the next phase before then.

| Phase | Scope | Definition of done |
| --- | --- | --- |
| **1. Foundation** | Monorepo, TypeScript, Express, Prisma, PostgreSQL, health check, both React apps, error handling, Git, docs | `npm test` green; both apps show "Database: up" |
| **2. Auth & RBAC** | Register, login, JWT access + refresh, bcrypt, roles, auth/authorize middleware, protected routes, audit log | A CUSTOMER token gets 403 on an admin endpoint |
| **3. Fleet** | Vehicle CRUD, categories, features, images, locations, admin screens | Admin adds a vehicle with images; it appears on the customer site |
| **4. Availability & pricing** | Overlap engine, `GET /vehicles/available`, pricing engine, price breakdown | Overlap tests pass; search returns only bookable cars |
| **5. Customers & documents** | Customer profile, secure upload, storage abstraction, verification workflow | Upload -> admin approves/rejects -> customer notified |
| **6. Bookings** | Booking creation in a transaction, status machine, cancellation, customer + admin views | Two concurrent bookings for the same car: one wins, one gets 409 |
| **7. Payments & deposits** | `PaymentProvider` abstraction, webhooks, refunds, deposit ledger | A webhook (not the browser) flips a booking to CONFIRMED |
| **8. Rental lifecycle** | Pickup, inspections, extension, return, additional charges | Full pickup-to-return cycle for one booking |
| **9. Charges & fleet admin** | Damages, fines, tolls, fuel, maintenance, insurance, expiry reminders | A damage charge reaches the deposit settlement correctly |
| **10. Output** | Invoices (PDF), notifications, coupons, reports | Downloadable invoice; revenue report matches payments |
| **11. Hardening** | Security pass, test coverage, performance, OpenAPI, Docker, deployment | Security review clean; deployed to staging |

## Order rationale

- Auth first because every later endpoint needs to know who is calling.
- Availability and pricing before bookings, because a booking is meaningless
  until we can say "this car is free" and "this costs X".
- Payments after bookings, because a payment needs something to pay for.
- The whole rental lifecycle before the money that comes out of it (damages,
  fines) — those charges attach to a completed return.

## Per-phase working agreement

1. I explain what we are building and why it is needed.
2. I list the exact files to create or modify, with their full paths.
3. I give complete file contents (not fragments) for the files in scope.
4. I give the exact commands to run.
5. I state what you should see when it works.
6. You confirm it works before we move on.

Existing working code is not rewritten or renamed without a reason I state
first.
