// YouTube's own embedded player, kept in step with the room. One iframe per card: changing songs loads the next one
// into it (moving or remounting an iframe would reload it). Driven by postMessage only (logic.ts).
import { musicPosition, type MusicState } from '@alga/shared'
import { useEffect, useRef, useState } from 'react'
import { LISTENING, command, decide, embedUrl, parsePlayer, refusedHere, unplayable, type PlayerFunc } from './logic'
import { report, serverTime, useMusic } from './store'
import { t } from './strings'
import s from './music.module.css'

const TICK_MS = 500

export interface PlayerTime { time: number | null; duration: number | null }

export function Player({ music, play, onTime }: { music: MusicState; play: boolean; onTime: (p: PlayerTime) => void }) {
  const now = music.now!
  const ref = useRef<HTMLIFrameElement>(null)
  const volume = useMusic((st) => st.volume)
  const [refused, setRefused] = useState(false)
  // Where the room is when this player is first made: it starts there (later songs load with their own start).
  const [src] = useState(() => embedUrl(now.videoId, musicPosition(music.playback, serverTime(), now.durationS)))
  const news = useRef({ state: -1, time: null as number | null, duration: null as number | null, ready: false })
  const sentFor = useRef({ duration: '', ended: '', unplayable: '' })
  // By track, not video: the same song queued twice must load again.
  const loaded = useRef(now.id)
  const live = useRef({ music, play })
  live.current = { music, play }

  const post = (func: PlayerFunc, args: unknown[] = []) => ref.current?.contentWindow?.postMessage(command(func, args), 'https://www.youtube-nocookie.com')

  // What the player says about itself.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== ref.current?.contentWindow) return
      const n = parsePlayer(e.data)
      const m = live.current.music
      const id = m.now?.id ?? ''
      if (n.state !== undefined || n.time !== undefined) news.current.ready = true
      if (n.state !== undefined) news.current.state = n.state
      if (n.time !== undefined) news.current.time = n.time
      if (n.duration !== undefined) {
        news.current.duration = n.duration
        if (m.now?.durationS == null && sentFor.current.duration !== id) {
          sentFor.current.duration = id
          report('duration', Math.round(n.duration * 10) / 10)
        }
      }
      if (n.state === 0 && sentFor.current.ended !== id) {
        sentFor.current.ended = id
        report('ended')
      }
      if (n.error !== undefined) {
        if (refusedHere(n.error)) setRefused(true)
        else if (unplayable(n.error) && sentFor.current.unplayable !== id) {
          sentFor.current.unplayable = id
          report('unplayable')
        }
      }
      onTime({ time: news.current.time, duration: news.current.duration ?? m.now?.durationS ?? null })
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [onTime])

  // Until the player answers, ask it to report (it ignores commands before that).
  useEffect(() => {
    const id = setInterval(() => {
      if (news.current.ready) return clearInterval(id)
      ref.current?.contentWindow?.postMessage(LISTENING, 'https://www.youtube-nocookie.com')
    }, 250)
    return () => clearInterval(id)
  }, [])

  // A new song in the room: load it into the same player, from where the room is.
  useEffect(() => {
    if (loaded.current === now.id) return
    loaded.current = now.id
    news.current = { ...news.current, state: -1, time: null, duration: null }
    post('loadVideoById', [{ videoId: now.videoId, startSeconds: musicPosition(music.playback, serverTime(), now.durationS) }])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now.id])

  useEffect(() => {
    post('setVolume', [Math.round(volume * 100)])
    post(volume > 0 ? 'unMute' : 'mute')
  }, [volume])

  // Every half second: is this player where the room is?
  useEffect(() => {
    const id = setInterval(() => {
      const { music: m, play: p } = live.current
      if (!m.now || !news.current.ready) return
      const sNow = serverTime()
      const target = musicPosition(m.playback, sNow, m.now.durationS)
      const shouldPlay = p && m.playback.playing && sNow >= m.playback.at
      for (const [func, args] of decide({ shouldPlay, target, time: news.current.time, state: news.current.state })) post(func, args)
      if (news.current.state === 1 || news.current.state === 2) {
        // keep the volume: YouTube resets it on a new video
        post('setVolume', [Math.round(useMusic.getState().volume * 100)])
      }
    }, TICK_MS)
    return () => clearInterval(id)
  }, [])

  return (
    <div className={s.screen}>
      <iframe
        ref={ref}
        className={s.iframe}
        src={src}
        title={t.player}
        allow="autoplay; encrypted-media"
        referrerPolicy="strict-origin-when-cross-origin"
        onLoad={() => {
          ref.current?.contentWindow?.postMessage(LISTENING, 'https://www.youtube-nocookie.com')
          post('setVolume', [Math.round(useMusic.getState().volume * 100)])
        }}
      />
      {refused && <p className={s.refused}>{t.refused}</p>}
    </div>
  )
}
