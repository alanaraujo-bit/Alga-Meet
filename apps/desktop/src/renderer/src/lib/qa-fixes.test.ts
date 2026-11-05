import { DEFAULT_EVERYONE_PERMISSIONS, Permission, type Channel, type Me, type Message, type ReadyPayload } from '@alga/shared'
import { beforeEach, describe, expect, it } from 'vitest'
import { sessionLabel } from '../features/settings/sessions'
import { stepZoom } from '../features/settings/zoom'
import { clientHeader } from './api'
import { useData } from '../store/data'
import { canDeleteMessage, displayName } from '../store/selectors'

// QA 2026-11-01: BUG-01 (moderators delete), BUG-04 (authors after reopening); zoom, X-Alga-Client, session labels.
const user = (id: string, displayName: string) => ({ id, username: id, displayName, avatarUrl: null, accentColor: null, bio: '' })
const ME: Me = { ...user('ana', 'Ana'), email: 'ana@x', statusPreference: 'online', createdAt: '2026-01-01T00:00:00Z' }
const S = 'space'
const channel: Channel = { id: 'geral', type: 'text', spaceId: S, name: 'geral', topic: '', position: 0, lastMessageId: '0002' }
const message = (id: string, author: ReturnType<typeof user>): Message => ({
  id, channelId: 'geral', author, content: 'oi', createdAt: '2026-11-01T10:00:00Z', editedAt: null, replyToId: null, reactions: [], attachments: [],
})
const ready = (ownerId: string, myRoles: string[], modPerms = Permission.MANAGE_MESSAGES): ReadyPayload => ({
  user: ME,
  spaces: [{
    id: S, name: 'Clube', iconUrl: null, ownerId, createdAt: '2026-01-01T00:00:00Z', channels: [channel],
    roles: [
      { id: S, spaceId: S, name: '@everyone', color: null, permissions: DEFAULT_EVERYONE_PERMISSIONS, position: 0 },
      { id: 'mod', spaceId: S, name: 'Mod', color: null, permissions: modPerms, position: 1 },
    ],
    members: [{ spaceId: S, user: ME, nickname: null, roleIds: myRoles, joinedAt: '2026-01-01T00:00:00Z' }],
  }],
  privateChannels: [], relationships: [], presences: [], voiceStates: [], readStates: [], users: [], heartbeatIntervalMs: 30_000,
})

beforeEach(() => useData.getState().reset())

describe('canDeleteMessage (same rule as DELETE /channels/:id/messages/:mid)', () => {
  it('own messages always; others only with MANAGE_MESSAGES, owner or administrator; DMs only own', () => {
    const d = useData.getState()
    d.apply({ t: 'READY', d: ready('bob', []) })
    expect(canDeleteMessage(useData.getState(), 'ana', S)).toBe(true)
    expect(canDeleteMessage(useData.getState(), 'caio', S)).toBe(false)
    expect(canDeleteMessage(useData.getState(), 'caio', null)).toBe(false)
    d.apply({ t: 'READY', d: ready('bob', ['mod']) })
    expect(canDeleteMessage(useData.getState(), 'caio', S)).toBe(true)
    expect(canDeleteMessage(useData.getState(), 'caio', null)).toBe(false)
    d.apply({ t: 'READY', d: ready('bob', ['mod'], Permission.ADMINISTRATOR) })
    expect(canDeleteMessage(useData.getState(), 'caio', S)).toBe(true)
    d.apply({ t: 'READY', d: ready('ana', []) })
    expect(canDeleteMessage(useData.getState(), 'caio', S)).toBe(true)
  })
})

describe('message authors stay known users (banned / departed)', () => {
  it('a history page names authors READY does not list, without overriding fresher copies', () => {
    const d = useData.getState()
    d.apply({ t: 'READY', d: ready('ana', []) })
    expect(displayName(useData.getState(), 'caio', S)).toBe('Usuário desconhecido')
    d.upsertMessages('geral', [message('0002', user('caio', 'Caio Prado')), message('0001', user('ana', 'Nome antigo'))])
    expect(displayName(useData.getState(), 'caio', S)).toBe('Caio Prado')
    expect(displayName(useData.getState(), 'ana', S)).toBe('Ana')
  })

  it('a reconnect READY keeps the authors of the history it keeps', () => {
    const d = useData.getState()
    d.apply({ t: 'READY', d: ready('ana', []) })
    d.upsertMessages('geral', [message('0002', user('caio', 'Caio Prado'))])
    d.apply({ t: 'READY', d: ready('ana', []) })
    expect(useData.getState().messages.geral?.ids).toEqual(['0002'])
    expect(displayName(useData.getState(), 'caio', S)).toBe('Caio Prado')
  })

  it('a reconnect READY that drops stale history keeps the unsent copies (the send queue)', () => {
    const d = useData.getState()
    d.apply({ t: 'READY', d: ready('ana', []) })
    const unsent = (nonce: string): Message => ({ ...message(nonce, user('ana', 'Ana')), nonce })
    d.upsertMessages('geral', [message('0001', user('caio', 'Caio Prado')), unsent('0003'), unsent('0004')])
    // While offline someone posted 0005: the cached list is stale and goes, the two waiting sends stay.
    d.apply({ t: 'READY', d: { ...ready('ana', []), spaces: [{ ...ready('ana', []).spaces[0]!, channels: [{ ...channel, lastMessageId: '0005' }] }] } })
    const list = useData.getState().messages.geral!
    expect(list.ids).toEqual(['0003', '0004'])
    expect(list.hasMoreBefore).toBe(true) // the history reloads around them
  })
})

describe('UI zoom steps (Ctrl+= / Ctrl+- / Ctrl+0)', () => {
  it('walks 80..150 % and stays put at the ends; off-step factors snap to the next step that way', () => {
    expect(stepZoom(1, 1)).toBe(1.1)
    expect(stepZoom(1.1, 1)).toBe(1.25)
    expect(stepZoom(1.5, 1)).toBe(1.5)
    expect(stepZoom(1, -1)).toBe(0.9)
    expect(stepZoom(0.8, -1)).toBe(0.8)
    expect(stepZoom(1.3, -1)).toBe(1.25)
    expect(stepZoom(1.3, 1)).toBe(1.5)
    expect(stepZoom(1.25, 0)).toBe(1)
  })
})

describe('X-Alga-Client and session labels', () => {
  it('sends "<version>; <os>" only when main reports both', () => {
    expect(clientHeader({ version: '0.1.0', osVersion: 'Windows 11' })).toBe('0.1.0; Windows 11')
    expect(clientHeader({ version: '0.1.0' })).toBeNull()
    expect(clientHeader(undefined)).toBeNull()
  })
  it('names a session by the server labels, else by its user agent', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 AlgaMeet/0.1.0 Chrome/142.0.0.0 Electron/45.2.1'
    expect(sessionLabel({ client: 'Alga Meet 0.1.0', os: 'Windows 11', userAgent: ua })).toBe('Alga Meet 0.1.0 · Windows 11')
    expect(sessionLabel({ client: 'Chrome', os: null, userAgent: ua })).toBe('Chrome')
    expect(sessionLabel({ userAgent: ua })).toBe('Alga Meet 0.1.0 · Windows')
  })
})
