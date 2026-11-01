/**
 * Minimal ZIP writer (deflate, UTF-8 names), enough for the data export's few files.
 * shortcut: no zip64 (refuses > 4 GiB) and everything in memory; stream entries if exports ever get that large.
 */
import { crc32, deflateRawSync } from 'node:zlib'

export function zip(entries: { name: string; data: Buffer }[], date = new Date()): Buffer {
  const time = ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)) & 0xffff
  const day = (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff
  const parts: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8')
    const body = deflateRawSync(e.data)
    const crc = crc32(e.data)
    // Fields shared by the local header (from offset 4) and the central record (from offset 6).
    const common = (b: Buffer, at: number) => {
      b.writeUInt16LE(20, at) // version needed: 2.0 (deflate)
      b.writeUInt16LE(0x0800, at + 2) // bit 11: UTF-8 names
      b.writeUInt16LE(8, at + 4) // deflate
      b.writeUInt16LE(time, at + 6)
      b.writeUInt16LE(day, at + 8)
      b.writeUInt32LE(crc, at + 10)
      b.writeUInt32LE(body.length, at + 14)
      b.writeUInt32LE(e.data.length, at + 18)
      b.writeUInt16LE(name.length, at + 22)
    }
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    common(local, 4)
    const record = Buffer.alloc(46)
    record.writeUInt32LE(0x02014b50, 0)
    record.writeUInt16LE(20, 4) // version made by
    common(record, 6)
    record.writeUInt32LE(offset, 42)
    parts.push(local, name, body)
    central.push(record, name)
    offset += local.length + name.length + body.length
    if (offset > 0xffffffff) throw new Error('zip: archive larger than 4 GiB needs zip64')
  }
  const dir = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(dir.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, dir, end])
}
