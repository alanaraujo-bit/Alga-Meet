import { useSyncExternalStore } from 'react'

// Marca v2 · Encosto (apps/desktop/build/brand, see the README there): one seaweed, two blades. The tall white blade is
// you, the small indigo one leans on it. Paths = build/brand/mark.svg; grids = build/brand/mark-<n>.svg without the
// tile. Keep them in sync when the masters change.
const WHITE = '#f7f8f8'
const INDIGO = '#8b8ef7'
const TALL = 'M106 24C113 24 118 31 121 40C127 58 129 84 126 108C123 132 117 150 117 176C117 198 121 214 123 222C125 229 122 233 117 232C108 230 98 222 91 210C80 192 75 168 75 142C75 108 84 78 94 50C97.5 40.2 99 24 106 24Z'
const LEAN = 'M160 78C166 78 169.6 85.6 172 92C178 108 181 124 180 142C179 166 171 186 158 202C150 212 144 220 140 225C137 229 132 228 132 223C131 204 133 172 137 150C141 126 146 104 151 90C153.3 83.6 155 78 160 78Z'

/** Hand-fitted pixel masters by device-pixel size: [first row, rows]. W/I = white/indigo, 1-9 / a-i = 10-90 %. */
const GRIDS: Record<number, [number, string[]]> = {
  16: [1, ['.....5W3', '....2WW8', '....6WWW', '...1WWWW', '...2WWWW', '...3WWWW.cfa', '...4WWWW.IIIb', '...4WWWW.IIId', '...3WWWW.IIIc', '...2WWW5.IIIa', '....WWW.dIIc', '....7WW.IIf', '.....8W.Ia', '......5.d']],
  20: [1, ['.......38', '......1WW6', '......6WWW', '.....2WWWW', '.....6WWWW', '.....8WWWW', '....1WWWWW.cga', '....2WWWWW.IIf', '....3WWWWW.IIIc', '....3WWWWW.IIIh', '....2WWWW5.IIIIa', '....1WWWW.eIIIa', '.....9WWW.IIIh', '.....6WWW.IIIc', '.....2WWW.IIg', '......7WW.If', '.......8W.h', '........5.c']],
  24: [2, ['.........68', '........2WW5', '........7WWW', '.......3WWWW', '.......8WWWW', '......3WWWWW', '......5WWWWW.bfa', '......6WWWWW.gIf', '......7WWWWW.IIIc', '......7WWWWW.IIIIa', '......7WWWWW.IIIIc', '......6WWWW5.IIIId', '......5WWWW.eIIIIb', '......3WWWW.IIIIc', '......1WWWW.IIIh', '.......8WWW.IIId', '.......3WWW.IIh', '........6WW.Ic', '.........6W.h', '..........4.c']],
  32: [3, ['...........693', '..........2WW9', '..........6WWW4', '.........1WWWWW', '.........5WWWWW', '.........8WWWWW', '........2WWWWWW', '........4WWWWWW..cgb', '........5WWWWWW..hIIc', '........6WWWWWW..IIIIb', '........7WWWWWW..IIIIIa', '........7WWWWWW..IIIIIc', '........7WWWWWW..IIIIIe', '........6WWWWWW..IIIIIf', '........5WWWWWW..IIIIIf', '........4WWWWW6.eIIIIIe', '........2WWWWW..IIIIIf', '........1WWWWW..IIIIId', '.........WWWWW..IIIIIa', '.........7WWWW..IIIIh', '.........2WWWW..IIIId', '..........8WWW..IIIh', '..........3WWW..IIIb', '...........8WW..IIf', '............6W.bIc', '.............7.d']],
}

function pixels([top, rows]: [number, string[]]) {
  return rows.flatMap((row, y) =>
    [...row].map((c, x) => {
      if (c === '.') return null
      const white = c === 'W' || (c >= '1' && c <= '9')
      const o = c === 'W' || c === 'I' ? 1 : white ? +c / 10 : (c.charCodeAt(0) - 96) / 10
      return <rect key={`${x},${y}`} x={x} y={y + top} width={1} height={1} fill={white ? WHITE : INDIGO} fillOpacity={o} />
    }),
  )
}

// Device pixel ratio as React state: zoom and moving between monitors swap the pixel master.
function subscribeDpr(onChange: () => void) {
  let mq = matchMedia(`(resolution: ${devicePixelRatio}dppx)`)
  const fire = () => {
    mq.removeEventListener('change', fire)
    mq = matchMedia(`(resolution: ${devicePixelRatio}dppx)`)
    mq.addEventListener('change', fire)
    onChange()
  }
  mq.addEventListener('change', fire)
  return () => mq.removeEventListener('change', fire)
}

/**
 * Alga Meet mark (Marca v2 · Encosto). Static: it is the logo, never a voice or activity indicator. When the rendered
 * size lands exactly on 16/20/24/32 device pixels (the title bar's 16 at 100/125/150/200 %) it draws the hand-fitted
 * pixel master; every other size draws the vector.
 */
export function LogoMark({ size = 24 }: { size?: number }) {
  const px = size * useSyncExternalStore(subscribeDpr, () => devicePixelRatio)
  const grid = Number.isInteger(px) ? GRIDS[px] : undefined
  return (
    <svg width={size} height={size} viewBox={grid ? `0 0 ${px} ${px}` : '0 0 256 256'} shapeRendering={grid ? 'crispEdges' : undefined} aria-hidden style={{ display: 'block', flexShrink: 0 }}>
      {grid ? (
        pixels(grid)
      ) : (
        <>
          <path d={TALL} fill={WHITE} />
          <path d={LEAN} fill={INDIGO} />
        </>
      )}
    </svg>
  )
}
