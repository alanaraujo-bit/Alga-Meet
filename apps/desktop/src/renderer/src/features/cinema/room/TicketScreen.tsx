// The end of a session I sat in (spec §7.3.10, mockup 11): the lights come up over ~3 s, then the ticket stub — cover,
// title, date, the row of seats, time together, reactions, the most reacted moment — with Copiar imagem / Salvar
// (main captures the card's rect; the path of a save never comes back). Over the whole app, like the room.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useShallow } from 'zustand/react/shallow'
import { useMedia } from '@/media'
import { useData } from '@/store/data'
import { displayName } from '@/store/selectors'
import { Avatar, Button, Icon, toast, VoiceDot } from '@/ui'
import { ArrowLeft, Copy, Download, Smile } from '@/ui/icons'
import { LogoMark } from '../../app/Logo'
import { openCall } from '../../voice/voice'
import { useCinema, type CinemaState } from '../store'
import { t } from '../strings'
import { useArt } from './art'
import { Cover, FilmTitle } from './CallCard'
import { reducedMotion } from './prefs'
import { firstName } from './seats'
import { thumbTile } from './thumbs'
import { hourMin, nameList, peakEmoji, ticketDate, ticketFacts, ticketNumber } from './ticket'
import s from './ticket.module.css'

/** The lights take this long to come up before the stub shows (spec §7.1 "rising"). */
const RISE_MS = 3_000
const W = 960
const PEAK_W = 220
const PEAK_H = 92

type Ended = NonNullable<CinemaState['ended']>

export function TicketScreen({ ended }: { ended: Ended }) {
  const [risen, setRisen] = useState(reducedMotion)
  const [scale, setScale] = useState(1)
  const card = useRef<HTMLDivElement>(null)
  const art = useArt(useShallow((st) => ({ poster: st.poster, thumbs: st.thumbs, emojis: st.emojis })))
  const channel = useData((st) => st.channels[ended.channelId])
  const space = useData((st) => (channel?.spaceId ? st.spaces[channel.spaceId] : undefined))
  const names = useData(useShallow((st) => ended.summary.seats.map((id) => firstName(displayName(st, id, channel?.spaceId ?? null)))))
  const users = useData(useShallow((st) => ended.summary.seats.map((id) => st.users[id] ?? { id, displayName: '', avatarUrl: null })))
  const inCall = useMedia((st) => st.connection.channelId === ended.channelId && (st.connection.state === 'connected' || st.connection.state === 'reconnecting'))
  const f = ticketFacts(ended.summary, ended.film)
  const emoji = f.peak ? peakEmoji(art.emojis, f.peak.position) : null

  useEffect(() => {
    if (risen) return
    const id = setTimeout(() => setRisen(true), RISE_MS)
    return () => clearTimeout(id)
  }, [risen])
  // The stub is 960 px wide: narrower windows scale it down whole (it is one picture).
  useLayoutEffect(() => {
    const fit = () => setScale(Math.min(1, (window.innerWidth - 48) / W))
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])

  const close = () => {
    useCinema.setState({ ended: null })
    if (channel) openCall(channel.id)
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const capture = async (action: 'copy' | 'save') => {
    const el = card.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const rect = { x: Math.max(0, Math.floor(r.left)), y: Math.max(0, Math.floor(r.top)), width: Math.ceil(r.width), height: Math.ceil(r.height) }
    try {
      const done = await window.alga.cinema.captureCard(rect, action)
      if (done) toast.success(action === 'copy' ? t.ticket.copied : t.ticket.saved)
    } catch {
      toast.error(t.ticket.failed)
    }
  }

  const tile = f.peak && ended.film && art.thumbs ? thumbTile(f.peak.position, ended.film) : null
  const k = tile ? PEAK_W / tile.w : 1
  return createPortal(
    <div className={s.screen} data-risen={risen} role="dialog" aria-modal="true" aria-label={t.ticket.label(ended.title)}>
      <div className={s.backdrop} aria-hidden>
        <Cover url={art.poster} className={s.backdropImg} />
      </div>
      <div className={s.shade} aria-hidden />
      <div className={s.dark} aria-hidden />
      <div className={s.drag} aria-hidden />
      <div className={s.content} aria-hidden={!risen || undefined}>
        <button type="button" className={s.back} onClick={close} disabled={!risen}>
          <Icon icon={ArrowLeft} size={20} />
          <span>{t.ticket.back}</span>
        </button>
        <div className={s.center}>
          <div className={s.head}>
            <div className={s.overline}>{t.ticket.overline}</div>
            <div className={s.lights}>{t.ticket.lightsAt(hourMin(ended.at))}</div>
          </div>
          <div className={s.fit} style={{ width: W * scale, height: 312 * scale }}>
            <div ref={card} className={s.ticket} style={{ transform: `scale(${scale})` }}>
              <div className={s.cut}>
                <div className={s.cover}><Cover url={art.poster} /></div>
                <div className={s.coverFade} />
                <div className={s.stubBg} />
                <div className={s.perf} />
                <div className={s.main}>
                  <div className={s.overline}>{t.ticket.brand}</div>
                  <FilmTitle title={ended.title} className={s.title} />
                  <div className={s.date}>{ticketDate(ended.createdAt ?? ended.at)}</div>
                  <div className={s.grid}>
                    <div>
                      <div className={s.label}>{t.ticket.row}</div>
                      <div className={s.stack}>
                        {users.slice(0, 8).map((u) => (
                          <span key={u.id} className={s.stackFace}><Avatar user={u} size={28} decorative /></span>
                        ))}
                      </div>
                      <div className={s.names} dir="auto">{nameList(names)}</div>
                      <div className={s.stats}>
                        <div><div className={s.num}>{f.together}</div><div className={s.label}>{t.ticket.together}</div></div>
                        <div><div className={s.num}>{f.reactions}</div><div className={s.label}>{t.ticket.reactions(f.reactions)}</div></div>
                      </div>
                    </div>
                    <div>
                      <div className={s.label}>{t.ticket.peak}</div>
                      {f.peak ? (
                        <>
                          <div className={s.peak}>
                            {tile && art.thumbs ? (
                              <div
                                className={s.peakImg}
                                style={{
                                  backgroundImage: `url(${art.thumbs})`,
                                  backgroundSize: `${tile.sheetW * k}px ${tile.sheetH * k}px`,
                                  backgroundPosition: `${-tile.x * k}px ${-(tile.y * k + (tile.h * k - PEAK_H) / 2)}px`,
                                }}
                              />
                            ) : (
                              <Cover url={art.poster} />
                            )}
                            <span className={s.badge}>
                              {emoji ? <span aria-hidden>{emoji}</span> : <Icon icon={Smile} size={12} />}
                              {f.peak.count}
                            </span>
                          </div>
                          <div className={s.peakAt}>
                            <b>{f.peak.at}</b>
                            {f.peak.chapter && <span dir="auto"> · {f.peak.chapter}</span>}
                          </div>
                        </>
                      ) : (
                        <div className={s.noPeak}>{t.ticket.noPeak}</div>
                      )}
                    </div>
                  </div>
                </div>
                <div className={s.stub}>
                  <div className={s.overline}>{t.ticket.admits}</div>
                  <div className={s.admits}>{f.admits}</div>
                  <div className={s.label}>{t.ticket.seats(f.admits)}</div>
                  <div className={s.rule} />
                  {channel && <div className={s.channel} dir="auto">{channel.name}</div>}
                  {space && <div className={s.space} dir="auto">{space.name}</div>}
                  <div className={s.serial}><LogoMark size={16} /><span>{ticketNumber(ended.sessionId)}</span></div>
                </div>
              </div>
            </div>
          </div>
          <div className={s.actions}>
            <Button variant="primary" size="lg" icon={Copy} onClick={() => void capture('copy')} disabled={!risen}>{t.ticket.copy}</Button>
            <Button variant="secondary" size="lg" icon={Download} onClick={() => void capture('save')} disabled={!risen}>{t.ticket.save}</Button>
          </div>
          <div className={s.hint}>{t.ticket.hint}</div>
        </div>
        {inCall && channel && (
          <div className={s.goesOn}>
            <VoiceDot />
            {t.ticket.callGoesOn} <b dir="auto">{channel.name}</b>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
