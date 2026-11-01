import type { BrowserWindow } from 'electron'
import type { DeepLink } from '../shared/bridge'
import { IPC } from '../shared/ipc'
import { findDeepLinkArg, parseDeepLink, redactLink } from './deep-link-logic'
import { emit, handle } from './ipc'
import { log } from './log'

// algameet:// links arrive in argv: the first process's (cold start) or a second instance's.
// Until the page calls takePending() the latest link waits here; after that it is pushed live.
let pending: DeepLink | null = null
let pageListening = false

/** Validates the link in argv (if any) and delivers it. True when a valid link was received. */
export function receiveDeepLink(argv: readonly string[]): boolean {
  const raw = findDeepLinkArg(argv)
  if (raw === undefined) return false
  const link = parseDeepLink(raw)
  if (!link) {
    log.warn('deep link rejected', redactLink(raw))
    return false
  }
  log.info('deep link received', link.kind) // never the token/code
  if (pageListening) emit(IPC.deepLink, link)
  else pending = link
  return true
}

export function registerDeepLinkIpc(): void {
  handle(IPC.deepLinksTakePending, () => {
    pageListening = true
    const link = pending
    pending = null
    return link
  })
}

/** A reload or crash replaces the page: hold links again until the new page asks for them. */
export function trackDeepLinkPage(win: BrowserWindow): void {
  win.webContents.on('did-start-navigation', (e) => {
    if (e.isMainFrame && !e.isSameDocument) pageListening = false
  })
  win.webContents.on('render-process-gone', () => {
    pageListening = false
  })
}
