// Capturas dos momentos do v2: quadros em pontos do capítulo + um vídeo curto da rolagem por largura.
// Uso: node apps/site/scripts/moments.mjs <nome> <seletor> [--at=0,0.25,0.5] [--url=http://localhost:3100] [--tier=a] [--widths=1440,390] [--no-video] [--wait=1500]
// Saída: docs/site/v2/<nome>-<largura>-<ponto>.jpg e docs/site/v2/<nome>-<largura>.webm (vídeos fora do git).
// GPU de verdade no headless (ANGLE/D3D11): sem isso o WebGL cai no SwiftShader e o fps não diz nada.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith(`--${k}=`)) || '').split('=').slice(1).join('=') || d;
const [name = 'hero', sel = '[data-hero]'] = args.filter((a) => !a.startsWith('--'));
const at = opt('at', '0,0.5,1').split(',').map(Number);
const base = opt('url', 'http://localhost:3100');
const tier = opt('tier', 'a');
const widths = opt('widths', '1440,390').split(',').map(Number);
const wait = Number(opt('wait', '1500'));
const video = !args.includes('--no-video');
const SIZES = { 390: 844, 768: 1024, 1440: 900, 1920: 1080 };
const out = path.join(root, 'docs/site/v2');
fs.mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const errors = [];
for (const w of widths) {
  const h = SIZES[w] || 900;
  const mobile = w < 768;
  const ctx = await browser.newContext({
    viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile,
    ...(video ? { recordVideo: { dir: out, size: { width: w, height: h } } } : {}),
  });
  const p = await ctx.newPage();
  p.on('console', (m) => m.type() === 'error' && errors.push(`${w}: ${m.text()}`));
  p.on('pageerror', (e) => errors.push(`${w}: ${e.message}`));
  await p.goto(`${base}/?tier=${tier}`, { waitUntil: 'networkidle' });
  const gpu = await p.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl');
    const i = gl?.getExtension('WEBGL_debug_renderer_info');
    return i ? gl.getParameter(i.UNMASKED_RENDERER_WEBGL) : 'sem webgl';
  });
  console.log(w, 'GPU:', gpu);
  await sleep(wait);
  const range = await p.evaluate((s) => {
    const el = document.querySelector(s);
    const r = el.getBoundingClientRect();
    return { top: r.top + scrollY, len: Math.max(1, el.offsetHeight - innerHeight) };
  }, sel);
  // vídeo: rolagem contínua pelo capítulo
  if (video) {
    await p.evaluate((y) => scrollTo(0, y), range.top);
    await sleep(600);
    const steps = 90;
    for (let i = 0; i <= steps; i++) {
      const y = range.top + (range.len * i) / steps;
      if (mobile) await p.evaluate((yy) => scrollTo(0, yy), y);
      else await p.mouse.wheel(0, range.len / steps);
      await sleep(70);
    }
    await sleep(800);
  }
  for (const a of at) {
    await p.evaluate((y) => scrollTo(0, y), range.top + range.len * a);
    await sleep(Math.max(900, wait / 2));
    const file = path.join(out, `${name}-${w}-${String(a).replace('.', '_')}.jpg`);
    await p.screenshot({ path: file, type: 'jpeg', quality: 84 });
    console.log(path.relative(root, file));
  }
  // fps medido no próprio navegador por 2 s, no meio do capítulo
  await p.evaluate((y) => scrollTo(0, y), range.top + range.len * 0.5);
  const fps = await p.evaluate(() => new Promise((res) => {
    let n = 0; const t0 = performance.now(); const times = []; let last = t0;
    const f = (t) => { times.push(t - last); last = t; n++; if (t - t0 < 2000) requestAnimationFrame(f); else { times.sort((a, b) => a - b); res({ fps: Math.round((n * 1000) / (t - t0)), p95ms: times[Math.floor(times.length * 0.95)].toFixed(1) }); } };
    requestAnimationFrame(f);
  }));
  console.log(w, 'fps', fps);
  const vpath = video ? await p.video().path() : null;
  await ctx.close();
  if (vpath) { const dest = path.join(out, `${name}-${w}.webm`); fs.rmSync(dest, { force: true }); fs.renameSync(vpath, dest); console.log(path.relative(root, dest)); }
}
await browser.close();
console.log(errors.length ? 'ERROS:\n' + [...new Set(errors)].join('\n') : 'sem erros no console');
