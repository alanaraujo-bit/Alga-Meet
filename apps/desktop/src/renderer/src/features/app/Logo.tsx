import { Fronds } from '../../ui/Fronds'

/**
 * Alga Meet mark: the three voice fronds in the Bioluminescência accent. Same geometry as the app icon
 * (`build/brand/`, Marca v1) and as the live `Fronds` glyph, which it renders.
 * `breathing` animates the fronds like a live voice envelope (splash, connecting states).
 */
export function LogoMark({ size = 24, breathing, mono }: { size?: number; breathing?: boolean; mono?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', flexShrink: 0, color: mono ? undefined : 'var(--accent)' }}>
      <Fronds size={size} breathing={breathing} />
    </span>
  )
}
