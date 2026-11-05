// Pure soundboard rules (spec §5.1, §5.3, §5.6); the store and the UI only wire them.
import { SOUND_COOLDOWN_MS } from '@alga/shared'

/** A sound that is still downloading this long after its SOUNDBOARD_PLAY is dropped: late is worse than missing. */
export const LATE_MS = 1500

export const shouldHear = (s: { deafened: boolean; serverDeaf: boolean; muted: boolean }): boolean =>
  !s.deafened && !s.serverDeaf && !s.muted

export const cooldownAfterPlay = (now: number, durationMs: number): number => now + durationMs + SOUND_COOLDOWN_MS

export const lateDrop = (eventAt: number, now: number): boolean => now - eventAt > LATE_MS

export interface TileClock {
  now: number
  cooldownFrom: number
  cooldownUntil: number
  canUse: boolean
  playingMine: { soundId: string; from: number; until: number } | null
}

export type TileKind = 'ready' | 'playing' | 'cooldown' | 'disabled'

/** progress: playing 0→1 along your sound; cooldown 1→0 as it empties. */
export function tileState(c: TileClock, soundId: string): { kind: TileKind; progress: number } {
  if (!c.canUse) return { kind: 'disabled', progress: 0 }
  const p = c.playingMine
  if (p && p.soundId === soundId && c.now < p.until) {
    return { kind: 'playing', progress: Math.min(1, Math.max(0, (c.now - p.from) / (p.until - p.from || 1))) }
  }
  if (c.now < c.cooldownUntil) {
    const span = c.cooldownUntil - c.cooldownFrom || 1
    return { kind: 'cooldown', progress: Math.min(1, Math.max(0, (c.cooldownUntil - c.now) / span)) }
  }
  return { kind: 'ready', progress: 0 }
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

export function filterSounds<T extends { name: string }>(list: T[], query: string): T[] {
  const q = fold(query.trim())
  return q ? list.filter((s) => fold(s.name).includes(q)) : list
}

/** "meu_som-legal.mp3" → "meu som legal" (≤ 32 chars, never empty). */
export function cleanName(fileName: string): string {
  const base = fileName.replace(/\.[^.]*$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  return (base || 'Som').slice(0, 32).trim()
}
