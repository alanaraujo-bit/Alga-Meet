import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { ExtractTablesWithRelations } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT, PgTransaction } from 'drizzle-orm/pg-core'
import { serverRoot, type Config } from '../config.js'
import { metrics } from '../metrics.js'
import * as schema from './schema.js'

export type Schema = typeof schema
export type Db = PgDatabase<PgQueryResultHKT, Schema>
export type Tx = PgTransaction<PgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>

export interface Database {
  db: Db
  driver: 'postgres' | 'pglite'
  close(): Promise<void>
}

const migrationsFolder = join(serverRoot, 'drizzle')

const OPS = new Set(['select', 'insert', 'update', 'delete', 'with', 'begin', 'commit', 'rollback'])
const opOf = (text: unknown) => {
  const op = typeof text === 'string' ? /^\s*(\w+)/.exec(text)?.[1]?.toLowerCase() : undefined
  return op && OPS.has(op) ? op : 'other'
}

/**
 * Wraps a driver's `query` to feed alga_db_query_duration_seconds / alga_db_query_errors_total. Handles both the
 * promise style (drizzle) and the callback style (pg's Pool.query calls client.query(text, values, cb)).
 */
function timed<F extends (...args: any[]) => any>(driver: 'postgres' | 'pglite', query: F): F {
  return function (this: unknown, ...args: any[]) {
    const first = args[0] as { text?: unknown } | string | undefined
    const labels = { driver, op: opOf(typeof first === 'string' ? first : first?.text) }
    const stop = metrics.dbQueryDuration.start(labels)
    const done = (err?: unknown) => {
      stop()
      if (err) metrics.dbQueryErrors.inc(labels)
    }
    const cb = args.at(-1)
    if (typeof cb === 'function') {
      args[args.length - 1] = (err: unknown, ...rest: unknown[]) => { done(err); cb(err, ...rest) }
      return query.apply(this, args)
    }
    const out = query.apply(this, args)
    if (out && typeof out.then === 'function') out.then(() => done(), done)
    return out
  } as F
}

/** DATABASE_URL → node-postgres; otherwise embedded PGlite. Migrations are applied before returning. */
export async function openDatabase(config: Pick<Config, 'databaseUrl' | 'pgliteDir'>): Promise<Database> {
  if (config.databaseUrl) {
    const { default: pg } = await import('pg')
    const { drizzle } = await import('drizzle-orm/node-postgres')
    const { migrate } = await import('drizzle-orm/node-postgres/migrator')
    const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 })
    // Every physical connection (pool.query and transactions alike) goes through its client's query.
    pool.on('connect', (client) => { client.query = timed('postgres', client.query) })
    const db = drizzle({ client: pool, schema })
    try {
      // A non-UTF8 database (initdb's default on Windows is WIN1252) rejects emoji and most non-Latin text at INSERT.
      const { rows } = await pool.query<{ enc: string }>("select current_setting('server_encoding') as enc")
      if (rows[0]?.enc !== 'UTF8') throw new Error(`database encoding must be UTF8, got ${rows[0]?.enc}`)
      await migrate(db, { migrationsFolder })
    } catch (err) {
      await pool.end()
      throw err
    }
    return { db: db as unknown as Db, driver: 'postgres', close: () => pool.end() }
  }

  const { PGlite } = await import('@electric-sql/pglite')
  const { drizzle } = await import('drizzle-orm/pglite')
  const { migrate } = await import('drizzle-orm/pglite/migrator')
  if (!config.pgliteDir.startsWith('memory://')) mkdirSync(config.pgliteDir, { recursive: true })
  const client = await PGlite.create(config.pgliteDir)
  // drizzle calls query on the instance, or on the Transaction handed to transaction()'s callback.
  client.query = timed('pglite', client.query)
  const transaction = client.transaction.bind(client)
  client.transaction = (fn) => transaction((tx) => {
    tx.query = timed('pglite', tx.query)
    return fn(tx)
  })
  const db = drizzle({ client, schema })
  try {
    await migrate(db, { migrationsFolder })
  } catch (err) {
    await client.close()
    throw err
  }
  return { db: db as unknown as Db, driver: 'pglite', close: () => client.close() }
}

/** Postgres unique_violation, looking through drizzle's DrizzleQueryError wrapper. */
export function isUniqueViolation(err: unknown): boolean {
  for (let e = err as { code?: unknown; cause?: unknown } | undefined; e; e = e.cause as typeof e) {
    if (e.code === '23505') return true
  }
  return false
}
