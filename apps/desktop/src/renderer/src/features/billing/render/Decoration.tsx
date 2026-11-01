import { useId, useMemo, useRef, type ReactNode } from 'react'
import { useOneShot, type Motion } from '../engine'
import { HA, HORA_AZUL, type CosmeticId } from '../hora-azul'
import { constellation, halo, orbits, pencil, ribbon } from './geometry'
import s from './decoration.module.css'

/*
 * Avatar decorations (HA-01…05). SVG at 140 % of the avatar; strokes in screen px (non-scaling), shapes in units,
 * so 32 px and 96 px are both crisp. 40 px and under use the simplified geometry. Motion: one gesture on open or
 * hover (engine), never on the stage.
 */

const NS = { vectorEffect: 'non-scaling-stroke' as const, fill: 'none' }

/**
 * The decoration's box (140 % of the avatar). `children` = the SVG art; `layer` = HTML layers over it that move on
 * the compositor (an SVG child's transform repaints the SVG every frame; an HTML layer's does not).
 */
function Svg({ id, motion, onRun, children, className, layer }: { id: CosmeticId; motion: Motion; onRun?: (el: HTMLElement) => void; children: ReactNode; className?: string; layer?: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null)
  useOneShot(ref, motion, HORA_AZUL[id].ms, onRun)
  return (
    <span ref={ref} className={`${s.deco} ${className ?? ''}`} aria-hidden data-cosmetic={id}>
      <svg className={s.art} viewBox="-60 -60 120 120">
        {children}
      </svg>
      {layer}
    </span>
  )
}

function Halo({ size, motion }: { size: number; motion: Motion }) {
  const g = useId()
  const h = useMemo(() => halo(size), [size])
  const [gx1, gy1, gx2, gy2] = [12, -54, -34, 40]
  const [x1, y1] = h.glint.pts[0]!
  const [x2, y2] = h.glint.pts[12]!
  const glint = !h.small && (
    <svg className={s.glint} viewBox="-60 -60 120 120">
      <defs>
        <linearGradient id={`${g}glint`} gradientUnits="userSpaceOnUse" x1={x1} y1={y1} x2={x2} y2={y2}>
          <stop offset="0" stopColor={HA.porcelain} stopOpacity="0" />
          <stop offset="0.5" stopColor={HA.porcelain} stopOpacity="0.95" />
          <stop offset="1" stopColor={HA.porcelain} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={h.glint.d} {...NS} stroke={`url(#${g}glint)`} strokeWidth="2.25" strokeLinecap="round" />
    </svg>
  )
  return (
    <Svg id="deco_ha_halo_vidro" motion={h.small ? 'rest' : motion} layer={glint}>
      <defs>
        {/* Porcelain where the 11 h light hits, silver in the body, the indigo refracted low on the left. */}
        <linearGradient id={`${g}rim`} gradientUnits="userSpaceOnUse" x1={gx1} y1={gy1} x2={gx2} y2={gy2}>
          <stop offset="0" stopColor={HA.porcelain} stopOpacity={h.small ? 0.85 : 0.55} />
          <stop offset="0.5" stopColor={HA.silver} stopOpacity={h.small ? 0.5 : 0.2} />
          <stop offset="1" stopColor={HA.indigoLight} stopOpacity={h.small ? 0.85 : 0.45} />
        </linearGradient>
        {/* The tube's outer edge catches the light: bright at 11 h, gone by 3 h and 6 h. */}
        <linearGradient id={`${g}edge`} gradientUnits="userSpaceOnUse" x1="-34" y1="-42" x2="30" y2="38">
          <stop offset="0" stopColor={HA.porcelain} stopOpacity="0.9" />
          <stop offset="0.55" stopColor={HA.porcelain} stopOpacity="0.18" />
          <stop offset="1" stopColor={HA.porcelain} stopOpacity="0" />
        </linearGradient>
        {/* The inner edge carries the refraction: lilac pooling low on the left (the caustic). */}
        <linearGradient id={`${g}inner`} gradientUnits="userSpaceOnUse" x1="-30" y1="40" x2="26" y2="-40">
          <stop offset="0" stopColor={HA.lilac} stopOpacity="0.7" />
          <stop offset="0.6" stopColor={HA.indigoLight} stopOpacity="0.3" />
          <stop offset="1" stopColor={HA.indigoLight} stopOpacity="0.18" />
        </linearGradient>
      </defs>
      <path d={h.rim.d} {...NS} stroke={`url(#${g}rim)`} strokeWidth={h.small ? 2 : 3} strokeLinecap="round" />
      {!h.small && (
        <>
          <path d={h.filete.d} {...NS} stroke={`url(#${g}inner)`} strokeWidth="1" strokeLinecap="round" />
          <path d={h.edge.d} {...NS} stroke={`url(#${g}edge)`} strokeWidth="0.75" strokeLinecap="round" />
          <path d={h.caustic.d} {...NS} stroke={HA.lilac} strokeOpacity="0.55" strokeWidth="1.25" strokeLinecap="round" />
        </>
      )}
    </Svg>
  )
}

function Orbit({ size, motion }: { size: number; motion: Motion }) {
  const o = useMemo(() => orbits(size), [size])
  const w = o.small ? 1.25 : 1
  const px = (1.4 * size) / 120 // viewBox units → px
  // The bead is an HTML layer: its 70° run is a compositor translate, not an SVG repaint per frame.
  const bead = (el: HTMLElement) =>
    el.querySelector('[data-bead]')?.animate(
      o.beadPath.map(([x, y]) => ({ translate: `${(x * px).toFixed(2)}px ${(y * px).toFixed(2)}px` })),
      { duration: HORA_AZUL.deco_ha_orbita.ms, easing: 'linear' },
    )
  return (
    <Svg
      id="deco_ha_orbita"
      motion={motion}
      onRun={bead}
      layer={<span data-bead className={s.bead} style={{ left: at(o.bead[0]), top: at(o.bead[1]), ['--d' as string]: `${o.small ? 3.5 : 4}px` }} />}
    >
      <path d={o.a.d} {...NS} stroke={HA.lilac} strokeOpacity={o.small ? 0.7 : 0.5} strokeWidth={w} strokeLinecap="round" />
      <path d={o.b.d} {...NS} stroke={HA.indigoLight} strokeOpacity={o.small ? 0.65 : 0.42} strokeWidth={w} strokeLinecap="round" />
    </Svg>
  )
}

/** viewBox units → a CSS position inside the decoration box. */
const at = (u: number) => `${(((u + 60) / 120) * 100).toFixed(3)}%`

function Constellation({ size, motion }: { size: number; motion: Motion }) {
  const c = useMemo(() => constellation(size), [size])
  const px = (1.4 * size) / 120
  // Stars and links are HTML layers so lighting them up is opacity/transform on the compositor.
  const layer = (
    <>
      {c.links && (
        <svg className={s.links} viewBox="-60 -60 120 120">
          <path d={c.links} {...NS} stroke={HA.porcelain} strokeOpacity="0.25" strokeWidth="0.5" />
        </svg>
      )}
      {c.stars.map((st) => (
        <span
          key={st.i}
          // The brightest star gets a four-point glint: two hairlines, the light of 11 h.
          className={`${s.star} ${st.lilac ? s.lilac : ''} ${st.bright && !c.small ? s.bright : ''}`}
          style={{ left: at(st.at[0]), top: at(st.at[1]), ['--d' as string]: `${(st.r * 2 * px).toFixed(2)}px`, ['--i' as string]: st.i }}
        />
      ))}
    </>
  )
  return (
    <Svg id="deco_ha_constelacao" motion={motion} className={s.constellation} layer={layer}>
      {null}
    </Svg>
  )
}

function Ribbon({ size, motion }: { size: number; motion: Motion }) {
  const g = useId()
  const r = useMemo(() => ribbon(size), [size])
  const [ax, ay] = r.back.outer[0]!
  const [bx, by] = r.front.outer[r.front.outer.length - 1]!
  const sheen = r.front.outer.slice(4, -4)
  return (
    <Svg id="deco_ha_fita_seda" motion={r.small ? 'rest' : motion}>
      <defs>
        <linearGradient id={`${g}silk`} gradientUnits="userSpaceOnUse" x1={ax} y1={ay} x2={bx} y2={by}>
          <stop offset="0" stopColor={HA.deep} />
          <stop offset="0.5" stopColor={HA.indigo} />
          <stop offset="1" stopColor={HA.lilac} />
        </linearGradient>
        <clipPath id={`${g}clip`}>
          <path d={r.back.d + r.front.d} />
        </clipPath>
        <linearGradient id={`${g}shine`} gradientUnits="userSpaceOnUse" x1="52" y1="-9" x2="52" y2="9">
          <stop offset="0" stopColor={HA.porcelain} stopOpacity="0" />
          <stop offset="0.5" stopColor={HA.porcelain} stopOpacity="0.25" />
          <stop offset="1" stopColor={HA.porcelain} stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* The back of the ribbon (before the twist) sits a step darker: the silk turning away from the light. */}
      <path d={r.back.d} fill={`url(#${g}silk)`} fillOpacity="0.82" />
      <path d={r.front.d} fill={`url(#${g}silk)`} />
      {!r.small && (
        <>
          <path d={sheen.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join('')} {...NS} stroke={HA.porcelain} strokeOpacity="0.2" strokeWidth="0.75" strokeLinecap="round" />
          <g clipPath={`url(#${g}clip)`}>
            <g className={s.shine}>
              <path d="M0 0L59 -11L59 11Z" fill={`url(#${g}shine)`} />
            </g>
          </g>
        </>
      )}
    </Svg>
  )
}

function Pencil({ size }: { size: number }) {
  const g = useId()
  const p = useMemo(() => pencil(size), [size])
  return (
    <Svg id="deco_ha_traco_grafite" motion="rest">
      <defs>
        <linearGradient id={`${g}lead`} gradientUnits="userSpaceOnUse" x1="-20" y1="52" x2="44" y2="-40">
          <stop offset="0" stopColor="#8a8f98" />
          <stop offset="1" stopColor={HA.silver} />
        </linearGradient>
      </defs>
      <path d={p.main.d} fill={`url(#${g}lead)`} fillOpacity="0.92" />
      {/* Graphite density: a lighter core along the stroke, the paper showing through at the edges. */}
      <path d={p.core.d} fill={HA.silver} fillOpacity="0.28" />
      <path d={p.extra.d} fill={`url(#${g}lead)`} fillOpacity="0.55" />
    </Svg>
  )
}

/** The decoration for `id`, sized for an avatar of `size` px. Unknown or non-decoration ids draw nothing. */
export function Decoration({ id, size, motion = 'rest' }: { id: CosmeticId; size: number; motion?: Motion }) {
  if (id === 'deco_ha_halo_vidro') return <Halo size={size} motion={motion} />
  if (id === 'deco_ha_orbita') return <Orbit size={size} motion={motion} />
  if (id === 'deco_ha_constelacao') return <Constellation size={size} motion={motion} />
  if (id === 'deco_ha_fita_seda') return <Ribbon size={size} motion={motion} />
  if (id === 'deco_ha_traco_grafite') return <Pencil size={size} />
  return null
}
