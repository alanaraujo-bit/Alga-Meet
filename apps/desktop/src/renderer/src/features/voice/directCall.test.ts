import { describe, expect, it } from 'vitest'
import { mustLeave, refuseOffer } from './directCall'

describe('direct calls are E2EE on the client', () => {
  it('refuse a DM offer without E2EE, whatever the server says', () => {
    expect(refuseOffer(true, false)).toBe(true)
    expect(refuseOffer(true, undefined)).toBe(true)
    expect(refuseOffer(true, true)).toBe(false)
    // Space rooms follow Space.e2ee: plain is allowed there.
    expect(refuseOffer(false, false)).toBe(false)
  })
  it('never stay connected to a plain DM call (establishing and active are fine)', () => {
    expect(mustLeave(true, 'connecting', 'connected', 'off')).toBe(true)
    expect(mustLeave(true, 'reconnecting', 'connected', 'off')).toBe(true)
    expect(mustLeave(true, 'connecting', 'connected', 'active')).toBe(false)
    expect(mustLeave(true, 'idle', 'connecting', 'off')).toBe(false)
    expect(mustLeave(false, 'connecting', 'connected', 'off')).toBe(false)
  })
  it('leaving an E2EE DM call is not a plain call (E2EE drops to off while still connected)', () => {
    expect(mustLeave(true, 'connected', 'connected', 'off')).toBe(false)
  })
})
