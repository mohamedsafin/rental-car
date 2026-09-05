# syntax=docker/dockerfile:1
#
# backend/Dockerfile
# ---------------------------------------------------------------------------
# Multi-stage build for the API.
#
# The stages exist so the runtime image contains the compiled JavaScript and
# production dependencies only - no TypeScript, no test suite, no source. A
# smaller image is a smaller attack surface, and it is also the difference
# between a 200MB deploy and a 1.2GB one.
#
# Built from the REPOSITORY ROOT, not this directory:
#   docker build -f backend/Dockerfile -t car-rental-api .
# because npm workspaces resolve from the root package-lock.json, and a build
# context of `backend/` alone cannot see it.

# --- Stage 1: dependencies -------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app

# Only the manifests first. Docker caches this layer, so a source-only change
# does not re-download the entire dependency tree.
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
COPY admin/package.json ./admin/

# `npm ci` installs exactly the lockfile - no silent version drift between a
# developer's machine and production.
RUN npm ci --workspace backend --include-workspace-root

# --- Stage 2: build --------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/backend/node_modules ./backend/node_modules
COPY package.json package-lock.json ./
COPY backend ./backend

# The Prisma client is generated code. It must be produced against the schema
# in this image, not copied from a developer's machine where it may have been
# generated from a different one.
RUN npm run prisma:generate --workspace backend \
 && npm run build --workspace backend

# --- Stage 3: runtime ------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production

# Alpine's node image ships a `node` user. Running as root inside a container
# means a container escape starts as root on the host.
RUN mkdir -p /app/uploads && chown -R node:node /app

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/backend/node_modules ./backend/node_modules
COPY --from=build --chown=node:node /app/backend/dist ./backend/dist
COPY --from=build --chown=node:node /app/backend/package.json ./backend/
COPY --from=build --chown=node:node /app/backend/prisma ./backend/prisma
COPY --from=build --chown=node:node /app/package.json ./

USER node
WORKDIR /app/backend

EXPOSE 4000

# Hits the LIVENESS probe, not the readiness one. A liveness check that fails
# when the database blips gets the container killed and restarted, which does
# not fix a database problem and turns a brief outage into a crash loop.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/api/v1/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Migrations are NOT run here. `prisma migrate deploy` belongs in a release
# step that runs once, not in every container's entrypoint - three replicas
# starting together would race each other through the same migration.
CMD ["node", "dist/server.js"]
