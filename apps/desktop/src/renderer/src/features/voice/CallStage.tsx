import { Permission, type Channel } from '@alga/shared'
import { ArrowLeftRight, BarChart3, Headphones, Mic, Minimize, MonitorUp, MoreHorizontal, PictureInPicture2, Scan, ShieldOff, Square, Volume2, WifiOff, X, Signal, type Glyph } from '@/ui/icons'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { media, useMedia, type StreamQuality } from '@/media'
import { useData } from '@/store/data'
import { can, channelTitle, displayName, spacePermissions, voiceMembers } from '@/store/selectors'
import { Avatar, Button, contextMenuHandler, Icon, IconButton, Popover, SegmentedControl, Spinner, Switch, Tooltip, useEnvelope, usePersonHue, type AvatarSize } from '@/ui'
import type { IconSize } from '@/ui/Icon'
import { EASE_IN_OUT_CUBIC, EASE_OUT_QUART } from '@/ui/motion'
import { AuraGlyph, DecoratedAvatar, ReactionLayer, StreamFrame } from '../billing/Cosmetics'
import { useEncodingGate, useTileCount } from '../billing/engine'
import { useLook } from '../billing/store'
import { personEntries } from '../shell/people'
import { ActivityLine } from '../activity/Activity'
import { ControlsDock, LobbyDock } from './ControlsDock'
import { E2eeChip, MismatchBanner } from './E2ee'
import { cardWidth, featuredWidth, seatWidth, stripTile, voiceLayout, type SeatSize } from './layout'
import { useLevelGetter } from './levels'
import { t } from './strings'
import { SoundLayer } from '../soundboard/SoundLayer'
import { joinVoice, leaveVoice, useVoice } from './voice'
import sh from '../shell/shell.module.css'
import s from './stage.module.css'

/** Content box of the stage (re-measured when `key` swaps the element, e.g. voice stage ⇄ watched stream). */
function useBox(ref: RefObject<HTMLElement | null>, key: unknown): { w: number; h: number } {
  const [box, setBox] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setBox((cur) => (cur.w === el.clientWidth && cur.h === el.clientHeight ? cur : { w: el.clientWidth, h: el.clientHeight }))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref, key])
  return box
}

type Conn = { state: string; channelId: string | null; reason: string | null; failed: boolean }

/**
 * The call. `channel` = a space voice channel (full main area) or a DM (variant "dm": top of the conversation).
 * Who is in the room comes from the server (voiceStates); levels, mute and streams come from the media engine
 * once we are connected, so faces react within one frame of the audio.
 */
export function CallStage({ channel, variant = 'channel' }: { channel: Channel; variant?: 'channel' | 'dm' }) {
  const voiceStates = useData((st) => st.voiceStates)
  const people = useMemo(() => voiceMembers({ voiceStates }, channel.id), [voiceStates, channel.id])
  const meId = useData((st) => st.me?.id)
  const conn = useMedia(useShallow((st): Conn => ({ state: st.connection.state, channelId: st.connection.channelId, reason: st.connection.reason, failed: st.e2ee.state === 'failed' })))
  const here = conn.channelId === channel.id && conn.state !== 'idle'
  const live = here && (conn.state === 'connecting' || conn.state === 'connected' || conn.state === 'reconnecting')
  const joining = useVoice((st) => st.joining === channel.id)
  // Full = the others fill it (the server does not count you), and moderators who can move people still get in.
  const mover = useData((st) => !!channel.spaceId && can(spacePermissions(st, channel.spaceId), Permission.MOVE_MEMBERS))
  const full = !!channel.userLimit && !mover && people.filter((p) => p.userId !== meId).length >= channel.userLimit

  // Watching is opt-in and costs bandwidth: leaving the call's stage keeps one stream for the mini-player
  // (the one in focus, else the first) and stops the rest.
  useEffect(() => {
    useVoice.setState({ stage: channel.id })
    return () => {
      if (useVoice.getState().stage === channel.id) useVoice.setState({ stage: null })
      if (useMedia.getState().connection.channelId !== channel.id) return
      const watched = Object.keys(useMedia.getState().viewers)
      const focus = useVoice.getState().focus
      const keep = focus && watched.includes(focus) ? focus : watched[0]
      for (const id of watched) if (id !== keep) media.unwatch(id)
    }
  }, [channel.id])

  const header =
    variant === 'channel' ? (
      <header className={sh.header}>
        <h1 className={sh.headerTitle}>
          <Icon icon={Volume2} size={18} />
          {channel.name}
        </h1>
        {channel.topic && (
          <>
            <span className={sh.headerSep} />
            <span className={sh.headerTopic}>{channel.topic}</span>
          </>
        )}
        <div className={`${sh.headerActions} ${s.headerEnd}`}>
          <E2eeChip channelId={channel.id} showOff />
        </div>
      </header>
    ) : null

  return (
    <section className={`${s.stage} ${variant === 'dm' ? s.dm : ''} ${live ? '' : s.idle}`} aria-label={channel.name}>
      {header}
      <MismatchBanner channel={channel} />
      <Room stale={conn.state !== 'connected' && here} live={live}>
        {variant === 'dm' && (
          <div className={s.dmLock}>
            <E2eeChip channelId={channel.id} />
          </div>
        )}
        {live ? (
          <LiveRoom channel={channel} people={people.map((p) => p.userId)} meId={meId} />
        ) : (
          <PreJoin channel={channel} people={people.map((p) => p.userId)} streaming={people.filter((p) => p.streaming).map((p) => p.userId)} variant={variant} />
        )}
        {here && conn.state === 'reconnecting' && (
          <div className={s.reconnect} role="status" aria-live="polite">
            <Spinner size={12} />
            <strong>{t.state.reconnecting}</strong>
            <span>{t.reconnectingShort}</span>
          </div>
        )}
        {here && conn.state === 'disconnected' && (
          <Notice title={conn.failed ? t.e2ee.failedTitle : t.state.disconnected} action={<Button variant="primary" onClick={() => void joinVoice(channel.id)}>{t.rejoin}</Button>} dismiss={leaveVoice}>
            {conn.reason ?? (conn.failed ? t.e2ee.failedBody : t.disconnectedBody)}
          </Notice>
        )}
      </Room>
      {live ? (
        <ControlsDock channel={channel} />
      ) : (
        <LobbyDock channel={channel} joining={joining} full={full} />
      )}
    </section>
  )
}

/**
 * The stage area. The room's light (RoomLight) is the one ambient thing: a wide, very soft pool in the speaker's own
 * hue that drifts to whoever is talking. Speaking itself lives on the faces (the 2 px ring).
 */
function Room({ stale, live, children }: { stale: boolean; live: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  return (
    <div ref={ref} className={`${s.area} ${stale ? s.stale : ''}`}>
      {live && <RoomLight host={ref} />}
      {children}
    </div>
  )
}

/** Moves only when a new voice has held for 300 ms (no flicker between two people), fades out after 900 ms of quiet. */
const LIGHT_HOLD_MS = 300
const LIGHT_QUIET_MS = 900
const LIGHT_MIN = 0.18

/**
 * Reads the faces' own envelopes (--speak, written by useEnvelope on each seat) 10× a second: no React work, no
 * per-frame writes. The light is a transformed, blurred-by-gradient layer: compositor only.
 */
function RoomLight({ host }: { host: RefObject<HTMLElement | null> }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    const root = host.current
    if (!el || !root) return
    let current: string | null = null
    let cand: string | null = null
    let since = performance.now()
    let placed = false
    let last = ''
    const id = setInterval(() => {
      let best: HTMLElement | null = null
      let bestV = LIGHT_MIN
      for (const seat of root.querySelectorAll<HTMLElement>('[data-seat]')) {
        const v = Number(seat.style.getPropertyValue('--speak') || 0)
        if (v > bestV) {
          bestV = v
          best = seat
        }
      }
      const key = best?.dataset.userId ?? null
      const now = performance.now()
      if (key !== cand) {
        cand = key
        since = now
      }
      if (key !== current && now - since >= (key ? LIGHT_HOLD_MS : LIGHT_QUIET_MS)) current = key
      const seat = current ? root.querySelector<HTMLElement>(`[data-seat][data-user-id="${current}"]`) : null
      const face = seat?.querySelector<HTMLElement>('[data-face]')
      if (!seat || !face) {
        if (el.style.opacity !== '0') el.style.opacity = '0'
        return
      }
      const a = root.getBoundingClientRect()
      const b = face.getBoundingClientRect()
      const transform = `translate(${Math.round(b.left + b.width / 2 - a.left)}px, ${Math.round(b.top + b.height * 0.7 - a.top)}px) translate(-50%, -50%)`
      if (transform !== last) {
        // The first time, the light appears in place instead of sweeping in from the corner.
        if (!placed) el.style.transition = 'none'
        el.style.transform = last = transform
        if (!placed) {
          void el.offsetWidth
          el.style.transition = ''
          placed = true
        }
      }
      el.style.setProperty('--lh', seat.dataset.hue ?? '279')
      if (el.style.opacity !== '1') el.style.opacity = '1'
    }, 100)
    return () => clearInterval(id)
  }, [host])
  return <div ref={ref} className={s.light} aria-hidden />
}

function Notice({ title, children, action, dismiss }: { title: string; children: ReactNode; action?: ReactNode; dismiss?: () => void }) {
  return (
    <div className={s.notice} role="status" aria-live="polite">
      <div className={s.noticeCard}>
        <span className={s.noticeTitle}>{title}</span>
        <p className={s.noticeBody}>{children}</p>
        {(action || dismiss) && (
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            {dismiss && (
              <Button variant="ghost" onClick={dismiss}>
                {t.leave}
              </Button>
            )}
            {action}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Not in the room ───────────────────────────────────────────

/**
 * A look into the room before anyone sees you (Entrar lives in the LobbyDock below): who is there, who is live,
 * what each one is doing. From the channel list a second click on the same room enters it.
 */
function PreJoin({ channel, people, streaming, variant }: { channel: Channel; people: string[]; streaming: string[]; variant: 'channel' | 'dm' }) {
  const hint = variant === 'channel' && <p className={s.enterHint}>{t.stage.enterHint}</p>
  if (people.length === 0)
    return (
      <div className={s.empty}>
        <span className={s.emptySeat} aria-hidden />
        <h2 className={s.emptyTitle}>{t.stage.emptyTitle}</h2>
        <p className={s.emptyBody}>{t.stage.emptyBody}</p>
        {hint}
      </div>
    )
  return (
    <div className={s.preview}>
      <ul className={s.previewPeople} aria-label={t.stage.preview(people.length)}>
        {people.map((id, i) => (
          <PreviewPerson key={id} userId={id} spaceId={channel.spaceId} live={streaming.includes(id)} order={i} />
        ))}
      </ul>
      <p className={s.count}>{t.stage.preview(people.length)}</p>
      {hint}
    </div>
  )
}

function PreviewPerson({ userId, spaceId, live, order }: { userId: string; spaceId: string | null; live: boolean; order: number }) {
  const u = useData((st) => st.users[userId])
  // The space nickname, as in chat and on the stage.
  const name = useData((st) => displayName(st, userId, spaceId))
  const hue = usePersonHue(u)
  if (!u) return null
  return (
    <li className={s.previewPerson} style={{ ['--h' as string]: hue, ['--i' as string]: Math.min(order, 8) }}>
      <span className={s.previewFace}>
        <Avatar user={u} size={64} decorative />
      </span>
      <span className={s.previewName}>{name}</span>
      {live ? (
        <span className={s.liveBadge}>{t.stage.live}</span>
      ) : (
        <span className={s.previewActivity}>
          <ActivityLine userId={userId} />
        </span>
      )}
    </li>
  )
}

// ── In the room ───────────────────────────────────────────────

/** Entrance choreography window: seats rendered this soon after joining come in one after the other. */
const ENTRANCE_MS = 450

function LiveRoom({ channel, people, meId }: { channel: Channel; people: string[]; meId: string | undefined }) {
  const remote = useMedia(useShallow((st) => Object.keys(st.participants)))
  const focus = useVoice((st) => st.focus)
  // Server order (join time) first; people the SFU already shows but the gateway hasn't told us about yet go last.
  const ids = useMemo(() => {
    const list = [...people]
    if (meId && !list.includes(meId)) list.unshift(meId)
    for (const id of remote) if (!list.includes(id)) list.push(id)
    return list
  }, [people, remote, meId])
  // Watching takes the stage: the stream you picked (focus), else the first you watch. Nothing is shown (or
  // downloaded) for a stream until you click Assistir on the person's card.
  const watched = useMedia(useShallow((st) => Object.keys(st.viewers).filter((id) => id !== meId && st.participants[id]?.streaming)))
  const featured = focus && watched.includes(focus) ? focus : (watched[0] ?? null)
  // Who is live: they get a 16:9 card (the only boxes on a voice stage); everyone else is a bare face.
  const live = useMedia(useShallow((st) => ids.filter((id) => (id === meId ? st.screen.active : !!st.participants[id]?.streaming))))
  const connecting = useMedia((st) => st.connection.state === 'connecting')
  const others = useMedia((st) => Object.keys(st.participants).length)
  const title = useData((st) => channelTitle(st, channel))
  const born = useRef(performance.now())

  const ref = useRef<HTMLDivElement>(null)
  const box = useBox(ref, !!featured)

  // Nothing is placed before the stage is measured: a first layout at width 0 would make every face slide in from
  // a stacked column (layout animation) instead of arriving where it sits.
  if (!featured && box.w === 0) return <div ref={ref} className={s.voice} />

  if (featured) {
    const strip = stripTile(box.h)
    return (
      <div ref={ref} className={s.watching} style={{ ['--strip-w' as string]: `${strip.w}px`, ['--strip-h' as string]: `${strip.h}px` }}>
        <div className={s.featured} style={{ width: featuredWidth(box.w, box.h) || undefined }}>
          <StreamView key={featured} userId={featured} channel={channel} />
        </div>
        <div className={s.strip} role="group" aria-label={t.stage.people}>
          {watched
            .filter((id) => id !== featured)
            .map((id) => (
              <StreamView key={`s:${id}`} userId={id} channel={channel} small />
            ))}
          {ids.map((id) => (
            <Seat key={id} userId={id} channel={channel} size={40} />
          ))}
        </div>
      </div>
    )
  }

  // A room of one says so, calmly: the stage is waiting for someone, not broken.
  const caption = connecting ? t.joining : others === 0 && channel.type === 'dm' ? t.call.waiting(title) : ids.length === 1 ? t.stage.alone : null
  const cards = ids.filter((id) => live.includes(id))
  const seats = ids.filter((id) => !live.includes(id))
  const CARD_GAP = 40
  const cw = cardWidth(cards.length, box.w, box.h * (seats.length ? 1 : 1.6))
  const ch = cards.length ? Math.round((cw * 9) / 16) : 0
  const lay = voiceLayout(seats.length, box.w, Math.max(0, box.h - (ch ? ch + CARD_GAP : 0) - (caption ? 36 : 0)))
  const total = ch + (ch && seats.length ? CARD_GAP : 0) + (seats.length ? lay.height : 0) + (caption ? 36 : 0)
  // Optical center at 45 % of the stage: a hair above the middle, where a face wants to sit.
  const top = Math.max(0, Math.round(box.h * 0.45 - total / 2))

  // One flex container per group (seats never remount, layout animations keep working) with a line break after each
  // balanced row: 7 people read as 4 + 3, never 5 + 2.
  const nodes: ReactNode[] = []
  let at = 0
  let order = cards.length
  lay.rows.forEach((count, r) => {
    for (const id of seats.slice(at, at + count))
      nodes.push(
        <Appear key={id} order={order++} born={born}>
          <Seat userId={id} channel={channel} size={lay.avatar} />
        </Appear>,
      )
    at += count
    if (r < lay.rows.length - 1) nodes.push(<span key={'br:' + r} className={s.rowBreak} aria-hidden />)
  })
  // Someone who arrived since the last measure (re-measured before paint) is never left out meanwhile.
  for (const id of seats.slice(at))
    nodes.push(
      <Appear key={id} order={order++} born={born}>
        <Seat userId={id} channel={channel} size={lay.avatar} />
      </Appear>,
    )

  return (
    <div ref={ref} className={s.voice}>
      <div className={s.voiceBlock} style={{ paddingTop: top }}>
        {cards.length > 0 && (
          <div className={s.cards} style={{ marginBottom: seats.length ? CARD_GAP : 0 }}>
            <AnimatePresence>
              {cards.map((id, i) => (
                <Appear key={id} order={i} born={born}>
                  <LiveCard userId={id} channel={channel} width={cw} isMe={id === meId} />
                </Appear>
              ))}
            </AnimatePresence>
          </div>
        )}
        {seats.length > 0 && (
          <div className={s.seats} style={{ ['--seat-gap' as string]: `${lay.gap}px` }}>
            <AnimatePresence>{nodes}</AnimatePresence>
          </div>
        )}
        {caption && <p className={s.caption}>{caption}</p>}
      </div>
    </div>
  )
}

/**
 * Join with purpose (critique r3, sexy move 2): right after you join, the faces come in one after the other
 * (scale .94 → 1 + fade, 220 ms out-quart, 30 ms apart) while the engine's join cue plays and the dock rises; later
 * arrivals come in alone, and leaving is shorter than arriving. Reduced motion: MotionConfig makes it instant.
 */
function Appear({ order, born, children }: { order: number; born: RefObject<number>; children: ReactNode }) {
  const [delay] = useState(() => (performance.now() - born.current < ENTRANCE_MS ? 0.04 + order * 0.03 : 0))
  return (
    <motion.div
      layout
      className={s.appear}
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1, transition: { duration: 0.22, ease: EASE_OUT_QUART, delay } }}
      exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.13 } }}
      transition={{ layout: { duration: 0.22, ease: EASE_IN_OUT_CUBIC } }}
    >
      {children}
    </motion.div>
  )
}

/** Everything a face needs to say about one person in this call. */
function usePerson(userId: string, channel: Channel) {
  const user = useData((st) => st.users[userId])
  const name = useData((st) => displayName(st, userId, channel.spaceId))
  const vs = useData((st) => st.voiceStates[userId])
  const isMe = useData((st) => st.me?.id === userId)
  const remote = useMedia(
    useShallow((st) => {
      const p = st.participants[userId]
      return p ? { micMuted: p.micMuted, quality: p.quality, streaming: p.streaming } : null
    }),
  )
  const self = useMedia(useShallow((st) => ({ muted: st.self.muted, deafened: st.self.deafened, mic: st.self.micAvailable, live: st.screen.active })))
  const serverDeaf = !!vs?.serverDeaf
  const serverMute = !!vs?.serverMute
  const deaf = isMe ? self.deafened : !!vs?.selfDeaf
  const muted = isMe ? self.muted || self.deafened || !self.mic : remote ? remote.micMuted : !!vs?.selfMute
  const flag: { icon: Glyph; slash: boolean; label: string } | null =
    serverDeaf ? { icon: ShieldOff, slash: false, label: t.stage.serverDeafened }
    : serverMute ? { icon: ShieldOff, slash: false, label: t.stage.serverMuted }
    : deaf ? { icon: Headphones, slash: true, label: t.stage.deafened }
    : muted ? { icon: Mic, slash: true, label: isMe && !self.mic ? t.stage.noMic : t.stage.muted }
    : null
  return { user, name, isMe, remote, flag, quality: remote?.quality, selfLive: isMe && self.live }
}

/**
 * One person on a voice stage: the face straight on the stage (no box), the person's own hue as a 6 % floor under
 * it and in the name chip, the 2 px speaking ring on the face only, mute/deafen as a 22 px disc at 45° on the face.
 * `size` 40 = the strip under a watched stream.
 */
function Seat({ userId, channel, size }: { userId: string; channel: Channel; size: SeatSize | 40 }) {
  const ref = useRef<HTMLDivElement>(null)
  useEnvelope(ref, useLevelGetter(userId, channel.id))
  const p = usePerson(userId, channel)
  const hue = usePersonHue(p.user)
  const [menu, setMenu] = useState<HTMLElement | null>(null)
  const look = useLook(userId)
  // Auras fall back to the default ring with more than 9 faces, or while your own encode needs the CPU/GPU.
  useTileCount(true)
  useEncodingGate(p.selfLive)
  if (!p.user) return null
  const small = size === 40
  const label = p.isMe ? `${p.name} (${t.stage.you.toLowerCase()})` : p.name
  return (
    <div
      ref={ref}
      className={`${s.seat} ${small ? s.seatSmall : ''}`}
      style={{ width: small ? 72 : seatWidth(size), ['--h' as string]: hue }}
      data-user-id={userId}
      data-seat={small ? undefined : ''}
      data-hue={hue}
      data-speak-host
      onContextMenu={p.isMe ? undefined : contextMenuHandler(() => personEntries(p.user!, { spaceId: channel.spaceId }), p.name)}
    >
      <div className={s.face} data-face style={{ width: size, height: size }}>
        {/* Cosmetics stay discreet on the stage: a still decoration, and the voice aura in place of the default ring. */}
        <DecoratedAvatar user={p.user} size={size as AvatarSize} glow decorative decoration={small ? undefined : look.decoration} aura={look.aura} />
        {p.flag && (
          <Tooltip content={p.flag.label}>
            <span className={`${s.flag} ${small ? s.flagSmall : ''}`} role="img" aria-label={p.flag.label}>
              <FlagGlyph icon={p.flag.icon} slash={p.flag.slash} size={small ? 12 : 14} />
            </span>
          </Tooltip>
        )}
        {!small && !p.isMe && p.remote && (
          <IconButton icon={MoreHorizontal} label={t.stage.personVolume(p.name)} size="sm" className={s.more} aria-expanded={!!menu} onClick={(e) => setMenu(menu ? null : e.currentTarget)} />
        )}
        <ReactionLayer userId={userId} />
        <SoundLayer userId={userId} />
      </div>
      <span className={s.name}>
        {!small && (p.quality === 'poor' || p.quality === 'lost') && (
          <Tooltip content={t.stage.quality[p.quality]}>
            <span className={p.quality === 'lost' ? s.qualityLost : s.qualityPoor} role="img" aria-label={t.stage.quality[p.quality]}>
              <Icon icon={p.quality === 'lost' ? WifiOff : Signal} size={12} />
            </span>
          </Tooltip>
        )}
        {!small && <AuraGlyph id={look.aura} />}
        <span className={s.nameText}>{small ? p.name : label}</span>
      </span>
      <Popover anchor={menu} onClose={() => setMenu(null)} side="bottom" align="end" label={t.stage.personVolume(p.name)} width={240}>
        <PersonVolume userId={userId} name={p.name} />
      </Popover>
    </div>
  )
}

/** Mute / deafen glyph whose slash draws itself in 120 ms (stroke-dashoffset), in step with the engine's mute cue. */
function FlagGlyph({ icon, slash, size }: { icon: Glyph; slash: boolean; size: IconSize }) {
  if (!slash) return <Icon icon={icon} size={size} />
  return (
    <span className={s.glyph} style={{ width: size, height: size }}>
      <Icon icon={icon} size={size} />
      <svg viewBox="0 0 256 256" width={size} height={size} aria-hidden>
        <line className={s.cut} x1="48" y1="48" x2="208" y2="224" pathLength={1} />
        <line className={s.slash} x1="48" y1="48" x2="208" y2="224" pathLength={1} />
      </svg>
    </span>
  )
}

const STREAM_NOTICE_MS = 8000

/**
 * Someone live (and nobody watching it big yet): the only box on a voice stage, 16:9. Theirs: their face on a wash
 * of their hue, AO VIVO and Assistir (nothing is downloaded before that). Yours: a muted preview of what actually
 * leaves your computer, with quiet controls. Red stays on Desconectar.
 */
function LiveCard({ userId, channel, width, isMe }: { userId: string; channel: Channel; width: number; isMe: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useEnvelope(ref, useLevelGetter(userId, channel.id))
  const p = usePerson(userId, channel)
  const hue = usePersonHue(p.user)
  const look = useLook(userId)
  useTileCount(true)
  useEncodingGate(isMe)
  if (!p.user) return null
  return (
    <div
      ref={ref}
      className={s.card}
      style={{ width, ['--h' as string]: hue }}
      data-user-id={userId}
      data-seat=""
      data-hue={hue}
      data-speak-host
      onContextMenu={isMe ? undefined : contextMenuHandler(() => personEntries(p.user!, { spaceId: channel.spaceId }), p.name)}
    >
      {isMe ? (
        <SelfLive />
      ) : (
        <div className={s.cardBody}>
          <span className={s.face} data-face style={{ width: 64, height: 64 }}>
            <DecoratedAvatar user={p.user} size={64} glow decorative aura={look.aura} />
          </span>
          <Button variant="primary" size="sm" icon={MonitorUp} onClick={() => media.watch(userId, 'auto')}>
            {t.stage.watch}
          </Button>
        </div>
      )}
      <span className={`${s.liveBadge} ${s.cardLive}`}>{t.stage.live}</span>
      <span className={s.cardLabel}>
        {p.flag && (
          <span className={s.cardFlag} role="img" aria-label={p.flag.label}>
            <FlagGlyph icon={p.flag.icon} slash={p.flag.slash} size={12} />
          </span>
        )}
        <span>{isMe ? `${p.name} (${t.stage.you.toLowerCase()})` : p.name}</span>
      </span>
      <ReactionLayer userId={userId} />
    </div>
  )
}

/** Your own stream on your card: the outgoing picture, the best layer actually sent, and the plan's re-cap line. */
function SelfLive() {
  const video = useRef<HTMLVideoElement>(null)
  useEffect(() => (video.current ? media.attachOwnScreen(video.current) : undefined), [])
  // The best layer actually being sent (the SFU pauses top layers nobody watches big).
  const sc = useMedia(
    useShallow((st) => ({
      preset: st.screen.preset,
      hw: st.screen.hardwareEncoder,
      layer: st.screen.stats?.layers.filter((l) => l.fps > 0).sort((a, b) => b.width - a.width)[0] ?? null,
    })),
  )
  const notice = useVoice((st) => st.streamNotice)
  const [, tick] = useState(0)
  const left = notice ? STREAM_NOTICE_MS - (Date.now() - notice.at) : 0
  useEffect(() => {
    if (left <= 0) return
    const id = setTimeout(() => tick((n) => n + 1), left)
    return () => clearTimeout(id)
  }, [left > 0, notice])
  return (
    <>
      <video ref={video} className={s.cardVideo} autoPlay playsInline muted />
      <div className={s.selfLive}>
        <span className={s.selfLiveText}>
          <span className={s.selfLiveTitle}>{t.stage.youAreLive}</span>
          <span className={`${s.selfLiveBody} tnum`}>
            {sc.layer ? `${sc.layer.width}×${sc.layer.height} · ${Math.round(sc.layer.fps)} fps · ${t.stats.kbps(sc.layer.bitrateKbps)}` : sc.preset}
            {sc.hw !== null && ` · ${sc.hw ? t.stage.hw : t.stage.sw}`}
          </span>
          {left > 0 && notice && (
            <span className={s.selfLiveNotice} role="status">
              {notice.text}
            </span>
          )}
        </span>
        <span className={s.selfLiveActions}>
          <Button size="sm" icon={ArrowLeftRight} onClick={() => useVoice.setState({ picker: true })}>
            {t.picker.switch}
          </Button>
          <Button size="sm" icon={Square} onClick={() => void media.stopScreenShare()}>
            {t.dock.stopShare}
          </Button>
        </span>
      </div>
    </>
  )
}

function PersonVolume({ userId, name }: { userId: string; name: string }) {
  const p = useMedia(useShallow((st) => ({ volume: st.participants[userId]?.volume ?? 1, muted: st.participants[userId]?.locallyMuted ?? false })))
  return (
    <div style={{ display: 'grid', gap: 10, padding: 12 }}>
      <label style={{ display: 'grid', gap: 6, font: 'var(--type-meta)', color: 'var(--text-tertiary)' }}>
        <span style={{ display: 'flex', justifyContent: 'space-between' }}>
          {t.stage.personVolume(name)}
          <span className="tnum" style={{ color: 'var(--text-primary)' }}>{Math.round(p.volume * 100)}%</span>
        </span>
        <input type="range" min={0} max={200} step={5} value={Math.round(p.volume * 100)} onChange={(e) => media.setVolume(userId, Number(e.target.value) / 100)} style={{ accentColor: 'var(--accent-fill)' }} />
      </label>
      <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', font: 'var(--type-ui)', color: 'var(--text-secondary)' }}>
        {t.stage.muteFor}
        <Switch checked={p.muted} onChange={(v) => media.setLocalMute(userId, v)} label={t.stage.muteFor} />
      </label>
    </div>
  )
}

// ── Streams ───────────────────────────────────────────────────

function StreamView({ userId, channel, small }: { userId: string; channel: Channel; small?: boolean }) {
  const name = useData((st) => displayName(st, userId, channel.spaceId))
  const box = useRef<HTMLDivElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [full, setFull] = useState(false)
  const v = useMedia(useShallow((st) => ({ quality: st.viewers[userId]?.quality ?? 'auto', volume: st.viewers[userId]?.volume ?? 1, audio: st.participants[userId]?.streamHasAudio ?? false })))
  const stats = useVoice((st) => st.stats)
  const frame = useLook(userId).frame

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

  useEffect(() => {
    const onFs = () => setFull(document.fullscreenElement === box.current)
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  const toggleFull = () => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void box.current?.requestFullscreen().catch(() => undefined)
  }
  const pip = () => {
    const el = video.current
    if (!el) return
    if (document.pictureInPictureElement === el) void document.exitPictureInPicture()
    else void el.requestPictureInPicture().catch(() => undefined)
  }
  const stop = () => {
    if (useVoice.getState().focus === userId) useVoice.setState({ focus: null })
    media.unwatch(userId)
  }
  const show = () => useVoice.setState({ focus: userId })

  return (
    <div
      ref={box}
      className={s.stream}
      onDoubleClick={small ? undefined : toggleFull}
      onClick={small ? show : undefined}
      onKeyDown={small ? (e) => (e.key === 'Enter' || e.key === ' ') && show() : undefined}
      aria-label={small ? `${t.stage.show}: ${t.stage.streamOf(name)}` : t.stage.streamOf(name)}
      role={small ? 'button' : 'group'}
      tabIndex={small ? 0 : undefined}
    >
      <video ref={video} autoPlay playsInline muted disablePictureInPicture={false} />
      {/* The streamer's frame: a sibling of the video, around its content, gone in full screen and PiP. */}
      {frame && !small && <StreamFrame id={frame} video={video} />}
      {!playing && (
        <div className={s.loading}>
          <span>
            <Spinner size={16} />
            {!small && t.stage.loadingStream}
          </span>
        </div>
      )}
      {!small && stats && <StreamStats userId={userId} />}
      {!small && (
        <div className={s.streamBar} onDoubleClick={(e) => e.stopPropagation()}>
          {v.audio && (
            <label className={s.volume} aria-label={t.stage.volume}>
              <Icon icon={Volume2} size={14} />
              <input type="range" min={0} max={200} step={5} value={Math.round(v.volume * 100)} onChange={(e) => media.setStreamVolume(userId, Number(e.target.value) / 100)} aria-label={t.stage.volume} />
            </label>
          )}
          <SegmentedControl<StreamQuality>
            label={t.stage.qualityLabel}
            value={v.quality}
            onChange={(q) => void media.setStreamQuality(userId, q)}
            items={[
              { value: 'auto', label: t.stage.qualityAuto },
              { value: 'source', label: t.stage.qualitySource },
            ]}
          />
          <span className={s.barSep} />
          <IconButton icon={BarChart3} label={t.stage.stats} shortcut={t.stage.statsShortcut} size="sm" aria-pressed={stats} onClick={() => useVoice.setState({ stats: !stats })} />
          {'pictureInPictureEnabled' in document && document.pictureInPictureEnabled && <IconButton icon={PictureInPicture2} label={t.stage.pip} size="sm" onClick={pip} />}
          <IconButton icon={full ? Minimize : Scan} label={full ? t.stage.exitFullscreen : t.stage.fullscreen} size="sm" onClick={toggleFull} />
          <IconButton icon={X} label={t.stage.stopWatching} size="sm" onClick={stop} />
        </div>
      )}
      {!small && (
        <span className={s.label}>
          <span className={s.liveBadge}>{t.stage.live}</span>
          <span>{name}</span>
        </span>
      )}
    </div>
  )
}

function StreamStats({ userId }: { userId: string }) {
  const st = useMedia((m) => m.viewers[userId]?.stats ?? null)
  if (!st) return null
  return (
    <dl className={s.stats} aria-label={t.stats.title}>
      <dt>{t.stats.resolution}</dt>
      <dd>
        {st.width}×{st.height}
      </dd>
      <dt>{t.stats.fps}</dt>
      <dd>{Math.round(st.fps)}</dd>
      <dt>{t.stats.bitrate}</dt>
      <dd>{t.stats.kbps(st.bitrateKbps)}</dd>
      <dt>{t.stats.codec}</dt>
      <dd>{st.codec?.replace(/^video\//, '') ?? '—'}</dd>
      <dt>{t.stats.decoder}</dt>
      <dd>
        {st.decoderImplementation ?? '—'} {st.powerEfficientDecoder === null ? '' : st.powerEfficientDecoder ? `(${t.stage.hw})` : `(${t.stage.sw})`}
      </dd>
      <dt>{t.stats.loss}</dt>
      <dd>{t.stats.pct(st.packetLossPct)}</dd>
      <dt>{t.stats.freezes}</dt>
      <dd>{st.freezeCount}</dd>
    </dl>
  )
}
