import type { PresenceStatus } from '@alga/shared'
import { useId, type ReactNode } from 'react'
import { Avatar, type AvatarUser } from '@/ui'
import { hueFor, type AvatarSize } from '@/ui/Avatar'
import { COSMETICS, type CosmeticId, type Look } from './look'
import s from './cosmetics.module.css'

/*
 * Cosmetic renderers. Restrained by design (docs/business/monetization.md §3): muted sea colors, no neon, nothing that
 * moves in a list or the chat. Motion runs once when a profile opens (`play`) or while hovered, transforms/opacity
 * only, and the resting frame is the reduced-motion frame (global CSS collapses animations to their end state).
 */

// ── Geometry (viewBox -60 -60 120 120; the avatar is the circle of radius R: the SVG is 140 % of the avatar) ──
const R = 42.9
const P = (r: number, deg: number): [number, number] => {
  const a = (deg * Math.PI) / 180
  return [r * Math.cos(a), r * Math.sin(a)]
}
const f = (n: number) => n.toFixed(1)
const arc = (r: number, a1: number, a2: number) => {
  const [x1, y1] = P(r, a1)
  const [x2, y2] = P(r, a2)
  return `M ${f(x1)} ${f(y1)} A ${r} ${r} 0 ${a2 - a1 > 180 ? 1 : 0} 1 ${f(x2)} ${f(y2)}`
}

/**
 * A kelp leaf from (r1, a1) to (r2, a2), SVG degrees (90 = bottom): its middle sits on the arc between, so it follows
 * the avatar's curve, and the tip floats out. `w` = half-width at the middle. Returns the blade and its midrib.
 */
function leaf(a1: number, a2: number, r1: number, r2: number, w: number): { blade: string; rib: string } {
  const [bx, by] = P(r1, a1)
  const [tx, ty] = P(r2, a2)
  const [mx, my] = P((r1 + r2) / 2 + 1.2, (a1 + a2) / 2)
  const len = Math.hypot(tx - bx, ty - by)
  const nx = -(ty - by) / len
  const ny = (tx - bx) / len
  // Quadratic control so the curve passes through mid ± w at t = .5.
  const c = (k: number) => [2 * (mx + nx * w * k) - (bx + tx) / 2, 2 * (my + ny * w * k) - (by + ty) / 2] as const
  const [c1x, c1y] = c(1)
  const [c2x, c2y] = c(-1)
  const [cmx, cmy] = c(0)
  return {
    blade: `M ${f(bx)} ${f(by)} Q ${f(c1x)} ${f(c1y)} ${f(tx)} ${f(ty)} Q ${f(c2x)} ${f(c2y)} ${f(bx)} ${f(by)} Z`,
    rib: `M ${f(bx)} ${f(by)} Q ${f(cmx)} ${f(cmy)} ${f(tx)} ${f(ty)}`,
  }
}
// The bottom-right quadrant (0–90°) stays clear: that is where the presence dot sits.
const KELP = [
  leaf(112, 170, R + 1.5, R + 9, 3.4),
  leaf(140, 208, R + 2, R + 12.5, 4.4),
  leaf(186, 248, R + 1.5, R + 10.5, 4),
  leaf(230, 282, R + 1.5, R + 8, 3),
  leaf(266, 304, R + 1, R + 5.5, 2),
]
/** 40 px and under (member list, user panel): three broad leaves with free tips; ribs and the ring would be sub-pixel. */
const KELP_SMALL = [leaf(116, 176, R + 1, R + 14, 6), leaf(170, 234, R + 1, R + 15.5, 7), leaf(230, 290, R + 1, R + 12, 5.5)]

/** Staghorn coral in a local frame (+x = away from the avatar, ±y = along it): stem, branches, twig, polyp tips. */
const TREE = {
  paths: [
    ['M 0 0 C 3 0.4 6 -0.6 9 -2.2', 3.2],
    ['M 3.4 0.2 C 6 1.6 8.4 3.4 11 4.2', 2.4],
    ['M 6.4 -1 C 8.8 -1.6 10.8 -4.4 11.8 -6.6', 2.2],
    ['M 9 -2.2 C 11 -2.2 13 -1.2 14.4 0.4', 2],
    ['M 8.6 3.3 C 9.6 4.8 10.4 6.4 10.5 8', 1.6],
  ] as const,
  tips: [[11, 4.2], [11.8, -6.6], [14.4, 0.4], [10.5, 8]] as const,
}
/** [root angle, scale, mirrored]: one dense reef low on the left, growing from a base that hugs the avatar. */
const CORAL = [
  [112, 0.78, true],
  [124, 1.12, false],
  [140, 0.9, true],
  [156, 1.02, false],
  [172, 0.74, true],
  [188, 0.84, false],
  [204, 0.6, true],
] as const
/** Small sizes: two thick branches per root, big polyps, a solid base; fine twigs at 32 px read as noise. */
const TREE_SMALL = {
  paths: [
    ['M 0 0 C 4 0.4 8 -1 12 -4', 4.6],
    ['M 5 0.4 C 8 2 11 3.6 14 4.2', 3.6],
  ] as const,
  tips: [[12, -4], [14, 4.2]] as const,
}
const CORAL_SMALL = [
  [120, 1.05, false],
  [150, 1.1, true],
  [180, 1.05, false],
  [206, 0.85, true],
] as const

export function Decoration({ id, small }: { id: CosmeticId; small?: boolean }) {
  // Unique per instance: a shared gradient id breaks when the first copy sits in a hidden subtree.
  const grad = useId()
  if (id === 'deco_folha_de_alga')
    return (
      <svg className={`${s.deco} ${s.kelp} ${small ? s.small : ''}`} viewBox="-60 -60 120 120" aria-hidden>
        <defs>
          <linearGradient id={grad} gradientUnits="userSpaceOnUse" x1="-30" y1="50" x2="20" y2="-60">
            <stop offset="0" stopColor="#2f5a50" />
            <stop offset="0.55" stopColor="#56877b" />
            <stop offset="1" stopColor="#abcdbf" />
          </linearGradient>
        </defs>
        {!small && <path d={arc(R + 1.2, 100, 312)} fill="none" stroke="#8fb2a5" strokeOpacity="0.34" strokeWidth="0.9" />}
        <g className={s.sway}>
          {(small ? KELP_SMALL : KELP).map((l, i) => (
            <g key={i}>
              <path d={l.blade} fill={`url(#${grad})`} fillOpacity={i % 2 ? 0.86 : 0.97} />
              {!small && <path d={l.rib} fill="none" stroke="#d3e6de" strokeOpacity="0.32" strokeWidth="0.6" strokeLinecap="round" />}
            </g>
          ))}
        </g>
      </svg>
    )
  if (id === 'deco_coral') {
    const tree: { paths: ReadonlyArray<readonly [string, number]>; tips: ReadonlyArray<readonly [number, number]> } = small ? TREE_SMALL : TREE
    const reef: ReadonlyArray<readonly [number, number, boolean]> = small ? CORAL_SMALL : CORAL
    return (
      <svg className={`${s.deco} ${s.coral} ${small ? s.small : ''}`} viewBox="-60 -60 120 120" aria-hidden>
        {!small && <path d={arc(R + 1.2, 214, 292)} fill="none" stroke="#cf968c" strokeOpacity="0.3" strokeWidth="0.9" />}
        <path d={arc(R + 1.4, 104, 214)} fill="none" stroke="#a96c63" strokeWidth={small ? 5 : 3.4} strokeLinecap="round" />
        <g className={s.sway}>
          {reef.map(([a, k, flip], i) => (
            <g key={i} transform={`rotate(${a}) translate(${R + 0.6} 0) scale(${k} ${flip ? -k : k})`}>
              {tree.paths.map(([d, w], j) => (
                <path key={j} d={d} fill="none" stroke={j === 0 ? '#b5776d' : '#cf968c'} strokeWidth={w} strokeLinecap="round" />
              ))}
              {tree.tips.map(([x, y], j) => (
                <circle key={j} cx={x} cy={y} r={small ? 2.4 : 1.25} fill="#e9c3ba" />
              ))}
            </g>
          ))}
        </g>
      </svg>
    )
  }
  return null
}

export function DecoratedAvatar({
  user,
  size,
  presence,
  decoration,
  decorative,
  play,
  glow,
}: {
  user: AvatarUser
  size: AvatarSize
  presence?: PresenceStatus
  decoration?: CosmeticId
  decorative?: boolean
  play?: boolean
  /** Speaking halo driven by an ancestor's --speak (call tiles). */
  glow?: boolean
}) {
  return (
    <span className={`${s.decoWrap} ${play ? s.play : ''}`} style={{ width: size, height: size }}>
      <Avatar user={user} size={size} presence={presence} decorative={decorative} glow={glow} />
      {decoration && <Decoration id={decoration} small={size <= 40} />}
    </span>
  )
}

/** [px from the right edge, % from the top, scale]: a small school swimming in the plate's tail, clear of the name. */
const FISH = [
  [3, 40, 1],
  [12, 66, 0.78],
  [15, 28, 0.7],
  [22, 52, 0.62],
] as const

/** Background behind a name. `row` = the small version for lists (moves only while the row is hovered). */
export function Nameplate({ id, children, row, play }: { id?: CosmeticId; children: ReactNode; row?: boolean; play?: boolean }) {
  if (id !== 'nameplate_cardume' && id !== 'nameplate_plus_correnteza') return <>{children}</>
  return (
    <span className={`${s.plate} ${row ? s.plateRow : ''} ${play ? s.play : ''}`} data-plate={id}>
      {id === 'nameplate_cardume' && (
        <span className={s.school} aria-hidden>
          {FISH.map(([x, y, k], i) => (
            <svg key={i} className={s.fish} viewBox="0 0 12 6" style={{ right: x, top: `${y}%`, width: 10 * k, animationDelay: `${i * 90}ms` }}>
              <path d="M0 3 C2.5 0 7 0 9 3 C7 6 2.5 6 0 3 Z M9 3 L12 0.6 L12 5.4 Z" />
            </svg>
          ))}
        </span>
      )}
      <span className={s.plateText}>{children}</span>
    </span>
  )
}

const SKYLINE = [
  [0, 18], [5, 26], [9, 20], [13, 34], [18, 24], [24, 30], [29, 19], [33, 44], [38, 27], [44, 33], [50, 22],
  [55, 29], [60, 48], [64, 26], [70, 35], [76, 21], [81, 31], [87, 24], [93, 30], [97, 22],
] as const
const WINDOWS = [
  [14.5, 72], [15.8, 80], [34.2, 62], [35.6, 70], [34.2, 78], [39.5, 82], [45.2, 74], [61.2, 58], [62.6, 66], [61.2, 74],
  [71.4, 72], [72.8, 80], [82.4, 76], [88.2, 82], [94.4, 78],
] as const
/** Banner art of a profile theme (the card supplies the gradient; this is the drawing on top). */
function ThemeArt({ id }: { id?: CosmeticId }) {
  if (id === 'theme_noite_paulistana')
    return (
      <svg className={s.art} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
        <path
          d={`M 0 100 ${SKYLINE.map(([x, h], i) => `L ${x} ${100 - h} L ${SKYLINE[i + 1]?.[0] ?? 100} ${100 - h}`).join(' ')} L 100 100 Z`}
          fill="#0a0c1a"
        />
        {WINDOWS.map(([x, y], i) => (
          <rect key={i} x={x} y={y} width="0.8" height="3.2" fill={i === 7 ? '#de94cc' : '#f5c784'} fillOpacity={i % 3 ? 0.62 : 0.9} />
        ))}
      </svg>
    )
  if (id === 'theme_plus_mare')
    return (
      <svg className={s.art} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
        <path d="M 0 62 C 18 52 32 72 50 62 S 82 52 100 60" fill="none" stroke="#c5c8ff" strokeOpacity="0.16" strokeWidth="0.8" vectorEffect="non-scaling-stroke" />
        <path d="M 0 78 C 20 70 36 88 54 78 S 84 70 100 77" fill="none" stroke="#c5c8ff" strokeOpacity="0.1" strokeWidth="0.8" vectorEffect="non-scaling-stroke" />
      </svg>
    )
  return null
}

// Deterministic "plankton": positions, sizes and delays fixed so every open looks the same.
const MOTES = Array.from({ length: 16 }, (_, i) => {
  const h = (i * 2654435761) >>> 0
  return { x: 5 + (h % 90), y: 6 + ((h >>> 8) % 74), size: 2.5 + ((h >>> 16) % 3), delay: (h >>> 4) % 520, rise: 10 + ((h >>> 12) % 16) }
})

function Effect({ id }: { id?: CosmeticId }) {
  if (id !== 'effect_bioluminescencia') return null
  return (
    <span className={s.motes} aria-hidden>
      {MOTES.map((m, i) => (
        <span
          key={i}
          className={s.mote}
          style={{ left: `${m.x}%`, top: `${m.y}%`, width: m.size, height: m.size, animationDelay: `${m.delay}ms`, ['--rise' as string]: `${m.rise}px` }}
        />
      ))}
    </span>
  )
}

export interface ProfileUser extends AvatarUser {
  username: string
  bio?: string
}

/**
 * The profile card (popovers, the shop preview). The theme paints the banner and tints the card, the decoration
 * rings the avatar, the nameplate sits behind the name, the effect plays once when the card mounts.
 */
export function ProfileCard({
  user,
  look,
  name,
  presence,
  children,
}: {
  user: ProfileUser
  look: Look
  /** Overrides the display name (space nickname). */
  name?: string
  presence?: PresenceStatus
  children?: ReactNode
}) {
  const hueBanner = user.accentColor ?? `oklch(0.45 0.05 ${hueFor(user.id)})`
  return (
    <div className={s.card} data-theme={look.theme} style={{ ['--banner' as string]: hueBanner }}>
      <div className={s.banner}>
        <ThemeArt id={look.theme} />
      </div>
      <Effect id={look.effect} />
      <div className={s.avatarSlot}>
        <span className={s.avatarRing}>
          <DecoratedAvatar user={user} size={80} presence={presence} decoration={look.decoration} decorative play />
        </span>
      </div>
      <div className={s.body}>
        <div className={s.name}>
          <Nameplate id={look.nameplate} play>
            {name ?? user.displayName}
          </Nameplate>
        </div>
        <div className={s.username}>@{user.username}</div>
        {user.bio && <p className={s.bio}>{user.bio}</p>}
        {children}
      </div>
    </div>
  )
}

/** Small stand-alone sample of one item (shop tiles). */
export function CosmeticThumb({ id, user }: { id: CosmeticId; user: ProfileUser }) {
  const slot = COSMETICS[id]
  if (slot === 'decoration') return <DecoratedAvatar user={user} size={56} decoration={id} decorative />
  if (slot === 'nameplate')
    return (
      <span className={s.thumbName}>
        <Nameplate id={id} row>
          {user.displayName}
        </Nameplate>
      </span>
    )
  return (
    <span className={`${s.card} ${s.thumbCard}`} data-theme={slot === 'theme' ? id : undefined} style={{ ['--banner' as string]: 'var(--bg-raised)' }}>
      <span className={`${s.banner} ${s.thumbBanner}`}>
        <ThemeArt id={id} />
      </span>
      <Effect id={id} />
    </span>
  )
}
