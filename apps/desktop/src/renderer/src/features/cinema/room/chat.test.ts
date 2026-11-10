import type { Dispatch } from '@alga/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const listeners: Array<(d: Dispatch) => void> = []
vi.mock('@/store/session', () => ({
  onDispatch: (fn: (d: Dispatch) => void) => {
    listeners.push(fn)
    return () => listeners.splice(listeners.indexOf(fn), 1)
  },
}))
const sent: unknown[] = []
const session = { sessionId: 's1' } as { sessionId: string } | null
const cinema = { session }
vi.mock('../store', () => ({
  useCinema: { getState: () => cinema },
  send: (f: unknown) => void sent.push(f),
}))

const { CHAT_HISTORY, CHAT_OPEN_VISIBLE, CHAT_SHOW_MS, CHAT_VISIBLE, addMessage, resetChatRate, sendChat, startChat, useChat, visibleMessages } = await import('./chat')

const m = (id: number, at: number, userId = 'u1') => ({ id: `m${id}`, userId, text: `t${id}`, at })
const deliver = (d: Partial<{ sessionId: string; id: string; userId: string; text: string; at: number }>) => {
  for (const l of [...listeners]) l({ t: 'CINEMA_CHAT', d: { sessionId: 's1', id: 'x', userId: 'u2', text: 'oi', at: 1, ...d } } as Dispatch)
}

beforeEach(() => {
  sent.length = 0
  cinema.session = { sessionId: 's1' }
  resetChatRate()
})

describe('what the room shows', () => {
  it('closed: only the latest few, and each one only for a while (a live chat, not a log over the film)', () => {
    const list = [1, 2, 3, 4, 5, 6].map((i) => m(i, 1000 + i))
    expect(visibleMessages(list, 2000, false).map((x) => x.id)).toEqual(['m3', 'm4', 'm5', 'm6'])
    expect(CHAT_VISIBLE).toBe(4)
    expect(visibleMessages(list, 1003 + CHAT_SHOW_MS, false).map((x) => x.id)).toEqual(['m4', 'm5', 'm6'])
    expect(visibleMessages(list, 1006 + CHAT_SHOW_MS, false)).toEqual([])
  })

  it('open (writing): the recent conversation, old or not', () => {
    const list = Array.from({ length: 12 }, (_, i) => m(i, 0))
    expect(visibleMessages(list, 10 * CHAT_SHOW_MS, true)).toHaveLength(CHAT_OPEN_VISIBLE)
    expect(visibleMessages(list, 10 * CHAT_SHOW_MS, true).at(-1)!.id).toBe('m11')
  })

  it('keeps a bounded history and never shows a message twice', () => {
    let list: ReturnType<typeof m>[] = []
    for (let i = 0; i < CHAT_HISTORY + 10; i++) list = addMessage(list, m(i, i))
    expect(list).toHaveLength(CHAT_HISTORY)
    expect(list[0]!.id).toBe('m10')
    expect(addMessage(list, m(CHAT_HISTORY + 9, 0))).toBe(list)
  })
})

describe('sending', () => {
  it('sends one clean line to my session', () => {
    expect(sendChat('  que\ncena  ')).toBe('sent')
    expect(sent).toEqual([{ op: 'cinema_chat', sessionId: 's1', text: 'que cena' }])
  })

  it('nothing to send: blanks, or no session', () => {
    expect(sendChat(' \n ')).toBe('empty')
    cinema.session = null
    expect(sendChat('oi')).toBe('empty')
    expect(sent).toEqual([])
  })

  it('follows the server limit (4 in a row, then one every 2 s), so a message is never lost in silence', () => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
    for (let i = 0; i < 4; i++) expect(sendChat(`m${i}`)).toBe('sent')
    expect(sendChat('m4')).toBe('slow')
    vi.setSystemTime(12_000)
    expect(sendChat('m5')).toBe('sent')
    expect(sent).toHaveLength(5)
    vi.useRealTimers()
  })
})

describe('receiving', () => {
  it('keeps the messages of my session with the time they arrived here, and forgets them when it stops', () => {
    vi.useFakeTimers()
    vi.setSystemTime(5000)
    const stop = startChat()
    deliver({ id: 'a', text: 'oi', at: 1 })
    deliver({ id: 'b', sessionId: 'other' })
    deliver({ id: 'a' })
    expect(useChat.getState().messages).toEqual([{ id: 'a', userId: 'u2', text: 'oi', at: 5000 }])
    stop()
    expect(useChat.getState()).toMatchObject({ messages: [], open: false })
    vi.useRealTimers()
  })
})

describe('when the room has to look again', () => {
  it('at the moment the oldest shown line runs out, nothing while writing or with nothing shown', async () => {
    const { nextExpiry } = await import('./chat')
    const list = [m(1, 1000), m(2, 3000)]
    expect(nextExpiry(list, 2000, false)).toBe(1000 + CHAT_SHOW_MS)
    expect(nextExpiry(list, 1000 + CHAT_SHOW_MS, false)).toBe(3000 + CHAT_SHOW_MS)
    expect(nextExpiry(list, 3000 + CHAT_SHOW_MS, false)).toBeNull()
    expect(nextExpiry(list, 2000, true)).toBeNull()
    expect(nextExpiry([], 0, false)).toBeNull()
  })
})
