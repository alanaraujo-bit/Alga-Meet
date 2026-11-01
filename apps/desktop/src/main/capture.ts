import { desktopCapturer, session } from 'electron'
import type { CaptureSource } from '../shared/bridge'
import { IPC } from '../shared/ipc'
import { arr, bool, handle, obj, str } from './ipc'
import { log } from './log'
import { isAppUrl } from './security'

// getDisplayMedia() only ever returns what the user picked in our picker (screen.select) within the
// last few seconds. No selection = denied. Nothing is captured without that explicit action.
const SELECTION_TTL_MS = 10_000
let selection: { id: string; audio: boolean; expires: number } | null = null

async function getSources(raw: unknown): Promise<CaptureSource[]> {
  const types = [...new Set(arr(raw, 2).map((t) => str(t, 8)))]
  if (!types.length || types.some((t) => t !== 'screen' && t !== 'window')) throw new TypeError('types must be screen/window')
  const sources = await desktopCapturer.getSources({
    types: types as Array<'screen' | 'window'>,
    thumbnailSize: { width: 320, height: 200 },
    fetchWindowIcons: true,
  })
  return sources
    .map((s): CaptureSource => ({
      id: s.id,
      name: s.name,
      kind: s.id.startsWith('screen:') ? 'screen' : 'window',
      thumbnail: s.thumbnail.toDataURL(),
      appIcon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null,
      displayId: s.display_id || null,
    }))
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'screen' ? -1 : 1))
}

function select(rawId: unknown, rawOpts: unknown): void {
  const id = str(rawId, 256)
  if (!/^(screen|window):[\w:.-]+$/.test(id)) throw new TypeError('invalid source id')
  selection = { id, audio: bool(obj(rawOpts).audio), expires: Date.now() + SELECTION_TTL_MS }
}

export function initCapture(): void {
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    const pick = selection
    selection = null // one-shot
    const frame = request.frame
    if (!frame || frame.parent !== null || !isAppUrl(frame.url)) {
      log.warn('display media denied: untrusted frame', frame?.url)
      return callback(null)
    }
    if (!pick || pick.expires < Date.now() || !request.videoRequested) {
      log.warn('display media denied: no fresh user selection')
      return callback(null)
    }
    const audio = pick.audio && request.audioRequested
    log.info('display media granted', pick.id, audio ? 'with system audio' : 'video only')
    callback({ video: { id: pick.id, name: '' }, ...(audio ? { audio: 'loopback' as const } : {}) })
  })

  handle(IPC.screenGetSources, (types) => getSources(types))
  handle(IPC.screenSelect, (id, opts) => select(id, opts))
}
