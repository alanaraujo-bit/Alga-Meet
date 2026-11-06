// The room while I sit (spec §7): one full-window layer over the app ("modo sala": the sidebar and the call go under
// it), the film's <video>, the light of the room around it, and the screen of the moment (roomView). In the foyer the
// layer is hidden but stays mounted, so the <video> and its player live from the foyer to the end of the session.
import { positionAt, type Channel, type CinemaSessionView } from '@alga/shared'
import { useEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useShallow } from 'zustand/react/shallow'
import { useData } from '@/store/data'
import { displayName } from '@/store/selectors'
import { Button, toast } from '@/ui'
import * as act from '../actions'
import { createAss, destroyAss, setAssOffset } from '../ass'
import { CinemaDev, CinemaNotices, StatsPanel } from '../CinemaDev'
import { attachVideo, detachVideo, serverNow, useCinema } from '../store'
import { clock, t } from '../strings'
import { SubtitleOverlay } from '../SubtitleOverlay'
import { useFilmAudio } from '../useFilmAudio'
import { reducedMotion } from './prefs'
import { useIdle } from './useIdle'
import { Watching } from './Watching'
import { creditsAt, roomView, type RoomScreen, type RoomView } from './view'
import s from './room.module.css'

const SEEK_S = 10
const SEEK_LONG_S = 60
const VOLUME_STEP = 0.05
/** Screens shown in the full-window room; the rest (foyer, card, sheet) live on the call's stage. */
const IN_ROOM: ReadonlySet<RoomScreen> = new Set(['countdown', 'watching', 'credits', 'paused', 'waiting', 'intermission'])
/** The interface hides after this long without the mouse while the film plays (spec Â§7.3.5). */
const IDLE_MS = 2_000
/** Harness only: shifts when a pause began (sessionStorage), to reach the intermission without waiting 3 min. */
const DEV_PAUSE_SHIFT_KEY = 'alga.cinema.devPauseShiftMs'

/** Server time, refreshed every `ms` (countdown, intermission threshold, credits). */
export function useServerNow(ms: number): number {
  const [now, setNow] = useState(serverNow)
  useEffect(() => {
    const id = setInterval(() => setNow(serverNow()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}

/** The room's view of the session now (see view.ts). */
export function useRoomView(session: CinemaSessionView, now: number): RoomView & { position: number } {
  const seated = useCinema((st) => st.mine.seated)
  const ended = useCinema((st) => !!st.ended)
  const p = session.playback
  const position = positionAt(p, now, session.film.durationS)
  const shift = Number(sessionStorage.getItem(DEV_PAUSE_SHIFT_KEY)) || 0
  const pausedSince = !p.playing && p.reason === 'user' ? p.at - shift : null
  const v = roomView({
    session, seated, draft: false, ended, serverNow: now, pausedSince, durationS: session.film.durationS,
    creditsAtS: creditsAt(session.film.chapters), position,
  })
  return { ...v, position }
}

/** Seat names of the session (display names in this space). */
export function useSeatNames(session: CinemaSessionView, spaceId: string | null): Record<string, string> {
  return useData(useShallow((st) => Object.fromEntries([session.hostId, ...session.seats.map((x) => x.userId)].map((id) => [id, displayName(st, id, spaceId)]))))
}

export function CinemaRoom({ channel }: { channel: Channel }) {
  const [engineering, setEngineering] = useState(false)
  if (!engineering) return <Room channel={channel} onEngineering={() => setEngineering(true)} />
  // The engineering stage (the old dev stage): the engine's raw controls and numbers, for debugging.
  return createPortal(
    <div className={`${s.room} ${s.visible} ${s.engineering}`} data-lights="dim">
      <CinemaDev channel={channel} />
      <Button size="sm" variant="secondary" className={s.leaveEngineering} onClick={() => setEngineering(false)}>{t.room.leaveEngineering}</Button>
    </div>,
    document.body,
  )
}

function Room({ channel, onEngineering }: { channel: Channel; onEngineering: () => void }) {
  const session = useCinema((st) => st.session) as CinemaSessionView
  const mine = useCinema((st) => st.mine)
  const subtitle = useCinema((st) => st.subtitle)
  const audio = useCinema((st) => st.audio)
  const ambient = useCinema((st) => st.prefs.ambient)
  const statsOpen = useCinema((st) => st.statsOpen)
  const hostFileId = useCinema((st) => st.host.fileId)
  const meId = useData((st) => st.me?.id)
  const names = useSeatNames(session, channel.spaceId)
  const root = useRef<HTMLDivElement>(null)
  const vref = useRef<HTMLVideoElement>(null)
  const now = useServerNow(250)
  const view = useRoomView(session, now)
  const shown = IN_ROOM.has(view.screen)
  const playingScreen = view.screen === 'watching' || view.screen === 'credits'
  const idle = useIdle(IDLE_MS, shown && playingScreen)
  const uiShown = view.screen !== 'countdown' && !(playingScreen && idle)
  useFilmAudio(audio)

  useEffect(() => {
    const v = vref.current!
    attachVideo(v)
    return () => detachVideo(v)
  }, [])

  // ASS/SSA: JASSUB draws on its own canvas over the <video>; text subtitles use the overlay.
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

  // The host keeps where the film stopped for "Continuar de …" next time (main throttles to once per 5 s).
  const isHost = session.hostId === meId
  useEffect(() => {
    if (!isHost || !hostFileId) return
    const id = setInterval(() => {
      const v = vref.current
      if (v && !v.paused && v.currentTime > 0) window.alga.cinema.saveResume(hostFileId, v.currentTime)
    }, 5_000)
    return () => clearInterval(id)
  }, [isHost, hostFileId])

  useRoomKeys(vref, root)

  // "Ana pulou para 1:12:40 · Desfazer": every seek of the room, undone by seeking back to where it was.
  const last = useRef(session.playback)
  useEffect(() => {
    const prev = last.current
    const p = session.playback
    last.current = p
    if (p.seq === prev.seq || p.reason !== 'buffering' || !p.by) return
    const from = positionAt(prev, p.at, session.film.durationS)
    if (Math.abs(p.position - from) < 15) return
    const who = p.by === meId ? t.room.you : (names[p.by] ?? t.someone)
    toast.info(t.room.seeked(who, clock(p.position)), { action: { label: t.room.undo, run: () => act.control('seek', from) } })
  }, [session.playback, session.film.durationS, meId, names])

  const p = session.playback
  return createPortal(
    <div
      ref={root}
      className={`${s.room} ${shown ? s.visible : ''}`}
      data-lights={view.lights}
      data-screen={view.screen}
      data-ui={uiShown ? 'on' : 'off'}
      aria-label={t.room.label(session.film.title)}
      aria-hidden={!shown || undefined}
      role="region"
    >
      <div className={s.lightHalf} aria-hidden />
      <div className={s.lightOn} aria-hidden />
      {ambient && <ScreenLight video={vref} />}
      <div className={s.drag} aria-hidden />
      <div className={s.frame} onClick={() => playingScreen && act.control('pause')} onDoubleClick={() => toggleFullscreen(root.current)}>
        <video ref={vref} className={s.video} playsInline disablePictureInPicture />
      </div>
      {subtitle?.format === 'vtt' && (
        <div className={s.subs}>
          <SubtitleOverlay cues={subtitle.cues} getTime={() => vref.current?.currentTime ?? 0} size="M" offsetS={mine.offsetS} controlsVisible={uiShown && shown} />
        </div>
      )}
      {shown && view.screen !== 'intermission' && (
        <Watching session={session} channel={channel} view={view} video={vref} root={root} uiShown={uiShown} onEngineering={onEngineering} />
      )}
      {statsOpen && (
        <div className={s.stats}>
          <StatsPanel names={names}>
            <Button size="sm" variant="secondary" onClick={onEngineering}>{t.room.engineering}</Button>
          </StatsPanel>
        </div>
      )}
      {shown && <CinemaNotices />}
      <div className={s.sr} aria-live="polite">{p.playing ? '' : p.by && view.screen === 'paused' ? t.stage.paused(names[p.by] ?? t.someone) : ''}</div>
    </div>,
    document.body,
  )
}

/**
 * The screen light (§7.1): the frame downscaled to 16×9 four times a second, blurred into the dark around the film at
 * ≤ 12 % opacity. Off with reduced motion and with prefs.ambient.
 */
function ScreenLight({ video }: { video: RefObject<HTMLVideoElement | null> }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const ctx = ref.current?.getContext('2d')
    if (!ctx || reducedMotion()) return
    const id = setInterval(() => {
      const v = video.current
      if (v && v.readyState >= 2) ctx.drawImage(v, 0, 0, 16, 9)
    }, 250)
    return () => clearInterval(id)
  }, [video])
  return <canvas ref={ref} width={16} height={9} className={s.screenLight} aria-hidden />
}

/** Spec §7.4 shortcuts, in the capture phase (the DM chat's "type anywhere" skips defaultPrevented keys). */
function useRoomKeys(video: RefObject<HTMLVideoElement | null>, root: RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return
      const el = e.target as HTMLElement | null
      if (el?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"], [role="listbox"], [role="radiogroup"], [role="slider"]')) return
      if (e.key === ' ' && el?.closest('button')) return // the focused button takes its own Space
      const st = useCinema.getState()
      const s = st.session
      if (!s || !st.mine.seated) return
      const pr = st.prefs
      // the foyer only starts (host) and opens the numbers; seeking there is refused by the server
      if (s.playback.reason === 'foyer' && e.key !== ' ' && e.key.toLowerCase() !== 's') return
      const seekBy = (d: number) => act.control('seek', (video.current?.currentTime ?? s.playback.position) + d)
      switch (e.key.length === 1 ? e.key.toLowerCase() : e.key) {
        case ' ':
          if (s.playback.reason === 'foyer') {
            if (s.hostId !== useData.getState().me?.id) return
            act.control('start', s.playback.position)
          } else act.control(s.playback.playing ? 'pause' : 'play')
          break
        case 'ArrowLeft': seekBy(-(e.shiftKey ? SEEK_LONG_S : SEEK_S)); break
        case 'ArrowRight': seekBy(e.shiftKey ? SEEK_LONG_S : SEEK_S); break
        case 'ArrowUp': act.setPrefs({ volume: pr.volume + VOLUME_STEP, muted: false }); break
        case 'ArrowDown': act.setPrefs({ volume: pr.volume - VOLUME_STEP }); break
        case 'f': toggleFullscreen(root.current); break
        case 'c': cycleSubtitle(s); break
        case 'a': cycleAudio(s); break
        case 'm': act.setPrefs({ muted: !pr.muted }); break
        case 's': act.setStatsOpen(!st.statsOpen); break
        case 'Escape':
          if (!document.fullscreenElement) return
          void document.exitFullscreen().catch(() => undefined)
          break
        default: return
      }
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [video, root])
}

export function toggleFullscreen(el: HTMLElement | null): void {
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
  else void el?.requestFullscreen().catch(() => undefined)
}

export function cycleSubtitle(s: CinemaSessionView): void {
  const ids = [null, ...s.film.subtitles.map((x) => x.id)]
  act.setSubtitle(ids[(ids.indexOf(useCinema.getState().mine.subtitleId) + 1) % ids.length] ?? null)
}

export function cycleAudio(s: CinemaSessionView): void {
  if (s.film.audio.length < 2) return
  const ids = s.film.audio.map((x) => x.id)
  act.setAudio(ids[(ids.indexOf(useCinema.getState().mine.audioId ?? ids[0]!) + 1) % ids.length]!)
}
