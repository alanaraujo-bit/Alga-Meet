import { constants, setPriority } from 'node:os'
import { app, desktopCapturer, session } from 'electron'
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
    thumbnailSize: { width: 640, height: 360 }, // picker shows a large preview; 320px upscaled looked soft
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

/**
 * A CPU-bound game keeps every core busy at normal priority. Chromium's capture loop (browser process), WebRTC
 * (renderer) and the encoder (GPU process) then wait for the scheduler; the capture loop also halves its rate when a
 * frame takes long (max_cpu_consumption_percentage=50), so a 720p60 share left at 5–36 fps. Above normal they preempt
 * the game for the ~1 core they use: 49–56 fps, game fps unchanged (docs/benchmarks/game-capture.md).
 * shortcut: never lowered back when the share stops (main gets no stop signal, and our idle processes cost nothing);
 * add a bridge call that restores NORMAL if a share-free session ever needs it.
 */
function boostForCapture(): void {
  for (const m of app.getAppMetrics()) {
    try {
      setPriority(m.pid, constants.priority.PRIORITY_ABOVE_NORMAL)
    } catch (e) {
      log.warn('capture priority not raised', m.type, String(e))
    }
  }
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
    boostForCapture()
    callback({ video: { id: pick.id, name: '' }, ...(audio ? { audio: 'loopback' as const } : {}) })
  })

  handle(IPC.screenGetSources, (types) => getSources(types))
  handle(IPC.screenSelect, (id, opts) => select(id, opts))
}
