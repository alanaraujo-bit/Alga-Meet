import { describe, expect, it } from 'vitest'
import { parseWebLink, webOsLabel } from './logic'

const token = 'a'.repeat(43)

describe('parseWebLink', () => {
  it('accepts the three link shapes', () => {
    expect(parseWebLink('/i/Ab12Cd34', '')).toEqual({ kind: 'invite', code: 'Ab12Cd34' })
    expect(parseWebLink('/auth/verify-email', `?token=${token}`)).toEqual({ kind: 'verify-email', token })
    expect(parseWebLink('/auth/reset-password', `?token=${token}`)).toEqual({ kind: 'password-reset', token })
  })
  it('rejects anything else', () => {
    expect(parseWebLink('/', '')).toBeNull()
    expect(parseWebLink('/i/../x', '')).toBeNull()
    expect(parseWebLink('/auth/verify-email', '?token=short')).toBeNull()
    expect(parseWebLink('/auth/verify-email', `?token=${token}&x=1`)).toBeNull()
    expect(parseWebLink('/auth/other', `?token=${token}`)).toBeNull()
  })
})

describe('webOsLabel', () => {
  it('names the common systems', () => {
    expect(webOsLabel('Mozilla/5.0 (Linux; Android 15; Pixel 8) Chrome/131')).toBe('Android 15')
    expect(webOsLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) Safari')).toBe('iOS 18')
    expect(webOsLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131')).toBe('Windows')
    expect(webOsLabel('curl')).toBe('Web')
  })
})
