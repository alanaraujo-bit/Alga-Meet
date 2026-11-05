import type { CinemaTrackId } from '@alga/shared'

/**
 * Cinema swarm wire protocol (spec §6.4): binary only, little-endian, one message per data-channel send.
 *
 *   header  u8 type · u8 track kind (0 v, 1 a, 2 s, 3 poster, 4 thumbs) · u16 track id (a/s only, else 0)
 *   have    1  header · bitfield (bit n = byte n>>3, mask 1<<(n&7))
 *   got     2  header · u32 n
 *   req     3  header · u32 n · u32 v
 *   cancel  4  header · u32 n
 *   none    5  header · u32 n               ("I won't / can't serve n now": evicted, refused, wrong version)
 *   chunk   6  header · u32 n · u32 v · u32 offset · u32 total · data
 *
 * `v` is the piece version: the first 32 bits of its SHA-256 (verOf). A regenerated piece keeps its n but gets a new
 * hash (R4), so a chunk of the old version that is still in the pipe never mixes into the new one.
 * Piece 0 of video/audio tracks is the init segment (R5): there is no separate init message.
 */
export type WireMsg =
  | { t: 'have'; track: CinemaTrackId; bits: Uint8Array }
  | { t: 'got'; track: CinemaTrackId; n: number }
  | { t: 'req'; track: CinemaTrackId; n: number; v: number }
  | { t: 'cancel'; track: CinemaTrackId; n: number }
  | { t: 'none'; track: CinemaTrackId; n: number }
  | { t: 'chunk'; track: CinemaTrackId; n: number; v: number; offset: number; total: number; data: Uint8Array }

export const MAX_MSG_BYTES = 256 * 1024
export const MAX_PIECE_BYTES = 64 * 1024 * 1024
/** Pieces per track (n < MAX_PIECES): ~3 days of 4 s segments; keeps a full bitfield at 8 KiB. */
export const MAX_PIECES = 65_536
const CHUNK_HEADER = 20
/** Chunk payload so a full chunk message is exactly 224 KiB (spec: 64–224 KiB). */
export const CHUNK_BYTES = 224 * 1024 - CHUNK_HEADER

const TYPES = ['have', 'got', 'req', 'cancel', 'none', 'chunk'] as const
const SIZE = { got: 8, req: 12, cancel: 8, none: 8 } as const

export const verOf = (sha256hex: string): number => Number.parseInt(sha256hex.slice(0, 8), 16) >>> 0

function trackCode(t: CinemaTrackId): [number, number] {
  if (t === 'v') return [0, 0]
  if (t === 'poster') return [3, 0]
  if (t === 'thumbs') return [4, 0]
  const id = Number(t.slice(1))
  if (!Number.isInteger(id) || id < 0 || id > 999 || `${t[0]}${id}` !== t) throw new Error(`cinema: bad track ${t}`)
  return [t[0] === 'a' ? 1 : 2, id]
}

function trackOf(kind: number, id: number): CinemaTrackId | null {
  if (kind === 1 || kind === 2) return id <= 999 ? `${kind === 1 ? 'a' : 's'}${id}` : null
  if (id !== 0) return null
  return kind === 0 ? 'v' : kind === 3 ? 'poster' : kind === 4 ? 'thumbs' : null
}

export function encode(m: WireMsg): ArrayBuffer {
  const body = m.t === 'have' ? m.bits.byteLength : m.t === 'chunk' ? CHUNK_HEADER - 4 + m.data.byteLength : SIZE[m.t] - 4
  const buf = new ArrayBuffer(4 + body)
  const dv = new DataView(buf)
  const [kind, id] = trackCode(m.track)
  dv.setUint8(0, TYPES.indexOf(m.t) + 1)
  dv.setUint8(1, kind)
  dv.setUint16(2, id, true)
  if (m.t === 'have') new Uint8Array(buf, 4).set(m.bits)
  else dv.setUint32(4, m.n, true)
  if (m.t === 'req' || m.t === 'chunk') dv.setUint32(8, m.v, true)
  if (m.t === 'chunk') {
    dv.setUint32(12, m.offset, true)
    dv.setUint32(16, m.total, true)
    new Uint8Array(buf, CHUNK_HEADER).set(m.data)
  }
  return buf
}

/** Parses one message from a peer. Anything malformed or out of range is null; it never throws. */
export function decode(buf: ArrayBuffer): WireMsg | null {
  if (!(buf instanceof ArrayBuffer) || buf.byteLength < 4 || buf.byteLength > MAX_MSG_BYTES) return null
  const dv = new DataView(buf)
  const t = TYPES[dv.getUint8(0) - 1]
  const track = trackOf(dv.getUint8(1), dv.getUint16(2, true))
  if (!t || !track) return null
  if (t === 'have') return buf.byteLength - 4 <= MAX_PIECES / 8 ? { t, track, bits: new Uint8Array(buf, 4) } : null
  if (t === 'chunk' ? buf.byteLength <= CHUNK_HEADER : buf.byteLength !== SIZE[t]) return null
  const n = dv.getUint32(4, true)
  if (n >= MAX_PIECES) return null
  if (t === 'req') return { t, track, n, v: dv.getUint32(8, true) }
  if (t !== 'chunk') return { t, track, n }
  const offset = dv.getUint32(12, true)
  const total = dv.getUint32(16, true)
  const data = new Uint8Array(buf, CHUNK_HEADER)
  if (total > MAX_PIECE_BYTES || offset + data.byteLength > total) return null
  return { t, track, n, v: dv.getUint32(8, true), offset, total, data }
}

export function bitsOf(set: Iterable<number>): Uint8Array {
  const ns = [...set]
  const bits = new Uint8Array((ns.reduce((a, b) => Math.max(a, b), -1) >> 3) + 1)
  for (const n of ns) bits[n >> 3] = (bits[n >> 3] ?? 0) | (1 << (n & 7))
  return bits
}

export function setOf(bits: Uint8Array): Set<number> {
  const out = new Set<number>()
  bits.forEach((b, i) => { for (let j = 0; j < 8; j++) if (b & (1 << j)) out.add(i * 8 + j) })
  return out
}
