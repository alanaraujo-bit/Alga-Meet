import { useCallback } from 'react'
import { useMedia } from '@/media'
import { useData } from '@/store/data'
import { loudness } from './layout'

/**
 * Live voice level of one person in MY call (0 when muted, not connected, or not in my room).
 * Read straight from the media store inside rAF: no React re-render per frame.
 */
export function levelNow(userId: string): number {
  const m = useMedia.getState()
  if (m.connection.state !== 'connected') return 0
  if (userId === m.self.identity || userId === useData.getState().me?.id) {
    return m.self.speaking && !m.self.muted && !m.self.deafened ? m.self.level : 0
  }
  const p = m.participants[userId]
  return p && !p.micMuted ? loudness(p.level) : 0
}

/** The loudest voice in my call: drives the fronds on the rail and in the voice panel. */
export function roomLevelNow(): number {
  const m = useMedia.getState()
  if (m.connection.state !== 'connected') return 0
  let max = levelNow(m.self.identity ?? useData.getState().me?.id ?? '')
  for (const p of Object.values(m.participants)) if (!p.micMuted && loudness(p.level) > max) max = loudness(p.level)
  return max
}

/** Stable getter for useEnvelope / useSpeakingGlow; null when the person is not in my current room. */
export function useLevelGetter(userId: string, channelId: string | null): (() => number) | null {
  const here = useMedia((s) => !!channelId && s.connection.channelId === channelId && s.connection.state !== 'idle')
  const get = useCallback(() => levelNow(userId), [userId])
  return here ? get : null
}
