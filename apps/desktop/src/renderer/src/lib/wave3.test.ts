import { ALL_PERMISSIONS, DEFAULT_MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS, MAX_AVATAR_BYTES, Permission, type Role } from '@alga/shared'
import { describe, expect, it } from 'vitest'
import { byRank, canEditRole, canGrant, moderationBlock, moveBody, topPosition, visibleSections, type Actor } from '../features/spaceSettings/permissions'
import { useData } from '../store/data'
import { attachmentKind, checkAvatar, checkFiles, clampPan, cropRect, fitBox, formatBytes, gridRows, localKind, parseEmailToken, passwordStrength } from './files'
import { matchRanges } from './fuzzy'

describe('attachments', () => {
  it('lays out image grids readable at any count', () => {
    expect(gridRows(0)).toEqual([])
    expect(gridRows(1)).toEqual([1])
    expect(gridRows(2)).toEqual([2])
    expect(gridRows(3)).toEqual([1, 2])
    expect(gridRows(4)).toEqual([2, 2])
    expect(gridRows(5)).toEqual([2, 3])
    expect(gridRows(6)).toEqual([3, 3])
    expect(gridRows(7)).toEqual([1, 3, 3])
    expect(gridRows(10)).toEqual([1, 3, 3, 3])
    for (let n = 1; n <= MAX_ATTACHMENTS; n++) expect(gridRows(n).reduce((a, b) => a + b, 0)).toBe(n)
  })

  it('fits a single image without upscaling and reserves a box when the size is unknown', () => {
    expect(fitBox(1920, 1080, 420, 320)).toEqual({ width: 420, height: 236 })
    expect(fitBox(1080, 1920, 420, 320)).toEqual({ width: 180, height: 320 })
    expect(fitBox(100, 50, 420, 320)).toEqual({ width: 100, height: 50 })
    expect(fitBox(undefined, undefined, 420, 320)).toEqual({ width: 420, height: 236 })
  })

  it('checks files before upload: empty, too big, too many (counting what is already in the tray)', () => {
    const f = (size: number) => ({ size })
    const r = checkFiles(8, [f(10), f(0), f(DEFAULT_MAX_ATTACHMENT_BYTES + 1), f(20), f(30)])
    expect(r.map((x) => x.problem)).toEqual([undefined, 'empty', 'tooBig', undefined, 'tooMany'])
    expect(checkFiles(0, [f(DEFAULT_MAX_ATTACHMENT_BYTES)])[0]!.problem).toBeUndefined()
  })

  it('renders inline only what the server serves inline', () => {
    expect(attachmentKind('image/png')).toBe('image')
    expect(attachmentKind('video/mp4')).toBe('video')
    expect(attachmentKind('audio/mpeg')).toBe('audio')
    expect(attachmentKind('application/octet-stream')).toBe('file')
    // Local previews: SVG/HTML never render (the server turns them into downloads).
    expect(localKind('image/svg+xml')).toBe('file')
    expect(localKind('text/html')).toBe('file')
    expect(localKind('image/webp')).toBe('image')
  })

  it('formats sizes in pt-BR', () => {
    expect(formatBytes(1)).toBe('1 byte')
    expect(formatBytes(900)).toBe('900 bytes')
    expect(formatBytes(540 * 1024)).toBe('540 KB')
    expect(formatBytes(1.25 * 1024 * 1024)).toBe('1,3 MB')
    expect(formatBytes(DEFAULT_MAX_ATTACHMENT_BYTES)).toBe('25 MB')
  })
})

describe('avatars', () => {
  it('accepts png/jpeg/webp/gif up to the limit', () => {
    expect(checkAvatar({ type: 'image/png', size: 10 })).toBeNull()
    expect(checkAvatar({ type: 'image/gif', size: MAX_AVATAR_BYTES })).toBeNull()
    expect(checkAvatar({ type: 'image/svg+xml', size: 10 })).toBe('type')
    expect(checkAvatar({ type: 'image/jpeg', size: MAX_AVATAR_BYTES + 1 })).toBe('tooBig')
  })

  it('crops the square under the viewport, clamped to the image, at most 1024 px', () => {
    const img = { w: 4000, h: 2000 }
    // Zoom 1, centered: the full height, a centered square.
    expect(cropRect(img, 280, 1, { x: 0, y: 0 })).toEqual({ sx: 1000, sy: 0, side: 2000, out: 1024 })
    // Panned far right: clamped so the viewport stays covered (left edge of the image).
    const left = cropRect(img, 280, 1, { x: 10_000, y: 0 })
    expect(left.sx).toBeCloseTo(0)
    expect(clampPan(img, 280, 1, { x: 0, y: 50 }).y).toBe(0)
    // Zoom 2: half the side.
    expect(cropRect(img, 280, 2, { x: 0, y: 0 }).side).toBe(1000)
    // Small image: never upscaled past its own pixels.
    expect(cropRect({ w: 300, h: 200 }, 280, 1, { x: 0, y: 0 }).out).toBe(200)
  })
})

describe('password strength', () => {
  it('scores length and variety, punishes the obvious', () => {
    expect(passwordStrength('curta')).toBe(0)
    expect(passwordStrength('abcdefghi')).toBe(0) // 9 < MIN_PASSWORD_LENGTH (10)
    expect(passwordStrength('senha12345')).toBe(1)
    expect(passwordStrength('aaaaaaaaaaaa')).toBe(1)
    expect(passwordStrength('ana.ribeiro2026', ['ana.ribeiro'])).toBe(1)
    expect(passwordStrength('cavalo azul')).toBe(1)
    expect(passwordStrength('cavalo azul correndo')).toBe(3)
    expect(passwordStrength('Cavalo-Azul-Correndo-7')).toBe(4)
  })
})

describe('e-mail tokens', () => {
  it('accepts the bare code or any link carrying ?token=', () => {
    expect(parseEmailToken('  abc_DEF-123  ')).toBe('abc_DEF-123')
    expect(parseEmailToken('algameet://auth/verify-email?token=abc_DEF-123')).toBe('abc_DEF-123')
    expect(parseEmailToken('https://algameet.com.br/reset-password?x=1&token=t0k3n&utm=mail')).toBe('t0k3n')
    expect(parseEmailToken('abc\n123')).toBe('abc123')
    expect(parseEmailToken('   ')).toBe('')
  })
})

describe('quick switcher highlight', () => {
  it('marks the substring, else the subsequence letters', () => {
    expect(matchRanges('des', 'design')).toEqual([[0, 3]])
    expect(matchRanges('joao', 'João Silva')).toEqual([[0, 4]])
    expect(matchRanges('dal', 'Diego Alves')).toEqual([[0, 1], [6, 8]])
    expect(matchRanges('xyz', 'Diego')).toEqual([])
  })
})

describe('space permissions (mirror of the server hierarchy)', () => {
  const S = 'space'
  const role = (id: string, position: number, permissions = 0): Role => ({ id, spaceId: S, name: id, color: null, permissions, position })
  const everyone = role(S, 0, Permission.SEND_MESSAGES)
  const admin = role('admin', 3, Permission.ADMINISTRATOR)
  const mod = role('mod', 2, Permission.MANAGE_ROLES | Permission.KICK_MEMBERS)
  const helper = role('helper', 1)
  const roles = [everyone, admin, mod, helper]
  const modActor: Actor = { userId: 'm', isOwner: false, top: 2, perms: Permission.MANAGE_ROLES | Permission.KICK_MEMBERS | Permission.SEND_MESSAGES }
  const owner: Actor = { userId: 'o', isOwner: true, top: Infinity, perms: ALL_PERMISSIONS }

  it('ranks highest first with @everyone last', () => {
    expect(byRank(roles).map((r) => r.id)).toEqual(['admin', 'mod', 'helper', S])
    expect(topPosition(['helper', 'mod'], Object.fromEntries(roles.map((r) => [r.id, r])))).toBe(2)
    expect(topPosition([], {})).toBe(0)
  })

  it('edits only roles strictly below your top (owner: all; @everyone: any manager)', () => {
    expect(canEditRole(modActor, helper)).toBe(true)
    expect(canEditRole(modActor, mod)).toBe(false)
    expect(canEditRole(modActor, admin)).toBe(false)
    expect(canEditRole(modActor, everyone)).toBe(true)
    expect(canEditRole(owner, admin)).toBe(true)
  })

  it('grants only permissions you have', () => {
    expect(canGrant(modActor, Permission.KICK_MEMBERS)).toBe(true)
    expect(canGrant(modActor, Permission.BAN_MEMBERS)).toBe(false)
    expect(canGrant(owner, Permission.ADMINISTRATOR)).toBe(true)
  })

  it('moderates only members below you, never the owner', () => {
    expect(moderationBlock(modActor, { userId: 'x', top: 1 }, 'o')).toBeNull()
    expect(moderationBlock(modActor, { userId: 'x', top: 2 }, 'o')).toBe('outranked')
    expect(moderationBlock(modActor, { userId: 'o', top: Infinity }, 'o')).toBe('owner')
    expect(moderationBlock(owner, { userId: 'x', top: 3 }, 'o')).toBeNull()
  })

  it('moves a role one step by taking its neighbour position, only inside what you manage', () => {
    expect(moveBody(owner, roles, 'helper', 1)).toEqual([{ id: 'helper', position: 2 }])
    expect(moveBody(owner, roles, 'admin', 1)).toBeNull()
    expect(moveBody(owner, roles, 'helper', -1)).toBeNull()
    // The moderator cannot swap helper with their own role.
    expect(moveBody(modActor, roles, 'helper', 1)).toBeNull()
  })

  it('shows only the settings sections the viewer may use', () => {
    expect(visibleSections({ perms: Permission.SEND_MESSAGES })).toEqual([])
    expect(visibleSections({ perms: Permission.KICK_MEMBERS })).toEqual(['members'])
    expect(visibleSections({ perms: Permission.CREATE_INVITES | Permission.BAN_MEMBERS })).toEqual(['members', 'bans', 'invites'])
    expect(visibleSections({ perms: ALL_PERMISSIONS })).toEqual(['overview', 'roles', 'members', 'bans', 'invites'])
  })

  it('ROLE_DELETE also drops the role from every member', () => {
    const d = useData.getState()
    d.reset()
    const user = { id: 'u', username: 'u', displayName: 'U', avatarUrl: null, accentColor: null, bio: '' }
    useData.setState({
      roles: { [S]: { mod } },
      members: { [S]: { u: { spaceId: S, user, nickname: null, roleIds: ['mod', 'other'], joinedAt: '' } } },
    })
    d.apply({ t: 'ROLE_DELETE', d: { spaceId: S, id: 'mod' } })
    expect(useData.getState().members[S]!.u!.roleIds).toEqual(['other'])
    expect(useData.getState().roles[S]).toEqual({})
  })
})
