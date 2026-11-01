import type { Message } from '@alga/shared'
import { dayKey, dayLabel } from './format'

/** Consecutive messages from the same author within this window share one header. */
export const GROUP_WINDOW_MS = 7 * 60 * 1000

export type Row =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'unread'; key: 'unread' }
  | { kind: 'message'; key: string; message: Message; head: boolean }

/**
 * Flatten a chronological message list into render rows: day separators, the "new messages"
 * line and author grouping. `unreadAfter` is the last-read message id captured when the
 * channel was opened (so the line does not jump while the user reads).
 */
export function buildRows(messages: readonly Message[], opts: { unreadAfter?: string | null; meId?: string; now?: Date } = {}): Row[] {
  const rows: Row[] = []
  let prev: Message | null = null
  let prevDay = ''
  let unreadPlaced = !opts.unreadAfter
  for (const m of messages) {
    const at = new Date(m.createdAt)
    const day = dayKey(at)
    let head = false
    if (day !== prevDay) {
      rows.push({ kind: 'day', key: `day-${day}`, label: dayLabel(at, opts.now) })
      prevDay = day
      head = true
    }
    if (!unreadPlaced && m.id > opts.unreadAfter! && m.author.id !== opts.meId) {
      rows.push({ kind: 'unread', key: 'unread' })
      unreadPlaced = true
      head = true
    }
    if (
      !head &&
      (!prev ||
        prev.author.id !== m.author.id ||
        m.replyToId !== null ||
        at.getTime() - new Date(prev.createdAt).getTime() > GROUP_WINDOW_MS)
    )
      head = true
    rows.push({ kind: 'message', key: m.nonce ?? m.id, message: m, head })
    prev = m
  }
  return rows
}
