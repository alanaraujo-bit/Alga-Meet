import { Maximize2, X } from '@/ui/icons'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { media, useMedia } from '@/media'
import { useData } from '@/store/data'
import { displayName } from '@/store/selectors'
import { IconButton, Spinner } from '@/ui'
import { EASE_IN, EASE_OUT_QUART } from '@/ui/motion'
import { nearestCorner, type Corner } from './layout'
import { t } from './strings'
import { openCall, useVoice } from './voice'
import s from './mini.module.css'

const W = 320
const H = 180
const MARGIN = 16
// Bottom corners sit above the chat composer, top ones below the title bar and the view header, left ones past
// the rail and the channel list (--rail-w + --sidebar-w): it never covers navigation.
const BOTTOM_CLEAR = 88
const TOP_CLEAR = 40 + 48 + MARGIN
const LEFT_CLEAR = 64 + 248 + MARGIN

/**
 * The stream you were watching, kept on screen while you are anywhere but the call's stage: small, draggable,
 * snaps to the nearest corner, back to the call or close. Nothing new is downloaded: it is the same subscription.
 */
export function MiniPlayer() {
  const callId = useMedia((st) => (st.connection.state === 'connected' || st.connection.state === 'reconnecting' ? st.connection.channelId : null))
  const onStage = useVoice((st) => st.stage !== null && st.stage === callId)
  const focus = useVoice((st) => st.focus)
  const userId = useMedia((st) => {
    const watched = Object.keys(st.viewers).filter((id) => st.participants[id]?.streaming)
    return focus && watched.includes(focus) ? focus : (watched[0] ?? null)
  })
  return <AnimatePresence>{callId && userId && !onStage && <Mini key={userId} userId={userId} channelId={callId} />}</AnimatePresence>
}

function cornerPos(c: Corner, vw: number, vh: number) {
  return { x: c.endsWith('r') ? vw - W - MARGIN : Math.min(LEFT_CLEAR, vw - W - MARGIN), y: c.startsWith('b') ? vh - H - BOTTOM_CLEAR : TOP_CLEAR }
}

function useViewport() {
  const [v, setV] = useState({ w: window.innerWidth, h: window.innerHeight })
  useEffect(() => {
    const on = () => setV({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return v
}

function Mini({ userId, channelId }: { userId: string; channelId: string }) {
  const video = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null)
  const corner = useVoice((st) => st.miniCorner)
  const vp = useViewport()
  const name = useData((st) => displayName(st, userId, st.channels[channelId]?.spaceId))

  useEffect(() => {
    const el = video.current
    if (!el) return
    const detach = media.attachScreen(userId, el)
    const on = () => setPlaying(true)
    const off = () => setPlaying(false)
    el.addEventListener('playing', on)
    el.addEventListener('emptied', off)
    return () => {
      el.removeEventListener('playing', on)
      el.removeEventListener('emptied', off)
      detach()
    }
  }, [userId])

  const back = () => openCall(channelId)
  const close = () => media.unwatch(userId)

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return
    const start = cornerPos(corner, vp.w, vp.h)
    const dx = e.clientX - start.x
    const dy = e.clientY - start.y
    let last = start
    let moved = false
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => {
      last = { x: Math.max(0, Math.min(vp.w - W, ev.clientX - dx)), y: Math.max(0, Math.min(vp.h - H, ev.clientY - dy)) }
      if (!moved && Math.hypot(last.x - start.x, last.y - start.y) < 4) return
      moved = true
      setDrag(last)
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      if (moved) useVoice.setState({ miniCorner: nearestCorner(last.x, last.y, W, H, vp.w, vp.h) })
      setDrag(null)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }

  const pos = drag ?? cornerPos(corner, vp.w, vp.h)
  return (
    <motion.div
      className={`${s.mini} ${drag ? s.dragging : ''}`}
      role="region"
      aria-label={t.mini.label(name)}
      onPointerDown={onPointerDown}
      onDoubleClick={back}
      initial={{ opacity: 0, scale: 0.96, x: pos.x, y: pos.y }}
      // Follows the pointer 1:1 while dragging; snapping to a corner is the only animated move.
      animate={{ opacity: 1, scale: 1, x: pos.x, y: pos.y, transition: drag ? { duration: 0 } : { duration: 0.22, ease: EASE_OUT_QUART } }}
      exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.13, ease: EASE_IN } }}
    >
      <video ref={video} autoPlay playsInline muted />
      {!playing && (
        <span className={s.loading}>
          <Spinner size={16} />
        </span>
      )}
      <div className={s.bar}>
        <IconButton icon={Maximize2} label={t.mini.back} size="sm" onClick={back} />
        <IconButton icon={X} label={t.mini.close} size="sm" onClick={close} />
      </div>
      <span className={s.label}>
        <span className={s.live}>{t.stage.live}</span>
        <span className={s.name}>{name}</span>
      </span>
    </motion.div>
  )
}
