import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

/** apps/server — this file sits one level below it both in src/ and in the bundled dist/. */
export const serverRoot = fileURLToPath(new URL('..', import.meta.url))

// Public (infra/livekit/livekit.dev.yaml, .env.example): only usable in explicit dev mode.
const DEV_LIVEKIT_KEY = 'devkey'
const DEV_LIVEKIT_SECRET = 'alga-dev-secret-change-me-0123456789abcdef'
const DEV_CORS_ORIGINS = 'http://localhost:5173,http://127.0.0.1:5173,null,file://'
const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost'])

const bool = z
  .enum(['true', 'false', '1', '0'])
  .default('false')
  .transform((v) => v === 'true' || v === '1')

/** false | number of trusted proxy hops | trusted proxy IPs/CIDRs. `true` would trust a client-chosen X-Forwarded-For. */
const trustProxy = z.string().default('false').transform((raw, ctx): false | number | string[] => {
  const v = raw.trim().toLowerCase()
  if (v === '' || v === 'false' || v === '0') return false
  if (v === 'true') {
    ctx.addIssue({ code: 'custom', message: 'use the number of proxy hops (e.g. 1) or the proxy IPs/CIDRs; "true" trusts any X-Forwarded-For' })
    return z.NEVER
  }
  if (/^\d+$/.test(v)) return Number(v)
  return v.split(',').map((s) => s.trim()).filter(Boolean)
})

const EnvSchema = z
  .object({
    // Fail closed: an unset NODE_ENV is production.
    NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
    PORT: z.coerce.number().int().min(0).max(65535).default(4000),
    HOST: z.string().min(1).default('127.0.0.1'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    TRUST_PROXY: trustProxy,
    DATABASE_URL: z.string().url().optional(),
    PGLITE_DIR: z.string().min(1).default(join(serverRoot, 'data', 'pglite')),
    LIVEKIT_URL: z.string().url().default('http://127.0.0.1:7880'),
    LIVEKIT_PUBLIC_URL: z.string().url().default('ws://127.0.0.1:7880'),
    LIVEKIT_API_KEY: z.string().min(1).optional(),
    LIVEKIT_API_SECRET: z.string().min(32).optional(),
    /** Escape hatch for the public dev LiveKit credentials outside a loopback dev/test setup. */
    ALGA_ALLOW_DEV_SECRETS: bool,
    CORS_ORIGINS: z.string().optional(),
    HEARTBEAT_INTERVAL_MS: z.coerce.number().int().min(1000).default(30_000),
    /** Origin clients use to reach this API (file and avatar URLs are absolute). https in production. */
    PUBLIC_URL: z.url().optional(),
    /** HMAC key for signed file URLs. Production: required; dev/test: random per process. */
    FILES_SECRET: z.string().min(32).optional(),
    STORAGE_DRIVER: z.enum(['local', 's3']).optional(),
    UPLOADS_DIR: z.string().min(1).default(join(serverRoot, 'data', 'uploads')),
    S3_ENDPOINT: z.url().optional(),
    S3_BUCKET: z.string().min(1).optional(),
    S3_REGION: z.string().min(1).default('auto'),
    S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    /** Railway Buckets, R2 and AWS take virtual-hosted URLs; MinIO and older Railway buckets need path-style. */
    S3_URL_STYLE: z.enum(['virtual', 'path']).default('virtual'),
    MAX_ATTACHMENT_BYTES: z.coerce.number().int().min(1024).max(500 * 1024 * 1024).default(25 * 1024 * 1024),
    FILE_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(7 * 24 * 3600).default(3600),
  })
  .superRefine((env, ctx) => {
    const devMode = env.ALGA_ALLOW_DEV_SECRETS || (env.NODE_ENV !== 'production' && LOOPBACK.has(env.HOST))
    if (!devMode) {
      const why = 'required and must not be the public dev value (dev values need NODE_ENV=development on a loopback HOST, or ALGA_ALLOW_DEV_SECRETS=1)'
      if (!env.LIVEKIT_API_SECRET || env.LIVEKIT_API_SECRET === DEV_LIVEKIT_SECRET) ctx.addIssue({ code: 'custom', path: ['LIVEKIT_API_SECRET'], message: why })
      if (!env.LIVEKIT_API_KEY || env.LIVEKIT_API_KEY === DEV_LIVEKIT_KEY) ctx.addIssue({ code: 'custom', path: ['LIVEKIT_API_KEY'], message: why })
    }
    if (env.NODE_ENV === 'production') {
      if (!env.DATABASE_URL) ctx.addIssue({ code: 'custom', path: ['DATABASE_URL'], message: 'required in production' })
      if (!env.CORS_ORIGINS?.trim()) ctx.addIssue({ code: 'custom', path: ['CORS_ORIGINS'], message: 'required in production (no permissive default)' })
      if (!env.PUBLIC_URL?.startsWith('https://')) ctx.addIssue({ code: 'custom', path: ['PUBLIC_URL'], message: 'required in production, https://' })
      if (!env.FILES_SECRET) ctx.addIssue({ code: 'custom', path: ['FILES_SECRET'], message: 'required in production (≥ 32 random characters)' })
      // Container disks are ephemeral: picking local storage must be a deliberate choice (with a volume).
      if (!env.STORAGE_DRIVER) ctx.addIssue({ code: 'custom', path: ['STORAGE_DRIVER'], message: 'required in production: s3, or local with a persistent UPLOADS_DIR' })
    }
    if (env.STORAGE_DRIVER === 's3') {
      for (const k of ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const) {
        if (!env[k]) ctx.addIssue({ code: 'custom', path: [k], message: 'required with STORAGE_DRIVER=s3' })
      }
    }
  })

export interface Config {
  env: 'development' | 'test' | 'production'
  port: number
  host: string
  logLevel: string
  /** Fastify `trustProxy`: never `true`. */
  trustProxy: false | number | string[]
  databaseUrl: string | undefined
  pgliteDir: string
  livekit: { url: string; publicUrl: string; apiKey: string; apiSecret: string }
  corsOrigins: string[]
  heartbeatIntervalMs: number
  version: string
  /** No trailing slash. */
  publicUrl: string
  files: { secret: string; urlTtlSeconds: number; maxAttachmentBytes: number }
  storage: StorageConfig
}

export type StorageConfig =
  | { driver: 'local'; dir: string }
  | { driver: 's3'; endpoint: string; bucket: string; region: string; accessKeyId: string; secretAccessKey: string; pathStyle: boolean }

const urlHost = (host: string) => (host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host.includes(':') ? `[${host}]` : host)

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = EnvSchema.safeParse(env)
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`)
    throw new Error(`Invalid environment:\n${lines.join('\n')}`)
  }
  const e = parsed.data
  return {
    env: e.NODE_ENV,
    port: e.PORT,
    host: e.HOST,
    logLevel: e.LOG_LEVEL,
    trustProxy: e.TRUST_PROXY,
    databaseUrl: e.DATABASE_URL,
    pgliteDir: e.PGLITE_DIR,
    livekit: {
      url: e.LIVEKIT_URL,
      publicUrl: e.LIVEKIT_PUBLIC_URL,
      apiKey: e.LIVEKIT_API_KEY ?? DEV_LIVEKIT_KEY,
      apiSecret: e.LIVEKIT_API_SECRET ?? DEV_LIVEKIT_SECRET,
    },
    corsOrigins: (e.CORS_ORIGINS ?? DEV_CORS_ORIGINS).split(',').map((o) => o.trim()).filter(Boolean),
    heartbeatIntervalMs: e.HEARTBEAT_INTERVAL_MS,
    version: (JSON.parse(readFileSync(join(serverRoot, 'package.json'), 'utf8')) as { version: string }).version,
    publicUrl: (e.PUBLIC_URL ?? `http://${urlHost(e.HOST)}:${e.PORT}`).replace(/\/+$/, ''),
    files: {
      secret: e.FILES_SECRET ?? randomBytes(32).toString('hex'),
      urlTtlSeconds: e.FILE_URL_TTL_SECONDS,
      maxAttachmentBytes: e.MAX_ATTACHMENT_BYTES,
    },
    storage: e.STORAGE_DRIVER === 's3'
      ? {
          driver: 's3', endpoint: e.S3_ENDPOINT!, bucket: e.S3_BUCKET!, region: e.S3_REGION,
          accessKeyId: e.S3_ACCESS_KEY_ID!, secretAccessKey: e.S3_SECRET_ACCESS_KEY!, pathStyle: e.S3_URL_STYLE === 'path',
        }
      : { driver: 'local', dir: e.UPLOADS_DIR },
  }
}
