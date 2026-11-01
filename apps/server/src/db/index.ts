import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { ExtractTablesWithRelations } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT, PgTransaction } from 'drizzle-orm/pg-core'
import { serverRoot, type Config } from '../config.js'
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

/** DATABASE_URL → node-postgres; otherwise embedded PGlite. Migrations are applied before returning. */
export async function openDatabase(config: Config): Promise<Database> {
  if (config.databaseUrl) {
    const { default: pg } = await import('pg')
    const { drizzle } = await import('drizzle-orm/node-postgres')
    const { migrate } = await import('drizzle-orm/node-postgres/migrator')
    const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 })
    const db = drizzle({ client: pool, schema })
    try {
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
