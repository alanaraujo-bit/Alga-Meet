// Vídeos (nível B) e quadros parados (nível C) dos momentos, gravados do PRÓPRIO WebGL do nível A.
// Saída: public/media/<momento>.mp4 (H.264, sem áudio, faststart) e src/assets/media/<momento>.png (o Astro gera AVIF/WebP).
// Uso (dev server ou preview no ar): node apps/site/scripts/tier-media.mjs [url] [--only=hero,room,leve,final]
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith('--')) || 'http://localhost:3100';
const only = ((args.find((a) => a.startsWith('--only=')) || '').split('=')[1] || '').split(',').filter(Boolean);
const tmp = path.join(site, 'node_modules/.cache/tier-media');
const pub = path.join(site, 'public/media');
const assets = path.join(site, 'src/assets/media');
for (const d of [tmp, pub, assets]) fs.mkdirSync(d, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ff = (...a) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...a], { stdio: 'inherit' });

// Só o canvas: esconde o texto e a interface por cima (o nível B mostra o vídeo atrás do HTML de verdade).
const HIDE_ALL = 'body > *:not(canvas.world), .nav { visibility: hidden !important; } canvas.world { visibility: visible !important; }';

const CLIPS = {
  // Abertura: as frondes balançando na luz (recorte em retrato na região das frondes), ida e volta para emendar sem corte.
  hero: { w: 1440, h: 900, css: HIDE_ALL, settle: 7000, rec: 5200, crop: 'crop=600:900:740:0,scale=480:720', boomerang: true, still: 'last' },
  // A sala: a conversa inteira em tempo real (legendas e nomes entram no vídeo).
  room: {
    w: 1280, h: 720, settle: 1800, rec: 13200, crop: 'scale=960:540', still: 9.3,
    css: '.room-head, .listen, .latency, .nav { visibility: hidden !important; }',
    prep: async (p) => {
      await p.evaluate(() => { const ch = document.querySelector('[data-room-ch]'); scrollTo(0, ch.getBoundingClientRect().top + scrollY + (ch.offsetHeight - innerHeight) * 0.235); });
      await sleep(2500);
    },
    go: async (p) => { await p.evaluate(() => document.querySelector('[data-listen]').click()); },
  },
  // Leveza: a rolagem atravessa o capítulo devagar (a esfera afunda, a bolha sobe).
  leve: {
    w: 1440, h: 900, settle: 1500, rec: 7000, crop: 'crop=900:900:540:0,scale=600:600', still: 'last',
    css: '.nav, [data-float-stage] .copy { visibility: hidden !important; }',
    prep: async (p) => { await p.evaluate(() => { const c = document.querySelector('[data-float-ch]'); scrollTo(0, c.getBoundingClientRect().top + scrollY); }); await sleep(1500); },
    go: (p) => scrub(p, '[data-float-ch]', 0, 0.8, 6200),
  },
  // Fechamento: a superfície se abre para o horizonte e as frondes se encontram.
  final: {
    w: 1440, h: 900, settle: 1500, rec: 6200, crop: 'scale=960:600', still: 'last',
    css: HIDE_ALL,
    prep: async (p) => { await p.evaluate(() => { const c = document.querySelector('[data-final]'); scrollTo(0, c.getBoundingClientRect().top + scrollY - innerHeight); }); await sleep(1500); },
    go: (p) => scrub(p, '[data-final]', 0, 0.62, 5200, true),
  },
};

async function scrub(p, sel, a, b, ms, fromBelow = false) {
  const steps = Math.round(ms / 40);
  for (let i = 0; i <= steps; i++) {
    await p.evaluate(([s, k, fb]) => {
      const c = document.querySelector(s);
      const top = c.getBoundingClientRect().top + scrollY;
      const start = fb ? top - innerHeight : top;
      const len = fb ? c.offsetHeight : c.offsetHeight - innerHeight;
      scrollTo(0, start + len * k);
    }, [sel, a + ((b - a) * i) / steps, fromBelow]);
    await sleep(40);
  }
}

const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
for (const [name, c] of Object.entries(CLIPS)) {
  if (only.length && !only.includes(name)) continue;
  const ctx = await browser.newContext({ viewport: { width: c.w, height: c.h }, deviceScaleFactor: 1, recordVideo: { dir: tmp, size: { width: c.w, height: c.h } } });
  const p = await ctx.newPage();
  const t0 = Date.now();
  await p.goto(`${url}/?tier=a`, { waitUntil: 'networkidle' });
  await p.addStyleTag({ content: c.css });
  if (c.prep) await c.prep(p);
  await sleep(c.settle);
  const start = (Date.now() - t0) / 1000;
  if (c.go) await c.go(p);
  await sleep(Math.max(0, c.rec - (c.go ? 0 : 0)));
  const dur = (Date.now() - t0) / 1000 - start;
  const raw = await p.video().path();
  await ctx.close();
  const cut = path.join(tmp, `${name}-cut.mp4`);
  ff('-ss', String(start), '-t', String(Math.min(dur, c.rec / 1000 + (c.go === undefined ? 0 : 0.2))), '-i', raw, '-vf', `${c.crop},fps=30`, '-an', '-c:v', 'libx264', '-crf', '14', '-preset', 'fast', cut);
  const out = path.join(pub, `${name}.mp4`);
  const enc = ['-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '29', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-movflags', '+faststart'];
  if (c.boomerang) ff('-i', cut, '-filter_complex', '[0]split[a][b];[b]reverse[r];[a][r]concat=n=2:v=1', ...enc, out);
  else ff('-i', cut, ...enc, out);
  const still = path.join(assets, `${name}.png`);
  if (c.still === 'last') ff('-sseof', '-0.1', '-i', cut, '-frames:v', '1', '-update', '1', still);
  else ff('-ss', String(c.still), '-i', cut, '-frames:v', '1', still);
  console.log(name, (fs.statSync(out).size / 1024).toFixed(0) + ' KB', path.relative(site, out), path.relative(site, still));
}
await browser.close();
