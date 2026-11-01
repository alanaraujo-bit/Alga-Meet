// Visual validation loop: build → seed real data through the REST API → drive the REAL Electron app → PNGs.
//   node scripts/screenshot.mjs [--skip-build] [--only=auth,home,chat,spaces,connection,sizes,settings,voice]
// Voice runs two real app instances (profiles shots + shots-b) through the local LiveKit with Chromium fake
// devices: a generated speech WAV is B's microphone (so the speaking glow moves for real) and A's screen share
// is Chromium's fake desktop source (real WebRTC encode → SFU → decode, synthetic picture). Needs LiveKit on
// :7880; pass LIVEKIT_PID (a LiveKit *you* started) to also capture the reconnecting state.
// Output: docs/screenshots/<YYYY-MM-DD>-<screen>-v<n>.png (earlier versions are kept).
// Test users (generated credentials) live in scripts/.shots-users.json (git-ignored).
import { execSync, spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer, connect } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'

const here = dirname(fileURLToPath(import.meta.url))
const appDir = join(here, '..')
const repo = join(appDir, '..', '..')
const outDir = join(repo, 'docs', 'screenshots')
const usersFile = join(here, '.shots-users.json')
const API = process.env.ALGA_API_URL ?? 'http://localhost:4000'
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

const PEOPLE = [
  ['ana', 'Ana Ribeiro'],
  ['bruno', 'Bruno Costa'],
  ['carla', 'Carla Mendes'],
  ['diego', 'Diego Alves'],
  ['elisa', 'Elisa Nogueira'],
  ['fabio', 'Fábio Lima'],
  ['gui', 'Guilherme Rocha'],
]

async function ensureUsers() {
  const saved = existsSync(usersFile) ? JSON.parse(readFileSync(usersFile, 'utf8')) : { users: {} }
  for (const [key, displayName] of PEOPLE) {
    let u = saved.users[key]
    if (u?.token) {
      try {
        u.me = await api(u.token, 'GET', '/users/@me')
        continue
      } catch {
        /* token expired: log in again */
      }
    }
    if (u) {
      const r = await api(null, 'POST', '/auth/login', { login: u.username, password: u.password })
      Object.assign(u, { token: r.token, me: r.user })
      continue
    }
    const suffix = randomBytes(2).toString('hex')
    const username = `${key}.${suffix}`
    const password = randomBytes(12).toString('base64url')
    const r = await api(null, 'POST', '/auth/register', { email: `${username}@shots.alga.test`, username, displayName, password })
    saved.users[key] = { username, password, token: r.token, me: r.user }
    writeFileSync(usersFile, JSON.stringify(saved, null, 2))
  }
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

  writeFileSync(usersFile, JSON.stringify(saved, null, 2))
  return { s1, s2, geral, design, dmB, dmC, focus, jogo }
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
  await page.getByLabel('Senha', { exact: true }).fill(randomBytes(12).toString('base64url'))
  await page.getByRole('button', { name: 'Criar conta' }).click()
  await page.getByText('Boas-vindas, Marina').waitFor({ timeout: 20_000 })
  await shot(page, 'onboarding')
  await page.getByRole('button', { name: /Criar um espaço/ }).click()
  await page.getByRole('dialog').waitFor()
  await shot(page, 'onboarding-create-space')
  await close(app)
}

async function mainShots(saved) {
  const offs = [connectPresence(saved.users.bruno.token), connectPresence(saved.users.carla.token), connectPresence(saved.users.diego.token, 'idle')]
  try {
    const ids = await seed(saved)
    if (want('home') || want('chat') || want('spaces')) {
      console.log('shell…')
      const { app, page } = await launch()
      await login(page, saved.users.ana)
      if (want('home')) await homeShots(page)
      if (want('chat')) await chatShots(page, saved, ids)
      if (want('spaces')) await spaceShots(page, saved)
      await close(app)
    }
    if (want('settings')) await settingsShots(saved, ids)
    if (want('voice')) await voiceShots(saved, ids)
    if (want('connection')) await connectionShots(saved, ids)
    if (want('sizes')) await sizeShots(saved)
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
  await shot(page, 'settings-account')
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
  const state = { delayMs: 0 }
  const server = createServer((client) => {
    const upstream = connect(Number(target.port || 80), target.hostname)
    sockets.add(client).add(upstream)
    client.on('data', (b) => setTimeout(() => upstream.write(b), state.delayMs))
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
if (serverUp && ['home', 'chat', 'spaces', 'connection', 'sizes', 'settings', 'voice'].some(want)) {
  const saved = await ensureUsers()
  await mainShots(saved)
} else console.warn(`API at ${API} is not reachable: only auth screens were captured.`)
console.log(`\n${shots.length} screenshots.`)
