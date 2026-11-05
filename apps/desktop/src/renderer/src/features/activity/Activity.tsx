import type { Activity, ActivityKind } from '@alga/shared'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { AppWindow, Code, FilmStrip, GameController, MusicNotes, PaintBrush, type Glyph } from '@/ui/icons'
import { Icon, Tooltip } from '@/ui'
import { formatElapsed, PHRASE, sentence, spokenElapsed, steamArt } from './logic'
import { loadTint, tintOf, useActivity, useNow } from './store'
import s from './activity.module.css'

export const KIND_GLYPH: Record<ActivityKind, Glyph> = {
  game: GameController,
  code: Code,
  creative: PaintBrush,
  music: MusicNotes,
  video: FilmStrip,
  app: AppWindow,
}

const EASE_OUT = [0.165, 0.84, 0.44, 1] as const

/** The icon's own hue, readable on dark (null until decoded or when the icon has no color). */
function useTint(icon: string | undefined): string | null {
  const [tint, setTint] = useState(() => tintOf(icon) ?? null)
  useEffect(() => {
    if (!icon) return setTint(null)
    let live = true
    void loadTint(icon).then((t) => live && setTint(t))
    return () => {
      live = false
    }
  }, [icon])
  return tint
}

/**
 * The app's icon (a soft tile from 32 px up), or the kind's glyph when there is none. A Steam game shows its real
 * cover art in the tile (exe icons of games are often tiny and dated), falling back to the icon if it fails.
 */
export function ActivityIcon({ activity, size }: { activity: Activity; size: number }) {
  const [broken, setBroken] = useState(false)
  const [coverBroken, setCoverBroken] = useState(false)
  const tile = size >= 32
  const cover = tile && activity.steamAppId && !coverBroken ? steamArt(activity.steamAppId, 'cover') : null
  return (
    <span className={`${s.icon} ${tile ? s.tile : ''} ${cover ? s.covered : ''}`} style={{ width: size, height: size }} aria-hidden>
      {cover ? (
        <img className={s.cover} src={cover} alt="" draggable={false} onError={() => setCoverBroken(true)} />
      ) : activity.icon && !broken ? (
        <img src={activity.icon} alt="" draggable={false} onError={() => setBroken(true)} />
      ) : (
        <Icon icon={KIND_GLYPH[activity.kind]} size={size >= 40 ? 24 : size >= 18 ? 14 : 12} />
      )}
    </span>
  )
}

/** Stopwatch since `startedAt`, ticking with the shared clock. */
export function Elapsed({ startedAt, kind, className }: { startedAt: number; kind: ActivityKind; className?: string }) {
  const ms = useNow() - startedAt
  return (
    <span className={`${s.elapsed} ${className ?? ''}`} role="timer" aria-label={spokenElapsed(ms)}>
      <span className={s.pulse} aria-hidden />
      <Icon icon={KIND_GLYPH[kind]} size={12} />
      <time>{formatElapsed(ms)}</time>
    </span>
  )
}

/**
 * "Jogando agora" in a profile: icon, name, live timer, washed in the icon's color — and, for a Steam game, its
 * store art blurred behind. Crossfades when the activity changes; absent (no space taken) when there is none.
 */
export function ActivityCard({ userId, children }: { userId: string; children?: ReactNode }) {
  const a = useActivity(userId)
  return (
    <AnimatePresence initial mode="popLayout">
      {a && (
        <ActivityPanel key={`${a.kind}|${a.name}|${a.startedAt}`} activity={a}>
          {children}
        </ActivityPanel>
      )}
    </AnimatePresence>
  )
}

export function ActivityPanel({ activity: a, children, still, compact }: { activity: Activity; children?: ReactNode; still?: boolean; compact?: boolean }) {
  const tint = useTint(a.icon ?? (a.steamAppId ? steamArt(a.steamAppId) : undefined))
  const [art, setArt] = useState(false)
  const style = (tint ? { '--tint': tint } : {}) as CSSProperties
  return (
    <motion.section
      className={`${s.card} ${compact ? s.compact : ''}`}
      style={style}
      data-art={art || undefined}
      aria-label={sentence(a.kind, a.name)}
      initial={still ? false : { opacity: 0, y: 6, filter: 'blur(2px)' }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      exit={{ opacity: 0, y: -4, transition: { duration: 0.16 } }}
      transition={{ duration: 0.36, ease: EASE_OUT, delay: 0.06 }}
    >
      <div className={s.backdrop} aria-hidden>
        {a.steamAppId && <img className={s.art} src={steamArt(a.steamAppId)} alt="" draggable={false} onLoad={() => setArt(true)} onError={() => setArt(false)} />}
        <span className={s.glow} />
      </div>
      {!compact && <div className={s.eyebrow}>{PHRASE[a.kind].verb}</div>}
      <div className={s.row}>
        <motion.span
          className={s.iconMotion}
          initial={still ? false : { scale: 0.86, opacity: 0, rotate: -4 }}
          animate={{ scale: 1, opacity: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 420, damping: 24, delay: 0.12 }}
        >
          <ActivityIcon activity={a} size={compact ? 44 : 52} />
        </motion.span>
        <div className={s.text}>
          <div className={s.name} title={a.name}>
            {a.name}
          </div>
          <Elapsed startedAt={a.startedAt} kind={a.kind} />
        </div>
      </div>
      {children}
    </motion.section>
  )
}

/** One line for lists ("Jogando VALORANT" with its icon); `fallback` when there is no activity. */
export function ActivityLine({ userId, fallback = null }: { userId: string; fallback?: ReactNode }) {
  const a = useActivity(userId)
  if (!a) return <>{fallback}</>
  const p = PHRASE[a.kind]
  return (
    <span className={s.line} title={sentence(a.kind, a.name)}>
      <ActivityIcon activity={a} size={14} />
      <span className={s.lineText}>
        {p.verb} {p.prep && `${p.prep} `}
        <strong>{a.name}</strong>
      </span>
    </span>
  )
}

/** The icon alone at the end of a row (voice room participants), named by its tooltip. */
export function ActivityBadge({ userId }: { userId: string }) {
  const a = useActivity(userId)
  if (!a) return null
  const label = sentence(a.kind, a.name)
  return (
    <Tooltip content={label}>
      <span className={s.badge} role="img" aria-label={label}>
        <ActivityIcon activity={a} size={16} />
      </span>
    </Tooltip>
  )
}
