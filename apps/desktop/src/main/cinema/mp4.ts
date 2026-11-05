// Minimal ISO-BMFF reader for the fMP4 the cinema's own ffmpeg writes: init timescale and edit delay, segment start (tfdt).
// Total: truncated or junk input gives NaN (or 0 delay), never an exception or a read past the buffer.

export interface Box { type: string; offset: number; start: number; end: number }

/** Child boxes of `b[start, end)`; stops at the first malformed header. */
export function* boxes(b: Uint8Array, start = 0, end = b.length): Generator<Box> {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
  let o = start
  while (o + 8 <= end) {
    let size = v.getUint32(o)
    let head = 8
    if (size === 1) {
      if (o + 16 > end) return
      size = Number(v.getBigUint64(o + 8))
      head = 16
    } else if (size === 0) size = end - o
    if (size < head || o + size > end) return
    yield { type: String.fromCharCode(b[o + 4]!, b[o + 5]!, b[o + 6]!, b[o + 7]!), offset: o, start: o + head, end: o + size }
    o += size
  }
}

/** First box along `path` (e.g. ['moof', 'traf', 'tfdt']), or null. */
export function findBox(b: Uint8Array, path: string[], start = 0, end = b.length): Box | null {
  for (const x of boxes(b, start, end)) {
    if (x.type !== path[0]) continue
    return path.length === 1 ? x : findBox(b, path.slice(1), x.start, x.end)
  }
  return null
}

const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength)

export function initTimescale(init: Uint8Array): number {
  const m = findBox(init, ['moov', 'trak', 'mdia', 'mdhd'])
  if (!m) return NaN
  const at = m.start + (init[m.start] === 1 ? 20 : 12)
  return at + 4 <= m.end ? view(init).getUint32(at) || NaN : NaN
}

/**
 * Seconds the first edit skips (elst media_time): the B-frame reorder delay of copied video, 0 for audio.
 * A fragment's tfdt is its first sample's decode time plus this delay, so the source DTS of a keyframe = startS - delay.
 */
export function initDelay(init: Uint8Array): number {
  const e = findBox(init, ['moov', 'trak', 'edts', 'elst'])
  const ts = initTimescale(init)
  if (!e || !ts) return 0
  const v = view(init)
  const wide = init[e.start] === 1
  const entry = wide ? 20 : 12
  for (let i = 0, o = e.start + 8; e.start + 8 <= e.end && i < v.getUint32(e.start + 4) && o + entry <= e.end; i++, o += entry) {
    const t = wide ? Number(v.getBigInt64(o + 8)) : v.getInt32(o + 4)
    if (t >= 0) return t / ts
  }
  return 0
}

/** Seconds, from the segment's first tfdt. */
export function segmentStart(seg: Uint8Array, timescale: number): number {
  const t = findBox(seg, ['moof', 'traf', 'tfdt'])
  if (!t || !(timescale > 0)) return NaN
  const wide = seg[t.start] === 1
  if (t.start + (wide ? 12 : 8) > t.end) return NaN
  const v = view(seg)
  return Number(wide ? v.getBigInt64(t.start + 4) : BigInt(v.getUint32(t.start + 4))) / timescale
}
