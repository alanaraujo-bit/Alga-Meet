import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { buildApp } from './app.js'
import { loadConfig, serverRoot } from './config.js'

const envFile = join(serverRoot, '.env')
if (existsSync(envFile)) process.loadEnvFile(envFile)

const config = loadConfig()
const app = await buildApp(config)

let shuttingDown = false
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  app.log.info({ signal }, 'shutting down')
  const force = setTimeout(() => {
    app.log.error('graceful shutdown timed out, forcing exit')
    process.exit(1)
  }, 10_000)
  force.unref()
  try {
    await app.close()
    process.exit(0)
  } catch (err) {
    app.log.error({ err }, 'error during shutdown')
    process.exit(1)
  }
}
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => void shutdown(sig))

try {
  await app.listen({ port: config.port, host: config.host })
} catch (err) {
  app.log.fatal({ err }, 'failed to start')
  await app.close().catch((closeErr: unknown) => app.log.error({ err: closeErr }, 'close after failed start also failed'))
  process.exit(1)
}

// Rebuild who-is-in-voice from the SFU; never blocks startup.
void app.ctx.voice.reconcile()
