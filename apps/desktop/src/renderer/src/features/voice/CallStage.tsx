import type { Channel } from '@alga/shared'
import { ArrowLeftRight, BarChart3, HeadphoneOff, Minimize, MicOff, MonitorUp, MoreHorizontal, PictureInPicture2, Scan, ShieldOff, Square, Volume2, WifiOff, X, Signal } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { media, useMedia, type StreamQuality } from '@/media'
import { useData } from '@/store/data'
import { channelTitle, displayName, voiceMembers } from '@/store/selectors'
import { Avatar, Button, contextMenuHandler, Fronds, Icon, IconButton, Popover, SegmentedControl, Spinner, Switch, Tooltip, useEnvelope } from '@/ui'
import { EASE_OUT_QUART } from '@/ui/motion'
import { DecoratedAvatar } from '../billing/Cosmetics'
import { useLook } from '../billing/store'
import { personEntries } from '../shell/people'
import { ControlsDock } from './ControlsDock'
import { featuredWidth, stageLayout, stripTile } from './layout'
import { useLevelGetter, roomLevelNow } from './levels'
import { t } from './strings'
import { joinVoice, leaveVoice, useVoice } from './voice'
import sh from '../shell/shell.module.css'
import s from './stage.module.css'

/** Content box of the stage (re-measured when `key` swaps the element, e.g. grid ⇄ watched stream). */
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

type Conn = { state: string; channelId: string | null; reason: string | null }

/**
 * The call. `channel` = a space voice channel (full main area) or a DM (variant "dm": top of the conversation).
 * Who is in the room comes from the server (voiceStates); levels, mute and streams come from the media engine
 * once we are connected, so tiles react within one frame of the audio.
 */
export function CallStage({ channel, variant = 'channel' }: { channel: Channel; variant?: 'channel' | 'dm' }) {
  const voiceStates = useData((st) => st.voiceStates)
  const people = useMemo(() => voiceMembers({ voiceStates }, channel.id), [voiceStates, channel.id])
  const meId = useData((st) => st.me?.id)
  const conn = useMedia(useShallow((st): Conn => ({ state: st.connection.state, channelId: st.connection.channelId, reason: st.connection.reason })))
  const here = conn.channelId === channel.id && conn.state !== 'idle'
  const live = here && (conn.state === 'connecting' || conn.state === 'connected' || conn.state === 'reconnecting')
  const joining = useVoice((st) => st.joining === channel.id)

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
          {people.length > 0 ? <Fronds size={16} breathing={!live} getLevel={live ? roomLevelNow : undefined} className={s.accentIcon} /> : <Icon icon={Volume2} size={18} />}
          {channel.name}
        </h1>
        {channel.topic && (
          <>
            <span className={sh.headerSep} />
            <span className={sh.headerTopic}>{channel.topic}</span>
          </>
        )}
      </header>
    ) : null

  return (
    <section className={`${s.stage} ${variant === 'dm' ? s.dm : ''} ${live ? '' : s.idle}`} aria-label={channel.name}>
      {header}
      <Room stale={conn.state !== 'connected' && here} breathe={live && conn.state === 'connected'}>
        {live ? (
          <LiveRoom channel={channel} people={people.map((p) => p.userId)} meId={meId} />
        ) : (
          <PreJoin channel={channel} people={people.map((p) => p.userId)} streaming={people.filter((p) => p.streaming).map((p) => p.userId)} joining={joining} variant={variant} />
        )}
        {here && conn.state === 'reconnecting' && (
          <div className={s.reconnect} role="status" aria-live="polite">
            <Fronds size={14} breathing />
            <strong>{t.state.reconnecting}</strong>
            <span>{t.reconnectingShort}</span>
          </div>
        )}
        {here && conn.state === 'disconnected' && (
          <Notice title={t.state.disconnected} action={<Button variant="primary" onClick={() => void joinVoice(channel.id)}>{t.rejoin}</Button>} dismiss={leaveVoice}>
            {conn.reason ?? t.disconnectedBody}
          </Notice>
        )}
      </Room>
      {live && <ControlsDock channel={channel} />}
    </section>
  )
}

/**
 * The room breathes with the conversation: a low teal light from below follows the loudest voice (one envelope on
 * the area; the light is a composited layer whose opacity is --speak, never over video, no blur).
 */
function Room({ stale, breathe, children }: { stale: boolean; breathe: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEnvelope(ref, breathe ? roomLevelNow : null)
  return (
    <div ref={ref} className={`${s.area} ${stale ? s.stale : ''}`}>
      {children}
    </div>
  )
}

function Notice({ title, children, action, dismiss }: { title: string; children: ReactNode; action?: ReactNode; dismiss?: () => void }) {
  return (
    <div className={s.notice} role="status" aria-live="polite">
      <div className={s.noticeCard}>
        <span className={s.noticeTitle}>
          <Fronds size={16} breathing />
          {title}
        </span>
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

function PreJoin({ channel, people, streaming, joining, variant }: { channel: Channel; people: string[]; streaming: string[]; joining: boolean; variant: 'channel' | 'dm' }) {
  // Leaving by keyboard (Desconectar) removes the focused dock: the keyboard lands here instead of on <body>.
  const joinRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (document.activeElement === document.body) joinRef.current?.focus()
  }, [])
  const join = (
    <Button ref={joinRef} variant="primary" size="lg" icon={Volume2} loading={joining} onClick={() => void joinVoice(channel.id)}>
      {variant === 'dm' ? t.call.join : t.join(channel.name)}
    </Button>
  )
  if (people.length === 0)
    return (
      <div className={s.empty}>
        <span className={s.emptyGlyph}>
          <Fronds size={20} />
        </span>
        <h2 className={s.emptyTitle}>{t.stage.emptyTitle}</h2>
        <p className={s.emptyBody}>{t.stage.emptyBody}</p>
        <div className={s.emptyActions}>{join}</div>
      </div>
    )
  return (
    <div className={s.preview}>
      <ul className={s.previewPeople} aria-label={t.stage.preview(people.length)}>
        {people.map((id) => (
          <PreviewPerson key={id} userId={id} spaceId={channel.spaceId} live={streaming.includes(id)} />
        ))}
      </ul>
      <p className={s.count}>{t.stage.preview(people.length)}</p>
      {join}
    </div>
  )
}

function PreviewPerson({ userId, spaceId, live }: { userId: string; spaceId: string | null; live: boolean }) {
  const u = useData((st) => st.users[userId])
  // The space nickname, as in chat and on the tiles.
  const name = useData((st) => displayName(st, userId, spaceId))
  if (!u) return null
  return (
    <li className={s.previewPerson}>
      <Avatar user={u} size={56} decorative />
      <span>{name}</span>
      {live && <span className={s.liveBadge}>{t.stage.live}</span>}
    </li>
  )
}

// ── In the room ───────────────────────────────────────────────

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
  // downloaded) for a stream until you click Assistir on the person's tile.
  const watched = useMedia(useShallow((st) => Object.keys(st.viewers).filter((id) => id !== meId && st.participants[id]?.streaming)))
  const featured = focus && watched.includes(focus) ? focus : (watched[0] ?? null)

  const ref = useRef<HTMLDivElement>(null)
  const box = useBox(ref, !!featured)

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
            <PersonTile key={id} userId={id} channel={channel} size={40} />
          ))}
        </div>
      </div>
    )
  }

  const layout = stageLayout(ids.length, box.w, box.h)
  const width = layout.width
  const avatar = width >= 420 ? 96 : width >= 300 ? 80 : 56
  // One flex container (tiles never remount, layout animations keep working) with a line break after each
  // balanced row: 7 people read as 3+2+2, never 3+3+1 with a stray tile.
  const tiles: ReactNode[] = []
  const tile = (id: string) => (
    <Appear key={id} width={width}>
      <PersonTile userId={id} channel={channel} size={avatar} />
    </Appear>
  )
  let next = 0
  layout.rows.forEach((count, r) => {
    tiles.push(...ids.slice(next, next + count).map(tile))
    next += count
    if (r < layout.rows.length - 1) tiles.push(<span key={'br:' + r} className={s.rowBreak} aria-hidden />)
  })
  // Someone who arrived since the last measure (re-measured before paint) is never left out meanwhile.
  tiles.push(...ids.slice(next).map(tile))
  return (
    <div ref={ref} className={s.grid}>
      <AnimatePresence initial={false}>{tiles}</AnimatePresence>
    </div>
  )
}

/** Join/leave with purpose: tiles grow in from 96% and the grid reflows (morph), leave is shorter than enter. */
function Appear({ width, children }: { width: number; children: ReactNode }) {
  return (
    <motion.div
      layout
      style={{ width }}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1, transition: { duration: 0.18, ease: EASE_OUT_QUART } }}
      exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.13 } }}
      transition={{ layout: { duration: 0.22, ease: [0.645, 0.045, 0.355, 1] } }}
    >
      {children}
    </motion.div>
  )
}

function PersonTile({ userId, channel, size }: { userId: string; channel: Channel; size: 40 | 56 | 80 | 96 }) {
  const ref = useRef<HTMLDivElement>(null)
  useEnvelope(ref, useLevelGetter(userId, channel.id))
  const user = useData((st) => st.users[userId])
  const name = useData((st) => displayName(st, userId, channel.spaceId))
  const vs = useData((st) => st.voiceStates[userId])
  const isMe = useData((st) => st.me?.id === userId)
  const remote = useMedia(useShallow((st) => {
    const p = st.participants[userId]
    return p ? { micMuted: p.micMuted, quality: p.quality, streaming: p.streaming } : null
  }))
  const self = useMedia(useShallow((st) => ({ muted: st.self.muted, deafened: st.self.deafened, mic: st.self.micAvailable, live: st.screen.active })))
  const watching = useMedia((st) => !!st.viewers[userId])
  const connecting = useMedia((st) => st.connection.state === 'connecting')
  const [menu, setMenu] = useState<HTMLElement | null>(null)
  const others = useMedia((st) => Object.keys(st.participants).length)
  const title = useData((st) => channelTitle(st, channel))
  const look = useLook(userId)
  if (!user) return null

  const serverDeaf = !!vs?.serverDeaf
  const serverMute = !!vs?.serverMute
  const deaf = isMe ? self.deafened : !!vs?.selfDeaf
  const muted = isMe ? self.muted || self.deafened || !self.mic : remote ? remote.micMuted : !!vs?.selfMute
  // Live is a property of the person, not a second tile: one tile per person, always.
  const live = isMe ? self.live : !!remote?.streaming
  const quality = remote?.quality
  const small = size === 40
  const flag =
    serverDeaf ? { icon: ShieldOff, label: t.stage.serverDeafened }
    : serverMute ? { icon: ShieldOff, label: t.stage.serverMuted }
    : deaf ? { icon: HeadphoneOff, label: t.stage.deafened }
    : muted ? { icon: MicOff, label: isMe && !self.mic ? t.stage.noMic : t.stage.muted }
    : null
  const watch = () => media.watch(userId, 'auto')
  const selfLive = isMe && live && !small
  return (
    <div
      ref={ref}
      className={s.tile}
      style={small ? undefined : { width: '100%' }}
      data-user-id={userId}
      onContextMenu={isMe ? undefined : contextMenuHandler(() => personEntries(user, { spaceId: channel.spaceId }), name)}
    >
      <div className={s.tileBody}>
        {/* Cosmetics stay discreet on the stage: the avatar decoration only, never motion (the voice glow leads). */}
        {!(selfLive && size === 56) && (
          <DecoratedAvatar user={user} size={selfLive ? (size === 96 ? 56 : 40) : size} glow decorative decoration={small ? undefined : look.decoration} />
        )}
        {selfLive && <SelfLive compact={size === 56} />}
        {!isMe && live && !watching && !small && (
          <Button variant="primary" size="sm" icon={MonitorUp} onClick={watch}>
            {t.stage.watch}
          </Button>
        )}
        {isMe && connecting && <span className={s.waiting}>{t.joining}</span>}
        {isMe && !connecting && others === 0 && channel.type === 'dm' && !small && <span className={s.waiting}>{t.call.waiting(title)}</span>}
      </div>
      {live && !small && <span className={`${s.liveBadge} ${s.tileLive}`}>{t.stage.live}</span>}
      {/* The strip keeps names too (smaller): a face alone is not enough to know who is who. Live rides in the label. */}
      <span className={s.label}>
        {live && small &&
          (!isMe && !watching ? (
            <Tooltip content={`${t.stage.watch}: ${t.stage.streamOf(name)}`}>
              <button type="button" className={s.liveBadge} aria-label={`${t.stage.watch}: ${t.stage.streamOf(name)}`} onClick={watch}>
                {t.stage.live}
              </button>
            </Tooltip>
          ) : (
            <span className={s.liveBadge}>{t.stage.live}</span>
          ))}
        {flag && (
          <Tooltip content={flag.label}>
            <span className={s.flagDanger} role="img" aria-label={flag.label}>
              <Icon icon={flag.icon} size={12} />
            </span>
          </Tooltip>
        )}
        <span>{isMe ? `${name} (${t.stage.you.toLowerCase()})` : name}</span>
      </span>
      {!small && (
        <span className={s.corner}>
          {(quality === 'poor' || quality === 'lost') && (
            <Tooltip content={t.stage.quality[quality]}>
              <span className={quality === 'lost' ? s.qualityLost : s.qualityPoor} role="img" aria-label={t.stage.quality[quality]}>
                <Icon icon={quality === 'lost' ? WifiOff : Signal} size={12} />
              </span>
            </Tooltip>
          )}
          {!isMe && remote && (
            <IconButton icon={MoreHorizontal} label={t.stage.personVolume(name)} size="sm" className={s.tileMenu} aria-expanded={!!menu} onClick={(e) => setMenu(menu ? null : e.currentTarget)} />
          )}
        </span>
      )}
      <Popover anchor={menu} onClose={() => setMenu(null)} side="bottom" align="end" label={t.stage.personVolume(name)} width={240}>
        <PersonVolume userId={userId} name={name} />
      </Popover>
    </div>
  )
}

const STREAM_NOTICE_MS = 8000

/**
 * Your own stream lives on your tile (one tile per person): the best layer actually sent, the plan's re-cap line
 * for a few seconds, and quiet controls. Red stays on Desconectar.
 */
function SelfLive({ compact }: { compact?: boolean }) {
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
    <div className={s.selfLive}>
      <span className={s.selfLiveTitle}>{t.stage.youAreLive}</span>
      {!compact && (
        <span className={`${s.selfLiveBody} tnum`}>
          {sc.layer ? `${sc.layer.width}×${sc.layer.height} · ${Math.round(sc.layer.fps)} fps · ${t.stats.kbps(sc.layer.bitrateKbps)}` : sc.preset}
          {sc.hw !== null && ` · ${sc.hw ? t.stage.hw : t.stage.sw}`}
        </span>
      )}
      {left > 0 && notice && (
        <span className={s.selfLiveNotice} role="status">
          {notice.text}
        </span>
      )}
      <div className={s.selfLiveActions}>
        {!compact && (
          <Button size="sm" icon={ArrowLeftRight} onClick={() => useVoice.setState({ picker: true })}>
            {t.picker.switch}
          </Button>
        )}
        <Button size="sm" icon={Square} onClick={() => void media.stopScreenShare()}>
          {t.dock.stopShare}
        </Button>
      </div>
    </div>
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
