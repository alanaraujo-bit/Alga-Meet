// Fotos do jogo da lente para os níveis B e C: o MESMO quadro em 1080p (1920×1080) e 720p (1280×720),
// tiradas do próprio WebGL (src/scripts/lens/game.ts → snapshot). Saída: src/assets/game/frame-{1080,720}.png
// Uso (com o dev server ou o preview no ar): node apps/site/scripts/game-stills.mjs [url] [t=12.4]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = process.argv[2] || 'http://localhost:3100';
const t = Number(process.argv[3] || 12.4);
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto(`${url}/?tier=a`, { waitUntil: 'networkidle' });
await p.evaluate(() => document.querySelector('[data-lens-host]').scrollIntoView());
await p.waitForFunction(() => document.querySelector('[data-lens-host]')?.__game, null, { timeout: 15000 });
await p.waitForTimeout(800);
const shot = await p.evaluate((tt) => document.querySelector('[data-lens-host]').__game.snapshot(tt), t);
for (const [k, name] of [['hi', 'frame-1080.png'], ['lo', 'frame-720.png']]) {
  const file = path.join(root, 'src/assets/game', name);
  fs.writeFileSync(file, Buffer.from(shot[k].split(',')[1], 'base64'));
  console.log(path.relative(root, file));
}
await browser.close();
