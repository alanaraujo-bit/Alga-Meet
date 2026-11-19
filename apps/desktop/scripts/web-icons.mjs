// PWA icons (src/web/public/icons) from the brand SVGs, rendered by the installed Edge through Playwright.
//   node scripts/web-icons.mjs
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const brand = join(appDir, 'build', 'brand', 'web')
const out = join(appDir, 'src', 'web', 'public', 'icons')
mkdirSync(out, { recursive: true })
copyFileSync(join(brand, 'icon.svg'), join(out, 'icon.svg'))

const icon = readFileSync(join(brand, 'icon.svg'), 'utf8')
const mark = readFileSync(join(brand, 'mark.svg'), 'utf8')
const markWhite = mark.replace(/fill="#[0-9a-f]+"/gi, 'fill="#ffffff"')
const sized = (svg, attr) => svg.replace('<svg ', `<svg ${attr} `)

const browser = await chromium.launch({ channel: 'msedge' })
const page = await browser.newPage()
async function shot(html, size, file, transparent) {
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(`<html><body style="margin:0;background:${transparent ? 'transparent' : '#0b0b0c'}">${html}</body></html>`)
  await page.screenshot({ path: join(out, file), omitBackground: transparent })
}
const box = (s, inner, bg = '') =>
  `<div style="width:${s}px;height:${s}px;display:flex;align-items:center;justify-content:center;${bg}">${inner}</div>`
// Maskable and Apple icons are full-bleed tiles: the OS cuts the corners; the mark stays inside the safe zone.
const tile = 'background:linear-gradient(#202128,#0b0b0d)'

await shot(box(192, sized(icon, 'width="192" height="192"')), 192, 'icon-192.png', true)
await shot(box(512, sized(icon, 'width="512" height="512"')), 512, 'icon-512.png', true)
await shot(box(512, sized(mark, 'height="256"'), tile), 512, 'maskable-512.png', false)
await shot(box(180, sized(mark, 'height="108"'), tile), 180, 'apple-touch-icon.png', false)
await shot(box(72, sized(markWhite, 'height="60"')), 72, 'badge-72.png', true)
await browser.close()
console.log('icons written to', out)
