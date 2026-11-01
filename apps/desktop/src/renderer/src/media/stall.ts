// Viewer-side stall guard, pure (unit-tested): decides when to ask the SFU for a lower simulcast layer.
// Why and the numbers: docs/benchmarks/media-network.md §3 and the engine's tickStalls().

/** Simulcast layer as LiveKit's VideoQuality (LOW 0, MEDIUM 1, HIGH 2). */
export type Layer = 0 | 1 | 2
const LOW: Layer = 0
const MEDIUM: Layer = 1
const HIGH: Layer = 2
/** First hold before trying a layer back up; doubles while stalls keep coming, up to the ceiling. */
export const STALL_HOLD_MS = 8000
export const STALL_HOLD_MAX_MS = 60_000

export interface StallState {
  frames: number
  /** When frames last advanced, and the link counter then. */
  at: number
  link: number
  /** Decoded fps, smoothed: only moving pictures can "stall" (a still desktop sends a frame now and then). */
  fps: number
  cap: Layer
  holdMs: number
  /** No step back up before this. */
  until: number
}

/** One stall-guard tick for a watched stream: the new state and, when it changes, the layer cap to request. */
export function stallStep(prev: StallState | undefined, frames: number, link: number, now: number): { state: StallState; layer?: Layer } {
  if (!prev || frames < prev.frames) return { state: { frames, at: now, link, fps: 0, cap: HIGH, holdMs: STALL_HOLD_MS, until: 0 } }
  const g = { ...prev }
  if (frames > g.frames) {
    const dt = Math.max(1, now - g.at)
    g.fps = g.fps * 0.7 + ((frames - g.frames) * 1000 / dt) * 0.3
    g.frames = frames
    g.at = now
    g.link = link
    if (g.cap === HIGH && now - g.until > STALL_HOLD_MAX_MS) g.holdMs = STALL_HOLD_MS // calm for a minute: forgive
    if (g.cap !== HIGH && now >= g.until) {
      g.cap = g.cap === LOW ? MEDIUM : HIGH
      g.until = now + g.holdMs
      return { state: g, layer: g.cap }
    }
    return { state: g }
  }
  // Frames stopped. A layer stop if it was moving (>= 8 fps), for >= 5 frame times (>= 500 ms), with data still arriving.
  // A layer we just switched to gets 1 s more (the SFU's switch + a keyframe) before going down again.
  const wait = Math.max(500, 5000 / g.fps) + (g.cap === HIGH ? 0 : 1000)
  const stalled = g.fps >= 8 && now - g.at >= wait && link > g.link
  if (!stalled || g.cap === LOW) return { state: g }
  g.cap = g.cap === HIGH ? MEDIUM : LOW
  g.until = now + g.holdMs
  g.holdMs = Math.min(STALL_HOLD_MAX_MS, g.holdMs * 2)
  // Re-arm: the next layer gets its own chance before another step.
  g.at = now
  g.link = link
  return { state: g, layer: g.cap }
}
