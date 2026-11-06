// The cinema's notices (IP on the first sit, headphones, E2EE failed, ffmpeg blocked, "Seu PC não decodifica HEVC",
// "Cinema desligado neste servidor"): house cards with the Eco in the matching state (error / listening), never alert().
import { useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Icon } from '@/ui'
import { Eco } from '@/ui/eco/Eco'
import { X } from '@/ui/icons'
import * as act from '../actions'
import { useCinema } from '../store'
import { t } from '../strings'
import s from './notices.module.css'

/** Information the person can act on (headphones, the direct connection) listens; anything that failed is an error. */
const INFO = new Set([t.ipNotice, t.audio.echoNotice])

export function CinemaNotices({ room = false }: { room?: boolean }) {
  const { error, notices, unsupported, hevc } = useCinema(useShallow((st) => ({
    error: st.error, notices: st.notices, unsupported: st.mine.unsupported, hevc: st.session?.film.videoCodec === 'hevc',
  })))
  const [hidden, setHidden] = useState<string | null>(null)
  const playback = unsupported && unsupported !== hidden ? (hevc && unsupported === t.unsupported.video_codec ? t.noHevc : unsupported) : null
  const items: { text: string; error: boolean; close: () => void }[] = [
    ...(error ? [{ text: error, error: true, close: act.dismissError }] : []),
    ...(playback ? [{ text: playback, error: true, close: () => setHidden(unsupported) }] : []),
    ...notices.map((n) => ({ text: n, error: !INFO.has(n), close: () => act.dismissNotice(n) })),
  ]
  if (!items.length) return null
  return (
    <div className={`${s.notices} ${room ? s.inRoom : ''}`} role="status" aria-live="polite">
      {items.map((n) => (
        <div key={n.text} className={`${s.notice} ${n.error ? s.error : ''}`}>
          <span className={s.eco} aria-hidden><Eco state={n.error ? 'error' : 'listening'} framing="avatar" size={28} /></span>
          <span className={s.text}>{n.text}</span>
          <button type="button" className={s.close} aria-label={t.close} onClick={n.close}><Icon icon={X} size={14} /></button>
        </div>
      ))}
    </div>
  )
}
