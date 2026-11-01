/**
 * Railway Infrastructure as Code for the Alga Meet API: API service + Postgres + bucket.
 *
 * Why not railway.json: Config as Code is deprecated (new services cannot opt in, existing files stop being read on
 * 2026-12-01, docs.railway.com/config-as-code). This file is the replacement, evaluated by the Railway CLI only:
 *   npm i -D railway                                        # TypeScript SDK (not installed in this repo yet)
 *   railway login && railway link                           # choose the project/environment
 *   railway config plan  --file infra/server/railway.ts     # read-only preview, safe
 *   railway config apply --file infra/server/railway.ts     # CREATES PAID RESOURCES: owner approval first
 * Secrets are never written here: `preserve()` keeps values set in the dashboard (docs/infra/deploy.md §3).
 * Not yet planned or applied against a real project.
 */
import { bucket, defineRailway, github, postgres, preserve, project, service } from 'railway/iac'

export default defineRailway(() => {
  const db = postgres('postgres')
  // Bucket egress is free; region is immutable after creation. Railway has no South America region (closest: US East).
  const uploads = bucket('uploads', { region: 'iad' })

  const api = service('api', {
    source: github('OWNER/alga-meet', { branch: 'main' }), // TODO(owner): real GitHub repo
    // Built with infra/server/Dockerfile from the repo root; migrations run at startup.
    healthcheck: '/api/v1/health',
    healthcheckTimeout: 60,
    // In-memory gateway/voice state and rate limits: exactly one instance until Redis exists (apps/server/README.md).
    replicas: 1,
    domains: [{ domain: 'api.algameet.com.br', port: 4000 }], // TODO(owner): final domain
    env: {
      RAILWAY_DOCKERFILE_PATH: 'infra/server/Dockerfile',
      NODE_ENV: 'production',
      PORT: '4000',
      HOST: '0.0.0.0',
      LOG_LEVEL: 'info',
      // Only reachable through Railway's edge (one hop). Verify the logged remoteAddress after the first deploy.
      TRUST_PROXY: '1',
      DATABASE_URL: db.env.DATABASE_URL,
      PUBLIC_URL: 'https://api.algameet.com.br',
      CORS_ORIGINS: 'null,file://',
      LIVEKIT_URL: 'https://livekit.algameet.com.br',
      LIVEKIT_PUBLIC_URL: 'wss://livekit.algameet.com.br',
      LIVEKIT_API_KEY: preserve(),
      LIVEKIT_API_SECRET: preserve(),
      FILES_SECRET: preserve(),
      STORAGE_DRIVER: 's3',
      // Credentials tab of the bucket (variable references); S3_URL_STYLE=path only if that tab says path-style.
      S3_ENDPOINT: preserve(),
      S3_BUCKET: preserve(),
      S3_REGION: preserve(),
      S3_ACCESS_KEY_ID: preserve(),
      S3_SECRET_ACCESS_KEY: preserve(),
      // Transactional e-mail (verification, password reset). Production refuses to start without a real driver.
      EMAIL_DRIVER: 'resend',
      RESEND_API_KEY: preserve(),
      EMAIL_FROM: 'Alga Meet <nao-responda@algameet.com.br>', // TODO(owner): verified sending domain
      EMAIL_LINK_URL: 'algameet://auth',
    },
  })

  return project('alga-meet', { resources: [api, db, uploads] })
})
