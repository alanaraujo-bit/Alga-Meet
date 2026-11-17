// The music of my call. One surface, three shapes: the full card (player, controls, queue, my playlists), the mini player
// (the video and a slim bar, thrown to any corner of the window) and the floating window outside Alga (popout.ts).
// YouTube's player is always in sight while it plays (their terms: visible, at least 200 × 200) and is never remounted
// between card and mini: the iframe keeps its place in the tree, only the frame around it changes.
import { musicPosition, youtubeId, youtubeListId, type MusicState, type MusicTrack } from '@alga/shared'
import { AnimatePresence, motion, useDragControls } from 'motion/react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { useShallow } from 'zustand/react/shallow'
import { useData } from '@/store/data'
import { displayName } from '@/store/selectors'
import { useSession } from '@/store/session'
import { Icon, IconButton, Tooltip } from '@/ui'
import { Eco } from '@/ui/eco/Eco'
import { BRAND_ECO } from '@/ui/eco/ecoRules'
import { BookmarkSimple, Check, ExternalLink, Headphones, ListPlus, Maximize2, Minimize, Pause, Play, SkipBack, SkipForward, Square, Volume2, VolumeX, X } from '@/ui/icons'
import { EASE_IN, EASE_OUT_QUART } from '@/ui/motion'
import { useCinema } from '../cinema/store'
import { useFloat } from './float'
import { Library, Mosaic } from './Library'
import { Player, type PlayerTime } from './Player'
import { apiErrorText, createPlaylist, readYoutubeList } from './playlists'
import { usePopout } from './popout'
import { addLink, addMany, closeCard, control, remove, serverTime, setCorner, setListening, setTab, setView, setVolume, useMusic } from './store'
import { t } from './strings'
import s from './music.module.css'


export const clock = (sec: number | null): string => {
  if (sec === null || !Number.isFinite(sec)) return '–:––'
  const v = Math.max(0, Math.floor(sec))
  const h = Math.floor(v / 3600)
  const m = Math.floor((v % 3600) / 60)
  const ss = String(v % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

export const cover = (videoId: string, q: 'default' | 'mqdefault' | 'hqdefault' = 'mqdefault') => `https://i.ytimg.com/vi/${videoId}/${q}.jpg`

/** Mounted once in the shell: shows while my call has music, or when I open it to paste the first link. */
export function MusicHost() {
  const now = useMusic((st) => !!st.state?.now)
  const open = useMusic((st) => st.open)
  const view = useMusic((st) => st.view)
  const listening = useMusic((st) => st.listening)
  const inCall = useData((st) => !!(st.me && st.voiceStates[st.me.id]))
  const shown = inCall && (open || now)
  const popped = shown && view === 'popout' && now && listening
  return createPortal(
    <>
      {popped && <PopoutKeeper />}
      <AnimatePresence>{shown && !popped && <Surface key="music" />}</AnimatePresence>
    </>,
    document.body,
  )
}

/** While the player lives in its own window, this window feeds it (and closes it when the music or the call ends). */
function PopoutKeeper() {
  usePopout()
  return null
}

function Surface() {
  const music = useMusic((st) => st.state)
  const listening = useMusic((st) => st.listening)
  const view = useMusic((st) => st.view)
  const corner = useMusic((st) => st.corner)
  const now = music?.now ?? null
  const mini = view === 'mini' && !!now && listening
  const ref = useRef<HTMLElement>(null)
  const float = useFloat(ref, mini ? corner : 'br')
  const drag = useDragControls()
  const [dragging, setDragging] = useState(false)
  const [time, setTime] = useState<PlayerTime>({ time: null, duration: null })
  const onTime = useCallback((p: PlayerTime) => setTime(p), [])
  // Seated in the cinema: the film has the sound; the music waits (for me only).
  const inCinema = useCinema((st) => !!st.session && st.mine.seated)
  const playing = !!music?.playback.playing

  // Grab the bar (not its buttons) to move the mini player.
  const grab = (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest('button, input')) return
    drag.start(e)
  }

  return (
    <motion.section
      ref={ref}
      className={`${s.card} ${mini ? s.mini : ''} ${dragging ? s.dragging : ''}`}
      style={{ x: float.x, y: float.y }}
      role="region"
      aria-label={t.card}
      drag={mini}
      dragControls={drag}
      dragListener={false}
      dragMomentum={false}
      dragElastic={0.04}
      onDragStart={() => {
        float.dragging.current = true
        setDragging(true)
      }}
      onDragEnd={() => {
        setDragging(false)
        setCorner(float.settle())
      }}
      // Panes slide in from the side: never let that scroll the card sideways.
      onScroll={(e) => {
        if (e.currentTarget.scrollLeft) e.currentTarget.scrollLeft = 0
      }}
      initial={{ opacity: 0, scale: 0.94, filter: 'blur(6px)' }}
      animate={{ opacity: 1, scale: dragging ? 1.025 : 1, filter: 'blur(0px)', transition: { duration: 0.32, ease: EASE_OUT_QUART } }}
      exit={{ opacity: 0, scale: 0.96, filter: 'blur(4px)', transition: { duration: 0.18, ease: EASE_IN } }}
    >
      <AnimatePresence initial={false}>
        {now && (
          <motion.img
            key={now.videoId}
            className={s.glow}
            src={cover(now.videoId)}
            alt=""
            aria-hidden
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.34, transition: { duration: 0.9 } }}
            exit={{ opacity: 0, transition: { duration: 0.9 } }}
          />
        )}
      </AnimatePresence>

      {!mini && <Head now={now} playing={playing} listening={listening} inCinema={inCinema} />}

      {/* Same place in the tree in every shape: the iframe never reloads between card and mini. */}
      {now && music && listening ? <Player key={music.channelId} music={music} play={!inCinema} onTime={onTime} hidden={mini} /> : null}

      {mini && music && now ? (
        <MiniBar music={music} now={now} time={time} onGrab={grab} onExpand={() => setView('card')} onPop={() => setView('popout')} />
      ) : (
        <CardBody music={music} now={now} time={time} listening={listening} inCinema={inCinema} />
      )}
    </motion.section>
  )
}

function Head({ now, playing, listening, inCinema }: { now: MusicTrack | null; playing: boolean; listening: boolean; inCinema: boolean }) {
  const popOk = !!window.alga?.musicPop
  return (
    <header className={s.head}>
      <span className={s.eco} aria-hidden>
        <Eco size={30} framing="avatar" state={now && playing && listening && !inCinema ? 'talking' : 'idle'} spec={{ ...BRAND_ECO, accessory: 'headset' }} />
      </span>
      <span className={s.headText}>
        <b>{t.card}</b>
        <span className={s.status}>
          {now && <Equalizer on={playing && listening && !inCinema} />}
          {now ? (playing ? t.nowPlaying : t.paused) : t.idle}
        </span>
      </span>
      {now && listening && <IconButton icon={Minimize} label={t.mini} size="sm" onClick={() => setView('mini')} />}
      {now && listening && popOk && <IconButton icon={ExternalLink} label={t.popOut} size="sm" onClick={() => setView('popout')} />}
      {now ? (
        listening && <IconButton icon={Headphones} label={t.stopListening} size="sm" onClick={() => setListening(false)} />
      ) : (
        <IconButton icon={X} label={t.close} size="sm" onClick={closeCard} />
      )}
    </header>
  )
}

/** Four bars that dance while the music plays here, and rest when it does not. */
export function Equalizer({ on }: { on: boolean }) {
  return (
    <span className={s.eq} data-on={on || undefined} aria-hidden>
      <i />
      <i />
      <i />
      <i />
    </span>
  )
}

function CardBody({ music, now, time, listening, inCinema }: { music: MusicState | null; now: MusicTrack | null; time: PlayerTime; listening: boolean; inCinema: boolean }) {
  const tab = useMusic((st) => st.tab)
  const library = useSession((st) => st.musicPlaylists)
  const shownTab = library ? tab : 'now'
  return (
    <>
      {now && music && listening && inCinema && <p className={s.note}>{t.inCinema}</p>}
      {now && music && !listening && (
        <div className={s.away}>
          <p className={s.note}>{t.notListening}</p>
          <button type="button" className={s.pill} onClick={() => setListening(true)}>{t.listenAgain}</button>
        </div>
      )}
      {now && music && listening && <NowPlaying music={music} now={now} time={time} />}
      {library && <Tabs tab={shownTab} />}
      <div className={s.panes}>
      <AnimatePresence mode="wait" initial={false}>
        {shownTab === 'now' ? (
          <motion.div key="now" className={s.pane} {...paneMotion(-1)}>
            {music && music.queue.length > 0 && <Queue music={music} />}
            {!now && (
              <div className={s.empty}>
                <span className="eco-alive" aria-hidden><Eco size={64} spec={{ ...BRAND_ECO, accessory: 'headset' }} state="listening" /></span>
                <p>{t.empty}</p>
              </div>
            )}
            <Field autoFocus={!now} />
            <LastLine music={music} />
          </motion.div>
        ) : (
          <motion.div key="lib" className={s.pane} {...paneMotion(1)}>
            <Library now={now} />
          </motion.div>
        )}
      </AnimatePresence>
      </div>
    </>
  )
}

const paneMotion = (dir: number) => ({
  initial: { opacity: 0, x: 18 * dir },
  animate: { opacity: 1, x: 0, transition: { duration: 0.24, ease: EASE_OUT_QUART } },
  exit: { opacity: 0, x: -12 * dir, transition: { duration: 0.12, ease: EASE_IN } },
})

function Tabs({ tab }: { tab: 'now' | 'playlists' }) {
  return (
    <div className={s.tabs} role="tablist" aria-label={t.card}>
      {(['now', 'playlists'] as const).map((k) => (
        <button key={k} type="button" role="tab" aria-selected={tab === k} className={s.tab} onClick={() => setTab(k)}>
          {tab === k && <motion.span layoutId="music-tab" className={s.tabPill} transition={{ type: 'spring', stiffness: 520, damping: 38 }} />}
          <span className={s.tabLabel}>{t.tabs[k]}</span>
        </button>
      ))}
    </div>
  )
}

/** Where the room's song is now, ticking twice a second (no React work in between). */
function useAt(music: MusicState, duration: number | null): number {
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 500)
    return () => clearInterval(id)
  }, [])
  return musicPosition(music.playback, serverTime(), duration)
}

function NowPlaying({ music, now, time }: { music: MusicState; now: MusicTrack; time: PlayerTime }) {
  const volume = useMusic((st) => st.volume)
  const adder = useData((st) => displayName(st, now.addedBy, null))
  const duration = now.durationS ?? time.duration
  const at = useAt(music, duration)
  const playing = music.playback.playing
  const lastVolume = useRef(volume || 0.5)
  if (volume > 0) lastVolume.current = volume
  return (
    <div className={s.now}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={now.id}
          className={s.titles}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0, transition: { duration: 0.32, ease: EASE_OUT_QUART } }}
          exit={{ opacity: 0, y: -6, transition: { duration: 0.14 } }}
        >
          <Marquee className={s.title} text={now.title} />
          <div className={s.meta}>{[now.author, t.addedBy(adder)].filter(Boolean).join(' · ')}</div>
        </motion.div>
      </AnimatePresence>
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
        {music.previous !== undefined && (
          <Tooltip content={t.previous}>
            <motion.button type="button" className={s.ctl} aria-label={t.previous} whileTap={{ scale: 0.86, x: -3 }} onClick={() => control('previous')}>
              <Icon icon={SkipBack} size={18} filled />
            </motion.button>
          </Tooltip>
        )}
        <Tooltip content={playing ? t.pause : t.play}>
          <motion.button
            type="button" className={`${s.ctl} ${s.main}`} aria-label={playing ? t.pause : t.play}
            whileTap={{ scale: 0.88 }} transition={{ type: 'spring', stiffness: 600, damping: 22 }}
            onClick={() => control(playing ? 'pause' : 'play')}
          >
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span key={playing ? 'pause' : 'play'} className={s.glyph} initial={{ scale: 0.4, rotate: -40, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }} exit={{ scale: 0.4, rotate: 40, opacity: 0 }} transition={{ type: 'spring', stiffness: 640, damping: 30 }}>
                <Icon icon={playing ? Pause : Play} size={18} filled />
              </motion.span>
            </AnimatePresence>
          </motion.button>
        </Tooltip>
        <Tooltip content={t.skip}>
          <motion.button type="button" className={s.ctl} aria-label={t.skip} whileTap={{ scale: 0.86, x: 3 }} onClick={() => control('skip')}>
            <Icon icon={SkipForward} size={18} filled />
          </motion.button>
        </Tooltip>
        <Tooltip content={t.stop}>
          <button type="button" className={s.ctl} aria-label={t.stop} onClick={() => control('stop')}>
            <Icon icon={Square} size={16} />
          </button>
        </Tooltip>
        <span className={s.grow} />
        <button type="button" className={s.ctl} aria-label={t.volume} onClick={() => setVolume(volume ? 0 : lastVolume.current)}>
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

/** Text that scrolls gently back and forth when it does not fit; still when it does or when motion is reduced. */
export function Marquee({ text, className }: { text: string; className?: string }) {
  const box = useRef<HTMLDivElement>(null)
  const [shift, setShift] = useState(0)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const measure = () => setShift(Math.max(0, el.scrollWidth - el.clientWidth))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [text])
  return (
    <div ref={box} className={`${className ?? ''} ${s.marquee}`} title={text}>
      <span className={shift > 0 ? s.marqueeOn : undefined} style={{ '--shift': `-${shift}px`, '--dur': `${Math.max(6, shift / 18)}s` } as CSSProperties}>
        {text}
      </span>
    </div>
  )
}

const QUEUE_SHOWN = 5

function Queue({ music }: { music: MusicState }) {
  const queue = music.queue
  const [all, setAll] = useState(false)
  const library = useSession((st) => st.musicPlaylists)
  const shown = all ? queue : queue.slice(0, QUEUE_SHOWN)
  return (
    <div className={s.queue}>
      <div className={s.queueHead}>
        <span>{t.next(queue.length)}</span>
        <span className={s.grow} />
        {library && <SaveQueue music={music} />}
      </div>
      <ol className={all ? s.queueAll : undefined}>
        <AnimatePresence initial={false}>
          {shown.map((q, i) => (
            <motion.li
              key={q.id}
              layout
              initial={{ opacity: 0, x: -8, height: 0 }}
              animate={{ opacity: 1, x: 0, height: 38, transition: { duration: 0.24, ease: EASE_OUT_QUART, delay: Math.min(i, 8) * 0.02 } }}
              exit={{ opacity: 0, height: 0, transition: { duration: 0.16 } }}
            >
              <span className={s.num}>{i + 1}</span>
              <img className={s.thumb} src={cover(q.videoId, 'default')} alt="" loading="lazy" />
              <span className={s.qtitle} title={q.title}>{q.title}</span>
              <IconButton icon={X} label={t.remove(q.title)} size="sm" onClick={() => remove(q.id)} />
            </motion.li>
          ))}
        </AnimatePresence>
      </ol>
      {queue.length > QUEUE_SHOWN && (
        <button type="button" className={s.more} onClick={() => setAll(!all)}>{all ? t.back : t.more(queue.length - QUEUE_SHOWN)}</button>
      )}
    </div>
  )
}

/** The call's song and queue, kept as one of my playlists. */
function SaveQueue({ music }: { music: MusicState }) {
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const save = async () => {
    const ids = [music.now?.videoId, ...music.queue.map((q) => q.videoId)].filter((x): x is string => !!x)
    if (!name.trim() || !ids.length || busy) return
    setBusy(true)
    try {
      const p = await createPlaylist({ name: name.trim(), videoIds: ids })
      setNaming(false)
      setName('')
      setNote(t.saved(p.name))
      setTimeout(() => setNote(null), 2600)
    } catch (e) {
      setNote(apiErrorText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      {naming ? (
        <motion.span key="name" className={s.inline} initial={{ opacity: 0, width: 0 }} animate={{ opacity: 1, width: 'auto' }} exit={{ opacity: 0, width: 0 }}>
          <input
            className={s.inlineInput} autoFocus value={name} maxLength={80} placeholder={t.saveQueueName} aria-label={t.saveQueueName}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save()
              if (e.key === 'Escape') setNaming(false)
            }}
          />
          <IconButton icon={Check} label={t.save} size="sm" onClick={() => void save()} disabled={busy || !name.trim()} />
        </motion.span>
      ) : note ? (
        <motion.span key="note" className={s.savedNote} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>{note}</motion.span>
      ) : (
        <motion.span key="btn" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <IconButton icon={BookmarkSimple} label={t.saveQueue} size="sm" onClick={() => setNaming(true)} />
        </motion.span>
      )}
    </AnimatePresence>
  )
}

interface PendingList { listId: string; videoId: string | null; ids: string[] | null; error: string | null; saved: string | null }

function Field({ autoFocus }: { autoFocus: boolean }) {
  const [text, setText] = useState('')
  const [list, setList] = useState<PendingList | null>(null)
  const error = useMusic((st) => st.error)
  const library = useSession((st) => st.musicPlaylists)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (autoFocus) ref.current?.focus()
  }, [autoFocus])

  const submit = (value: string) => {
    if (!value.trim()) return
    const listId = library ? youtubeListId(value) : null
    if (listId) {
      setText('')
      setList({ listId, videoId: youtubeId(value), ids: null, error: null, saved: null })
      readYoutubeList(listId).then(
        (ids) => setList((l) => (l?.listId === listId ? { ...l, ids } : l)),
        (e: Error) => setList((l) => (l?.listId === listId ? { ...l, error: e.message } : l)),
      )
      return
    }
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
    if (!text && (youtubeId(pasted) || youtubeListId(pasted))) {
      e.preventDefault()
      submit(pasted)
    }
  }
  return (
    <div className={s.field}>
      <AnimatePresence>{list && <LinkChip list={list} setList={setList} />}</AnimatePresence>
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

/** A pasted playlist link: what it holds, and what to do with it. */
function LinkChip({ list, setList }: { list: PendingList; setList: (l: PendingList | null) => void }) {
  const [busy, setBusy] = useState(false)
  const go = (replace: boolean) => {
    if (!list.ids) return
    addMany(list.ids, replace, t.linkPlaylist, list.listId)
    setList(null)
  }
  const save = async () => {
    if (!list.ids || busy) return
    setBusy(true)
    try {
      const p = await createPlaylist({ videoIds: list.ids, listId: list.listId })
      setList({ ...list, saved: p.name })
      setTimeout(() => setList(null), 2200)
    } catch (e) {
      setList({ ...list, error: apiErrorText(e) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <motion.div
      className={s.chip}
      layout
      initial={{ opacity: 0, y: 10, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1, transition: { type: 'spring', stiffness: 420, damping: 32 } }}
      exit={{ opacity: 0, y: 6, scale: 0.98, transition: { duration: 0.14 } }}
    >
      <Mosaic ids={list.ids ?? []} size={52} loading={!list.ids && !list.error} />
      <div className={s.chipText}>
        <b>{t.linkPlaylist}</b>
        <span className={list.error ? s.chipError : undefined}>{list.error ?? (list.saved ? t.saved(list.saved) : list.ids ? t.songs(list.ids.length) : t.reading)}</span>
        {list.ids && !list.saved && !list.error && (
          <div className={s.chipActions}>
            <button type="button" className={s.pill} onClick={() => go(true)}><Icon icon={Play} size={14} filled /> {t.playNow}</button>
            <button type="button" className={s.ghost} onClick={() => go(false)}><Icon icon={ListPlus} size={14} /> {t.addToQueue}</button>
            <button type="button" className={s.ghost} onClick={() => void save()} disabled={busy}><Icon icon={BookmarkSimple} size={14} /> {t.save}</button>
          </div>
        )}
        {list.videoId && !list.saved && (
          <button type="button" className={s.link} onClick={() => (addLink(`https://youtu.be/${list.videoId}`), setList(null))}>{t.onlyThisSong}</button>
        )}
      </div>
      <IconButton icon={X} label={t.cancel} size="sm" onClick={() => setList(null)} />
    </motion.div>
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
  const text = l.kind === 'playlist' ? t.lastPlaylist(name, title, l.count ?? 0) : l.kind === 'previous' ? t.lastPrevious(name)
    : l.kind === 'add' ? t.last.add(name, title) : l.kind === 'skip' ? t.last.skip(name, title) : l.kind === 'remove' ? t.last.remove(name, title)
    : l.kind === 'unplayable' ? t.last.unplayable(title) : l.kind === 'play' ? t.last.play(name) : l.kind === 'pause' ? t.last.pause(name)
    : l.kind === 'seek' ? t.last.seek(name) : t.last.stop(name)
  return <p key={`${music!.playback.seq}-${l.kind}`} className={s.last} aria-live="polite">{text}</p>
}

type LineAction = 'play' | 'pause' | 'skip' | 'previous'

/**
 * The mini player: one slim line, sound only. The cover breathes while it plays, the title glides, a hair of progress
 * runs along the bottom; voltar, tocar/pausar, avançar and the volume (hover it for the slider, or scroll anywhere on the
 * line). Back to the card and out to its own window show on hover. Shared by the app and the floating window
 * (`floating`: "back" returns the player to Alga). Grab the line to move it.
 */
export function MiniBar(p: {
  music: MusicState
  now: MusicTrack
  time: PlayerTime
  onGrab?: (e: PointerEvent) => void
  onExpand: () => void
  onPop?: () => void
  floating?: boolean
  onControl?: (action: LineAction) => void
  onVolume?: (v: number) => void
}) {
  const playing = p.music.playback.playing
  const duration = p.now.durationS ?? p.time.duration
  const at = useAt(p.music, duration)
  const act = p.onControl ?? ((a: LineAction) => control(a))
  const volume = useMusic((st) => st.volume)
  const setVol = p.onVolume ?? setVolume
  const lastVolume = useRef(volume || 0.5)
  if (volume > 0) lastVolume.current = volume
  const canPrev = p.music.previous !== undefined
  return (
    <div
      className={s.line}
      onPointerDown={p.onGrab}
      title={p.floating ? undefined : t.dragHint}
      onWheel={(e) => setVol(Math.min(1, Math.max(0, volume - Math.sign(e.deltaY) * 0.05)))}
    >
      <span className={s.lineCover} data-on={playing || undefined}>
        <AnimatePresence initial={false}>
          <motion.img
            key={p.now.videoId}
            src={cover(p.now.videoId, 'mqdefault')}
            alt=""
            initial={{ opacity: 0, scale: 1.3 }}
            animate={{ opacity: 1, scale: 1, transition: { duration: 0.5, ease: EASE_OUT_QUART } }}
            exit={{ opacity: 0, transition: { duration: 0.3 } }}
          />
        </AnimatePresence>
        <Equalizer on={playing} />
      </span>
      <div className={s.lineText}>
        <Marquee className={s.lineTitle} text={p.now.title} />
        {p.now.author && <div className={s.lineMeta}>{p.now.author}</div>}
      </div>
      <div className={s.lineCtl}>
        {canPrev && (
          <motion.button type="button" className={s.lineBtn} aria-label={t.previous} whileTap={{ scale: 0.82, x: -2 }} onClick={() => act('previous')}>
            <Icon icon={SkipBack} size={14} filled />
          </motion.button>
        )}
        <motion.button type="button" className={`${s.lineBtn} ${s.lineMain}`} aria-label={playing ? t.pause : t.play} whileTap={{ scale: 0.84 }} onClick={() => act(playing ? 'pause' : 'play')}>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span key={playing ? 'pause' : 'play'} className={s.glyph} initial={{ scale: 0.3, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.3, opacity: 0 }} transition={{ type: 'spring', stiffness: 700, damping: 30 }}>
              <Icon icon={playing ? Pause : Play} size={14} filled />
            </motion.span>
          </AnimatePresence>
        </motion.button>
        <motion.button type="button" className={s.lineBtn} aria-label={t.skip} whileTap={{ scale: 0.82, x: 2 }} onClick={() => act('skip')}>
          <Icon icon={SkipForward} size={14} filled />
        </motion.button>
        <span className={s.lineVol}>
          <button type="button" className={s.lineBtn} aria-label={t.volume} onClick={() => setVol(volume ? 0 : lastVolume.current)}>
            <Icon icon={volume ? Volume2 : VolumeX} size={14} />
          </button>
          <input
            type="range" className={s.lineSlider} min={0} max={1} step={0.01} value={volume} aria-label={t.volume}
            style={{ '--v': `${volume * 100}%` } as CSSProperties}
            onChange={(e) => setVol(Number(e.target.value))}
          />
        </span>
      </div>
      <div className={s.lineMore}>
        <IconButton icon={Maximize2} label={p.floating ? t.popIn : t.expandCard} size="sm" onClick={p.onExpand} />
        {p.onPop && <IconButton icon={ExternalLink} label={t.popOut} size="sm" onClick={p.onPop} />}
      </div>
      <span className={s.lineProgress} style={{ '--v': duration ? `${(Math.min(at, duration) / duration) * 100}%` : '0%' } as CSSProperties} aria-hidden />
    </div>
  )
}

