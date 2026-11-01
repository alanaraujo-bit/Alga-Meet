// Capturas de verificação do site: cada seção em 390, 768, 1440 e 1920 + um vídeo de rolagem por largura.
// Saída: docs/site/screenshots/<data>-<seção>-<largura>-vN.png (N cresce, histórico preservado) e docs/site/videos/.
// Uso: node apps/site/scripts/shoot.mjs [url=http://localhost:3100] [--tier=a|b|c] [--only=hero,voz] [--widths=390,1440] [--no-video]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith(`--${k}=`)) || '').split('=')[1] || d;
const base = args.find((a) => !a.startsWith('--')) || 'http://localhost:3100';
const tier = opt('tier', '');
const only = opt('only', '').split(',').filter(Boolean);
const video = !args.includes('--no-video');
const WIDTHS = { 390: 844, 768: 1024, 1440: 900, 1920: 1080 };
const widths = opt('widths', '').split(',').filter(Boolean).map(Number);
const SECTIONS = [
  ['hero', '#topo'], ['voz', '#voz'], ['tela', '#tela'], ['leve', '#leve'], ['grupo', '#grupo'],
  ['privacidade', '#privacidade'], ['plus', '#plus'], ['faq', '#faq'], ['final', '.final'],
].filter(([n]) => !only.length || only.includes(n));
const date = new Date().toISOString().slice(0, 10);
const shotsDir = path.join(root, 'docs/site/screenshots');
const vidDir = path.join(root, 'docs/site/videos');
fs.mkdirSync(shotsDir, { recursive: true });
fs.mkdirSync(vidDir, { recursive: true });
const existing = fs.readdirSync(shotsDir);
const nextV = (stem) => 1 + Math.max(0, ...existing.filter((f) => f.startsWith(stem + '-v')).map((f) => Number(f.slice(stem.length + 2).replace('.png', '')) || 0));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const url = base + (tier ? `/?tier=${tier}` : '/');
const errors = [];

const browser = await chromium.launch();
for (const [w, h] of Object.entries(WIDTHS).map(([w, h]) => [Number(w), h]).filter(([w]) => !widths.length || widths.includes(w))) {
  const mobile = w < 768;
  const ctx = await browser.newContext({
    viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: mobile, hasTouch: w <= 768,
    ...(video ? { recordVideo: { dir: vidDir, size: { width: w, height: h } } } : {}),
  });
  const p = await ctx.newPage();
  p.on('console', (m) => m.type() === 'error' && errors.push(`${w}: ${m.text()}`));
  p.on('pageerror', (e) => errors.push(`${w}: ${e.message}`));
  await p.goto(url, { waitUntil: 'networkidle' });
  await sleep(1200);
  // rolagem lenta até o fim (dispara as revelações e grava o vídeo)
  const step = Math.round(h * 0.1);
  for (let i = 0; i < 600; i++) {
    try {
      if (mobile) await p.evaluate((s) => scrollBy(0, s), step); else await p.mouse.wheel(0, step);
      await sleep(60);
      if (await p.evaluate(() => scrollY + innerHeight >= document.documentElement.scrollHeight - 2)) break;
    } catch {
      // o dev server recarregou a página (HMR): espera e continua do ponto em que ela voltar
      await p.waitForLoadState('networkidle');
    }
  }
  await sleep(800);
  for (const [name, sel] of SECTIONS) {
    const el = p.locator(sel).first();
    await el.evaluate((n) => n.scrollIntoView({ block: 'start' }));
    await sleep(900);
    const stem = `${date}-${name}-${w}`;
    const file = path.join(shotsDir, `${stem}-v${nextV(stem)}.png`);
    await el.screenshot({ path: file });
    console.log(path.relative(root, file));
  }
  const vpath = video ? await p.video().path() : null;
  await ctx.close();
  if (vpath) {
    const stem = `${date}-scroll-${w}${tier ? '-tier-' + tier : ''}`;
    const n = 1 + fs.readdirSync(vidDir).filter((f) => f.startsWith(stem + '-v')).length;
    const dest = path.join(vidDir, `${stem}-v${n}.webm`);
    fs.renameSync(vpath, dest);
    console.log(path.relative(root, dest));
  }
}
await browser.close();
console.log(errors.length ? 'ERROS:\n' + errors.join('\n') : 'sem erros no console');
