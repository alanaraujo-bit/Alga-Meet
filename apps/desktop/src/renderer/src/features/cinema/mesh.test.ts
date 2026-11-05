import { afterEach, describe, expect, it, vi } from 'vitest'
import { CandidateBatcher, fingerprintOf, isOfferer, tagInput } from './mesh'

const SDP = ['v=0', 'o=- 4611731400430051336 2 IN IP4 127.0.0.1', 's=-', 't=0 0',
  'a=group:BUNDLE 0', 'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 0.0.0.0',
  'a=ice-ufrag:abcd', 'a=fingerprint:sha-256 AB:CD:EF:01:23', 'a=setup:actpass', 'a=mid:0', 'a=sctp-port:5000', ''].join('\r\n')

describe('isOfferer', () => {
  it('the smaller id offers', () => {
    expect(isOfferer('a', 'b')).toBe(true)
    expect(isOfferer('b', 'a')).toBe(false)
  })
})

describe('CandidateBatcher', () => {
  afterEach(() => vi.useRealTimers())
  it('30 candidates in 50 ms flush as 20 + 10', () => {
    vi.useFakeTimers()
    const out: string[][] = []
    const b = new CandidateBatcher((c) => out.push(c))
    for (let i = 0; i < 30; i++) { b.add(String(i)); vi.advanceTimersByTime(1) }
    expect(out.map((c) => c.length)).toEqual([20])
    vi.advanceTimersByTime(200)
    expect(out.map((c) => c.length)).toEqual([20, 10])
  })
  it('one candidate flushes after 200 ms', () => {
    vi.useFakeTimers()
    const out: string[][] = []
    new CandidateBatcher((c) => out.push(c)).add('x')
    vi.advanceTimersByTime(199)
    expect(out).toEqual([])
    vi.advanceTimersByTime(1)
    expect(out).toEqual([['x']])
  })
  it('close drops pending', () => {
    vi.useFakeTimers()
    const out: string[][] = []
    const b = new CandidateBatcher((c) => out.push(c))
    b.add('x')
    b.close()
    vi.advanceTimersByTime(1000)
    b.add('y')
    vi.advanceTimersByTime(1000)
    expect(out).toEqual([])
  })
})

describe('fingerprintOf', () => {
  it('extracts the sha-256 fingerprint', () => expect(fingerprintOf(SDP)).toBe('sha-256 AB:CD:EF:01:23'))
  it('null without one', () => expect(fingerprintOf('v=0\r\ns=-\r\n')).toBeNull())
})

describe('tagInput', () => {
  it('joins in order', () => {
    expect(tagInput('s', 'a', 'b', 'AB:CD')).toBe('s|a|b|AB:CD')
    expect(tagInput('s', 'b', 'a', 'AB:CD')).not.toBe(tagInput('s', 'a', 'b', 'AB:CD'))
  })
})
