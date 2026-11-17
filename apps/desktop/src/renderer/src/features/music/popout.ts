// The floating player outside Alga (main/music-window.ts). This window keeps the call: it sends the floating one what
// to show (a snapshot on every change) and does what it asks (play, pause, skip, volume, what its player saw).
import type { MusicState } from '@alga/shared'
import { useEffect } from 'react'
import { useCinema } from '../cinema/store'
import { control, report, setVolume, setView, useMusic } from './store'

export interface PopSnapshot {
  state: MusicState | null
  /** Server clock − Date.now() (same machine, same clock). */
  offset: number
  volume: number
  /** Whether this person hears it now (they stopped listening, or sit in the cinema). */
  play: boolean
}

export type PopCommand =
  | { kind: 'control'; action: 'play' | 'pause' | 'skip' | 'previous' | 'seek' | 'stop'; position?: number }
  | { kind: 'volume'; volume: number }
  | { kind: 'report'; trackId: string; report: 'ended' | 'unplayable' | 'duration'; durationS?: number }
  | { kind: 'popIn' }
  /** The floating page loaded: send it the snapshot now. */
  | { kind: 'hello' }

const ACTIONS = new Set(['play', 'pause', 'skip', 'previous', 'seek', 'stop'])
const REPORTS = new Set(['ended', 'unplayable', 'duration'])
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** A command from the floating window, as plain checked data (main already checked who sent it). */
export function parseCommand(raw: string): PopCommand | null {
  let c: unknown
  try {
    c = JSON.parse(raw)
  } catch {
    return null
  }
  if (!c || typeof c !== 'object') return null
  const o = c as Record<string, unknown>
  if (o.kind === 'control' && typeof o.action === 'string' && ACTIONS.has(o.action)) {
    return { kind: 'control', action: o.action as never, ...(finite(o.position) && o.position >= 0 && { position: o.position }) }
  }
  if (o.kind === 'volume' && finite(o.volume)) return { kind: 'volume', volume: Math.min(1, Math.max(0, o.volume)) }
  if (o.kind === 'report' && typeof o.trackId === 'string' && typeof o.report === 'string' && REPORTS.has(o.report)) {
    return { kind: 'report', trackId: o.trackId, report: o.report as never, ...(finite(o.durationS) && o.durationS > 0 && { durationS: o.durationS }) }
  }
  if (o.kind === 'popIn' || o.kind === 'hello') return { kind: o.kind }
  return null
}

function act(c: PopCommand): void {
  if (c.kind === 'control') control(c.action, c.position)
  else if (c.kind === 'volume') setVolume(c.volume)
  // Only about the song playing now: a late word about the previous one does nothing.
  else if (c.kind === 'report') useMusic.getState().state?.now?.id === c.trackId && report(c.report, c.durationS)
  else if (c.kind === 'popIn') setView('card')
}

/** Mounted while the player lives in the floating window: opens it, feeds it, closes it on the way out. */
export function usePopout(): void {
  useEffect(() => {
    const bridge = window.alga?.musicPop
    if (!bridge) {
      setView('mini')
      return
    }
    let last = ''
    const push = () => {
      const m = useMusic.getState()
      const seated = (() => {
        const c = useCinema.getState()
        return !!c.session && c.mine.seated
      })()
      const snap: PopSnapshot = { state: m.state, offset: m.offset, volume: m.volume, play: m.listening && !seated }
      const json = JSON.stringify(snap)
      if (json === last) return
      last = json
      bridge.push(json)
    }
    void bridge.open().catch(() => setView('mini'))
    const offs = [
      useMusic.subscribe(push),
      useCinema.subscribe(push),
      bridge.onCommand((raw) => {
        const c = parseCommand(raw)
        if (c?.kind === 'hello') {
          last = ''
          push()
        } else if (c) act(c)
      }),
      // Its × or Windows closed it: the player comes home.
      bridge.onClosed(() => useMusic.getState().view === 'popout' && setView('card')),
    ]
    return () => {
      for (const off of offs) off()
      void bridge.close().catch(() => undefined)
    }
  }, [])
}
