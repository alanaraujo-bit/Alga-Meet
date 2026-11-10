// The room while I sit (spec §7): one full-window layer over the app ("modo sala": the sidebar and the call go under
// it), the film's <video>, the light of the room around it, and the screen of the moment (roomView). In the foyer the
// layer is hidden but stays mounted, so the <video> and its player live from the foyer to the end of the session.
import { positionAt, type Channel, type CinemaSessionView } from '@alga/shared'
import { useEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useShallow } from 'zustand/react/shallow'
import { useData } from '@/store/data'
import { displayName } from '@/store/selectors'
import { Button, closeMenu, toast } from '@/ui'
import * as act from '../actions'
import { createAss, destroyAss, setAssOffset } from '../ass'
import { CinemaDev, StatsPanel } from '../CinemaDev'
import { attachVideo, detachVideo, hostNextState, hostPrepareNext, hostSwitchNext, serverNow, useCinema } from '../store'
import { clock, t } from '../strings'
import { SubtitleOverlay } from '../SubtitleOverlay'
import { useFilmAudio } from '../useFilmAudio'
import { Icon } from '@/ui'
import { Maximize2 } from '@/ui/icons'
import { openCall } from '../../voice/voice'
import { useKeepArt } from './art'
import { ChatLayer } from './ChatLayer'
import { closeChat, openChat, startChat } from './chat'
import { cancelHold, endHold, isLocked, pokeLock, resetLock, startHold, useLock } from './lock'
import { LockLayer } from './LockLayer'
import { episodeLabel, nextStep } from './next'
import { CinemaNotices } from './Notices'
import { reducedMotion } from './prefs'
import { Countdown } from './Countdown'
import { Intermission } from './Intermission'
import { Paused } from './Paused'
import { useIdle } from './useIdle'
import { Waiting } from './Waiting'
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
export function useRoomView(session: CinemaSessionView, now: number): RoomView & { position: number; pausedSince: number | null } {
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
  return { ...v, position, pausedSince }
}

/** Seat names of the session (display names in this space). */
export function useSeatNames(session: CinemaSessionView, spaceId: string | null): Record<string, string> {
  return useData(useShallow((st) => Object.fromEntries([session.hostId, ...session.seats.map((x) => x.userId)].map((id) => [id, displayName(st, id, spaceId)]))))
}

/** `mini`: I left the call's screen while seated — the same <video> keeps playing in a corner (click = back). */
export function CinemaRoom({ channel, mini = false }: { channel: Channel; mini?: boolean }) {
  const [engineering, setEngineering] = useState(false)
  if (!engineering || mini) return <Room channel={channel} mini={mini} onEngineering={() => setEngineering(true)} />
  // The engineering stage (the old dev stage): the engine's raw controls and numbers, for debugging.
  return createPortal(
    <div className={`${s.room} ${s.visible} ${s.engineering}`} data-lights="dim">
      <CinemaDev channel={channel} />
      <Button size="sm" variant="secondary" className={s.leaveEngineering} onClick={() => setEngineering(false)}>{t.room.leaveEngineering}</Button>
    </div>,
    document.body,
  )
}

function Room({ channel, mini, onEngineering }: { channel: Channel; mini: boolean; onEngineering: () => void }) {
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
  const inRoom = IN_ROOM.has(view.screen)
  const shown = inRoom && !mini
  const playingScreen = view.screen === 'watching' || view.screen === 'credits'
  // the next-episode card keeps the top bar up (mockup 10)
  const idle = useIdle(IDLE_MS, shown && playingScreen && !(view.screen === 'credits' && session.next))
  const locked = useLock((st) => st.locked)
  const uiShown = view.screen !== 'countdown' && !(playingScreen && idle) && !locked
  useFilmAudio(audio)

  useEffect(() => startChat(), [])
  // Never come back to a locked room (the call's screen, the end of the session).
  useEffect(() => {
    if (!shown) resetLock()
  }, [shown])
  useEffect(() => resetLock, [])
  // Locking puts away whatever was open: a menu, the chat field, a focused control.
  useEffect(() => {
    if (!locked) return
    closeMenu()
    closeChat()
    ;(document.activeElement as HTMLElement | null)?.blur?.()
  }, [locked])

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

  // The host keeps where the film stopped for "Continuar de …" next time: while playing and on every pause (main
  // throttles to one write per 5 s with a trailing one, and writes the last position when the file closes).
  const isHost = session.hostId === meId
  const playingNow = session.playback.playing
  useEffect(() => {
    if (!isHost || !hostFileId) return
    const save = () => {
      const v = vref.current
      if (v && v.currentTime > 0) window.alga.cinema.saveResume(hostFileId, v.currentTime)
    }
    if (!playingNow) return save()
    const id = setInterval(save, 5_000)
    return () => clearInterval(id)
  }, [isHost, hostFileId, playingNow])

  useRoomKeys(vref, root, !mini, shown)
  useKeepArt(session)
  useNextDriver(session, view, isHost)

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
      className={`${s.room} ${shown ? s.visible : ''} ${mini && inRoom ? s.mini : ''}`}
      data-lights={view.lights}
      data-screen={view.screen}
      data-ui={uiShown ? 'on' : 'off'}
      data-cinema-room={shown ? 'shown' : 'hidden'}
      aria-label={mini ? t.mini.label(session.film.title) : t.room.label(session.film.title)}
      aria-hidden={!(shown || (mini && inRoom)) || undefined}
      role="region"
    >
      <div className={s.lightHalf} aria-hidden />
      <div className={s.lightOn} aria-hidden />
      {ambient && !mini && <ScreenLight video={vref} />}
      <div className={s.drag} aria-hidden />
      <div className={s.frame} onClick={() => (mini ? openCall(channel.id) : playingScreen && act.control('pause'))} onDoubleClick={() => !mini && toggleFullscreen(root.current)}>
        <video ref={vref} className={s.video} playsInline disablePictureInPicture />
      </div>
      {mini && inRoom && (
        <button type="button" className={s.miniBack} aria-label={t.mini.back} onClick={() => openCall(channel.id)}>
          <Icon icon={Maximize2} size={16} />
        </button>
      )}
      {subtitle?.format === 'vtt' && !mini && (
        <div className={s.subs}>
          <SubtitleOverlay cues={subtitle.cues} getTime={() => vref.current?.currentTime ?? 0} size="M" offsetS={mine.offsetS} controlsVisible={uiShown && shown} />
        </div>
      )}
      {shown && view.screen !== 'intermission' && (
        <Watching
          session={session} channel={channel} view={view} video={vref} root={root} uiShown={uiShown} onEngineering={onEngineering}
          center={
            view.screen === 'paused' ? <Paused session={session} channel={channel} who={view.who} pausedSince={view.pausedSince} now={now} />
            : view.screen === 'waiting' ? <Waiting session={session} channel={channel} who={view.who} />
            : view.screen === 'countdown' ? <Countdown key={p.at} at={p.at} now={now} />
            : null
          }
        />
      )}
      {shown && view.screen === 'intermission' && <Intermission session={session} channel={channel} video={vref} who={view.who} />}
      {statsOpen && !mini && (
        <div className={s.stats}>
          <StatsPanel names={names}>
            <Button size="sm" variant="secondary" onClick={onEngineering}>{t.room.engineering}</Button>
          </StatsPanel>
        </div>
      )}
      {shown && <ChatLayer channel={channel} uiShown={uiShown} />}
      {shown && <CinemaNotices room />}
      {shown && <LockLayer />}
      <div className={s.sr} aria-live="polite">{announce(view, names)}</div>
    </div>,
    document.body,
  )
}

/**
 * The host's client drives the end of each film (room/next.ts): in the credits it prepares and announces the next
 * file of the folder, switches when the 10 s run out, and with nothing next it ends the session at the very end, so
 * everyone gets the ticket.
 */
function useNextDriver(session: CinemaSessionView, view: RoomView & { position: number }, isHost: boolean): void {
  const endedFor = useRef<string | null>(null)
  const film = `${session.sessionId}:${session.film.durationS}`
  useEffect(() => {
    if (!isHost) return
    const step = nextStep({
      screen: view.screen, nextUpS: view.nextUpS, position: view.position, durationS: session.film.durationS,
      playing: session.playback.playing, announced: !!session.next, ...hostNextState(),
    })
    if (step === 'prepare') void hostPrepareNext(episodeLabel)
    else if (step === 'switch') hostSwitchNext()
    else if (step === 'end' && endedFor.current !== film) {
      endedFor.current = film
      act.end()
    }
  })
}

/** What the polite live region says when the room changes (spec §7.5). */
function announce(view: RoomView, names: Record<string, string>): string {
  const name = view.who ? (names[view.who] ?? t.someone) : t.someone
  switch (view.screen) {
    case 'paused': return view.who ? t.paused.title(name) : t.paused.plain
    case 'waiting': return view.who ? t.waiting.title(name) : t.waiting.loading
    case 'intermission': return t.intermission.overline
    case 'countdown': return t.countdown(3)
    default: return ''
  }
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
  // its own clipping box: a canvas bleeding past the room would make the room scrollable (focus/scrollIntoView)
  return (
    <div className={s.screenLightBox} aria-hidden>
      <canvas ref={ref} width={16} height={9} className={s.screenLight} />
    </div>
  )
}

/**
 * Spec §7.4 shortcuts, in the capture phase (the DM chat's "type anywhere" skips defaultPrevented keys). Space is
 * play/pause on release; held 3 s it locks the room (lock.ts), and while locked every key is swallowed but that hold.
 * Enter opens the chat. `lockable`: only the full room can be locked (not the foyer on the call's stage).
 */
function useRoomKeys(video: RefObject<HTMLVideoElement | null>, root: RefObject<HTMLDivElement | null>, enabled: boolean, lockable: boolean): void {
  useEffect(() => {
    if (!enabled) return
    let holding = false
    const onKey = (e: KeyboardEvent) => {
      if (isLocked()) {
        e.preventDefault()
        e.stopImmediatePropagation()
        // Esc still leaves fullscreen (a way out, not an action on the film); the room stays locked.
        if (e.key === 'Escape') {
          if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
          return pokeLock()
        }
        if (e.key !== ' ') return pokeLock()
        if (!e.repeat) {
          holding = true
          startHold()
        }
        return
      }
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return
      const el = e.target as HTMLElement | null
      if (el?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"], [role="listbox"], [role="radiogroup"], [role="slider"]')) return
      if ((e.key === ' ' || e.key === 'Enter') && el?.closest('button')) return // the focused button takes its own key
      // Windows auto-repeat would flood the gateway with controls: swallow it (volume is local and may repeat)
      if (e.repeat && (e.key === ' ' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return void e.preventDefault()
      const st = useCinema.getState()
      const s = st.session
      if (!s || !st.mine.seated) return
      const pr = st.prefs
      // the foyer only starts (host) and opens the numbers; seeking there is refused by the server
      if (s.playback.reason === 'foyer' && e.key !== ' ' && e.key.toLowerCase() !== 's') return
      const seekBy = (d: number) => act.control('seek', (video.current?.currentTime ?? s.playback.position) + d)
      switch (e.key.length === 1 ? e.key.toLowerCase() : e.key) {
        case ' ':
          // On release (keyup): a hold must never pause the whole room before it becomes a lock.
          holding = true
          if (lockable) startHold()
          break
        case 'Enter':
          if (!pr.chat) act.setPrefs({ chat: true })
          openChat()
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
    const onUp = (e: KeyboardEvent) => {
      if (e.key !== ' ' || !holding) return
      holding = false
      e.preventDefault()
      // Not lockable (the foyer): every release is a tap.
      const r = lockable ? endHold() : 'toggle'
      if (r === 'toggle') spaceAction()
    }
    // Focus left mid-hold (Alt+Tab): the keyup will never come here.
    const onBlur = () => {
      holding = false
      cancelHold()
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('keyup', onUp, true)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('keyup', onUp, true)
      window.removeEventListener('blur', onBlur)
      cancelHold()
    }
  }, [video, root, enabled, lockable])
}

/** Space, tapped: start (host, in the foyer) or play/pause. */
function spaceAction(): void {
  const st = useCinema.getState()
  const s = st.session
  if (!s || !st.mine.seated) return
  if (s.playback.reason !== 'foyer') return act.control(s.playback.playing ? 'pause' : 'play')
  if (s.hostId === useData.getState().me?.id) act.control('start', s.playback.position)
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
