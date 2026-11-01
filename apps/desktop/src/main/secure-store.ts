import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import { log } from './log'
import { writeFileAtomic } from './settings'

// Session token encrypted with DPAPI (safeStorage) in userData/session.bin.
// If encryption is unavailable the token lives in memory only: plaintext never touches disk.
const file = () => join(app.getPath('userData'), 'session.bin')
let memoryOnly: string | null = null
let warned = false

function encryptionAvailable(): boolean {
  const ok = safeStorage.isEncryptionAvailable()
  if (!ok && !warned) {
    warned = true
    log.warn('safeStorage encryption unavailable: session token kept in memory only (not persisted)')
  }
  return ok
}

export async function getToken(): Promise<string | null> {
  if (!encryptionAvailable()) return memoryOnly
  try {
    return safeStorage.decryptString(await readFile(file()))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log.warn('stored session token unreadable; ignoring it', err)
    return null
  }
}

export async function setToken(token: string | null): Promise<void> {
  memoryOnly = null
  if (token === null) {
    await rm(file(), { force: true })
    return
  }
  if (!encryptionAvailable()) {
    memoryOnly = token
    return
  }
  writeFileAtomic(file(), safeStorage.encryptString(token))
}
