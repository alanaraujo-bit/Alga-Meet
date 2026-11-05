import { describe, expect, it } from 'vitest'
import { LATE_MS, cleanName, cooldownAfterPlay, filterSounds, lateDrop, shouldHear, tileState } from './logic'

describe('shouldHear', () => {
  it('deafened (self or server) or soundboard muted hears nothing', () => {
    expect(shouldHear({ deafened: false, serverDeaf: false, muted: false })).toBe(true)
    expect(shouldHear({ deafened: true, serverDeaf: false, muted: false })).toBe(false)
    expect(shouldHear({ deafened: false, serverDeaf: true, muted: false })).toBe(false)
    expect(shouldHear({ deafened: false, serverDeaf: false, muted: true })).toBe(false)
  })
})

describe('timing', () => {
  it('your cooldown ends 3 s after your sound', () => {
    expect(cooldownAfterPlay(10_000, 1200)).toBe(14_200)
  })
  it('a sound that arrives more than 1.5 s late is dropped', () => {
    expect(LATE_MS).toBe(1500)
    expect(lateDrop(1000, 2500)).toBe(false)
    expect(lateDrop(1000, 2501)).toBe(true)
  })
})

describe('tileState', () => {
  const base = { now: 1000, cooldownUntil: 0, cooldownFrom: 0, canUse: true, playingMine: null as null | { soundId: string; from: number; until: number } }
  it('ready, disabled', () => {
    expect(tileState({ ...base }, 's1')).toEqual({ kind: 'ready', progress: 0 })
    expect(tileState({ ...base, canUse: false }, 's1')).toEqual({ kind: 'disabled', progress: 0 })
  })
  it('playing shows progress on the tile you played', () => {
    const st = { ...base, now: 1500, cooldownFrom: 1000, cooldownUntil: 5000, playingMine: { soundId: 's1', from: 1000, until: 2000 } }
    expect(tileState(st, 's1')).toEqual({ kind: 'playing', progress: 0.5 })
    expect(tileState(st, 's2').kind).toBe('cooldown')
  })
  it('cooldown empties from 1 to 0', () => {
    const st = { ...base, now: 3000, cooldownFrom: 1000, cooldownUntil: 5000 }
    expect(tileState(st, 's1')).toEqual({ kind: 'cooldown', progress: 0.5 })
    expect(tileState({ ...st, now: 5000 }, 's1').kind).toBe('ready')
  })
})

describe('filterSounds', () => {
  const list = [{ name: 'Corneta' }, { name: 'Aplausos' }, { name: 'Não acredito' }]
  it('is accent- and case-insensitive', () => {
    expect(filterSounds(list, 'nao').map((s) => s.name)).toEqual(['Não acredito'])
    expect(filterSounds(list, 'COR').map((s) => s.name)).toEqual(['Corneta'])
    expect(filterSounds(list, '  ')).toHaveLength(3)
  })
})

describe('cleanName', () => {
  it('turns a file name into a sound name of at most 32 chars', () => {
    expect(cleanName('meu_som-legal (1).mp3')).toBe('meu som legal (1)')
    expect(cleanName('.wav')).toBe('Som')
    expect(cleanName('a'.repeat(50) + '.ogg')).toHaveLength(32)
  })
})

describe('roles screen', () => {
  it('lists both soundboard permissions', async () => {
    const { PERMISSION_GROUPS } = await import('../spaceSettings/strings')
    const keys = PERMISSION_GROUPS.flatMap((g) => g.items.map((i) => i.key))
    expect(keys).toContain('USE_SOUNDBOARD')
    expect(keys).toContain('MANAGE_SOUNDBOARD')
  })
})
