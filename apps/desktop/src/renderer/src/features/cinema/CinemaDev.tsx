// Dev stage of the Sala de Cinema (Task 14): plain but tidy UI over the engine, tokens and layout borrowed from the
// approved mockup (docs/design/cinema/mockups, 05-assistindo-ui). Plan 2 replaces it with the real experience.
import type { Channel, CinemaFilm, CinemaSessionView } from '@alga/shared'
import { useEffect, useRef, useState, type DragEvent, type ReactNode, type RefObject } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useData } from '@/store/data'
import { displayName } from '@/store/selectors'
import { Button, Icon, Modal, Switch, TextField } from '@/ui'
import { BarChart3, FilmStrip, Maximize, Minimize, Pause, Play, RotateCcw, RefreshCw, Volume2, VolumeX, X } from '@/ui/icons'
import * as act from './actions'
import { createAss, destroyAss, setAssOffset } from './ass'
import { rangesOf, type TimeRange } from './mse'
import { attachVideo, detachVideo, serverNow, useCinema } from './store'
import { clock, length, t } from './strings'
import { SubtitleOverlay } from './SubtitleOverlay'
import { useFilmAudio } from './useFilmAudio'
import styles from './cinema.module.css'

const SEEK_S = 10
const SEEK_LONG_S = 60
const VOLUME_STEP = 0.05

function techChip(f: CinemaFilm): string {
  const res = f.height >= 2000 ? '4K' : f.height >= 1000 ? '1080p' : f.height >= 700 ? '720p' : `${f.height}p`
  const codec = { h264: 'H.264', hevc: 'HEVC', av1: 'AV1', vp9: 'VP9' }[f.videoCodec]
  const hdr = f.hdr === 'sdr' ? '' : ` · ${f.hdr === 'dv8' ? 'Dolby Vision' : f.hdr.toUpperCase()}`
  return `Nativo · ${res}${hdr} · ${codec}`
}
const trackLabel = (x: { lang: string | null; title: string | null }, i: number) => t.trackName(x.lang, x.title, i)

/** Errors and one-time notices of the cinema, over the stage. */
export function CinemaNotices() {
  const { error, notices } = useCinema(useShallow((s) => ({ error: s.error, notices: s.notices })))
  if (!error && !notices.length) return null
  return (
    <div className={styles.notices} role="status" aria-live="polite">
      {error && (
        <div className={`${styles.notice} ${styles.noticeError}`}>
          <span>{error}</span>
          <button type="button" className={styles.ib} aria-label="Fechar" onClick={act.dismissError}><Icon icon={X} size={14} /></button>
        </div>
      )}
      {notices.map((n) => (
        <div key={n} className={styles.notice}>
          <span>{n}</span>
          <button type="button" className={styles.ib} aria-label="Fechar" onClick={() => act.dismissNotice(n)}><Icon icon={X} size={14} /></button>
        </div>
      ))}
    </div>
  )
}

/** "Ana abriu uma sessão: Duna · 2h46" + Sentar, for whoever in the call is not seated; the summary after it ends. */
export function CinemaCard({ channel }: { channel: Channel }) {
  const { session, seated, ended } = useCinema(useShallow((s) => ({ session: s.session, seated: s.mine.seated, ended: s.ended })))
  const host = useData((st) => (session ? displayName(st, session.hostId, channel.spaceId) : ''))
  if (session && !seated) {
    return (
      <div className={styles.card} role="group" aria-label={t.button}>
        <Icon icon={FilmStrip} size={18} />
        <span>
          {t.card(host)} <b>{session.film.title}</b> · {length(session.film.durationS)}
        </span>
        <Button variant="primary" size="sm" onClick={() => act.seat(true)}>{t.sit}</Button>
      </div>
    )
  }
  if (ended && !session) {
    return (
      <div className={styles.card} role="status">
        <Icon icon={FilmStrip} size={18} />
        <span>
          <b>{ended.title}</b> · {t.ended[ended.reason]} · {t.endedSummary(length(ended.summary.watchedS), ended.summary.reactions)}
        </span>
        <button type="button" className={styles.ib} aria-label="Fechar" onClick={() => useCinema.setState({ ended: null })}><Icon icon={X} size={14} /></button>
      </div>
    )
  }
  return null
}

/** Drag a video onto the call's stage to project it. */
export function useCinemaDrop(enabled: boolean): { dragging: boolean; props: { onDragOver?: (e: DragEvent) => void; onDragLeave?: () => void; onDrop?: (e: DragEvent) => void } } {
  const [dragging, setDragging] = useState(false)
  if (!enabled) return { dragging: false, props: {} }
  return {
    dragging,
    props: {
      onDragOver: (e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        setDragging(true)
      },
      onDragLeave: () => setDragging(false),
      onDrop: (e) => {
        const file = e.dataTransfer.files[0]
        setDragging(false)
        if (!file) return
        e.preventDefault()
        void act.openFromDrop(file)
      },
    },
  }
}

/** Film sheet (host, before opening): editable title, tracks, warnings, whether this PC decodes it. */
export function FilmSheet() {
  const draft = useCinema((s) => s.draft)
  const busy = useCinema((s) => s.busy)
  const [title, setTitle] = useState('')
  useEffect(() => setTitle(draft?.film.title ?? ''), [draft])
  const f = draft?.film
  return (
    <Modal
      open={!!draft}
      onClose={act.cancelDraft}
      title={t.sheet.title}
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={act.cancelDraft}>{t.sheet.cancel}</Button>
          <Button variant="primary" loading={busy} disabled={!title.trim()} onClick={() => act.openSession(title)}>{t.sheet.open}</Button>
        </>
      }
    >
      {f && draft && (
        <div className={styles.sheet}>
          <TextField label={t.sheet.name} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
          <div className={styles.chips}>
            <span className={styles.chip}>{techChip(f)}</span>
            <span className={styles.chip}>{length(f.durationS)}</span>
            <span className={styles.chip}>{String(Math.round(f.bitrateKbps / 100) / 10).replace('.', ',')} Mbps</span>
          </div>
          <dl className={styles.tracks}>
            <dt>{t.sheet.audio}</dt>
            <dd>{f.audio.length ? f.audio.map((a, i) => `${trackLabel(a, i)} (${a.channels} ch${a.out === 'copy' ? '' : ` → ${a.out.toUpperCase()}`})`).join(' · ') : t.sheet.none}</dd>
            <dt>{t.sheet.subtitles}</dt>
            <dd>{f.subtitles.length ? f.subtitles.map(trackLabel).join(' · ') : t.sheet.none}</dd>
          </dl>
          {(draft.warnings.length > 0 || !draft.decodes) && (
            <ul className={styles.warnings}>
              {!draft.decodes && <li>{t.sheet.noDecode}</li>}
              {draft.warnings.map((w) => <li key={w}>{t.warnings[w] ?? w}</li>)}
            </ul>
          )}
          <p className={styles.hint}>{t.sheet.seatsCheck}</p>
        </div>
      )}
    </Modal>
  )
}

/** Seconds of the film the player shows (video), else the room's. */
function useFilmTime(video: RefObject<HTMLVideoElement | null>): { cur: number; buffered: TimeRange[] } {
  const [now, setNow] = useState<{ cur: number; buffered: TimeRange[] }>({ cur: 0, buffered: [] })
  useEffect(() => {
    const id = setInterval(() => {
      const v = video.current
      if (v) setNow({ cur: v.currentTime, buffered: rangesOf(v.buffered) })
    }, 250)
    return () => clearInterval(id)
  }, [video])
  return now
}

/** The seated stage: the film full width on a dark surround, its controls, the seats, and the S panel. */
export function CinemaDev({ channel }: { channel: Channel }) {
  const session = useCinema((s) => s.session) as CinemaSessionView
  const mine = useCinema((s) => s.mine)
  const prefs = useCinema((s) => s.prefs)
  const audio = useCinema((s) => s.audio)
  const subtitle = useCinema((s) => s.subtitle)
  const statsOpen = useCinema((s) => s.statsOpen)
  const meId = useData((s) => s.me?.id)
  const names = useData(useShallow((st) => Object.fromEntries(session.seats.map((x) => [x.userId, displayName(st, x.userId, channel.spaceId)]))))
  const hostName = useData((st) => displayName(st, session.hostId, channel.spaceId))
  const root = useRef<HTMLDivElement>(null)
  const vref = useRef<HTMLVideoElement>(null)
  const [full, setFull] = useState(false)
  const time = useFilmTime(vref)
  useFilmAudio(audio)

  useEffect(() => {
    const v = vref.current!
    attachVideo(v)
    return () => detachVideo(v)
  }, [])

  useEffect(() => {
    const onFs = () => setFull(document.fullscreenElement === root.current)
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  // ASS/SSA: JASSUB draws on its own canvas over the <video>; text subtitles use the overlay below.
  const ass = useRef<ReturnType<typeof createAss> | null>(null)
  useEffect(() => {
    const v = vref.current
    if (!v || subtitle?.format !== 'ass') return
    const r = createAss(v, { format: 'ass', text: subtitle.text, fonts: [] }, subtitle.fonts, useCinema.getState().mine.offsetS)
    ass.current = r
    return () => {
      ass.current = null
      destroyAss(r)
    }
  }, [subtitle])
  useEffect(() => {
    if (ass.current) setAssOffset(ass.current, mine.offsetS)
  }, [mine.offsetS])

  const p = session.playback
  const film = session.film
  const isHost = session.hostId === meId
  const foyer = p.reason === 'foyer'
  const togglePlay = () => {
    const s = useCinema.getState().session
    if (!s) return
    if (s.playback.reason === 'foyer') return s.hostId === meId ? act.control('start', s.playback.position) : undefined
    act.control(s.playback.playing ? 'pause' : 'play')
  }
  const seekBy = (d: number) => act.control('seek', (vref.current?.currentTime ?? p.position) + d)
  const toggleFull = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
    else void root.current?.requestFullscreen().catch(() => undefined)
  }
  const cycleSubtitle = () => {
    const ids = [null, ...film.subtitles.map((x) => x.id)]
    act.setSubtitle(ids[(ids.indexOf(useCinema.getState().mine.subtitleId) + 1) % ids.length] ?? null)
  }
  const cycleAudio = () => {
    if (film.audio.length < 2) return
    const ids = film.audio.map((x) => x.id)
    act.setAudio(ids[(ids.indexOf(useCinema.getState().mine.audioId ?? ids[0]!) + 1) % ids.length]!)
  }

  // Spec §7.4 shortcuts (R reactions come with Plan 2's reaction bar).
  const keys = useRef({ togglePlay, seekBy, toggleFull, cycleSubtitle, cycleAudio })
  keys.current = { togglePlay, seekBy, toggleFull, cycleSubtitle, cycleAudio }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return
      const el = e.target as HTMLElement | null
      if (el?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return
      if (e.key === ' ' && el?.closest('button')) return // the focused button takes its own Space
      const k = keys.current
      const pr = useCinema.getState().prefs
      switch (e.key.length === 1 ? e.key.toLowerCase() : e.key) {
        case ' ': k.togglePlay(); break
        case 'ArrowLeft': k.seekBy(-(e.shiftKey ? SEEK_LONG_S : SEEK_S)); break
        case 'ArrowRight': k.seekBy(e.shiftKey ? SEEK_LONG_S : SEEK_S); break
        case 'ArrowUp': act.setPrefs({ volume: pr.volume + VOLUME_STEP, muted: false }); break
        case 'ArrowDown': act.setPrefs({ volume: pr.volume - VOLUME_STEP }); break
        case 'f': k.toggleFull(); break
        case 'c': k.cycleSubtitle(); break
        case 'a': k.cycleAudio(); break
        case 'm': act.setPrefs({ muted: !pr.muted }); break
        case 's': act.setStatsOpen(!useCinema.getState().statsOpen); break
        case 'Escape':
          if (!document.fullscreenElement) return
          void document.exitFullscreen().catch(() => undefined)
          break
        default: return
      }
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const ready = session.seats.filter((x) => x.status === 'ready').length
  const waitingNames = p.waitingFor.map((id) => names[id] ?? t.someone)
  const counting = p.playing && p.countdown && serverNow() < p.at
  let banner: ReactNode = null
  if (mine.unsupported) banner = mine.unsupported
  else if (foyer) banner = isHost ? t.stage.foyerHost : t.stage.foyerGuest(hostName)
  else if (p.reason === 'host_away') banner = t.stage.hostAway
  else if (p.reason === 'waiting' && p.waitingFor.length) banner = (
    <>
      {t.stage.waitingFor(waitingNames.join(', '))}
      {p.waitingFor.map((id) => <Button key={id} size="sm" variant="secondary" onClick={() => act.continueWithout(id)}>{t.stage.continueWithout(names[id] ?? t.someone)}</Button>)}
    </>
  )
  else if (p.reason === 'buffering') banner = t.stage.buffering
  else if (counting) banner = t.stage.countdown
  else if (!p.playing && p.by) banner = t.stage.paused(names[p.by] ?? t.someone)

  return (
    <div ref={root} className={`${styles.room} ${full ? styles.full : ''}`} aria-label={film.title}>
      <header className={styles.top}>
        <span className={styles.title}>{film.title}</span>
        <span className={styles.chip}>{techChip(film)}</span>
        <span className={styles.by}><Icon icon={FilmStrip} size={14} /> {t.projecting(hostName)}</span>
        <span className={styles.sync} title={`${ready} de ${session.seats.length}`}><i /> {t.stage.inSync} · {ready} de {session.seats.length}</span>
        {isHost
          ? <Button size="sm" variant="secondary-danger" onClick={act.end}>{t.stage.end}</Button>
          : <Button size="sm" variant="ghost" onClick={() => act.seat(false)}>{t.standUp}</Button>}
      </header>

      <div className={styles.screen}>
        <video ref={vref} className={styles.video} playsInline disablePictureInPicture />
        {subtitle?.format === 'vtt' && (
          <SubtitleOverlay cues={subtitle.cues} getTime={() => vref.current?.currentTime ?? 0} size="M" offsetS={mine.offsetS} controlsVisible={false} />
        )}
        {banner && <div className={styles.banner}>{banner}</div>}
        {foyer && isHost && (
          <Button variant="primary" size="lg" className={styles.start} onClick={() => act.control('start', p.position)}>{t.stage.start}</Button>
        )}
        {statsOpen && <StatsPanel names={names} />}
      </div>

      <Timeline durationS={film.durationS} cur={time.cur} buffered={time.buffered} onSeek={(s) => act.control('seek', s)} disabled={foyer} />

      <div className={styles.controls}>
        <button type="button" className={`${styles.ib} ${styles.play}`} aria-label={p.playing ? t.stage.pause : foyer ? t.stage.start : t.stage.play} disabled={foyer && !isHost} onClick={togglePlay}>
          <Icon icon={p.playing ? Pause : Play} size={18} filled />
        </button>
        <button type="button" className={styles.ib} aria-label={t.stage.back10} disabled={foyer} onClick={() => seekBy(-SEEK_S)}><Icon icon={RotateCcw} size={18} /></button>
        <button type="button" className={styles.ib} aria-label={t.stage.fwd10} disabled={foyer} onClick={() => seekBy(SEEK_S)}><Icon icon={RefreshCw} size={18} /></button>
        <span className={styles.time}><b>{clock(time.cur)}</b> / {clock(film.durationS)}</span>
        <span className={styles.grow} />
        <label className={styles.field}>
          <span>{t.audio.track}</span>
          <select value={mine.audioId ?? ''} onChange={(e) => act.setAudio(Number(e.target.value))} disabled={!film.audio.length}>
            {!film.audio.length && <option value="">{t.stage.noAudio}</option>}
            {film.audio.map((a, i) => <option key={a.id} value={a.id}>{trackLabel(a, i)}</option>)}
          </select>
        </label>
        <label className={styles.field}>
          <span>{t.subtitles.track}</span>
          <select value={mine.subtitleId ?? ''} onChange={(e) => act.setSubtitle(e.target.value === '' ? null : Number(e.target.value))}>
            <option value="">{t.subtitles.off}</option>
            {film.subtitles.map((x, i) => <option key={x.id} value={x.id}>{trackLabel(x, i)}</option>)}
          </select>
        </label>
        <span className={styles.offset} aria-label={t.subtitles.offset}>
          <button type="button" className={styles.ib} onClick={() => act.setSubtitleOffset(mine.offsetS - 0.1)}>−</button>
          <span>{t.subtitles.offsetValue(mine.offsetS)}</span>
          <button type="button" className={styles.ib} onClick={() => act.setSubtitleOffset(mine.offsetS + 0.1)}>+</button>
        </span>
        <span className={styles.vsep} />
        <button type="button" className={styles.ib} aria-label={t.audio.mute} aria-pressed={prefs.muted} onClick={() => act.setPrefs({ muted: !prefs.muted })}>
          <Icon icon={prefs.muted ? VolumeX : Volume2} size={18} />
        </button>
        <input className={styles.slider} type="range" min={0} max={1} step={0.01} value={prefs.muted ? 0 : prefs.volume} aria-label={t.audio.filmVolume} onChange={(e) => act.setPrefs({ volume: Number(e.target.value), muted: false })} />
        <span className={styles.duck}>
          <Switch checked={prefs.ducking} onChange={(ducking) => act.setPrefs({ ducking })} label={t.audio.ducking} />
        </span>
        <span className={styles.vsep} />
        <button type="button" className={styles.ib} aria-label={t.stage.stats} aria-pressed={statsOpen} onClick={() => act.setStatsOpen(!statsOpen)}><Icon icon={BarChart3} size={18} /></button>
        <button type="button" className={styles.ib} aria-label={full ? t.stage.exitFullscreen : t.stage.fullscreen} onClick={toggleFull}><Icon icon={full ? Minimize : Maximize} size={18} /></button>
      </div>

      <div className={styles.seats} role="group" aria-label={t.stage.seats}>
        {session.seats.map((x) => (
          <span key={x.userId} className={styles.seat} data-status={x.status}>
            <i /> {names[x.userId] ?? t.someone} <small>{t.stage.status[x.status]}{x.direct ? '' : ' · relay'}</small>
          </span>
        ))}
      </div>
    </div>
  )
}

function Timeline({ durationS, cur, buffered, onSeek, disabled }: { durationS: number; cur: number; buffered: TimeRange[]; onSeek: (s: number) => void; disabled: boolean }) {
  const pct = (s: number) => `${Math.min(100, Math.max(0, (s / durationS) * 100))}%`
  return (
    <div
      className={styles.timeline}
      role="slider"
      aria-label={t.stage.timeline}
      aria-valuemin={0}
      aria-valuemax={Math.round(durationS)}
      aria-valuenow={Math.round(cur)}
      aria-valuetext={clock(cur)}
      aria-disabled={disabled || undefined}
      tabIndex={-1}
      onClick={(e) => {
        if (disabled) return
        const r = e.currentTarget.getBoundingClientRect()
        onSeek(((e.clientX - r.left) / r.width) * durationS)
      }}
    >
      <div className={styles.rail}>
        {buffered.map((b, i) => <span key={i} className={styles.loaded} style={{ left: pct(b.startS), width: `calc(${pct(b.endS)} - ${pct(b.startS)})` }} />)}
        <span className={styles.played} style={{ width: pct(cur) }} />
        <span className={styles.knob} style={{ left: pct(cur) }} />
      </div>
    </div>
  )
}

const ms = (v: number | null | undefined, digits = 0) => (v === null || v === undefined ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(digits)} ms`)
const n1 = (v: number) => (Math.round(v * 10) / 10).toString().replace('.', ',')

/** `S`: the numbers behind the stage (spec §7.4). */
function StatsPanel({ names }: { names: Record<string, string> }) {
  const stats = useCinema((s) => s.stats)
  const session = useCinema((s) => s.session)
  if (!session) return null
  const f = session.film
  const sw = stats?.swarm
  const pl = stats?.player
  const rows: [string, string][] = [
    [t.stats.video, `${f.videoCodec.toUpperCase()} ${f.width}×${f.height} · ${n1(f.bitrateKbps / 1000)} Mbps`],
    [t.stats.position, `${t.stats.room} ${n1(stats?.roomS ?? 0)} s · ${t.stats.mine} ${stats?.videoS === null || stats?.videoS === undefined ? '—' : `${n1(stats.videoS)} s`}`],
    [t.stats.drift, `${ms(stats?.driftMs)} · p95 ${pl ? `${Math.round(pl.syncErrP95Ms)} ms` : '—'} · ${t.stats.dropped} ${pl?.droppedFrames ?? '—'}`],
    [t.stats.buffer, pl ? `${n1(pl.bufferedAheadS)} s` : '—'],
    [t.stats.clock, `offset ${ms(stats?.clock.offsetMs, 1)} · RTT ${stats?.clock.rttMs ?? '—'} ms`],
    [t.stats.pieces, sw ? `${t.stats.fromHost} ${Math.round(sw.fromHostPct)}% · ${t.stats.fromPeers} ${Math.round(sw.fromPeersPct)}% · ↓ ${n1(sw.downMbps)} ↑ ${n1(sw.upMbps)} Mbps · ${sw.peers} ${t.stats.peers}` : '—'],
    [t.stats.relay, stats?.relayed.length ? stats.relayed.map((id) => names[id] ?? id).join(', ') : t.stats.none],
    [t.stats.cache, stats?.cache ? `${stats.cache.kind.toUpperCase()} · ${n1(stats.cache.capGB)} GB` : '—'],
    [t.stats.audio, stats?.audioTrack ?? '—'],
    [t.stats.seats, session.seats.map((x) => `${names[x.userId] ?? '?'}: ${t.stage.status[x.status]} ${n1(x.aheadS)} s${x.direct ? '' : ' (relay)'}`).join(' · ')],
  ]
  return (
    <div className={styles.stats} aria-label={t.stage.stats}>
      {rows.map(([k, v]) => (
        <div key={k}><span>{k}</span><b>{v}</b></div>
      ))}
    </div>
  )
}
