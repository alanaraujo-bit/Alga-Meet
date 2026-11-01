/**
 * vitest globalSetup for `npm run test:pg`: one real PostgreSQL cluster (embedded-postgres binaries) on a random
 * port with a temp data dir, torn down after the run. Every startServer() creates its own database in it.
 */
import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import EmbeddedPostgres from 'embedded-postgres'
import type { TestProject } from 'vitest/node'

declare module 'vitest' {
  export interface ProvidedContext {
    /** Admin connection string of the test cluster; unset when running on PGlite. */
    pgAdminUrl?: string
  }
}

const freePort = () => new Promise<number>((resolve, reject) => {
  const srv = createServer()
  srv.once('error', reject)
  srv.listen(0, '127.0.0.1', () => {
    const { port } = srv.address() as { port: number }
    srv.close(() => resolve(port))
  })
})

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const dir = mkdtempSync(join(tmpdir(), 'alga-pg-'))
  const port = await freePort()
  const password = randomBytes(12).toString('hex')
  const pg = new EmbeddedPostgres({
    databaseDir: join(dir, 'data'),
    port,
    user: 'postgres',
    password,
    authMethod: 'scram-sha-256',
    persistent: false,
    // Production Postgres is UTF8; initdb on Windows would otherwise pick WIN1252 and reject emoji.
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    // Durability is irrelevant for a throwaway cluster; many test files open their own pools.
    postgresFlags: ['-c', 'max_connections=400', '-c', 'fsync=off', '-c', 'synchronous_commit=off', '-c', 'full_page_writes=off', '-c', 'listen_addresses=127.0.0.1'],
    onLog: () => {},
    onError: (e) => { if (process.env.ALGA_PG_DEBUG) console.error('[pg]', e) },
  })
  await pg.initialise()
  await pg.start()
  const client = pg.getPgClient('postgres', '127.0.0.1')
  await client.connect()
  const { rows } = await client.query<{ v: string }>("select current_setting('server_version') as v")
  await client.end()
  console.log(`[test:pg] PostgreSQL ${rows[0]!.v} on 127.0.0.1:${port}`)
  project.provide('pgAdminUrl', `postgres://postgres:${password}@127.0.0.1:${port}/postgres`)
  return async () => {
    await pg.stop()
    rmSync(dir, { recursive: true, force: true })
  }
}
