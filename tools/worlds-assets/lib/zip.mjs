// Minimal ZIP reader (stored + deflate, no ZIP64, no encryption): enough to pull a few named entries out of the
// Quaternius archives without a dependency. Entries are returned as buffers; nothing is written by this module.
import { crc32, inflateRawSync } from 'node:zlib'

const END_OF_CENTRAL_DIRECTORY = 0x06054b50
const CENTRAL_FILE_HEADER = 0x02014b50
const LOCAL_FILE_HEADER = 0x04034b50

/** Lists the archive: entry name -> where its data lives. */
function readDirectory(zip) {
  let end = zip.length - 22
  while (end >= 0 && zip.readUInt32LE(end) !== END_OF_CENTRAL_DIRECTORY) end--
  if (end < 0) throw new Error('not a zip archive')
  const count = zip.readUInt16LE(end + 10)
  let offset = zip.readUInt32LE(end + 16)
  const entries = new Map()
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(offset) !== CENTRAL_FILE_HEADER) throw new Error('corrupt zip directory')
    const flags = zip.readUInt16LE(offset + 8)
    const nameLength = zip.readUInt16LE(offset + 28)
    const name = zip.toString(flags & 0x800 ? 'utf8' : 'latin1', offset + 46, offset + 46 + nameLength)
    entries.set(name, {
      method: zip.readUInt16LE(offset + 10),
      crc: zip.readUInt32LE(offset + 16),
      compressedSize: zip.readUInt32LE(offset + 20),
      size: zip.readUInt32LE(offset + 24),
      localOffset: zip.readUInt32LE(offset + 42),
    })
    offset += 46 + nameLength + zip.readUInt16LE(offset + 30) + zip.readUInt16LE(offset + 32)
  }
  return entries
}

/** Returns the bytes of one entry, checked against its CRC-32. */
export function readZipEntry(zip, name) {
  const entry = readDirectory(zip).get(name)
  if (!entry) throw new Error(`zip entry not found: ${name}`)
  const local = entry.localOffset
  if (zip.readUInt32LE(local) !== LOCAL_FILE_HEADER) throw new Error(`corrupt zip entry: ${name}`)
  const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28)
  const packed = zip.subarray(start, start + entry.compressedSize)
  let data
  if (entry.method === 0) data = Buffer.from(packed)
  else if (entry.method === 8) data = inflateRawSync(packed, { maxOutputLength: Math.max(entry.size, 1) })
  else throw new Error(`unsupported zip compression (${entry.method}): ${name}`)
  if (data.length !== entry.size || crc32(data) !== entry.crc) throw new Error(`zip entry failed its checksum: ${name}`)
  return data
}
