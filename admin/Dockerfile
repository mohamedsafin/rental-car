# syntax=docker/dockerfile:1
#
# admin/Dockerfile
# ---------------------------------------------------------------------------
# Builds the admin dashboard and serves it from nginx.
#
# Vite inlines VITE_* variables at BUILD time, so the API URL has to be known
# when the image is built - it cannot be injected at run time like a server
# environment variable. That means one image per environment, which is the
# honest trade-off of a static single-page app.
#
# Built from the repository root, not this directory:
#   docker build -f admin/Dockerfile --build-arg VITE_API_URL=... -t car-rental-admin .
# because npm workspaces resolve from the root package-lock.json.

FROM node:22-alpine AS build
WORKDIR /app

# EVERY workspace manifest, not just this one. `npm ci` validates the whole
# lockfile against the workspaces declared in the root package.json, and a
# missing sibling manifest fails the install even though this image never
# builds that sibling.
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
COPY admin/package.json ./admin/
RUN npm ci --workspace admin --include-workspace-root

# The app's own tsconfig comes with this directory. There is deliberately no
# root-level tsconfig to copy - each workspace stands alone - and a COPY whose
# glob matches nothing FAILS the build rather than being skipped.
COPY admin ./admin

ARG VITE_API_URL=http://localhost:4000/api/v1
ARG VITE_APP_NAME="UAE Car Rental Admin"
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_APP_NAME=$VITE_APP_NAME

RUN npm run build --workspace admin

FROM nginx:1.27-alpine AS runtime

COPY --from=build /app/admin/dist /usr/share/nginx/html
COPY admin/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -q --spider http://127.0.0.1/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
