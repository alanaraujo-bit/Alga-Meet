import { REMOVED_USER_ID } from '@alga/shared'
import { describe, expect, it } from 'vitest'
import { ago, decisionBody, keyFor, readTarget, REPORT_KEYS, step, tierOf, unavailable } from './queue'

const author = {
  id: 'u1',
  username: 'bruno',
  displayName: 'Bruno',
  avatarUrl: null,
  accentColor: null,
  bio: '',
}

describe('staff queue', () => {
  it('reads a message snapshot as metadata only (no media URL survives)', () => {
    const t = readTarget({
      targetType: 'message',
      snapshot: {
        content: 'oi',
        author,
        createdAt: '2026-11-01T10:00:00Z',
        editedAt: null,
        channel: { id: 'c', type: 'text', name: 'geral' },
        attachments: [
          {
            id: 'a1',
            filename: 'x.png',
            contentType: 'image/png',
            size: 10,
            url: 'https://api/files/a1?sig=1',
            width: 2,
            height: 3,
          },
          { nope: 1 },
        ],
      },
    })
    expect(t).toEqual({
      kind: 'message',
      content: 'oi',
      author,
      createdAt: '2026-11-01T10:00:00Z',
      edited: false,
      channelName: 'geral',
      dm: false,
      attachments: [
        {
          id: 'a1',
          filename: 'x.png',
          contentType: 'image/png',
          size: 10,
          width: 2,
          height: 3,
        },
      ],
    })
    expect(JSON.stringify(t)).not.toContain('sig=')
  })

  it('survives odd snapshots', () => {
    expect(readTarget({ targetType: 'message', snapshot: null })).toMatchObject({ kind: 'message', content: '', author: null, attachments: [] })
    expect(readTarget({ targetType: 'user', snapshot: { user: author } })).toEqual({ kind: 'user', user: author })
    expect(
      readTarget({
        targetType: 'space',
        snapshot: { space: { name: 'Estúdio', memberCount: 4 } },
      }),
    ).toEqual({
      kind: 'space',
      name: 'Estúdio',
      memberCount: 4,
      createdAt: null,
    })
  })

  it('puts csam above risk to life above the rest', () => {
    expect(tierOf({ reason: 'csam', priority: 100 })).toBe('csam')
    expect(tierOf({ reason: 'self_harm', priority: 50 })).toBe('urgent')
    expect(tierOf({ reason: 'spam', priority: 10 })).toBe('normal')
  })

  it('mirrors what the server refuses', () => {
    expect(unavailable({ targetType: 'user', targetUserId: 'u1' }, 'remove_content')).toBe('profile')
    expect(unavailable({ targetType: 'message', targetUserId: REMOVED_USER_ID }, 'ban')).toBe('gone')
    expect(unavailable({ targetType: 'message', targetUserId: null }, 'warn')).toBe('gone')
    expect(unavailable({ targetType: 'message', targetUserId: 'u1' }, 'suspend')).toBeNull()
    expect(unavailable({ targetType: 'space', targetUserId: null }, 'dismiss')).toBeNull()
  })

  it('builds the PATCH body (dismiss never carries an action; suspend carries until)', () => {
    expect(decisionBody('dismiss', { note: '  ' })).toEqual({
      status: 'dismissed',
      action: 'none',
      note: undefined,
    })
    expect(decisionBody('ban', { note: 'golpe' })).toEqual({
      status: 'resolved',
      action: 'ban',
      until: undefined,
      note: 'golpe',
    })
    expect(
      decisionBody('suspend', {
        days: 3,
        now: Date.parse('2026-11-01T00:00:00Z'),
      }).until,
    ).toBe('2026-11-04T00:00:00.000Z')
  })

  it('shortcuts, relative age and list stepping', () => {
    expect(keyFor(REPORT_KEYS, 'ban')).toBe('B')
    const now = Date.parse('2026-11-01T12:00:00Z')
    expect(ago('2026-11-01T11:59:30Z', now)).toBe('agora')
    expect(ago('2026-11-01T11:15:00Z', now)).toBe('há 45 min')
    expect(ago('2026-11-01T09:00:00Z', now)).toBe('há 3 h')
    expect(ago('2026-10-31T11:00:00Z', now)).toBe('há 1 dia')
    expect(step(0, 3, -1)).toBe(0)
    expect(step(2, 3, 1)).toBe(2)
    expect(step(-1, 3, 1)).toBe(0)
    expect(step(0, 0, 1)).toBe(-1)
  })
})
