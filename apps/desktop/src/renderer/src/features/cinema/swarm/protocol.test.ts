import { describe, expect, it } from 'vitest'
import { CHUNK_BYTES, MAX_MSG_BYTES, MAX_PIECES, bitsOf, decode, encode, setOf, type WireMsg } from './protocol'

const bytes = (n: number, seed = 1) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) & 0xff)

describe('wire protocol', () => {
  const msgs: WireMsg[] = [
    { t: 'have', track: 'v', bits: bitsOf(new Set([0, 3, 9])) },
    { t: 'have', track: 'a0', bits: new Uint8Array(0) },
    { t: 'got', track: 'a12', n: 7 },
    { t: 'req', track: 's3', n: 0, v: 0xdeadbeef, urgent: false },
    { t: 'req', track: 'v', n: 9, v: 1, urgent: true },
    { t: 'cancel', track: 'poster', n: 0 },
    { t: 'none', track: 'thumbs', n: MAX_PIECES - 1 },
    { t: 'chunk', track: 'v', n: 42, v: 1, offset: 0, total: CHUNK_BYTES * 2, data: bytes(CHUNK_BYTES) },
    { t: 'chunk', track: 'a999', n: 1, v: 2, offset: 10, total: 13, data: bytes(3) },
  ]

  it('round-trips every message type', () => {
    for (const m of msgs) {
      const buf = encode(m)
      expect(buf).toBeInstanceOf(ArrayBuffer)
      expect(buf.byteLength).toBeLessThanOrEqual(MAX_MSG_BYTES)
      expect(decode(buf)).toEqual(m)
    }
  })

  it('keeps a full chunk at the 224 KiB message size', () => {
    expect(encode(msgs[7]!).byteLength).toBe(224 * 1024)
  })

  it('round-trips bitfields', () => {
    expect([...setOf(bitsOf(new Set([0, 3, 9, 64])))]).toEqual([0, 3, 9, 64])
    expect(setOf(bitsOf(new Set())).size).toBe(0)
  })

  describe('malformed input is null, never an exception', () => {
    const u8 = (...b: number[]) => Uint8Array.from(b).buffer
    const chunk = (n: number, offset: number, total: number, len: number) => {
      const b = new DataView(new ArrayBuffer(20 + len))
      b.setUint8(0, 6); b.setUint8(1, 0); b.setUint16(2, 0, true)
      b.setUint32(4, n, true); b.setUint32(8, 0, true); b.setUint32(12, offset, true); b.setUint32(16, total, true)
      return b.buffer
    }

    it('truncated messages', () => {
      for (const m of msgs) {
        const buf = encode(m)
        const min = m.t === 'have' ? 4 : m.t === 'chunk' ? 21 : buf.byteLength
        for (let cut = 0; cut < min; cut++) expect(decode(buf.slice(0, cut))).toBeNull()
      }
    })

    it('trailing bytes on fixed-size messages', () => {
      const got = encode({ t: 'got', track: 'v', n: 1 })
      const longer = new Uint8Array(got.byteLength + 1)
      longer.set(new Uint8Array(got))
      expect(decode(longer.buffer)).toBeNull()
    })

    it('unknown type', () => {
      for (const t of [0, 7, 255]) expect(decode(u8(t, 0, 0, 0, 1, 0, 0, 0))).toBeNull()
    })

    it('offset + length past total, empty data, zero total, total over 64 MiB', () => {
      expect(decode(chunk(1, 10, 12, 3))).toBeNull()
      expect(decode(chunk(1, 0, 12, 0))).toBeNull()
      expect(decode(chunk(1, 0, 0, 1))).toBeNull()
      expect(decode(chunk(1, 0, 64 * 1024 * 1024 + 1, 1))).toBeNull()
      expect(decode(chunk(1, 0, 64 * 1024 * 1024, 1))).not.toBeNull()
    })

    it('invalid track ids', () => {
      expect(decode(u8(2, 9, 0, 0, 1, 0, 0, 0))).toBeNull() // unknown kind
      expect(decode(u8(2, 0, 1, 0, 1, 0, 0, 0))).toBeNull() // 'v' with an id
      expect(decode(u8(2, 1, 0xe8, 0x03, 1, 0, 0, 0))).toBeNull() // a1000
      expect(decode(u8(2, 1, 0xe7, 0x03, 1, 0, 0, 0))).toEqual({ t: 'got', track: 'a999', n: 1 })
    })

    it('urgent flag other than 0/1', () => {
      const b = new DataView(encode({ t: 'req', track: 'v', n: 0, v: 0, urgent: true }))
      b.setUint8(12, 2)
      expect(decode(b.buffer)).toBeNull()
    })

    it('n out of range', () => {
      const b = new DataView(encode({ t: 'req', track: 'v', n: 0, v: 0, urgent: false }))
      b.setUint32(4, MAX_PIECES, true)
      expect(decode(b.buffer)).toBeNull()
      expect(decode(chunk(MAX_PIECES, 0, 1, 1))).toBeNull()
    })

    it('oversized messages and bitfields', () => {
      expect(decode(new ArrayBuffer(MAX_MSG_BYTES + 1))).toBeNull()
      const have = new Uint8Array(4 + MAX_PIECES / 8 + 1)
      have[0] = 1
      expect(decode(have.buffer)).toBeNull()
    })

    it('non-binary input', () => {
      for (const x of ['hello', null, undefined, 42, {}, new Uint8Array(8)]) expect(decode(x as unknown as ArrayBuffer)).toBeNull()
    })

    it('random garbage never throws', () => {
      let seed = 7
      const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff)
      for (let i = 0; i < 5000; i++) {
        const b = Uint8Array.from({ length: rnd() % 40 }, () => rnd() & 0xff)
        if (b.length) b[0] = 1 + (b[0]! % 6)
        expect(() => decode(b.buffer)).not.toThrow()
      }
    })
  })
})
