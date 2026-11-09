import type { FeedbackItem } from '@alga/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const upload = vi.fn()
const api = vi.fn()
vi.mock('@/lib/api', async (original) => ({ ...(await original<typeof import('@/lib/api')>()), upload, api }))
vi.mock('@/media', () => ({ useMedia: { getState: () => ({ screen: { active: true } }) } }))
// The real ui store applies preferences to the document at import: not here (node).
vi.mock('@/store/ui', () => ({ useUi: { getState: () => ({ view: { kind: 'space', spaceId: 's1', channelId: 'c1' } }) } }))
vi.mock('../cinema/store', () => ({ useCinema: { getState: () => ({ session: null }) } }))
const moment = { inCall: false, gaming: false, overlay: false, attentive: true }
const whatsNew = { welcome: null as object | null }
vi.mock('../whatsnew/store', () => ({ currentMoment: () => moment, useWhatsNew: { getState: () => whatsNew } }))

const store = new Map<string, string>()
const bridge = {
  recentLog: vi.fn(async (previous: boolean) => (previous ? 'old session\n' : 'this session\n')),
  captureWindow: vi.fn(async (): Promise<Uint8Array | null> => new Uint8Array([137, 80, 78, 71])),
  takeCrash: vi.fn(async (): Promise<{ kind: 'renderer' | 'unresponsive'; at: number; version: string } | null> => null),
}
Object.assign(globalThis, {
  window: { alga: { app: bridge, config: { version: '0.1.15', osVersion: 'Windows 11' } } },
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
})

const { ApiRequestError } = await import('@/lib/api')
const { useData } = await import('@/store/data')
const { draftKey } = await import('./logic')
const f = await import('./store')
const { useFeedback } = f

const item: FeedbackItem = { id: 'f1', kind: 'bug', text: 'áudio some', createdAt: '2026-11-09T12:00:00.000Z', hasScreenshot: true }
const signIn = (id = 'u1') => useData.setState({ me: { id, displayName: 'Ana Novidades' } as never })
const flush = () => new Promise((r) => setTimeout(r, 0))
const sentForm = (call = 0) => upload.mock.calls[call]![2] as FormData

beforeEach(() => {
  f.resetFeedback()
  store.clear()
  upload.mockReset()
  api.mockReset().mockResolvedValue([])
  for (const fn of Object.values(bridge)) fn.mockClear()
  moment.inCall = false
  whatsNew.welcome = null
  signIn()
})

describe('sending', () => {
  it('a failed send keeps text, kind and screenshot, and the retry sends the same thing', async () => {
    upload.mockRejectedValueOnce(new ApiRequestError(0, 'network', 'Não foi possível falar com o servidor. Verifique sua conexão.')).mockResolvedValueOnce(item)
    f.openFeedback({ kind: 'bug' })
    f.setText('áudio some')
    f.setShot(new Blob(['x'], { type: 'image/png' }))
    await f.send()
    expect(useFeedback.getState()).toMatchObject({ phase: 'error', pane: 'form', text: 'áudio some', kind: 'bug', error: 'Não foi possível falar com o servidor. Verifique sua conexão.' })
    expect(useFeedback.getState().shot).not.toBeNull()
    await f.send()
    expect(useFeedback.getState()).toMatchObject({ phase: 'idle', pane: 'sent', text: '', shot: null, last: item, error: null })
    expect(sentForm(1).get('text')).toBe('áudio some')
    expect(sentForm(1).get('screenshot')).toBeInstanceOf(Blob)
  })

  it('says to wait on 429 and keeps the text', async () => {
    upload.mockRejectedValueOnce(new ApiRequestError(429, 'rate_limited', 'Muitas requisições. Tente novamente em instantes.'))
    f.openFeedback()
    f.setText('uma ideia')
    await f.send()
    expect(useFeedback.getState()).toMatchObject({ phase: 'error', text: 'uma ideia', error: 'Muitas tentativas. Aguarde um pouco e tente de novo.' })
  })

  it('posts kind, trimmed text and a context with no ids', async () => {
    upload.mockResolvedValue(item)
    f.openFeedback()
    f.setText('  fixar mensagens  ')
    await f.send()
    expect(upload.mock.calls[0]!.slice(0, 2)).toEqual(['POST', '/feedback'])
    expect(sentForm().get('kind')).toBe('idea')
    expect(sentForm().get('text')).toBe('fixar mensagens')
    expect(JSON.parse(sentForm().get('context') as string)).toEqual({ view: 'space', inCall: false, sharing: true, cinema: false, crash: null })
    expect(sentForm().has('screenshot')).toBe(false)
  })

  it('sends the log for a bug, not for an idea, and not when turned off', async () => {
    upload.mockResolvedValue(item)
    f.openFeedback({ kind: 'bug' })
    await flush()
    f.setText('x')
    await f.send()
    expect(sentForm(0).get('log')).toBe('this session\n')

    f.openFeedback({ kind: 'idea' })
    f.setText('x')
    await f.send()
    expect(sentForm(1).has('log')).toBe(false)

    f.openFeedback({ kind: 'crash' })
    await flush()
    f.setLogOn(false)
    f.setText('x')
    await f.send()
    expect(sentForm(2).has('log')).toBe(false)
  })

  it('loads the log when the kind changes to one that takes it', async () => {
    f.openFeedback()
    await flush()
    expect(bridge.recentLog).not.toHaveBeenCalled()
    f.setKind('bug')
    await flush()
    expect(useFeedback.getState().log).toBe('this session\n')
  })

  it('an empty text is never sent, and a second click while sending does nothing', async () => {
    f.openFeedback()
    f.setText('   ')
    await f.send()
    expect(upload).not.toHaveBeenCalled()
    let done!: (v: FeedbackItem) => void
    upload.mockReturnValueOnce(new Promise<FeedbackItem>((r) => { done = r }))
    f.setText('ok')
    const first = f.send()
    await f.send()
    expect(upload).toHaveBeenCalledTimes(1)
    expect(useFeedback.getState().phase).toBe('sending')
    done(item)
    await first
  })

  it('once sent, the draft is gone and the item leads "Seus envios"', async () => {
    upload.mockResolvedValue(item)
    api.mockResolvedValue([{ ...item, id: 'f0' }])
    f.openFeedback({ kind: 'bug' })
    await flush()
    f.setText('áudio some')
    expect(store.get(draftKey('u1'))).toBeTruthy()
    await f.send()
    expect(store.has(draftKey('u1'))).toBe(false)
    expect(useFeedback.getState().mine?.map((m) => m.id)).toEqual(['f1', 'f0'])
  })
})

describe('draft', () => {
  it('closing keeps the draft and a restart restores it', () => {
    f.openFeedback({ kind: 'bug' })
    f.setText('ainda escrevendo')
    f.closeFeedback()
    expect(useFeedback.getState().open).toBe(false)
    f.resetFeedback() // the app restarted
    f.openFeedback()
    expect(useFeedback.getState()).toMatchObject({ open: true, pane: 'form', kind: 'bug', text: 'ainda escrevendo' })
  })

  it('is per account, and signing out leaves nothing in memory', () => {
    f.openFeedback()
    f.setText('da Ana')
    f.resetFeedback()
    expect(useFeedback.getState()).toMatchObject({ open: false, text: '', shot: null })
    signIn('u2')
    f.openFeedback()
    expect(useFeedback.getState().text).toBe('')
  })

  it('typing after a failure clears the error', async () => {
    upload.mockRejectedValueOnce(new Error('boom'))
    f.openFeedback()
    f.setText('a')
    await f.send()
    expect(useFeedback.getState().phase).toBe('error')
    f.setText('ab')
    expect(useFeedback.getState()).toMatchObject({ phase: 'idle', error: null })
  })
})

describe('screenshot', () => {
  it('captures the window with the card hidden and keeps the picture', async () => {
    let hiddenDuringCapture = false
    bridge.captureWindow.mockImplementationOnce(async () => {
      hiddenDuringCapture = useFeedback.getState().capturing
      return new Uint8Array([137, 80, 78, 71])
    })
    f.openFeedback()
    expect(await f.captureShot()).toBe(true)
    expect(hiddenDuringCapture).toBe(true)
    const st = useFeedback.getState()
    expect(st.capturing).toBe(false)
    expect(st.shot?.blob.type).toBe('image/png')
    expect(st.shot?.blob.size).toBe(4)
  })

  it('a capture that fails leaves the card as it was', async () => {
    bridge.captureWindow.mockResolvedValueOnce(null)
    f.openFeedback()
    expect(await f.captureShot()).toBe(false)
    expect(useFeedback.getState()).toMatchObject({ capturing: false, shot: null })
    bridge.captureWindow.mockRejectedValueOnce(new Error('forbidden'))
    expect(await f.captureShot()).toBe(false)
    expect(useFeedback.getState().capturing).toBe(false)
  })
})

describe('"Seus envios"', () => {
  it('lists what the server has, and says so when it cannot', async () => {
    api.mockResolvedValue([item])
    f.openFeedback()
    await f.showMine()
    expect(useFeedback.getState()).toMatchObject({ pane: 'mine', mine: [item], mineError: false })
    api.mockRejectedValueOnce(new Error('offline'))
    await f.showMine()
    expect(useFeedback.getState()).toMatchObject({ pane: 'mine', mine: [item], mineError: true })
  })
})

describe('answering the offer after a crash', () => {
  const crash = { kind: 'renderer', at: 1, version: '0.1.15' } as const

  it('"Agora não" consumes it and opens nothing', () => {
    useFeedback.setState({ offer: crash })
    f.answerOffer(false)
    expect(useFeedback.getState()).toMatchObject({ offer: null, open: false })
  })

  it('"Contar" opens the card on "Travou" with the log of the session that crashed', async () => {
    upload.mockResolvedValue(item)
    useFeedback.setState({ offer: crash })
    f.answerOffer(true)
    await flush()
    expect(useFeedback.getState()).toMatchObject({ offer: null, open: true, kind: 'crash', crash, log: 'old session\n' })
    expect(bridge.recentLog).toHaveBeenCalledWith(true)
    f.setText('abri o cinema e congelou')
    await f.send()
    expect(JSON.parse(sentForm().get('context') as string).crash).toBe('renderer')
    expect(sentForm().get('log')).toBe('old session\n')
    expect(useFeedback.getState().crash).toBeNull()
  })
})
