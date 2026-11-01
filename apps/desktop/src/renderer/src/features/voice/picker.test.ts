import { describe, expect, it } from 'vitest'
import { SCREEN_PRESETS, type ScreenPresetId } from '../../media/presets'
import { qualityAxes } from './picker'

const ps = (...ids: ScreenPresetId[]) => SCREEN_PRESETS.filter((p) => ids.includes(p.id))
const brief = (list: Array<{ value: string; label: string; locked: boolean }>) => list.map((c) => `${c.label}=${c.value}${c.locked ? ' (Plus)' : ''}`)

describe('screen picker quality', () => {
  // Free plan on a 1440p monitor with a hardware encoder.
  const offered = ps('720p30', '720p60', '1080p30')
  const locked = ps('1080p60', '1440p60')

  it('shows what the plan leaves out as locked, never a pair the hardware cannot do', () => {
    const q = qualityAxes(offered, locked, '1080p30')
    expect(brief(q.resolutions)).toEqual(['720p=720p30', '1080p=1080p30', '1440p=1440p60 (Plus)'])
    expect(brief(q.rates)).toEqual(['30 fps=1080p30', '60 fps=1080p60 (Plus)'])
  })

  it('changing the resolution keeps the frame rate, else lands on the nearest offered pair', () => {
    const q = qualityAxes(offered, locked, '720p60')
    expect(brief(q.resolutions)).toEqual(['720p=720p60', '1080p=1080p30', '1440p=1440p60 (Plus)'])
    expect(brief(q.rates)).toEqual(['30 fps=720p30', '60 fps=720p60'])
  })

  it('a resolution with one frame rate shows only that one (no 1440p 30, no 4K 60)', () => {
    const all = ps('720p30', '720p60', '1080p30', '1080p60', '1440p60', '2160p30')
    expect(brief(qualityAxes(all, [], '1440p60').rates)).toEqual(['60 fps=1440p60'])
    expect(brief(qualityAxes(all, [], '2160p30').rates)).toEqual(['30 fps=2160p30'])
    expect(brief(qualityAxes(all, [], '1080p60').resolutions)).toEqual(['720p=720p60', '1080p=1080p60', '1440p=1440p60', '4K=2160p30'])
  })

  it('a software encoder on a 1080p screen offers nothing above it', () => {
    const q = qualityAxes(ps('720p30', '720p60', '1080p30'), [], '1080p30')
    expect(q.resolutions.map((c) => c.label)).toEqual(['720p', '1080p'])
    expect(q.rates.every((c) => !c.locked)).toBe(true)
  })
})
