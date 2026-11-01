// Gera a imagem de compartilhamento (1200×630) a partir do próprio hero, no nível C (estático).
// Uso: com o site rodando (dev ou preview): node apps/site/scripts/og.mjs [url=http://localhost:3100]
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/og.jpg');
const base = process.argv[2] || 'http://localhost:3100';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await p.goto(base + '/?tier=c', { waitUntil: 'networkidle' });
await p.addStyleTag({ content: '.nav,.ctas{display:none!important}.hero{padding-top:72px!important}' });
await p.waitForTimeout(300);
await p.screenshot({ path: out, type: 'jpeg', quality: 88 });
await b.close();
console.log(out);
