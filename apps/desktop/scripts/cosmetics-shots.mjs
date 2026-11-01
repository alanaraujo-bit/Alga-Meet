// Captures every Hora Azul item from the dev gallery (index.html#cosmetics-gallery) into docs/design/cosmetics/hora-azul/:
//   <id>@1x.png / @1.25x.png          the item after its gesture (auras mid-speech), at 100 % and 125 % scale
//   <id>.reduced@1x.png / @1.25x.png  with reduced motion (the resting frame, auras stepping 0/1)
//   <id>.gif                          the gesture in real time (CDP screencast frames → ffmpeg), items that move
//   contact-sheet@1x.png / @1.25x.png every item at rest, one cell each
//   node scripts/cosmetics-shots.mjs [--skip-build] [--only=<id,id>] [--no-gif]
// Isolated build (cosmetics-lib.mjs) served to a headless Chromium on its own port: no window ever opens.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build, gallery, launchHeadless, repo, sleep } from './cosmetics-lib.mjs'

const args = process.argv.slice(2)
const only = args.find((a) => a.startsWith('--only='))?.slice(7).split(',')
const gifs = !args.includes('--no-gif')
const OUT = join(repo, 'docs', 'design', 'cosmetics', 'hora-azul')
mkdirSync(OUT, { recursive: true })
build({ skip: args.includes('--skip-build') })

const pngWidth = (buf) => buf.readUInt32BE(16)

/** Records the page while `act` runs for `ms`, then crops `box` (CSS px) out of the frames into a GIF. */
async function record(page, box, ms, act, file) {
  const cdp = await page.context().newCDPSession(page)
  const frames = []
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    frames.push({ buf: Buffer.from(data, 'base64'), t: metadata.timestamp, w: metadata.deviceWidth })
    void cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => undefined)
  })
  await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 })
  await sleep(120)
  await act()
  await sleep(ms)
  await cdp.send('Page.stopScreencast')
  await cdp.detach()
  if (frames.length < 2) return console.warn(`  ${file}: ${frames.length} frame(s), no gif`)
  const dir = mkdtempSync(join(tmpdir(), 'alga-gif-'))
  const k = pngWidth(frames[0].buf) / frames[0].w
  const list = []
  frames.forEach((f, i) => {
    const name = join(dir, `f${String(i).padStart(4, '0')}.png`)
    writeFileSync(name, f.buf)
    const next = frames[i + 1]?.t ?? f.t + 0.9 // hold the resting frame a moment at the end
    list.push(`file '${name.replace(/\\/g, '/')}'`, `duration ${Math.max(0.01, next - f.t).toFixed(3)}`)
  })
  list.push(list[list.length - 2]) // concat demuxer: the last file must be listed twice to keep its duration
  writeFileSync(join(dir, 'list.txt'), list.join('\n'))
  const crop = [box.width, box.height, box.x, box.y].map((v) => Math.round(v * k))
  const width = Math.min(crop[0], 720)
  const r = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(dir, 'list.txt'),
    '-vf', `crop=${crop.join(':')},fps=25,scale=${width}:-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff:max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
    '-loop', '0', file], { encoding: 'utf8' })
  rmSync(dir, { recursive: true, force: true })
  if (r.status !== 0) console.warn(`  ffmpeg failed for ${file}: ${r.stderr}`)
}

const reduce = (page, on) => page.evaluate((v) => document.documentElement.classList.toggle('reduce-motion', v), on)

for (const scale of [1, 1.25]) {
  const { app, page } = await launchHeadless({ scale, size: [1440, 900] })
  try {
    await gallery(page)
    const items = await page.$$eval('[data-item]', (els) => els.map((e) => e.getAttribute('data-item')))
    for (const id of items) {
      if (only && !only.includes(id)) continue
      const card = page.locator(`[data-item="${id}"]`)
      const shot = card.locator('[data-shot]')
      await card.scrollIntoViewIfNeeded()
      const replay = card.locator('button', { hasText: 'Repetir' })
      const moves = (await replay.count()) > 0
      const aura = id.startsWith('aura_')
      // Reduced motion first: remount so the item shows its resting frame.
      await reduce(page, true)
      if (moves) await replay.click()
      await sleep(aura ? 1800 : 400)
      await shot.screenshot({ path: join(OUT, `${id}.reduced@${scale}x.png`) })
      await reduce(page, false)
      const ms = id === 'effect_ha_hora_azul' ? 2600 : id.includes('poeira') ? 2200 : 1500
      if (gifs && scale === 1 && (moves || aura)) {
        // Tight around what the stage shows (its children), with a little air.
        const box = await shot.evaluate((el) => {
          const rs = [...el.children].map((c) => c.getBoundingClientRect())
          const x = Math.min(...rs.map((r) => r.left)) - 16
          const y = Math.min(...rs.map((r) => r.top)) - 16
          return { x, y, width: Math.max(...rs.map((r) => r.right)) + 16 - x, height: Math.max(...rs.map((r) => r.bottom)) + 16 - y }
        })
        // Reactions: send three from the mock tile (one per 1.6 s, above the 1.5 s per-person limit).
        const react = id.startsWith('reactions_')
          ? async () => {
              for (let i = 0; i < 3; i++) await card.locator('[data-react]').click().then(() => sleep(1600))
            }
          : null
        await record(page, box, aura ? 3400 : react ? 1400 : ms, react ?? (async () => moves && (await replay.click())), join(OUT, `${id}.gif`))
      } else if (moves) {
        await replay.click()
        await sleep(ms)
      }
      // An aura is captured mid-word: wait for the demo voice to be loud on the big sample.
      if (aura)
        await page.waitForFunction((i) => parseFloat(document.querySelector(`[data-item="${i}"] [data-speak-host]`)?.style.getPropertyValue('--speak') ?? '0') > 0.6, id, { timeout: 5000 })
      await shot.screenshot({ path: join(OUT, `${id}@${scale}x.png`) })
      console.log(`${scale}x ${id}`)
    }
    await gallery(page, 'sheet')
    await sleep(800)
    await page.locator('[data-testid=cosmetics-sheet]').screenshot({ path: join(OUT, `contact-sheet@${scale}x.png`) })
  } finally {
    await app.close()
  }
}
console.log('done →', OUT)
