// Visual validation loop: build → seed real data through the REST API → drive the REAL Electron app → PNGs.
//   node scripts/screenshot.mjs [--skip-build] [--only=auth,home,chat,spaces,attachments,uploads,spacesettings,connection,sizes,settings,voice,billing,invites,trust,wave6,r3]
// Another API (ALGA_API_URL=http://127.0.0.1:4100) gets its own users file, so runs never mix accounts.
// Voice runs two real app instances (profiles shots + shots-b) through the local LiveKit with Chromium fake
// devices: a generated speech WAV is B's microphone (so the speaking glow moves for real) and A's screen share
// is Chromium's fake desktop source (real WebRTC encode → SFU → decode, synthetic picture). Needs LiveKit on
// :7880; pass LIVEKIT_PID (a LiveKit *you* started) to also capture the reconnecting state.
// Output: docs/screenshots/<YYYY-MM-DD>-<screen>-v<n>.png (earlier versions are kept).
// Test users (generated credentials) live in scripts/.shots-users.json (git-ignored).
// ALGA_SHOTS_OUT=<dir> builds and runs the app from that directory instead of apps/desktop/out (so a dev app that
// runs from out/ is never rewritten). LIVEKIT_HTTP points the voice parts at your own SFU (default :7880).
import { execSync, spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer, connect } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron, chromium } from 'playwright'

const here = dirname(fileURLToPath(import.meta.url))
const appDir = join(here, '..')
const repo = join(appDir, '..', '..')
const outDir = join(repo, 'docs', 'screenshots')
const API = process.env.ALGA_API_URL ?? 'http://localhost:4000'
const usersFile = join(here, process.env.ALGA_API_URL ? `.shots-users-${new URL(API).port || 80}.json` : '.shots-users.json')
const PROFILE = 'shots'
const args = process.argv.slice(2)
const only = args.find((a) => a.startsWith('--only='))?.split('=')[1]?.split(',')
const want = (k) => !only || only.includes(k)
const today = new Date().toISOString().slice(0, 10)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const SHOTS_OUT = process.env.ALGA_SHOTS_OUT ?? null
const LK_HTTP = process.env.LIVEKIT_HTTP ?? 'http://127.0.0.1:7880'

// ── output naming ─────────────────────────────────────────────
mkdirSync(outDir, { recursive: true })
const existing = readdirSync(outDir)
// ALGA_SHOTS_TAG=v2-indigo names a design pass: <date>-<screen>-v2-indigo-v<n>.png, numbered apart from plain runs.
const TAG = process.env.ALGA_SHOTS_TAG ? `-${process.env.ALGA_SHOTS_TAG}` : ''
function nextPath(screen) {
  const re = new RegExp(`^${today}-${screen}${TAG}-v(\\d+)\\.png$`)
  const n = Math.max(0, ...existing.map((f) => Number(re.exec(f)?.[1] ?? 0))) + 1
  return join(outDir, `${today}-${screen}${TAG}-v${n}.png`)
}
const shots = []
/** Toasts from earlier steps never leak into a capture (pass { toasts: true } when the toast is the subject). */
async function shot(page, screen, { toasts = false } = {}) {
  if (!toasts) {
    const n = await page.evaluate(() => {
      const list = [...document.querySelectorAll('[role="region"][aria-label="Notificações"] button[aria-label="Dispensar"]')]
      for (const b of list) b.click()
      return list.length
    })
    if (n) await sleep(300)
  }
  await sleep(250)
  const p = nextPath(screen)
  await page.screenshot({ path: p, animations: 'disabled' })
  shots.push(p)
  console.log('  ✓', p.slice(repo.length + 1))
}

// ── REST helpers ──────────────────────────────────────────────
async function api(token, method, path, body, attempt = 0) {
  let res
  try {
    res = await fetch(`${API}/api/v1${path}`, {
      method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch (e) {
    // Dev server restarts (tsx watch) briefly refuse connections.
    if (attempt < 10) {
      await sleep(2000)
      return api(token, method, path, body, attempt + 1)
    }
    throw e
  }
  // Auth routes are rate limited (10/min): wait it out instead of failing the run.
  if (res.status === 429 && attempt < 8) {
    await sleep(8000)
    return api(token, method, path, body, attempt + 1)
  }
  if (res.status === 204) return null
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const err = new Error(`${method} ${path} → ${res.status} ${JSON.stringify(data)}`)
    err.status = res.status
    throw err
  }
  return data
}

/** Multipart REST call (attachments, avatars, icons). FormData is reusable across retries. */
async function apiForm(token, method, path, form, attempt = 0) {
  const res = await fetch(`${API}/api/v1${path}`, { method, headers: { authorization: `Bearer ${token}` }, body: form })
  if (res.status === 429 && attempt < 8) {
    await sleep(8000)
    return apiForm(token, method, path, form, attempt + 1)
  }
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(data)}`)
  return data
}
const fileForm = (paths, payload) => {
  const f = new FormData()
  if (payload) f.append('payload_json', JSON.stringify(payload))
  for (const p of paths) f.append(payload ? 'files' : 'file', new Blob([readFileSync(p)]), basename(p))
  return f
}

const PEOPLE = [
  ['ana', 'Ana Ribeiro'],
  ['bruno', 'Bruno Costa'],
  ['carla', 'Carla Mendes'],
  ['diego', 'Diego Alves'],
  ['elisa', 'Elisa Nogueira'],
  ['fabio', 'Fábio Lima'],
  ['gui', 'Guilherme Rocha'],
]

// Dev e-mail driver writes .eml files here (EMAIL_OUTBOX_DIR of the API you point at).
const OUTBOX = process.env.ALGA_OUTBOX_DIR ?? join(repo, 'apps', 'server', 'data', 'outbox')
/** Newest token mailed to `email` for `kind` (verify_email | password_reset), waiting for the mail to land. */
async function mailedToken(email, kind, after = 0) {
  const esc = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  for (let i = 0; i < 40; i++) {
    const files = existsSync(OUTBOX) ? readdirSync(OUTBOX).filter((f) => f.includes(kind)).sort().reverse() : []
    for (const f of files) {
      const p = join(OUTBOX, f)
      const eml = readFileSync(p, 'utf8')
      if (statSync(p).mtimeMs < after || !new RegExp(`^To: .*${esc}`, 'mi').test(eml)) continue
      const token = /[?&]token=([A-Za-z0-9_-]+)/.exec(eml)?.[1]
      if (token) return token
    }
    await sleep(250)
  }
  throw new Error(`no ${kind} e-mail for ${email} in ${OUTBOX}`)
}

/** Test accounts need a verified e-mail (invites, a second space, DMs): use the token from the outbox mail. */
async function verifyEmail(u) {
  if (u.me.emailVerified !== false) return
  const esc = u.me.email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  for (let i = 0; i < 40; i++) {
    const files = existsSync(OUTBOX) ? readdirSync(OUTBOX).filter((f) => f.includes('verify_email')).sort().reverse() : []
    for (const f of files) {
      const eml = readFileSync(join(OUTBOX, f), 'utf8')
      if (!new RegExp(`^To: .*${esc}`, 'mi').test(eml)) continue
      const token = /[?&]token=([A-Za-z0-9_-]+)/.exec(eml)?.[1]
      if (!token) continue
      const ok = await api(null, 'POST', '/auth/verify-email', { token }).then(() => true, () => false)
      if (ok) {
        u.me = await api(u.token, 'GET', '/users/@me')
        return
      }
    }
    await sleep(250)
  }
  throw new Error(`no verification e-mail for ${u.username} in ${OUTBOX}`)
}

// Accounts declare a birth date and accept the current Termos (GET /legal), like the signup screen does.
const ADULT_BIRTH = '1994-05-12'
let legalVersion
const termsVersion = async () => (legalVersion ??= (await api(null, 'GET', '/legal')).termsVersion)
/** Accounts from before the age gate / an older Termos: declare and accept once, so the one-time prompts stay out of the way. */
async function settleLegal(u) {
  if (u.me.ageBracket === 'unknown') u.me = await api(u.token, 'PATCH', '/users/@me/birth-date', { birthDate: ADULT_BIRTH })
  if (u.me.needsTermsAcceptance) u.me = await api(u.token, 'POST', '/users/@me/accept-terms', { termsVersion: await termsVersion() })
}

async function ensureUsers() {
  const saved = existsSync(usersFile) ? JSON.parse(readFileSync(usersFile, 'utf8')) : { users: {} }
  for (const [key, displayName] of PEOPLE) {
    let u = saved.users[key]
    if (u?.token) {
      try {
        u.me = await api(u.token, 'GET', '/users/@me')
        await settleLegal(u)
        continue
      } catch {
        /* token expired: log in again */
      }
    }
    if (u) {
      const r = await api(null, 'POST', '/auth/login', { login: u.username, password: u.password })
      Object.assign(u, { token: r.token, me: r.user })
      await settleLegal(u)
      continue
    }
    // Real-looking handles (@carla.mendes) on a fresh API; a hex suffix only when the name is taken.
    const clean = displayName.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/ /g, '.')
    const password = randomBytes(12).toString('base64url')
    const register = async (username) => api(null, 'POST', '/auth/register', { email: `${username}@shots.alga.test`, username, displayName, password, birthDate: ADULT_BIRTH, termsVersion: await termsVersion() })
    let username = clean
    let r = await register(username).catch((e) => (e.status === 409 ? null : Promise.reject(e)))
    if (!r) r = await register((username = `${key}.${randomBytes(2).toString('hex')}`))
    saved.users[key] = { username, password, token: r.token, me: r.user }
    writeFileSync(usersFile, JSON.stringify(saved, null, 2))
  }
  // Elisa stays unverified: she shows the calm "confirme seu e-mail" strip and the friendly 403 prompts.
  for (const [key] of PEOPLE) if (key !== 'elisa') await verifyEmail(saved.users[key])
  writeFileSync(usersFile, JSON.stringify(saved, null, 2))
  return saved
}

async function seed(saved) {
  const U = saved.users
  const T = (k) => U[k].token
  const id = (k) => U[k].me.id
  console.log('seeding…')

  // Previous run's spaces and DM messages go away so every run shows the same fresh story.
  for (const sp of saved.spaces ?? []) await api(T(sp.owner), 'DELETE', `/spaces/${sp.id}`).catch(() => undefined)
  for (const m of saved.dmMessages ?? []) await api(T(m.by), 'DELETE', `/channels/${m.channelId}/messages/${m.id}`).catch(() => undefined)
  saved.spaces = []
  saved.dmMessages = []

  // Relationships (idempotent).
  const rels = await api(T('ana'), 'GET', '/relationships')
  const relOf = (k) => rels.find((r) => r.user.id === id(k))?.type
  for (const k of ['bruno', 'carla', 'diego', 'gui']) {
    if (relOf(k) === 'friend') continue
    if (relOf(k) !== 'outgoing') await api(T('ana'), 'POST', '/relationships', { username: U[k].username }).catch(() => undefined)
    await api(T(k), 'PUT', `/relationships/${id('ana')}`, { type: 'friend' })
  }
  if (!relOf('elisa')) await api(T('elisa'), 'POST', '/relationships', { username: U.ana.username })
  if (!relOf('fabio')) await api(T('ana'), 'POST', '/relationships', { username: U.fabio.username })

  // Space 1: Estúdio Alga (owned by Ana).
  const s1 = await api(T('ana'), 'POST', '/spaces', { name: 'Estúdio Alga' })
  saved.spaces.push({ id: s1.id, owner: 'ana' })
  const geral = s1.channels.find((c) => c.type === 'text')
  const design = await api(T('ana'), 'POST', `/spaces/${s1.id}/channels`, { type: 'text', name: 'design', topic: 'Telas, tokens e motion' })
  await api(T('ana'), 'POST', `/spaces/${s1.id}/channels`, { type: 'text', name: 'off-topic' })
  const focus = await api(T('ana'), 'POST', `/spaces/${s1.id}/channels`, { type: 'voice', name: 'Sala de foco', topic: 'Pareamento e revisão ao vivo' })
  const jogo = await api(T('ana'), 'POST', `/spaces/${s1.id}/channels`, { type: 'voice', name: 'Sala de jogo' })
  await api(T('ana'), 'PATCH', `/channels/${geral.id}`, { topic: 'Conversa geral do estúdio. Sem pressa, sem ruído.' })
  const inv = await api(T('ana'), 'POST', `/spaces/${s1.id}/invites`, { maxAgeSeconds: 0, maxUses: 0 })
  for (const k of ['bruno', 'carla', 'diego']) await api(T(k), 'POST', `/invites/${inv.code}`)
  saved.inviteCode = inv.code

  const say = async (k, channelId, content, replyToId) =>
    api(T(k), 'POST', `/channels/${channelId}/messages`, { content, ...(replyToId ? { replyToId } : {}) })
  const m1 = await say('bruno', geral.id, 'Bom dia, pessoal! Subi a nova versão do protótipo da sala de voz 🎧')
  await say('bruno', geral.id, 'O link ficou aqui: https://alga.meet/prototipo')
  const m3 = await say('carla', geral.id, 'Ficou **muito** bom. O brilho de quem fala é *exatamente* o que eu imaginava.')
  const m4 = await say('carla', geral.id, 'Só achei que o `release` de 240 ms podia ser um pouco mais curto em notebooks.')
  await say('diego', geral.id, 'Concordo. Testei num i5 de 2019 e o envelope ficou suave, sem engasgo.', m4.id)
  await say('diego', geral.id, '```ts\nconst tau = target > env ? 60 : 240\nenv += (target - env) * (1 - Math.exp(-dt / tau))\n```')
  await say('ana', geral.id, `Vou ajustar hoje. <@${id('bruno')}> consegue revisar o PR à tarde?`)
  const m8 = await say('bruno', geral.id, 'Consigo! Mando os comentários até as 16h.')
  await api(T('ana'), 'PUT', `/channels/${geral.id}/messages/${m1.id}/reactions/${encodeURIComponent('👍')}`)
  await api(T('carla'), 'PUT', `/channels/${geral.id}/messages/${m1.id}/reactions/${encodeURIComponent('👍')}`)
  await api(T('diego'), 'PUT', `/channels/${geral.id}/messages/${m1.id}/reactions/${encodeURIComponent('🎉')}`)
  await api(T('ana'), 'PUT', `/channels/${geral.id}/messages/${m3.id}/reactions/${encodeURIComponent('❤️')}`)
  await api(T('ana'), 'POST', `/channels/${geral.id}/ack`, { messageId: m8.id })
  await say('bruno', geral.id, `<@${id('ana')}> sobe a build pra eu testar com o pessoal hoje à noite?`)
  await say('carla', geral.id, 'Eu topo testar também 🙌')

  await say('carla', design.id, 'Atualizei a escala de superfícies: seis níveis, passos de 0,03 em L.')
  await say('diego', design.id, 'Os menus de contexto agora usam raio 12 com itens de 6. Fica concêntrico.')

  // Space 2: Clube do Jogo (owned by Bruno), Ana is a member with a mention waiting.
  const s2 = await api(T('bruno'), 'POST', '/spaces', { name: 'Clube do Jogo' })
  saved.spaces.push({ id: s2.id, owner: 'bruno' })
  const inv2 = await api(T('bruno'), 'POST', `/spaces/${s2.id}/invites`, {})
  for (const k of ['ana', 'carla']) await api(T(k), 'POST', `/invites/${inv2.code}`)
  const g2 = s2.channels.find((c) => c.type === 'text')
  await say('bruno', g2.id, `Partida hoje às 21h? <@${id('ana')}> você entra?`)

  // DMs.
  const dmB = await api(T('ana'), 'POST', '/users/@me/channels', { recipientIds: [id('bruno')] })
  const dmC = await api(T('carla'), 'POST', '/users/@me/channels', { recipientIds: [id('ana')] })
  const dm = async (k, ch, content) => {
    const m = await say(k, ch.id, content)
    saved.dmMessages.push({ by: k, channelId: ch.id, id: m.id })
    return m
  }
  await dm('bruno', dmB, 'Ana, vi o vídeo da transmissão em 1080p60. Ficou lindo.')
  await dm('ana', dmB, 'Valeu! O encode por hardware segurou bem.')
  const last = await dm('bruno', dmB, 'Amanhã testamos com 8 pessoas na sala?')
  await api(T('ana'), 'POST', `/channels/${dmB.id}/ack`, { messageId: last.id })
  await dm('carla', dmC, 'Te mandei o arquivo dos ícones novos 💌')

  // Wave 3: real uploads (generated demo pictures, demoMedia; video and audio from ffmpeg), roles, a nickname, people to moderate.
  await demoMedia()
  const media = testMedia()
  await api(T('ana'), 'PATCH', '/users/@me', { avatarUrl: null })
  await apiForm(T('bruno'), 'PUT', '/users/@me/avatar', fileForm([media('avatar-bruno.png')]))
  await apiForm(T('carla'), 'PUT', '/users/@me/avatar', fileForm([media('avatar-carla.png')]))
  const fotos = await api(T('ana'), 'POST', `/spaces/${s1.id}/channels`, { type: 'text', name: 'fotos', topic: 'Capturas, vídeos e arquivos do projeto' })
  const post = (k, content, files) => apiForm(T(k), 'POST', `/channels/${fotos.id}/messages`, fileForm(files.map(media), { content }))
  await post('bruno', 'Primeira luz da orla no protótipo novo 🌅', ['orla.jpg'])
  await post('carla', 'Três fundos para a tela de chamada:', ['fractal.png', 'retrato.jpg', 'vida.png'])
  await post('diego', '', ['padrao-720p.png', 'barras.png', 'orla.jpg', 'fractal.png', 'vida.png'])
  await post('bruno', 'Gravação do ensaio de ontem', ['ensaio.mp4'])
  await post('carla', 'Nota de voz e o roteiro para quem não estava', ['nota-de-voz.mp3', 'roteiro.txt'])
  // Roles: each new one enters at position 1 and pushes the others up, so create top-down:
  // Coordenação > Moderação > Design > Convidados.
  const P = { CHANNELS: 4, INVITES: 32, ROLES: 16, KICK: 64, BAN: 128, MESSAGES: 512, MUTE: 1 << 15, DEAFEN: 1 << 16, MOVE: 1 << 17, NICKS: 1 << 19 }
  const role = (body) => api(T('ana'), 'POST', `/spaces/${s1.id}/roles`, body)
  const coord = await role({ name: 'Coordenação', color: '#dec1ab', permissions: P.ROLES | P.KICK | P.BAN | P.NICKS | P.MUTE | P.DEAFEN | P.MOVE | P.MESSAGES | P.CHANNELS | P.INVITES })
  const mod = await role({ name: 'Moderação', color: '#b0cbe3', permissions: P.ROLES | P.KICK | P.NICKS | P.MUTE | P.MESSAGES | P.INVITES })
  const des = await role({ name: 'Design', color: '#e1bcc6' })
  await role({ name: 'Convidados', color: '#c3ccac' })
  for (const [k, r] of [['diego', coord], ['carla', mod], ['bruno', des]]) await api(T('ana'), 'PUT', `/spaces/${s1.id}/members/${id(k)}/roles/${r.id}`)
  await api(T('ana'), 'PATCH', `/spaces/${s1.id}/members/${id('carla')}`, { nickname: 'Carlinha' })
  for (const k of ['elisa', 'fabio']) await api(T(k), 'POST', `/invites/${inv.code}`)

  writeFileSync(usersFile, JSON.stringify(saved, null, 2))
  return { s1, s2, geral, design, dmB, dmC, focus, jogo, fotos }
}

/** Keep other test users online over the gateway (presence), with heartbeats. */
function connectPresence(token, status) {
  const ws = new WebSocket(API.replace(/^http/, 'ws') + '/gateway')
  let hb = null
  ws.onopen = () => ws.send(JSON.stringify({ op: 'identify', token }))
  ws.onmessage = (ev) => {
    const f = JSON.parse(String(ev.data))
    if (f.op === 'dispatch' && f.t === 'READY') {
      hb = setInterval(() => ws.send(JSON.stringify({ op: 'heartbeat' })), f.d.heartbeatIntervalMs)
      if (status) ws.send(JSON.stringify({ op: 'presence', status }))
    }
  }
  return () => {
    if (hb) clearInterval(hb)
    ws.close()
  }
}

// ── app driving ───────────────────────────────────────────────
const require = createRequire(join(appDir, 'package.json'))
const electronPath = require('electron')

async function launch({ width = 1320, height = 840, scale, keepProfile, apiUrl, profile = PROFILE, extra = [] } = {}) {
  // Fresh profile by default: no stored token, no persisted window bounds.
  const profileDir = join(process.env.APPDATA ?? '', 'Alga Meet Dev', 'profiles', profile)
  if (!keepProfile) rmSync(profileDir, { recursive: true, force: true })
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RENDERER_URL'))
  if (apiUrl) env.ALGA_API_URL = apiUrl
  const app = await electron.launch({
    executablePath: electronPath,
    args: [SHOTS_OUT ?? appDir, `--profile=${profile}`, ...(scale ? [`--force-device-scale-factor=${scale}`] : []), ...extra],
    cwd: SHOTS_OUT ?? appDir,
    env,
  })
  const page = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }, [w, h]) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.setContentSize(w, h)
    // Automation windows open off-screen (main/window.ts): keep them there, never over the owner's screen.
    if (win.getBounds().x > -10000) win.center()
  }, [width, height])
  await page.waitForLoadState('domcontentloaded')
  await sleep(400)
  return { app, page }
}

async function login(page, u) {
  await page.getByLabel('E-mail ou nome de usuário').fill(u.username)
  await page.getByLabel('Senha', { exact: true }).fill(u.password)
  for (let i = 0; i < 8; i++) {
    await page.getByRole('button', { name: 'Entrar', exact: true }).click()
    const nav = page.getByRole('navigation', { name: 'Espaços' })
    const limited = page.getByText('Muitas tentativas')
    await nav.or(limited).first().waitFor({ timeout: 20_000 })
    if (await nav.isVisible()) break
    await sleep(10_000)
  }
  await page.getByRole('navigation', { name: 'Espaços' }).waitFor({ timeout: 20_000 })
  await sleep(600)
}

const rail = (page, name) => page.getByRole('navigation', { name: 'Espaços' }).getByRole('button', { name })

async function close(app) {
  await app.close().catch(() => undefined)
}

async function authShots(serverUp) {
  console.log('auth…')
  const { app, page } = await launch()
  await page.getByLabel('E-mail ou nome de usuário').waitFor()
  await shot(page, 'auth-login')
  if (!serverUp) return close(app)
  await page.getByLabel('E-mail ou nome de usuário').fill('ninguem.aqui')
  await page.getByLabel('Senha', { exact: true }).fill('senha-errada-123')
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.getByRole('alert').first().waitFor()
  // Caps Lock hint: synthesized key events cannot toggle the real lock, so dispatch one that reports it.
  await page.getByLabel('Senha', { exact: true }).focus()
  await page.getByLabel('Senha', { exact: true }).evaluate((el) =>
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'A', bubbles: true, modifierCapsLock: true })),
  )
  await shot(page, 'auth-login-error')
  await page.getByRole('button', { name: 'Criar conta' }).click()
  await page.getByLabel('E-mail', { exact: true }).waitFor()
  await page.getByLabel('E-mail', { exact: true }).fill('isso-nao-e-email')
  await page.getByLabel('Nome de usuário').fill('A')
  await page.getByLabel('Senha', { exact: true }).fill('curta')
  await page.getByRole('button', { name: 'Criar conta' }).click()
  await shot(page, 'auth-register-errors')

  // First run: a brand-new account goes straight to onboarding.
  const username = `nova.${randomBytes(3).toString('hex')}`
  await page.getByLabel('E-mail', { exact: true }).fill(`${username}@shots.alga.test`)
  await page.getByLabel('Nome de exibição').fill('Marina Souza')
  await page.getByLabel('Nome de usuário').fill(username)
  await page.getByLabel('Data de nascimento').fill('12051994')
  await page.getByLabel('Senha', { exact: true }).fill(randomBytes(12).toString('base64url'))
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Criar conta' }).click()
  await page.getByText('Boas-vindas, Marina').waitFor({ timeout: 20_000 })
  await shot(page, 'onboarding')
  await page.getByRole('button', { name: /Criar um espaço/ }).click()
  await page.getByRole('dialog').waitFor()
  await shot(page, 'onboarding-create-space')
  // Unverified account: one own space works; invites answer 403 and the app offers to confirm the e-mail.
  const email = `${username}@shots.alga.test`
  await page.getByLabel('Nome do espaço').fill('Ateliê da Marina')
  await page.getByRole('button', { name: 'Criar espaço' }).click()
  await page.getByRole('dialog').waitFor({ state: 'detached' })
  await page.getByRole('button', { name: 'Conversas', exact: true }).click()
  await page.getByRole('button', { name: 'Confirme seu e-mail' }).waitFor()
  await sleep(400)
  await shot(page, 'home-verify-strip')
  await rail(page, /^Ateliê da Marina/).click()
  await page.getByRole('complementary', { name: 'Canais' }).getByRole('button', { name: 'Ateliê da Marina' }).click()
  await page.getByRole('menuitem', { name: 'Convidar pessoas' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmar e-mail' }).waitFor()
  await sleep(300)
  await shot(page, 'space-invite-unverified')
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmar e-mail' }).click()
  const verify = page.getByRole('dialog', { name: 'Confirme seu e-mail' })
  await verify.waitFor()
  await verify.getByLabel('Link ou código').fill('codigo-que-nao-existe')
  await verify.getByRole('button', { name: 'Confirmar', exact: true }).click()
  await verify.getByRole('alert').waitFor()
  await sleep(200)
  await shot(page, 'verify-email-dialog')
  const before = Date.now() - 1000
  await verify.getByRole('button', { name: 'Reenviar e-mail' }).click()
  await verify.getByText(/Reenviar em/).waitFor()
  const token = await mailedToken(email, 'verify_email', before)
  await verify.getByLabel('Link ou código').fill(`algameet://auth/verify-email?token=${token}`)
  await sleep(200)
  await shot(page, 'verify-email-resent')
  await verify.getByRole('button', { name: 'Confirmar', exact: true }).click()
  await verify.waitFor({ state: 'detached' })
  await page.getByText('E-mail confirmado.').waitFor()
  // The same invite now works (Tentar de novo comes back as the copy button after a fresh attempt).
  await page.keyboard.press('Escape')
  await page.getByRole('complementary', { name: 'Canais' }).getByRole('button', { name: 'Ateliê da Marina' }).click()
  await page.getByRole('menuitem', { name: 'Convidar pessoas' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Copiar' }).waitFor({ timeout: 10_000 })
  await sleep(300)
  await shot(page, 'space-invite-verified')
  await close(app)
}

/** Forgot password: request → paste the mailed link + a new password → back to login with the new one. */
async function recoveryShots(saved) {
  console.log('password reset…')
  const u = saved.users.gui
  const { app, page } = await launch()
  await page.getByLabel('E-mail ou nome de usuário').waitFor()
  await page.getByRole('button', { name: 'Esqueci minha senha' }).click()
  await page.getByLabel('E-mail', { exact: true }).fill(u.me.email)
  await sleep(200)
  await shot(page, 'auth-forgot')
  const before = Date.now() - 1000
  await page.getByRole('button', { name: 'Enviar link' }).click()
  await page.getByLabel('Link ou código do e-mail').waitFor()
  const token = await mailedToken(u.me.email, 'password_reset', before)
  await page.getByLabel('Link ou código do e-mail').fill(`algameet://auth/reset-password?token=${token}`)
  await page.getByLabel('Nova senha').fill('abcabcabcabc')
  await page.getByRole('button', { name: 'Trocar senha' }).click()
  await page.getByRole('alert').waitFor()
  await sleep(200)
  await shot(page, 'auth-reset-weak')
  const password = `${randomBytes(9).toString('base64url')} lua cheia`
  await page.getByLabel('Nova senha').fill(password)
  await page.getByRole('button', { name: 'Trocar senha' }).click()
  await page.getByText('Senha trocada.').waitFor()
  await sleep(300)
  await shot(page, 'auth-reset-done')
  // Keep the harness able to log in as Gui (every session was revoked by the reset).
  const r = await api(null, 'POST', '/auth/login', { login: u.username, password })
  Object.assign(u, { password, token: r.token, me: r.user })
  writeFileSync(usersFile, JSON.stringify(saved, null, 2))
  await close(app)
}

async function mainShots(saved) {
  const offs = [connectPresence(saved.users.bruno.token), connectPresence(saved.users.carla.token), connectPresence(saved.users.diego.token, 'idle')]
  try {
    const ids = await seed(saved)
    if (want('home') || want('chat') || want('spaces') || want('attachments') || want('spacesettings')) {
      console.log('shell…')
      const { app, page } = await launch()
      await login(page, saved.users.ana)
      if (want('home')) await homeShots(page)
      if (want('chat')) await chatShots(page, saved, ids)
      if (want('spaces')) await spaceShots(page, saved)
      if (want('attachments')) await attachmentShots(page, saved, ids)
      if (want('spacesettings')) await spaceSettingsShots(page, saved)
      await close(app)
    }
    if (want('spacesettings')) await limitedSpaceSettingsShots(saved)
    if (want('auth')) await recoveryShots(saved)
    if (want('uploads')) await uploadShots(saved, ids)
    if (want('settings')) await settingsShots(saved, ids)
    if (want('voice')) await voiceShots(saved, ids)
    if (want('connection')) await connectionShots(saved, ids)
    if (want('sizes')) await sizeShots(saved)
    if (want('billing')) await billingShots(saved, ids)
    if (want('invites')) await inviteShots(saved, ids)
  } finally {
    offs.forEach((off) => off())
  }
}

async function homeShots(page) {
  const home = page.getByRole('button', { name: 'Conversas', exact: true })
  await home.click()
  await page.getByRole('tab', { name: 'Online' }).click()
  await shot(page, 'friends-online')
  // Keyboard focus is visible (2px accent ring), mouse focus is not.
  await page.getByRole('tab', { name: 'Online' }).focus()
  await page.keyboard.press('ArrowRight')
  await shot(page, 'focus-visible-tabs')
  await page.getByRole('tab', { name: 'Todos' }).click()
  await shot(page, 'friends-all')
  await page.getByRole('tab', { name: /Pendentes/ }).click()
  await shot(page, 'friends-pending')
  await page.getByRole('listitem').first().click({ button: 'right' })
  await page.getByRole('menu').waitFor()
  await shot(page, 'friends-context-menu')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Adicionar amigo' }).click()
  await page.getByPlaceholder('nome_de_usuario').fill('alguem.que.nao.existe')
  await page.getByRole('button', { name: 'Enviar pedido' }).click()
  await page.getByRole('alert').waitFor()
  await shot(page, 'friends-add-error')
}

async function chatShots(page, saved, ids) {
  // DM
  await page.getByRole('button', { name: 'Conversas', exact: true }).click()
  await page.getByRole('button', { name: /Bruno Costa/ }).first().click()
  await page.getByRole('log').waitFor()
  await sleep(500)
  await shot(page, 'dm')

  // Space channel with unread line, mentions, reply, code, reactions
  await rail(page, /^Estúdio Alga/).click()
  await page.getByRole('button', { name: /^geral/ }).click()
  await page.getByText('Eu topo testar também').waitFor()
  // Typing indicator comes from Bruno's real typing request.
  await api(saved.users.bruno.token, 'POST', `/channels/${ids.geral.id}/typing`)
  await sleep(700)
  await shot(page, 'chat-channel')

  const msg = page.locator('[data-message-id]').filter({ hasText: 'Consigo! Mando os comentários' })
  await msg.hover()
  await shot(page, 'chat-hover-toolbar')
  await msg.click({ button: 'right' })
  await page.getByRole('menu').waitFor()
  await shot(page, 'chat-context-menu')
  await page.keyboard.press('Escape')

  // Reply + composer
  await page.locator('[data-message-id]').filter({ hasText: 'sobe a build' }).hover()
  await page.getByRole('toolbar').getByRole('button', { name: 'Responder' }).last().click()
  await page.keyboard.type('Subo sim! **Hoje às 20h** com o `release` em 180 ms.')
  await shot(page, 'chat-reply-composer')
  await page.keyboard.press('Enter')
  await sleep(800)
  // ↑ edits the last own message
  await page.keyboard.press('ArrowUp')
  await sleep(300)
  await shot(page, 'chat-inline-edit')
  await page.keyboard.press('Escape')

  // Scrolled up + a new message arrives → jump pill.
  await page.getByRole('log').evaluate((el) => (el.scrollTop = 0))
  await sleep(400)
  await api(saved.users.carla.token, 'POST', `/channels/${ids.geral.id}/messages`, { content: 'Combinado então: 20h na Sala de foco.' })
  await page.getByText(/nova mensagem/).waitFor()
  await shot(page, 'chat-jump-pill')
  await page.getByText(/nova mensagem/).click()
  await sleep(500)

  // @mention autocomplete and the emoji picker (both in the composer).
  const box = page.getByRole('textbox', { name: /Mensagem para/ })
  await box.click()
  await page.keyboard.type('Valeu @ca')
  await page.getByRole('listbox', { name: 'Mencionar' }).waitFor()
  await shot(page, 'chat-mention-autocomplete')
  await page.keyboard.press('Escape')
  await box.fill('')
  await page.getByRole('button', { name: 'Emoji', exact: true }).click()
  await page.getByRole('dialog', { name: 'Emojis' }).waitFor()
  await page.keyboard.type('cora')
  await sleep(150)
  await shot(page, 'chat-emoji-picker')
  await page.keyboard.press('Escape')

  // Quick switcher
  await page.keyboard.press('Control+K')
  await page.getByRole('combobox').waitFor()
  await shot(page, 'switcher')
  await page.keyboard.type('des')
  await sleep(200)
  await shot(page, 'switcher-query')
  await page.keyboard.press('Escape')

  // Status popover
  await page.locator('button[aria-haspopup="dialog"]').filter({ hasText: 'Ana Ribeiro' }).first().click()
  await page.getByRole('dialog', { name: 'Definir status' }).waitFor()
  await shot(page, 'user-status')
  await page.keyboard.press('Escape')
}

async function spaceShots(page, saved) {
  await rail(page, /^Estúdio Alga/).click()
  await page.getByRole('complementary', { name: 'Canais' }).getByRole('button', { name: 'Estúdio Alga' }).click() // header dropdown
  await page.getByRole('menu').waitFor()
  await shot(page, 'space-menu')
  await page.getByRole('menuitem', { name: 'Convidar pessoas' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Copiar' }).waitFor({ timeout: 10_000 })
  await sleep(300)
  await shot(page, 'space-invite')
  await page.keyboard.press('Escape')
  await page.getByRole('dialog').waitFor({ state: 'detached' })
  await page.getByRole('button', { name: 'Criar canal de texto' }).first().click({ force: true })
  await page.getByRole('dialog').waitFor()
  await page.getByLabel('Nome do canal').fill('Ideias Soltas')
  await shot(page, 'space-create-channel')
  await page.keyboard.press('Escape')
  await page.getByRole('dialog').waitFor({ state: 'detached' })
  await page.getByRole('button', { name: 'Criar ou entrar em um espaço' }).click()
  await page.getByRole('menuitem', { name: 'Entrar com convite' }).click()
  await page.getByLabel('Link ou código do convite').fill(`https://alga.meet/i/${saved.inviteCode}`)
  await page.getByText('Você já está neste espaço.').waitFor({ timeout: 10_000 })
  await shot(page, 'space-join-preview')
  await page.keyboard.press('Escape')
  await page.getByRole('dialog').waitFor({ state: 'detached' })
  // Voice screens come from voiceShots (two instances with fake devices): clicking a voice channel here would
  // join it with this machine's real microphone.
}

async function settingsShots(saved) {
  console.log('settings…')
  const { app, page } = await launch()
  await login(page, saved.users.ana)
  await page.getByRole('button', { name: 'Configurações' }).click()
  const dlg = page.getByRole('dialog', { name: 'Configurações' })
  await dlg.waitFor()
  await sleep(600)
  // Avatar: a real file through the crop dialog (zoomed and panned), resized to ≤ 1024 px on a canvas, uploaded.
  await dlg.locator('input[type=file]').setInputFiles(testMedia()('foto-perfil.jpg'))
  const crop = page.getByRole('dialog', { name: 'Enquadrar imagem' })
  await crop.waitFor()
  await crop.getByRole('slider', { name: 'Zoom' }).fill('1.6')
  await crop.getByRole('group', { name: /Área de recorte/ }).focus()
  for (let i = 0; i < 6; i++) await page.keyboard.press('Shift+ArrowLeft')
  await sleep(300)
  await shot(page, 'settings-avatar-crop')
  await crop.getByRole('button', { name: 'Aplicar' }).click()
  await crop.waitFor({ state: 'detached' })
  await dlg.locator('img').first().waitFor()
  await sleep(500)
  await shot(page, 'settings-account')
  // Security: strength hint as you type, and "Sair de todas as outras sessões".
  await dlg.getByLabel('Nova senha').fill('cavalo azul')
  await dlg.getByRole('button', { name: 'Sair de todas as outras sessões' }).scrollIntoViewIfNeeded()
  await sleep(200)
  await shot(page, 'settings-account-security')
  await dlg.getByLabel('Nova senha').fill('Cavalo-Azul-Correndo-7')
  await sleep(150)
  await shot(page, 'settings-password-strong')
  await dlg.getByLabel('Nova senha').fill('')
  for (const [name, key] of [
    ['Atalhos', 'hotkeys'],
    ['Notificações', 'notifications'],
    ['Aparência', 'appearance'],
    ['Inicialização', 'startup'],
    ['Avançado', 'advanced'],
  ]) {
    await dlg.getByRole('navigation').getByRole('button', { name }).click()
    await sleep(350)
    await shot(page, `settings-${key}`)
  }
  // Compact density is real: show the shell with it on, then put it back.
  await dlg.getByRole('navigation').getByRole('button', { name: 'Aparência' }).click()
  await dlg.getByRole('radio', { name: 'Compacta' }).click()
  await page.keyboard.press('Escape')
  await dlg.waitFor({ state: 'detached' })
  await rail(page, /^Estúdio Alga/).click()
  await channels(page).getByRole('button', { name: /^geral/ }).click()
  await page.getByText('Eu topo testar também').waitFor({ timeout: 15_000 }).catch(async (e) => {
    await page.screenshot({ path: join(work, 'fail-density.png') })
    throw e
  })
  await sleep(300)
  await shot(page, 'density-compact')
  await page.keyboard.press('Control+,')
  await dlg.getByRole('navigation').getByRole('button', { name: 'Aparência' }).click()
  await dlg.getByRole('radio', { name: 'Confortável' }).click()
  await page.keyboard.press('Escape')
  await close(app)
}

// ── wave 3: attachments, uploads, space settings ─────────────

/** Synthetic media for uploads: pictures from demoMedia (generated, on-palette), video/audio from ffmpeg test sources. Never files from this machine. */
function testMedia() {
  const dir = join(work, 'media')
  mkdirSync(dir, { recursive: true })
  const out = (n) => join(dir, n)
  const make = (name, args) => existsSync(out(name)) || ffmpeg([...args, out(name)])
  const still = (name, src) => make(name, ['-f', 'lavfi', '-i', src, '-frames:v', '1'])
  still('orla.jpg', 'gradients=s=1600x1000:c0=0x0b2a33:c1=0x21c9ca:c2=0xf2c25c:x0=0:y0=1000:x1=1600:y1=0:nb_colors=3')
  still('fractal.png', 'mandelbrot=s=1200x800')
  still('padrao-720p.png', 'testsrc2=s=1280x720')
  still('retrato.jpg', 'gradients=s=900x1200:c0=0x1a1440:c1=0x8f9cff:c2=0xef87c4:nb_colors=3:type=radial')
  still('vida.png', 'life=s=900x1200:mold=10:ratio=0.12:seed=7:death_color=0x0b2a33:life_color=0x4ddcdc')
  still('barras.png', 'smptehdbars=s=1920x1080')
  still('icone.png', 'gradients=s=600x600:c0=0x061415:c1=0x21c9ca:c2=0xc8fbff:nb_colors=3:type=circular')
  still('foto-perfil.jpg', 'gradients=s=1600x1200:c0=0x3a1f4a:c1=0xef87c4:c2=0xf2c25c:nb_colors=3:type=spiral')
  still('avatar-bruno.png', 'gradients=s=512x512:c0=0x123a5a:c1=0x5fb8f5:type=radial')
  still('avatar-carla.png', 'gradients=s=512x512:c0=0x3d1a33:c1=0xf28b6b:c2=0xf2c25c:nb_colors=3')
  make('ensaio.mp4', ['-f', 'lavfi', '-i', 'testsrc2=s=1280x720:d=4', '-f', 'lavfi', '-i', 'sine=f=440:d=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest'])
  make('ensaio-longo.mp4', ['-f', 'lavfi', '-i', 'testsrc2=s=1280x720:d=16', '-c:v', 'libx264', '-b:v', '3M', '-pix_fmt', 'yuv420p'])
  make('nota-de-voz.mp3', ['-f', 'lavfi', '-i', 'sine=f=220:d=6', '-c:a', 'libmp3lame'])
  if (!existsSync(out('roteiro.txt'))) writeFileSync(out('roteiro.txt'), 'Roteiro do teste de voz\n1. Entrar na Sala de foco\n2. Compartilhar a tela\n')
  if (!existsSync(out('pacote-grande.bin'))) writeFileSync(out('pacote-grande.bin'), Buffer.alloc(26 * 1024 * 1024, 7))
  return out
}

const composerFile = (page) => page.locator('input[type=file]').first()

async function attachmentShots(page, saved, ids) {
  console.log('attachments…')
  const media = testMedia()
  // Expired signed URLs: the first request of each file answers 403 (as after ~1 h); the app must refetch the
  // message page for fresh URLs and show the images anyway.
  const seen = new Set()
  let expired = 0
  await page.route('**/api/v1/files/**', (route) => {
    const u = new URL(route.request().url())
    if (!seen.has(u.pathname)) {
      seen.add(u.pathname)
      expired++
      return route.fulfill({ status: 403, body: '' })
    }
    return route.continue()
  })
  await rail(page, /^Estúdio Alga/).click()
  await channels(page).getByRole('button', { name: /^fotos/ }).click()
  await page.getByText('Nota de voz e o roteiro').waitFor()
  page.on('console', (m) => m.type() === 'error' && console.log('  [renderer]', m.text().slice(0, 200)))
  await page
    .waitForFunction(() => [...document.querySelectorAll('[data-message-id] button > img')].filter((i) => i.naturalWidth > 0).length >= 9, null, { timeout: 20_000 })
    .catch(async (e) => {
      await page.screenshot({ path: join(work, 'fail-attachments.png') })
      console.log('  imgs:', await page.evaluate(() => [...document.querySelectorAll('[data-message-id] img')].map((i) => `${i.naturalWidth}:${i.src.slice(0, 80)}`)))
      throw e
    })
  const loaded = await page.evaluate(() => [...document.querySelectorAll('[data-message-id] button > img')].filter((i) => i.naturalWidth > 0).length)
  console.log(`  · signed-URL refresh: ${expired} first loads answered 403, ${loaded} images on screen after the refetch`)
  await page.unroute('**/api/v1/files/**')
  await sleep(600)
  await shot(page, 'chat-attachments')
  await page.locator('[data-message-id]').filter({ has: page.getByRole('button', { name: 'Abrir barras.png' }) }).evaluate((el) => el.scrollIntoView({ block: 'center' }))
  await sleep(400)
  await shot(page, 'chat-attachments-grid')
  // Lightbox: open the 2nd image of the 5-image message, go right once.
  await page.getByRole('button', { name: 'Abrir barras.png' }).click()
  await page.getByRole('dialog', { name: 'Visualizar imagem' }).waitFor()
  await sleep(400)
  await shot(page, 'chat-lightbox')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('+')
  await sleep(400)
  await shot(page, 'chat-lightbox-actual')
  await page.keyboard.press('Escape')
  await page.getByRole('dialog', { name: 'Visualizar imagem' }).waitFor({ state: 'detached' })

  // Tray: three real images, a text file and one too big (flagged before any upload).
  await composerFile(page).setInputFiles([media('retrato.jpg'), media('vida.png'), media('padrao-720p.png'), media('roteiro.txt'), media('pacote-grande.bin')])
  await page.getByRole('textbox', { name: /Mensagem para/ }).fill('Separei estes para a apresentação')
  await sleep(500)
  await shot(page, 'chat-attach-tray')
  await page.getByRole('button', { name: 'Remover pacote-grande.bin' }).click()
  // Removing a file hands focus back to the composer, so Enter sends right away.
  await page.keyboard.press('Enter')
  await page.locator('[data-message-id]').filter({ hasText: 'Separei estes para a apresentação' }).waitFor()
  await page.waitForFunction(() => !document.querySelector('[role=progressbar]'), null, { timeout: 20_000 })
  await sleep(800)
  await shot(page, 'chat-attachments-sent')

  // Drag and drop: a real DragEvent with a File over the conversation shows the drop target.
  const col = page.getByRole('log')
  await col.evaluate((el) => {
    const dt = new DataTransfer()
    dt.items.add(new File([new Uint8Array(64)], 'captura.png', { type: 'image/png' }))
    el.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true }))
  })
  await sleep(300)
  await shot(page, 'chat-drop-zone')
  await col.evaluate((el) => el.dispatchEvent(new DragEvent('dragleave', { dataTransfer: new DataTransfer(), bubbles: true })))
  // Message with nickname + role color in a normal channel.
  await channels(page).getByRole('button', { name: /^geral/ }).click()
  await page.getByText('Eu topo testar também').waitFor()
  await sleep(400)
  await shot(page, 'chat-nicknames')
}

/** Upload progress and failure through a slow, then dead, link (proxy in front of the real API). */
async function uploadShots(saved, ids) {
  console.log('uploads…')
  const PORT = 4112
  let proxy = startProxy(PORT)
  const { app, page } = await launch({ apiUrl: `http://localhost:${PORT}` })
  await login(page, saved.users.ana)
  await rail(page, /^Estúdio Alga/).click()
  await channels(page).getByRole('button', { name: /^fotos/ }).click()
  await page.getByText('Nota de voz e o roteiro').waitFor()
  proxy.state.rateBps = 160 * 1024
  await composerFile(page).setInputFiles([testMedia()('ensaio-longo.mp4'), testMedia()('orla.jpg')])
  await page.getByRole('textbox', { name: /Mensagem para/ }).fill('Versão longa do ensaio')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => Number(document.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow') ?? 0) >= 15, null, { timeout: 60_000 })
  await shot(page, 'chat-upload-progress')
  // The link dies mid-upload: the message stays in place with the reason and a way out.
  await proxy.stop()
  await page.getByText('Não enviada.').waitFor({ timeout: 30_000 })
  await sleep(400)
  await shot(page, 'chat-upload-failed')
  proxy = startProxy(PORT)
  await page.getByRole('button', { name: 'Tentar agora' }).click().catch(() => undefined)
  await page.getByText(/Sem conexão\. Tentando/).waitFor({ state: 'detached', timeout: 20_000 })
  await page.getByRole('button', { name: 'Tentar de novo' }).click()
  await page.getByText('Não enviada.').waitFor({ state: 'detached', timeout: 60_000 })
  await page.waitForFunction(() => !document.querySelector('[role=progressbar]'), null, { timeout: 60_000 })
  await sleep(1000)
  await shot(page, 'chat-upload-retried')
  await close(app)
  await proxy.stop()
}

const spaceSettings = (page) => page.getByRole('dialog', { name: /^Configurações de / })
async function openSpaceSettings(page) {
  await rail(page, /^Estúdio Alga/).click()
  await channels(page).getByRole('button', { name: 'Estúdio Alga' }).click()
  await page.getByRole('menuitem', { name: 'Configurações do espaço' }).click()
  await spaceSettings(page).waitFor()
  await sleep(500)
}
const navTo = (page, name) => spaceSettings(page).getByRole('navigation').getByRole('button', { name, exact: true }).click()

async function spaceSettingsShots(page, saved) {
  console.log('space settings…')
  await rail(page, /^Estúdio Alga/).click()
  await channels(page).getByRole('button', { name: 'Estúdio Alga' }).click()
  await page.getByRole('menu').waitFor()
  await shot(page, 'space-menu')
  await page.keyboard.press('Escape')
  await openSpaceSettings(page)
  const dlg = spaceSettings(page)
  // Icon: real file → crop (rounded mask) → upload; the rail tile updates live.
  await dlg.locator('input[type=file]').setInputFiles(testMedia()('icone.png'))
  const crop = page.getByRole('dialog', { name: 'Enquadrar imagem' })
  await crop.waitFor()
  await sleep(300)
  await shot(page, 'space-settings-icon-crop')
  await crop.getByRole('button', { name: 'Aplicar' }).click()
  await crop.waitFor({ state: 'detached' })
  await sleep(600)
  await shot(page, 'space-settings-overview')

  await navTo(page, 'Cargos')
  await sleep(300)
  await shot(page, 'space-settings-roles')
  await dlg.getByRole('button', { name: 'Editar Moderação' }).click()
  await dlg.getByLabel('Nome do cargo').waitFor()
  await sleep(300)
  await shot(page, 'space-settings-role-editor')
  await dlg.getByRole('button', { name: 'Voltar para cargos' }).click()
  await dlg.getByRole('button', { name: 'Subir Convidados' }).click()
  await sleep(600)
  await shot(page, 'space-settings-roles-reordered')
  await dlg.getByRole('button', { name: 'Descer Convidados' }).click()

  await navTo(page, 'Membros')
  await sleep(300)
  await shot(page, 'space-settings-members')
  const elisa = dlg.getByRole('listitem').filter({ hasText: 'Elisa Nogueira' })
  await elisa.getByRole('button', { name: /^Ações para/ }).click()
  await page.getByRole('menu').waitFor()
  await shot(page, 'space-settings-member-menu')
  await page.getByRole('menuitem', { name: 'Banir' }).click()
  const ban = page.getByRole('dialog', { name: /^Banir/ })
  await ban.waitFor()
  await ban.getByLabel(/Motivo/).fill('Spam de convites em #geral')
  await sleep(300)
  await shot(page, 'space-settings-ban')
  await ban.getByRole('button', { name: 'Banir' }).click()
  await ban.waitFor({ state: 'detached' })
  // Role chips: give Fábio "Convidados" from the + menu.
  const fabio = dlg.getByRole('listitem').filter({ hasText: 'Fábio Lima' })
  await fabio.getByRole('button', { name: 'Adicionar cargo' }).click()
  await page.getByRole('menuitemcheckbox', { name: 'Convidados' }).click()
  await sleep(500)
  await navTo(page, 'Banimentos')
  await dlg.getByText('Elisa Nogueira').waitFor()
  await sleep(300)
  await shot(page, 'space-settings-bans')
  await navTo(page, 'Convites')
  await dlg.getByRole('radio', { name: '1 dia' }).click()
  await dlg.getByRole('radio', { name: '25' }).click()
  await dlg.getByRole('button', { name: 'Gerar convite' }).click()
  await dlg.getByRole('button', { name: 'Copiar' }).first().waitFor()
  await dlg.getByRole('button', { name: 'Copiar' }).first().click()
  await sleep(300)
  await shot(page, 'space-settings-invites')
  await page.keyboard.press('Escape')
  await dlg.waitFor({ state: 'detached' })
  await shot(page, 'space-icon-rail')
}

/** Carla (Moderação, below Coordenação): what she cannot touch is disabled and says why. */
async function limitedSpaceSettingsShots(saved) {
  console.log('space settings (moderator)…')
  const { app, page } = await launch()
  await login(page, saved.users.carla)
  await openSpaceSettings(page)
  const dlg = spaceSettings(page)
  await sleep(300)
  await shot(page, 'space-settings-roles-limited')
  await dlg.getByRole('button', { name: 'Editar Coordenação' }).click()
  await dlg.getByRole('note').waitFor()
  await sleep(300)
  await shot(page, 'space-settings-role-locked')
  await navTo(page, 'Membros')
  await sleep(300)
  const diego = dlg.getByRole('listitem').filter({ hasText: 'Diego Alves' })
  await diego.getByRole('button', { name: /^Ações para/ }).click()
  await page.getByRole('menu').waitFor()
  await shot(page, 'space-settings-members-limited')
  await page.keyboard.press('Escape')
  await close(app)
}

// ── voice: two real instances through LiveKit ─────────────────
const work = join(tmpdir(), 'alga-shots')
function ffmpeg(args) {
  const r = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr}`)
}
/** B's fake microphone: real pt-BR speech (Windows SAPI) so the glow follows a real voice envelope; tone bursts as fallback. */
function speechWav() {
  mkdirSync(work, { recursive: true })
  const out = join(work, 'speech.wav')
  const silence = join(work, 'silence.wav')
  if (!existsSync(silence)) ffmpeg(['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono', '-t', '10', '-c:a', 'pcm_s16le', silence])
  if (existsSync(out)) return { speech: out, silence }
  const raw = join(work, 'speech-raw.wav')
  const ps = `Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$v = $s.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -eq 'pt-BR' } | Select-Object -First 1
if ($v) { $s.SelectVoice($v.VoiceInfo.Name) }
$s.SetOutputToWaveFile('${raw.replace(/'/g, "''")}')
$p = New-Object System.Speech.Synthesis.PromptBuilder
foreach ($t in @('Fala, pessoal, tudo certo?', 'Subi a build nova agora.', 'Consegue compartilhar a tela?', 'O brilho segue a voz.', 'Ficou muito bom.')) { $p.AppendText($t); $p.AppendBreak([TimeSpan]::FromMilliseconds(500)) }
$s.Speak($p)
$s.Dispose()`
  const r = spawnSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' })
  if (r.status === 0 && existsSync(raw)) ffmpeg(['-i', raw, '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', out])
  else ffmpeg(['-f', 'lavfi', '-i', "aevalsrc='0.35*sin(2*PI*190*t)*(0.55+0.45*sin(2*PI*4*t))*gt(sin(2*PI*0.4*t),-0.3)':s=48000:d=20", '-ac', '1', '-c:a', 'pcm_s16le', out])
  return { speech: out, silence }
}

const MEDIA_FLAGS = (wav) => [
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
  `--use-file-for-fake-audio-capture=${wav}`,
  // Two windows on one desktop: keep the covered one rendering (harness only).
  '--disable-features=CalculateNativeWinOcclusion',
  '--disable-renderer-backgrounding',
  '--disable-background-timer-throttling',
]

const dock = (page) => page.getByRole('toolbar', { name: 'Controles da chamada' })
const channels = (page) => page.getByRole('complementary', { name: 'Canais' })

async function waitConnected(page) {
  await page.getByText('Voz conectada').first().waitFor({ timeout: 30_000 })
}
/** Wait until someone's tile glows at least `min` (the envelope is written to --speak on the tile). */
async function waitSpeaking(page, userId, min = 0.4, timeout = 20_000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    const v = await page.evaluate((id) => Number(document.querySelector(`[data-user-id="${id}"]`)?.style.getPropertyValue('--speak') || 0), userId)
    if (v >= min) return v
    await sleep(40)
  }
  return 0
}

let pattern = null
function startPattern() {
  // Full-screen moving test pattern on top: screen thumbnails show this, never the real desktop.
  pattern = spawn('ffplay', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30', '-fs', '-alwaysontop', '-an', '-window_title', 'AlgaPattern'], { stdio: 'ignore' })
}
function stopPattern() {
  if (pattern?.pid) spawnSync('taskkill', ['/PID', String(pattern.pid), '/T', '/F'], { stdio: 'ignore' })
  pattern = null
}

async function voiceShots(saved, ids) {
  console.log('voice (two instances)…')
  const lk = await fetch(`${LK_HTTP}/`).then((r) => r.ok, () => false)
  if (!lk) return console.warn(`LiveKit is not reachable at ${LK_HTTP}: voice screens skipped.`)
  const U = saved.users
  const { speech, silence } = speechWav()
  const A = await launch({ extra: MEDIA_FLAGS(silence) })
  const B = await launch({ profile: 'shots-b', extra: MEDIA_FLAGS(speech) })
  for (const [n, x] of [['A', A], ['B', B]]) {
    x.page.on('console', (m) => m.type() === 'error' && console.log(`  ${n} console.error:`, m.text().slice(0, 240)))
    x.page.on('pageerror', (e) => console.log(`  ${n} pageerror:`, e.message))
  }
  try {
    await login(A.page, U.ana)
    await login(B.page, U.bruno)

    // B joins Sala de foco with one click (the Discord habit we keep).
    await rail(B.page, /^Estúdio Alga/).click()
    await channels(B.page).getByRole('button', { name: /Sala de foco/ }).click()
    await waitConnected(B.page)

    // A at home: "Agora" shows where Bruno is, the rail tile breathes.
    await A.page.getByRole('button', { name: 'Conversas', exact: true }).click()
    await A.page.getByRole('region', { name: 'Agora' }).getByText('Sala de foco').waitFor({ timeout: 15_000 })
    await sleep(500)
    await shot(A.page, 'home-agora')

    // A opens the room without joining (Ctrl+K): the pre-join preview.
    await A.page.keyboard.press('Control+K')
    await A.page.keyboard.type('Sala de foco')
    await sleep(200)
    await A.page.keyboard.press('Enter')
    await A.page.getByRole('button', { name: 'Entrar em Sala de foco', exact: true }).waitFor()
    // Ctrl+K hands focus back to what opened it; park focus and pointer so no ring/tooltip sits in the shot.
    await A.page.mouse.move(820, 300)
    await A.page.evaluate(() => (document.activeElement)?.blur?.())
    await sleep(500)
    await shot(A.page, 'voice-preview')

    // Join: tiles, live glow on Bruno (real envelope), voice panel, occupants in the sidebar.
    await A.page.getByRole('button', { name: 'Entrar em Sala de foco', exact: true }).click()
    await waitConnected(A.page)
    await sleep(1500)
    const v = await waitSpeaking(A.page, U.bruno.me.id, 0.45)
    console.log(`  bruno --speak at capture: ${v.toFixed(2)}`)
    await shot(A.page, 'voice-stage')
    await waitSpeaking(B.page, U.bruno.me.id, 0.3)
    await shot(B.page, 'voice-stage-self-speaking')

    // Self muted + deafened: state by icon + color + tint, and the tile label follows.
    await dock(A.page).getByRole('button', { name: 'Desativar microfone' }).click()
    await dock(A.page).getByRole('button', { name: 'Desativar áudio' }).click()
    await sleep(1200)
    await shot(A.page, 'voice-self-muted-deafened')
    await dock(A.page).getByRole('button', { name: 'Ativar áudio' }).click()
    await sleep(300)
    if (await dock(A.page).getByRole('button', { name: 'Ativar microfone' }).isVisible()) await dock(A.page).getByRole('button', { name: 'Ativar microfone' }).click()

    // Moderation (Ana owns the space): context menu on Bruno's tile, then a real server mute seen by Bruno.
    await A.page.locator(`[data-user-id="${U.bruno.me.id}"]`).click({ button: 'right' })
    await A.page.getByRole('menu').waitFor()
    await shot(A.page, 'voice-tile-moderation-menu')
    await A.page.getByRole('menuitem', { name: 'Silenciar para todos' }).click()
    await B.page.getByRole('button', { name: 'A moderação silenciou você neste canal' }).waitFor({ timeout: 10_000 })
    await sleep(500)
    await shot(B.page, 'voice-server-muted')
    await api(U.ana.token, 'PATCH', `/spaces/${ids.s1.id}/members/${U.bruno.me.id}/voice`, { serverMute: false })
    await sleep(800)

    // Screen share: the picker (thumbnails show the test pattern, not the desktop), then live.
    startPattern()
    await sleep(1500)
    await dock(A.page).getByRole('button', { name: 'Compartilhar tela' }).click()
    const picker = A.page.getByRole('dialog', { name: 'Compartilhar tela' })
    await picker.waitFor()
    await picker.getByRole('radiogroup', { name: 'Telas' }).getByRole('radio').first().waitFor({ timeout: 20_000 })
    await sleep(1800)
    await shot(A.page, 'screen-picker')
    await picker.getByRole('button', { name: 'Transmitir' }).click()
    await picker.waitFor({ state: 'detached', timeout: 15_000 })
    stopPattern()
    await A.page.getByText('Você está transmitindo').first().waitFor()
    await sleep(2500)
    await shot(A.page, 'screen-sharing-self')

    // Bruno: nothing downloads until he clicks Assistir.
    await B.page.getByRole('button', { name: 'Assistir' }).first().waitFor({ timeout: 15_000 })
    await sleep(400)
    await shot(B.page, 'stream-tile-unwatched')
    await B.page.getByRole('button', { name: 'Assistir' }).first().click()
    await B.page.waitForFunction(() => [...document.querySelectorAll('video')].some((v) => v.readyState >= 2 && v.videoWidth > 0), null, { timeout: 20_000 })
    await sleep(2500)
    await shot(B.page, 'stream-watching')
    await B.page.keyboard.press('Control+Shift+E')
    await sleep(1500)
    await B.page.locator('video').first().hover()
    await sleep(300)
    await shot(B.page, 'stream-stats')
    await B.page.getByRole('button', { name: 'Ampliar' }).click()
    await sleep(1500)
    await shot(B.page, 'stream-focus')
    await B.page.keyboard.press('Control+Shift+E')
    await dock(A.page).getByRole('button', { name: 'Parar transmissão' }).click()
    await A.page.getByRole('menuitem', { name: 'Parar transmissão' }).click()
    await sleep(800)

    // Moderator moves Bruno to another room (VOICE_MOVE), then disconnects him (VOICE_DISCONNECT).
    await api(U.ana.token, 'PATCH', `/spaces/${ids.s1.id}/members/${U.bruno.me.id}/voice`, { channelId: ids.jogo.id })
    await B.page.getByText('Você foi movido para Sala de jogo.').waitFor({ timeout: 15_000 })
    await waitConnected(B.page)
    await sleep(600)
    await shot(B.page, 'voice-moved')
    await api(U.ana.token, 'PATCH', `/spaces/${ids.s1.id}/members/${U.bruno.me.id}/voice`, { channelId: null })
    await B.page.getByText('Um moderador desconectou você do canal de voz.').waitFor({ timeout: 15_000 })
    await sleep(400)
    await shot(B.page, 'voice-disconnected-moderator')

    // Reconnecting never lies: with the SFU gone, tiles go grey and the stage says so.
    const lkPid = Number(process.env.LIVEKIT_PID || 0)
    if (lkPid) {
      spawnSync('taskkill', ['/PID', String(lkPid), '/T', '/F'], { stdio: 'ignore' })
      await A.page.getByText('Reconectando à voz…').first().waitFor({ timeout: 30_000 })
      await sleep(800)
      await shot(A.page, 'voice-reconnecting')
      const lkProc = spawn('node', [join(repo, 'scripts', 'livekit.mjs')], { cwd: repo, detached: true, stdio: 'ignore' })
      lkProc.unref()
      console.log(`  LiveKit restarted (pid ${lkProc.pid}); stop it when done.`)
      await A.page.getByText('Voz conectada').first().waitFor({ timeout: 60_000 }).catch(() => undefined)
    }
    await A.page.getByRole('button', { name: 'Desconectar' }).first().click().catch(() => undefined)
    await sleep(600)

    // DM call: Ana calls Bruno from the DM header; Bruno gets the ring card, answers, both on the DM stage.
    await A.page.getByRole('button', { name: 'Conversas', exact: true }).click()
    await A.page.getByRole('button', { name: /Bruno Costa/ }).first().click()
    await A.page.getByRole('button', { name: 'Iniciar chamada de voz' }).click()
    await B.page.getByRole('alertdialog').waitFor({ timeout: 20_000 })
    await sleep(500)
    await shot(B.page, 'call-incoming')
    await B.page.getByRole('button', { name: 'Atender' }).click()
    await waitConnected(B.page)
    await sleep(1500)
    await waitSpeaking(A.page, U.bruno.me.id, 0.4)
    await shot(A.page, 'dm-call')
    await A.page.getByRole('button', { name: 'Desconectar' }).first().click()
    await B.page.getByRole('button', { name: 'Desconectar' }).first().click()

    // Voice settings on Bruno (speech mic): live meter against the gate threshold.
    await B.page.keyboard.press('Control+,')
    const dlg = B.page.getByRole('dialog', { name: 'Configurações' })
    await dlg.getByRole('navigation').getByRole('button', { name: 'Voz e vídeo' }).click()
    await dlg.getByRole('button', { name: 'Testar' }).click()
    await sleep(2500)
    await shot(B.page, 'settings-voice')
    await dlg.getByRole('button', { name: 'Parar o teste' }).click()
  } catch (e) {
    // Leave evidence for debugging the harness (not versioned).
    await A.page.screenshot({ path: join(work, 'fail-a.png') }).catch(() => undefined)
    await B.page.screenshot({ path: join(work, 'fail-b.png') }).catch(() => undefined)
    for (const [n, x] of [['A', A], ['B', B]]) console.log(`  ${n} media:`, await x.page.evaluate(() => JSON.stringify(window.__algaMediaState?.() ?? null)).catch(() => '?'))
    throw e
  } finally {
    stopPattern()
    await close(A.app)
    await close(B.app)
  }
}

/** TCP proxy in front of the API so the script can cut or slow the "network" for real. */
function startProxy(port, target = new URL(API)) {
  const sockets = new Set()
  const state = { delayMs: 0, rateBps: 0 }
  const server = createServer((client) => {
    const upstream = connect(Number(target.port || 80), target.hostname)
    sockets.add(client).add(upstream)
    client.on('data', (b) => {
      setTimeout(() => upstream.write(b), state.delayMs)
      // Upload pacing: stop reading for as long as these bytes take at rateBps (TCP backpressure does the rest).
      if (state.rateBps) {
        client.pause()
        setTimeout(() => client.resume(), (b.length / state.rateBps) * 1000)
      }
    })
    upstream.pipe(client)
    const end = () => {
      client.destroy()
      upstream.destroy()
    }
    client.on('error', end).on('close', end)
    upstream.on('error', end).on('close', end)
  })
  server.listen(port)
  return {
    state,
    stop: () => new Promise((r) => {
      for (const s of sockets) s.destroy()
      sockets.clear()
      server.close(() => r())
    }),
  }
}

async function connectionShots(saved, ids) {
  console.log('connection states…')
  const PORT = 4111
  const via = `http://localhost:${PORT}`
  let proxy = startProxy(PORT)
  let { app, page } = await launch({ apiUrl: via })
  await login(page, saved.users.ana)
  await rail(page, /^Estúdio Alga/).click()
  // Slow network: first open of a channel shows the skeleton, not a spinner.
  proxy.state.delayMs = 2500
  await page.getByRole('button', { name: /^off-topic/ }).click()
  await sleep(700)
  await shot(page, 'chat-loading-skeleton')
  proxy.state.delayMs = 0
  await page.getByRole('button', { name: /^geral/ }).click()
  await page.getByText('Eu topo testar também').waitFor()
  // Server unreachable: banner with countdown + a send that fails in place.
  await proxy.stop()
  await page.getByText(/Sem conexão/).first().waitFor({ timeout: 15_000 })
  await page.getByRole('textbox', { name: /Mensagem para/ }).fill('Alguém mais caiu agora?')
  await page.keyboard.press('Enter')
  await page.getByText('Não enviada.').waitFor({ timeout: 15_000 })
  await shot(page, 'banner-reconnecting-send-failed')
  proxy = startProxy(PORT)
  await page.getByRole('button', { name: 'Tentar agora' }).click()
  await page.getByText(/Sem conexão\. Tentando/).waitFor({ state: 'detached', timeout: 20_000 })
  await page.getByRole('button', { name: 'Tentar de novo' }).click()
  await page.getByText('Não enviada.').waitFor({ state: 'detached', timeout: 10_000 })
  await shot(page, 'chat-send-retried')
  await close(app)
  // Boot with a stored session while the server is down: the splash explains and offers a way out.
  await proxy.stop()
  ;({ app, page } = await launch({ apiUrl: via, keepProfile: true }))
  await page.getByText(/Sem conexão\. Tentando/).waitFor({ timeout: 20_000 })
  await shot(page, 'splash-offline')
  proxy = startProxy(PORT)
  await page.getByRole('button', { name: 'Tentar agora' }).click()
  await page.getByRole('navigation', { name: 'Espaços' }).waitFor({ timeout: 20_000 })
  await close(app)
  await proxy.stop()
}

async function sizeShots(saved) {
  console.log('sizes…')
  for (const [name, opts] of [
    ['shell-960x600', { width: 960, height: 600 }],
    ['shell-1920x1080@125', { width: 1536, height: 864, scale: 1.25 }],
  ]) {
    const { app, page } = await launch(opts)
    await login(page, saved.users.ana)
    await rail(page, /^Estúdio Alga/).click()
    await page.getByRole('button', { name: /^geral/ }).click()
    await page.getByText('Eu topo testar também').waitFor()
    await shot(page, name)
    await close(app)
  }
}

// ── wave 4: deep links, invites list, Assinatura, Personalização ──
// Checkout runs the real sandbox flow: POST /billing/checkout → the app opens the returned URL (captured in main,
// so no real browser opens) → the script loads that URL like the browser would → the sandbox provider confirms
// through the same path a verified webhook takes → ENTITLEMENTS_UPDATE reaches the app.

/** Swap shell.openExternal in main for a recorder: the app's own IPC handler still validates and calls it. */
async function captureExternal(app) {
  await app.evaluate(({ shell }) => {
    globalThis.__algaExternal = []
    shell.openExternal = async (url) => void globalThis.__algaExternal.push(url)
  })
}
async function nextExternal(app, n) {
  for (let i = 0; i < 80; i++) {
    const urls = await app.evaluate(() => globalThis.__algaExternal)
    if (urls.length >= n) return urls[n - 1]
    await sleep(250)
  }
  throw new Error(`openExternal #${n} never happened`)
}
/** What the user's browser does on the sandbox page. */
async function payInBrowser(url, outcome = 'approve') {
  const res = await fetch(outcome === 'approve' ? url : `${url}&outcome=decline`)
  if (!res.ok) throw new Error(`sandbox page → ${res.status}`)
}

/** A second app process with a deep link on the same profile: main forwards it to the running instance and quits. */
function secondInstance(profile, link) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RENDERER_URL'))
  const r = spawnSync(electronPath, [appDir, `--profile=${profile}`, link], { cwd: appDir, env, timeout: 30_000 })
  if (r.status !== 0) console.warn('  second instance exited with', r.status)
}

/** `birthDate: null` / `terms: false` = an account from before the age gate / the current Termos (dev servers allow it). */
async function freshUser(key, displayName, { birthDate = ADULT_BIRTH, terms = true } = {}) {
  const username = `${key}.${randomBytes(2).toString('hex')}`
  const password = randomBytes(12).toString('base64url')
  const r = await api(null, 'POST', '/auth/register', {
    email: `${username}@shots.alga.test`, username, displayName, password,
    ...(birthDate && { birthDate }), ...(terms && { termsVersion: await termsVersion() }),
  })
  return { username, password, token: r.token, me: r.user }
}

const userSettings = (page) => page.getByRole('dialog', { name: 'Configurações' })
async function userSection(page, name) {
  const dlg = userSettings(page)
  if (!(await dlg.isVisible())) {
    await page.getByRole('button', { name: 'Configurações', exact: true }).click()
    await dlg.waitFor()
  }
  await dlg.getByRole('navigation').getByRole('button', { name, exact: true }).click()
  await sleep(400)
  return dlg
}

async function billingShots(saved, ids) {
  console.log('plan, shop, deep links…')
  // A new person every run: billing history is permanent, so the story always starts on the free plan.
  const iris = await freshUser('iris', 'Íris Prado')
  await api(iris.token, 'POST', `/invites/${saved.inviteCode}`)
  // Initials on a calm accent: decorations are judged against a plain disc, not a loud test picture.
  await api(iris.token, 'PATCH', '/users/@me', { bio: 'Som, luz e protótipos. Testo tudo com fone e café.', accentColor: '#3f7fbf' })

  const { app, page } = await launch()
  await captureExternal(app)
  await login(page, iris)

  // Deep link while running: verify-email → confirmed in place, the calm strip goes away (ME_UPDATE).
  const verifyToken = await mailedToken(iris.me.email, 'verify_email')
  secondInstance(PROFILE, `algameet://auth/verify-email?token=${verifyToken}`)
  await page.getByText('E-mail confirmado. Tudo liberado.').waitFor({ timeout: 20_000 })
  await shot(page, 'deeplink-verify-email')

  // Free plan: what you have, what Plus adds, nothing pushy.
  let dlg = await userSection(page, 'Assinatura')
  await dlg.getByText('Grátis e Alga Plus').waitFor()
  await shot(page, 'billing-plan-free')
  await dlg.getByRole('radio', { name: 'Anual' }).click()
  await dlg.getByRole('radio', { name: 'Anual' }).evaluate((el) => el.closest('section').scrollIntoView({ block: 'end' }))
  await sleep(200)
  await shot(page, 'billing-subscribe-yearly')
  await dlg.getByRole('radio', { name: 'Mensal' }).click()
  dlg = await userSection(page, 'Voz e vídeo')
  await dlg.getByText('Qualidade da transmissão').scrollIntoViewIfNeeded()
  await sleep(200)
  await shot(page, 'settings-voice-plan-free')

  // Shop: preview on your own card before buying.
  dlg = await userSection(page, 'Personalização')
  await dlg.getByText('Prévia no seu perfil').waitFor()
  await sleep(300)
  await shot(page, 'shop-preview-decoration')
  for (const [name, screen] of [
    [/Noite paulistana/, 'shop-preview-theme'],
    [/Bioluminescência/, 'shop-preview-effect'],
    [/Cardume/, 'shop-preview-nameplate'],
    [/Tema Maré/, 'shop-plus-only'],
  ]) {
    await dlg.getByRole('button', { name }).click()
    await sleep(300)
    await shot(page, screen)
  }

  // Buy Coral: waiting (never assumed paid) → the provider confirms → the moment, in place.
  await dlg.getByRole('button', { name: /Coral/ }).click()
  await dlg.getByRole('button', { name: /^Comprar por/ }).click()
  await dlg.getByText('Aguardando a confirmação do pagamento…').waitFor()
  await shot(page, 'shop-checkout-waiting')
  await payInBrowser(await nextExternal(app, 1))
  await dlg.getByText(/^Pronto: está na sua conta/).waitFor({ timeout: 20_000 })
  await shot(page, 'shop-purchased')

  // Declined: nothing is granted, the page says so when you come back to the app.
  await dlg.getByRole('button', { name: /Cardume/ }).click()
  await dlg.getByRole('button', { name: /^Comprar por/ }).click()
  await dlg.getByText('Aguardando a confirmação do pagamento…').waitFor()
  await payInBrowser(await nextExternal(app, 2), 'decline')
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await dlg.getByText('O pagamento não foi concluído. Nada foi cobrado.').waitFor({ timeout: 20_000 })
  await shot(page, 'shop-checkout-declined')

  // Subscribe monthly through the same flow.
  dlg = await userSection(page, 'Assinatura')
  await dlg.getByRole('button', { name: 'Assinar o Alga Plus' }).click()
  await dlg.getByText('Aguardando a confirmação do pagamento…').waitFor()
  await shot(page, 'billing-checkout-waiting')
  await payInBrowser(await nextExternal(app, 3))
  await dlg.getByText('Pagamento confirmado. Obrigado por apoiar o Alga Meet.').waitFor({ timeout: 20_000 })
  await shot(page, 'billing-plan-arrived')
  dlg = await userSection(page, 'Voz e vídeo')
  await dlg.getByText('Qualidade da transmissão').scrollIntoViewIfNeeded()
  await sleep(200)
  await shot(page, 'settings-voice-plan-plus')
  dlg = await userSection(page, 'Assinatura')
  await dlg.getByText(/renova em/).waitFor()
  await shot(page, 'billing-plan-plus')
  await dlg.getByText('Histórico de compras').evaluate((el) => el.closest('section').scrollIntoView({ block: 'end' }))
  await sleep(200)
  await shot(page, 'billing-history')

  // Cancel at period end: honest copy, nothing changes until the date.
  await dlg.getByRole('button', { name: 'Cancelar renovação' }).click()
  const modal = page.getByRole('dialog', { name: 'Cancelar a renovação do Plus?' })
  await modal.waitFor()
  await sleep(300)
  await shot(page, 'billing-cancel-confirm')
  await modal.getByRole('button', { name: 'Cancelar renovação' }).click()
  await dlg.getByText(/^Renovação cancelada\. O Plus vale até/).waitFor({ timeout: 15_000 })
  await sleep(300)
  await shot(page, 'billing-plan-canceled')

  dlg = await userSection(page, 'Personalização')
  await dlg.getByText('Prévia no seu perfil').waitFor()
  await sleep(300)
  await shot(page, 'shop-plus-collection')
  await page.keyboard.press('Escape')
  await dlg.waitFor({ state: 'detached' })

  // Where profiles show: the member list (subtle), the profile popover, your own panel.
  await rail(page, /^Estúdio Alga/).click()
  await channels(page).getByRole('button', { name: /^geral/ }).click()
  await page.getByText('Eu topo testar também').waitFor()
  const row = page.getByLabel('Membros').getByRole('button', { name: /Íris Prado/ })
  await row.hover()
  await sleep(300)
  await shot(page, 'members-cosmetics')
  await row.click()
  await page.getByRole('dialog', { name: 'Íris Prado' }).waitFor()
  await sleep(400)
  await shot(page, 'profile-popover-cosmetics')
  await page.keyboard.press('Escape')
  await page.getByLabel('Membros').getByRole('button', { name: /Bruno Costa/ }).click()
  await page.getByRole('dialog', { name: 'Bruno Costa' }).waitFor()
  await sleep(300)
  await shot(page, 'profile-popover-plain')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: /^Íris Prado\s*Online$/ }).click()
  await page.getByRole('dialog', { name: 'Definir status' }).waitFor()
  await sleep(400)
  await shot(page, 'user-panel-profile')
  await page.keyboard.press('Escape')
  await close(app)
  return iris
}

async function inviteShots(saved, ids) {
  console.log('invites list, deep link invites…')
  const U = saved.users
  const T = (k) => U[k].token
  // More invites with different makers, limits and expiries (Carla is Moderação: she may create invites).
  await api(T('carla'), 'POST', `/spaces/${ids.s1.id}/invites`, { maxAgeSeconds: 86400, maxUses: 10 })
  await api(T('ana'), 'POST', `/spaces/${ids.s1.id}/invites`, { maxAgeSeconds: 3600, maxUses: 1 })
  // A space Ana is not in yet, for the deep link.
  const atelie = await api(T('diego'), 'POST', '/spaces', { name: 'Ateliê de Som' })
  saved.spaces.push({ id: atelie.id, owner: 'diego' })
  writeFileSync(usersFile, JSON.stringify(saved, null, 2))
  const code = (await api(T('diego'), 'POST', `/spaces/${atelie.id}/invites`, { maxAgeSeconds: 604800, maxUses: 0 })).code

  const { app, page } = await launch()
  await login(page, U.ana)
  await openSpaceSettings(page)
  const dlg = spaceSettings(page)
  await navTo(page, 'Convites')
  await dlg.getByText('Convites ativos').waitFor()
  await dlg.getByText(/Criado por Carlinha|Criado por Carla Mendes/).waitFor()
  await sleep(300)
  await shot(page, 'space-settings-invites-list')
  await dlg.getByRole('button', { name: 'Gerar convite' }).click()
  await dlg.getByRole('button', { name: 'Copiar' }).first().click()
  await sleep(300)
  await shot(page, 'space-settings-invites-created')
  await dlg.getByRole('button', { name: 'Revogar convite' }).nth(1).click()
  const modal = page.getByRole('dialog', { name: 'Revogar este convite?' })
  await modal.waitFor()
  await sleep(300)
  await shot(page, 'space-settings-invite-revoke')
  await modal.getByRole('button', { name: 'Revogar convite' }).click()
  await page.getByText('Convite revogado.').waitFor()
  await shot(page, 'space-settings-invite-revoked')
  await page.keyboard.press('Escape')
  await dlg.waitFor({ state: 'detached' })

  // Signed in: a second-instance launch with algameet://invite/<code> opens the join preview.
  secondInstance(PROFILE, `algameet://invite/${code}`)
  await page.getByRole('dialog', { name: 'Entrar em um espaço' }).getByText('Ateliê de Som').waitFor({ timeout: 20_000 })
  await sleep(300)
  await shot(page, 'deeplink-invite-signed-in')
  await close(app)

  // Signed out (cold start with the link): the login says what will happen, the preview opens after sign-in.
  const b = await launch({ profile: 'shots-b', extra: [`algameet://invite/${code}`] })
  await b.page.getByText('Você abriu um convite.', { exact: false }).waitFor({ timeout: 20_000 })
  await shot(b.page, 'deeplink-invite-signed-out')
  await login(b.page, U.fabio)
  await b.page.getByRole('dialog', { name: 'Entrar em um espaço' }).getByText('Ateliê de Som').waitFor({ timeout: 20_000 })
  await sleep(300)
  await shot(b.page, 'deeplink-invite-after-login')
  await close(b.app)

  // Password reset link, signed out: the form opens with the token in use but never shown.
  const t0 = Date.now()
  await api(null, 'POST', '/auth/password-reset/request', { email: U.gui.me.email })
  const resetToken = await mailedToken(U.gui.me.email, 'password_reset', t0 - 1000)
  const c = await launch({ profile: 'shots-b', extra: [`algameet://auth/reset-password?token=${resetToken}`] })
  await c.page.getByText('Link do e-mail aberto.', { exact: false }).waitFor({ timeout: 20_000 })
  await c.page.getByLabel('Nova senha').fill('Mar-Calmo-Ao-Fim-Da-Tarde')
  await sleep(200)
  await shot(c.page, 'deeplink-reset-password')
  await close(c.app)
}

// ── Trust & Safety (--only=trust): age gate, one-time prompts, reports, restricted account, privacy ──
// Everything runs against the real API: staff actions go through /admin with a moderator that only
// apps/server/scripts/grant-staff.ts can create. It is created once (saved in the users file); grant it with the
// API stopped (PGlite allows one process), start the API again and re-run. Without the grant those shots are skipped.
// Profile shots-t, so a parallel run on shots/shots-b is never disturbed.
const TRUST_PROFILE = 'shots-t'
const yearsAgo = (n) => {
  const d = new Date()
  d.setUTCFullYear(d.getUTCFullYear() - n)
  d.setUTCDate(d.getUTCDate() - 3)
  return d.toISOString().slice(0, 10)
}
const typedDate = (iso) => iso.split('-').reverse().join('')
const inDays = (n) => new Date(Date.now() + n * 86_400_000).toISOString()

/** Login form only: the screen after it (gate, restricted screen, shell) is the caller's to wait for. */
async function signIn(page, u) {
  await page.getByLabel('E-mail ou nome de usuário').fill(u.username)
  await page.getByLabel('Senha', { exact: true }).fill(u.password)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
}
/** signIn until `target` shows, waiting out the auth rate limit (10/min) like login() does. */
async function signInTo(page, u, target) {
  for (let i = 0; i < 8; i++) {
    await signIn(page, u)
    const limited = page.getByText('Muitas tentativas')
    await target.or(limited).first().waitFor({ timeout: 20_000 })
    if (await target.isVisible()) return
    await sleep(10_000)
  }
  await target.waitFor({ timeout: 20_000 })
}
/** POST /auth/login without throwing on 403 (a restricted account answers with the restriction). */
async function rawLogin(u) {
  const res = await fetch(`${API}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: u.username, password: u.password }) })
  return res.json()
}

async function trustShots() {
  console.log('trust & safety…')
  const saved = existsSync(usersFile) ? JSON.parse(readFileSync(usersFile, 'utf8')) : { users: {} }
  if (!saved.trustStaff) {
    saved.trustStaff = await freshUser('moderacao', 'Equipe Alga')
    writeFileSync(usersFile, JSON.stringify(saved, null, 2))
  }
  const staff = saved.trustStaff
  staff.token = (await api(null, 'POST', '/auth/login', { login: staff.username, password: staff.password })).token
  writeFileSync(usersFile, JSON.stringify(saved, null, 2))
  const isStaff = await api(staff.token, 'GET', '/admin/reports?limit=1').then(() => true, () => false)
  if (!isStaff) console.warn(`  staff shots skipped: stop the API, run \`npx tsx scripts/grant-staff.ts ${staff.username} moderator\` against its PGLITE_DIR, start it and re-run`)
  const act = (u, body) => api(staff.token, 'POST', `/admin/users/${u.me.id}/actions`, body)

  // 1. Signup: birth date (typed, read back in words), the unticked terms box, the kind under-16 answer.
  {
    const { app, page } = await launch({ profile: TRUST_PROFILE })
    await page.getByRole('button', { name: 'Criar conta' }).click()
    await page.getByLabel('E-mail', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Criar conta' }).click()
    await sleep(200)
    await shot(page, 'auth-register-required')
    await page.getByLabel('E-mail', { exact: true }).fill('lia.prado@shots.alga.test')
    await page.getByLabel('Nome de exibição').fill('Lia Prado')
    await page.getByLabel('Nome de usuário').fill(`lia.${randomBytes(2).toString('hex')}`)
    await page.getByLabel('Data de nascimento').fill('23042005')
    await page.getByLabel('Senha', { exact: true }).fill('Mar-Calmo-Ao-Fim-Da-Tarde')
    await page.getByRole('checkbox').check()
    await sleep(200)
    await shot(page, 'auth-register-birth-terms')
    await page.getByLabel('Data de nascimento').fill(typedDate(yearsAgo(14)))
    await page.getByRole('button', { name: 'Criar conta' }).click()
    await page.getByText('Ainda não dá para criar sua conta').waitFor()
    await sleep(200)
    await shot(page, 'auth-register-too-young')
    await close(app)
  }

  // 2. One-time prompts for an account from before the gate: new Termos first, then the birth date. Declaring under
  // 16 suspends the account at once (server) and the appeal opens right there.
  {
    const old = await freshUser('rafa', 'Rafael Antunes', { birthDate: null, terms: false })
    const { app, page } = await launch({ profile: TRUST_PROFILE })
    await signInTo(page, old, page.getByRole('heading', { name: 'Os Termos mudaram' }))
    await sleep(300)
    await shot(page, 'gate-terms')
    await page.getByRole('button', { name: 'Aceitar e continuar' }).click()
    await page.getByText('Marque a caixa para continuar.').waitFor()
    await shot(page, 'gate-terms-unchecked')
    await page.getByRole('button', { name: 'excluir sua conta' }).click()
    await page.getByRole('dialog', { name: 'Excluir sua conta' }).waitFor()
    await sleep(300)
    await shot(page, 'gate-terms-delete')
    await page.keyboard.press('Escape')
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: 'Aceitar e continuar' }).click()
    await page.getByRole('heading', { name: 'Qual é a sua data de nascimento?' }).waitFor()
    await sleep(300)
    await shot(page, 'gate-birth-date')
    await page.getByLabel('Data de nascimento').fill(typedDate(yearsAgo(15)))
    await sleep(150)
    await shot(page, 'gate-birth-date-filled')
    await page.getByRole('button', { name: 'Continuar' }).click()
    await page.getByRole('heading', { name: 'Sua conta está suspensa' }).waitFor({ timeout: 20_000 })
    await sleep(300)
    await shot(page, 'restricted-underage')
    await close(app)
  }

  // 3. 16–17: protections said in Privacidade, no checkout (the explanation takes the button's place).
  {
    const teen = await freshUser('bia', 'Bia Torres', { birthDate: yearsAgo(17) })
    await verifyEmail(teen)
    const { app, page } = await launch({ profile: TRUST_PROFILE })
    await login(page, teen)
    await userSection(page, 'Privacidade')
    await page.getByText('Proteções da sua conta').waitFor()
    await shot(page, 'settings-privacy-teen')
    let dlg = await userSection(page, 'Assinatura')
    await dlg.getByText('Compras pedem 18 anos').waitFor()
    await dlg.getByText('Compras pedem 18 anos').evaluate((el) => el.scrollIntoView({ block: 'center' }))
    await sleep(200)
    await shot(page, 'billing-plan-teen')
    dlg = await userSection(page, 'Personalização')
    await dlg.getByText('Compras pedem 18 anos').waitFor()
    await sleep(300)
    await shot(page, 'shop-teen')
    await close(app)
  }

  // 4. Reports: a profile from the member list, the space from its menu, the high-priority reason, the safety line,
  // the receipt with "Bloquear", and the hourly limit.
  {
    const owner = await freshUser('caio', 'Caio Freitas')
    const reporter = await freshUser('duda', 'Duda Siqueira')
    await verifyEmail(owner)
    await verifyEmail(reporter)
    const sp = await api(owner.token, 'POST', '/spaces', { name: 'Clube do Livro' })
    const inv = await api(owner.token, 'POST', `/spaces/${sp.id}/invites`, { maxAgeSeconds: 0, maxUses: 0 })
    await api(reporter.token, 'POST', `/invites/${inv.code}`)
    const geral = sp.channels.find((c) => c.type === 'text')
    await api(owner.token, 'POST', `/channels/${geral.id}/messages`, { content: 'Bem-vindos ao clube! Este mês: "Torto Arado".' })
    await api(reporter.token, 'POST', `/channels/${geral.id}/messages`, { content: 'Oi! Acabei de entrar. Já comecei o livro.' })

    const { app, page } = await launch({ profile: TRUST_PROFILE })
    await login(page, reporter)
    await rail(page, /^Clube do Livro/).click()
    const member = page.locator('button[aria-haspopup="dialog"]').filter({ hasText: 'Caio Freitas' }).last()
    await member.waitFor({ timeout: 15_000 })
    await member.click()
    // Report lives in the card's ⋯ menu (last, in red), so the card never reads as hostile.
    await page.getByRole('dialog', { name: 'Caio Freitas' }).getByRole('button', { name: 'Mais opções' }).click()
    await page.getByRole('menuitem', { name: 'Denunciar perfil' }).waitFor()
    await sleep(400)
    await shot(page, 'profile-popover-report')
    await page.getByRole('menuitem', { name: 'Denunciar perfil' }).click()
    const report = page.getByRole('dialog', { name: 'Denunciar perfil' })
    await report.waitFor()
    await sleep(300)
    await shot(page, 'report-reason')
    await report.getByText('Assédio ou intimidação').click()
    await sleep(150)
    await shot(page, 'report-reason-picked')
    await report.getByRole('button', { name: 'Continuar' }).click()
    await report.getByLabel('Quer contar mais?').fill('Desde ontem ele manda mensagens me xingando depois que eu disse que não queria conversar.')
    await sleep(150)
    await shot(page, 'report-details')
    await report.getByRole('button', { name: 'Enviar denúncia' }).click()
    await report.getByText('Denúncia recebida').waitFor()
    await sleep(300)
    await shot(page, 'report-done')
    await report.locator('footer').getByRole('button', { name: 'Fechar' }).click()

    // Right click on the member: the same flow; "Autolesão" shows where to get help now.
    await member.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Denunciar perfil' }).waitFor()
    await sleep(200)
    await shot(page, 'member-menu-report')
    await page.getByRole('menuitem', { name: 'Denunciar perfil' }).click()
    await report.getByText('Autolesão ou suicídio').click()
    await report.getByRole('button', { name: 'Continuar' }).click()
    await report.getByText('Se alguém corre risco agora').waitFor()
    await sleep(200)
    await shot(page, 'report-details-life')
    await page.keyboard.press('Escape')

    // The space menu: report the space; the child-safety reason explains what happens before sending.
    await page.getByRole('complementary', { name: 'Canais' }).getByRole('button', { name: 'Clube do Livro' }).click()
    await page.getByRole('menuitem', { name: 'Denunciar espaço' }).waitFor()
    await sleep(200)
    await shot(page, 'space-menu-report')
    await page.getByRole('menuitem', { name: 'Denunciar espaço' }).click()
    const spaceReport = page.getByRole('dialog', { name: 'Denunciar espaço' })
    await spaceReport.getByText('Sexualização de menores').click()
    await sleep(150)
    await shot(page, 'report-reason-csam')
    await spaceReport.getByRole('button', { name: 'Continuar' }).click()
    await spaceReport.getByText('Prioridade máxima').waitFor()
    await sleep(200)
    await shot(page, 'report-details-csam')
    await page.keyboard.press('Escape')

    // 10 per hour: fill the hour through the API, then the app says it plainly.
    for (let i = 0; i < 12; i++) {
      const r = await fetch(`${API}/api/v1/reports`, { method: 'POST', headers: { authorization: `Bearer ${reporter.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ targetType: 'space', targetId: sp.id, reason: 'spam' }) })
      if (r.status === 429) break
    }
    await page.getByRole('complementary', { name: 'Canais' }).getByRole('button', { name: 'Clube do Livro' }).click()
    await page.getByRole('menuitem', { name: 'Denunciar espaço' }).click()
    await spaceReport.getByText('Spam', { exact: true }).click()
    await spaceReport.getByRole('button', { name: 'Continuar' }).click()
    await spaceReport.getByRole('button', { name: 'Enviar denúncia' }).click()
    await spaceReport.getByRole('alert').waitFor()
    await sleep(200)
    await shot(page, 'report-rate-limited')
    await page.keyboard.press('Escape')
    await close(app)
  }

  // 5. Privacidade: actions on the account (warn, a suspension already lifted), appeal from the session, a copy of
  // the data, deleting the account (7 days, messages choice, owned spaces), then logging in again cancels it.
  {
    const eva = await freshUser('eva', 'Eva Martins')
    const friend = await freshUser('flor', 'Flor Batista')
    await verifyEmail(eva)
    await verifyEmail(friend)
    const atelier = await api(eva.token, 'POST', '/spaces', { name: 'Ateliê da Eva' })
    const inv = await api(eva.token, 'POST', `/spaces/${atelier.id}/invites`, { maxAgeSeconds: 0, maxUses: 0 })
    await api(friend.token, 'POST', `/invites/${inv.code}`)
    await api(eva.token, 'POST', '/spaces', { name: 'Rascunhos' })
    if (isStaff) {
      await act(eva, { type: 'warn', reason: 'spam', note: 'convites repetidos' })
      await act(eva, { type: 'suspend', reason: 'harassment', until: inDays(3) })
      await act(eva, { type: 'lift', reason: 'harassment', note: 'engano' })
    }
    const { app, page } = await launch({ profile: TRUST_PROFILE })
    await login(page, eva)
    let dlg = await userSection(page, 'Privacidade')
    await dlg.getByText('Ações na minha conta').waitFor()
    await sleep(400)
    await shot(page, 'settings-privacy')
    if (isStaff) {
      await dlg.getByRole('button', { name: 'Contestar' }).last().click()
      const appeal = page.getByRole('dialog', { name: 'Contestar a decisão' })
      await appeal.getByLabel('O que aconteceu, do seu ponto de vista').fill('Eu mandei o mesmo convite para três amigos porque o primeiro link tinha expirado. Não era propaganda.')
      await sleep(200)
      await shot(page, 'settings-privacy-appeal')
      await appeal.getByRole('button', { name: 'Enviar recurso' }).click()
      await appeal.waitFor({ state: 'detached' })
      await dlg.getByText('Recurso em análise').waitFor()
      await sleep(300)
      await shot(page, 'settings-privacy-appealed')
    }
    await dlg.getByRole('button', { name: 'Pedir cópia' }).click()
    await dlg.getByText(/Pedido em/).waitFor()
    await dlg.getByText(/Pedido em/).scrollIntoViewIfNeeded()
    await sleep(200)
    await shot(page, 'settings-privacy-export')
    await dlg.getByRole('button', { name: 'Excluir conta…' }).click()
    const del = page.getByRole('dialog', { name: 'Excluir sua conta' })
    await del.waitFor()
    await sleep(400)
    await shot(page, 'settings-delete-account')
    await del.getByLabel('Sua senha').fill('nao-e-a-senha-dela')
    await del.getByRole('button', { name: 'Excluir minha conta' }).click()
    await del.getByText('Senha incorreta.').waitFor()
    await sleep(200)
    await shot(page, 'settings-delete-wrong-password')
    await del.getByLabel('Sua senha').fill(eva.password)
    await del.getByRole('button', { name: 'Excluir minha conta' }).click()
    await page.getByText(/Sua conta será excluída em/).waitFor({ timeout: 20_000 })
    await sleep(300)
    await shot(page, 'auth-login-deletion-scheduled')
    await login(page, eva)
    await page.getByText('Exclusão cancelada').waitFor()
    await sleep(500)
    await shot(page, 'deletion-canceled')
    await close(app)
  }

  if (!isStaff) return
  // 6. Restricted accounts: suspended while signed in (gateway 4010) → login explains → the screen with the appeal;
  // banned with an appeal in analysis; a CSAM decision shows only the generic rule.
  {
    const gil = await freshUser('gil', 'Gil Ramos')
    await verifyEmail(gil)
    const { app, page } = await launch({ profile: TRUST_PROFILE })
    await login(page, gil)
    await act(gil, { type: 'suspend', reason: 'harassment', until: inDays(5) })
    await page.getByText(/aplicou uma medida na sua conta/).waitFor({ timeout: 20_000 })
    await sleep(300)
    await shot(page, 'auth-login-restricted-notice')
    await signInTo(page, gil, page.getByRole('heading', { name: 'Sua conta está suspensa' }))
    await sleep(300)
    await shot(page, 'restricted-suspended')
    await page.getByLabel('O que aconteceu, do seu ponto de vista').fill('Foi uma discussão sobre o jogo que passou do ponto, dos dois lados. Já pedi desculpas a ele por DM antes da suspensão.')
    await page.getByRole('button', { name: 'Enviar recurso' }).click()
    await page.getByText('Recurso enviado.', { exact: false }).waitFor()
    await sleep(200)
    await shot(page, 'restricted-appeal-sent')
    await close(app)
  }
  {
    const hel = await freshUser('helena', 'Helena Duarte')
    const ivo = await freshUser('ivo', 'Ivo Pacheco')
    await act(hel, { type: 'ban', reason: 'scam' })
    await act(ivo, { type: 'ban', reason: 'csam' })
    const r = (await rawLogin(hel)).error.restriction
    await api(null, 'POST', '/appeals', { actionId: r.actionId, message: 'Minha conta foi invadida e alguém mandou aqueles links. Troquei a senha do e-mail.', appealToken: r.appealToken })
    const { app, page } = await launch({ profile: TRUST_PROFILE })
    await signInTo(page, hel, page.getByRole('heading', { name: 'Sua conta foi encerrada' }))
    await sleep(300)
    await shot(page, 'restricted-banned-appeal-open')
    await page.getByRole('button', { name: 'Voltar para o login' }).click()
    await signInTo(page, ivo, page.getByRole('heading', { name: 'Sua conta foi encerrada' }))
    await sleep(300)
    await shot(page, 'restricted-banned-generic')
    await close(app)
  }
}

// ── wave 6 (--only=wave6): equip cosmetics + others' cosmetics live, invites live, resume renewal, telemetry,
// export download with the password, mini-player in the shell, toasts above the dock, staff triage ──
// Its own people (saved under `w6` in the users file) and its own space, recreated every run. Voice uses the LiveKit
// the API points at (LIVEKIT_HTTP, default :7880). The staff account is created on the first run; grant it with
// apps/server/scripts/grant-staff.ts while the API is stopped (PGlite: one process), start it again and re-run.
// Profiles shots-w (Ana, owner), shots-w2 (Nina, cosmetics), shots-w3 (staff).
async function w6Users() {
  const saved = existsSync(usersFile) ? JSON.parse(readFileSync(usersFile, 'utf8')) : { users: {} }
  const W = (saved.w6 ??= {})
  for (const [k, name] of [['ana', 'Ana Ribeiro'], ['nina', 'Nina Duarte'], ['caio', 'Caio Torres'], ['staff', 'Equipe Alga']]) {
    if (!W[k]) W[k] = await freshUser(`w6${k}`, name)
    const r = await api(null, 'POST', '/auth/login', { login: W[k].username, password: W[k].password }).catch((e) => {
      // A suspension from an earlier run (the staff shots suspend Caio) answers 403: lifted below with the staff token.
      if (e.status === 403) return null
      throw e
    })
    W[k].suspended = !r
    if (r) Object.assign(W[k], { token: r.token, me: r.user })
    writeFileSync(usersFile, JSON.stringify(saved, null, 2))
  }
  for (const k of ['ana', 'nina', 'caio', 'staff']) if (!W[k].suspended) await verifyEmail(W[k])
  writeFileSync(usersFile, JSON.stringify(saved, null, 2))
  return { saved, W }
}

/** The READY payload of a gateway session (what the app gets on connect). */
function readyOf(token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${API.replace(/^http/, 'ws')}/gateway`)
    const timer = setTimeout(() => (ws.close(), reject(new Error('no READY'))), 10_000)
    ws.onopen = () => ws.send(JSON.stringify({ op: 'identify', token }))
    ws.onmessage = (ev) => {
      const f = JSON.parse(String(ev.data))
      if (f.t !== 'READY') return
      clearTimeout(timer)
      ws.close()
      resolve(f.d)
    }
    ws.onerror = () => reject(new Error('gateway error'))
  })
}

/** Sandbox checkout paid "in the browser" (the provider confirms through the verified-webhook path). */
async function sandboxBuy(u, productId) {
  const r = await api(u.token, 'POST', '/billing/checkout', { productId })
  await payInBrowser(r.url)
  for (let i = 0; i < 40; i++) {
    const me = await api(u.token, 'GET', '/billing/me')
    if (me.items.some((e) => e.sku === productId || (productId.startsWith('plus') && e.sku === 'plan:plus'))) return me
    await sleep(250)
  }
  throw new Error(`${productId} never arrived`)
}
const owns = (billing, sku) => billing.items.some((e) => e.sku === sku)

/** W6_PARTS=cosmetics,voice,settings,staff re-shoots only those parts (default: all). */
const w6part = (n) => !process.env.W6_PARTS || process.env.W6_PARTS.split(',').includes(n)

async function wave6Shots() {
  console.log('wave 6…')
  const { W } = await w6Users()
  const T = (k) => W[k].token
  const isStaff = await api(T('staff'), 'GET', '/admin/reports?limit=1').then(() => true, () => false)
  if (!isStaff) console.warn(`  staff shots skipped: stop the API, run \`npx tsx scripts/grant-staff.ts ${W.staff.username} moderator\` with its PGLITE_DIR, start it and re-run`)
  if (args.includes('--prep')) return console.log(`  accounts ready (staff: ${W.staff.username})`)
  if (W.caio.suspended) {
    // Suspended by the previous run: lift it (the staff API is the only way) and log in again.
    if (!isStaff) throw new Error('Caio is suspended and the staff account cannot lift it')
    await api(T('staff'), 'POST', `/admin/users/${W.caio.me.id}/actions`, { type: 'lift', reason: 'harassment', note: 'Nova execução das capturas.' })
    const r = await api(null, 'POST', '/auth/login', { login: W.caio.username, password: W.caio.password })
    Object.assign(W.caio, { token: r.token, me: r.user, suspended: false })
  }

  // A fresh space every run: Ana owns it, Nina and Caio are members. Earlier ones (even from a run that crashed
  // before saving) are found in Ana's READY: there is no REST list of spaces.
  for (const old of (await readyOf(T('ana'))).spaces.filter((x) => x.ownerId === W.ana.me.id)) await api(T('ana'), 'DELETE', `/spaces/${old.id}`)
  const sp = await api(T('ana'), 'POST', '/spaces', { name: 'Ateliê Maré' })
  const geral = sp.channels.find((c) => c.type === 'text')
  const som = await api(T('ana'), 'POST', `/spaces/${sp.id}/channels`, { type: 'voice', name: 'Sala de som' })
  const entry = await api(T('ana'), 'POST', `/spaces/${sp.id}/invites`, { maxAgeSeconds: 0, maxUses: 0 })
  for (const k of ['nina', 'caio']) await api(T(k), 'POST', `/invites/${entry.code}`)
  await api(T('ana'), 'DELETE', `/invites/${entry.code}`)
  const say = (k, content) => api(T(k), 'POST', `/channels/${geral.id}/messages`, { content })
  await say('ana', 'Bom dia! Hoje a gente fecha a paleta do projeto novo.')
  await say('nina', 'Trouxe as referências de maré baixa, já subo.')
  await say('caio', 'Vou mandar umas opções de capa.')

  // Nina owns Coral and Cardume (bought once in the sandbox, kept across runs) and starts with nothing equipped.
  let nb = await api(T('nina'), 'GET', '/billing/me')
  if (!owns(nb, 'deco_coral')) nb = await sandboxBuy(W.nina, 'deco_coral')
  if (!owns(nb, 'nameplate_cardume')) nb = await sandboxBuy(W.nina, 'nameplate_cardume')
  await api(T('nina'), 'PUT', '/users/@me/cosmetics', { avatarDecoration: null, profileTheme: null, profileEffect: null, nameplate: null })
  await api(T('ana'), 'PATCH', '/users/@me', { telemetryOptIn: false })

  const { speech, silence } = speechWav()
  const lkHttp = process.env.LIVEKIT_HTTP ?? 'http://127.0.0.1:7880'
  const lk = await fetch(`${lkHttp}/`).then((r) => r.ok, () => false)
  let dlg
  const A = await launch({ profile: 'shots-w', extra: MEDIA_FLAGS(silence) })
  const B = w6part('cosmetics') || w6part('voice') ? await launch({ profile: 'shots-w2', extra: MEDIA_FLAGS(speech) }) : null
  for (const [n, x] of [['A', A], ['B', B]].filter(([, x]) => x)) {
    x.page.on('console', (m) => m.type() === 'error' && console.log(`  ${n} console.error:`, m.text().slice(0, 240)))
    x.page.on('pageerror', (e) => console.log(`  ${n} pageerror:`, e.message))
  }
  try {
    await login(A.page, W.ana)
    if (B) await login(B.page, W.nina)
    await rail(A.page, /^Ateliê Maré/).click()
    await channels(A.page).getByRole('button', { name: /geral/ }).first().click()
    await A.page.getByLabel('Membros').getByRole('button', { name: /Nina Duarte/ }).waitFor()
    if (w6part('cosmetics')) {
    // 1. Nina equips Coral in Personalização (the server keeps it; nothing is derived on the client any more).
    dlg = await userSection(B.page, 'Personalização')
    await dlg.getByRole('button', { name: /Coral/ }).click()
    await dlg.getByRole('button', { name: 'Usar no perfil' }).waitFor()
    await B.page.mouse.move(10, 300)
    await sleep(500)
    await shot(B.page, 'shop-equip-owned')
    await dlg.getByRole('button', { name: 'Usar no perfil' }).click()
    await dlg.getByRole('button', { name: 'Tirar do perfil' }).waitFor()
    await B.page.mouse.move(10, 300)
    await sleep(600)
    await shot(B.page, 'shop-equipped')

    // 2. Ana sees it live (USER_UPDATE), then the plate arrives too.
    const ninaRow = A.page.getByLabel('Membros').getByRole('button', { name: /Nina Duarte/ })
    await A.page.waitForFunction((name) => [...document.querySelectorAll('button')].some((b) => b.textContent?.includes(name) && b.querySelector('svg[viewBox="-60 -60 120 120"]')), 'Nina Duarte', { timeout: 10_000 })
    await dlg.getByRole('button', { name: /Cardume/ }).click()
    await dlg.getByRole('button', { name: 'Usar no perfil' }).click()
    await dlg.getByRole('button', { name: 'Tirar do perfil' }).waitFor()
    await A.page.waitForFunction(() => !!document.querySelector('[data-plate="nameplate_cardume"]'), null, { timeout: 10_000 })
    await sleep(500)
    await shot(A.page, 'members-cosmetics-others')
    await ninaRow.click()
    await A.page.getByRole('dialog', { name: 'Nina Duarte' }).waitFor()
    await sleep(1600)
    await shot(A.page, 'profile-popover-others')
    await A.page.keyboard.press('Escape')
    // Taken off from another device: Ana's list drops the plate without a refresh.
    await api(T('nina'), 'PUT', '/users/@me/cosmetics', { nameplate: null })
    await A.page.waitForFunction(() => !document.querySelector('[data-plate="nameplate_cardume"]'), null, { timeout: 10_000 })
    await sleep(300)
    await shot(A.page, 'members-cosmetics-live-unequipped')
    await api(T('nina'), 'PUT', '/users/@me/cosmetics', { nameplate: 'nameplate_cardume' })
    await B.page.keyboard.press('Escape')
    } else await api(T('nina'), 'PUT', '/users/@me/cosmetics', { avatarDecoration: 'deco_coral', nameplate: 'nameplate_cardume' })

    // 3. Voice: the decoration rides along, discreetly, on Nina's tile.
    if (!w6part('voice')) {
      /* skipped */
    } else if (!lk) console.warn(`  LiveKit not reachable at ${lkHttp}: voice shots skipped`)
    else {
      await rail(B.page, /^Ateliê Maré/).click()
      await channels(B.page).getByRole('button', { name: /Sala de som/ }).click()
      await waitConnected(B.page)
      await channels(A.page).getByRole('button', { name: /Sala de som/ }).click()
      await waitConnected(A.page)
      await A.page.locator(`[data-user-id="${W.nina.me.id}"] svg[viewBox="-60 -60 120 120"]`).waitFor({ timeout: 15_000 })
      await waitSpeaking(A.page, W.nina.me.id, 0.4)
      await A.page.mouse.move(10, 500)
      await shot(A.page, 'voice-tile-cosmetics')

      // 4. Narrow window: a toast rises above the dock instead of covering Desconectar.
      await A.app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0]
        win.setContentSize(960, 600)
      })
      await sleep(800)
      await A.page.locator('[class*="userRow"] button[aria-haspopup="dialog"]').first().click()
      await A.page.getByRole('button', { name: 'Copiar nome de usuário' }).click()
      await A.page.getByText('Copiado', { exact: true }).waitFor()
      await A.page.mouse.move(400, 200)
      await sleep(500)
      await shot(A.page, 'voice-toast-above-dock-960x600')
      await A.app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0]
        win.setContentSize(1320, 840)
        win.center()
      })
      await sleep(4500)

      // 5. Nina streams, Ana watches, then goes Home: the mini-player now lives in the shell.
      startPattern()
      await sleep(1500)
      await dock(B.page).getByRole('button', { name: 'Compartilhar tela' }).click()
      const picker = B.page.getByRole('dialog', { name: 'Compartilhar tela' })
      await picker.getByRole('radiogroup', { name: 'Telas' }).getByRole('radio').first().waitFor({ timeout: 20_000 })
      await picker.getByRole('button', { name: 'Transmitir' }).click()
      await picker.waitFor({ state: 'detached', timeout: 15_000 })
      stopPattern()
      await A.page.getByRole('button', { name: 'Assistir' }).first().click({ timeout: 20_000 })
      await A.page.waitForFunction(() => [...document.querySelectorAll('video')].some((v) => v.readyState >= 2 && v.videoWidth > 0), null, { timeout: 20_000 })
      await A.page.getByRole('button', { name: 'Conversas', exact: true }).click()
      await A.page.waitForFunction(() => [...document.querySelectorAll('video')].some((v) => v.readyState >= 2 && v.videoWidth > 0), null, { timeout: 20_000 })
      await sleep(1500)
      await A.page.mouse.move(600, 300)
      await shot(A.page, 'stream-mini-player-shell')
      await dock(B.page).getByRole('button', { name: 'Parar transmissão' }).click()
      await B.page.getByRole('menuitem', { name: 'Parar transmissão' }).click()
      await sleep(600)
      for (const p of [A.page, B.page]) await p.getByRole('button', { name: 'Desconectar' }).first().click().catch(() => undefined)
      await sleep(600)
    }
  } finally {
    stopPattern()
    if (B) await close(B.app)
  }

  if (w6part('settings')) try {
    // 6. Invites arrive and leave on the gateway (no 20 s polling): created and revoked from "another device".
    await rail(A.page, /^Ateliê Maré/).click()
    await rail(A.page, /^Ateliê Maré/).click({ button: 'right' })
    await A.page.getByRole('menuitem', { name: 'Configurações do espaço' }).click()
    const ss = A.page.locator('[data-settings]')
    await ss.getByRole('navigation').getByRole('button', { name: 'Convites', exact: true }).click()
    await ss.getByText('Nenhum convite ativo', { exact: false }).waitFor()
    const t0 = Date.now()
    const inv = await api(T('ana'), 'POST', `/spaces/${sp.id}/invites`, { maxAgeSeconds: 86_400, maxUses: 10 })
    await ss.getByText(inv.code, { exact: false }).waitFor({ timeout: 5000 })
    console.log(`  INVITE_CREATE on screen after ${Date.now() - t0} ms`)
    await sleep(300)
    await shot(A.page, 'space-settings-invites-live-created')
    const t1 = Date.now()
    await api(T('ana'), 'DELETE', `/invites/${inv.code}`)
    await ss.getByText(inv.code, { exact: false }).waitFor({ state: 'detached', timeout: 5000 })
    console.log(`  INVITE_DELETE off screen after ${Date.now() - t1} ms`)
    await sleep(300)
    await shot(A.page, 'space-settings-invites-live-revoked')
    await A.page.keyboard.press('Escape')
    // "Configurações de Ateliê Maré" also matches the user settings dialog name while it animates out.
    await ss.waitFor({ state: 'detached' })

    // 7. Assinatura: canceled renewal → "Retomar renovação" (the price and the date said before the click).
    const catalog = await api(null, 'GET', '/billing/catalog')
    const monthly = catalog.products.find((p) => p.kind === 'plan' && p.interval === 'month')
    let ab = await api(T('ana'), 'GET', '/billing/me')
    if (ab.subscription?.status !== 'active') ab = await sandboxBuy(W.ana, monthly.id)
    await api(T('ana'), 'POST', '/billing/subscription/cancel')
    dlg = await userSection(A.page, 'Assinatura')
    await dlg.getByRole('button', { name: 'Retomar renovação' }).waitFor()
    await A.page.mouse.move(10, 300)
    await sleep(300)
    await shot(A.page, 'billing-plan-canceled-resume')
    await dlg.getByRole('button', { name: 'Retomar renovação' }).click()
    await dlg.getByRole('button', { name: 'Cancelar renovação' }).waitFor()
    await A.page.mouse.move(10, 300)
    await sleep(300)
    await shot(A.page, 'billing-plan-resumed')

    // 8. Privacidade: the call-quality report, off by default, with the policy's own words.
    dlg = await userSection(A.page, 'Privacidade')
    const tele = dlg.getByRole('switch', { name: 'Enviar relatório de qualidade de chamada' })
    await tele.waitFor()
    await tele.evaluate((el) => el.closest('section')?.scrollIntoView({ block: 'center' }))
    await sleep(300)
    await shot(A.page, 'settings-privacy-telemetry-off')
    await tele.click()
    await A.page.waitForFunction(() => document.querySelector('[role="switch"][aria-label="Enviar relatório de qualidade de chamada"]')?.getAttribute('aria-checked') === 'true')
    const optIn = (await api(T('ana'), 'GET', '/users/@me')).telemetryOptIn
    console.log(`  telemetryOptIn on the server: ${optIn}`)
    await A.page.mouse.move(10, 300)
    await sleep(300)
    await shot(A.page, 'settings-privacy-telemetry-on')
    await tele.click()

    // 9. Export: status from GET /users/@me/exports; the download asks for the password, then opens the short link.
    await api(T('ana'), 'POST', '/users/@me/export').catch((e) => {
      if (e.status !== 429) throw e
    })
    for (let i = 0; i < 80; i++) {
      const l = await api(T('ana'), 'GET', '/users/@me/exports')
      if (l[0]?.status === 'ready') break
      await sleep(500)
    }
    await captureExternal(A.app)
    dlg = await userSection(A.page, 'Assinatura')
    dlg = await userSection(A.page, 'Privacidade')
    const dl = dlg.getByRole('button', { name: 'Baixar…' })
    await dl.waitFor({ timeout: 15_000 })
    await dl.evaluate((el) => el.closest('section')?.scrollIntoView({ block: 'center' }))
    await A.page.mouse.move(10, 300)
    await sleep(300)
    await shot(A.page, 'settings-privacy-export-ready')
    await dl.click()
    const modal = A.page.getByRole('dialog', { name: 'Baixar sua cópia' })
    await modal.waitFor()
    await sleep(300)
    await shot(A.page, 'settings-privacy-export-download')
    await modal.getByLabel('Sua senha').fill('nao-e-a-senha-certa')
    await modal.getByRole('button', { name: 'Baixar', exact: true }).click()
    await modal.getByText('Senha incorreta.').waitFor()
    await sleep(200)
    await shot(A.page, 'settings-privacy-export-wrong-password')
    await modal.getByLabel('Sua senha').fill(W.ana.password)
    await modal.getByRole('button', { name: 'Baixar', exact: true }).click()
    const url = await nextExternal(A.app, 1)
    const zip = await fetch(url)
    const head = Buffer.from(await zip.arrayBuffer()).subarray(0, 2).toString()
    console.log(`  download link → ${zip.status} ${zip.headers.get('content-type')} ${head === 'PK' ? '(zip)' : '(not a zip!)'}`)
    await dlg.getByText('Download aberto no navegador.').waitFor()
    await A.page.mouse.move(10, 300)
    await sleep(300)
    await shot(A.page, 'settings-privacy-export-opened')
    await A.page.keyboard.press('Escape')
  } finally {
    await close(A.app)
  }
  else await close(A.app)

  if (!isStaff || !w6part('staff')) return
  // 10. Staff triage. Earlier runs' open items are closed first so the queue tells this run's story.
  for (const r of await api(T('staff'), 'GET', '/admin/reports?status=open&limit=500')) {
    await api(T('staff'), 'PATCH', `/admin/reports/${r.id}`, { status: 'resolved', action: 'none', note: 'Fechada antes de uma nova execução das capturas.' })
  }
  for (const a of await api(T('staff'), 'GET', '/admin/appeals?status=open&limit=500')) {
    await api(T('staff'), 'PATCH', `/admin/appeals/${a.id}`, { status: 'rejected', note: 'Fechado antes de uma nova execução das capturas.' })
  }
  mkdirSync(work, { recursive: true })
  const cover = join(work, 'capa-opcao-2.png')
  if (!existsSync(cover)) ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=960x540', '-frames:v', '1', cover])
  const withFile = await apiForm(T('caio'), 'POST', `/channels/${geral.id}/messages`, fileForm([cover], { content: 'segue a opção 2' }))
  const rude = await say('caio', 'Ninguém aguenta mais as suas ideias, Nina. Some daqui.')
  await api(T('nina'), 'POST', '/reports', { targetType: 'message', targetId: withFile.id, reason: 'csam', details: 'A imagem mostra uma criança. Não abri de novo.' })
  await api(T('nina'), 'POST', '/reports', { targetType: 'message', targetId: rude.id, reason: 'harassment', details: 'Ele faz isso toda semana no canal.' })
  await api(T('ana'), 'POST', '/reports', { targetType: 'user', targetId: W.caio.me.id, reason: 'spam', details: 'Manda o mesmo convite para todo mundo.' })
  const warn = await api(T('staff'), 'POST', `/admin/users/${W.nina.me.id}/actions`, { type: 'warn', reason: 'spam', note: 'Convites repetidos em #geral.' })
  await api(T('nina'), 'POST', '/appeals', { actionId: warn.id, message: 'Eu só mandei o convite do nosso ateliê duas vezes, para pessoas que pediram. Não foi spam.' })
  await sleep(1500) // the csam report's evidence copy (SHA-256) is made in the background

  const S = await launch({ profile: 'shots-w3' })
  S.page.on('pageerror', (e) => console.log('  S pageerror:', e.message))
  try {
    await login(S.page, W.staff)
    await S.page.getByRole('button', { name: 'Painel da equipe' }).click()
    const panel = S.page.getByRole('dialog', { name: 'Painel da equipe' })
    await panel.getByRole('option').first().waitFor()
    await sleep(600)
    await shot(S.page, 'staff-queue-csam')
    await S.page.keyboard.press('ArrowDown')
    await panel.getByText('Ninguém aguenta mais', { exact: false }).last().waitFor()
    await sleep(300)
    await shot(S.page, 'staff-report-message')
    await S.page.keyboard.press('s')
    const confirm = S.page.getByRole('dialog', { name: /^Suspender:/ })
    await confirm.waitFor()
    await confirm.getByRole('radio', { name: '3 dias' }).click()
    await confirm.getByRole('textbox').fill('Ataque direto a uma colega, de novo. Reincidente no canal.')
    await sleep(300)
    await shot(S.page, 'staff-decision-suspend')
    await confirm.getByRole('textbox').press('Control+Enter')
    await confirm.waitFor({ state: 'detached' })
    await panel.getByText('registrado no log de auditoria', { exact: false }).waitFor()
    await sleep(400)
    await shot(S.page, 'staff-decision-done')
    await S.page.keyboard.press('a')
    await S.page.getByRole('dialog', { name: /^Arquivar:/ }).waitFor()
    await sleep(300)
    await shot(S.page, 'staff-decision-dismiss')
    await S.page.keyboard.press('Escape')
    // Keys wait while a confirmation is still on screen (its exit animation included).
    await S.page.getByRole('dialog', { name: /^Arquivar:/ }).waitFor({ state: 'detached' })
    await S.page.keyboard.press('2')
    await panel.getByText('Eu só mandei o convite', { exact: false }).waitFor()
    await sleep(300)
    await shot(S.page, 'staff-appeals')
    await S.page.keyboard.press('r')
    const rev = S.page.getByRole('dialog', { name: /^Reverter a decisão:/ })
    await rev.waitFor()
    await sleep(300)
    await shot(S.page, 'staff-appeal-revert')
    await rev.getByRole('textbox').fill('Convite pedido pelas pessoas. Aviso retirado.')
    await rev.getByRole('textbox').press('Control+Enter')
    await rev.waitFor({ state: 'detached' })
    await S.page.keyboard.press('3')
    await panel.getByText('capa-opcao-2.png').first().waitFor()
    await sleep(300)
    await shot(S.page, 'staff-quarantine')
    await S.page.keyboard.press('l')
    await S.page.getByRole('dialog', { name: /^Liberar/ }).waitFor()
    await sleep(300)
    await shot(S.page, 'staff-quarantine-release')
    await S.page.keyboard.press('Escape')
    await S.page.getByRole('dialog', { name: /^Liberar/ }).waitFor({ state: 'detached' })
    await S.page.keyboard.press('1')
    await panel.getByRole('radio', { name: 'Resolvidas' }).click()
    await panel.getByText('Ataque direto a uma colega', { exact: false }).or(panel.getByRole('option').first()).first().waitFor()
    await panel.getByRole('option', { name: /Assédio/ }).first().click()
    await panel.getByText('Ataque direto a uma colega', { exact: false }).waitFor()
    await sleep(300)
    await shot(S.page, 'staff-reports-resolved')
    await S.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(960, 600))
    await panel.getByRole('radio', { name: 'Abertas' }).click()
    await sleep(800)
    await shot(S.page, 'staff-queue-960x600')
  } finally {
    await close(S.app)
  }
  // Caio stays suspended until the next run lifts it (w6Users).
}

// ── r3: every screen the design r3 wave changed, from one fixture (seed), two real instances in a real room ──
// R3_STACK=<stack script> (start/stop for YOUR LiveKit: `node <it> lk-stop|lk-start`) adds the reconnecting state.
const resize = (x, w, h) =>
  x.app.evaluate(({ BrowserWindow }, [w, h]) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.setContentSize(w, h)
    if (win.getBounds().x > -10000) win.center()
  }, [w, h])
const hasVideo = (page) => page.waitForFunction(() => [...document.querySelectorAll('video')].some((v) => v.readyState >= 2 && v.videoWidth > 0), null, { timeout: 20_000 })
const park = async (page, x = 700, y = 120) => {
  await page.mouse.move(x, y)
  await page.evaluate(() => document.activeElement?.blur?.())
}
async function settingsAt(page, name) {
  const dlg = userSettings(page)
  if (!(await dlg.isVisible())) {
    await page.keyboard.press('Control+,')
    await dlg.waitFor()
  }
  await dlg.getByRole('navigation').getByRole('button', { name, exact: true }).click()
  await sleep(500)
  return dlg
}

async function r3Shots(saved) {
  console.log('r3…')
  const lk = await fetch(`${LK_HTTP}/`).then((r) => r.ok, () => false)
  if (!lk) throw new Error(`LiveKit is not reachable at ${LK_HTTP}`)
  const U = saved.users
  const offs = [connectPresence(U.carla.token), connectPresence(U.diego.token, 'idle')]
  const ids = await seed(saved)
  const { speech, silence } = speechWav()
  const part = (n) => !process.env.R3_PARTS || process.env.R3_PARTS.split(',').includes(n)
  const A = await launch({ extra: MEDIA_FLAGS(silence) })
  const B = await launch({ profile: 'shots-b', extra: MEDIA_FLAGS(speech) })
  for (const [n, x] of [['A', A], ['B', B]]) {
    x.page.on('console', (m) => m.type() === 'error' && console.log(`  ${n} console.error:`, m.text().slice(0, 240)))
    x.page.on('pageerror', (e) => console.log(`  ${n} pageerror:`, e.message))
  }
  const bruno = U.bruno.me.id
  try {
    await login(A.page, U.ana)
    await login(B.page, U.bruno)
    await rail(B.page, /^Estúdio Alga/).click()
    await channels(B.page).getByRole('button', { name: /Sala de foco/ }).click()
    await waitConnected(B.page)

    if (part('shell')) {
      // Home: "Agora", the rail keeps fronds (bottom) and the mention (top) on the same space.
      await A.page.getByRole('button', { name: 'Conversas', exact: true }).click()
      await A.page.getByRole('region', { name: 'Agora' }).getByText('Sala de foco').waitFor({ timeout: 15_000 })
      await park(A.page)
      await sleep(500)
      await shot(A.page, 'home-agora')
      // Chat: voice in the header, "Em voz" opens the member list, straight reply stems.
      await rail(A.page, /^Estúdio Alga/).click()
      await channels(A.page).getByRole('button', { name: /^geral/ }).click()
      await A.page.getByText('Eu topo testar também').waitFor()
      await park(A.page)
      await sleep(600)
      await shot(A.page, 'chat-channel')
      const row = A.page.getByLabel('Membros').getByRole('button', { name: /Bruno Costa/ })
      await row.click({ button: 'right' })
      await A.page.getByRole('menu').waitFor()
      await sleep(300)
      await shot(A.page, 'member-menu')
      await A.page.keyboard.press('Escape')
      await row.click()
      await A.page.getByRole('dialog', { name: 'Bruno Costa' }).waitFor()
      await sleep(1400)
      await shot(A.page, 'profile-popover-others')
      await A.page.keyboard.press('Escape')
      // Not a friend yet (Ana's request is pending): the card offers the relationship as it stands.
      await A.page.getByLabel('Membros').getByRole('button', { name: /Fábio Lima/ }).click()
      await A.page.getByRole('dialog', { name: 'Fábio Lima' }).waitFor()
      await sleep(1200)
      await shot(A.page, 'profile-popover-pending')
      await A.page.keyboard.press('Escape')
      // The chat author opens the same card.
      await A.page.getByRole('log').getByRole('button', { name: 'Carlinha', exact: true }).first().click()
      await A.page.getByRole('dialog', { name: 'Carlinha' }).waitFor()
      await sleep(1200)
      await shot(A.page, 'chat-author-popover')
      await A.page.keyboard.press('Escape')
    }

    // Pre-join (Ctrl+K opens the room without joining), then the stage.
    await A.page.keyboard.press('Control+K')
    await A.page.keyboard.type('Sala de foco')
    await sleep(200)
    await A.page.keyboard.press('Enter')
    await A.page.getByRole('button', { name: 'Entrar em Sala de foco', exact: true }).waitFor()
    await park(A.page, 820, 300)
    await sleep(500)
    await shot(A.page, 'voice-preview')
    await A.page.getByRole('button', { name: 'Entrar em Sala de foco', exact: true }).click()
    await waitConnected(A.page)
    await sleep(1500)
    console.log(`  bruno --speak at capture: ${(await waitSpeaking(A.page, bruno, 0.45)).toFixed(2)}`)
    await park(A.page)
    await shot(A.page, 'voice-stage')
    await A.page.getByRole('img', { name: /^Conex/ }).first().hover()
    await sleep(900)
    await shot(A.page, 'voice-panel-link')
    await waitSpeaking(B.page, bruno, 0.3)
    await park(B.page)
    await shot(B.page, 'voice-stage-self-speaking')

    // One rule at every size: a toast rises above the dock (1320×840 here; 960×600 below).
    await A.page.locator('[class*="userRow"] button[aria-haspopup="dialog"]').first().click()
    await A.page.getByRole('button', { name: 'Copiar nome de usuário' }).click()
    await A.page.getByText('Copiado', { exact: true }).waitFor()
    await park(A.page, 700, 200)
    await sleep(400)
    await shot(A.page, 'voice-toast-above-dock', { toasts: true })
    await sleep(4200)

    // The same person menu on the call tile (reach, for you, moderation, relationship, report).
    await A.page.locator(`[data-user-id="${bruno}"]`).click({ button: 'right' })
    await A.page.getByRole('menu').waitFor()
    await sleep(300)
    await shot(A.page, 'voice-tile-moderation-menu')
    await A.page.keyboard.press('Escape')

    if (part('stream')) {
      // Ana shares: the picker, then her own tile carries the stream (no second tile).
      startPattern()
      await sleep(1500)
      await dock(A.page).getByRole('button', { name: 'Compartilhar tela' }).click()
      const picker = A.page.getByRole('dialog', { name: 'Compartilhar tela' })
      await picker.waitFor()
      await picker.locator('img').first().waitFor({ timeout: 20_000 })
      await sleep(1800)
      await shot(A.page, 'screen-picker')
      await picker.getByRole('button', { name: 'Transmitir' }).click()
      await picker.waitFor({ state: 'detached', timeout: 15_000 })
      stopPattern()
      await A.page.getByText('Você está transmitindo').first().waitFor()
      await sleep(2500)
      await park(A.page)
      await shot(A.page, 'screen-sharing-self')
      // Bruno: Ana's tile says AO VIVO with Assistir; watching gives the stream the stage, people in a strip.
      await B.page.getByRole('button', { name: 'Assistir' }).first().waitFor({ timeout: 15_000 })
      await park(B.page)
      await sleep(400)
      await shot(B.page, 'stream-tile-unwatched')
      await B.page.getByRole('button', { name: 'Assistir' }).first().click()
      await hasVideo(B.page)
      await sleep(2500)
      await park(B.page, 10, 400)
      await shot(B.page, 'stream-watching')
      await B.page.keyboard.press('Control+Shift+E')
      await sleep(1500)
      await B.page.locator('video').first().hover()
      await sleep(300)
      await shot(B.page, 'stream-stats')
      await B.page.keyboard.press('Control+Shift+E')
      await resize(B, 960, 600)
      await sleep(1200)
      await park(B.page, 10, 300)
      await shot(B.page, 'stream-watching-960x600')
      await resize(B, 1320, 840)
      // Ana, elsewhere in the app while live: the title bar chip is the reminder.
      await channels(A.page).getByRole('button', { name: /^geral/ }).click()
      await sleep(800)
      await park(A.page)
      await shot(A.page, 'screen-sharing-offstage')
      await channels(A.page).getByRole('button', { name: /Sala de foco/ }).click()
      await sleep(600)
      await A.page.getByRole('button', { name: 'Parar transmissão' }).first().click()
      await sleep(800)
    }

    // Narrow window: the call stage and the same toast rule.
    await resize(A, 960, 600)
    await sleep(1200)
    await waitSpeaking(A.page, bruno, 0.4)
    await park(A.page, 500, 100)
    await shot(A.page, 'voice-stage-960x600')

    // Reconnecting never lies: a chip on top of a greyed stage (only with our own SFU to stop).
    if (process.env.R3_STACK) {
      spawnSync('node', [process.env.R3_STACK, 'lk-stop'], { stdio: 'ignore' })
      await A.page.getByText('Reconectando à voz…').first().waitFor({ timeout: 30_000 })
      await sleep(800)
      await shot(A.page, 'voice-reconnecting-960x600')
      await resize(A, 1320, 840)
      await sleep(800)
      await shot(A.page, 'voice-reconnecting')
      spawnSync('node', [process.env.R3_STACK, 'lk-start'], { stdio: 'ignore' })
      await A.page.getByText('Voz conectada').first().waitFor({ timeout: 60_000 }).catch(() => undefined)
    }
    await resize(A, 1320, 840)
    for (const x of [A, B]) await x.page.getByRole('button', { name: 'Desconectar' }).first().click().catch(() => undefined)
    await sleep(800)

    if (part('dm')) {
      // DM call: the ring card sits in its own corner; the intro says "Em chamada".
      await A.page.getByRole('button', { name: 'Conversas', exact: true }).click()
      await A.page.getByRole('button', { name: /Bruno Costa/ }).first().click()
      await A.page.getByRole('button', { name: 'Iniciar chamada de voz' }).click()
      await B.page.getByRole('alertdialog').waitFor({ timeout: 20_000 })
      await sleep(500)
      await shot(B.page, 'call-incoming')
      await B.page.getByRole('button', { name: 'Atender' }).click()
      await waitConnected(B.page)
      await sleep(1500)
      await waitSpeaking(A.page, bruno, 0.4)
      await park(A.page, 1000, 470)
      await shot(A.page, 'dm-call')
      for (const x of [A, B]) await x.page.getByRole('button', { name: 'Desconectar' }).first().click().catch(() => undefined)
      await sleep(600)
    }

    if (part('settings')) {
      let dlg = await settingsAt(A.page, 'Aparência')
      await park(A.page, 10, 300)
      await shot(A.page, 'settings-appearance')
      dlg = await settingsAt(A.page, 'Voz e vídeo')
      await dlg.getByRole('button', { name: /^Microfone:/ }).click()
      await A.page.getByRole('menu').waitFor()
      await sleep(300)
      await shot(A.page, 'settings-voice-devices')
      await A.page.keyboard.press('Escape')
      dlg = await settingsAt(A.page, 'Minha conta')
      await dlg.getByText('Sessões', { exact: true }).scrollIntoViewIfNeeded()
      await sleep(400)
      await shot(A.page, 'settings-account-security')
      await settingsAt(A.page, 'Personalização')
      await sleep(600)
      await shot(A.page, 'shop')
      await resize(A, 1920, 1080)
      await sleep(800)
      await shot(A.page, 'shop-1920x1080')
      await settingsAt(A.page, 'Aparência')
      await shot(A.page, 'settings-1920x1080')
      await resize(A, 960, 600)
      await sleep(800)
      await shot(A.page, 'settings-960x600')
      await resize(A, 1320, 840)
      // Compact for real: 20 px lines, then no avatars (IRC-like).
      dlg = await settingsAt(A.page, 'Aparência')
      await dlg.getByRole('radio', { name: 'Compacta' }).click()
      await dlg.getByRole('switch', { name: 'Avatares nas mensagens' }).click()
      await A.page.keyboard.press('Escape')
      await userSettings(A.page).waitFor({ state: 'detached' })
      await rail(A.page, /^Estúdio Alga/).click()
      await channels(A.page).getByRole('button', { name: /^geral/ }).click()
      await sleep(600)
      await park(A.page)
      await shot(A.page, 'density-compact')
      dlg = await settingsAt(A.page, 'Aparência')
      await dlg.getByRole('radio', { name: 'Confortável' }).click()
      await A.page.keyboard.press('Escape')
      await userSettings(A.page).waitFor({ state: 'detached' })
      // Space: the menu matches the header, roles use the state-safe palette, delete is quiet at rest.
      await channels(A.page).getByRole('button', { name: 'Estúdio Alga' }).click()
      await A.page.getByRole('menu').waitFor()
      await sleep(300)
      await shot(A.page, 'space-menu')
      await A.page.getByRole('menuitem', { name: 'Configurações do espaço' }).click()
      const ss = A.page.locator('[data-settings]')
      await ss.waitFor()
      await sleep(500)
      await shot(A.page, 'space-settings-overview')
      await ss.getByRole('navigation').getByRole('button', { name: 'Cargos', exact: true }).click()
      await ss.getByRole('button', { name: /Design/ }).first().click()
      await sleep(500)
      await shot(A.page, 'space-settings-role-editor')
      await ss.getByRole('button', { name: /^Fechar/ }).first().click().catch(() => A.page.keyboard.press('Escape'))
      await ss.waitFor({ state: 'detached' })
    }

    // Narrow shell: home and chat.
    await resize(A, 960, 600)
    await A.page.getByRole('button', { name: 'Conversas', exact: true }).click()
    await sleep(600)
    await park(A.page, 600, 300)
    await shot(A.page, 'home-960x600')
    await rail(A.page, /^Estúdio Alga/).click()
    await channels(A.page).getByRole('button', { name: /^geral/ }).click()
    await sleep(600)
    await shot(A.page, 'shell-960x600')
  } catch (e) {
    await A.page.screenshot({ path: join(work, 'r3-fail-a.png') }).catch(() => undefined)
    await B.page.screenshot({ path: join(work, 'r3-fail-b.png') }).catch(() => undefined)
    throw e
  } finally {
    stopPattern()
    await close(A.app)
    await close(B.app)
  }

  // 1920×1080 at 125 % (1536×864 CSS px): shell, chat, call stage, settings; Bruno talks from a normal instance.
  if (part('hidpi')) {
    const C = await launch({ width: 1536, height: 864, scale: 1.25, extra: MEDIA_FLAGS(silence) })
    const D = await launch({ profile: 'shots-b', extra: MEDIA_FLAGS(speech) })
    try {
      await login(C.page, U.ana)
      await login(D.page, U.bruno)
      await rail(D.page, /^Estúdio Alga/).click()
      await channels(D.page).getByRole('button', { name: /Sala de foco/ }).click()
      await waitConnected(D.page)
      await C.page.getByRole('button', { name: 'Conversas', exact: true }).click()
      await C.page.getByRole('region', { name: 'Agora' }).getByText('Sala de foco').waitFor({ timeout: 15_000 })
      await park(C.page, 900, 400)
      await sleep(500)
      await shot(C.page, 'home-1920x1080@125')
      await rail(C.page, /^Estúdio Alga/).click()
      await channels(C.page).getByRole('button', { name: /^geral/ }).click()
      await C.page.getByText('Eu topo testar também').waitFor()
      await park(C.page)
      await sleep(500)
      await shot(C.page, 'shell-1920x1080@125')
      await channels(C.page).getByRole('button', { name: /Sala de foco/ }).click()
      await waitConnected(C.page)
      await sleep(1500)
      await waitSpeaking(C.page, bruno, 0.45)
      await park(C.page)
      await shot(C.page, 'voice-stage-1920x1080@125')
      await settingsAt(C.page, 'Aparência')
      await park(C.page, 10, 300)
      await shot(C.page, 'settings-1920x1080@125')
      await C.page.keyboard.press('Escape')
      for (const x of [C, D]) await x.page.getByRole('button', { name: 'Desconectar' }).first().click().catch(() => undefined)
    } finally {
      await close(C.app)
      await close(D.app)
    }
  }
  offs.forEach((off) => off())
  return ids
}

// ── demo content (wave 9): what the screenshots show is worthy of the product ──
// Avatars, attachments and the shared screen are drawn here by Chromium (canvas): abstract, on the Índigo palette,
// never a photo, a face or a file from this machine. Generated once into work/media (a marker file says which
// generation), so every section of this script uploads the same pictures.
const DEMO_VERSION = 'demo-v3'
/** [file, kind, hue, width, height]: avatars 512², attachments at their old sizes. */
const DEMO_FILES = [
  ['avatar-bruno.png', 'dunes', 235, 512, 512],
  ['avatar-carla.png', 'sun', 18, 512, 512],
  ['avatar-diego.png', 'orbit', 150, 512, 512],
  ['avatar-fabio.png', 'prism', 295, 512, 512],
  ['avatar-gui.png', 'fronds', 340, 512, 512],
  ['orla.jpg', 'sea', 20, 1600, 1000],
  ['retrato.jpg', 'pebbles', 280, 900, 1200],
  ['fractal.png', 'dunes', 255, 1200, 800],
  ['vida.png', 'fronds', 150, 900, 1200],
  ['padrao-720p.png', 'orbit', 275, 1280, 720],
  ['barras.png', 'sea', 250, 1920, 1080],
  ['icone.png', 'fronds', 279, 600, 600],
  ['foto-perfil.jpg', 'sun', 330, 1600, 1200],
]
/** Ten extra people for crowded rooms (LiveKit participants in a headless Chromium); two keep their initials. */
const CROWD = [
  ['helena', 'Helena Prado', 'pebbles', 255],
  ['igor', 'Igor Matos', 'dunes', 315],
  ['julia', 'Júlia Campos', 'sun', 275],
  ['leo', 'Leo Barros', null, 0],
  ['marina', 'Marina Teles', 'fronds', 140],
  ['nuno', 'Nuno Faria', 'orbit', 235],
  ['olivia', 'Olívia Reis', 'prism', 15],
  ['paulo', 'Paulo Sena', 'pebbles', 300],
  ['rita', 'Rita Lopes', null, 0],
  ['sofia', 'Sofia Dantas', 'dunes', 345],
]

/** In the page: one composition per kind, seeded, with a top-left light and a whisper of grain (material, not flat). */
function drawDemo(specs) {
  const out = {}
  for (const { name, kind, hue, w, h, seed } of specs) {
    let s = seed
    const r = () => (s = (s * 16807) % 2147483647) / 2147483647
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const g = c.getContext('2d')
    const m = Math.min(w, h)
    const col = (l, ch, hh, a = 1) => `oklch(${l} ${ch} ${(((hh % 360) + 360) % 360).toFixed(1)} / ${a})`
    const bg = g.createLinearGradient(0, 0, w * 0.45, h)
    bg.addColorStop(0, col(0.45, 0.1, hue))
    bg.addColorStop(1, col(0.21, 0.065, hue + 35))
    g.fillStyle = bg
    g.fillRect(0, 0, w, h)
    const disc = (x, y, rad, stops) => {
      const gr = g.createRadialGradient(x - rad * 0.25, y - rad * 0.3, 0, x, y, rad)
      for (const [o, cc] of stops) gr.addColorStop(o, cc)
      g.fillStyle = gr
      g.beginPath()
      g.arc(x, y, rad, 0, Math.PI * 2)
      g.fill()
    }
    if (kind === 'sun' || kind === 'sea') {
      const sky = g.createLinearGradient(0, 0, 0, h * 0.62)
      sky.addColorStop(0, col(0.3, 0.08, hue + 250))
      sky.addColorStop(0.6, col(0.52, 0.11, hue + 330))
      sky.addColorStop(1, col(0.74, 0.12, hue + 10))
      g.fillStyle = sky
      g.fillRect(0, 0, w, h * 0.62)
      disc(w * 0.5, h * 0.6, m * 0.2, [[0, col(0.97, 0.05, hue + 60)], [0.6, col(0.86, 0.12, hue + 40)], [1, col(0.78, 0.13, hue + 20, 0)]])
      for (let i = 0; i < 4; i++) {
        g.fillStyle = col(0.34 - i * 0.045, 0.07, hue + 260 + i * 10, 0.96)
        g.fillRect(0, h * (0.62 + i * 0.1), w, h)
      }
      if (kind === 'sea')
        for (let i = 0; i < 26; i++) {
          const y = h * (0.64 + r() * 0.34)
          const half = m * (0.02 + r() * 0.09) * (1 - (y / h - 0.62))
          g.fillStyle = col(0.88, 0.09, hue + 40, 0.18 + r() * 0.3)
          g.fillRect(w * 0.5 - half + (r() - 0.5) * m * 0.04, y, half * 2, Math.max(2, m * 0.004))
        }
    } else if (kind === 'dunes') {
      for (let i = 0; i < 5; i++) {
        const y = h * (0.32 + i * 0.14)
        g.fillStyle = col(0.56 - i * 0.075, 0.095, hue + i * 9, 0.96)
        g.beginPath()
        g.moveTo(0, h)
        g.lineTo(0, y)
        g.bezierCurveTo(w * 0.3, y - h * (0.12 + r() * 0.08), w * 0.65, y + h * (0.08 + r() * 0.06), w, y - h * 0.05)
        g.lineTo(w, h)
        g.closePath()
        g.fill()
      }
    } else if (kind === 'orbit') {
      const cx = w * 0.58
      const cy = h * 0.42
      for (let i = 8; i >= 1; i--) {
        g.strokeStyle = col(0.74 + i * 0.015, 0.08, hue - i * 6, 0.1 + 0.045 * (8 - i))
        g.lineWidth = m * 0.018
        g.beginPath()
        g.arc(cx, cy, m * 0.065 * i, 0, Math.PI * 2)
        g.stroke()
      }
      disc(cx, cy, m * 0.12, [[0, col(0.96, 0.04, hue)], [1, col(0.72, 0.13, hue)]])
    } else if (kind === 'prism') {
      for (let i = 0; i < 4; i++) {
        g.fillStyle = col(0.62 + i * 0.07, 0.1 - i * 0.015, hue + i * 22, 0.36)
        g.beginPath()
        g.moveTo(w * (0.08 + i * 0.18), h)
        g.lineTo(w * (0.44 + i * 0.18), 0)
        g.lineTo(w * (0.62 + i * 0.18), 0)
        g.lineTo(w * (0.26 + i * 0.18), h)
        g.closePath()
        g.fill()
      }
    } else if (kind === 'fronds') {
      // Two blades leaning together: a nod to the mark's idea (two presences), never the mark itself.
      const blade = (x, bw, bh, lean, color) => {
        g.fillStyle = color
        g.beginPath()
        g.moveTo(x, h)
        g.bezierCurveTo(x - bw, h - bh * 0.5, x + lean - bw * 0.4, h - bh * 0.9, x + lean, h - bh)
        g.bezierCurveTo(x + lean + bw * 0.5, h - bh * 0.85, x + bw, h - bh * 0.45, x + bw * 0.6, h)
        g.closePath()
        g.fill()
      }
      blade(w * 0.4, m * 0.2, h * 0.84, m * 0.08, col(0.88, 0.05, hue + 20, 0.95))
      blade(w * 0.58, m * 0.15, h * 0.58, -m * 0.02, col(0.7, 0.13, hue - 10, 0.92))
    } else if (kind === 'pebbles') {
      for (const [x, y, rad, dl, dh] of [[0.36, 0.42, 0.27, 0.2, -10], [0.64, 0.5, 0.22, 0.12, 25], [0.48, 0.7, 0.18, 0.28, 50]])
        disc(w * x, h * y, m * rad, [[0, col(0.62 + dl, 0.1, hue + dh, 0.92)], [1, col(0.45 + dl * 0.5, 0.11, hue + dh, 0.8)]])
    }
    const light = g.createRadialGradient(w * 0.2, h * 0.08, 0, w * 0.2, h * 0.08, Math.max(w, h) * 0.9)
    light.addColorStop(0, 'rgba(255,255,255,0.12)')
    light.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = light
    g.fillRect(0, 0, w, h)
    const img = g.getImageData(0, 0, w, h)
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (r() - 0.5) * 9
      img.data[i] += n
      img.data[i + 1] += n
      img.data[i + 2] += n
    }
    g.putImageData(img, 0, 0)
    out[name] = c.toDataURL(name.endsWith('.png') ? 'image/png' : 'image/jpeg', 0.9)
  }
  return out
}

/** Generates DEMO_FILES (+ the crowd's avatars) into work/media once; testMedia() then finds them there. */
async function demoMedia() {
  const dir = join(work, 'media')
  mkdirSync(dir, { recursive: true })
  const marker = join(dir, `.${DEMO_VERSION}`)
  const crowd = CROWD.filter(([, , kind]) => kind).map(([key, , kind, hue]) => [`avatar-${key}.png`, kind, hue, 512, 512])
  if (!existsSync(marker)) {
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage()
      const specs = [...DEMO_FILES, ...crowd].map(([name, kind, hue, w, h], i) => ({ name, kind, hue, w, h, seed: 7919 * (i + 3) }))
      const out = await page.evaluate(drawDemo, specs)
      for (const [name, url] of Object.entries(out)) writeFileSync(join(dir, name), Buffer.from(url.split(',')[1], 'base64'))
      writeFileSync(marker, new Date().toISOString())
    } finally {
      await browser.close()
    }
  }
  return (n) => join(dir, n)
}

/**
 * The shared screen: a calm, real-looking editor (this repo's own layout.ts, highlighted on the palette), a terminal
 * with the test run and a cursor that types. Full screen on top while a share is captured, so neither the picker's
 * thumbnails nor the stream ever show the real desktop.
 */
function sceneHtml() {
  const code = readFileSync(join(appDir, 'src/renderer/src/features/voice/layout.ts'), 'utf8').split('\n').slice(0, 46)
  const esc = (x) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  const KW = /\b(export|const|function|return|for|if|let|of|interface|type|import|from|new|Math)\b/g
  const line = (l) => {
    if (/^\s*(\/\/|\/\*|\*)/.test(l)) return `<i class="c">${esc(l)}</i>`
    return esc(l)
      .replace(/('[^']*')/g, '<b class="s">$1</b>')
      .replace(/\b(\d+(\.\d+)?)\b/g, '<b class="n">$1</b>')
      .replace(KW, '<b class="k">$1</b>')
      .replace(/\b([A-Z][A-Za-z]+)\b/g, '<b class="t">$1</b>')
      .replace(/(\w+)(?=\()/g, '<b class="f">$1</b>')
  }
  const rows = code.map((l, i) => `<div class="ln${i === 30 ? ' cur' : ''}"><span class="no">${i + 1}</span><span class="tx">${line(l) || ' '}</span></div>`).join('')
  const mini = code.map((l) => `<i style="width:${Math.min(100, l.length * 1.1)}%;margin-left:${(l.match(/^\s*/)[0].length * 1.2).toFixed(0)}%"></i>`).join('')
  const tree = ['voice', '  CallStage.tsx', '  ControlsDock.tsx', '  E2ee.tsx', '  layout.ts', '  layout.test.ts', '  stage.module.css', 'shell', 'switcher', 'ui']
    .map((x, i) => `<div class="tr${i === 4 ? ' on' : ''}${x.startsWith('  ') ? '' : ' dir'}">${esc(x.trim())}</div>`)
    .join('')
  return `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0}body{background:#0b0b0c;color:#d0d6e0;font:13px/1.4 'Segoe UI Variable Text','Segoe UI',sans-serif;height:100vh;overflow:hidden;display:grid;grid-template-rows:34px 1fr 24px}
.top{display:flex;align-items:center;justify-content:center;color:#8a8f98;font-size:12px;border-bottom:1px solid #1a1b1e}
.main{display:grid;grid-template-columns:48px 250px 1fr 120px;min-height:0}
.act{border-right:1px solid #16171a;display:grid;align-content:start;gap:14px;padding:14px 0;justify-items:center}.act i{width:20px;height:20px;border-radius:5px;background:#202128}.act i:first-child{background:#3a3c6a}
.side{background:#0d0e10;border-right:1px solid #16171a;padding:12px 8px}.side h4{font:600 11px/1 'Segoe UI';letter-spacing:.06em;color:#62666d;margin:4px 8px 12px}
.tr{padding:4px 8px 4px 22px;border-radius:6px;color:#8a8f98}.tr.dir{padding-left:8px;color:#d0d6e0}.tr.on{background:rgba(150,152,255,.13);color:#f7f8f8}
.ed{display:grid;grid-template-rows:38px 1fr 210px;min-width:0;background:#0f1011}
.tabs{display:flex;border-bottom:1px solid #1a1b1e;background:#0d0e10}.tab{padding:0 18px;display:flex;align-items:center;color:#8a8f98;border-right:1px solid #16171a}.tab.on{background:#0f1011;color:#f7f8f8;box-shadow:inset 0 2px 0 #8b8ef7}
.code{font:15px/24px 'Cascadia Code','Cascadia Mono',Consolas,monospace;padding:14px 0;overflow:hidden;white-space:pre}
.ln{display:flex}.ln.cur{background:rgba(255,255,255,.035)}.no{width:64px;text-align:right;padding-right:22px;color:#3d4047}.ln.cur .no{color:#8a8f98}
.k{color:#b4a7f5;font-weight:400}.s{color:#e9bd8f;font-weight:400}.n{color:#f2a7c1;font-weight:400}.t{color:#9cc7f0;font-weight:400}.f{color:#ececf2;font-weight:400}.c{color:#5d626b}
#cursor{display:inline-block;width:2px;height:19px;background:#f7f8f8;vertical-align:-4px;animation:b 1.05s steps(1) infinite}@keyframes b{50%{opacity:0}}
.term{border-top:1px solid #1a1b1e;background:#0c0d0e;padding:10px 20px;font:13px/21px 'Cascadia Code',Consolas,monospace;color:#8a8f98;overflow:hidden}.term b{color:#61c28e;font-weight:400}.term em{color:#f7f8f8;font-style:normal}
.mini{background:#0f1011;border-left:1px solid #16171a;padding:16px 12px;display:grid;align-content:start;gap:3px}.mini i{display:block;height:3px;border-radius:2px;background:#2a2c33}.mini i:nth-child(n+28):nth-child(-n+36){background:#3a3c6a}
.bar{display:flex;align-items:center;gap:18px;padding:0 14px;font-size:12px;color:#8a8f98;border-top:1px solid #1a1b1e;background:#0b0b0c}.bar span:first-child{color:#d0d6e0}
</style></head><body>
<div class="top">layout.ts — alga-meet</div>
<div class="main"><div class="act"><i></i><i></i><i></i><i></i></div>
<div class="side"><h4>EXPLORADOR</h4>${tree}</div>
<div class="ed"><div class="tabs"><div class="tab on">layout.ts</div><div class="tab">CallStage.tsx</div><div class="tab">stage.module.css</div></div>
<div class="code" id="code">${rows}</div>
<div class="term"><div><em>$</em> npm test -w apps/desktop</div><div>&nbsp;✓ src/renderer/src/features/voice/layout.test.ts <b>(9 tests)</b> 4ms</div><div>&nbsp;✓ src/renderer/src/ui/personHue.test.ts <b>(2 tests)</b> 3ms</div><div>&nbsp;✓ src/renderer/src/features/voice/directCall.test.ts <b>(2 tests)</b> 2ms</div><div>&nbsp;</div><div>&nbsp;Test Files <b>22 passed</b> (22)</div><div>&nbsp;Tests <b>284 passed</b> (284)</div><div><em>$</em> <span id="cmd"></span></div></div></div>
<div class="mini">${mini}</div></div>
<div class="bar"><span>main</span><span>TypeScript</span><span>UTF-8</span><span style="margin-left:auto">Ln 31, Col 12</span></div>
<script>
const cur = document.querySelector('.ln.cur .tx'); const base = cur.innerHTML; const add = '  // calm, balanced rows'; let i = 0
const c = document.createElement('span'); c.id = 'cursor'
setInterval(() => { i = (i + 1) % (add.length + 40); cur.innerHTML = base + '<i class="c">' + add.slice(0, Math.min(i, add.length)) + '</i>'; cur.appendChild(c) }, 90)
const cmd = 'npm run typecheck -w apps/desktop'; let j = 0; setInterval(() => { j = (j + 1) % (cmd.length + 30); document.getElementById('cmd').textContent = cmd.slice(0, j) }, 110)
</script></body></html>`
}

/** Shows the scene full screen, on top of everything, without taking focus (main process of `app`). */
async function startScene(app) {
  await app.evaluate(async ({ BrowserWindow, screen }, html) => {
    const b = screen.getPrimaryDisplay().bounds
    const w = new BrowserWindow({ ...b, frame: false, show: false, focusable: false, skipTaskbar: true, alwaysOnTop: true, backgroundColor: '#0b0b0c', webPreferences: { backgroundThrottling: false } })
    w.setAlwaysOnTop(true, 'screen-saver')
    await w.loadURL(`data:text/html;base64,${html}`)
    w.showInactive()
    globalThis.__algaScene = w
  }, Buffer.from(sceneHtml()).toString('base64'))
  await sleep(800)
}
async function stopScene(app) {
  await app.evaluate(() => globalThis.__algaScene?.destroy()).catch(() => undefined)
}

/** Ten extra accounts (saved with the others), verified, with their generated avatars. */
async function ensureCrowd(saved, media) {
  saved.crowd ??= {}
  for (const [key, displayName, kind] of CROWD) {
    let u = saved.crowd[key]
    if (u) {
      try {
        u.me = await api(u.token, 'GET', '/users/@me')
        continue
      } catch {
        const r = await api(null, 'POST', '/auth/login', { login: u.username, password: u.password })
        Object.assign(u, { token: r.token, me: r.user })
        continue
      }
    }
    u = saved.crowd[key] = await freshUser(key, displayName)
    await verifyEmail(u)
    if (kind) await apiForm(u.token, 'PUT', '/users/@me/avatar', fileForm([media(`avatar-${key}.png`)]))
    writeFileSync(usersFile, JSON.stringify(saved, null, 2))
  }
  return CROWD.map(([key]) => saved.crowd[key])
}

/**
 * LiveKit participants for crowded rooms: one headless Chromium page, one Room per person, tokens from the real
 * POST /voice/join (so the server sees them as voice states). `speak`: the SAPI speech loop as their microphone;
 * the others publish a silent track (unmuted, quiet).
 */
async function startCrowd() {
  const { speech } = speechWav()
  // A loopback origin (intercepted, nothing listens there) so the page may reach our local SFU (private network rules).
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--disable-web-security'] })
  const page = await browser.newPage()
  const lk = readFileSync(join(dirname(require.resolve('livekit-client')), 'livekit-client.esm.mjs'))
  await page.route('http://127.0.0.1:7999/**', (route) => {
    const p = new URL(route.request().url()).pathname
    if (p === '/lk.mjs') return route.fulfill({ body: lk, contentType: 'text/javascript' })
    if (p === '/speech.wav') return route.fulfill({ body: readFileSync(speech), contentType: 'audio/wav' })
    return route.fulfill({ contentType: 'text/html', body: "<!doctype html><script type=module>import * as LK from '/lk.mjs'; window.LK = LK; window.ready = true</script>" })
  })
  await page.goto('http://127.0.0.1:7999/')
  await page.waitForFunction(() => window.ready)
  await page.evaluate(async () => {
    const ctx = new AudioContext()
    await ctx.resume()
    const buf = await ctx.decodeAudioData(await (await fetch('/speech.wav')).arrayBuffer())
    window.bots = {}
    window.addBot = async (id, url, token, speak, offset) => {
      const room = new window.LK.Room({ adaptiveStream: false, dynacast: false })
      await room.connect(url, token, { autoSubscribe: false })
      const dest = ctx.createMediaStreamDestination()
      if (speak) {
        const src = ctx.createBufferSource()
        src.buffer = buf
        src.loop = true
        src.connect(dest)
        src.start(0, offset % buf.duration)
      } else {
        const quiet = ctx.createConstantSource()
        quiet.offset.value = 0
        quiet.connect(dest)
        quiet.start()
      }
      await room.localParticipant.publishTrack(dest.stream.getAudioTracks()[0], { source: window.LK.Track.Source.Microphone, dtx: false })
      window.bots[id] = room
    }
    window.dropBot = async (id) => {
      await window.bots[id]?.disconnect()
      delete window.bots[id]
    }
  })
  const add = async (u, channelId, speak = false) => {
    const res = await api(u.token, 'POST', '/voice/join', { channelId })
    await page.evaluate(([id, url, token, sp, off]) => window.addBot(id, url, token, sp, off), [u.me.id, res.url, res.token, speak, Math.random() * 6])
  }
  const drop = (u) => page.evaluate((id) => window.dropBot(id), u.me.id)
  return { add, drop, close: () => browser.close() }
}

/** Face count on A's stage (the bare seats plus live cards). */
const seats = (page) => page.evaluate(() => document.querySelectorAll('[data-seat]').length)
async function waitSeats(page, n, timeout = 30_000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    if ((await seats(page)) >= n) return
    await sleep(200)
  }
  throw new Error(`stage never showed ${n} people`)
}
/** The room's light has settled on someone (opacity 1 and a hue). */
async function waitLight(page, timeout = 15_000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    const ok = await page.evaluate(() => {
      const el = document.querySelector('[class*="_light_"]')
      return !!el && el.style.opacity === '1'
    })
    if (ok) return true
    await sleep(100)
  }
  return false
}

/** A burst of screenshots right after `act`, keeping the frame where `probe` says the motion is mid-way. */
async function midFrame(page, screen, act, probe) {
  await act()
  for (let i = 0; i < 8; i++) {
    const v = await page.evaluate(probe)
    if (v) {
      const p = nextPath(screen)
      await page.screenshot({ path: p })
      shots.push(p)
      console.log('  ✓', p.slice(repo.length + 1), `(${v})`)
      return
    }
  }
  console.warn(`  ${screen}: the motion was too fast to catch mid-way`)
}

// ── v3: the wave-9 screens, from one fixture (seed), real instances in real rooms ──
// V3_PARTS=auth,chat,switcher,stage,crowd,stream,e2ee,unsafe; V3_STACK=<your stack script> (`stop-api`, `start`,
// with NO_DS=1 an API without the E2EE Delivery Service) for the refused DM call.
async function v3Shots(saved) {
  console.log('v3 (wave 9)…')
  const lk = await fetch(`${LK_HTTP}/`).then((r) => r.ok, () => false)
  if (!lk) throw new Error(`LiveKit is not reachable at ${LK_HTTP}`)
  const part = (n) => !process.env.V3_PARTS || process.env.V3_PARTS.split(',').includes(n)
  const U = saved.users
  const media = await demoMedia()

  if (part('auth')) {
    const { app, page } = await launch()
    try {
      await page.getByLabel('E-mail ou nome de usuário').waitFor()
      await sleep(700)
      await park(page, 40, 400)
      await shot(page, 'auth-login')
      await page.getByLabel('E-mail ou nome de usuário').fill('ninguem.aqui')
      await page.getByLabel('Senha', { exact: true }).fill('senha-errada-123')
      await page.getByRole('button', { name: 'Entrar', exact: true }).click()
      await page.getByRole('alert').first().waitFor()
      await page.getByLabel('Senha', { exact: true }).focus()
      await page.getByLabel('Senha', { exact: true }).evaluate((el) => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'A', bubbles: true, modifierCapsLock: true })))
      await page.mouse.move(40, 400)
      await shot(page, 'auth-login-error')
      await resize({ app }, 1920, 1080)
      await sleep(600)
      await shot(page, 'auth-login-1920x1080')
    } finally {
      await close(app)
    }
  }

  const offs = [connectPresence(U.carla.token), connectPresence(U.diego.token, 'idle')]
  const crowd = await ensureCrowd(saved, media)
  const ids = await seed(saved)
  for (const k of ['diego', 'fabio', 'gui']) await apiForm(U[k].token, 'PUT', '/users/@me/avatar', fileForm([media(`avatar-${k}.png`)])).catch(() => undefined)
  await api(U.gui.token, 'POST', `/invites/${saved.inviteCode}`).catch(() => undefined)
  for (const c of crowd) await api(c.token, 'POST', `/invites/${saved.inviteCode}`).catch(() => undefined)
  const { speech, silence } = speechWav()
  const A = await launch({ extra: MEDIA_FLAGS(silence) })
  const B = await launch({ profile: 'shots-b', extra: MEDIA_FLAGS(speech) })
  for (const [n, x] of [['A', A], ['B', B]]) {
    x.page.on('console', (m) => m.type() === 'error' && console.log(`  ${n} console.error:`, m.text().slice(0, 240)))
    x.page.on('pageerror', (e) => console.log(`  ${n} pageerror:`, e.message))
  }
  const bruno = U.bruno.me.id
  let bots = null
  try {
    await login(A.page, U.ana)
    await login(B.page, U.bruno)
    await rail(B.page, /^Estúdio Alga/).click()
    await channels(B.page).getByRole('button', { name: /Sala de foco/ }).click()
    await waitConnected(B.page)

    if (part('chat')) {
      await A.page.getByRole('button', { name: 'Conversas', exact: true }).click()
      await A.page.getByRole('region', { name: 'Agora' }).getByText('Sala de foco').waitFor({ timeout: 15_000 })
      await park(A.page)
      await sleep(600)
      await shot(A.page, 'home-agora')
      await rail(A.page, /^Estúdio Alga/).click()
      await channels(A.page).getByRole('button', { name: /^geral/ }).click()
      await A.page.getByText('Eu topo testar também').waitFor()
      await park(A.page)
      await sleep(700)
      await shot(A.page, 'chat-channel')
      await A.page.getByRole('log').getByRole('button', { name: 'Ana Ribeiro', exact: true }).first().click()
      await A.page.getByRole('dialog', { name: 'Ana Ribeiro' }).waitFor()
      await sleep(1200)
      await shot(A.page, 'profile-owner-chip')
      await A.page.keyboard.press('Escape')
      await A.page.getByLabel('Membros').getByRole('button', { name: /Bruno Costa/ }).click()
      await A.page.getByRole('dialog', { name: 'Bruno Costa' }).waitFor()
      await sleep(1300)
      await shot(A.page, 'profile-person-hue')
      await A.page.keyboard.press('Escape')
    }

    if (part('switcher')) {
      await park(A.page)
      await midFrame(A.page, 'switcher-grow', () => A.page.keyboard.press('Control+K'), () => {
        const w = document.querySelector('[role="dialog"][aria-label="Ir para"]')?.getBoundingClientRect().width ?? 0
        return w > 430 && w < 590 ? `${Math.round(w)} px wide` : null
      })
      await sleep(400)
      await shot(A.page, 'switcher-open')
      await A.page.keyboard.type('sala')
      await sleep(300)
      await shot(A.page, 'switcher-query-actions')
      await A.page.keyboard.press('Escape')
      await sleep(300)
    }

    if (part('stage')) {
      // One person: Ana alone in Sala de jogo.
      await rail(A.page, /^Estúdio Alga/).click()
      await channels(A.page).getByRole('button', { name: /Sala de jogo/ }).click()
      await waitConnected(A.page)
      await sleep(1400)
      await park(A.page)
      await shot(A.page, 'voice-stage-1')
      // Two: Ana joins Bruno; the faces come in one after the other (the burst keeps a mid-way frame).
      await midFrame(A.page, 'voice-join-choreography', () => channels(A.page).getByRole('button', { name: /Sala de foco/ }).click(), () => {
        const op = [...document.querySelectorAll('[class*="_appear_"]')].map((e) => Number(getComputedStyle(e).opacity))
        return op.length >= 2 && op.some((o) => o > 0.05 && o < 0.95) ? `opacity ${op.map((o) => o.toFixed(2)).join(' / ')}` : null
      })
      await waitConnected(A.page)
      await sleep(1500)
      console.log(`  bruno --speak at capture: ${(await waitSpeaking(A.page, bruno, 0.45)).toFixed(2)}`)
      await waitLight(A.page)
      await park(A.page)
      await shot(A.page, 'voice-stage-2')
      await waitSpeaking(B.page, bruno, 0.3)
      await park(B.page)
      await shot(B.page, 'voice-stage-2-self-speaking')
      await dock(A.page).getByRole('button', { name: 'Desativar microfone' }).click()
      await sleep(900)
      await park(A.page)
      await shot(A.page, 'voice-self-muted')
      await dock(A.page).getByRole('button', { name: 'Ativar microfone' }).click()
      // In a call, Ctrl K offers the call's actions first.
      await A.page.keyboard.press('Control+K')
      await sleep(500)
      await shot(A.page, 'switcher-in-call')
      await A.page.keyboard.press('Escape')
    }

    if (part('crowd')) {
      bots = await startCrowd()
      const counts = [3, 5, 8, 12]
      let added = 0
      for (const n of counts) {
        while (added < n - 2) {
          // Two of them talk (the light moves between real voices); the rest listen with an open mic.
          await bots.add(crowd[added], ids.focus.id, added === 2 || added === 7)
          added++
        }
        await waitSeats(A.page, n)
        await sleep(2500)
        await waitLight(A.page)
        await park(A.page)
        await shot(A.page, `voice-stage-${n}`)
      }
      await resize(A, 1920, 1080)
      await sleep(1800)
      await park(A.page)
      await shot(A.page, 'voice-stage-12-1920x1080')
      await resize(A, 1320, 840)
      for (const c of crowd.slice(5)) await bots.drop(c)
      await sleep(2500)
      await resize(A, 960, 600)
      await sleep(1500)
      await park(A.page)
      await shot(A.page, 'voice-stage-5-960x600')
      await resize(A, 1320, 840)
      for (const c of crowd.slice(0, 5)) await bots.drop(c)
      await sleep(2000)
    }

    if (part('stream')) {
      // Carla shares from a third instance WITHOUT fake devices (they would swap the capture for Chromium's synthetic
      // screen) and WITHOUT a microphone: the harness denies audio capture there, so nothing from this machine's mic
      // ever reaches the call. Her screen is the procedural editor, full screen on top while it is captured.
      const C = await launch({ profile: 'shots-c', extra: ['--disable-features=CalculateNativeWinOcclusion', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'] })
      await C.app.evaluate(({ session }) => {
        const audio = (details) => (details?.mediaTypes ?? []).includes('audio') || details?.mediaType === 'audio'
        session.defaultSession.setPermissionRequestHandler((_wc, perm, cb, details) => cb(!(perm === 'media' && audio(details))))
        session.defaultSession.setPermissionCheckHandler((_wc, perm, _origin, details) => !(perm === 'media' && audio(details)))
      })
      try {
        await login(C.page, U.carla)
        await rail(C.page, /^Estúdio Alga/).click()
        await channels(C.page).getByRole('button', { name: /Sala de foco/ }).click()
        await waitConnected(C.page)
        await startScene(C.app)
        await dock(C.page).getByRole('button', { name: 'Compartilhar tela' }).click()
        const picker = C.page.getByRole('dialog', { name: 'Compartilhar tela' })
        await picker.waitFor()
        await picker.locator('img').first().waitFor({ timeout: 20_000 })
        await sleep(1800)
        await shot(C.page, 'screen-picker')
        await picker.getByRole('button', { name: 'Transmitir' }).click()
        await picker.waitFor({ state: 'detached', timeout: 15_000 })
        await C.page.getByText('Você está transmitindo').first().waitFor()
        await sleep(3500)
        await park(C.page)
        await shot(C.page, 'screen-sharing-self')
        await A.page.getByRole('button', { name: 'Assistir' }).first().waitFor({ timeout: 15_000 })
        await park(A.page)
        await sleep(800)
        await shot(A.page, 'stream-card-unwatched')
        await A.page.getByRole('button', { name: 'Assistir' }).first().click()
        await hasVideo(A.page)
        await sleep(3500)
        await park(A.page, 10, 400)
        await shot(A.page, 'stream-watching')
      } finally {
        await stopScene(C.app)
        await C.page.getByRole('button', { name: 'Desconectar' }).first().click().catch(() => undefined)
        await sleep(600)
        await close(C.app)
      }
      await sleep(800)
    }

    if (part('e2ee')) {
      for (const x of [A, B]) await x.page.getByRole('button', { name: 'Desconectar' }).first().click().catch(() => undefined)
      await sleep(1200)
      // DM call: always end-to-end encrypted. The lock sits at the top of the DM stage; it opens the codes.
      await A.page.getByRole('button', { name: 'Conversas', exact: true }).click()
      await A.page.getByRole('button', { name: /Bruno Costa/ }).first().click()
      await A.page.getByRole('button', { name: 'Iniciar chamada de voz' }).click()
      await B.page.getByRole('alertdialog').waitFor({ timeout: 20_000 })
      await B.page.getByRole('button', { name: 'Atender' }).click()
      await waitConnected(B.page)
      const lock = A.page.getByRole('button', { name: 'Criptografia de ponta a ponta' })
      await lock.waitFor({ timeout: 20_000 })
      await sleep(1500)
      await waitSpeaking(A.page, bruno, 0.4)
      await park(A.page)
      await shot(A.page, 'dm-call-e2ee')
      await lock.click()
      const sheet = A.page.getByRole('dialog', { name: 'Verificar a criptografia' })
      await sheet.waitFor()
      await sheet.getByRole('button', { name: 'Ver código' }).first().click()
      // Both codes computed (the pairwise one runs a slow KDF in main, once per pair).
      await A.page.waitForFunction(() => !document.querySelector('[role="dialog"]')?.textContent?.includes('Calculando'), null, { timeout: 30_000 }).catch(() => undefined)
      await sleep(500)
      await park(A.page, 40, 400)
      await shot(A.page, 'e2ee-verify-sheet')
      await sheet.getByRole('button', { name: 'Fechar' }).click()
      await sheet.waitFor({ state: 'detached' })
      for (const x of [A, B]) await x.page.getByRole('button', { name: 'Desconectar' }).first().click().catch(() => undefined)
      await sleep(1500)
      // A space room with E2EE on, then someone in the SFU without keys: the red band.
      await api(U.ana.token, 'PATCH', `/spaces/${ids.s1.id}`, { e2ee: true })
      await rail(A.page, /^Estúdio Alga/).click()
      await channels(A.page).getByRole('button', { name: /Sala de foco/ }).click()
      await rail(B.page, /^Estúdio Alga/).click()
      await channels(B.page).getByRole('button', { name: /Sala de foco/ }).click()
      await A.page.getByRole('button', { name: 'Criptografia de ponta a ponta' }).waitFor({ timeout: 25_000 })
      await sleep(2000)
      await park(A.page)
      await shot(A.page, 'voice-stage-e2ee')
      bots ??= await startCrowd()
      await bots.add(crowd[0], ids.focus.id, false)
      await A.page.getByRole('alert').filter({ hasText: 'não conseguimos verificar' }).waitFor({ timeout: 20_000 })
      await sleep(800)
      await park(A.page)
      await shot(A.page, 'e2ee-mismatch')
      await bots.drop(crowd[0])
      await api(U.ana.token, 'PATCH', `/spaces/${ids.s1.id}`, { e2ee: false })
      await sleep(2500)
    }

    if (part('unsafe') && process.env.V3_STACK) {
      // A server without the Delivery Service offers DM calls without E2EE: the client refuses before connecting.
      for (const x of [A, B]) await x.page.getByRole('button', { name: 'Desconectar' }).first().click().catch(() => undefined)
      spawnSync(process.execPath, [process.env.V3_STACK, 'stop-api'], { stdio: 'inherit' })
      spawnSync(process.execPath, [process.env.V3_STACK, 'start'], { stdio: 'inherit', env: { ...process.env, NO_DS: '1' } })
      try {
        await A.page.getByRole('navigation', { name: 'Espaços' }).waitFor()
        await sleep(4000)
        await A.page.getByRole('button', { name: 'Conversas', exact: true }).click()
        await A.page.getByRole('button', { name: /Bruno Costa/ }).first().click()
        await A.page.getByRole('button', { name: 'Iniciar chamada de voz' }).click()
        await A.page.getByRole('dialog', { name: /Chamada sem criptografia recusada/ }).waitFor({ timeout: 20_000 })
        await sleep(500)
        await park(A.page, 40, 400)
        await shot(A.page, 'dm-call-unsafe-refused')
        await A.page.keyboard.press('Escape')
      } finally {
        spawnSync(process.execPath, [process.env.V3_STACK, 'stop-api'], { stdio: 'inherit' })
        spawnSync(process.execPath, [process.env.V3_STACK, 'start'], { stdio: 'inherit' })
      }
    }
  } catch (e) {
    await A.page.screenshot({ path: join(work, 'fail-a.png') }).catch(() => undefined)
    await B.page.screenshot({ path: join(work, 'fail-b.png') }).catch(() => undefined)
    throw e
  } finally {
    await bots?.close().catch(() => undefined)
    await stopScene(A.app)
    for (const x of [A, B]) await x.page.getByRole('button', { name: 'Desconectar' }).first().click().catch(() => undefined)
    await close(A.app)
    await close(B.app)
    offs.forEach((off) => off())
  }
}

// ── main ──────────────────────────────────────────────────────
if (!args.includes('--skip-build')) {
  console.log('building…')
  execSync(`npx electron-vite build${SHOTS_OUT ? ` --outDir "${SHOTS_OUT}"` : ''}`, { cwd: appDir, stdio: 'inherit' })
  if (SHOTS_OUT) {
    writeFileSync(join(SHOTS_OUT, 'package.json'), JSON.stringify({ name: '@alga/desktop', productName: 'Alga Meet', version: '0.1.0', main: './main/index.js' }, null, 2))
    cpSync(join(appDir, 'build', 'runtime'), join(SHOTS_OUT, 'build', 'runtime'), { recursive: true })
  }
}
let serverUp = false
try {
  serverUp = (await api(null, 'GET', '/health'))?.ok === true
} catch {
  serverUp = false
}
if (want('auth')) await authShots(serverUp)
if (!serverUp) console.warn(`API at ${API} is not reachable: only auth screens were captured.`)
if (serverUp && ['auth', 'home', 'chat', 'spaces', 'attachments', 'uploads', 'spacesettings', 'connection', 'sizes', 'settings', 'voice', 'billing', 'invites'].some(want)) {
  const saved = await ensureUsers()
  await mainShots(saved)
}
if (serverUp && only?.includes('r3')) await r3Shots(await ensureUsers())
if (serverUp && only?.includes('v3')) await v3Shots(await ensureUsers())
if (serverUp && want('trust')) await trustShots()
if (serverUp && want('wave6')) await wave6Shots()
console.log(`\n${shots.length} screenshots.`)
