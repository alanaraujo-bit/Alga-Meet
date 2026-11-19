// PWA end to end: a phone (touch, 390×844) and a desktop browser in the same call, through the PWA's real UI.
// Needs the PWA (npm run dev:web, or a deployed URL) and two signed-up accounts in the same space with a voice
// channel. Tokens come from a JSON file { users: { <name>: { token } } } (never printed).
//   node scripts/web-e2e.mjs --url=http://localhost:5173 --tokens=<file> --phone=pwa_bia --desk=pwa_ana --space="Os de Sempre" --voice=Geral --out=<dir>
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d
const url = arg('url', 'http://localhost:5173')
const tokens = JSON.parse(readFileSync(arg('tokens'), 'utf8')).users
const space = arg('space', 'Os de Sempre')
const voice = arg('voice', 'Geral')
const out = arg('out', 'web-e2e-out')
mkdirSync(out, { recursive: true })

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}

const browser = await chromium.launch({ channel: 'msedge', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] })
async function open(user, opts) {
  const ctx = await browser.newContext({ ...opts, permissions: ['microphone', 'camera', 'notifications'] })
  await ctx.addInitScript((t) => localStorage.setItem('alga.token', t), tokens[user].token)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log(`[${user}] pageerror: ${e.message}`))
  await page.goto(url)
  return page
}

const phone = await open(arg('phone', 'pwa_bia'), { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 })
const desk = await open(arg('desk', 'pwa_ana'), { viewport: { width: 1280, height: 800 } })

// Phone: Espaços › space › voice channel (first tap looks in, "Entrar" joins).
await phone.getByRole('navigation', { name: 'Navegação' }).waitFor()
check('phone: tab bar', true)
await phone.screenshot({ path: join(out, '01-phone-spaces.png') })
await phone.getByRole('button', { name: new RegExp(space) }).first().tap()
await phone.getByRole('button', { name: new RegExp(`^${voice}`) }).tap()
await phone.locator('button[class*=joinPill]').tap()

// Desktop: rail › space › voice channel twice (look in, then enter).
await desk.getByRole('button', { name: new RegExp(space) }).first().click()
const deskVoice = desk.getByRole('button', { name: new RegExp(`^(Entrar em )?${voice}`) }).first()
await deskVoice.click()
await desk.locator('button[class*=joinPill]').click()

const twoIn = async (page) => {
  for (let i = 0; i < 40; i++) {
    const n = await page.locator('[data-user-id]').count()
    if (n >= 2) return n
    await page.waitForTimeout(500)
  }
  return page.locator('[data-user-id]').count()
}
check('phone: sees 2 in the call', (await twoIn(phone)) >= 2)
check('desk: sees 2 in the call', (await twoIn(desk)) >= 2)
await phone.screenshot({ path: join(out, '02-phone-call.png') })
await desk.screenshot({ path: join(out, '03-desk-call.png') })

// Turning the phone swaps the layouts (landscape is wider than the phone breakpoint): the call must survive both ways.
await phone.setViewportSize({ width: 844, height: 390 })
await phone.waitForTimeout(1500)
check('phone: still in the call after turning to landscape', (await twoIn(desk)) >= 2 && (await twoIn(phone)) >= 2)
await phone.setViewportSize({ width: 390, height: 844 })
await phone.waitForTimeout(1500)
check('phone: still in the call after turning back', (await twoIn(desk)) >= 2)

// Phone: back to the channel list → the call pill; tap it → back on the stage.
await phone.getByRole('button', { name: 'Voltar', exact: true }).tap()
await phone.waitForTimeout(600)
const pill = phone.getByRole('button', { name: 'Abrir a call' })
check('phone: call pill outside the stage', await pill.isVisible())
await phone.screenshot({ path: join(out, '04-phone-pill.png') })
await pill.tap()
await phone.waitForTimeout(600)
check('phone: pill reopens the stage', !(await pill.isVisible()))

// The world on the phone: Mundo › Lounge from the call, the stick walks the figure, two fingers zoom.
if (process.argv.includes('--world')) {
  await phone.getByRole('button', { name: 'Mundo' }).first().tap()
  await phone.locator('[role^=menuitem]', { hasText: 'Lounge' }).first().tap()
  const entered = await phone.getByRole('application', { name: /Andar/ }).waitFor({ timeout: 90_000 }).then(() => true, () => false)
  check('phone: world open with the walking stick', entered)
  await phone.waitForTimeout(2500)
  await phone.screenshot({ path: join(out, '05-phone-world.png') })
  if (entered) {
    const box = await phone.getByRole('application', { name: /Andar/ }).boundingBox()
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2
    const before = await phone.locator('canvas').first().screenshot()
    // Hold the stick forward for a second and a half through a touch-like pointer drag.
    await phone.mouse.move(cx, cy)
    await phone.mouse.down()
    await phone.mouse.move(cx, cy - 46, { steps: 6 })
    await phone.waitForTimeout(1500)
    await phone.screenshot({ path: join(out, '06-phone-world-walking.png') })
    await phone.mouse.up()
    const after = await phone.locator('canvas').first().screenshot()
    check('phone: the stick moved the view', !before.equals(after))
  }
  await phone.getByRole('button', { name: /Ver a chamada/ }).first().tap().catch(() => {})
  await phone.waitForTimeout(800)
}

await phone.getByRole('button', { name: 'Voltar', exact: true }).tap()
await phone.getByRole('button', { name: 'Sair da call' }).tap()
await phone.waitForTimeout(800)
check('phone: left the call from the pill', !(await phone.getByRole('button', { name: 'Abrir a call' }).isVisible()))

await browser.close()
const failed = results.filter((r) => !r.ok).length
console.log(`${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
