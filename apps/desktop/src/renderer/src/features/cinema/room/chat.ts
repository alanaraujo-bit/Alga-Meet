// The room's live chat (like a live stream's): for whoever is without a headset, or does not want to talk over the
// film. Short lines that rise in the corner and leave on their own; Enter to write. Relayed by the server to the
// seats (CINEMA_CHAT), never stored: what was said lives here until the session ends.
import { CINEMA_CHAT_RATE, cinemaChatText } from '@alga/shared'
import { create } from 'zustand'
import { onDispatch } from '@/store/session'
import { send, useCinema } from '../store'

/** A line stays this long over the film while nobody is writing. */
export const CHAT_SHOW_MS = 8_000
/** At most this many over the film at once (the newest). */
export const CHAT_VISIBLE = 4
/** While writing, the recent conversation, old or not. */
export const CHAT_OPEN_VISIBLE = 8
/** Kept in memory for the session. */
export const CHAT_HISTORY = 50

/** `at`: when it arrived HERE (Date.now()): the fade must not depend on the server's clock. */
export interface ChatMessage { id: string; userId: string; text: string; at: number }

export function visibleMessages(list: ChatMessage[], now: number, open: boolean): ChatMessage[] {
  if (open) return list.slice(-CHAT_OPEN_VISIBLE)
  return list.slice(-CHAT_VISIBLE).filter((m) => now - m.at < CHAT_SHOW_MS)
}

/** When the next shown line runs out (ms epoch), or null: nothing shown, or the field is open (nothing leaves then). */
export function nextExpiry(list: ChatMessage[], now: number, open: boolean): number | null {
  if (open) return null
  const shown = visibleMessages(list, now, false)
  return shown.length ? Math.min(...shown.map((m) => m.at + CHAT_SHOW_MS)) : null
}

export function addMessage(list: ChatMessage[], m: ChatMessage): ChatMessage[] {
  if (list.some((x) => x.id === m.id)) return list
  return [...list, m].slice(-CHAT_HISTORY)
}

interface ChatState { messages: ChatMessage[]; open: boolean }
export const useChat = create<ChatState>(() => ({ messages: [], open: false }))

export const openChat = (): void => useChat.setState({ open: true })
export const closeChat = (): void => useChat.setState({ open: false })

let bucket = { tokens: CINEMA_CHAT_RATE.burst as number, at: 0 }
export const resetChatRate = (): void => void (bucket = { tokens: CINEMA_CHAT_RATE.burst, at: 0 })

/** 'slow': the server would drop it (same bucket), so it is not sent and the text stays in the field. */
export function sendChat(raw: string): 'sent' | 'empty' | 'slow' {
  const text = cinemaChatText(raw)
  const s = useCinema.getState().session
  if (!text || !s) return 'empty'
  const now = Date.now()
  const tokens = Math.min(CINEMA_CHAT_RATE.burst, bucket.tokens + (bucket.at ? ((now - bucket.at) / 1000) * CINEMA_CHAT_RATE.perSecond : 0))
  if (tokens < 1) {
    bucket = { tokens, at: now }
    return 'slow'
  }
  bucket = { tokens: tokens - 1, at: now }
  send({ op: 'cinema_chat', sessionId: s.sessionId, text })
  return 'sent'
}

/** While the room is mounted: the lines of my session. Returns the cleanup (the conversation goes with it). */
export function startChat(): () => void {
  const off = onDispatch((d) => {
    if (d.t !== 'CINEMA_CHAT') return
    const s = useCinema.getState().session
    if (!s || d.d.sessionId !== s.sessionId) return
    const m = { id: d.d.id, userId: d.d.userId, text: d.d.text, at: Date.now() }
    useChat.setState((st) => {
      const messages = addMessage(st.messages, m)
      return messages === st.messages ? st : { messages }
    })
  })
  return () => {
    off()
    useChat.setState({ messages: [], open: false })
  }
}
