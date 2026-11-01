// Rasterizes the brand SVGs in build/brand into every icon/installer asset the app ships.
// Run with Electron (Chromium does the SVG rendering, no extra deps):
//   npx electron scripts/brand.mjs [--preview <png>]
// Outputs (committed, so `npm run dist` never needs this step):
//   build/icon.ico                     app/installer icon, 16..256 px
//   build/runtime/icon.png             256 px (notifications, dev window icon)
//   build/runtime/tray-<state>[@Nx].png idle/connected/muted at 16/20/24/32/40 px
//   build/installer-sidebar.bmp        164x314 NSIS welcome/finish sidebar
//   build/installer-header.bmp         150x57 NSIS page header
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow } from 'electron'

const build = join(dirname(fileURLToPath(import.meta.url)), '..', 'build')
const svg = (name) => readFileSync(join(build, 'brand', name), 'utf8')
const previewIdx = process.argv.indexOf('--preview')
const previewPath = previewIdx > 0 ? process.argv[previewIdx + 1] : null

// Runs inside the page: SVG -> canvas at the exact target size (vector rasterized at that size).
async function renderInPage(source, w, h) {
  const img = new Image()
  img.src = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml' }))
  await img.decode()
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')
  g.drawImage(img, 0, 0, w, h)
  const data = g.getImageData(0, 0, w, h).data
  let bin = ''
  for (let i = 0; i < data.length; i += 0x8000) bin += String.fromCharCode.apply(null, data.subarray(i, i + 0x8000))
  return { png: c.toDataURL('image/png').split(',')[1], rgba: btoa(bin) }
}

let win
async function raster(source, w, h = w) {
  const sized = source.replace('<svg ', `<svg width="${w}" height="${h}" `)
  const r = await win.webContents.executeJavaScript(`(${renderInPage})(${JSON.stringify(sized)}, ${w}, ${h})`)
  return { w, h, png: Buffer.from(r.png, 'base64'), rgba: Buffer.from(r.rgba, 'base64') }
}

/** Inline the mark into a composition SVG at <!--MARK x= y= size=-->. */
function withMark(source, mark) {
  return source.replace(/<!--MARK x=(\d+) y=(\d+) size=(\d+)-->/, (_, x, y, s) =>
    mark.replace('<svg ', `<svg x="${x}" y="${y}" width="${s}" height="${s}" `),
  )
}

// ICO: 32-bit DIB entries below 256 px (widest compatibility: NSIS, rcedit, shell), PNG at 256.
function dib(rgba, s) {
  const maskRow = Math.ceil(s / 32) * 4
  const hdr = Buffer.alloc(40)
  hdr.writeUInt32LE(40, 0)
  hdr.writeInt32LE(s, 4)
  hdr.writeInt32LE(s * 2, 8) // XOR + AND masks
  hdr.writeUInt16LE(1, 12)
  hdr.writeUInt16LE(32, 14)
  hdr.writeUInt32LE(s * s * 4 + maskRow * s, 20)
  const px = Buffer.alloc(s * s * 4)
  for (let y = 0; y < s; y++)
    for (let x = 0; x < s; x++) {
      const src = ((s - 1 - y) * s + x) * 4 // bottom-up
      const dst = (y * s + x) * 4
      px[dst] = rgba[src + 2]
      px[dst + 1] = rgba[src + 1]
      px[dst + 2] = rgba[src]
      px[dst + 3] = rgba[src + 3]
    }
  return Buffer.concat([hdr, px, Buffer.alloc(maskRow * s)])
}

function ico(images) {
  const head = Buffer.alloc(6 + 16 * images.length)
  head.writeUInt16LE(1, 2)
  head.writeUInt16LE(images.length, 4)
  let offset = head.length
  const blobs = images.map((img, i) => {
    const data = img.w >= 256 ? img.png : dib(img.rgba, img.w)
    const e = 6 + i * 16
    head.writeUInt8(img.w >= 256 ? 0 : img.w, e)
    head.writeUInt8(img.w >= 256 ? 0 : img.w, e + 1)
    head.writeUInt16LE(1, e + 4)
    head.writeUInt16LE(32, e + 6)
    head.writeUInt32LE(data.length, e + 8)
    head.writeUInt32LE(offset, e + 12)
    offset += data.length
    return data
  })
  return Buffer.concat([head, ...blobs])
}

// 24-bit BMP (what NSIS MUI expects), alpha composited over white.
function bmp24({ w, h, rgba }) {
  const row = Math.ceil((w * 3) / 4) * 4
  const b = Buffer.alloc(54 + row * h)
  b.write('BM', 0)
  b.writeUInt32LE(b.length, 2)
  b.writeUInt32LE(54, 10)
  b.writeUInt32LE(40, 14)
  b.writeInt32LE(w, 18)
  b.writeInt32LE(h, 22)
  b.writeUInt16LE(1, 26)
  b.writeUInt16LE(24, 28)
  b.writeUInt32LE(row * h, 34)
  b.writeInt32LE(2835, 38)
  b.writeInt32LE(2835, 42)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const s = ((h - 1 - y) * w + x) * 4
      const a = rgba[s + 3] / 255
      const d = 54 + y * row + x * 3
      b[d] = Math.round(rgba[s + 2] * a + 255 * (1 - a))
      b[d + 1] = Math.round(rgba[s + 1] * a + 255 * (1 - a))
      b[d + 2] = Math.round(rgba[s] * a + 255 * (1 - a))
    }
  return b
}

const TRAY = {
  idle: null,
  connected: '#4fce74',
  muted: '#f75d59',
}
const TRAY_SIZES = [
  [16, ''],
  [20, '@1.25x'],
  [24, '@1.5x'],
  [32, '@2x'],
  [40, '@2.5x'],
]

app.whenReady().then(async () => {
  win = new BrowserWindow({ show: false, width: 400, height: 400 })
  await win.loadURL('about:blank')
  const mark = svg('mark.svg')
  const small = svg('mark-small.svg')
  mkdirSync(join(build, 'runtime'), { recursive: true })

  const iconImages = []
  for (const s of [16, 20, 24, 32]) iconImages.push(await raster(small, s))
  for (const s of [40, 48, 64, 128, 256]) iconImages.push(await raster(mark, s))
  writeFileSync(join(build, 'icon.ico'), ico(iconImages))
  writeFileSync(join(build, 'runtime', 'icon.png'), iconImages.at(-1).png)

  const tray = {}
  for (const [state, color] of Object.entries(TRAY)) {
    const src = color
      ? svg('tray.svg').replace('{{CUT}}', '78').replace('{{DOT}}', '54').replace('{{COLOR}}', color)
      : small
    tray[state] = src
    for (const [size, suffix] of TRAY_SIZES)
      writeFileSync(join(build, 'runtime', `tray-${state}${suffix}.png`), (await raster(src, size)).png)
  }

  const sidebar = await raster(withMark(svg('installer-sidebar.svg'), mark), 164, 314)
  const header = await raster(withMark(svg('installer-header.svg'), mark), 150, 57)
  writeFileSync(join(build, 'installer-sidebar.bmp'), bmp24(sidebar))
  writeFileSync(join(build, 'installer-header.bmp'), bmp24(header))

  if (previewPath) {
    // Contact sheet for design review: icon sizes at 1:1 and 8x, tray states, installer art.
    const imgs = (list) => list.map((b) => `<img src="data:image/png;base64,${b.toString('base64')}">`).join('')
    const big = await Promise.all([raster(small, 16), raster(small, 32), raster(mark, 256)])
    const trays = await Promise.all(Object.values(tray).flatMap((src) => [raster(src, 16), raster(src, 32)]))
    const html = `<body style="margin:0;padding:16px;background:#2b2f36;font:12px sans-serif;color:#ccc">
      <style>img{margin:6px;vertical-align:middle;image-rendering:pixelated} .x8 img{width:128px;height:128px} .light{background:#f3f3f3;display:inline-block}</style>
      <div>${imgs(iconImages.map((i) => i.png))}</div>
      <div class="x8">${imgs([big[0].png, big[1].png])}<img src="data:image/png;base64,${big[2].png.toString('base64')}" style="width:256px;height:256px;image-rendering:auto"></div>
      <div>${imgs(trays.map((t) => t.png))} <span class="light">${imgs(trays.map((t) => t.png))}</span></div>
      <div class="x8">${imgs([trays[0].png, trays[2].png, trays[4].png])}</div>
      <div>${imgs([sidebar.png])} <span style="display:inline-block;border:1px solid #888">${imgs([header.png])}</span></div></body>`
    const p = new BrowserWindow({ show: false, width: 900, height: 1250 })
    await p.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`)
    await new Promise((r) => setTimeout(r, 300))
    writeFileSync(previewPath, (await p.webContents.capturePage()).toPNG())
  }
  console.log('brand assets written to', build)
  app.quit()
})
