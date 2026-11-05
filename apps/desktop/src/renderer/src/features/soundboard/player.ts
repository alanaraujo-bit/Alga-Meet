// Soundboard playback: decoded sounds cached by id, played on their own AudioContext routed to the call's output
// device (same pattern as media/sounds.ts cues). Space sounds come from the API; `alga:` ids from bundled assets.
import { authHeaders } from '@/lib/api'

type SinkContext = AudioContext & { setSinkId?: (id: string) => Promise<void> }

let ctx: SinkContext | null = null
let sink: string | null = null
const cache = new Map<string, AudioBuffer>()
const loading = new Map<string, Promise<AudioBuffer | null>>()
/** Bundled pack: id → asset URL (filled by the Alga pack). */
const bundled: Record<string, string> = {}
const live = new Set<AudioBufferSourceNode>()

function context(): SinkContext {
  if (!ctx) {
    ctx = new AudioContext({ latencyHint: 'interactive' }) as SinkContext
    setSoundboardOutput(sink)
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

export function setSoundboardOutput(deviceId: string | null): void {
  sink = deviceId
  if (ctx?.setSinkId) void ctx.setSinkId(deviceId && deviceId !== 'default' ? deviceId : '').catch(() => undefined)
}

export function registerBundled(urls: Record<string, string>): void {
  Object.assign(bundled, urls)
}

const urlOf = (spaceId: string, id: string) =>
  bundled[id] ?? `${window.alga.config.apiUrl}/api/v1/spaces/${spaceId}/sounds/${id}/audio`

/** Fetches and decodes once; null when the sound cannot be loaded (deleted, offline, undecodable). */
export function load(spaceId: string, id: string): Promise<AudioBuffer | null> {
  const hit = cache.get(id)
  if (hit) return Promise.resolve(hit)
  let p = loading.get(id)
  if (!p) {
    p = (async () => {
      try {
        const res = await fetch(urlOf(spaceId, id), { headers: bundled[id] ? {} : authHeaders() })
        if (!res.ok) return null
        const buf = await context().decodeAudioData(await res.arrayBuffer())
        cache.set(id, buf)
        return buf
      } catch {
        return null
      } finally {
        loading.delete(id)
      }
    })()
    loading.set(id, p)
  }
  return p
}

export async function preload(spaceId: string, ids: string[]): Promise<void> {
  await Promise.all(ids.map((id) => load(spaceId, id)))
}

export const isCached = (id: string): boolean => cache.has(id)

/** Plays a cached sound now; false when it is not cached. `volume` 0..1. */
export function playLocal(id: string, volume: number): boolean {
  const buf = cache.get(id)
  if (!buf) return false
  const ac = context()
  const src = ac.createBufferSource()
  const gain = ac.createGain()
  src.buffer = buf
  gain.gain.value = Math.min(1, Math.max(0, volume))
  src.connect(gain).connect(ac.destination)
  live.add(src)
  src.onended = () => { live.delete(src); src.disconnect(); gain.disconnect() }
  src.start()
  return true
}

/** Stops everything playing (leaving the call, muting the soundboard). */
export function stopAll(): void {
  for (const s of live) try { s.stop() } catch { /* already stopped */ }
  live.clear()
}

/** Plays raw samples (the editor's preview) on the same output; returns a stop function. */
export function playSamples(samples: Float32Array, rate: number, volume = 1, onEnd?: () => void, offsetSec = 0): () => void {
  const ac = context()
  const buf = ac.createBuffer(1, samples.length, rate)
  buf.copyToChannel(samples as Float32Array<ArrayBuffer>, 0)
  const src = ac.createBufferSource()
  const gain = ac.createGain()
  src.buffer = buf
  gain.gain.value = volume
  src.connect(gain).connect(ac.destination)
  src.onended = () => { src.disconnect(); gain.disconnect(); onEnd?.() }
  src.start(0, offsetSec)
  return () => { src.onended = null; try { src.stop() } catch { /* ended */ } src.disconnect(); gain.disconnect() }
}

/** Current time of the player's clock (for the editor's playhead). */
export const audioNow = (): number => context().currentTime

/** Forget a deleted sound. */
export const evict = (id: string): void => { cache.delete(id) }
