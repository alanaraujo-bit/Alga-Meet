import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import { log } from './log'
import { writeFileAtomic } from './settings'

// Session token encrypted with DPAPI (safeStorage) in userData/session.bin.
// If encryption is unavailable the token lives in memory only: plaintext never touches disk.
// Async API (the sync one is deprecated); it decrypts files written by the old encryptString too.
const file = () => join(app.getPath('userData'), 'session.bin')
let memoryOnly: string | null = null
let warned = false

async function encryptionAvailable(): Promise<boolean> {
  const ok = await safeStorage.isAsyncEncryptionAvailable()
  if (!ok && !warned) {
    warned = true
    log.warn('safeStorage encryption unavailable: session token kept in memory only (not persisted)')
  }
  return ok
}

export async function getToken(): Promise<string | null> {
  if (!(await encryptionAvailable())) return memoryOnly
  try {
    const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(await readFile(file()))
    // Key rotated: store it again under the current key (a failed rewrite still returns the token).
    if (shouldReEncrypt) await setToken(result).catch((err) => log.warn('session token re-encryption failed', err))
    return result
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
  if (!(await encryptionAvailable())) {
    memoryOnly = token
    return
  }
  writeFileAtomic(file(), await safeStorage.encryptStringAsync(token))
}
