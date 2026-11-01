/** RFC 9562 UUIDv7: time-ordered, so ORDER BY id == ORDER BY creation time. */
export function uuidv7(now = Date.now()): string {
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  b[0] = (now / 2 ** 40) & 0xff
  b[1] = (now / 2 ** 32) & 0xff
  b[2] = (now >>> 24) & 0xff
  b[3] = (now >>> 16) & 0xff
  b[4] = (now >>> 8) & 0xff
  b[5] = now & 0xff
  b[6] = (b[6]! & 0x0f) | 0x70
  b[8] = (b[8]! & 0x3f) | 0x80
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/** Milliseconds since epoch encoded in a UUIDv7. */
export function uuidv7Time(id: string): number {
  return parseInt(id.replace(/-/g, '').slice(0, 12), 16)
}
