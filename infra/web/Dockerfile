# syntax=docker/dockerfile:1
#
# Alga Meet PWA: the desktop renderer built for the browser (apps/desktop, vite.web.config.ts), served by Caddy.
# Caddy also proxies /api and /gateway to the API, so the PWA talks to it on its own origin (no CORS change there).
# Build context = monorepo root:
#   docker build -f infra/web/Dockerfile -t alga-web .
# Railway: service variable RAILWAY_DOCKERFILE_PATH=infra/web/Dockerfile, ALGA_API_UPSTREAM=https://<api host>.

ARG NODE_IMAGE=node:24-bookworm-slim

FROM ${NODE_IMAGE} AS build
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/desktop/package.json apps/desktop/
# No install scripts: Electron's binary download and the native hook module are desktop-only.
RUN npm ci --workspace @alga/desktop --include-workspace-root=false --ignore-scripts
COPY packages/shared/src packages/shared/src
COPY apps/desktop/livekit-red.ts apps/desktop/vite.web.config.ts apps/desktop/tsconfig.json apps/desktop/tsconfig.web.json apps/desktop/
COPY apps/desktop/src apps/desktop/src
RUN npm run build:web --workspace @alga/desktop

FROM caddy:2.10-alpine
COPY infra/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/desktop/out/web /srv
