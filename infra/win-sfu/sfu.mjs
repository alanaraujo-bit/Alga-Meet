// Supervisor of the Windows-native SFU (README.md). One process, started at boot by a scheduled task, that does what
// the five containers of infra/home-sfu did on the Linux server, minus coturn (no Windows build):
//   - keeps livekit-server.exe and caddy.exe running (restart with backoff, logs rotated at 10 MB x 3)
//   - DuckDNS: A record = public IPv4, every 5 min
//   - UPnP: asks the router to forward the public ports to this PC, renews the 1 h lease every 20 min
//   - IP watch: LiveKit learns the public IP only at startup, so it is restarted when the IP changes
// Run from its own folder (install.ps1 puts it in C:\ProgramData\AlgaMeetSFU):  bin\node.exe sfu.mjs
// Secrets come from .env next to this file and are never logged. run\state.json (no secrets) is what doctor.mjs reads.
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PUBLIC_PORTS, UPNP_NAME, addMapping, checkEnv, deleteMapping, findIgd, findMapping, gatewayIPv4, lanIPv4, listMappings, publicIPv4, readEnv, routerWanIp, sleep } from './lib.mjs'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const P = (...a) => path.join(DIR, ...a)
for (const d of ['run', 'logs', 'data', 'control']) fs.mkdirSync(P(d), { recursive: true })

// --- Logs ---------------------------------------------------------------------------------------------------------
const MAX_LOG = 10 * 1024 * 1024
function logFile(name) {
  const file = P('logs', `${name}.log`)
  let size = 0
  try { size = fs.statSync(file).size } catch {}
  return (text) => {
    if (size + text.length > MAX_LOG) {   // without rotation the logs grow until the disk is full
      for (const i of [2, 1]) { try { fs.renameSync(`${file}.${i}`, `${file}.${i + 1}`) } catch {} }
      try { fs.renameSync(file, `${file}.1`) } catch {}
      size = 0
    }
    try { fs.appendFileSync(file, text); size += Buffer.byteLength(text) } catch {}
  }
}
const sfuLog = logFile('sfu')
const log = (msg) => { const line = `${new Date().toISOString()} ${msg}\n`; sfuLog(line); try { process.stdout.write(line) } catch {} }
// The task has no console anyone reads: a crash must leave its reason in the log. An end with no line at all below
// means the process was killed from outside (task stopped, session closed), not that it failed.
process.stdout.on('error', () => {})
process.on('uncaughtException', (e) => { log(`ERRO fatal: ${e.stack ?? e}`); process.exit(1) })
process.on('unhandledRejection', (e) => { log(`ERRO fatal (promessa): ${e?.stack ?? e}`); process.exit(1) })
process.on('exit', (code) => sfuLog(`${new Date().toISOString()} supervisor: fim do processo (código ${code})\n`))

// --- .env ---------------------------------------------------------------------------------------------------------
let env, cfg
try { env = readEnv(P('.env')); cfg = checkEnv(env) } catch (e) { log(`ERRO no .env: ${e.message}`); process.exit(2) }

const state = {
  startedAt: new Date().toISOString(), pid: process.pid, domain: cfg.domain, api: cfg.api, dryRun: cfg.dry,
  lanIp: null, gateway: null, publicIp: null, routerWanIp: null,
  livekit: { restarts: 0 }, caddy: { restarts: 0 }, duckdns: {}, upnp: { enabled: cfg.upnp },
}
function saveState() {
  state.savedAt = new Date().toISOString()
  try { fs.writeFileSync(P('run', 'state.json.tmp'), JSON.stringify(state, null, 2)); fs.renameSync(P('run', 'state.json.tmp'), P('run', 'state.json')) } catch {}
}

// --- Configs ------------------------------------------------------------------------------------------------------
function render() {
  const fill = (s) => s.replaceAll('<DOMAIN>', cfg.domain).replaceAll('<API_KEY>', cfg.key).replaceAll('<API_URL>', cfg.api)
    .replaceAll('<LAN_IP>', state.lanIp).replaceAll('<DATA>', P('data', 'caddy').replaceAll('\\', '/'))
  const lk = fill(fs.readFileSync(P('livekit.win.yaml'), 'utf8'))
  const cd = fill(fs.readFileSync(P('caddy.win.json'), 'utf8'))
  const left = /<[A-Z_]+>/.exec(lk + cd)
  if (left) throw new Error(`placeholder sobrando nas configs: ${left[0]}`)
  const caddy = JSON.parse(cd)
  if (cfg.dry) {
    // DRY_RUN=1 (local test): certificates from Caddy's own CA, nothing asked from Let's Encrypt, no trust-store prompt.
    caddy.apps.tls.automation = { policies: [{ subjects: [cfg.domain, `turn.${cfg.domain}`], issuers: [{ module: 'internal' }] }] }
    caddy.apps.pki = { certificate_authorities: { local: { install_trust: false } } }
  }
  fs.writeFileSync(P('run', 'livekit.yaml'), lk)
  fs.writeFileSync(P('run', 'caddy.json'), JSON.stringify(caddy, null, 2))
}

// --- Child processes ----------------------------------------------------------------------------------------------
const pids = {}
class Proc {
  constructor(name, image, args, extraEnv, onLine) {
    Object.assign(this, { name, image, args, extraEnv, onLine, wanted: true, child: null, delay: 1000, quick: false })
    this.out = logFile(name)
  }
  start() {
    if (this.child || !this.wanted) return
    this.startedAt = Date.now()
    this.pubAtStart = state.publicIp
    const child = spawn(P('bin', this.image), this.args, { cwd: DIR, env: { ...process.env, ...this.extraEnv }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    this.child = child
    let buf = '', ended = false
    const feed = (d) => {
      this.out(d)
      if (!this.onLine) return
      buf += d
      for (let i; (i = buf.indexOf('\n')) >= 0; buf = buf.slice(i + 1)) this.onLine(buf.slice(0, i))
    }
    child.stdout.setEncoding('utf8').on('data', feed)
    child.stderr.setEncoding('utf8').on('data', feed)
    const end = (why) => {
      if (ended) return
      ended = true
      this.child = null
      state[this.name].pid = null
      if (!this.wanted) return
      const ran = Date.now() - this.startedAt
      this.delay = this.quick ? 1000 : ran > 60_000 ? 2000 : Math.min(this.delay * 2, 60_000)
      this.quick = false
      state[this.name].restarts++
      log(`${this.name}: saiu (${why}) depois de ${Math.round(ran / 1000)} s; sobe de novo em ${this.delay / 1000} s`)
      saveState()
      this.timer = setTimeout(() => this.start(), this.delay)
    }
    child.on('error', (e) => end(`não iniciou: ${e.code ?? e.message}`))
    child.on('close', (code, sig) => end(`código ${code ?? sig}`))
    if (child.pid) {
      pids[this.image] = child.pid
      try { fs.writeFileSync(P('run', 'pids.json'), JSON.stringify(pids)) } catch {}
      Object.assign(state[this.name], { pid: child.pid, startedAt: new Date().toISOString() })
      log(`${this.name}: iniciado (pid ${child.pid})`)
    }
    saveState()
  }
  restart(reason) {
    log(`${this.name}: reiniciando (${reason})`)
    if (this.child) { this.quick = true; this.child.kill() } else { clearTimeout(this.timer); this.start() }
  }
  stop() { this.wanted = false; clearTimeout(this.timer); this.child?.kill() }
}

// A supervisor killed the hard way (task stopped, crash) can leave its children holding the ports.
function killStale() {
  let old = {}
  try { old = JSON.parse(fs.readFileSync(P('run', 'pids.json'), 'utf8')) } catch { return }
  for (const [image, pid] of Object.entries(old)) {
    if (!Number.isInteger(pid)) continue
    try {
      const row = execFileSync('tasklist.exe', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'latin1', windowsHide: true })
      if (!row.toLowerCase().includes(`"${image.toLowerCase()}"`)) continue
      execFileSync('taskkill.exe', ['/PID', String(pid), '/F'], { stdio: 'ignore', windowsHide: true })
      log(`processo que sobrou da execução anterior encerrado: ${image} (pid ${pid})`)
    } catch {}
  }
}

const livekit = new Proc('livekit', 'livekit-server.exe', ['--config', P('run', 'livekit.yaml')],
  { LIVEKIT_KEYS: `${env.LIVEKIT_API_KEY}: ${env.LIVEKIT_API_SECRET}` },
  (line) => {
    // Startup line: starting LiveKit server {..., "nodeIP": "x.x.x.x", ...}
    const ip = /"nodeIP":\s*"([^"]*)"/.exec(line)?.[1]
    if (ip) { state.livekit.nodeIP = ip; log(`livekit: anuncia o IP ${ip}`); saveState() }
  })
const caddy = new Proc('caddy', 'caddy.exe', ['run', '--config', P('run', 'caddy.json')],
  { XDG_DATA_HOME: P('data'), XDG_CONFIG_HOME: P('data', 'config'), HOME: P('data') })

// --- DuckDNS ------------------------------------------------------------------------------------------------------
async function duckdns() {
  if (cfg.dry) { state.duckdns = { skipped: 'DRY_RUN' }; return }
  if (!env.DUCKDNS_TOKEN) {
    if (!state.duckdns.skipped) log('duckdns: sem DUCKDNS_TOKEN no .env, o DNS NAO é atualizado. Funciona enquanto o IP público não mudar.')
    state.duckdns = { skipped: 'sem DUCKDNS_TOKEN' }
    return
  }
  // The token goes in the URL (DuckDNS's API); nothing derived from this URL or from a fetch error is ever logged.
  const url = `https://www.duckdns.org/update?domains=${cfg.sub}&token=${env.DUCKDNS_TOKEN}&verbose=true${state.publicIp ? `&ip=${state.publicIp}` : ''}`
  let result
  try { result = (await (await fetch(url, { signal: AbortSignal.timeout(20_000) })).text()).trim().split(/\s+/).join(' ') }
  catch (e) { result = `KO (${e.cause?.code ?? e.name})` }
  const ok = result.startsWith('OK')
  if (result !== state.duckdns.result) log(`duckdns: ${ok ? result : `FALHA: ${result} (subdomínio ou token errado no .env?)`}`)
  state.duckdns = { at: new Date().toISOString(), result, ok, lastOk: ok ? new Date().toISOString() : state.duckdns.lastOk }
}

// --- UPnP ---------------------------------------------------------------------------------------------------------
let mine = []        // only what this run mapped is ever deleted
let lastUpnp = ''
// LAN addresses this PC had before (previous run, or before a DHCP change): a forwarding to one of them is our own,
// stale, and would otherwise block the port until its 1 h lease runs out.
const formerLanIps = new Set()
try { const prev = JSON.parse(fs.readFileSync(P('run', 'state.json'), 'utf8')).lanIp; if (prev) formerLanIps.add(prev) } catch {}
async function upnp() {
  if (!cfg.upnp) return true
  const at = new Date().toISOString()
  const igd = await findIgd(state.lanIp, state.gateway)
  if (!igd) {
    state.upnp = { enabled: true, at, ok: false, error: 'o roteador não respondeu por UPnP (ligue o UPnP nele, ou encaminhe as portas à mão e ponha UPNP=0 no .env)' }
    if (lastUpnp !== 'no-igd') log(`upnp: ${state.upnp.error}`)
    lastUpnp = 'no-igd'
    return false
  }
  state.routerWanIp = await routerWanIp(igd)
  const mapped = [], held = [], failed = []
  const table = await listMappings(igd)
  for (const [port, proto] of PUBLIC_PORTS) {
    let cur = findMapping(table, port, proto)
    if (cur && cur.client !== state.lanIp && cur.name === UPNP_NAME && formerLanIps.has(cur.client) && await deleteMapping(igd, port, proto)) cur = null
    // Never steal a port forwarded to another machine: while the old server is up it owns these mappings, and
    // taking them would cut the calls on it. `router.mjs takeover` (install.ps1) removes them when the owner says so.
    if (cur && cur.client !== state.lanIp) { held.push({ port, proto, client: cur.client, name: cur.name }); continue }
    const r = await addMapping(igd, port, proto, state.lanIp)
    if (r.ok) mapped.push(`${port}/${proto}`); else failed.push({ port, proto, code: r.code })
  }
  mine = mapped
  const ok = mapped.length === PUBLIC_PORTS.length
  state.upnp = { enabled: true, at, ok, mapped, held, failed }
  const summary = `${mapped.length}/${PUBLIC_PORTS.length} portas encaminhadas para ${state.lanIp}`
    + (held.length ? `; em uso por outra máquina: ${held.map((h) => `${h.port}/${h.proto} -> ${h.client}`).join(', ')}` : '')
    + (failed.length ? `; recusadas pelo roteador: ${failed.map((f) => `${f.port}/${f.proto} (erro ${f.code})`).join(', ')}` : '')
  if (summary !== lastUpnp) log(`upnp: ${summary}`)
  lastUpnp = summary
  return ok
}
// Caddy asks Let's Encrypt for certificates as soon as it starts, and Let's Encrypt allows only 5 failed checks per
// name per hour. While 80 and 443 still reach another machine every attempt fails, so Caddy waits for them.
const webPortsHere = () => !cfg.upnp || ['80/TCP', '443/TCP'].every((p) => state.upnp.mapped?.includes(p))
let caddyHeld = false
function startCaddyWhenReachable() {
  if (caddy.child || caddy.timer) return
  if (webPortsHere()) { if (caddyHeld) log('caddy: as portas 80 e 443 chegaram a este PC'); caddyHeld = false; caddy.start(); return }
  if (!caddyHeld) log('caddy: esperando as portas 80 e 443 chegarem a este PC antes de pedir certificados')
  caddyHeld = true
}
let upnpWake = () => {}
async function upnpLoop() {
  for (;;) {
    const ok = await upnp().catch((e) => { log(`upnp: erro ${e.message}`); return false })
    startCaddyWhenReachable()
    saveState()
    await Promise.race([sleep(ok ? 20 * 60_000 : 60_000), new Promise((r) => { upnpWake = r })])
  }
}

// --- IP watch -----------------------------------------------------------------------------------------------------
let ipRestarts = 0
async function watchIp() {
  const lan = await lanIPv4()
  if (lan && lan !== state.lanIp) {
    log(`rede: IP local mudou de ${state.lanIp} para ${lan}`)
    formerLanIps.add(state.lanIp)
    formerLanIps.delete(lan)
    state.lanIp = lan
    state.gateway = gatewayIPv4(lan)
    render()
    livekit.restart('IP local mudou')
    upnpWake()
  }
  const pub = await publicIPv4()
  if (!pub) return   // offline or odd answer: next run decides
  if (pub !== state.publicIp) {
    if (state.publicIp) log(`rede: IP público mudou de ${state.publicIp} para ${pub}`)
    state.publicIp = pub
    await duckdns()
  }
  // What LiveKit told the world at startup; when the line was not seen, the public IP it started under.
  const advertised = state.livekit.nodeIP ?? livekit.pubAtStart
  if (!advertised || advertised === pub) { ipRestarts = 0; return }
  if (!livekit.child || Date.now() - livekit.startedAt < 120_000) return   // just (re)started: STUN may not have answered yet
  // A restart drops every call. If STUN keeps giving another address, three tries are enough to know it is not a race.
  if (ipRestarts >= 3) return
  ipRestarts++
  state.livekit.nodeIP = undefined
  livekit.restart(`anunciava ${advertised}, o IP público é ${pub}`)
}

// --- Main ---------------------------------------------------------------------------------------------------------
log(`supervisor iniciado (pid ${process.pid}) para ${cfg.domain}${cfg.dry ? ' em DRY_RUN: sem DuckDNS, sem UPnP, sem Let\'s Encrypt' : ''}`)
killStale()
for (let warned = false; !(state.lanIp = await lanIPv4()); await sleep(5000)) {
  if (!warned) log('rede: sem rota para a internet ainda (boot?); esperando')
  warned = true
}
state.gateway = gatewayIPv4(state.lanIp)
state.publicIp = await publicIPv4()
log(`rede: IP local ${state.lanIp}, roteador ${state.gateway ?? '?'}, IP público ${state.publicIp ?? '?'}`)
render()
// DNS and port 80/443 first (bounded), so Caddy's first Let's Encrypt attempt can already succeed.
await Promise.race([Promise.all([duckdns(), upnp().catch(() => false)]), sleep(20_000)])
saveState()
livekit.start()
startCaddyWhenReachable()

upnpLoop()
setInterval(() => duckdns().then(saveState), 5 * 60_000)
setInterval(() => watchIp().then(saveState).catch((e) => log(`ipwatch: erro ${e.message}`)), 5 * 60_000)
setInterval(saveState, 30_000)
// A file dropped in control\ by the owner's (non-admin) session: restart both processes without touching the task.
setInterval(() => {
  const flag = P('control', 'restart.flag')
  if (!fs.existsSync(flag)) return
  try { fs.unlinkSync(flag) } catch { return }
  livekit.restart('pedido em control\\restart.flag')
  if (caddy.child || caddy.timer) caddy.restart('pedido em control\\restart.flag'); else startCaddyWhenReachable()
}, 5000)

let closing = false
async function shutdown(sig) {
  if (closing) return
  closing = true
  log(`supervisor: encerrando (${sig})`)
  livekit.stop(); caddy.stop()
  if (mine.length) {
    const igd = await findIgd(state.lanIp, state.gateway).catch(() => null)
    if (igd) for (const m of mine) { const [port, proto] = m.split('/'); await deleteMapping(igd, Number(port), proto) }
    log('upnp: encaminhamentos removidos')
  }
  state.stoppedAt = new Date().toISOString()
  saveState()
  process.exit(0)
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP']) process.on(sig, () => shutdown(sig))
