// fps do nível A por momento, com GPU de verdade (ANGLE/D3D11) e CPU sem limite e 4× mais lenta (CDP).
// Rola cada capítulo devagar por ~3 s e mede os quadros pelo requestAnimationFrame da página.
// Uso: node apps/site/scripts/fps.mjs [url=http://localhost:3102] [--width=1440]
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith('--')) || 'http://localhost:3102';
const width = Number((args.find((a) => a.startsWith('--width=')) || '').split('=')[1] || 1440);
const height = width < 768 ? 844 : 900;
const MOMENTS = [['abertura', '[data-hero]', 0, 0.35], ['explodida', '[data-hero]', 0.45, 0.8], ['sala', '[data-room-ch]', 0.15, 0.85], ['lente', '#tela', 0.15, 0.45], ['leveza', '[data-float-ch]', 0.05, 0.9], ['superfície', '[data-final]', 0.1, 0.9]];

const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
for (const rate of [1, 4]) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: width < 768 ? 2 : 1, isMobile: width < 768, hasTouch: width < 768 });
  const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  await p.goto(`${url}/?tier=a`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(3000);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
  const row = [];
  for (const [name, sel, a, b] of MOMENTS) {
    const r = await p.evaluate(async ([s, a, b]) => {
      const el = document.querySelector(s);
      const top = el.getBoundingClientRect().top + scrollY;
      const len = Math.max(innerHeight, el.offsetHeight - innerHeight);
      scrollTo(0, top + len * a);
      await new Promise((r) => setTimeout(r, 600));
      const times = [];
      let last = performance.now();
      const t0 = last;
      await new Promise((res) => {
        const f = (t) => {
          times.push(t - last); last = t;
          const k = (t - t0) / 3000;
          scrollTo(0, top + len * (a + (b - a) * Math.min(1, k)));
          if (k < 1) requestAnimationFrame(f); else res();
        };
        requestAnimationFrame(f);
      });
      times.sort((x, y) => x - y);
      return { fps: Math.round((times.length * 1000) / (performance.now() - t0)), p95: +times[Math.floor(times.length * 0.95)].toFixed(1) };
    }, [sel, a, b]);
    row.push(`${name} ${r.fps} fps (p95 ${r.p95} ms)`);
  }
  console.log(`${width}px CPU ${rate}×: ` + row.join(' · '));
  await ctx.close();
}
await browser.close();
