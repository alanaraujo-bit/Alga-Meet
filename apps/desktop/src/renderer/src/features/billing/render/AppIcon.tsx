import { useId } from 'react'
import { HA, type CosmeticId } from '../hora-azul'

/*
 * App icons (HA-26…28): Marca v2 "Encosto" (build/brand/mark.svg, mark-mono.svg: one seaweed, two blades, the gap
 * between them is the current) on the app tile of build/brand/icon.svg (240 tile, r 56, mark at 28,28 × 200), in the
 * collection's colors. Noite and Porcelana are the mono mark (the gap carries the idea); Crepúsculo runs one
 * gradient across both blades, the horizon's ember at the top. Applying one to the window, taskbar and tray is the
 * main process's job (setIcon, the hand-fitted 16–32 px masters), not here.
 */
const TALL = 'M106 24C113 24 118 31 121 40C127 58 129 84 126 108C123 132 117 150 117 176C117 198 121 214 123 222C125 229 122 233 117 232C108 230 98 222 91 210C80 192 75 168 75 142C75 108 84 78 94 50C97.5 40.2 99 24 106 24Z'
const SMALL = 'M160 78C166 78 169.6 85.6 172 92C178 108 181 124 180 142C179 166 171 186 158 202C150 212 144 220 140 225C137 229 132 228 132 223C131 204 133 172 137 150C141 126 146 104 151 90C153.3 83.6 155 78 160 78Z'

const LOOKS: Partial<Record<CosmeticId, { bg: [string, string]; ink: [string, string]; rim: string; rimOpacity: number; glow: number }>> = {
  icon_ha_noite: { bg: ['#1a1a2b', HA.ink], ink: [HA.porcelain, HA.porcelain], rim: '#ffffff', rimOpacity: 0.09, glow: 0.14 },
  icon_ha_porcelana: { bg: ['#fbfbfc', '#e6e7ec'], ink: [HA.graphite, HA.graphite], rim: '#000000', rimOpacity: 0.08, glow: 0 },
  icon_ha_crepusculo: { bg: ['#1a1a2b', HA.ink], ink: [HA.ember, HA.indigoLight], rim: '#ffffff', rimOpacity: 0.09, glow: 0.16 },
}

export function AppIcon({ id, size = 64 }: { id: CosmeticId; size?: number }) {
  const g = useId()
  const look = LOOKS[id]
  if (!look) return null
  return (
    <svg viewBox="0 0 256 256" width={size} height={size} aria-hidden data-cosmetic={id}>
      <defs>
        <linearGradient id={`${g}bg`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={look.bg[0]} />
          <stop offset="1" stopColor={look.bg[1]} />
        </linearGradient>
        <radialGradient id={`${g}glow`} cx="0.5" cy="0.32" r="0.6">
          <stop offset="0" stopColor={HA.indigoLight} stopOpacity={look.glow} />
          <stop offset="1" stopColor={HA.indigoLight} stopOpacity="0" />
        </radialGradient>
        {/* One gradient over the glyph box (mark units 24..232), shared by both blades. */}
        <linearGradient id={`${g}ink`} x1="0" y1="24" x2="0" y2="232" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={look.ink[0]} />
          <stop offset="1" stopColor={look.ink[1]} />
        </linearGradient>
      </defs>
      <rect x="8" y="8" width="240" height="240" rx="56" fill={`url(#${g}bg)`} />
      {look.glow > 0 && <rect x="8" y="8" width="240" height="240" rx="56" fill={`url(#${g}glow)`} />}
      <rect x="9" y="9" width="238" height="238" rx="55" fill="none" stroke={look.rim} strokeOpacity={look.rimOpacity} strokeWidth="2" />
      <g transform="translate(28 28) scale(0.78125)" fill={`url(#${g}ink)`}>
        <path d={TALL} />
        <path d={SMALL} />
      </g>
    </svg>
  )
}
