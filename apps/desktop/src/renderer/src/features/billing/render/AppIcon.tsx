import { useId } from 'react'
import { HA, type CosmeticId } from '../hora-azul'

/*
 * App icons (HA-26…28): the brand mark's geometry (build/brand/mark.svg: 240 tile, r 56, bars u = 28, 3u/5u/3u) in
 * the collection's colors. Applying one to the window/taskbar/tray is the main process's job (setIcon), not here.
 */
const LOOKS: Partial<Record<CosmeticId, { bg: [string, string]; bars: [string, string]; rim: string; rimOpacity: number }>> = {
  icon_ha_noite: { bg: ['#1a1a2b', HA.ink], bars: [HA.porcelain, HA.porcelain], rim: '#ffffff', rimOpacity: 0.09 },
  icon_ha_porcelana: { bg: ['#fbfbfc', '#e6e7ec'], bars: [HA.graphite, HA.graphite], rim: '#000000', rimOpacity: 0.08 },
  icon_ha_crepusculo: { bg: ['#1a1a2b', HA.ink], bars: [HA.ember, HA.indigoLight], rim: '#ffffff', rimOpacity: 0.09 },
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
        <linearGradient id={`${g}bar`} x1="128" y1="58" x2="128" y2="198" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={look.bars[0]} />
          <stop offset="1" stopColor={look.bars[1]} />
        </linearGradient>
      </defs>
      <rect x="8" y="8" width="240" height="240" rx="56" fill={`url(#${g}bg)`} />
      <rect x="9" y="9" width="238" height="238" rx="55" fill="none" stroke={look.rim} strokeOpacity={look.rimOpacity} strokeWidth="2" />
      <g fill={`url(#${g}bar)`}>
        <rect x="58" y="86" width="28" height="84" rx="14" />
        <rect x="114" y="58" width="28" height="140" rx="14" />
        <rect x="170" y="86" width="28" height="84" rx="14" />
      </g>
    </svg>
  )
}
