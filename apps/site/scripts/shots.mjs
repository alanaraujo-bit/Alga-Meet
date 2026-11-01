// Copia capturas reais do app (docs/screenshots) para src/assets/shots, cobrindo o selo "shots"
// que o script de captura do desktop põe na title bar. O Astro gera AVIF/WebP/srcset no build.
// Também gera o par do comparador de resolução (mesmo recorte em 1080p e reduzido a 720p).
// Uso: node apps/site/scripts/shots.mjs
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const src = (f) => path.join(root, 'docs/screenshots', f);
const out = (f) => path.join(root, 'apps/site/src/assets/shots', f);

// [arquivo de origem, destino, retângulo do selo em px da imagem, recorte final opcional]
const SHOTS = [
  ['2026-11-01-shell-1920x1080@125-v2-indigo-v2.png', 'chat.png', { left: 150, top: 8, width: 80, height: 34 }],
  // Palco de voz: só os tiles e o dock (o resto da tela é vazio de propósito no app).
  ['2026-11-01-voice-stage-1920x1080@125-v2-indigo-v2.png', 'stage-crop.png', { left: 150, top: 8, width: 80, height: 34 }, { left: 395, top: 300, width: 1510, height: 760 }],
];

for (const [from, to, r, cut] of SHOTS) {
  const img = sharp(src(from));
  // cor do fundo da title bar logo à direita do selo
  const { data } = await img.clone().extract({ left: r.left + r.width + 6, top: r.top + Math.floor(r.height / 2), width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
  const background = { r: data[0], g: data[1], b: data[2] };
  const patch = await sharp({ create: { width: r.width, height: r.height, channels: 3, background } }).png().toBuffer();
  const masked = await img.composite([{ input: patch, left: r.left, top: r.top }]).png().toBuffer();
  await (cut ? sharp(masked).extract(cut) : sharp(masked)).png({ compressionLevel: 9 }).toFile(out(to));
  console.log('ok', to, background);
}

// Comparador: recorte 960×540 do quadro 1080p e o mesmo recorte do quadro reduzido a 720p (640×360).
const frame = await sharp(out('chat.png')).toBuffer();
const crop = { left: 384, top: 250, width: 960, height: 540 };
await sharp(frame).extract(crop).png().toFile(out('res-1080.png'));
const f720 = await sharp(frame).resize(1280, 720, { kernel: 'lanczos3' }).toBuffer();
const k = 1280 / 1920;
await sharp(f720)
  .extract({ left: Math.round(crop.left * k), top: Math.round(crop.top * k), width: Math.round(crop.width * k), height: Math.round(crop.height * k) })
  .png().toFile(out('res-720.png'));
console.log('ok res-1080.png res-720.png');
