# UAE Car Rental Web Application

Online car rental platform for the UAE: a customer website for searching and
booking vehicles, and an admin/staff dashboard for running the rental business.

Built from the project Business Requirements Document (BRD). Values the BRD
marks as client-supplied — VAT rate, deposit amounts, cancellation fees,
document requirements — are **configurable settings, not hardcoded numbers**.

## Status

**Phase 2 complete — Authentication, users, roles & RBAC.** See
[docs/development-plan.md](docs/development-plan.md) for the roadmap.

Done so far: monorepo foundation, health checks, JWT auth with refresh-token
rotation, three roles with backend-enforced RBAC, admin user management and an
audit trail.

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
| `npm run prisma:migrate --workspace backend` | Create and apply a migration after editing the schema |
| `npm run prisma:generate --workspace backend` | Regenerate the typed Prisma client |
| `npm run typecheck --workspace backend` | Type-check without emitting |
| `npm run build` | Production build of all three apps |

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
