# UAE Car Rental Web Application

Online car rental platform for the UAE: a customer website for searching and
booking vehicles, and an admin/staff dashboard for running the rental business.

Built from the project Business Requirements Document (BRD). Values the BRD
marks as client-supplied — VAT rate, deposit amounts, cancellation fees,
document requirements — are **configurable settings, not hardcoded numbers**.

## Status

**Phase 11 complete — Hardening.** All eleven phases built; deployment deferred. See
[docs/development-plan.md](docs/development-plan.md) for the roadmap.

Done so far: monorepo foundation and health checks; JWT auth with
refresh-token rotation and backend-enforced RBAC; the fleet (vehicles,
categories, features, locations, validated image upload); and the availability
and pricing engines (dated search returning only bookable cars, a
double-booking guarantee enforced by a PostgreSQL exclusion constraint, and a
server-side price breakdown); and customer profiles with private identity-
document upload and a staff verification workflow; and the booking module —
creation in a serializable transaction with server-computed pricing, the full
status lifecycle, and cancellation against a configurable policy; and
payments — webhook-only confirmation with signature and amount verification,
refunds, and an append-only security-deposit ledger; and the rental
lifecycle — handover, photographic inspections at both ends, extensions with
an availability re-check, and return charges that feed the deposit ledger; and
fleet administration — damage assessment (estimate and approved amount kept
apart, and only the approved one ever charged), traffic fines and Salik tolls
recorded against the rental they fell on, maintenance windows that take a
vehicle off the calendar **for those dates only**, insurance policy history,
privately stored vehicle documents, and a configurable expiry-reminder
dashboard; and the outputs — immutable PDF tax invoices corrected only by
credit notes, promo codes priced entirely server-side, an outbound message log
written before anything is sent, versioned legal documents pinned to each
booking, and management reports where revenue means what was **paid**, not what
was booked; and a hardening pass — a route inventory that fails the build if a
mutating endpoint ever loses its guard, rate limiters that are now actually
tested, a generated OpenAPI spec that cannot drift from the router, an
orphaned-file sweep for stranded identity documents, and Docker images for all
three apps.

The security review, including what was deliberately accepted and why, is in
[docs/security.md](docs/security.md).

## Stack

| Layer | Technology |
| --- | --- |
| Customer site | React 19, TypeScript, Vite, Tailwind CSS v4, React Router, TanStack Query, Axios |
| Admin dashboard | Same stack, separate app |
| API | Node.js, Express 5, TypeScript |
| Database | PostgreSQL 18 |
| ORM | Prisma |
| Validation | Zod (backend and frontend) |
| Tests | Vitest + Supertest |

## Requirements

| Tool | Version | Check |
| --- | --- | --- |
| Node.js | 20+ | `node -v` |
| npm | 10+ | `npm -v` |
| PostgreSQL | 14+ | `psql --version` |
| Git | any recent | `git --version` |
| Docker | optional | `docker -v` |

## Setup

```bash
# 1. Install every workspace's dependencies (run from this folder)
npm install

# 2. Create the database
createdb -U postgres car_rental_dev
#   Windows without createdb on PATH:
#   psql -U postgres -c "CREATE DATABASE car_rental_dev;"

# 3. Configure the backend
cp backend/.env.example backend/.env
#   then edit backend/.env and set DATABASE_URL to your real Postgres password

# 4. Configure the frontends
cp frontend/.env.example frontend/.env
cp admin/.env.example admin/.env

# 5. Create the database tables
npm run prisma:migrate --workspace backend

# 6. Create the first admin account
#    Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD in backend/.env first.
#    There is no other way to make an admin: public registration always
#    creates a CUSTOMER.
npm run prisma:seed --workspace backend

# 7. OPTIONAL - load a demonstration fleet (28 vehicles, 4 pickup points)
#    so the site has something in it. Every rate in it is a PLACEHOLDER:
#    the real ones come from the client (BRD 51), which is why this is a
#    separate command and not part of the seed above.
npm run seed:demo --workspace backend
```

## Running

Three terminals:

```bash
npm run dev:backend    # API      -> http://localhost:4000
npm run dev:frontend   # Customer -> http://localhost:5173
npm run dev:admin      # Admin    -> http://localhost:5174
```

Health check: <http://localhost:4000/api/v1/health>

## Testing

```bash
npm test                                  # all backend tests
npm run test:watch --workspace backend    # watch mode
```

## Useful commands

| Command | What it does |
| --- | --- |
| `npm run prisma:studio --workspace backend` | Browse the database in a GUI |
| `npm run prisma:seed --workspace backend` | Create/reset the first admin account |
| `npm run seed:demo --workspace backend` | Load the demonstration fleet (placeholder rates) |
| `npm run seed:demo:clear --workspace backend` | Remove the demonstration fleet again |
| `npm run images:generate --workspace backend` | Draw an image for every vehicle that has none (`-- --force` redraws all) |
| `npm run prisma:migrate --workspace backend` | Create and apply a migration after editing the schema |
| `npm run prisma:generate --workspace backend` | Regenerate the typed Prisma client |
| `npm run typecheck --workspace backend` | Type-check without emitting |
| `npm run build` | Production build of all three apps |
| `npm run test:coverage --workspace backend` | Tests with coverage; thresholds fail the build |
| `npm run audit:prod` | Audit the production dependency tree only |
| `npm run storage:sweep --workspace backend` | Report files no database row points at (add `-- --delete` to remove) |
| `npm run openapi:generate --workspace backend` | Regenerate `openapi.json` from the live router |
| `npm run openapi:check --workspace backend` | Fail if the committed spec has drifted |

## Running in Docker

Local stack only — not a deployment. TLS, migrations-on-release and shared
object storage are noted in `docker-compose.yml` rather than guessed at.

```bash
cp .env.example .env      # set POSTGRES_PASSWORD, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET
docker compose up --build
docker compose run --rm api npm run prisma:deploy --workspace backend
```

The API image runs as a non-root user, contains no TypeScript or tests, and
health-checks against the **liveness** probe — a liveness check that fails on a
database blip gets the container restarted, which fixes nothing.

## Layout

```
car-rental-system/
├── backend/          Express API — the source of truth for all business logic
│   ├── prisma/       Database schema and migrations
│   ├── src/
│   │   ├── config/       env validation, logger, Prisma client
│   │   ├── middleware/   request id, 404, central error handler
│   │   ├── modules/      one folder per business domain
│   │   ├── routes/       API v1 router
│   │   └── utils/        ApiError, response helpers
│   └── tests/
├── frontend/         Customer website (React SPA)
├── admin/            Admin + staff dashboard (React SPA)
├── docs/             Architecture, database, API, development plan
└── docker-compose.yml
```

## Ground rules

1. **The backend decides.** Availability, prices, permissions and payment status
   are computed server-side. A total submitted by the browser is ignored.
2. **No business logic in React components or Express route files.** It lives in
   backend services.
3. **Secrets stay in `.env`.** `.env` is gitignored; `.env.example` documents the
   keys with no real values.
4. **Card details are never stored.** The payment provider handles them.
5. **Nothing the BRD leaves to the client is invented.** It becomes a setting.

## Documentation

- [Architecture](docs/architecture.md)
- [Database design](docs/database.md)
- [API reference](docs/api.md)
- [Development plan](docs/development-plan.md)
