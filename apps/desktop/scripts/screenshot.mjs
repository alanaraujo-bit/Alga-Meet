// Visual validation loop: build → seed real data through the REST API → drive the REAL Electron app → PNGs.
//   node scripts/screenshot.mjs [--skip-build] [--only=auth,home,chat,spaces,attachments,uploads,spacesettings,connection,sizes,settings,voice,billing,invites,trust]
// Another API (ALGA_API_URL=http://127.0.0.1:4100) gets its own users file, so runs never mix accounts.
// Voice runs two real app instances (profiles shots + shots-b) through the local LiveKit with Chromium fake
// devices: a generated speech WAV is B's microphone (so the speaking glow moves for real) and A's screen share
// is Chromium's fake desktop source (real WebRTC encode → SFU → decode, synthetic picture). Needs LiveKit on
// :7880; pass LIVEKIT_PID (a LiveKit *you* started) to also capture the reconnecting state.
// Output: docs/screenshots/<YYYY-MM-DD>-<screen>-v<n>.png (earlier versions are kept).
// Test users (generated credentials) live in scripts/.shots-users.json (git-ignored).
import { execSync, spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer, connect } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'

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

// ── output naming ─────────────────────────────────────────────
mkdirSync(outDir, { recursive: true })
const existing = readdirSync(outDir)
function nextPath(screen) {
  const re = new RegExp(`^${today}-${screen}-v(\\d+)\\.png$`)
  const n = Math.max(0, ...existing.map((f) => Number(re.exec(f)?.[1] ?? 0))) + 1
  return join(outDir, `${today}-${screen}-v${n}.png`)
}
const shots = []
async function shot(page, screen) {
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
    const suffix = randomBytes(2).toString('hex')
    const username = `${key}.${suffix}`
    const password = randomBytes(12).toString('base64url')
    const r = await api(null, 'POST', '/auth/register', { email: `${username}@shots.alga.test`, username, displayName, password, birthDate: ADULT_BIRTH, termsVersion: await termsVersion() })
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

  // Wave 3: real uploads (synthetic media from ffmpeg), roles, a nickname, people to moderate.
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
  const coord = await role({ name: 'Coordenação', color: '#f2c25c', permissions: P.ROLES | P.KICK | P.BAN | P.NICKS | P.MUTE | P.DEAFEN | P.MOVE | P.MESSAGES | P.CHANNELS | P.INVITES })
  const mod = await role({ name: 'Moderação', color: '#7fd88f', permissions: P.ROLES | P.KICK | P.NICKS | P.MUTE | P.MESSAGES | P.INVITES })
  const des = await role({ name: 'Design', color: '#ef87c4' })
  await role({ name: 'Convidados', color: '#a7b0b4' })
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
  const profileDir = join(process.env.APPDATA ?? '', 'Alga Meet', 'profiles', profile)
  if (!keepProfile) rmSync(profileDir, { recursive: true, force: true })
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RENDERER_URL'))
  if (apiUrl) env.ALGA_API_URL = apiUrl
  const app = await electron.launch({
    executablePath: electronPath,
    args: [appDir, `--profile=${profile}`, ...(scale ? [`--force-device-scale-factor=${scale}`] : []), ...extra],
    cwd: appDir,
    env,
  })
  const page = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }, [w, h]) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.setContentSize(w, h)
    win.center()
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
  await page.locator('button[aria-haspopup="dialog"]').filter({ hasText: 'Ana Ribeiro' }).click()
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

/** Synthetic media for uploads (ffmpeg test sources): never files from this machine. */
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
  const lk = await fetch('http://127.0.0.1:7880/').then((r) => r.ok, () => false)
  if (!lk) return console.warn('LiveKit is not running on :7880: voice screens skipped.')
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
    await page.getByRole('dialog', { name: 'Caio Freitas' }).getByRole('button', { name: 'Denunciar' }).waitFor()
    await sleep(400)
    await shot(page, 'profile-popover-report')
    await page.getByRole('dialog', { name: 'Caio Freitas' }).getByRole('button', { name: 'Denunciar' }).click()
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

// ── main ──────────────────────────────────────────────────────
if (!args.includes('--skip-build')) {
  console.log('building…')
  execSync('npx electron-vite build', { cwd: appDir, stdio: 'inherit' })
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
if (serverUp && want('trust')) await trustShots()
console.log(`\n${shots.length} screenshots.`)
