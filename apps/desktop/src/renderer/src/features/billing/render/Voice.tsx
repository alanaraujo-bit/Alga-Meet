import { useCallback, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { reducedMotion, run, useOneShot, useReducedMotion, useSpeak, type Motion } from '../engine'
import { HA, HORA_AZUL, type CosmeticId } from '../hora-azul'
import { contentRect } from './geometry'
import s from './voice.module.css'

/*
 * What others see of you in a call: voice auras (HA-16…19), call reactions (HA-23) and stream frames (HA-24, 25).
 * Auras replace the default 2 px speaking ring and keep its job: ≥ 2 px, ≥ 3:1 on the tile, the same envelope
 * (`--speak` from useEnvelope on the nearest [data-speak-host]), nothing in silence, inner ring only at 40 px.
 */

const NOOP = () => undefined

/*
 * Rings are static SVG painted once inside an element that only changes opacity/transform (no CSS mask: a masked
 * layer whose opacity rides the voice was the costliest thing on the stage).
 */

/** HA-16 Respiro: the inner ring rides the voice, a lilac ring 5 px out breathes with it. Pure CSS on --speak. */
function Respiro({ small }: { small: boolean }) {
  const ref = useRef<HTMLSpanElement>(null)
  const g = useId()
  useSpeak(ref, NOOP) // frame-time watch for the automatic fallback; draws nothing itself
  return (
    <span ref={ref} className={s.aura} aria-hidden data-cosmetic="aura_ha_respiro">
      {!small && (
        <span className={s.respiroOut}>
          <svg className={s.ringArt} viewBox="-50 -50 100 100">
            {/* Brightest at 11 h, the light of the whole collection. */}
            <linearGradient id={g} x1="0.12" y1="0.05" x2="0.88" y2="0.95">
              <stop offset="0" stopColor={HA.lilac} />
              <stop offset="0.5" stopColor={HA.lilac} stopOpacity="0.42" />
              <stop offset="1" stopColor={HA.indigoLight} stopOpacity="0.3" />
            </linearGradient>
            <circle r="49.3" fill="none" stroke={`url(#${g})`} strokeWidth="1" vectorEffect="non-scaling-stroke" />
          </svg>
        </span>
      )}
      <span className={s.inner} />
    </span>
  )
}

/** The prism's colors around the ring, clockwise from 12 h (a conic gradient drawn as four arcs). */
const PRISM: [string, number][] = [
  [HA.indigo, 1],
  [HA.lilac, 1],
  [HA.porcelain, 0.7],
  [HA.indigoLight, 1],
]

/** HA-17 Prisma: the voice turns the prism (+90°/s × speak), still in silence. */
function Prisma({ size }: { size: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  const ring = useRef<SVGSVGElement>(null)
  const g = useId()
  const reduced = useReducedMotion()
  const angle = useRef(0)
  const turn = useCallback((speak: number, dt: number) => {
    if (speak <= 0 || !ring.current) return
    angle.current = (angle.current + (90 * speak * dt) / 1000) % 360
    ring.current.style.transform = `rotate(${angle.current.toFixed(1)}deg)`
  }, [])
  useSpeak(ref, reduced ? NOOP : turn)
  // The box is the avatar + 2 px each side; the 2 px ring sits on the avatar's edge, outside it.
  const r = ((size / 2 + 1) * 100) / (size + 4)
  const p = (deg: number) => [r * Math.cos((deg * Math.PI) / 180), r * Math.sin((deg * Math.PI) / 180)].map((v) => v.toFixed(2))
  return (
    <span ref={ref} className={s.aura} aria-hidden data-cosmetic="aura_ha_prisma">
      <span className={s.prisma}>
        <svg ref={ring} className={`${s.ringArt} ${s.turning}`} viewBox="-50 -50 100 100">
          {PRISM.map(([c, o], i) => {
            const [x1, y1] = p(-90 + i * 90)
            const [x2, y2] = p(i * 90)
            const [c2, o2] = PRISM[(i + 1) % 4]!
            return (
              <g key={i}>
                <linearGradient id={`${g}${i}`} gradientUnits="userSpaceOnUse" x1={x1} y1={y1} x2={x2} y2={y2}>
                  <stop offset="0" stopColor={c} stopOpacity={o} />
                  <stop offset="1" stopColor={c2} stopOpacity={o2} />
                </linearGradient>
                <path d={`M${x1} ${y1}A${r} ${r} 0 0 1 ${x2} ${y2}`} fill="none" stroke={`url(#${g}${i})`} strokeWidth="2" vectorEffect="non-scaling-stroke" />
              </g>
            )
          })}
        </svg>
      </span>
    </span>
  )
}

/** HA-18 Ondas: each rise of the voice past 0.35 (≤ 1 per 180 ms) sends a ring out; pool of 3. */
function Ondas({ small }: { small: boolean }) {
  const ref = useRef<HTMLSpanElement>(null)
  const pool = useRef<(HTMLSpanElement | null)[]>([])
  const reduced = useReducedMotion()
  const st = useRef({ prev: 0, last: 0, next: 0 })
  const wave = useCallback((speak: number) => {
    const w = st.current
    const now = performance.now()
    if (w.prev < 0.35 && speak >= 0.35 && now - w.last >= 180) {
      w.last = now
      const el = pool.current[w.next++ % 3]
      el?.animate([{ transform: 'scale(1)', opacity: 0.6 }, { transform: 'scale(1.25)', opacity: 0 }], { duration: 600, easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)' })
    }
    w.prev = speak
  }, [])
  useSpeak(ref, reduced || small ? NOOP : wave)
  return (
    <span ref={ref} className={s.aura} aria-hidden data-cosmetic="aura_ha_ondas">
      {!small && !reduced && [0, 1, 2].map((i) => <span key={i} ref={(el) => void (pool.current[i] = el)} className={s.wave} />)}
      <span className={s.inner} />
    </span>
  )
}

/**
 * The aura drawn on an avatar of `size` (a sibling layer inside the avatar's box). HA-19 Frondes keeps the default
 * ring here; its sign is the glyph on the name pill (AuraGlyph).
 */
export function VoiceAura({ id, size }: { id: CosmeticId; size: number }) {
  const small = size <= 40
  if (id === 'aura_ha_respiro') return <Respiro small={small} />
  if (id === 'aura_ha_prisma') return small ? <Respiro small /> : <Prisma size={size} />
  if (id === 'aura_ha_ondas') return <Ondas small={small} />
  return null
}
/** Auras that replace the avatar's default ring (HA-19 adds to it instead). */
export const replacesRing = (id: CosmeticId | undefined) => id === 'aura_ha_respiro' || id === 'aura_ha_prisma' || id === 'aura_ha_ondas'

/** HA-19 Frondes: the brand's three fronds (white into #9a9df9) on the name pill, following the voice. */
export function AuraGlyph({ id }: { id?: CosmeticId }) {
  if (id !== 'aura_ha_frondes') return null
  return (
    <span className={s.fronds} aria-hidden data-cosmetic="aura_ha_frondes">
      <i />
      <i />
      <i />
    </span>
  )
}

// ── HA-23 Reações Hora Azul ──────────────────────────────────

export const EMOTES = ['heart', 'laugh', 'clap', 'boa', 'eyes', 'fire', 'star', 'tears'] as const
export type Emote = (typeof EMOTES)[number]
export const EMOTE_LABEL: Record<Emote, string> = {
  heart: 'Coração de vidro',
  laugh: 'Risada',
  clap: 'Palmas',
  boa: 'Boa!',
  eyes: 'Olhos',
  fire: 'Fogo frio',
  star: 'Estrela',
  tears: 'Chorei de rir',
}

/** One reaction, 64 px SVG, glass and light from 11 h. */
export function ReactionGlyph({ emote, size = 64 }: { emote: Emote; size?: number }) {
  const g = useId()
  const glass = (
    <linearGradient id={`${g}glass`} x1="0.2" y1="0" x2="0.8" y2="1">
      <stop offset="0" stopColor={HA.lilac} />
      <stop offset="0.55" stopColor={HA.indigoLight} />
      <stop offset="1" stopColor={HA.indigo} />
    </linearGradient>
  )
  const rim = { fill: 'none', stroke: HA.porcelain, strokeOpacity: 0.45, strokeWidth: 1.25 }
  const spec = { fill: 'none', stroke: HA.porcelain, strokeOpacity: 0.75, strokeWidth: 2.5, strokeLinecap: 'round' as const }
  const sparkle = (x: number, y: number, r: number) => `M${x} ${y - r}Q${x} ${y} ${x + r} ${y}Q${x} ${y} ${x} ${y + r}Q${x} ${y} ${x - r} ${y}Q${x} ${y} ${x} ${y - r}Z`
  const body = {
    heart: (
      <>
        <path d="M32 53C13 41 7 29 10.5 20C14 11 26 10 32 19C38 10 50 11 53.5 20C57 29 51 41 32 53Z" fill={`url(#${g}glass)`} fillOpacity="0.92" />
        <path d="M32 53C13 41 7 29 10.5 20C14 11 26 10 32 19C38 10 50 11 53.5 20C57 29 51 41 32 53Z" {...rim} />
        <path d="M16.5 22C17.5 17.5 21.5 15.5 25 16.5" {...spec} />
      </>
    ),
    laugh: (
      <>
        {[[21, 43, 11], [39, 30, 8.5], [50, 15, 6]].map(([x, y, r], i) => (
          <g key={i}>
            <circle cx={x} cy={y} r={r} fill={HA.indigoLight} fillOpacity={0.28 + i * 0.08} />
            <circle cx={x} cy={y} r={r} fill="none" stroke={HA.lilac} strokeOpacity="0.85" strokeWidth="1.5" />
            <path d={`M${x! - r! * 0.55} ${y! - r! * 0.2}A${r! * 0.6} ${r! * 0.6} 0 0 1 ${x! - r! * 0.1} ${y! - r! * 0.62}`} {...spec} strokeWidth={1.8} />
          </g>
        ))}
      </>
    ),
    clap: (
      <>
        <rect x="14" y="24" width="14" height="30" rx="7" transform="rotate(-20 21 39)" fill={`url(#${g}glass)`} />
        <rect x="36" y="24" width="14" height="30" rx="7" transform="rotate(20 43 39)" fill={`url(#${g}glass)`} fillOpacity="0.85" />
        <rect x="14" y="24" width="14" height="30" rx="7" transform="rotate(-20 21 39)" {...rim} />
        <path d={sparkle(22, 12, 6)} fill={HA.porcelain} />
        <path d={sparkle(43, 9, 4.5)} fill={HA.lilac} />
      </>
    ),
    boa: (
      <>
        <path d="M14 14H50A10 10 0 0 1 60 24V36A10 10 0 0 1 50 46H26L17 54V46H14A10 10 0 0 1 4 36V24A10 10 0 0 1 14 14Z" fill={HA.deep} fillOpacity="0.95" />
        <path d="M14 14H50A10 10 0 0 1 60 24V36A10 10 0 0 1 50 46H26L17 54V46H14A10 10 0 0 1 4 36V24A10 10 0 0 1 14 14Z" fill="none" stroke={HA.indigoLight} strokeOpacity="0.7" strokeWidth="1.25" />
        <text x="32" y="36.5" textAnchor="middle" fill={HA.porcelain} style={{ font: '590 17px/1 "Inter Variable", Inter, sans-serif', fontVariationSettings: "'opsz' 32", letterSpacing: '-0.02em' }}>
          Boa!
        </text>
      </>
    ),
    eyes: (
      <>
        {[20, 44].map((x) => (
          <g key={x}>
            <ellipse cx={x} cy="32" rx="10" ry="14" fill={HA.porcelain} />
            <ellipse cx={x} cy="32" rx="10" ry="14" fill="none" stroke={HA.silver} strokeWidth="1" />
            <circle cx={x - 3.5} cy="27" r="5.5" fill={HA.ink} />
            <circle cx={x - 5} cy="25.2" r="1.6" fill={HA.porcelain} />
          </g>
        ))}
      </>
    ),
    fire: (
      <>
        <defs>
          <linearGradient id={`${g}flame`} x1="0.5" y1="1" x2="0.5" y2="0">
            <stop offset="0" stopColor={HA.deep} />
            <stop offset="0.45" stopColor={HA.indigo} />
            <stop offset="1" stopColor={HA.lilac} />
          </linearGradient>
        </defs>
        <path d="M32 57C18 57 12 47 14 37C16 28 24 25 24 14C30 18 34 24 34 30C38 26 38 22 37 17C46 24 52 34 50 44C48 52 42 57 32 57Z" fill={`url(#${g}flame)`} />
        <path d="M32 53C25.5 53 22 48 23 43C24 38 29 36 30 31C34 35 37.5 39 37.5 43.5C38 49 36 53 32 53Z" fill={HA.porcelain} fillOpacity="0.82" />
        <path d="M32 57C18 57 12 47 14 37C16 28 24 25 24 14C30 18 34 24 34 30C38 26 38 22 37 17C46 24 52 34 50 44C48 52 42 57 32 57Z" {...rim} strokeOpacity={0.3} />
      </>
    ),
    star: (
      <>
        <path d="M32 7L38.6 23.4L56 24.6L42.6 35.8L46.9 53L32 43.6L17.1 53L21.4 35.8L8 24.6L25.4 23.4Z" fill={`url(#${g}glass)`} strokeLinejoin="round" />
        <path d="M32 7L38.6 23.4L56 24.6L42.6 35.8L46.9 53L32 43.6L17.1 53L21.4 35.8L8 24.6L25.4 23.4Z" {...rim} strokeLinejoin="round" />
        <path d="M27.5 21L31 12.5" {...spec} />
      </>
    ),
    tears: (
      <>
        <circle cx="32" cy="33" r="21" fill={`url(#${g}glass)`} />
        <circle cx="32" cy="33" r="21" {...rim} />
        <path d="M20 28Q24 23 28 28M36 28Q40 23 44 28" fill="none" stroke={HA.ink} strokeWidth="2.6" strokeLinecap="round" />
        <path d="M21 36H43Q42 47 32 47Q22 47 21 36Z" fill={HA.ink} />
        <path d="M24.5 39.5H39.5" stroke={HA.porcelain} strokeOpacity="0.9" strokeWidth="2" strokeLinecap="round" />
        <path d="M8 30Q4 36 7 39Q10 41 12 37Q12.5 33 8 30Z" fill={HA.porcelain} fillOpacity="0.9" />
        <path d="M56 30Q60 36 57 39Q54 41 52 37Q51.5 33 56 30Z" fill={HA.porcelain} fillOpacity="0.9" />
        <path d="M18 20A16 16 0 0 1 27 14" {...spec} strokeWidth={2} />
      </>
    ),
  }[emote]
  return (
    <svg className={s.emote} viewBox="0 0 64 64" width={size} height={size} aria-hidden>
      <defs>{glass}</defs>
      {body}
    </svg>
  )
}

interface Shown {
  key: number
  userId: string
  emote: Emote
  still: boolean
}
const PER_PERSON_MS = 1500
const MAX_ON_SCREEN = 6
const last = new Map<string, number>()
let seq = 0
export const useReactions = create<{ shown: Shown[] }>()(() => ({ shown: [] }))

/**
 * Shows `emote` rising from `userId`'s tile for everyone in the room (the transport is package D's). Limits:
 * 1 per 1.5 s per person, 6 on screen; reduced motion = a still badge on the tile for 1.5 s. False = dropped.
 */
export function showReaction(userId: string, emote: Emote): boolean {
  const now = performance.now()
  const { shown } = useReactions.getState()
  if (now - (last.get(userId) ?? -Infinity) < PER_PERSON_MS || shown.length >= MAX_ON_SCREEN) return false
  last.set(userId, now)
  const still = reducedMotion()
  const key = ++seq
  useReactions.setState({ shown: [...shown, { key, userId, emote, still }] })
  setTimeout(() => useReactions.setState((st) => ({ shown: st.shown.filter((r) => r.key !== key) })), still ? 1500 : HORA_AZUL.reactions_ha_hora_azul.ms)
  return true
}

/** Mount point on a tile: the reactions of `userId`, rising 40 px from the tile's lower middle. */
export function ReactionLayer({ userId }: { userId: string }) {
  const mine = useReactions(useShallow((st) => st.shown.filter((r) => r.userId === userId)))
  if (!mine.length) return null
  return (
    <span className={s.reactions} aria-hidden>
      {mine.map((r, i) => (
        <span key={r.key} className={r.still ? s.still : s.rise} style={{ ['--x' as string]: `${(i % 3) * 14 - 14}px` }}>
          <ReactionGlyph emote={r.emote} size={40} />
        </span>
      ))}
    </span>
  )
}

// ── HA-24, HA-25 Stream frames ───────────────────────────────

/**
 * The streamer's frame, a sibling of the <video> (the video stays on its hardware overlay plane). It hugs the
 * video's content rect (object-fit: contain) from the outside, hides in full screen and picture-in-picture, and
 * HA-24 runs its light once when the first frame arrives (`playing`). Without `video`, the box is the content (16:9).
 */
export function StreamFrame({ id, video, motion = 'play' }: { id: CosmeticId; video?: RefObject<HTMLVideoElement | null>; motion?: Motion }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [hidden, setHidden] = useState(false)
  const cinema = id === 'frame_ha_cinema'
  useOneShot(ref, video ? 'rest' : motion, cinema ? HORA_AZUL.frame_ha_cinema.ms : 0)

  useLayoutEffect(() => {
    const el = ref.current
    const box = el?.parentElement
    if (!el || !box) return
    box.dataset.cosmeticFrame = ''
    const v = video?.current ?? null
    const place = () => {
      const r = contentRect(box.clientWidth, box.clientHeight, v && v.videoWidth && v.videoHeight ? v.videoWidth / v.videoHeight : 16 / 9)
      el.style.left = `${r.left}px`
      el.style.top = `${r.top}px`
      el.style.width = `${r.width}px`
      el.style.height = `${r.height}px`
    }
    place()
    const ro = new ResizeObserver(place)
    ro.observe(box)
    const playing = () => el.dataset.run === undefined && cinema && motion !== 'rest' && run(el, HORA_AZUL.frame_ha_cinema.ms)
    const pip = () => setHidden(document.pictureInPictureElement === v)
    const fs = () => setHidden(!!document.fullscreenElement?.contains(box))
    v?.addEventListener('resize', place)
    v?.addEventListener('loadedmetadata', place)
    v?.addEventListener('playing', playing, { once: true })
    v?.addEventListener('enterpictureinpicture', pip)
    v?.addEventListener('leavepictureinpicture', pip)
    document.addEventListener('fullscreenchange', fs)
    return () => {
      delete box.dataset.cosmeticFrame
      ro.disconnect()
      v?.removeEventListener('resize', place)
      v?.removeEventListener('loadedmetadata', place)
      v?.removeEventListener('playing', playing)
      v?.removeEventListener('enterpictureinpicture', pip)
      v?.removeEventListener('leavepictureinpicture', pip)
      document.removeEventListener('fullscreenchange', fs)
    }
  }, [video, cinema, motion])

  if (id !== 'frame_ha_cinema' && id !== 'frame_ha_vidro') return null
  return (
    <span ref={ref} className={cinema ? s.cinema : s.glassFrame} hidden={hidden} aria-hidden data-cosmetic={id}>
      {cinema && <span className={s.sweep} />}
    </span>
  )
}
