import { describe, expect, it } from 'vitest'
import { defaultDeviceName } from './devices'
import { sessionDevice } from './sessions'

describe('sessionDevice', () => {
  it('names the app with its version, the browser with its major, and the OS', () => {
    const win = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)'
    expect(sessionDevice(`${win} AlgaMeet/0.1.0 Chrome/142.0.7444.52 Electron/45.2.1 Safari/537.36`)).toBe('Alga Meet 0.1.0 · Windows')
    expect(sessionDevice(`${win} Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0`)).toBe('Edge 140 · Windows')
    expect(sessionDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36')).toBe('Chrome 140 · macOS')
    expect(sessionDevice('Mozilla/5.0 (X11; Linux x86_64; rv:141.0) Gecko/20100101 Firefox/141.0')).toBe('Firefox 141 · Linux')
    expect(sessionDevice('undici')).toBe('API')
    expect(sessionDevice('')).toBe('Dispositivo desconhecido')
  })
})

describe('defaultDeviceName', () => {
  const d = (deviceId: string, label: string, groupId = 'g1', kind: MediaDeviceKind = 'audioinput') => ({ deviceId, label, groupId, kind })
  it('reads the device behind the default alias', () => {
    expect(defaultDeviceName([d('default', 'Default - Microfone (Realtek(R) Audio)'), d('abc', 'Microfone (Realtek(R) Audio)')], 'audioinput')).toBe('Microfone (Realtek(R) Audio)')
    expect(defaultDeviceName([d('default', 'Headset', 'g2'), d('x', 'Alto-falantes', 'g1'), d('y', 'Headset USB', 'g2')], 'audioinput')).toBe('Headset USB')
    expect(defaultDeviceName([d('default', 'Default - Alto-falantes', 'g1', 'audiooutput')], 'audioinput')).toBeNull()
    expect(defaultDeviceName([d('default', '')], 'audioinput')).toBeNull()
  })
})
