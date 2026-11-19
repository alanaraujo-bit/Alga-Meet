// Web Push end to end: the built PWA (vite preview, service worker on), a real Edge subscribed to its real push
// service, a mention sent by someone else through the API, and the notification shown by the service worker.
// Needs a QA API with VAPID_* set and two accounts in the same space (tokens file as in web-e2e.mjs).
//   node scripts/web-push-e2e.mjs --tokens=<file> --phone=pwa_bia --sender=pwa_ana --channel=<text channel id>
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'

const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d
const tokens = JSON.parse(readFileSync(arg('tokens'), 'utf8')).users
const phone = tokens[arg('phone', 'pwa_bia')]
const sender = tokens[arg('sender', 'pwa_ana')]
const channel = arg('channel')
const upstream = process.env.ALGA_API_UPSTREAM ?? 'http://127.0.0.1:4360'
const PORT = 4173
const url = `http://localhost:${PORT}`
const results = []
const check = (name, ok, detail = '') => (results.push(ok), console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`))

const preview = spawn(process.execPath, [join(import.meta.dirname, '..', '..', '..', 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--config', 'vite.web.config.ts', '--port', String(PORT), '--strictPort'], { cwd: join(import.meta.dirname, '..'), env: { ...process.env, ALGA_API_UPSTREAM: upstream }, stdio: 'ignore' })
const profile = mkdtempSync(join(tmpdir(), 'alga-push-'))
try {
  for (let i = 0; i < 40 && !(await fetch(url).then((r) => r.ok, () => false)); i++) await new Promise((r) => setTimeout(r, 250))
  // Headful and persistent: push needs a real profile; the window is moved off screen.
  const ctx = await chromium.launchPersistentContext(profile, { channel: 'msedge', headless: false, viewport: { width: 390, height: 844 }, args: ['--window-position=-2400,0'], permissions: ['notifications'] })
  await ctx.addInitScript((t) => localStorage.setItem('alga.token', t), phone.token)
  const page = ctx.pages()[0] ?? (await ctx.newPage())
  await page.goto(url)
  await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 15000 }).catch(() => page.reload())
  await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 15000 })
  check('service worker controls the page', true)

  // Clicks through the DOM, not the mouse: a real tap would mark us active, and the server rightly holds pushes then.
  await page.getByRole('button', { name: 'Você' }).evaluate((el) => el.click())
  const toggle = page.getByRole('switch', { name: 'Notificações no celular' })
  await toggle.waitFor({ timeout: 10000 })
  await toggle.evaluate((el) => el.click())
  let endpoint = null
  for (let i = 0; i < 30 && !endpoint; i++) {
    await page.waitForTimeout(500)
    endpoint = await page.evaluate(async () => (await (await navigator.serviceWorker.ready).pushManager.getSubscription())?.endpoint ?? null)
  }
  if (!endpoint) throw new Error(`no subscription; the page says: ${await page.locator('[class*=pushCard]').innerText().catch(() => '?')}`)
  check('subscribed to the browser push service', /^https:\/\//.test(endpoint), new URL(endpoint).host)

  // Away from the app (the PWA in the background), someone mentions us.
  const me = await (await fetch(`${upstream}/api/v1/users/@me`, { headers: { authorization: `Bearer ${phone.token}` } })).json()
  await page.goto('about:blank')
  const sw = ctx.serviceWorkers()[0]
  const r = await fetch(`${upstream}/api/v1/channels/${channel}/messages`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${sender.token}` }, body: JSON.stringify({ content: `<@${me.id}> chegou a notificação?` }) })
  check('mention sent', r.ok)
  let shown = []
  for (let i = 0; i < 40 && !shown.length; i++) {
    await new Promise((r) => setTimeout(r, 500))
    shown = (await sw?.evaluate(async () => (await self.registration.getNotifications()).map((n) => ({ title: n.title, body: n.body, tag: n.tag }))).catch(() => [])) ?? []
  }
  check('notification shown by the service worker', shown.length > 0, shown[0] ? `${shown[0].title} — ${shown[0].body}` : 'none in 20 s')
  await ctx.close()
} catch (e) {
  check('run', false, String(e.message).split('\n')[0])
} finally {
  preview.kill()
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
  } catch {}
}
const failed = results.filter((ok) => !ok).length
console.log(`${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
