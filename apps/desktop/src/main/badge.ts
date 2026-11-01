// Taskbar overlay badge drawn from raw pixels: no image assets, no offscreen window.
const GLYPHS: Record<string, string[]> = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00110', '01000', '10000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  '+': ['000', '000', '010', '111', '010', '000', '000'],
}
const RED = [0x59, 0x5d, 0xf7] // BGR of #f75d59 (design-system danger on the taskbar)

export function badgeText(count: number): string | null {
  if (!Number.isFinite(count) || count < 1) return null
  return count > 9 ? '9+' : String(Math.floor(count))
}

/** Premultiplied BGRA pixels (nativeImage.createFromBitmap layout) of a size x size badge, or null to clear. */
export function badgeBitmap(count: number, size: number): Buffer | null {
  const text = badgeText(count)
  if (!text) return null
  const px = Buffer.alloc(size * size * 4)
  const r = size / 2
  const SS = 4 // 4x4 supersampling for a smooth circle edge
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let hit = 0
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) {
          const dx = x + (sx + 0.5) / SS - r
          const dy = y + (sy + 0.5) / SS - r
          if (dx * dx + dy * dy <= r * r) hit++
        }
      const a = hit / (SS * SS)
      const i = (y * size + x) * 4
      px[i] = Math.round(RED[0]! * a)
      px[i + 1] = Math.round(RED[1]! * a)
      px[i + 2] = Math.round(RED[2]! * a)
      px[i + 3] = Math.round(255 * a)
    }

  const scale = Math.max(1, Math.floor(size / 16))
  const glyphs = [...text].map((c) => GLYPHS[c]!)
  const width = glyphs.reduce((w, g) => w + g[0]!.length * scale, 0) + (glyphs.length - 1) * scale
  let ox = Math.round((size - width) / 2)
  const oy = Math.round((size - 7 * scale) / 2)
  for (const g of glyphs) {
    g.forEach((row, gy) =>
      [...row].forEach((bit, gx) => {
        if (bit !== '1') return
        for (let sy = 0; sy < scale; sy++)
          for (let sx = 0; sx < scale; sx++) {
            const i = ((oy + gy * scale + sy) * size + ox + gx * scale + sx) * 4
            px.fill(255, i, i + 4)
          }
      }),
    )
    ox += (g[0]!.length + 1) * scale
  }
  return px
}
