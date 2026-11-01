import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

/** apps/server — this file sits one level below it both in src/ and in the bundled dist/. */
export const serverRoot = fileURLToPath(new URL('..', import.meta.url))

const DEV_LIVEKIT_SECRET = 'alga-dev-secret-change-me-0123456789abcdef'

const bool = z
  .enum(['true', 'false', '1', '0'])
  .default('false')
  .transform((v) => v === 'true' || v === '1')

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(0).max(65535).default(4000),
    HOST: z.string().min(1).default('127.0.0.1'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    TRUST_PROXY: bool,
    DATABASE_URL: z.string().url().optional(),
    PGLITE_DIR: z.string().min(1).default(join(serverRoot, 'data', 'pglite')),
    LIVEKIT_URL: z.string().url().default('http://127.0.0.1:7880'),
    LIVEKIT_PUBLIC_URL: z.string().url().default('ws://127.0.0.1:7880'),
    LIVEKIT_API_KEY: z.string().min(1).default('devkey'),
    LIVEKIT_API_SECRET: z.string().min(32).optional(),
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:5173,http://127.0.0.1:5173,null,file://')
      .transform((s) => s.split(',').map((o) => o.trim()).filter(Boolean)),
    HEARTBEAT_INTERVAL_MS: z.coerce.number().int().min(1000).default(30_000),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return
    if (!env.LIVEKIT_API_SECRET || env.LIVEKIT_API_SECRET === DEV_LIVEKIT_SECRET) {
      ctx.addIssue({ code: 'custom', path: ['LIVEKIT_API_SECRET'], message: 'required in production (and must not be the dev secret)' })
    }
    if (!env.DATABASE_URL) {
      ctx.addIssue({ code: 'custom', path: ['DATABASE_URL'], message: 'required in production' })
    }
  })

export interface Config {
  env: 'development' | 'test' | 'production'
  port: number
  host: string
  logLevel: string
  trustProxy: boolean
  databaseUrl: string | undefined
  pgliteDir: string
  livekit: { url: string; publicUrl: string; apiKey: string; apiSecret: string }
  corsOrigins: string[]
  heartbeatIntervalMs: number
  version: string
}

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
      apiKey: e.LIVEKIT_API_KEY,
      apiSecret: e.LIVEKIT_API_SECRET ?? DEV_LIVEKIT_SECRET,
    },
    corsOrigins: e.CORS_ORIGINS,
    heartbeatIntervalMs: e.HEARTBEAT_INTERVAL_MS,
    version: (JSON.parse(readFileSync(join(serverRoot, 'package.json'), 'utf8')) as { version: string }).version,
  }
}
