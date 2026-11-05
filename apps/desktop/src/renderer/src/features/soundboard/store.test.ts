import { beforeEach, describe, expect, it, vi } from 'vitest'

const player = vi.hoisted(() => ({
  playLocal: vi.fn(() => true), load: vi.fn(async () => ({}) as AudioBuffer), preload: vi.fn(async () => undefined),
  stopAll: vi.fn(), evict: vi.fn(), setSoundboardOutput: vi.fn(),
}))
vi.mock('./player', () => player)
vi.mock('@/store/session', () => ({ onDispatch: () => () => undefined }))
vi.mock('@/lib/api', () => ({ api: vi.fn(), upload: vi.fn(), ApiRequestError: class extends Error {} }))
vi.mock('@/store/data', async () => {
  const { create } = await import('zustand')
  return { useData: create(() => ({ me: { id: 'me' }, channels: { vc: { id: 'vc', spaceId: 'sp' } }, voiceStates: {} as Record<string, unknown> })) }
})
vi.mock('@/media/store', async () => {
  const { create } = await import('zustand')
  return { useMedia: create(() => ({ connection: { state: 'connected', channelId: 'vc' }, self: { deafened: false }, devices: { outputId: null } })) }
})

const { handleSoundboardDispatch, useSoundboard, setMuted } = await import('./store')
const { useMedia } = await import('@/media/store')
const { useData } = await import('@/store/data')

const play = (over: Partial<{ channelId: string; soundId: string; userId: string; durationMs: number }> = {}) =>
  handleSoundboardDispatch({ t: 'SOUNDBOARD_PLAY', d: { channelId: 'vc', soundId: 's1', userId: 'ana', playId: crypto.randomUUID(), durationMs: 800, ...over } })

beforeEach(() => {
  vi.clearAllMocks()
  player.playLocal.mockReturnValue(true)
  setMuted(false)
  useSoundboard.setState({ playing: {}, mine: null, cooldownUntil: 0, cooldownFrom: 0, bySpace: { sp: [{ id: 's1', spaceId: 'sp', name: 'Corneta', emoji: '📯', durationMs: 800, createdBy: 'me', createdAt: '' }] } })
  useMedia.setState({ connection: { state: 'connected', channelId: 'vc' }, self: { deafened: false } } as never)
  useData.setState({ voiceStates: {} } as never)
})

describe('SOUNDBOARD_PLAY', () => {
  it('plays and shows who played', () => {
    play()
    expect(player.playLocal).toHaveBeenCalledWith('s1', 0.7)
    expect(useSoundboard.getState().playing.ana).toMatchObject({ soundId: 's1', emoji: '📯', name: 'Corneta' })
  })
  it('deafened, server-deafened or muted soundboard: shown, not played', () => {
    useMedia.setState({ self: { deafened: true } } as never)
    play()
    useMedia.setState({ self: { deafened: false } } as never)
    useData.setState({ voiceStates: { me: { serverDeaf: true } } } as never)
    play({ userId: 'bia' })
    useData.setState({ voiceStates: {} } as never)
    setMuted(true)
    play({ userId: 'caio' })
    expect(player.playLocal).not.toHaveBeenCalled()
    expect(Object.keys(useSoundboard.getState().playing).sort()).toEqual(['ana', 'bia', 'caio'])
  })
  it('ignores other channels and unknown ids without throwing', () => {
    play({ channelId: 'other' })
    expect(player.playLocal).not.toHaveBeenCalled()
    player.playLocal.mockReturnValue(false)
    player.load.mockResolvedValueOnce(null as never)
    expect(() => play({ soundId: 'gone' })).not.toThrow()
    expect(useSoundboard.getState().playing.ana?.name).toBe('um som')
  })
  it('your own play starts the cooldown at end + 3 s', () => {
    const before = Date.now()
    play({ userId: 'me', durationMs: 1000 })
    const st = useSoundboard.getState()
    expect(st.cooldownUntil).toBeGreaterThanOrEqual(before + 4000)
    expect(st.mine?.soundId).toBe('s1')
  })
  it('drops a sound that finishes downloading too late', async () => {
    vi.useFakeTimers()
    player.playLocal.mockReturnValue(false)
    let resolve!: (b: AudioBuffer) => void
    player.load.mockReturnValueOnce(new Promise((r) => { resolve = r }))
    play({ soundId: 'slow' })
    vi.advanceTimersByTime(1600)
    resolve({} as AudioBuffer)
    await vi.runAllTimersAsync()
    expect(player.playLocal).toHaveBeenCalledTimes(1) // the first, cache-miss attempt only
    vi.useRealTimers()
  })
})

describe('SPACE_SOUNDS_UPDATE', () => {
  it('replaces the list and evicts deleted sounds', () => {
    handleSoundboardDispatch({ t: 'SPACE_SOUNDS_UPDATE', d: { spaceId: 'sp', sounds: [] } })
    expect(useSoundboard.getState().bySpace.sp).toEqual([])
    expect(player.evict).toHaveBeenCalledWith('s1')
  })
})

describe('leaving or switching the call', () => {
  it('closes the editor and the panel and stops sounds when the call ends', async () => {
    const { startSoundboard } = await import('./store')
    const off = startSoundboard()
    useSoundboard.setState({ open: true, editor: { spaceId: 'sp' } })
    useMedia.setState({ connection: { state: 'idle', channelId: null } } as never)
    expect(useSoundboard.getState().editor).toBeNull()
    expect(useSoundboard.getState().open).toBe(false)
    expect(player.stopAll).toHaveBeenCalled()
    off()
  })
  it('switching channel in the same space clears who-played and stops old sounds', async () => {
    const { startSoundboard } = await import('./store')
    useData.setState({ channels: { vc: { id: 'vc', spaceId: 'sp' }, vc2: { id: 'vc2', spaceId: 'sp' } } } as never)
    useMedia.setState({ connection: { state: 'connected', channelId: 'vc' } } as never)
    const off = startSoundboard()
    play()
    vi.clearAllMocks()
    useMedia.setState({ connection: { state: 'connected', channelId: 'vc2' } } as never)
    expect(useSoundboard.getState().playing).toEqual({})
    expect(player.stopAll).toHaveBeenCalled()
    off()
  })
})
