import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, session, shell } from 'electron'
import { log } from './log'
import { embedReferer, isYoutubeEmbed } from './music-logic'

const rendererIndex = join(__dirname, '../renderer/index.html')
const devUrl = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined
const indexHref = pathToFileURL(rendererIndex).href

/** What the main window loads: the Vite dev server in dev, the built index.html otherwise. */
export const rendererUrl = devUrl ?? indexHref

/** True only for our own renderer page (any hash/query), never for other files or origins. */
export function isAppUrl(url: string): boolean {
  try {
    const u = new URL(url)
    if (devUrl) return u.origin === new URL(devUrl).origin
    u.hash = ''
    u.search = ''
    return u.href === indexHref
  } catch {
    return false
  }
}

export function isExternalWebUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url)
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}

// Used only if the built index.html lost its CSP meta (should never happen).
const FALLBACK_CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' blob: mediastream: https:; font-src 'self' data:; connect-src 'self' https: wss:; frame-src https:; worker-src 'self' blob:"

/** The header mirrors the <meta> CSP of the built index.html, so the two can never drift apart. */
function rendererCsp(): string {
  try {
    const m = /<meta[^>]+http-equiv="Content-Security-Policy"[^>]+content="([^"]+)"/i.exec(readFileSync(rendererIndex, 'utf8'))
    if (m?.[1]) return m[1].replace(/\s+/g, ' ').trim()
  } catch {}
  log.warn('renderer CSP meta not found; using fallback CSP header')
  return FALLBACK_CSP
}

// display-capture: getDisplayMedia asks for it first; the real gate is capture.ts (explicit picker selection).
// fullscreen: watching a stream full screen. Everything not listed is denied.
const ALLOWED_PERMISSIONS = new Set(['media', 'display-capture', 'notifications', 'clipboard-sanitized-write', 'fullscreen'])

export function applySecurity(apiUrl: string): void {
  const ses = session.defaultSession

  // YouTube's embedded player (music in a call) needs a Referer; a file:// page sends none (music-logic.ts).
  const referer = embedReferer(apiUrl)
  ses.webRequest.onBeforeSendHeaders({ urls: ['https://www.youtube-nocookie.com/embed/*'] }, (d, callback) => {
    callback({ requestHeaders: isYoutubeEmbed(d.url) ? { ...d.requestHeaders, Referer: referer } : d.requestHeaders })
  })

  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const ok = ALLOWED_PERMISSIONS.has(permission) && isAppUrl(details.requestingUrl || wc.getURL())
    if (!ok) log.warn('permission denied', permission, details.requestingUrl)
    callback(ok)
  })
  ses.setPermissionCheckHandler(
    (wc, permission, _origin, details) => ALLOWED_PERMISSIONS.has(permission) && isAppUrl(details.requestingUrl ?? wc?.getURL() ?? ''),
  )
  // No device chooser is ever granted (HID/USB/serial/bluetooth).
  ses.setDevicePermissionHandler(() => false)

  if (!devUrl) {
    const csp = rendererCsp()
    ses.webRequest.onHeadersReceived((d, callback) => {
      if (d.url.startsWith('file:') && (d.resourceType === 'mainFrame' || d.resourceType === 'subFrame'))
        callback({ responseHeaders: { ...d.responseHeaders, 'Content-Security-Policy': [csp] } })
      else callback({})
    })
  }

  app.on('web-contents-created', (_e, wc) => {
    const guard = (e: Electron.Event, url: string) => {
      if (isAppUrl(url)) return
      e.preventDefault()
      log.warn('blocked navigation', url)
      if (isExternalWebUrl(url)) void shell.openExternal(url)
    }
    wc.on('will-navigate', (e) => guard(e, e.url))
    wc.on('will-redirect', (e) => guard(e, e.url))
    wc.on('will-attach-webview', (e) => {
      e.preventDefault()
      log.warn('blocked <webview>')
    })
    wc.setWindowOpenHandler(({ url }) => {
      if (isExternalWebUrl(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
  })
}
