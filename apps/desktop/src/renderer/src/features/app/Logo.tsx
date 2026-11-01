/**
 * Alga Meet mark: three voice "fronds" (an algae / level meter hybrid) in the Bioluminescência accent.
 * `breathing` animates the fronds like a live voice envelope (splash, connecting states).
 */
export function LogoMark({ size = 24, breathing, mono }: { size?: number; breathing?: boolean; mono?: boolean }) {
  const fill = mono ? 'currentColor' : 'var(--accent)'
  const bar = (x: number, h: number, delay: number) => (
    <rect
      x={x}
      y={12 - h / 2}
      width="4"
      height={h}
      rx="2"
      fill={fill}
      style={
        breathing
          ? { transformOrigin: `${x + 2}px 12px`, animation: `frond 1.4s ${delay}ms var(--ease-in-out-cubic) infinite` }
          : undefined
      }
    />
  )
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden style={{ flexShrink: 0, overflow: 'visible' }}>
      {bar(3, 10, 0)}
      {bar(10, 18, 180)}
      {bar(17, 12, 360)}
    </svg>
  )
}
