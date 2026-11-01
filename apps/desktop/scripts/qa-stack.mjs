// QA stack: an isolated LiveKit + API + app build that never touches the dev stack (:4000/:7880, profiles
// default/bob, apps/server/data). Everything lives under QA_WORK and every PID it starts is tracked there.
//   node scripts/qa-stack.mjs build | start | stop | status | grant <username> <moderator|admin|none>
// Ports: API 4340, LiveKit 7940 (tcp 7941, udp 51400-51499). Override with QA_API_PORT / QA_LK_PORT.
import { execSync, spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
export const appDir = join(here, '..')
export const repo = join(appDir, '..', '..')
const serverDir = join(repo, 'apps', 'server')
export const WORK = process.env.QA_WORK ?? join(tmpdir(), 'alga-qa')
export const API_PORT = Number(process.env.QA_API_PORT ?? 4340)
export const LK_PORT = Number(process.env.QA_LK_PORT ?? 7940)
export const API = `http://127.0.0.1:${API_PORT}`
export const OUTBOX = join(WORK, 'outbox')
/** The app build used by QA (electron-vite --outDir), so apps/desktop/out of the running dev app is never rewritten. */
export const QA_APP = join(appDir, 'node_modules', '.alga-qa')
const pidFile = join(WORK, 'pids.json')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const pids = () => (existsSync(pidFile) ? JSON.parse(readFileSync(pidFile, 'utf8')) : {})
const savePids = (p) => writeFileSync(pidFile, JSON.stringify(p, null, 2))
const alive = (pid) => {
  if (!pid) return false
  const r = spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH'], { encoding: 'utf8' })
  return r.stdout.includes(String(pid))
}
/** Kills a process tree only if it is one we recorded. */
function killTracked(name) {
  const p = pids()
  if (p[name] && alive(p[name])) spawnSync('taskkill', ['/PID', String(p[name]), '/T', '/F'], { stdio: 'ignore' })
  delete p[name]
  savePids(p)
}

export function build() {
  execSync(`npx electron-vite build --outDir "${QA_APP}"`, { cwd: appDir, stdio: 'inherit' })
  writeFileSync(join(QA_APP, 'package.json'), JSON.stringify({ name: '@alga/desktop', productName: 'Alga Meet', version: '0.1.0', main: './main/index.js' }, null, 2))
  cpSync(join(appDir, 'build', 'runtime'), join(QA_APP, 'build', 'runtime'), { recursive: true })
}

function livekitConfig() {
  const yaml = readFileSync(join(repo, 'infra', 'livekit', 'livekit.dev.yaml'), 'utf8')
    .replace(/^port: \d+/m, `port: ${LK_PORT}`)
    .replace(/tcp_port: \d+/, `tcp_port: ${LK_PORT + 1}`)
    .replace(/port_range_start: \d+/, 'port_range_start: 51400')
    .replace(/port_range_end: \d+/, 'port_range_end: 51499')
    .replace(/http:\/\/127\.0\.0\.1:4000\//, `http://127.0.0.1:${API_PORT}/`)
  const p = join(WORK, 'livekit.yaml')
  writeFileSync(p, yaml)
  return p
}

export async function startLivekit() {
  mkdirSync(WORK, { recursive: true })
  if (alive(pids().livekit)) return pids().livekit
  const bin = join(repo, 'infra', 'livekit', 'bin', 'livekit-server.exe')
  const out = openSync(join(WORK, 'livekit.log'), 'a')
  const child = spawn(bin, ['--config', livekitConfig()], { detached: true, stdio: ['ignore', out, out], windowsHide: true })
  child.unref()
  savePids({ ...pids(), livekit: child.pid })
  for (let i = 0; i < 60; i++) {
    if (await fetch(`http://127.0.0.1:${LK_PORT}/`).then((r) => r.ok, () => false)) return child.pid
    await sleep(250)
  }
  throw new Error('LiveKit did not come up')
}
export const stopLivekit = () => killTracked('livekit')

export async function startApi() {
  mkdirSync(WORK, { recursive: true })
  if (alive(pids().api)) return pids().api
  const env = {
    ...process.env,
    NODE_ENV: 'development',
    PORT: String(API_PORT),
    HOST: '127.0.0.1',
    PGLITE_DIR: join(WORK, 'pglite'),
    UPLOADS_DIR: join(WORK, 'uploads'),
    EMAIL_OUTBOX_DIR: OUTBOX,
    LIVEKIT_URL: `http://127.0.0.1:${LK_PORT}`,
    LIVEKIT_PUBLIC_URL: `ws://127.0.0.1:${LK_PORT}`,
    LIVEKIT_API_KEY: 'devkey',
    LIVEKIT_API_SECRET: 'alga-dev-secret-change-me-0123456789abcdef',
    BILLING_PROVIDER: 'sandbox',
    LOG_LEVEL: 'info',
  }
  const out = openSync(join(WORK, 'api.log'), 'a')
  // No tsx watch: an edit in the working tree must not restart the API in the middle of a step.
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts', '--dev'], { cwd: serverDir, env, detached: true, stdio: ['ignore', out, out], windowsHide: true })
  child.unref()
  savePids({ ...pids(), api: child.pid })
  for (let i = 0; i < 120; i++) {
    if (await fetch(`${API}/api/v1/health`).then((r) => r.ok, () => false)) return child.pid
    await sleep(500)
  }
  throw new Error(`API did not come up (see ${join(WORK, 'api.log')})`)
}
export const stopApi = () => killTracked('api')

/** grant-staff.ts against OUR PGlite (one process per directory: the API is stopped around it). */
export async function grantStaff(username, role) {
  stopApi()
  await sleep(1500)
  const r = spawnSync('npx', ['tsx', 'scripts/grant-staff.ts', username, role], {
    cwd: serverDir, env: { ...process.env, PGLITE_DIR: join(WORK, 'pglite') }, encoding: 'utf8', shell: true,
  })
  await startApi()
  if (r.status !== 0) throw new Error(`grant-staff failed: ${r.stderr || r.stdout}`)
  return r.stdout.trim()
}

/** Every QA electron process (our profiles only) — never the dev app's. */
export function killQaApps() {
  const r = spawnSync('powershell', ['-NoProfile', '-Command',
    "Get-CimInstance Win32_Process -Filter \"Name='electron.exe'\" | Where-Object { $_.CommandLine -match '--profile=qa-' -and $_.CommandLine -match '\\.alga-qa' } | ForEach-Object { $_.ProcessId }"], { encoding: 'utf8' })
  for (const pid of r.stdout.split(/\s+/).filter(Boolean)) spawnSync('taskkill', ['/PID', pid, '/T', '/F'], { stdio: 'ignore' })
}

export function stopAll() {
  killQaApps()
  killTracked('ffplay')
  stopApi()
  stopLivekit()
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [cmd, ...rest] = process.argv.slice(2)
  if (cmd === 'build') build()
  else if (cmd === 'start') {
    await startLivekit()
    await startApi()
    console.log('QA stack up:', pids(), 'work', WORK)
  } else if (cmd === 'stop') {
    stopAll()
    console.log('QA stack stopped')
  } else if (cmd === 'status') console.log(Object.fromEntries(Object.entries(pids()).map(([k, v]) => [k, { pid: v, alive: alive(v) }])))
  else if (cmd === 'grant') console.log(await grantStaff(rest[0], rest[1]))
  else if (cmd === 'wipe') {
    stopAll()
    rmSync(WORK, { recursive: true, force: true })
  } else console.log('usage: qa-stack.mjs build|start|stop|status|grant <user> <role>|wipe')
}
