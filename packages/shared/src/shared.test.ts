import { describe, expect, it } from 'vitest'
import { uuidv7, uuidv7Time } from './ids.js'
import { ALL_PERMISSIONS, Permission, computePermissions, hasPermission } from './permissions.js'

describe('uuidv7', () => {
  it('is RFC-shaped and time ordered', () => {
    const a = uuidv7(1_700_000_000_000)
    const b = uuidv7(1_700_000_000_001)
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(a < b).toBe(true)
    expect(uuidv7Time(a)).toBe(1_700_000_000_000)
  })
})

describe('permissions', () => {
  it('admin implies everything, owner gets all', () => {
    expect(hasPermission(Permission.ADMINISTRATOR, Permission.BAN_MEMBERS)).toBe(true)
    expect(hasPermission(Permission.SPEAK, Permission.SPEAK | Permission.STREAM)).toBe(false)
    expect(computePermissions({ isOwner: true, everyone: 0, roles: [] })).toBe(ALL_PERMISSIONS)
    expect(computePermissions({ isOwner: false, everyone: Permission.SPEAK, roles: [Permission.STREAM] }))
      .toBe(Permission.SPEAK | Permission.STREAM)
  })
})
