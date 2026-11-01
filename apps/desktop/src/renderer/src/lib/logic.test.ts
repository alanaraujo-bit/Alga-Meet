import type { Channel, Message, ReadState, Relationship } from '@alga/shared'
import { describe, expect, it } from 'vitest'
import { patchReaction } from '../store/data'
import { homeBadge, spaceUnread } from '../store/selectors'
import { place } from '../ui/floating'
import { fuzzyScore } from './fuzzy'
import { parseInviteCode } from './invite'
import { buildRows, GROUP_WINDOW_MS } from './grouping'
import { mentionedIds, parseMarkdown, safeUrl, toPlainText, type MdNode } from './markdown'

const A = { id: 'a', username: 'ana', displayName: 'Ana', avatarUrl: null, accentColor: null, bio: '' }
const B = { ...A, id: 'b', username: 'bia', displayName: 'Bia' }
let seq = 0
const msg = (author: typeof A, at: string, extra: Partial<Message> = {}): Message => ({
  id: `0000000${++seq}`.slice(-8),
  channelId: 'c',
  author,
  content: 'oi',
  createdAt: at,
  editedAt: null,
  replyToId: null,
  reactions: [],
  attachments: [],
  ...extra,
})

describe('buildRows (grouping)', () => {
  const now = new Date('2026-11-01T15:00:00')
  it('groups same author within 7 minutes and splits on author/time/reply', () => {
    seq = 0
    const t0 = new Date('2026-11-01T14:00:00').getTime()
    const iso = (ms: number) => new Date(t0 + ms).toISOString()
    const ms = [
      msg(A, iso(0)),
      msg(A, iso(60_000)),
      msg(A, iso(60_000 + GROUP_WINDOW_MS + 1)), // gap > 7min
      msg(B, iso(GROUP_WINDOW_MS + 120_000)), // other author
      msg(B, iso(GROUP_WINDOW_MS + 130_000), { replyToId: 'x' }), // replies always head
    ]
    const rows = buildRows(ms, { now })
    expect(rows[0]).toMatchObject({ kind: 'day', label: 'Hoje' })
    expect(rows.slice(1).map((r) => r.kind === 'message' && r.head)).toEqual([true, false, true, true, true])
  })

  it('adds a day separator per calendar day and restarts groups', () => {
    seq = 0
    const rows = buildRows([msg(A, new Date('2026-10-31T23:58:00').toISOString()), msg(A, new Date('2026-11-01T00:01:00').toISOString())], { now })
    expect(rows.map((r) => r.kind)).toEqual(['day', 'message', 'day', 'message'])
    expect(rows[0]).toMatchObject({ label: 'Ontem' })
    expect(rows[3]).toMatchObject({ head: true })
  })

  it('places the unread line once, before the first unread message from someone else', () => {
    seq = 0
    const t = new Date('2026-11-01T14:00:00').toISOString()
    const m1 = msg(A, t)
    const m2 = msg(B, t) // mine, after read marker: no line
    const m3 = msg(A, t)
    const m4 = msg(A, t)
    const rows = buildRows([m1, m2, m3, m4], { now, unreadAfter: m1.id, meId: 'b' })
    const kinds = rows.map((r) => r.kind)
    expect(kinds.filter((k) => k === 'unread')).toHaveLength(1)
    const at = kinds.indexOf('unread')
    expect(rows[at + 1]).toMatchObject({ kind: 'message', head: true, message: { id: m3.id } })
    expect(rows[at + 2]).toMatchObject({ head: false, message: { id: m4.id } })
  })

  it('no unread line when the read marker is null or at the end', () => {
    seq = 0
    const t = new Date('2026-11-01T14:00:00').toISOString()
    const list = [msg(A, t), msg(A, t)]
    expect(buildRows(list, { now, unreadAfter: null }).some((r) => r.kind === 'unread')).toBe(false)
    expect(buildRows(list, { now, unreadAfter: list[1]!.id }).some((r) => r.kind === 'unread')).toBe(false)
  })
})

describe('markdown', () => {
  const kinds = (ns: MdNode[]) => ns.map((n) => n.t)
  it('parses inline styles', () => {
    expect(parseMarkdown('**negrito** e *itálico* e `code` e ~~riscado~~')).toEqual([
      { t: 'strong', c: [{ t: 'text', v: 'negrito' }] },
      { t: 'text', v: ' e ' },
      { t: 'em', c: [{ t: 'text', v: 'itálico' }] },
      { t: 'text', v: ' e ' },
      { t: 'code', v: 'code' },
      { t: 'text', v: ' e ' },
      { t: 'del', c: [{ t: 'text', v: 'riscado' }] },
    ])
  })
  it('keeps snake_case and lone asterisks as text', () => {
    expect(parseMarkdown('var_nome_longo 2 * 3 = 6')).toEqual([{ t: 'text', v: 'var_nome_longo 2 * 3 = 6' }])
  })
  it('does not parse markdown inside inline code', () => {
    expect(parseMarkdown('`**x**`')).toEqual([{ t: 'code', v: '**x**' }])
  })
  it('fenced code blocks keep content verbatim', () => {
    const ns = parseMarkdown('antes\n```ts\nconst a = **1**\n```\ndepois')
    expect(kinds(ns)).toEqual(['text', 'pre', 'text'])
    expect(ns[1]).toEqual({ t: 'pre', v: 'const a = **1**', lang: 'ts' })
  })
  it('links only for http(s); trailing punctuation excluded', () => {
    expect(parseMarkdown('veja https://alga.app/x.')).toEqual([
      { t: 'text', v: 'veja ' },
      { t: 'link', href: 'https://alga.app/x', c: [{ t: 'text', v: 'https://alga.app/x' }] },
      { t: 'text', v: '.' },
    ])
    expect(kinds(parseMarkdown('[clique](javascript:alert(1))'))).toEqual(['text'])
    expect(parseMarkdown('[site](https://a.b)')).toEqual([{ t: 'link', href: 'https://a.b/', c: [{ t: 'text', v: 'site' }] }])
    expect(safeUrl('data:text/html,x')).toBeNull()
    expect(safeUrl('file:///C:/x')).toBeNull()
  })
  it('never emits raw HTML: tags stay text', () => {
    expect(parseMarkdown('<img src=x onerror=alert(1)>')).toEqual([{ t: 'text', v: '<img src=x onerror=alert(1)>' }])
  })
  it('mentions', () => {
    const id = '0190f0b2-1234-7abc-8def-0123456789ab'
    expect(parseMarkdown(`oi <@${id}>!`)).toEqual([{ t: 'text', v: 'oi ' }, { t: 'mention', id }, { t: 'text', v: '!' }])
    expect(mentionedIds(`<@${id}> <@${id.toUpperCase()}>`)).toEqual([id, id])
    expect(toPlainText(`**oi** <@${id}>`, () => 'Ana')).toBe('oi @Ana')
  })
  it('escapes and depth limit', () => {
    expect(parseMarkdown('\\*não\\*')).toEqual([{ t: 'text', v: '*não*' }])
    const deep = '**'.repeat(20) + 'x' + '**'.repeat(20)
    expect(() => parseMarkdown(deep)).not.toThrow()
  })
})

describe('fuzzyScore', () => {
  it('ranks prefix > substring > subsequence and folds accents', () => {
    const p = fuzzyScore('ger', 'geral')!
    const s = fuzzyScore('ral', 'geral')!
    const q = fuzzyScore('grl', 'geral')!
    expect(p).toBeGreaterThan(s)
    expect(s).toBeGreaterThan(q)
    expect(fuzzyScore('joao', 'João Silva')).not.toBeNull()
    expect(fuzzyScore('xyz', 'geral')).toBeNull()
  })
})

describe('place (floating)', () => {
  const vp = { width: 800, height: 600 }
  it('flips when there is no room and clamps to the viewport', () => {
    const anchor = { left: 10, top: 5, width: 20, height: 20 }
    const r = place(anchor, { width: 100, height: 40 }, 'top', 'center', 8, vp)
    expect(r.side).toBe('bottom')
    expect(r.left).toBe(8)
    expect(r.top).toBe(33)
  })
})

describe('unread + reactions', () => {
  const ch = (id: string, extra: Partial<Channel>): Channel => ({ id, type: 'text', spaceId: 's', name: id, topic: '', position: 0, lastMessageId: null, ...extra })
  const rs = (channelId: string, lastReadMessageId: string | null, mentionCount = 0): ReadState => ({ channelId, lastReadMessageId, mentionCount })
  it('spaceUnread aggregates text channels only', () => {
    const channels = {
      a: ch('a', { lastMessageId: '05' }),
      b: ch('b', { lastMessageId: '09' }),
      v: ch('v', { type: 'voice', lastMessageId: '09' }),
      o: ch('o', { spaceId: 'other', lastMessageId: '09' }),
    }
    expect(spaceUnread({ channels, readStates: { a: rs('a', '05'), b: rs('b', '09') } }, 's')).toEqual({ unread: false, mentions: 0 })
    expect(spaceUnread({ channels, readStates: { a: rs('a', '04', 2), b: rs('b', '09') } }, 's')).toEqual({ unread: true, mentions: 2 })
    expect(spaceUnread({ channels, readStates: {} }, 's').unread).toBe(true)
  })
  it('homeBadge counts incoming requests and unread DMs', () => {
    const channels = { d: ch('d', { type: 'dm', spaceId: null, lastMessageId: '03' }) }
    const relationships = { x: { type: 'incoming' } as Relationship, y: { type: 'friend' } as Relationship }
    expect(homeBadge({ channels, readStates: { d: rs('d', '01', 3) }, relationships })).toBe(4)
    expect(homeBadge({ channels, readStates: { d: rs('d', '03') }, relationships })).toBe(1)
  })
  it('own reaction echo is idempotent', () => {
    seq = 0
    const m = msg(A, new Date().toISOString())
    const once = patchReaction(m, '👍', 1, true)
    expect(patchReaction(once, '👍', 1, true)).toBe(once)
    expect(once.reactions).toEqual([{ emoji: '👍', count: 1, me: true }])
    const other = patchReaction(once, '👍', 1, false)
    expect(other.reactions[0]).toEqual({ emoji: '👍', count: 2, me: true })
    expect(patchReaction(patchReaction(other, '👍', -1, true), '👍', -1, true).reactions[0]).toEqual({ emoji: '👍', count: 1, me: false })
  })
})

describe('parseInviteCode', () => {
  it('accepts bare codes and links, rejects junk', () => {
    expect(parseInviteCode('k3yZ9q')).toBe('k3yZ9q')
    expect(parseInviteCode('  https://alga.meet/i/k3yZ9q?ref=x  ')).toBe('k3yZ9q')
    expect(parseInviteCode('alga.meet/i/k3yZ9q/')).toBe('k3yZ9q')
    expect(parseInviteCode('não é convite!')).toBeNull()
    expect(parseInviteCode('')).toBeNull()
  })
})
