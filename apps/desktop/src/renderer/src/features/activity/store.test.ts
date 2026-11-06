import { beforeEach, describe, expect, it, vi } from 'vitest'

const sent: { op: string; activity: { name: string } | null }[] = []
vi.mock('@/store/session', () => ({
  onDispatch: () => () => undefined,
  useSession: { getState: () => ({ send: (f: never) => (sent.push(f), true) }) },
}))
vi.mock('@/store/data', async () => {
  const { create } = await import('zustand')
  return { useData: create(() => ({ me: { id: 'me', statusPreference: 'online' }, activities: {} })) }
})
vi.mock('../cinema/store', async () => {
  const { create } = await import('zustand')
  return { useCinema: create(() => ({ mine: { seated: false } })) }
})

const share = { value: true }
vi.stubGlobal('window', { alga: { activity: { current: async () => null, onChange: () => () => undefined, getShare: async () => share.value } } })

const { sharedActivity, startActivitySync, useMyActivity } = await import('./store')
const { useCinema } = await import('../cinema/store')
const flush = () => new Promise((r) => setTimeout(r, 0))
const last = () => sent.at(-1)?.activity ?? null

beforeEach(() => {
  sent.length = 0
  share.value = true
  useMyActivity.setState({ detected: null, pausedUntil: 0, cinema: null, share: false })
  useCinema.setState({ mine: { seated: false } } as never)
})

describe('cinema presence honours the activity-sharing opt-out', () => {
  it('sharedActivity: seated with sharing off publishes nothing; on, the cinema line', () => {
    expect(sharedActivity({ detected: null, pausedUntil: 0, cinema: 1, share: false })).toBeNull()
    expect(sharedActivity({ detected: null, pausedUntil: 0, cinema: 1, share: true })?.kind).toBe('video')
  })

  it('sharing off: sitting sends no activity; turning it on sends it, turning it off withdraws it', async () => {
    share.value = false
    const stop = startActivitySync()
    await flush()
    useCinema.setState({ mine: { seated: true } } as never)
    expect(sent.every((f) => f.activity === null)).toBe(true)
    useMyActivity.setState({ share: true })
    expect(last()?.name).toBeTruthy()
    useMyActivity.setState({ share: false })
    expect(last()).toBeNull()
    stop()
  })
})
