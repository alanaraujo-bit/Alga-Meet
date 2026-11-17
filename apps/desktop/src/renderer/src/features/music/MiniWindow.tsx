// The floating player's own page (#music-mini, main/music-window.ts): YouTube's player and the mini bar, nothing else.
// It holds no session: the main window sends what the room plays (popout.ts) and gets back what this one does.
import '@/styles/base.css'
import { motion } from 'motion/react'
import { useCallback, useEffect, useState } from 'react'
import { MiniBar } from './MusicCard'
import { Player, type PlayerTime } from './Player'
import type { PopCommand, PopSnapshot } from './popout'
import { useMusic } from './store'
import s from './music.module.css'

const send = (c: PopCommand) => window.alga?.musicPop.command(JSON.stringify(c))

export function MiniWindow() {
  const [snap, setSnap] = useState<PopSnapshot | null>(null)
  const [time, setTime] = useState<PlayerTime>({ time: null, duration: null })
  const onTime = useCallback((p: PlayerTime) => setTime(p), [])

  useEffect(() => {
    // A see-through window: only the rounded player shows.
    document.documentElement.style.background = 'transparent'
    document.body.style.background = 'transparent'
    document.title = 'Música · Alga Meet'
    const off = window.alga?.musicPop.onState((raw) => {
      try {
        const sn = JSON.parse(raw) as PopSnapshot
        // The player reads the clock offset and the volume from the store, like in the main window.
        useMusic.setState({ state: sn.state, offset: sn.offset, volume: sn.volume })
        setSnap(sn)
      } catch {}
    })
    send({ kind: 'hello' })
    return off
  }, [])

  const music = snap?.state ?? null
  const now = music?.now ?? null
  // Nothing more to play here (the call stopped the music): back home, the main window closes this one.
  useEffect(() => {
    if (snap && !now) send({ kind: 'popIn' })
  }, [snap, now])

  if (!music || !now) return <div className={s.popWait} />
  return (
    <motion.section
      className={`${s.card} ${s.mini} ${s.popWindow}`}
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1, transition: { type: 'spring', stiffness: 380, damping: 30 } }}
    >
      <Player
        key={music.channelId}
        music={music}
        play={snap!.play}
        onTime={onTime}
        hidden
        onReport={(report, durationS) => send({ kind: 'report', trackId: now.id, report, ...(durationS !== undefined && { durationS }) })}
      />
      <MiniBar
        music={music}
        now={now}
        time={time}
        floating
        onExpand={() => send({ kind: 'popIn' })}
        onControl={(action) => send({ kind: 'control', action })}
        onVolume={(volume) => {
          useMusic.setState({ volume })
          send({ kind: 'volume', volume })
        }}
      />
    </motion.section>
  )
}
