import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { badgeBitmap, badgeText } from './badge'
import { fitBounds } from './bounds'
import { findDeepLinkArg, parseDeepLink, redactLink } from './deep-link-logic'
import { ChordMatcher, ChordRecorder, ESC, chordLabel } from './hotkey-logic'
import { TRAY_BREATH, TRAY_FRAME_MS, clampZoom, osVersionLabel, trayAnimates } from './ui-logic'

const CTRL = 29
const SHIFT = 42
const M = 50
const V = 47
const W = 17

describe('chordLabel', () => {
  it('puts modifiers first and uses pt-BR names', () => {
    expect(chordLabel({ keys: [M, CTRL], mouseButtons: [] })).toBe('Ctrl + M')
    expect(chordLabel({ keys: [57, SHIFT], mouseButtons: [] })).toBe('Shift + Espaço')
    expect(chordLabel({ keys: [], mouseButtons: [4] })).toBe('Mouse 4')
    expect(chordLabel({ keys: [CTRL], mouseButtons: [5, 4] })).toBe('Ctrl + Mouse 4 + Mouse 5')
    expect(chordLabel({ keys: [3613, 39, 87], mouseButtons: [] })).toBe('Ctrl Dir. + Ç + F11')
    expect(chordLabel({ keys: [], mouseButtons: [] })).toBe('Nenhum')
    expect(chordLabel({ keys: [9999], mouseButtons: [] })).toBe('Tecla 9999')
  })
})

describe('ChordMatcher', () => {
  const make = () => {
    const m = new ChordMatcher<'pushToTalk' | 'toggleMute'>()
    m.setBindings([
      { action: 'pushToTalk', keys: [V], mouseButtons: [] },
      { action: 'toggleMute', keys: [CTRL, M], mouseButtons: [] },
    ])
    return m
  }

  it('fires down once (auto-repeat ignored) and up on release', () => {
    const m = make()
    expect(m.keyDown(V)).toEqual([{ action: 'pushToTalk', phase: 'down' }])
    expect(m.keyDown(V)).toEqual([])
    expect(m.keyUp(V)).toEqual([{ action: 'pushToTalk', phase: 'up' }])
    expect(m.keyUp(V)).toEqual([])
  })

  it('matches chords in any order and while other keys are held (W to walk)', () => {
    const m = make()
    expect(m.keyDown(W)).toEqual([])
    expect(m.keyDown(V)).toEqual([{ action: 'pushToTalk', phase: 'down' }])
    expect(m.keyDown(M)).toEqual([])
    expect(m.keyDown(CTRL)).toEqual([{ action: 'toggleMute', phase: 'down' }])
    expect(m.keyUp(M)).toEqual([{ action: 'toggleMute', phase: 'up' }])
  })

  it('handles mouse side buttons', () => {
    const m = new ChordMatcher<'pushToTalk'>()
    m.setBindings([{ action: 'pushToTalk', keys: [], mouseButtons: [4] }])
    expect(m.mouseDown(4)).toEqual([{ action: 'pushToTalk', phase: 'down' }])
    expect(m.mouseUp(4)).toEqual([{ action: 'pushToTalk', phase: 'up' }])
  })

  it('reset releases held bindings so push-to-talk never sticks', () => {
    const m = make()
    m.keyDown(V)
    expect(m.reset()).toEqual([{ action: 'pushToTalk', phase: 'up' }])
    expect(m.keyUp(V)).toEqual([]) // the late key-up is harmless
    expect(m.keyDown(V)).toEqual([{ action: 'pushToTalk', phase: 'down' }])
  })

  it('replacing bindings releases the active ones', () => {
    const m = make()
    m.keyDown(V)
    expect(m.setBindings([])).toEqual([{ action: 'pushToTalk', phase: 'up' }])
    expect(m.keyUp(V)).toEqual([])
  })
})

describe('ChordRecorder', () => {
  it('captures the full combo once everything is released', () => {
    const r = new ChordRecorder()
    expect(r.keyDown(CTRL)).toBeNull()
    expect(r.keyDown(M)).toBeNull()
    expect(r.keyUp(M)).toBeNull()
    expect(r.keyUp(CTRL)).toEqual({ keys: [CTRL, M], mouseButtons: [] })
  })
  it('Esc cancels', () => {
    expect(new ChordRecorder().keyDown(ESC)).toBe('cancel')
  })
  it('records side mouse buttons but ignores left/right click', () => {
    const r = new ChordRecorder()
    expect(r.mouseDown(1)).toBeNull()
    expect(r.mouseUp(1)).toBeNull()
    r.mouseDown(4)
    expect(r.mouseUp(4)).toEqual({ keys: [], mouseButtons: [4] })
  })
  it('ignores key-ups of keys held before recording started', () => {
    const r = new ChordRecorder()
    expect(r.keyUp(V)).toBeNull()
  })
})

describe('fitBounds', () => {
  const primary = { x: 0, y: 0, width: 1920, height: 1040 }
  const second = { x: 1920, y: 0, width: 2560, height: 1400 }
  const fallback = { width: 1320, height: 840 }
  const min = { width: 960, height: 600 }

  it('centers on the primary display without saved bounds', () => {
    expect(fitBounds(undefined, [primary], primary, fallback, min)).toEqual({ x: 300, y: 100, width: 1320, height: 840 })
  })
  it('keeps bounds on a display that still exists', () => {
    const saved = { x: 2000, y: 50, width: 1400, height: 900 }
    expect(fitBounds(saved, [primary, second], primary, fallback, min)).toEqual(saved)
  })
  it('recenters when the saved display is gone', () => {
    const saved = { x: 2000, y: 50, width: 1400, height: 900 }
    expect(fitBounds(saved, [primary], primary, fallback, min)).toEqual({ x: 260, y: 70, width: 1400, height: 900 })
  })
  it('pulls a half-offscreen window inside and shrinks it to the work area', () => {
    expect(fitBounds({ x: -500, y: 900, width: 3000, height: 700 }, [primary], primary, fallback, min)).toEqual({
      x: 0,
      y: 340,
      width: 1920,
      height: 700,
    })
  })
})

describe('badge', () => {
  it('clears at zero and caps the text at 9+', () => {
    expect(badgeText(0)).toBeNull()
    expect(badgeBitmap(0, 16)).toBeNull()
    expect(badgeText(7)).toBe('7')
    expect(badgeText(42)).toBe('9+')
  })
  it('draws an opaque red disc with white glyph pixels and transparent corners', () => {
    const px = badgeBitmap(3, 16)!
    expect(px.length).toBe(16 * 16 * 4)
    const at = (x: number, y: number) => [...px.subarray((y * 16 + x) * 4, (y * 16 + x) * 4 + 4)]
    expect(at(0, 0)[3]).toBe(0)
    expect(at(1, 8)).toEqual([0x44, 0x44, 0xc0, 255])
    let white = 0
    for (let i = 0; i < px.length; i += 4) if (px[i] === 255 && px[i + 1] === 255 && px[i + 2] === 255) white++
    expect(white).toBeGreaterThan(8)
  })
})

describe('deep links', () => {
  const T = 'q3Zr8Hk-_0aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456' // 43 chars, like the server's base64url tokens

  it('accepts exactly the links the server and invites generate', () => {
    expect(parseDeepLink(`algameet://auth/verify-email?token=${T}`)).toEqual({ kind: 'verify-email', token: T })
    expect(parseDeepLink(`algameet://auth/reset-password?token=${T}`)).toEqual({ kind: 'password-reset', token: T })
    expect(parseDeepLink('algameet://invite/Ab3dE6gH')).toEqual({ kind: 'invite', code: 'Ab3dE6gH' })
    // trailing slash some Windows launchers add
    expect(parseDeepLink('algameet://invite/Ab3dE6gH/')).toEqual({ kind: 'invite', code: 'Ab3dE6gH' })
    expect(parseDeepLink(`algameet://auth/verify-email/?token=${T}`)).toEqual({ kind: 'verify-email', token: T })
  })

  it('rejects everything else', () => {
    for (const bad of [
      '',
      'algameet:',
      'algameet://',
      'algameet://auth/verify-email',
      'algameet://auth/verify-email?token=',
      'algameet://auth/verify-email?token=short',
      `algameet://auth/verify-email?token=${'a'.repeat(129)}`,
      `algameet://auth/verify-email?token=${T}&next=https://evil.example`,
      `algameet://auth/verify-email?next=x&token=${T}`,
      `algameet://auth/verify-email?token=${T}#frag`,
      `algameet://auth/verify-email?token=${T.slice(0, 20)}%41${T.slice(20)}`,
      `algameet://auth/verify-email?token=${T.slice(0, 20)}+${T.slice(20)}`,
      `algameet://auth/delete-account?token=${T}`,
      `algameet://AUTH/verify-email?token=${T}`,
      `AlgaMeet://auth/verify-email?token=${T}`,
      `algameet://user:pw@auth/verify-email?token=${T}`,
      `algameet://auth:80/verify-email?token=${T}`,
      `algameet://evil/verify-email?token=${T}`,
      `algameet:auth/verify-email?token=${T}`,
      `https://auth/verify-email?token=${T}`,
      'algameet://invite/',
      'algameet://invite/Ab3dE6gH?x=1',
      'algameet://invite/Ab3dE6gH//',
      'algameet://invite/Ab3d-E6gH',
      'algameet://invite/Ab3dE6gH/extra',
      'algameet://invite/../auth',
      'algameet://invite/%41b3dE6gH',
      `algameet://invite/${'a'.repeat(33)}`,
      'algameet://invite/Ab3dE6gH" --inspect',
      'algameet://invite/Ab3dE6gH\n',
      `algameet://invite/x${' '.repeat(600)}`,
    ])
      expect(parseDeepLink(bad), bad).toBeNull()
    expect(parseDeepLink(null)).toBeNull()
    expect(parseDeepLink(42)).toBeNull()
  })

  it('finds the link argument in argv (any position, scheme case-insensitive)', () => {
    expect(findDeepLinkArg(['electron.exe', '.', '--profile=x', 'algameet://invite/abc'])).toBe('algameet://invite/abc')
    expect(findDeepLinkArg(['Alga Meet.exe', 'ALGAMEET://invite/abc'])).toBe('ALGAMEET://invite/abc')
    expect(findDeepLinkArg(['Alga Meet.exe', '--hidden'])).toBeUndefined()
  })

  it('redacts rejected links down to scheme + host', () => {
    expect(redactLink(`algameet://invite/SECRET123/x`)).toBe('algameet://invite (29 chars)')
    expect(redactLink(`algameet://auth/verify-email?token=${T}&x`)).toBe(`algameet://auth (${35 + T.length + 2} chars)`)
    expect(redactLink('algameet:SECRET')).toBe('algameet: (15 chars)')
  })
})

describe('UI zoom', () => {
  it('clamps to 0.8..1.5 with 2 decimals and rejects non-numbers', () => {
    expect(clampZoom(1)).toBe(1)
    expect(clampZoom(1.25)).toBe(1.25)
    expect(clampZoom(0.1)).toBe(0.8)
    expect(clampZoom(9)).toBe(1.5)
    expect(clampZoom(1.23456)).toBe(1.23)
    for (const bad of [NaN, Infinity, '1.2', null, undefined, {}]) expect(() => clampZoom(bad)).toThrow(TypeError)
  })
})

describe('tray breathing', () => {
  const v = (connected: boolean, muted = false, deafened = false) => ({ connected, muted, deafened })
  it('animates only in voice with mic and audio on, the setting on and no reduced motion', () => {
    expect(trayAnimates(v(true), true, false)).toBe(true)
    expect(trayAnimates(v(false), true, false)).toBe(false)
    expect(trayAnimates(v(true, true), true, false)).toBe(false)
    expect(trayAnimates(v(true, false, true), true, false)).toBe(false)
    expect(trayAnimates(v(true), false, false)).toBe(false)
    expect(trayAnimates(v(true), true, true)).toBe(false)
  })
  it('ships every frame at every tray DPI, starting from the static connected icon', () => {
    expect(TRAY_BREATH[0]).toBe('connected')
    expect(TRAY_FRAME_MS).toBe(250)
    for (const frame of new Set(TRAY_BREATH))
      for (const suffix of ['', '@1.25x', '@1.5x', '@2x', '@2.5x'])
        expect(existsSync(join(__dirname, '..', '..', 'build', 'runtime', `tray-${frame}${suffix}.png`)), `${frame}${suffix}`).toBe(true)
  })
})

describe('osVersionLabel', () => {
  it('tells Windows 11 from 10 by build number', () => {
    expect(osVersionLabel('win32', '10.0.26300')).toBe('Windows 11')
    expect(osVersionLabel('win32', '10.0.22000')).toBe('Windows 11')
    expect(osVersionLabel('win32', '10.0.19045')).toBe('Windows 10')
    expect(osVersionLabel('win32', '6.3.9600')).toBe('Windows')
    expect(osVersionLabel('darwin', '24.1.0')).toBe('macOS 15')
    expect(osVersionLabel('linux', '6.8.0-45-generic')).toBe('Linux')
  })
})
