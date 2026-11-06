// Room controls (mockup 05): play/pause, ±10 s, time | reactions, subtitles+audio, film volume, voices volume,
// fullscreen, ⋯ (screen light, ducking, report, engineering mode).
import type { CinemaSessionView } from '@alga/shared'
import { CINEMA_REACTIONS, type CinemaReaction } from '@alga/shared'
import { useEffect, useState, type CSSProperties, type RefObject } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { media, useMedia } from '@/media'
import { useData } from '@/store/data'
import { Icon, MenuButton, Tooltip, type MenuEntry } from '@/ui'
import { Flag, Maximize, Minimize, MoreHorizontal, Pause, Play, RefreshCw, RotateCcw, Smile, Subtitles, Volume2, VolumeX, Wrench } from '@/ui/icons'
import { openReport } from '../../trust/Report'
import * as act from '../actions'
import { useCinema } from '../store'
import { clock, t } from '../strings'
import { toggleFullscreen } from './CinemaRoom'
import { lang } from './film'
import { canSend } from './reactions'
import s from './room.module.css'

const SEEK_S = 10

export function Controls({ session, video, root, cur, reactOpen, setReactOpen, onEngineering }: {
  session: CinemaSessionView
  video: RefObject<HTMLVideoElement | null>
  root: RefObject<HTMLElement | null>
  cur: number
  reactOpen: boolean
  setReactOpen: (open: boolean) => void
  onEngineering: () => void
}) {
  const prefs = useCinema((st) => st.prefs)
  const mine = useCinema(useShallow((st) => ({ audioId: st.mine.audioId, subtitleId: st.mine.subtitleId })))
  const host = useData((st) => st.users[session.hostId])
  const voices = useMedia(useShallow((st) => Object.values(st.participants).map((p) => p.volume)))
  const full = useFullscreen()
  const p = session.playback
  const playing = p.playing || p.reason === 'buffering'
  const locked = p.reason === 'host_away' || p.reason === 'foyer'
  const f = session.film
  const voicesVolume = voices.length ? Math.min(1, voices.reduce((a, b) => a + b, 0) / voices.length) : 1
  const seekBy = (d: number) => act.control('seek', (video.current?.currentTime ?? p.position) + d)

  const trackItems = (): MenuEntry[] => [
    { kind: 'group', label: t.room.subtitleGroup },
    { label: t.room.subtitleOff, checked: mine.subtitleId === null, onSelect: () => act.setSubtitle(null) },
    ...f.subtitles.map((x, i): MenuEntry => ({ label: x.title ?? (x.lang ? lang(x.lang)[1] : t.trackName(x.lang, x.title, i)), checked: mine.subtitleId === x.id, onSelect: () => act.setSubtitle(x.id) })),
    ...(f.audio.length > 1
      ? [
          { kind: 'separator' } as MenuEntry,
          { kind: 'group', label: t.room.audioGroup } as MenuEntry,
          ...f.audio.map((x): MenuEntry => ({ label: [x.title, `${lang(x.lang)[1]} ${t.film.channels(x.channels)}`].filter(Boolean).join(' · '), checked: mine.audioId === x.id, onSelect: () => act.setAudio(x.id) })),
        ]
      : []),
  ]
  const moreItems = (): MenuEntry[] => [
    { label: t.room.screenLight, checked: prefs.ambient, onSelect: () => act.setPrefs({ ambient: !prefs.ambient }) },
    { label: t.room.ducking, checked: prefs.ducking, onSelect: () => act.setPrefs({ ducking: !prefs.ducking }) },
    { kind: 'separator' },
    ...(host ? [{ label: t.room.report, icon: Flag, onSelect: () => openReport({ kind: 'user', user: host }) }] : []),
    { label: t.room.engineering, icon: Wrench, onSelect: onEngineering },
  ]

  return (
    <div className={s.controls}>
      <Tooltip content={playing ? t.room.pause : t.room.play} shortcut="Espaço">
        <button type="button" className={`${s.ib} ${s.play}`} aria-label={playing ? t.room.pause : t.room.play} disabled={locked} onClick={() => act.control(playing ? 'pause' : 'play')}>
          <Icon icon={playing ? Pause : Play} size={20} filled />
        </button>
      </Tooltip>
      <Tooltip content={t.room.back10} shortcut="←">
        <button type="button" className={`${s.ib} ${s.skip}`} aria-label={t.room.back10} disabled={locked} onClick={() => seekBy(-SEEK_S)}>
          <Icon icon={RotateCcw} size={24} />
          <b aria-hidden>10</b>
        </button>
      </Tooltip>
      <Tooltip content={t.room.fwd10} shortcut="→">
        <button type="button" className={`${s.ib} ${s.skip}`} aria-label={t.room.fwd10} disabled={locked} onClick={() => seekBy(SEEK_S)}>
          <Icon icon={RefreshCw} size={24} />
          <b aria-hidden>10</b>
        </button>
      </Tooltip>
      <span className={s.time} aria-label={t.room.time(clock(cur), clock(f.durationS))}>
        <b>{clock(cur)}</b>
        <span> / {clock(f.durationS)}</span>
      </span>

      <span className={s.controlsEnd}>
        <span className={s.reactWrap}>
          {reactOpen && <ReactionPicker onClose={() => setReactOpen(false)} />}
          <Tooltip content={t.room.reactions} shortcut="R">
            <button type="button" className={s.ib} aria-label={t.room.reactions} aria-expanded={reactOpen} onClick={() => setReactOpen(!reactOpen)}>
              <Icon icon={Smile} size={20} />
            </button>
          </Tooltip>
        </span>
        <MenuButton items={trackItems} side="top" align="end" label={t.room.subtitles}>
          <button type="button" className={s.ib} aria-label={t.room.subtitles}>
            <Icon icon={Subtitles} size={20} />
          </button>
        </MenuButton>
        <span className={s.vsep} />
        <span className={s.volume}>
          <Tooltip content={prefs.muted ? t.room.unmute : t.room.mute} shortcut="M">
            <button type="button" className={`${s.ib} ${s.ibSmall}`} aria-label={prefs.muted ? t.room.unmute : t.room.mute} aria-pressed={prefs.muted} onClick={() => act.setPrefs({ muted: !prefs.muted })}>
              <Icon icon={prefs.muted ? VolumeX : Volume2} size={18} />
            </button>
          </Tooltip>
          <span className={s.label}>{t.room.film}</span>
          <Slider value={prefs.muted ? 0 : prefs.volume} label={t.room.filmVolume} onChange={(volume) => act.setPrefs({ volume, muted: false })} />
        </span>
        <span className={`${s.volume} ${s.voices}`}>
          <span className={s.label}>{t.room.voices}</span>
          <Slider value={voicesVolume} label={t.room.voicesVolume} disabled={!voices.length} onChange={(v) => {
            for (const id of Object.keys(useMedia.getState().participants)) media.setVolume(id, v)
          }} />
        </span>
        <span className={s.vsep} />
        <Tooltip content={full ? t.room.exitFullscreen : t.room.fullscreen} shortcut="F">
          <button type="button" className={s.ib} aria-label={full ? t.room.exitFullscreen : t.room.fullscreen} onClick={() => toggleFullscreen(root.current)}>
            <Icon icon={full ? Minimize : Maximize} size={20} />
          </button>
        </Tooltip>
        <MenuButton items={moreItems} side="top" align="end" label={t.room.more}>
          <button type="button" className={s.ib} aria-label={t.room.more}>
            <Icon icon={MoreHorizontal} size={20} />
          </button>
        </MenuButton>
      </span>
    </div>
  )
}

function Slider({ value, label, onChange, disabled }: { value: number; label: string; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <input
      type="range" className={s.slider} min={0} max={1} step={0.01} value={value} aria-label={label} disabled={disabled}
      style={{ ['--v' as string]: `${Math.round(value * 100)}%` } as CSSProperties}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  )
}

/** The 6 reactions (R or the smiley); Esc closes. */
function ReactionPicker({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  const send = (emoji: CinemaReaction) => {
    if (canSend()) act.react(emoji)
  }
  return (
    <div className={s.picker} role="toolbar" aria-label={t.room.reactions}>
      {CINEMA_REACTIONS.map((e) => (
        <button key={e} type="button" className={s.pick} aria-label={t.room.react(e)} onClick={() => send(e)}>
          {e}
        </button>
      ))}
    </div>
  )
}

function useFullscreen(): boolean {
  const [full, setFull] = useState(!!document.fullscreenElement)
  useEffect(() => {
    const on = () => setFull(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', on)
    return () => document.removeEventListener('fullscreenchange', on)
  }, [])
  return full
}
