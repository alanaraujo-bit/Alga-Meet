# syntax=docker/dockerfile:1
#
# Alga Meet API + gateway (apps/server). Build context = monorepo root:
#   docker build -f infra/server/Dockerfile -t alga-api .
# Railway: service variable RAILWAY_DOCKERFILE_PATH=infra/server/Dockerfile, root directory = repo root.
# Migrations (apps/server/drizzle) run at startup, before the server listens.
#
# Only explicit paths are copied (never `COPY . .`), so local .env files, data/ and node_modules cannot leak into
# the image even if the context has them (see Dockerfile.dockerignore for the context itself).

ARG NODE_IMAGE=node:24-bookworm-slim

# ---- build: bundle apps/server (+ @alga/shared sources) with esbuild --------------------------------------------
FROM ${NODE_IMAGE} AS build
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false
# Manifests first: this layer is reused until a package.json or the lockfile changes. Every workspace manifest is
# needed for `npm ci` to accept the lockfile; only the server workspace is installed.
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/desktop/package.json apps/desktop/
# No install scripts: esbuild and @node-rs/argon2 ship platform binaries as optional dependencies.
RUN npm ci --workspace @alga/server --include-workspace-root=false --ignore-scripts
COPY packages/shared/src packages/shared/src
COPY apps/server/tsconfig.json apps/server/
COPY apps/server/src apps/server/src
RUN npm run build --workspace @alga/server

# ---- runtime: production dependencies + bundle + migrations, as the unprivileged `node` user --------------------
FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4000 \
    NPM_CONFIG_UPDATE_NOTIFIER=false
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/desktop/package.json apps/desktop/
RUN npm ci --workspace @alga/server --include-workspace-root=false --omit=dev --ignore-scripts --no-audit --no-fund \
 && npm cache clean --force
COPY --from=build /app/apps/server/dist apps/server/dist
COPY apps/server/drizzle apps/server/drizzle
COPY apps/server/assets apps/server/assets
# MLS WASM build used by the E2EE Delivery Service (committed artifacts, checked by `npm run verify:mls`).
COPY native/mls/pkg native/mls/pkg
# Writable only for STORAGE_DRIVER=local with a mounted volume (and PGlite, which production never uses).
RUN mkdir -p apps/server/data && chown node:node apps/server/data
USER node
EXPOSE 4000
# Railway uses its own healthcheck (healthcheck path in infra/server/railway.ts); this one serves plain Docker/compose.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 4000) + '/api/v1/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
# Exec form: node is PID 1 and receives SIGTERM directly (graceful shutdown in src/index.ts, 10 s).
CMD ["node", "apps/server/dist/index.js"]
