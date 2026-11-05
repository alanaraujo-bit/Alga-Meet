import { beforeEach, describe, expect, it, vi } from 'vitest'

const patchMe = vi.fn(async () => ({}))
const success = vi.fn()
vi.mock('@/store/actions', () => ({ patchMe }))
vi.mock('@/ui', () => ({ toast: { success } }))

const { useData } = await import('@/store/data')
const { startSetupEco } = await import('./setupEco')

const picked = { accent: '#f07a9a', eyes: 'wing', hair: 'braid', accessory: 'crown' }
const flush = () => new Promise((r) => setTimeout(r, 0))
const signIn = (eco?: object) => useData.setState({ me: { id: 'u1', displayName: 'Ana', ...(eco ? { eco } : {}) } as never })

describe('the Eco dressed during the install', () => {
  let file: unknown
  beforeEach(() => {
    patchMe.mockClear()
    success.mockClear()
    useData.setState({ me: null } as never)
    file = { ...picked }
    ;(globalThis as { window?: unknown }).window = { alga: { app: { takeSetupEco: vi.fn(async () => file) } } }
  })

  it('is worn on the first sign-in, once', async () => {
    const stop = startSetupEco()
    signIn()
    await flush()
    signIn()
    await flush()
    stop()
    expect(patchMe).toHaveBeenCalledTimes(1)
    expect(patchMe).toHaveBeenCalledWith({ eco: picked })
    expect(success).toHaveBeenCalledTimes(1)
  })

  it('never replaces an Eco already picked on the account, nor a malformed file', async () => {
    signIn({ ...picked, accent: '#e5484d' })
    startSetupEco()()
    await flush()
    file = { accent: 'red', eyes: 'x' }
    useData.setState({ me: null } as never)
    const stop = startSetupEco()
    signIn()
    await flush()
    stop()
    expect(patchMe).not.toHaveBeenCalled()
  })
})
