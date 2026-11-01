import { useEffect, useLayoutEffect, useState, type RefObject } from 'react'
import { create } from 'zustand'

/*
 * Cosmetics motion engine (growth-plan §3.3). Rules every renderer follows:
 * - One gesture, then rest. A one-shot runs while its root carries `data-run`; the CSS keyframes never define the
 *   last frame (no `to`/100%), so the end of every animation IS the element's own style: the resting frame, which
 *   is also what reduced motion, a skipped run and a list row at rest show. Fill mode `backwards` only.
 * - A gesture starts only with motion allowed (OS setting and html.reduce-motion), the window visible, the element
 *   on screen (replays) and a free slot: at most MAX_PLAYING gestures at once in the whole app; the rest stay at rest.
 * - Voice auras add no rAF: they ride the envelope useEnvelope already writes (`--speak` on the tile), in CSS or in
 *   a MutationObserver callback, and fall back to the default ring when the stage is busy (useAurasOn).
 * - Every JS frame a cosmetic spends is timed (budget): over budget, it stops and shows its resting frame.
 */

export const reducedMotion = () => document.documentElement.classList.contains('reduce-motion') || matchMedia('(prefers-reduced-motion: reduce)').matches

/** Gestures allowed to play at the same time, app-wide (a 50-member list replaying stays within this). */
export const MAX_PLAYING = 8
/** Main-thread budgets per cosmetic per frame (§3.3.4): canvas G2 and voice-driven GV. */
export const BUDGET_MS = { canvas: 0.5, aura: 0.1 } as const

/** Live counters, read by the perf script and the gallery (window.__cosmetics). */
export const stats = { started: 0, skipped: 0, playing: 0, peak: 0, jsMs: 0, jsCalls: 0, overBudget: 0 }

const onScreen = (el: Element) => {
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth
}

/** Takes one of the MAX_PLAYING slots for `ms` if motion is allowed now (canvas effects use it directly). */
export function claim(ms: number, el?: Element, check = false): boolean {
  if (reducedMotion() || document.visibilityState === 'hidden' || stats.playing >= MAX_PLAYING || (check && el && !onScreen(el))) {
    stats.skipped++
    return false
  }
  stats.started++
  stats.peak = Math.max(stats.peak, ++stats.playing)
  setTimeout(() => stats.playing--, ms + 80)
  return true
}

/** Starts one gesture on `el` if allowed. `check` = also require it on screen (replays; an opening is on screen by intent). */
export function run(el: HTMLElement, ms: number, onRun?: (el: HTMLElement) => void, check = true): boolean {
  if (el.dataset.run !== undefined || !claim(ms, el, check)) return false
  el.dataset.run = ''
  onRun?.(el)
  setTimeout(() => delete el.dataset.run, ms + 80)
  return true
}

/** `rest`: never moves · `play`: plays once when it mounts (a profile opening) · `hover`: once per hover of the nearest [data-cosmetic-hover]. */
export type Motion = 'rest' | 'play' | 'hover'

const roots = new Set<{ el: HTMLElement; ms: number; onRun?: (el: HTMLElement) => void }>()
/** Replays every mounted gesture that is on screen, within the global cap (gallery, perf bench). */
export const replayAll = () => [...roots].filter((r) => run(r.el, r.ms, r.onRun, true)).length

export function useOneShot(ref: RefObject<HTMLElement | SVGElement | null>, motion: Motion, ms: number, onRun?: (el: HTMLElement) => void) {
  useLayoutEffect(() => {
    const el = ref.current as HTMLElement | null
    if (!el || !ms) return
    const entry = { el, ms, onRun }
    roots.add(entry)
    if (motion === 'play') run(el, ms, onRun, false)
    const host = motion === 'hover' ? (el.closest('[data-cosmetic-hover]') ?? el) : null
    const enter = () => run(el, ms, onRun, true)
    host?.addEventListener('pointerenter', enter)
    return () => {
      roots.delete(entry)
      host?.removeEventListener('pointerenter', enter)
    }
    // onRun is captured at mount: a new closure per render must not restart the gesture.
  }, [ref, motion, ms])
}

/** Times a JS frame of a cosmetic. Returns the ms it took. */
export function timed(fn: () => void): number {
  const t0 = performance.now()
  fn()
  const dt = performance.now() - t0
  stats.jsMs += dt
  stats.jsCalls++
  return dt
}

// ── Voice auras ──────────────────────────────────────────────

/** Call tiles on the stage (CallStage registers each). Over 9, auras fall back to the default ring. */
let tiles = 0
const frames: number[] = []
let lastFrame = 0
let slowUntil = 0
interface AuraGate {
  crowded: boolean
  /** p95 frame time over 20 ms for 2 s: the machine is struggling, auras rest for 10 s. */
  slow: boolean
  /** You are encoding a stream: your CPU/GPU go to the encoder. Set by the stage. */
  encoding: boolean
}
export const useAuraGate = create<AuraGate>()(() => ({ crowded: false, slow: false, encoding: false }))
export const AURA_MAX_TILES = 9

/** Registers one call tile while mounted (previews and samples do not count). */
export function useTileCount(on: boolean) {
  useEffect(() => {
    if (!on) return
    useAuraGate.setState({ crowded: ++tiles > AURA_MAX_TILES })
    return () => useAuraGate.setState({ crowded: --tiles > AURA_MAX_TILES })
  }, [on])
}

/** While mounted with `on`, you are encoding a stream: auras fall back to the default ring. */
export function useEncodingGate(on: boolean) {
  useEffect(() => {
    if (!on) return
    useAuraGate.setState({ encoding: true })
    return () => useAuraGate.setState({ encoding: false })
  }, [on])
}

/** Whether auras may draw now (§3.3.4 automatic fallback). */
export const useAurasOn = () => useAuraGate((g) => !g.crowded && !g.slow && !g.encoding)

/**
 * One frame-time sample per envelope write (the envelope writes once per frame while someone speaks, so the gaps
 * between writes are frame times; silence writes nothing and needs no watching).
 */
let windowStart = 0
function frameSample(now: number) {
  if (now - lastFrame < 4) return // several tiles in the same frame
  if (lastFrame && now - lastFrame < 250) frames.push(now - lastFrame)
  else windowStart = now // silence in between: start a new 2 s window
  lastFrame = now
  if (now - windowStart < 2000 || frames.length < 30) return
  const p95 = [...frames].sort((a, b) => a - b)[Math.floor(frames.length * 0.95)]!
  frames.length = 0
  windowStart = now
  if (p95 > 20) {
    slowUntil = now + 10_000
    useAuraGate.setState({ slow: true })
    setTimeout(() => performance.now() >= slowUntil && useAuraGate.setState({ slow: false }), 10_050)
  }
}

/**
 * Calls `fn(speak, dtMs)` every time the envelope on the nearest `[data-speak-host]` ancestor changes (one call per
 * frame while the person speaks, none in silence): no rAF of its own. Skipped while the element is off screen.
 * A callback that keeps going over BUDGET_MS.aura stops for good (the CSS layer underneath still shows the voice).
 */
export function useSpeak(ref: RefObject<HTMLElement | null>, fn: ((speak: number, dt: number) => void) | null) {
  useEffect(() => {
    const el = ref.current
    const host = el?.closest<HTMLElement>('[data-speak-host]')
    if (!el || !host || !fn) return
    let visible = true
    const io = new IntersectionObserver((e) => void (visible = e[e.length - 1]!.isIntersecting))
    io.observe(el)
    let last = performance.now()
    let over = 0
    const mo = new MutationObserver(() => {
      const now = performance.now()
      const dt = Math.min(100, now - last)
      last = now
      frameSample(now)
      if (!visible) return
      const speak = parseFloat(host.style.getPropertyValue('--speak')) || 0
      if (timed(() => fn(speak, dt)) > BUDGET_MS.aura) over++
      else over = Math.max(0, over - 1)
      if (over > 30) {
        stats.overBudget++
        mo.disconnect()
      }
    })
    mo.observe(host, { attributes: true, attributeFilter: ['style'] })
    return () => {
      mo.disconnect()
      io.disconnect()
    }
  }, [ref, fn])
}

/** Re-renders when the reduced-motion preference changes (canvas effects draw their last frame instead). */
export function useReducedMotion(): boolean {
  const [r, setR] = useState(reducedMotion)
  useEffect(() => {
    const mq = matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setR(reducedMotion())
    const mo = new MutationObserver(update)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    mq.addEventListener('change', update)
    return () => {
      mo.disconnect()
      mq.removeEventListener('change', update)
    }
  }, [])
  return r
}

declare global {
  interface Window {
    __cosmetics?: { stats: typeof stats; replayAll: typeof replayAll; gate: typeof useAuraGate }
  }
}
if (typeof window !== 'undefined') window.__cosmetics = { stats, replayAll, gate: useAuraGate }
