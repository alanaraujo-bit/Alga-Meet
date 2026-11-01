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
    /** console = .eml files in EMAIL_OUTBOX_DIR + log (dev); resend = Resend REST API. Production: explicit. */
    EMAIL_DRIVER: z.enum(['console', 'resend']).optional(),
    /** Lets production run the console driver (e.g. a staging box without a provider). */
    ALGA_ALLOW_CONSOLE_EMAIL: bool,
    EMAIL_OUTBOX_DIR: z.string().min(1).default(join(serverRoot, 'data', 'outbox')),
    /** Sender, e.g. `Alga Meet <nao-responda@algameet.com.br>`; its domain must be verified at the provider. */
    EMAIL_FROM: z.string().min(3).optional(),
    RESEND_API_KEY: z.string().min(1).optional(),
    /** Base of the links in e-mails: `<base>/verify-email?token=…`, `<base>/reset-password?token=…`. */
    EMAIL_LINK_URL: z.url().default('algameet://auth'),
    /** none = payments off (checkout 503). Default: sandbox in development/test, none in production. sandbox is refused in production. */
    BILLING_PROVIDER: z.enum(['none', 'sandbox', 'mercadopago']).optional(),
    MP_ACCESS_TOKEN: z.string().min(1).optional(),
    /** "Assinatura secreta" of the webhook (Suas integrações > Webhooks): HMAC key of `x-signature`. */
    MP_WEBHOOK_SECRET: z.string().min(1).optional(),
    MP_API_URL: z.url().default('https://api.mercadopago.com'),
    /** Page the provider sends the buyer back to after paying (https; e.g. a site page that opens algameet://). */
    BILLING_RETURN_URL: z.url().optional(),
    /** Makes RegisterBody.birthDate and termsVersion mandatory outside production (production always requires them). */
    REQUIRE_BIRTHDATE: bool,
    /** Where the published Termos/Política/Diretrizes live (GET /legal links). */
    LEGAL_URL: z.url().default('https://algameet.com.br/legal'),
    /** Bearer token for GET /metrics. Production: /metrics is off without it; dev/test: open without it. */
    METRICS_TOKEN: z.string().min(32).optional(),
    /** E2EE Delivery Service signing key (external sender of every call group): base64 Ed25519 seed (32 bytes).
     * Production: required; dev/test: random per process. */
    E2EE_DS_KEY: z.string().optional().refine((v) => v === undefined || Buffer.from(v, 'base64').length === 32, 'base64 of 32 random bytes'),
    /** Directory of the MLS WASM build (alga_mls.js + alga_mls_bg.wasm). Default: native/mls/pkg of the monorepo. */
    E2EE_MLS_PKG: z.string().min(1).default(join(serverRoot, '..', '..', 'native', 'mls', 'pkg')),
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
      // A per-process key would change on every restart and differ between instances.
      if (!env.E2EE_DS_KEY) ctx.addIssue({ code: 'custom', path: ['E2EE_DS_KEY'], message: 'required in production (base64 of 32 random bytes)' })
      // Container disks are ephemeral: picking local storage must be a deliberate choice (with a volume).
      if (!env.STORAGE_DRIVER) ctx.addIssue({ code: 'custom', path: ['STORAGE_DRIVER'], message: 'required in production: s3, or local with a persistent UPLOADS_DIR' })
    }
    if (env.NODE_ENV === 'production' && !env.EMAIL_DRIVER) {
      ctx.addIssue({ code: 'custom', path: ['EMAIL_DRIVER'], message: 'required in production: resend (or console with ALGA_ALLOW_CONSOLE_EMAIL=1)' })
    }
    if (env.NODE_ENV === 'production' && env.EMAIL_DRIVER === 'console' && !env.ALGA_ALLOW_CONSOLE_EMAIL) {
      ctx.addIssue({ code: 'custom', path: ['EMAIL_DRIVER'], message: 'console only writes files on the server; set ALGA_ALLOW_CONSOLE_EMAIL=1 to allow it in production' })
    }
    if (env.EMAIL_DRIVER === 'resend') {
      for (const k of ['RESEND_API_KEY', 'EMAIL_FROM'] as const) {
        if (!env[k]) ctx.addIssue({ code: 'custom', path: [k], message: 'required with EMAIL_DRIVER=resend' })
      }
    }
    // Fail closed, no escape hatch: the sandbox grants perks without money changing hands.
    if (env.NODE_ENV === 'production' && env.BILLING_PROVIDER === 'sandbox') {
      ctx.addIssue({ code: 'custom', path: ['BILLING_PROVIDER'], message: 'sandbox is for development/test only; use mercadopago (with test credentials on staging) or none' })
    }
    if (env.BILLING_PROVIDER === 'mercadopago') {
      for (const k of ['MP_ACCESS_TOKEN', 'MP_WEBHOOK_SECRET', 'BILLING_RETURN_URL'] as const) {
        if (!env[k]) ctx.addIssue({ code: 'custom', path: [k], message: 'required with BILLING_PROVIDER=mercadopago' })
      }
      if (env.BILLING_RETURN_URL && !env.BILLING_RETURN_URL.startsWith('https://')) {
        ctx.addIssue({ code: 'custom', path: ['BILLING_RETURN_URL'], message: 'must be https://' })
      }
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
  email: EmailConfig
  billing: BillingConfig
  legal: { requireBirthDate: boolean; url: string }
  /** GET /metrics bearer token (src/observability.ts). */
  metricsToken: string | undefined
  /** src/e2ee.ts. `dsSeed`: Ed25519 seed of the Delivery Service's external-sender key. */
  e2ee: { dsSeed: Buffer; mlsPkg: string }
}

export interface BillingConfig {
  provider: 'none' | 'sandbox' | 'mercadopago'
  /** HMAC key of sandbox webhooks and checkout links; random per process (dev/test only). */
  sandboxSecret: string
  /** mercadopago only. */
  returnUrl: string
  mercadopago?: { accessToken: string; webhookSecret: string; apiUrl: string }
}

export type EmailConfig = { linkUrl: string; from: string } & (
  | { driver: 'console'; outboxDir: string }
  | { driver: 'resend'; apiKey: string }
)

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
    email: {
      linkUrl: e.EMAIL_LINK_URL.replace(/\/+$/, ''),
      ...(e.EMAIL_DRIVER === 'resend'
        ? { driver: 'resend' as const, apiKey: e.RESEND_API_KEY!, from: e.EMAIL_FROM! }
        : { driver: 'console' as const, outboxDir: e.EMAIL_OUTBOX_DIR, from: e.EMAIL_FROM ?? 'Alga Meet <nao-responda@alga.localhost>' }),
    },
    billing: {
      provider: e.BILLING_PROVIDER ?? (e.NODE_ENV === 'production' ? 'none' : 'sandbox'),
      sandboxSecret: randomBytes(32).toString('hex'),
      returnUrl: e.BILLING_RETURN_URL ?? 'https://algameet.com.br/billing/return',
      ...(e.BILLING_PROVIDER === 'mercadopago'
        ? { mercadopago: { accessToken: e.MP_ACCESS_TOKEN!, webhookSecret: e.MP_WEBHOOK_SECRET!, apiUrl: e.MP_API_URL.replace(/\/+$/, '') } }
        : {}),
    },
    legal: { requireBirthDate: e.NODE_ENV === 'production' || e.REQUIRE_BIRTHDATE, url: e.LEGAL_URL.replace(/\/+$/, '') },
    metricsToken: e.METRICS_TOKEN,
    e2ee: { dsSeed: e.E2EE_DS_KEY ? Buffer.from(e.E2EE_DS_KEY, 'base64') : randomBytes(32), mlsPkg: e.E2EE_MLS_PKG },
  }
}
