// Lighthouse no build de produção (astro preview), celular (Moto G Power, 4G lento simulado, CPU 4×) e desktop.
// Uso: npm run build -w apps/site && (astro preview --port 3102 &) && node apps/site/scripts/lighthouse.mjs [url] [--tier=a|b|c]
// Saída: resumo no terminal + JSON em docs/site/lighthouse/<data>-<form>[-tier].json
import lighthouse from 'lighthouse';
import * as chromeLauncher from 'chrome-launcher';
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const args = process.argv.slice(2);
const base = args.find((a) => !a.startsWith('--')) || 'http://localhost:3102';
const tier = (args.find((a) => a.startsWith('--tier=')) || '').split('=')[1];
const url = base + '/' + (tier ? `?tier=${tier}` : '');
const outDir = path.join(root, 'docs/site/lighthouse');
fs.mkdirSync(outDir, { recursive: true });
const date = new Date().toISOString().slice(0, 10);

const chrome = await chromeLauncher.launch({ chromePath: chromium.executablePath(), chromeFlags: ['--headless=new', '--no-sandbox'] });
try {
  for (const form of ['mobile', 'desktop']) {
    const config = form === 'desktop'
      ? { extends: 'lighthouse:default', settings: { preset: 'desktop', formFactor: 'desktop', screenEmulation: { mobile: false, width: 1350, height: 940, deviceScaleFactor: 1, disabled: false }, throttling: { rttMs: 40, throughputKbps: 10240, cpuSlowdownMultiplier: 1 } } }
      : { extends: 'lighthouse:default' };
    const r = await lighthouse(url, { port: chrome.port, output: 'json', logLevel: 'error', onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'] }, config);
    const lhr = r.lhr;
    const a = lhr.audits;
    const sum = {
      url, form, tier: tier || 'auto',
      performance: Math.round(lhr.categories.performance.score * 100),
      accessibility: Math.round(lhr.categories.accessibility.score * 100),
      bestPractices: Math.round(lhr.categories['best-practices'].score * 100),
      seo: Math.round(lhr.categories.seo.score * 100),
      fcp: a['first-contentful-paint'].displayValue,
      lcp: a['largest-contentful-paint'].displayValue,
      tbt: a['total-blocking-time'].displayValue,
      cls: a['cumulative-layout-shift'].displayValue,
      si: a['speed-index'].displayValue,
      bytes: Math.round(a['total-byte-weight'].numericValue / 1024) + ' KiB',
      lcpElement: a['largest-contentful-paint-element']?.details?.items?.[0]?.items?.[0]?.node?.snippet,
      a11y: lhr.categories.accessibility.auditRefs.map((r) => a[r.id]).filter((x) => x.score === 0).map((x) => ({ id: x.id, nodes: (x.details?.items || []).slice(0, 6).map((i) => i.node?.snippet) })),
      failed: Object.values(a).filter((x) => x.score !== null && x.score < 0.9 && x.scoreDisplayMode !== 'informative' && x.scoreDisplayMode !== 'notApplicable').map((x) => x.id),
    };
    console.log(JSON.stringify(sum));
    fs.writeFileSync(path.join(outDir, `${date}-${form}${tier ? '-tier-' + tier : ''}.json`), JSON.stringify(sum, null, 2));
  }
} finally {
  await chrome.kill();
}
