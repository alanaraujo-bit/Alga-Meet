// What the ticket needs after the session is gone (the swarm closes with it): the poster and the thumbnail sprite as
// blob: URLs, and which emoji each 10 s of film got (the server's summary only counts them). Kept per film of the
// session (a switch to the next episode starts over: the summary's peak is the last episode's, R37).
import type { CinemaReaction, CinemaSessionView } from '@alga/shared'
import { useEffect } from 'react'
import { create } from 'zustand'
import { onDispatch } from '@/store/session'
import { extraPiece } from '../store'
import { HEAT_BUCKET_S } from './reactions'

export interface Art { key: string | null; poster: string | null; thumbs: string | null; emojis: Record<number, Partial<Record<CinemaReaction, number>>> }
export const useArt = create<Art>(() => ({ key: null, poster: null, thumbs: null, emojis: {} }))
const RETRY_MS = 3_000

/** While seated: fetch the poster and the sprite once each, and tally the reactions. */
export function useKeepArt(session: CinemaSessionView): void {
  const key = `${session.sessionId}:${session.film.durationS}`
  const sessionId = session.sessionId
  useEffect(() => {
    const cur = useArt.getState()
    if (cur.key !== key) {
      for (const u of [cur.poster, cur.thumbs]) if (u) URL.revokeObjectURL(u)
      useArt.setState({ key, poster: null, thumbs: null, emojis: {} })
    }
    let dead = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = async () => {
      for (const track of ['poster', 'thumbs'] as const) {
        if (useArt.getState()[track]) continue
        const bytes = await extraPiece(track).catch(() => null)
        if (dead || useArt.getState().key !== key) return
        if (bytes) useArt.setState({ [track]: URL.createObjectURL(new Blob([bytes], { type: 'image/webp' })) })
      }
      const st = useArt.getState()
      if (!st.poster || !st.thumbs) timer = setTimeout(load, RETRY_MS)
    }
    timer = setTimeout(load, 0)
    const off = onDispatch((d) => {
      if (d.t !== 'CINEMA_REACTION' || d.d.sessionId !== sessionId || useArt.getState().key !== key) return
      const i = Math.floor(d.d.position / HEAT_BUCKET_S)
      useArt.setState((s) => ({ emojis: { ...s.emojis, [i]: { ...s.emojis[i], [d.d.emoji]: (s.emojis[i]?.[d.d.emoji] ?? 0) + 1 } } }))
    })
    return () => {
      dead = true
      clearTimeout(timer)
      off()
    }
  }, [key, sessionId])
}
