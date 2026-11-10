// The music of my call: a card in the lower-right corner with YouTube's player (always in sight while it plays, as
// YouTube requires), the song, the controls, the queue and the field to paste a link. The cover, blurred, tints it.
import { musicPosition, youtubeId, type MusicState, type MusicTrack } from '@alga/shared'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type CSSProperties, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { useShallow } from 'zustand/react/shallow'
import { useData } from '@/store/data'
import { displayName } from '@/store/selectors'
import { Icon, IconButton, Tooltip } from '@/ui'
import { Eco } from '@/ui/eco/Eco'
import { BRAND_ECO } from '@/ui/eco/ecoRules'
import { ChevronDown, ChevronUp, Headphones, Pause, Play, SkipForward, Square, Volume2, VolumeX, X } from '@/ui/icons'
import { EASE_IN, EASE_OUT_QUART } from '@/ui/motion'
import { useCinema } from '../cinema/store'
import { Player, type PlayerTime } from './Player'
import { addLink, closeCard, control, remove, serverTime, setListening, setVolume, useMusic } from './store'
import { t } from './strings'
import s from './music.module.css'

const clock = (sec: number | null): string => {
  if (sec === null || !Number.isFinite(sec)) return '–:––'
  const v = Math.max(0, Math.floor(sec))
  const h = Math.floor(v / 3600)
  const m = Math.floor((v % 3600) / 60)
  const ss = String(v % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** Clear of the call's controls (they sit at the bottom of the stage) and of the toasts (which move left of the card). */
function usePlacement(card: React.RefObject<HTMLElement | null>): CSSProperties {
  const [bottom, setBottom] = useState(16)
  useLayoutEffect(() => {
    const place = () => {
      const el = card.current
      const dock = document.querySelector<HTMLElement>('[role="toolbar"][aria-label="Controles da chamada"]')
      if (!el) return
      const r = el.getBoundingClientRect()
      const d = dock?.getBoundingClientRect()
      const overlaps = d && d.width > 0 && d.right > window.innerWidth - 16 - r.width
      setBottom(overlaps ? Math.ceil(window.innerHeight - d.top + 12) : 16)
      document.documentElement.style.setProperty('--toast-right', `${Math.ceil(r.width + 32)}px`)
    }
    place()
    const id = setInterval(place, 1000)
    window.addEventListener('resize', place)
    return () => {
      clearInterval(id)
      window.removeEventListener('resize', place)
      document.documentElement.style.removeProperty('--toast-right')
    }
  }, [card])
  return { bottom }
}

/** Mounted once in the shell: the card shows while my call has music, or when I open it to paste the first link. */
export function MusicHost() {
  const music = useMusic((st) => st.state)
  const open = useMusic((st) => st.open)
  const inCall = useData((st) => !!(st.me && st.voiceStates[st.me.id]))
  const shown = inCall && (open || !!music?.now)
  return createPortal(<AnimatePresence>{shown && <Card key="music" />}</AnimatePresence>, document.body)
}

function Card() {
  const music = useMusic((st) => st.state)
  const listening = useMusic((st) => st.listening)
  const ref = useRef<HTMLDivElement>(null)
  const place = usePlacement(ref)
  const [compact, setCompact] = useState(false)
  const [time, setTime] = useState<PlayerTime>({ time: null, duration: null })
  const onTime = useCallback((p: PlayerTime) => setTime(p), [])
  // Seated in the cinema: the film has the sound; the music waits (for me only).
  const inCinema = useCinema((st) => !!st.session && st.mine.seated)
  const now = music?.now ?? null
  const playing = !!music?.playback.playing
  return (
    <motion.section
      ref={ref}
      className={s.card}
      style={place}
      role="region"
      aria-label={t.card}
      initial={{ opacity: 0, y: 14, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: 0.26, ease: EASE_OUT_QUART } }}
      exit={{ opacity: 0, y: 8, scale: 0.98, transition: { duration: 0.16, ease: EASE_IN } }}
    >
      {now && <img className={s.glow} src={`https://i.ytimg.com/vi/${now.videoId}/mqdefault.jpg`} alt="" aria-hidden />}
      <header className={s.head}>
        <span className={s.eco} aria-hidden>
          <Eco size={30} framing="avatar" state={now && playing && listening && !inCinema ? 'talking' : 'idle'} spec={{ ...BRAND_ECO, accessory: 'headset' }} />
        </span>
        <span className={s.headText}>
          <b>{t.card}</b>
          <span>{now ? (playing ? t.nowPlaying : t.paused) : t.idle}</span>
        </span>
        {now && listening && (
          <IconButton icon={compact ? ChevronUp : ChevronDown} label={compact ? t.expand : t.minimize} size="sm" onClick={() => setCompact(!compact)} />
        )}
        {now ? (
          listening && <IconButton icon={Headphones} label={t.stopListening} size="sm" onClick={() => setListening(false)} />
        ) : (
          <IconButton icon={X} label={t.close} size="sm" onClick={closeCard} />
        )}
      </header>

      {now && music && (listening ? (
        <>
          <Player key={music.channelId} music={music} play={!inCinema} onTime={onTime} />
          {inCinema && <p className={s.note}>{t.inCinema}</p>}
          <NowPlaying music={music} now={now} time={time} />
        </>
      ) : (
        <div className={s.away}>
          <p className={s.note}>{t.notListening}</p>
          <button type="button" className={s.pill} onClick={() => setListening(true)}>{t.listenAgain}</button>
        </div>
      ))}

      {(!now || !compact) && (
        <>
          {music && music.queue.length > 0 && <Queue queue={music.queue} />}
          {!now && (
            <div className={s.empty}>
              <span className="eco-alive" aria-hidden><Eco size={64} spec={{ ...BRAND_ECO, accessory: 'headset' }} state="listening" /></span>
              <p>{t.empty}</p>
            </div>
          )}
          <Field autoFocus={!now} />
          <LastLine music={music} />
        </>
      )}
    </motion.section>
  )
}

function NowPlaying({ music, now, time }: { music: MusicState; now: MusicTrack; time: PlayerTime }) {
  const volume = useMusic((st) => st.volume)
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 500)
    return () => clearInterval(id)
  }, [])
  const adder = useData((st) => displayName(st, now.addedBy, null))
  const duration = now.durationS ?? time.duration
  const at = musicPosition(music.playback, serverTime(), duration)
  const playing = music.playback.playing
  const lastVolume = useRef(volume || 0.5)
  if (volume > 0) lastVolume.current = volume
  return (
    <div className={s.now}>
      <div className={s.title} title={now.title}>{now.title}</div>
      <div className={s.meta}>{[now.author, t.addedBy(adder)].filter(Boolean).join(' · ')}</div>
      <div className={s.progress}>
        <input
          type="range" className={s.bar} min={0} max={duration ?? 0} step={1} value={Math.min(at, duration ?? 0)} disabled={!duration}
          aria-label={t.seek} aria-valuetext={`${clock(at)} de ${clock(duration)}`}
          style={{ '--v': duration ? `${(Math.min(at, duration) / duration) * 100}%` : '0%' } as CSSProperties}
          onChange={(e) => control('seek', Number(e.target.value))}
        />
        <span className={s.time}>{clock(at)} / {clock(duration)}</span>
      </div>
      <div className={s.controls}>
        <Tooltip content={playing ? t.pause : t.play}>
          <button type="button" className={`${s.ctl} ${s.main}`} aria-label={playing ? t.pause : t.play} onClick={() => control(playing ? 'pause' : 'play')}>
            <Icon icon={playing ? Pause : Play} size={18} filled />
          </button>
        </Tooltip>
        <Tooltip content={t.skip}>
          <button type="button" className={s.ctl} aria-label={t.skip} onClick={() => control('skip')}>
            <Icon icon={SkipForward} size={18} filled />
          </button>
        </Tooltip>
        <Tooltip content={t.stop}>
          <button type="button" className={s.ctl} aria-label={t.stop} onClick={() => control('stop')}>
            <Icon icon={Square} size={16} />
          </button>
        </Tooltip>
        <span className={s.grow} />
        <button type="button" className={s.ctl} aria-label={volume ? t.volume : t.volume} onClick={() => setVolume(volume ? 0 : lastVolume.current)}>
          <Icon icon={volume ? Volume2 : VolumeX} size={16} />
        </button>
        <input
          type="range" className={s.volume} min={0} max={1} step={0.01} value={volume} aria-label={t.volume}
          style={{ '--v': `${volume * 100}%` } as CSSProperties}
          onChange={(e) => setVolume(Number(e.target.value))}
        />
      </div>
    </div>
  )
}

const QUEUE_SHOWN = 4

function Queue({ queue }: { queue: MusicTrack[] }) {
  return (
    <div className={s.queue}>
      <div className={s.queueHead}>{t.next(queue.length)}</div>
      <ol>
        <AnimatePresence initial={false}>
          {queue.slice(0, QUEUE_SHOWN).map((q, i) => (
            <motion.li
              key={q.id}
              layout
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0, transition: { duration: 0.2, ease: EASE_OUT_QUART } }}
              exit={{ opacity: 0, transition: { duration: 0.14 } }}
            >
              <span className={s.num}>{i + 1}</span>
              <img className={s.thumb} src={`https://i.ytimg.com/vi/${q.videoId}/default.jpg`} alt="" />
              <span className={s.qtitle} title={q.title}>{q.title}</span>
              <IconButton icon={X} label={t.remove(q.title)} size="sm" onClick={() => remove(q.id)} />
            </motion.li>
          ))}
        </AnimatePresence>
      </ol>
      {queue.length > QUEUE_SHOWN && <div className={s.more}>{t.more(queue.length - QUEUE_SHOWN)}</div>}
    </div>
  )
}

function Field({ autoFocus }: { autoFocus: boolean }) {
  const [text, setText] = useState('')
  const error = useMusic((st) => st.error)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (autoFocus) ref.current?.focus()
  }, [autoFocus])
  const submit = (value: string) => {
    if (!value.trim()) return
    if (addLink(value) === 'sent') setText('')
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      submit(text)
    }
    if (e.key === 'Escape' && !text) ref.current?.blur()
  }
  // A pasted YouTube link goes in at once: no Enter needed.
  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData('text')
    if (!text && youtubeId(pasted)) {
      e.preventDefault()
      submit(pasted)
    }
  }
  return (
    <div className={s.field}>
      <input
        ref={ref}
        className={s.input}
        aria-label={t.field}
        placeholder={t.placeholder}
        value={text}
        maxLength={2048}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        onPaste={onPaste}
        aria-describedby={error ? 'music-error' : undefined}
      />
      {error && <p id="music-error" className={s.error} role="alert">{error}</p>}
    </div>
  )
}

/** "Ana pulou Song": what just happened, in one quiet line. */
function LastLine({ music }: { music: MusicState | null }) {
  const me = useData((st) => st.me?.id)
  const who = useData(useShallow((st) => (music?.last?.by ? displayName(st, music.last.by, null) : null)))
  const l = music?.last
  if (!l || l.kind === 'ended') return null
  const name = l.by === me ? t.you : (who ?? t.someone)
  const title = l.title ?? ''
  const text = l.kind === 'add' ? t.last.add(name, title) : l.kind === 'skip' ? t.last.skip(name, title) : l.kind === 'remove' ? t.last.remove(name, title)
    : l.kind === 'unplayable' ? t.last.unplayable(title) : l.kind === 'play' ? t.last.play(name) : l.kind === 'pause' ? t.last.pause(name)
    : l.kind === 'seek' ? t.last.seek(name) : t.last.stop(name)
  return <p key={`${music!.playback.seq}-${l.kind}`} className={s.last} aria-live="polite">{text}</p>
}
