import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { BUDGET_MS, stats, timed, useOneShot, type Motion } from '../engine'
import { HA, HORA_AZUL, type CosmeticId } from '../hora-azul'
import s from './profile.module.css'

/*
 * Nameplates (HA-09…12) and profile effects (HA-06…08). Plates are the name's background only (no outline: an
 * outline reads as a tag). Effects play once when the card opens and rest on their last frame.
 */

/** HA-10's static grain: a 64 px tile of 1 px specks, light and dark, deterministic (no filter, no image). */
const GRAIN = (() => {
  let h = 2166136261
  const rnd = () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0) % 1000) / 1000
  const dots = Array.from({ length: 90 }, (_, i) => {
    const light = i % 3 !== 0
    return `<rect x="${Math.floor(rnd() * 64)}" y="${Math.floor(rnd() * 64)}" width="1" height="1" fill="${light ? '#f7f8f8' : '#000'}" fill-opacity="${(light ? 0.035 + rnd() * 0.06 : 0.1 + rnd() * 0.08).toFixed(3)}"/>`
  })
  return `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">${dots.join('')}</svg>`)}")`
})()

const PLATES = new Set<CosmeticId>(['nameplate_ha_crepusculo', 'nameplate_ha_vidro_fosco', 'nameplate_ha_fio_luz', 'nameplate_ha_nanquim'])

/** Background behind a name. `row` = the list version (smaller padding, no outdent). */
export function Plate({ id, children, row, motion = 'rest' }: { id?: CosmeticId; children: ReactNode; row?: boolean; motion?: Motion }) {
  const ref = useRef<HTMLSpanElement>(null)
  const on = !!id && PLATES.has(id)
  useOneShot(ref, motion, on ? HORA_AZUL[id].ms : 0)
  if (!on) return <>{children}</>
  return (
    <span ref={ref} className={`${s.plate} ${row ? s.plateRow : ''}`} data-plate={id} style={id === 'nameplate_ha_vidro_fosco' ? { ['--grain' as string]: GRAIN } : undefined}>
      <span className={s.plateText}>{children}</span>
    </span>
  )
}

// ── HA-06 Hora azul ──
/**
 * [x %, y px, px, rest opacity, lilac]: twelve stars over the banner, more of them high and to the right (the avatar
 * covers the low left). The first, brightest one carries a four-point glint.
 */
const SKY = [
  [88, 13, 2, 1, false], [78, 30, 1, 0.6, false], [63, 9, 1.5, 0.85, false], [92, 40, 1, 0.5, true], [49, 21, 1, 0.65, false],
  [70, 46, 1.5, 0.5, true], [37, 8, 1.5, 0.8, false], [56, 35, 1, 0.5, false], [26, 19, 1, 0.55, true], [97, 22, 1, 0.6, false],
  [43, 44, 1, 0.4, false], [15, 10, 1, 0.5, false],
] as const

function HoraAzul({ motion }: { motion: Motion }) {
  const ref = useRef<HTMLDivElement>(null)
  useOneShot(ref, motion, HORA_AZUL.effect_ha_hora_azul.ms)
  return (
    <div ref={ref} className={s.sky} aria-hidden>
      <div className={s.night} />
      <div className={s.dusk} />
      <div className={s.horizon} />
      <svg className={s.stars} width="100%" height="72">
        {SKY.map(([x, y, px, o, lilac], i) => (
          <g key={i} opacity={o} style={{ ['--i' as string]: i }}>
            <circle cx={`${x}%`} cy={y} r={px / 2} fill={lilac ? HA.lilac : HA.porcelain} />
            {i === 0 && (
              <svg x={`${x}%`} y={y} overflow="visible">
                <path d="M-4 0H4M0 -4V4" stroke={HA.porcelain} strokeOpacity="0.55" strokeWidth="0.5" strokeLinecap="round" />
              </svg>
            )}
          </g>
        ))}
      </svg>
    </div>
  )
}

// ── HA-07 Poeira de luz (Canvas 2D, G2) ──
interface Mote {
  x: number
  y0: number
  y1: number
  amp: number
  freq: number
  phase: number
  delay: number
  r: number
  alpha: number
  color: string
}
/** 24 motes from a seed (the user id): everyone's dust is their own, and always the same. */
export function motes(seed: string, w: number, h: number): Mote[] {
  let a = 0x9e3779b9
  for (let i = 0; i < seed.length; i++) a = Math.imul(a ^ seed.charCodeAt(i), 0x85ebca6b)
  const rnd = () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return Array.from({ length: 24 }, () => {
    const lilac = rnd() < 0.4
    const x = w * (0.04 + rnd() * 0.92)
    return {
      x,
      y0: h + 4 + rnd() * 18,
      // Settles around 35 % in a loose band that falls to the right: dust hanging in light from 11 h.
      y1: h * (0.35 + (rnd() - 0.5) * 0.24) + (x - w / 2) * 0.12,
      amp: 3 + rnd() * 7,
      freq: 0.5 + rnd() * 0.9,
      phase: rnd() * Math.PI * 2,
      delay: rnd() * 260,
      r: (1.5 + rnd() * 1.5) / 2,
      alpha: (lilac ? 0.6 : 0.8) * (0.6 + rnd() * 0.4),
      color: lilac ? HA.lilac : HA.porcelain,
    }
  })
}
const DUST_MS = HORA_AZUL.effect_ha_poeira_luz.ms

function Dust({ seed, motion }: { seed: string; motion: Motion }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const draw = useRef<(t: number) => void>(() => undefined)
  // Draws the resting frame now; a run (engine) animates 0 → 1.8 s and lands on the same frame, then lets go.
  useLayoutEffect(() => {
    const c = ref.current
    if (!c) return
    const w = c.clientWidth
    const h = c.clientHeight
    if (!w || !h) return
    const dpr = devicePixelRatio || 1
    c.width = Math.round(w * dpr)
    c.height = Math.round(h * dpr)
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const ps = motes(seed, w, h)
    draw.current = (t) => {
      ctx.clearRect(0, 0, w, h)
      for (const p of ps) {
        const u = Math.min(1, Math.max(0, (t - p.delay) / (DUST_MS - p.delay)))
        if (u <= 0) continue
        const e = 1 - (1 - u) ** 4
        ctx.globalAlpha = p.alpha * Math.min(1, u * 4)
        ctx.fillStyle = p.color
        ctx.beginPath()
        ctx.arc(p.x + p.amp * Math.sin(Math.PI * 2 * p.freq * u + p.phase) * (1 - 0.6 * u), p.y0 + (p.y1 - p.y0) * e, p.r, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    draw.current(DUST_MS)
  }, [seed])
  useOneShot(ref, motion, DUST_MS, () => {
    const start = performance.now()
    let over = 0
    const frame = (now: number) => {
      const t = now - start
      if (t >= DUST_MS || !ref.current?.isConnected) return draw.current(DUST_MS)
      // Over the G2 budget three frames running: jump to the resting frame and stop.
      if (timed(() => draw.current(t)) > BUDGET_MS.canvas && ++over >= 3) {
        stats.overBudget++
        return draw.current(DUST_MS)
      }
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  })
  return <canvas ref={ref} className={s.dust} aria-hidden data-cosmetic="effect_ha_poeira_luz" />
}

// ── HA-08 Cortina de vidro ──
function Curtain({ motion, pose }: { motion: Motion; pose?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useOneShot(ref, motion, HORA_AZUL.effect_ha_cortina_vidro.ms)
  return (
    <div ref={ref} className={`${s.curtain} ${pose ? s.pose : ''}`} aria-hidden>
      {Array.from({ length: 7 }, (_, i) => (
        <span key={i} className={s.slat} style={{ ['--i' as string]: i }} />
      ))}
    </div>
  )
}

/**
 * The profile effect for `id`. `seed` = the profile's user id (HA-07 is unique per person). `pose` = a still
 * mid-gesture frame for a thumbnail (HA-08 rests invisible, so its tile shows the slats half turned).
 */
export function ProfileEffect({ id, seed, motion = 'play', pose }: { id?: CosmeticId; seed: string; motion?: Motion; pose?: boolean }) {
  if (id === 'effect_ha_hora_azul') return <HoraAzul motion={motion} />
  if (id === 'effect_ha_poeira_luz') return <Dust seed={seed} motion={motion} />
  if (id === 'effect_ha_cortina_vidro') return <Curtain motion={motion} pose={pose} />
  return null
}
