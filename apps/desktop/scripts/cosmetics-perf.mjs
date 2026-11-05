// Cosmetics performance proof (growth-plan §5.2 B): the gallery's bench scene (index.html#cosmetics-gallery/bench) —
// a 50-member list wearing moving decorations and nameplates (every gesture replayed every 2.5 s, within the global
// cap) plus 8 call tiles speaking all the time with voice auras, still decorations and a framed stream — against
// the same scene without cosmetics (/bench-off).
//   CPU/frames: one app, the scenes interleaved (off, on, on, off, …) in ROUNDS windows each, so drift and launch
//   noise hit both alike; SECONDS measured per scene in total (60 s = 4 windows of 15 s), 3 s warm-up per window.
//   - main-thread time per frame: CDP Performance.getMetrics TaskDuration (and Script/Style/Layout) ÷ frames drawn
//   - frame intervals (rAF): p50, p95, share over 25 ms
//   - GPU process and renderer CPU (Electron app.getAppMetrics, % of one core, 1 s samples)
//   - engine counters: JS ms spent by cosmetics (aura callbacks, canvas), gestures started/skipped, concurrency
//   Memory: a fresh app per scene, renderer private bytes every second for COSMETICS_MEM_SECONDS (300): the plateau
//   (median after the first 30 s), its slope (MB/min, least squares from 60 s on) and the live size after a forced
//   full GC at 60 s and at the end. A leak grows the live size; short-lived Blink objects only lift the plateau.
//   node scripts/cosmetics-perf.mjs [--skip-build] [--memory-only] [--parts[=tiles,list,…]]
//   env: COSMETICS_SECONDS (60), COSMETICS_ROUNDS (4), COSMETICS_MEM_SECONDS (300)
//   --parts adds each part of the scene on its own (call tiles, list, still decorations, frame, each aura).
//   One Electron at a time (automation mode: off-screen, inactive), each closed as soon as its measurement ends.
// Prints markdown tables (docs/benchmarks/cosmetics-perf.md) and writes <work>/perf.json.
import { writeFileSync } from 'node:fs'
import { cpus } from 'node:os'
import { join } from 'node:path'
import { build, gallery, launch, sleep, work } from './cosmetics-lib.mjs'

const SECONDS = Number(process.env.COSMETICS_SECONDS ?? 60)
const ROUNDS = Number(process.env.COSMETICS_ROUNDS ?? 4)
const MEM_SECONDS = Number(process.env.COSMETICS_MEM_SECONDS ?? 300)
const MEMORY_ONLY = process.argv.includes('--memory-only')
const ALL_PARTS = ['tiles', 'list', 'decos', 'frame', 'aura_ha_respiro', 'aura_ha_prisma', 'aura_ha_ondas', 'aura_ha_frondes']
// --parts = all of them; --parts=tiles,list = those only.
const partsArg = process.argv.find((a) => a.startsWith('--parts'))
const PARTS = (partsArg?.includes('=') ? partsArg.split('=')[1].split(',') : partsArg ? ALL_PARTS : []).map((p) => `bench:${p}`)
const SCENES = ['bench-off', 'bench', ...PARTS]
build({ skip: process.argv.includes('--skip-build') })

const q = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0
}
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const metric = (r, name) => r.metrics.find((m) => m.name === name)?.value ?? 0
const appMetrics = (app) => app.evaluate(({ app }) => app.getAppMetrics().map((m) => ({ type: m.type, cpu: m.cpu.percentCPUUsage, priv: m.memory.privateBytes ?? 0 })))
const counters = (page) =>
  page.evaluate(() => {
    const { frames, intervals, stats } = window.__bench
    return { frames, intervals: intervals.splice(0), js: stats.jsMs, started: stats.started, skipped: stats.skipped, over: stats.overBudget, peak: stats.peak }
  })

/** One measured window of `secs` on `mode`. */
async function measure(app, page, mode, secs) {
  await gallery(page, mode)
  await sleep(3000)
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Performance.enable')
  await appMetrics(app) // prime: a CPU reading covers the time since the previous one
  const m0 = await cdp.send('Performance.getMetrics')
  const c0 = await counters(page)
  const gpu = []
  const tab = []
  const playing = []
  for (let s = 0; s < secs; s++) {
    await sleep(1000)
    const m = await appMetrics(app)
    gpu.push(m.filter((p) => p.type === 'GPU').reduce((t, p) => t + p.cpu, 0))
    tab.push(m.filter((p) => p.type === 'Tab').reduce((t, p) => t + p.cpu, 0))
    playing.push(await page.evaluate(() => window.__bench.stats.playing))
  }
  const m1 = await cdp.send('Performance.getMetrics')
  const c1 = await counters(page)
  await cdp.detach()
  const d = (name) => (metric(m1, name) - metric(m0, name)) * 1000
  return {
    frames: c1.frames - c0.frames, task: d('TaskDuration'), script: d('ScriptDuration'), style: d('RecalcStyleDuration'), layout: d('LayoutDuration'),
    intervals: c1.intervals, js: c1.js - c0.js, started: c1.started - c0.started, skipped: c1.skipped - c0.skipped, over: c1.over - c0.over, peak: c1.peak, gpu, tab, playing,
  }
}

const sum = (ws, k) => ws.reduce((t, w) => t + w[k], 0)
function aggregate(ws) {
  const frames = sum(ws, 'frames')
  const per = (k) => sum(ws, k) / frames
  const intervals = ws.flatMap((w) => w.intervals)
  return {
    windows: ws.length,
    seconds: ws.reduce((t, w) => t + w.gpu.length, 0),
    fps: frames / ws.reduce((t, w) => t + w.gpu.length, 0),
    mainMsPerFrame: per('task'),
    mainMsPerFrameRange: [Math.min(...ws.map((w) => w.task / w.frames)), Math.max(...ws.map((w) => w.task / w.frames))],
    scriptMsPerFrame: per('script'),
    styleMsPerFrame: per('style'),
    layoutMsPerFrame: per('layout'),
    cosmeticsJsMsPerFrame: per('js'),
    frameP50: q(intervals, 0.5),
    frameP95: q(intervals, 0.95),
    over25: intervals.filter((i) => i > 25).length / Math.max(1, intervals.length),
    gpuCpu: avg(ws.flatMap((w) => w.gpu)),
    gpuCpuP95: q(ws.flatMap((w) => w.gpu), 0.95),
    tabCpu: avg(ws.flatMap((w) => w.tab)),
    gesturesStarted: sum(ws, 'started'),
    gesturesSkipped: sum(ws, 'skipped'),
    overBudget: sum(ws, 'over'),
    peakPlaying: Math.max(...ws.map((w) => w.peak)),
    avgPlaying: avg(ws.flatMap((w) => w.playing)),
  }
}

let env
const windows = Object.fromEntries(SCENES.map((s) => [s, []]))
{
  const { app, page } = await launch({ scale: 1, size: [1440, 900] })
  try {
    env = await app.evaluate(async ({ app }) => ({ electron: process.versions.electron, chrome: process.versions.chrome, gpu: (await app.getGPUInfo('basic')).gpuDevice?.map((d) => `${d.vendorId.toString(16)}:${d.deviceId.toString(16)}${d.active ? ' (ativa)' : ''}`) }))
    for (let r = 0; r < (MEMORY_ONLY ? 0 : ROUNDS); r++) {
      // Alternate the order every round (off, on … then … on, off) so neither scene always runs first.
      const order = r % 2 ? [...SCENES].reverse() : SCENES
      for (const s of order) windows[s].push(await measure(app, page, s, Math.round(SECONDS / ROUNDS)))
    }
  } finally {
    await app.close()
  }
}
const result = MEMORY_ONLY ? {} : Object.fromEntries(Object.entries(windows).map(([k, ws]) => [k, aggregate(ws)]))

const tabPriv = async (app) => (await appMetrics(app)).filter((p) => p.type === 'Tab').reduce((t, p) => t + p.priv, 0) / 1024
/** Least-squares slope of ys (one sample per second), in MB per minute. */
const slope = (ys) => {
  const n = ys.length
  const mx = (n - 1) / 2
  const my = avg(ys)
  const num = ys.reduce((t, y, x) => t + (x - mx) * (y - my), 0)
  const den = ys.reduce((t, _, x) => t + (x - mx) ** 2, 0)
  return den ? (num / den) * 60 : 0
}

/** Memory: a fresh app per scene (renderer memory never carries over from another scene). */
async function memory(mode) {
  const { app, page } = await launch({ scale: 1, size: [1440, 900] })
  try {
    await gallery(page, mode)
    const cdp = await page.context().newCDPSession(page)
    const priv = []
    const live = []
    for (let s = 1; s <= MEM_SECONDS; s++) {
      await sleep(1000)
      priv.push(await tabPriv(app))
      // The live size: a full GC (V8 + Blink's Oilpan heap together), then the same reading.
      if (s === 60 || s === MEM_SECONDS) {
        await cdp.send('HeapProfiler.collectGarbage')
        await sleep(1500)
        live.push(await tabPriv(app))
      }
    }
    const heap = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0)
    // Plateau: after the first 30 s, leaving out the 10 s after the forced GC at 60 s (it refills from there).
    const steady = priv.filter((_, i) => i >= 30 && !(i >= 60 && i < 70))
    // Slope over the second half only: the first minutes include the refill after the forced GC.
    return { first: priv[0], plateau: q(steady, 0.5), p95: q(steady, 0.95), last: priv[priv.length - 1], slope: slope(priv.slice(Math.floor(MEM_SECONDS / 2))), live, heapMB: heap / 1048576, priv }
  } finally {
    await app.close()
  }
}
const CPU_ONLY = process.argv.includes('--cpu-only')
const mem = CPU_ONLY ? null : { off: await memory('bench-off'), on: await memory('bench') }
env.cpu = cpus()[0]?.model
writeFileSync(join(work, 'perf.json'), JSON.stringify({ env, result, mem, windows }, null, 2))

const f = (n, d = 2) => n.toFixed(d).replace('.', ',')
const memRows = !mem ? [] : [
  ['Memória privada do renderer no início (MB)', f(mem.off.first, 0), f(mem.on.first, 0)],
  [`Patamar, mediana de 30 s a ${MEM_SECONDS} s / p95 (MB)`, `${f(mem.off.plateau, 0)} / ${f(mem.off.p95, 0)}`, `${f(mem.on.plateau, 0)} / ${f(mem.on.p95, 0)}`],
  [`Inclinação na segunda metade, ${Math.floor(MEM_SECONDS / 2)}–${MEM_SECONDS} s (MB/min)`, f(mem.off.slope, 1), f(mem.on.slope, 1)],
  [`Viva após GC completo em 60 s / ${MEM_SECONDS} s (MB)`, mem.off.live.map((v) => f(v, 0)).join(' / '), mem.on.live.map((v) => f(v, 0)).join(' / ')],
  ['Heap JS no fim (MB)', f(mem.off.heapMB, 1), f(mem.on.heapMB, 1)],
]
if (mem) {
  console.log(`\nMemória, ${MEM_SECONDS} s por cena, um app novo por cena\n\n| Medida | Sem cosméticos | Com cosméticos |\n|---|---|---|`)
  for (const r of memRows) console.log(`| ${r.join(' | ')} |`)
}
if (MEMORY_ONLY) process.exit(0)

const off = result['bench-off']
const on = result.bench
const range = (r) => `${f(r[0])}–${f(r[1])}`
const rows = [
  ['Quadros por segundo', f(off.fps, 1), f(on.fps, 1)],
  ['Main thread por quadro (ms), média e faixa entre janelas', `${f(off.mainMsPerFrame)} (${range(off.mainMsPerFrameRange)})`, `${f(on.mainMsPerFrame)} (${range(on.mainMsPerFrameRange)})`],
  ['  script / estilo / layout (ms)', `${f(off.scriptMsPerFrame)} / ${f(off.styleMsPerFrame)} / ${f(off.layoutMsPerFrame)}`, `${f(on.scriptMsPerFrame)} / ${f(on.styleMsPerFrame)} / ${f(on.layoutMsPerFrame)}`],
  ['JS dos cosméticos por quadro (ms)', '—', f(on.cosmeticsJsMsPerFrame, 3)],
  ['Intervalo de quadro p50 / p95 (ms)', `${f(off.frameP50, 1)} / ${f(off.frameP95, 1)}`, `${f(on.frameP50, 1)} / ${f(on.frameP95, 1)}`],
  ['Quadros > 25 ms', `${f(off.over25 * 100, 1)} %`, `${f(on.over25 * 100, 1)} %`],
  ['CPU do processo de GPU, média / p95 (% de 1 núcleo)', `${f(off.gpuCpu, 1)} / ${f(off.gpuCpuP95, 1)}`, `${f(on.gpuCpu, 1)} / ${f(on.gpuCpuP95, 1)}`],
  ['CPU do renderer (% de 1 núcleo)', f(off.tabCpu, 1), f(on.tabCpu, 1)],
  ['Gestos iniciados / recusados (teto, fora da tela)', '—', `${on.gesturesStarted} / ${on.gesturesSkipped}`],
  ['Gestos simultâneos, média / pico', '—', `${f(on.avgPlaying, 1)} / ${on.peakPlaying}`],
  ['Cortes por orçamento estourado', '—', String(on.overBudget)],
]
const moving = 8 + on.avgPlaying // 8 auras (continuous while speaking) + the gestures playing
const delta = on.mainMsPerFrame - off.mainMsPerFrame
console.log(`\n${env.cpu} · Electron ${env.electron} (Chromium ${env.chrome}) · GPU ${env.gpu?.join(', ')} · ${off.seconds} s por cena em ${ROUNDS} janelas intercaladas\n`)
console.log('| Medida | Sem cosméticos | Com cosméticos |\n|---|---|---|')
for (const r of rows) console.log(`| ${r.join(' | ')} |`)
console.log(`\nCusto dos cosméticos: ${f(delta, 3)} ms de main thread por quadro no total; ${f(delta / moving, 3)} ms por cosmético em movimento (${f(moving, 1)} em média).`)
if (SCENES.length > 2) {
  console.log('\n| Só esta parte | Main thread a mais por quadro (ms) | Faixa entre janelas (ms) | Estilo a mais (ms) | GPU (%) |\n|---|---|---|---|---|')
  for (const p of PARTS) {
    const r = result[p]
    console.log(`| ${p.slice(6)} | ${f(r.mainMsPerFrame - off.mainMsPerFrame, 3)} | ${range(r.mainMsPerFrameRange)} | ${f(r.styleMsPerFrame - off.styleMsPerFrame, 3)} | ${f(r.gpuCpu, 1)} |`)
  }
}
