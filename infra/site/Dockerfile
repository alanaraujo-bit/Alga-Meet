# syntax=docker/dockerfile:1
#
# Alga Meet site (apps/site, Astro, static) served by Caddy, which also proxies /api to the API (the invite page's
# preview), so the site talks to it on its own origin. Build context = monorepo root:
#   docker build -f infra/site/Dockerfile -t alga-site .
# Railway: RAILWAY_DOCKERFILE_PATH=infra/site/Dockerfile, ALGA_API_UPSTREAM=https://<api host>, PORT=8080.

ARG NODE_IMAGE=node:24-bookworm-slim

FROM ${NODE_IMAGE} AS build
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false ASTRO_TELEMETRY_DISABLED=1
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/desktop/package.json apps/desktop/
COPY apps/site/package.json apps/site/
RUN npm ci --workspace @alga/site --include-workspace-root=false --ignore-scripts
COPY apps/site apps/site
ARG PUBLIC_SITE_URL=https://algameet.com
ARG PUBLIC_WEB_APP_URL=https://app.algameet.com
RUN PUBLIC_SITE_URL=$PUBLIC_SITE_URL PUBLIC_WEB_APP_URL=$PUBLIC_WEB_APP_URL npm run build --workspace @alga/site

FROM caddy:2.10-alpine
COPY infra/site/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/site/dist /srv
