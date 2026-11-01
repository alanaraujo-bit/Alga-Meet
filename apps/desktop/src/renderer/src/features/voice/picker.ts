// The screen-share quality list shown as two controls (resolution, frame rate). Pure: unit-tested.
import type { ScreenPreset, ScreenPresetId } from '@/media'

/** One segment. `value` is the preset that picking it selects, so each control just sets the quality. */
export interface QualityChoice {
  value: ScreenPresetId
  label: string
  locked: boolean
}

const nearestFps = (list: ScreenPreset[], fps: number) => list.reduce((a, b) => (Math.abs(b.fps - fps) < Math.abs(a.fps - fps) ? b : a))

/**
 * `offered` (machine and plan) and `locked` (machine, not plan) are the only presets that can appear: a pair the
 * hardware can't do never shows. Resolutions: every one this machine sustains, locked when the plan offers nothing
 * there; picking one keeps the frame rate when it can, else the nearest offered one. Rates: those that exist at the
 * current resolution, locked when the plan doesn't include that pair. `current` must be offered.
 */
export function qualityAxes(offered: readonly ScreenPreset[], locked: readonly ScreenPreset[], current: ScreenPresetId): { resolutions: QualityChoice[]; rates: QualityChoice[] } {
  const cur = offered.find((p) => p.id === current) ?? offered[0]!
  const isLocked = (p: ScreenPreset) => locked.some((l) => l.id === p.id)
  const all = [...offered, ...locked]
  const heights = [...new Set(all.map((p) => p.height))].sort((a, b) => a - b)
  const resolutions = heights.map((h) => {
    const open = offered.filter((p) => p.height === h)
    const pick = nearestFps(open.length ? open : all.filter((p) => p.height === h), cur.fps)
    return { value: pick.id, label: pick.label.split(' ')[0]!, locked: !open.length }
  })
  const rates = all
    .filter((p) => p.height === cur.height)
    .sort((a, b) => a.fps - b.fps)
    .map((p) => ({ value: p.id, label: `${p.fps} fps`, locked: isLocked(p) }))
  return { resolutions, rates }
}
