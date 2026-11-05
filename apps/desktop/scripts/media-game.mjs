#!/usr/bin/env node
// Game-capture benchmark (docs/benchmarks/game-capture.md): a native D3D11 "game" (compiled here with MSVC: high
// frequency detail, camera pan, frame index drawn as a barcode) in windowed / borderless / exclusive fullscreen,
// streamed by instance A as a screen or a window source to instance B through the lab's own LiveKit (:7890).
//
//   node apps/desktop/scripts/media-game.mjs [--no-build] [--modes=borderless,exclusive,windowed] [--kinds=screen,window]
//     [--preset=720p60] [--seconds=12] [--iters=450] [--fps=191] [--cpu=0] [--no-boost] [--headroom=1] [--harness-flags] [--flags=<switch>] [--tag=name]
//
// Default launch = the app's real switches (no occlusion/backgrounding overrides): the game covers the app, as at
// home. --harness-flags adds media-lab's overrides for comparison. Results: docs/benchmarks/game-capture.json[tag].
// The game window covers the screen for ~25 s per case and quits by itself (or Esc).
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as L from './media-lab.mjs'

const argv = process.argv.slice(2)
const MODES = L.arg('modes', 'borderless,exclusive,windowed').split(',')
const KINDS = L.arg('kinds', 'screen,window').split(',')
const PRESET = L.arg('preset', '720p60')
const SECONDS = Number(L.arg('seconds', 12))
// 450 iterations at 191 fps = ~38 % of this RTX 3070 at 2560x1440: the field report (game at 191 fps, GPU 38 %).
const ITERS = L.arg('iters', '450')
const GAME_FPS = L.arg('fps', '191')
const GAME_CPU = L.arg('cpu', '0') // busy worker threads in the game (a CPU-bound game)
const TAG = L.arg('tag', 'default')
const HARNESS = argv.includes('--harness-flags')
const FLAGS = argv.filter((a) => a.startsWith('--flags=')).map((a) => a.slice('--flags='.length))
// "Before" of the fixes: --no-boost puts A's processes back to NORMAL after each share starts (main raises them on the
// grant), --headroom=1 asks the capture for the preset's own fps (media.captureHeadroom).
const NO_BOOST = argv.includes('--no-boost')
const HEADROOM = L.arg('headroom', '')
const outJson = join(L.repo, 'docs/benchmarks/game-capture.json')

const GAME_CPP = String.raw`// AlgaGame: uncapped D3D11 "game" for screen-capture tests (windowed / borderless / exclusive fullscreen).
// game.exe --mode=windowed|borderless|exclusive [--iters=N] [--fps=cap] [--detail=0..1] [--cpu=threads] [--seconds=S] [--w=1280 --h=720]
// Top-left: 16 blocks of 64x64 px = frame index bits (capture side decodes unique frames). Prints fps every second.
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <d3d11.h>
#include <dxgi1_5.h>
#include <d3dcompiler.h>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <thread>
#include <atomic>
#pragma comment(lib, "d3d11.lib")
#pragma comment(lib, "dxgi.lib")
#pragma comment(lib, "d3dcompiler.lib")
#pragma comment(lib, "user32.lib")

static const char* kShader = R"(
cbuffer C : register(b0) { float t; uint frame; uint iters; float w; float h; float detail; float2 pad; };
float4 vs(uint id : SV_VertexID) : SV_Position {
  float2 p = float2((id << 1) & 2, id & 2);
  return float4(p * float2(2, -2) + float2(-1, 1), 0, 1);
}
float hash(float2 p) { return frac(sin(dot(p, float2(127.1, 311.7))) * 43758.5453); }
float vnoise(float2 p) {
  float2 i = floor(p), f = frac(p);
  f = f * f * (3 - 2 * f);
  return lerp(lerp(hash(i), hash(i + float2(1, 0)), f.x), lerp(hash(i + float2(0, 1)), hash(i + 1), f.x), f.y);
}
float4 ps(float4 pos : SV_Position) : SV_Target {
  if (pos.y < 64 && pos.x < 16 * 64) {
    uint bit = (uint)(pos.x / 64);
    return ((frame >> bit) & 1) ? float4(1, 1, 1, 1) : float4(0, 0, 0, 1);
  }
  float2 uv = pos.xy / float2(w, h);
  // "camera" panning and swaying over a detailed procedural world (foliage-like high-frequency noise)
  float a = sin(t * 0.5) * 0.3;
  float2 wp = mul(float2x2(cos(a), -sin(a), sin(a), cos(a)), pos.xy - float2(w, h) * 0.5) + float2(t * 700, sin(t) * 200);
  float n = 0, amp = 0.5, fr = 1.0 / 64;
  for (int o = 0; o < 6; o++) { n += amp * vnoise(wp * fr); fr *= 2.3; amp *= 0.62; }
  float3 c = lerp(float3(0.15, 0.35, 0.1), float3(0.7, 0.8, 0.35), n);
  c = lerp(0.5 + 0.5 * cos(t * 3 + uv.xyx * 6 + float3(0, 2, 4)), c, detail);
  c *= 0.75 + 0.25 * step(0.5, frac(uv.x * 5 - t * 1.5));         // fast vertical bars
  c = lerp(c, 1 - c, step(abs(uv.y - frac(t * 0.7)), 0.02));      // sweeping line
  float2 q = uv * 3;
  float acc = 0;
  [loop] for (uint i = 0; i < iters; i++) { q = sin(q.yx * 1.7 + t + i * 0.01) * 1.3; acc += q.x * q.y; }
  return float4(saturate(c + acc * 1e-4), 1);
}
)";

struct CB { float t; UINT frame; UINT iters; float w, h, detail, pad[2]; };

static bool g_quit = false;
static LRESULT CALLBACK WndProc(HWND h, UINT m, WPARAM w, LPARAM l) {
  if (m == WM_DESTROY) { g_quit = true; PostQuitMessage(0); return 0; }
  if (m == WM_KEYDOWN && w == VK_ESCAPE) { DestroyWindow(h); return 0; }
  return DefWindowProcW(h, m, w, l);
}

static const char* arg(int argc, char** argv, const char* name, const char* def) {
  size_t n = strlen(name);
  for (int i = 1; i < argc; i++) if (!strncmp(argv[i], name, n) && argv[i][n] == '=') return argv[i] + n + 1;
  return def;
}

int main(int argc, char** argv) {
  SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
  const char* mode = arg(argc, argv, "--mode", "windowed");
  UINT iters = (UINT)atoi(arg(argc, argv, "--iters", "40"));
  float detail = (float)atof(arg(argc, argv, "--detail", "1"));
  double seconds = atof(arg(argc, argv, "--seconds", "60"));
  double cap = atof(arg(argc, argv, "--fps", "0")); // 0 = uncapped
  HANDLE waiter = CreateWaitableTimerExW(nullptr, nullptr, CREATE_WAITABLE_TIMER_HIGH_RESOLUTION, TIMER_ALL_ACCESS);
  bool windowed = !strcmp(mode, "windowed"), exclusive = !strcmp(mode, "exclusive");
  // CPU-bound game: worker threads busy at normal priority (simulation, physics, streaming).
  static std::atomic<bool> busy{true};
  for (int i = 0, n = atoi(arg(argc, argv, "--cpu", "0")); i < n; i++)
    std::thread([] { volatile double x = 1; while (busy) for (int k = 0; k < 100000; k++) x = x * 1.0000001 + 1e-9; }).detach();
  int sw = GetSystemMetrics(SM_CXSCREEN), sh = GetSystemMetrics(SM_CYSCREEN);
  int w = windowed ? atoi(arg(argc, argv, "--w", "1280")) : sw;
  int h = windowed ? atoi(arg(argc, argv, "--h", "720")) : sh;

  WNDCLASSW wc = {}; wc.lpfnWndProc = WndProc; wc.hInstance = GetModuleHandleW(nullptr); wc.lpszClassName = L"AlgaGame";
  wc.hCursor = LoadCursor(nullptr, IDC_ARROW);
  RegisterClassW(&wc);
  DWORD style = windowed ? WS_OVERLAPPEDWINDOW : WS_POPUP;
  RECT r = { 0, 0, w, h };
  AdjustWindowRect(&r, style, FALSE);
  HWND hwnd = CreateWindowExW(0, L"AlgaGame", L"AlgaGame", style | WS_VISIBLE, 0, 0,
                              r.right - r.left, r.bottom - r.top, nullptr, nullptr, wc.hInstance, nullptr);
  SetForegroundWindow(hwnd);

  IDXGIFactory2* factory = nullptr;
  CreateDXGIFactory1(__uuidof(IDXGIFactory2), (void**)&factory);
  BOOL tearing = FALSE;
  IDXGIFactory5* f5 = nullptr;
  if (SUCCEEDED(factory->QueryInterface(__uuidof(IDXGIFactory5), (void**)&f5))) {
    f5->CheckFeatureSupport(DXGI_FEATURE_PRESENT_ALLOW_TEARING, &tearing, sizeof(tearing));
    f5->Release();
  }
  ID3D11Device* dev = nullptr; ID3D11DeviceContext* ctx = nullptr;
  D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr, 0, nullptr, 0, D3D11_SDK_VERSION, &dev, nullptr, &ctx);

  // Exclusive: classic blt-model swap chain + SetFullscreenState (what older/exclusive games do).
  // Windowed/borderless: flip model with tearing allowed (what modern uncapped games do).
  DXGI_SWAP_CHAIN_DESC1 sd = {};
  sd.Width = w; sd.Height = h; sd.Format = DXGI_FORMAT_R8G8B8A8_UNORM; sd.SampleDesc.Count = 1;
  sd.BufferUsage = DXGI_USAGE_RENDER_TARGET_OUTPUT;
  sd.BufferCount = exclusive ? 1 : 2;
  sd.SwapEffect = exclusive ? DXGI_SWAP_EFFECT_DISCARD : DXGI_SWAP_EFFECT_FLIP_DISCARD;
  sd.Flags = (exclusive ? DXGI_SWAP_CHAIN_FLAG_ALLOW_MODE_SWITCH : 0) | (!exclusive && tearing ? DXGI_SWAP_CHAIN_FLAG_ALLOW_TEARING : 0);
  IDXGISwapChain1* sc = nullptr;
  HRESULT hr = factory->CreateSwapChainForHwnd(dev, hwnd, &sd, nullptr, nullptr, &sc);
  if (FAILED(hr)) { fprintf(stderr, "swapchain failed %08lx\n", hr); return 1; }
  factory->MakeWindowAssociation(hwnd, DXGI_MWA_NO_ALT_ENTER);
  if (exclusive) {
    IDXGIOutput* out = nullptr;
    sc->GetContainingOutput(&out);
    UINT n = 0;
    out->GetDisplayModeList(DXGI_FORMAT_R8G8B8A8_UNORM, 0, &n, nullptr);
    DXGI_MODE_DESC* modes = new DXGI_MODE_DESC[n];
    out->GetDisplayModeList(DXGI_FORMAT_R8G8B8A8_UNORM, 0, &n, modes);
    DXGI_MODE_DESC best = {}; double bestHz = 0;
    for (UINT i = 0; i < n; i++) {
      double hz = (double)modes[i].RefreshRate.Numerator / (modes[i].RefreshRate.Denominator ? modes[i].RefreshRate.Denominator : 1);
      if ((int)modes[i].Width == w && (int)modes[i].Height == h && hz > bestHz) { best = modes[i]; bestHz = hz; }
    }
    delete[] modes;
    sc->ResizeTarget(&best);
    hr = sc->SetFullscreenState(TRUE, out);
    out->Release();
    if (FAILED(hr)) fprintf(stderr, "SetFullscreenState failed %08lx\n", hr);
    sc->ResizeBuffers(0, w, h, DXGI_FORMAT_UNKNOWN, DXGI_SWAP_CHAIN_FLAG_ALLOW_MODE_SWITCH);
    printf("exclusive %dx%d @ %.2f Hz\n", w, h, bestHz);
  }

  ID3DBlob *vsb = nullptr, *psb = nullptr, *err = nullptr;
  if (FAILED(D3DCompile(kShader, strlen(kShader), nullptr, nullptr, nullptr, "vs", "vs_5_0", 0, 0, &vsb, &err)) ||
      FAILED(D3DCompile(kShader, strlen(kShader), nullptr, nullptr, nullptr, "ps", "ps_5_0", 0, 0, &psb, &err))) {
    fprintf(stderr, "shader: %s\n", err ? (char*)err->GetBufferPointer() : "?");
    return 1;
  }
  ID3D11VertexShader* vs = nullptr; ID3D11PixelShader* ps = nullptr;
  dev->CreateVertexShader(vsb->GetBufferPointer(), vsb->GetBufferSize(), nullptr, &vs);
  dev->CreatePixelShader(psb->GetBufferPointer(), psb->GetBufferSize(), nullptr, &ps);
  D3D11_BUFFER_DESC bd = { sizeof(CB), D3D11_USAGE_DEFAULT, D3D11_BIND_CONSTANT_BUFFER };
  ID3D11Buffer* cb = nullptr;
  dev->CreateBuffer(&bd, nullptr, &cb);

  LARGE_INTEGER freq, t0, last, now;
  QueryPerformanceFrequency(&freq); QueryPerformanceCounter(&t0); last = t0;
  UINT frame = 0, frames = 0;
  MSG msg;
  while (!g_quit) {
    while (PeekMessageW(&msg, nullptr, 0, 0, PM_REMOVE)) { TranslateMessage(&msg); DispatchMessageW(&msg); }
    if (g_quit) break;
    QueryPerformanceCounter(&now);
    double t = (double)(now.QuadPart - t0.QuadPart) / freq.QuadPart;
    if (t > seconds) break;
    ID3D11Texture2D* bb = nullptr; ID3D11RenderTargetView* rtv = nullptr;
    sc->GetBuffer(0, __uuidof(ID3D11Texture2D), (void**)&bb);
    dev->CreateRenderTargetView(bb, nullptr, &rtv);
    CB c = { (float)t, frame, iters, (float)w, (float)h, detail };
    ctx->UpdateSubresource(cb, 0, nullptr, &c, 0, 0);
    D3D11_VIEWPORT vp = { 0, 0, (float)w, (float)h, 0, 1 };
    ctx->RSSetViewports(1, &vp);
    ctx->OMSetRenderTargets(1, &rtv, nullptr);
    ctx->IASetPrimitiveTopology(D3D11_PRIMITIVE_TOPOLOGY_TRIANGLELIST);
    ctx->VSSetShader(vs, nullptr, 0); ctx->PSSetShader(ps, nullptr, 0); ctx->PSSetConstantBuffers(0, 1, &cb);
    ctx->Draw(3, 0);
    sc->Present(0, !exclusive && tearing ? DXGI_PRESENT_ALLOW_TEARING : 0);
    rtv->Release(); bb->Release();
    frame++; frames++;
    if (cap > 0) { // frame limiter like a game's fps cap: high-res wait to ~1 ms before the deadline, then spin
      double deadline = frame / cap;
      for (;;) {
        QueryPerformanceCounter(&now);
        double left = deadline - (double)(now.QuadPart - t0.QuadPart) / freq.QuadPart;
        if (left <= 0) break;
        if (left > 0.0015) { LARGE_INTEGER due; due.QuadPart = -(LONGLONG)((left - 0.001) * 1e7); SetWaitableTimer(waiter, &due, 0, nullptr, nullptr, FALSE); WaitForSingleObject(waiter, INFINITE); }
        else YieldProcessor();
      }
    }
    double dt = (double)(now.QuadPart - last.QuadPart) / freq.QuadPart;
    if (dt >= 1.0) { printf("fps %.1f\n", frames / dt); fflush(stdout); frames = 0; last = now; }
  }
  busy = false;
  if (exclusive) sc->SetFullscreenState(FALSE, nullptr);
  return 0;
}
`

function buildGame() {
  const dir = join(L.work, 'game')
  const exe = join(dir, 'game.exe')
  const src = join(dir, 'game.cpp')
  mkdirSync(dir, { recursive: true })
  if (existsSync(exe) && existsSync(src) && readFileSync(src, 'utf8') === GAME_CPP) return exe
  writeFileSync(src, GAME_CPP)
  const vswhere = 'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe'
  const vs = existsSync(vswhere) ? spawnSync(vswhere, ['-latest', '-products', '*', '-property', 'installationPath'], { encoding: 'utf8' }).stdout.trim() : ''
  if (!vs) throw new Error('MSVC not found: install Visual Studio Build Tools (C++)')
  const vcvars = join(vs, 'VC/Auxiliary/Build/vcvars64.bat')
  const r = spawnSync('cmd.exe', ['/d', '/s', '/c', `"call "${vcvars}" >nul 2>nul && cl /nologo /O2 /EHsc game.cpp /Fe:game.exe"`], { cwd: dir, encoding: 'utf8', windowsVerbatimArguments: true })
  if (r.status !== 0 || !existsSync(exe)) throw new Error(`game build failed: ${r.stdout}${r.stderr}`)
  return exe
}

function startGame(exe, mode) {
  const p = spawn(exe, [`--mode=${mode}`, `--iters=${ITERS}`, `--fps=${GAME_FPS}`, `--cpu=${GAME_CPU}`, `--seconds=${SECONDS + 30}`], { stdio: ['ignore', 'pipe', 'pipe'] })
  L.children.add(p)
  const fps = []
  let info = ''
  p.stdout.on('data', (d) => {
    for (const m of String(d).matchAll(/fps ([\d.]+)/g)) fps.push(Number(m[1]))
    info += String(d).match(/exclusive .*/)?.[0] ?? ''
  })
  p.stderr.on('data', (d) => L.log('game:', String(d).trim()))
  return { fps, info: () => info, stop: () => (L.killTree(p.pid), L.children.delete(p)) }
}

/** nvidia-smi GPU utilization samples (%); returns the median when stopped, null without an NVIDIA driver. */
function gpuSampler() {
  if (spawnSync('nvidia-smi', ['-L']).status !== 0) return () => null
  const p = spawn('nvidia-smi', ['--query-gpu=utilization.gpu', '--format=csv,noheader,nounits', '-lms', '1000'], { stdio: ['ignore', 'pipe', 'ignore'] })
  L.children.add(p)
  const v = []
  p.stdout.on('data', (d) => String(d).split(/\s+/).filter(Boolean).forEach((x) => v.push(Number(x))))
  return () => (L.killTree(p.pid), L.children.delete(p), L.median(v.slice(1)))
}

/** What we need from one sender getStats() list: the capture (media-source) and the top layer's counters. */
function pick(list) {
  const src = list.find((s) => s.type === 'media-source' && s.kind === 'video')
  const all = list.filter((s) => s.type === 'outbound-rtp' && s.kind === 'video')
  const outs = (all.some((s) => s.framesEncoded > 0) ? all.filter((s) => s.framesEncoded > 0) : all).sort((x, y) => (y.frameWidth ?? 0) * (y.frameHeight ?? 0) - (x.frameWidth ?? 0) * (x.frameHeight ?? 0))
  const top = outs[0]
  const codec = top && list.find((s) => s.id === top.codecId)
  return {
    t: top?.timestamp ?? src?.timestamp,
    sourceFps: src?.framesPerSecond ?? null,
    sourceFrames: src?.frames ?? null,
    sourceRes: src ? `${src.width}x${src.height}` : null,
    top: top && {
      res: `${top.frameWidth}x${top.frameHeight}`, fps: top.framesPerSecond ?? null, framesEncoded: top.framesEncoded, framesSent: top.framesSent,
      ql: top.qualityLimitationReason, encoder: top.encoderImplementation, hw: top.powerEfficientEncoder,
      bytesSent: top.bytesSent, targetBitrate: top.targetBitrate, encodeTime: top.totalEncodeTime, codec: codec?.mimeType,
    },
  }
}
/** Priority class of every process of an instance (os.setPriority = SetPriorityClass); returns type:priority. */
const setPrio = (inst, level) =>
  inst.app.evaluate(({ app }, level) => {
    const os = process.getBuiltinModule('os')
    return app.getAppMetrics().map((m) => {
      if (level) os.setPriority(m.pid, os.constants.priority[level])
      return `${m.type}:${os.getPriority(m.pid)}`
    })
  }, level)

/** Per-second rate of a counter between the first and last tick that have it. */
const rate = (ticks, f) => {
  const a = ticks.find((x) => f(x) != null)
  const b = [...ticks].reverse().find((x) => f(x) != null)
  return a && b && b.t > a.t ? L.r1(((f(b) - f(a)) * 1000) / (b.t - a.t)) : null
}

async function runCase(a, b, exe, mode, kind, screenW) {
  const game = startGame(exe, mode)
  await L.sleep(3000)
  const sourceId = await L.ev(a, async (kind) => {
    const s = await window.__mediaLab.media.getScreenSources()
    return (kind === 'screen' ? s.find((x) => x.kind === 'screen') : s.find((x) => x.kind === 'window' && x.name === 'AlgaGame'))?.id ?? null
  }, kind)
  try {
    if (!sourceId) throw new Error(`no ${kind} source for the game`)
    await L.ev(a, (o) => window.__mediaLab.media.startScreenShare(o), { sourceId, audio: false, quality: PRESET, contentType: 'motion' })
    if (NO_BOOST) await setPrio(a, 'PRIORITY_NORMAL')
    await L.sleep(1000)
    await L.ev(b, () => window.__mediaLab.media.watch('lab-a', 'source'))
    await b.page.waitForFunction(() => document.querySelector('[data-testid="video-lab-a"]')?.videoWidth > 0, null, { timeout: 20_000 })
    await L.sleep(6000) // bandwidth estimate ramp
    const stopCpu = L.sampler([a])
    const stopGpu = gpuSampler()
    const pace = L.ev(a, (o) => window.__mediaLab.capturePace(o.ms, o.w), { ms: 4000, w: kind === 'window' && mode === 'windowed' ? 1280 : screenW })
    const ticks = []
    for (let i = 0; i < SECONDS; i++) {
      await L.sleep(1000)
      const [sa, raw, sb] = await Promise.all([L.state(a), L.ev(a, () => window.__mediaLab.rawStats('screen')), L.state(b)])
      ticks.push({ ...pick(raw), send: sa.screen.send ?? null, recv: sb.viewers['lab-a']?.stats ?? null })
    }
    const cpu = await stopCpu()
    const gpu = stopGpu()
    const prio = await setPrio(a, null)
    const first = ticks[0]
    const last = ticks.at(-1)
    const ql = {}
    for (const t of ticks) if (t.top) ql[t.top.ql] = (ql[t.top.ql] ?? 0) + 1
    const kbps = rate(ticks, (t) => t.top?.bytesSent)
    return {
      mode, kind, preset: PRESET, gameFps: L.median(game.fps.slice(-SECONDS)), gameInfo: game.info() || null,
      capture: await pace,
      sourceFps: L.summary(ticks.map((t) => t.sourceFps).filter((v) => v != null)),
      sourceFramesRate: rate(ticks, (t) => t.sourceFrames),
      encodedFps: rate(ticks, (t) => t.top?.framesEncoded),
      sentFps: rate(ticks, (t) => t.top?.framesSent),
      sendFps: L.summary(ticks.map((t) => t.top?.fps).filter((v) => v != null)),
      sendRes: [...new Set(ticks.map((t) => t.top?.res))], sourceRes: last?.sourceRes,
      kbps: kbps === null ? null : L.r1((kbps * 8) / 1000), targetKbps: last?.top?.targetBitrate ? last.top.targetBitrate / 1000 : null,
      encodeMsPerFrame: L.r1((1000 * ((last?.top?.encodeTime ?? 0) - (first?.top?.encodeTime ?? 0))) / Math.max(1, (last?.top?.framesEncoded ?? 0) - (first?.top?.framesEncoded ?? 0))),
      qualityLimitation: ql, encoder: last?.top?.encoder, hw: last?.top?.hw, codec: last?.top?.codec,
      diagnosis: last?.send ?? null,
      recvFps: L.summary(ticks.map((t) => t.recv?.fps).filter((v) => v != null)),
      recvRes: [...new Set(ticks.map((t) => t.recv && `${t.recv.width}x${t.recv.height}`).filter(Boolean))],
      recvDecoder: last?.recv?.decoderImplementation ?? null, freezes: last?.recv?.freezeCount ?? null,
      cpuA: cpu['lab-a'].cpuPctMachine.median, cpuAByType: cpu['lab-a'].byType, gpuPct: gpu, prio,
    }
  } finally {
    await L.ev(b, () => window.__mediaLab.media.unwatch('lab-a')).catch(() => undefined)
    await L.ev(a, () => window.__mediaLab.media.stopScreenShare()).catch(() => undefined)
    game.stop()
    await L.sleep(1500)
  }
}

const brief = (r) =>
  `${r.mode}/${r.kind}: game ${r.gameFps} | capture ${r.capture?.fps} (uniq ${r.capture?.uniqueFps}) | source ${r.sourceFps.median} | enc ${r.encodedFps} sent ${r.sentFps} ${r.sendRes} ${r.kbps} kbps ql=${JSON.stringify(r.qualityLimitation)} ${r.encoder} | recv ${r.recvFps.median} ${r.recvRes} | cpu ${r.cpuA} % gpu ${r.gpuPct} % | ${r.diagnosis?.reason ?? ''}`

async function main() {
  mkdirSync(L.work, { recursive: true })
  if (!argv.includes('--no-build')) {
    L.log('building app…')
    const r = spawnSync('npm', ['run', 'build', '-w', 'apps/desktop'], { cwd: L.repo, stdio: 'inherit', shell: true })
    if (r.status !== 0) throw new Error('build failed')
  }
  const exe = buildGame()
  const sig = L.makeSignals()
  await L.startLiveKit()
  // A: real capture, listen-only, no fake devices. B: fake silent mic (Chromium hides decoderImplementation otherwise).
  const a = await L.launch('lab-a', sig.silence, FLAGS, false, HARNESS)
  const b = await L.launch('lab-b', sig.silence, FLAGS, true, HARNESS)
  a.token = await L.token('lab-a')
  b.token = await L.token('lab-b')
  await Promise.all([L.gotoLab(a), L.gotoLab(b)])
  // B stands for a viewer on another (idle) PC; here it shares the CPU with the game, so it gets ahead of it.
  await setPrio(b, 'PRIORITY_ABOVE_NORMAL')
  if (HEADROOM) await L.ev(a, (h) => (window.__mediaLab.media.captureHeadroom = h), Number(HEADROOM))
  await L.join_(b, true)
  await L.join_(a, false)
  const env = await L.ev(a, () => ({ screen: [screen.width * devicePixelRatio, screen.height * devicePixelRatio], dpr: devicePixelRatio, codec: window.__mediaLab.useMedia.getState().screen.codec }))
  const all = existsSync(outJson) ? JSON.parse(readFileSync(outJson, 'utf8')) : {}
  const out = (all[TAG] = { when: new Date().toISOString(), harnessFlags: HARNESS, flags: FLAGS, boost: !NO_BOOST, headroom: HEADROOM ? Number(HEADROOM) : 1.2, preset: PRESET, game: { iters: Number(ITERS), fpsCap: Number(GAME_FPS), cpuThreads: Number(GAME_CPU) }, env, cases: {} })
  const save = () => writeFileSync(outJson, JSON.stringify(all, null, 2) + '\n')
  for (const mode of MODES)
    for (const kind of KINDS) {
      L.log(`case ${mode}/${kind}…`)
      try {
        const r = await runCase(a, b, exe, mode, kind, env.screen[0])
        out.cases[`${mode}:${kind}`] = r
        L.log(brief(r))
      } catch (e) {
        out.cases[`${mode}:${kind}`] = { error: String(e?.message ?? e) }
        L.log(`${mode}/${kind} failed:`, e?.message ?? e)
      }
      save()
    }
  await L.close(a)
  await L.close(b)
}

try {
  await main()
} catch (e) {
  console.error(e)
  process.exitCode = 1
} finally {
  await L.cleanup()
}
