/**
 * Grants or revokes a staff role (the only way to get one; the API never sets it). Audit-logged in staff_audit_log.
 *
 *   npx tsx scripts/grant-staff.ts <username> <admin|moderator|none>
 *
 * Uses DATABASE_URL (production: run it where the database is reachable, e.g. `railway run`), otherwise the PGlite
 * directory PGLITE_DIR (default data/pglite). PGlite allows one process: stop the dev server first, or it deadlocks.
 * Reads apps/server/.env like the server.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { serverRoot } from '../src/config.js'
import { openDatabase } from '../src/db/index.js'
import { setStaffRole } from '../src/trust-safety.js'

const envFile = join(serverRoot, '.env')
if (existsSync(envFile)) process.loadEnvFile(envFile)
const [username, role] = process.argv.slice(2)
if (!username || !role || !['admin', 'moderator', 'none'].includes(role)) {
  console.error('usage: tsx scripts/grant-staff.ts <username> <admin|moderator|none>')
  process.exit(2)
}
const database = await openDatabase({
  databaseUrl: process.env.DATABASE_URL,
  pgliteDir: process.env.PGLITE_DIR ?? join(serverRoot, 'data', 'pglite'),
})
try {
  const u = await setStaffRole(database.db, username, role === 'none' ? null : (role as 'admin' | 'moderator'))
  console.log(`${u.username} (${u.id}): staff role = ${u.staffRole ?? 'none'}`)
} catch (err) {
  console.error((err as Error).message)
  process.exitCode = 1
} finally {
  await database.close()
}
