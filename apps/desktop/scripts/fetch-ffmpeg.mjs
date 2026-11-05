// Fetches the pinned LGPL (shared) ffmpeg build into build/ffmpeg: ffmpeg.exe, ffprobe.exe, the DLLs they import and LICENSE.txt.
// Pinned to an immutable BtbN release (never the moving "latest"). No-op when build/ffmpeg already matches.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const TAG = 'autobuild-2026-11-05-12-48'
const DIR = 'ffmpeg-n9.0.2-47-gb204e94e90-win64-lgpl-shared-9.0'
const URL = `https://github.com/BtbN/FFmpeg-Builds/releases/download/${TAG}/${DIR}.zip`
const ZIP_SHA256 = 'a6103833b86a94057c9d99cb8211ae7d3742153566cdbaedefeb9c5e36ca2a7c'
// ffplay and the headers/libs are dropped; avdevice-63.dll stays (ffmpeg.exe fails to start without it).
const BIN_FILES = ['ffmpeg.exe', 'ffprobe.exe', 'avcodec-63.dll', 'avdevice-63.dll', 'avfilter-12.dll', 'avformat-63.dll', 'avutil-61.dll', 'swresample-7.dll', 'swscale-10.dll']

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'build', 'ffmpeg')
const stamp = join(out, '.pinned')
const sha = (buf) => createHash('sha256').update(buf).digest('hex')

if (existsSync(stamp) && readFileSync(stamp, 'utf8').trim() === ZIP_SHA256 && [...BIN_FILES, 'LICENSE.txt'].every((f) => existsSync(join(out, f)))) {
  console.log('ffmpeg: up to date')
  process.exit(0)
}

const tmp = mkdtempSync(join(tmpdir(), 'alga-ffmpeg-'))
try {
  console.log(`ffmpeg: downloading ${URL}`)
  const res = await fetch(URL)
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`)
  const zip = Buffer.from(await res.arrayBuffer())
  if (sha(zip) !== ZIP_SHA256) throw new Error('ffmpeg zip SHA-256 mismatch: refusing to use it')
  const zipPath = join(tmp, 'ffmpeg.zip')
  writeFileSync(zipPath, zip)
  // bsdtar ships with Windows 10+ and reads zip; args as an array, no shell.
  const members = [...BIN_FILES.map((f) => `${DIR}/bin/${f}`), `${DIR}/LICENSE.txt`]
  const x = spawnSync(join(process.env.SystemRoot ?? 'C:\Windows', 'System32', 'tar.exe'), ['-xf', zipPath, '-C', tmp, ...members], { stdio: 'inherit' })
  if (x.status !== 0) throw new Error('tar extraction failed')

  const conf = spawnSync(join(tmp, DIR, 'bin', 'ffmpeg.exe'), ['-buildconf'], { encoding: 'utf8' })
  if (conf.status !== 0) throw new Error(`extracted ffmpeg.exe does not run (${conf.status}, ${conf.error ?? ''})`)
  if (/--enable-(gpl|nonfree)\b/.test(conf.stdout + conf.stderr)) throw new Error('ffmpeg build is not LGPL-only: refusing')

  rmSync(out, { recursive: true, force: true })
  mkdirSync(out, { recursive: true })
  for (const f of BIN_FILES) copyFileSync(join(tmp, DIR, 'bin', f), join(out, f))
  copyFileSync(join(tmp, DIR, 'LICENSE.txt'), join(out, 'LICENSE.txt'))
  writeFileSync(join(out, 'SOURCE.txt'), `FFmpeg (LGPL-3.0 build, BtbN/FFmpeg-Builds ${TAG})\nBuild + source: https://github.com/BtbN/FFmpeg-Builds/releases/tag/${TAG}\nFFmpeg source: https://ffmpeg.org/releases/ (n9.0.2) / https://git.ffmpeg.org/ffmpeg.git\n`)
  writeFileSync(stamp, ZIP_SHA256)
  console.log(`ffmpeg: ready in ${out}`)
} finally {
  if (!process.env.KEEP) rmSync(tmp, { recursive: true, force: true })
}
