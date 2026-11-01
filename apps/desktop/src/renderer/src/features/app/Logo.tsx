import { Fronds } from '../../ui/Fronds'

/**
 * Alga Meet mark: the three voice fronds, lit white fading into the soft indigo (Marca v2, Direção B). Same geometry
 * as the app icon (`build/brand/`) and as the live `Fronds` glyph, which it renders.
 * `breathing` animates the fronds like a live voice envelope (splash, connecting states); `mono` = currentColor.
 */
export function LogoMark({ size = 24, breathing, mono }: { size?: number; breathing?: boolean; mono?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', flexShrink: 0 }}>
      <Fronds size={size} breathing={breathing} brand={!mono} />
    </span>
  )
}
