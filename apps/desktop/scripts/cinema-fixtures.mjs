#!/usr/bin/env node
// Generates 20 s cinema fixtures (testsrc2 + one sine per channel) with the ffmpeg on PATH.
// Dev tool only: a GPL ffmpeg is fine here, nothing it makes or links is distributed.
//
//   node apps/desktop/scripts/cinema-fixtures.mjs
//
// Output: apps/desktop/test-fixtures/cinema/ (gitignored). Every channel carries its own tone, so a
// player test can tell "all channels arrived" from "only the front pair played".
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const out = resolve(dirname(fileURLToPath(import.meta.url)), '../test-fixtures/cinema')
mkdirSync(out, { recursive: true })

/** Channel tones in Hz, in FFmpeg channel order (FL FR FC LFE BL BR [SL SR]). */
export const TONES = { 6: [440, 550, 660, 60, 770, 880], 8: [440, 550, 660, 60, 770, 880, 990, 1100] }
const LAYOUT = { 6: '5.1', 8: '7.1' }
const D = 20
const lavfiVideo = `testsrc2=size=1920x1080:rate=24:duration=${D}`
const lavfiAudio = (n) => `aevalsrc=${TONES[n].map((f) => `0.25*sin(2*PI*${f}*t)`).join('|')}:c=${LAYOUT[n]}:s=48000:d=${D}`

function ff(name, args) {
  const file = join(out, name)
  const r = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args, file], { encoding: 'utf8' })
  if (r.status !== 0) {
    console.log(`SKIP ${name}: ${r.stderr.trim().split('\n').slice(-2).join(' | ')}`)
    return
  }
  console.log(`ok   ${name}`)
}
const inputs = (n) => ['-f', 'lavfi', '-i', lavfiVideo, '-f', 'lavfi', '-i', lavfiAudio(n)]
const gop = ['-g', '48', '-keyint_min', '48']

ff('h264-ac3-51.mkv', [...inputs(6), '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', ...gop, '-c:a', 'ac3', '-b:a', '640k'])
ff('hevc10-hdr10-eac3-51.mkv', [
  ...inputs(6), '-c:v', 'libx265', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p10le',
  '-x265-params', `keyint=48:min-keyint=48:colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc:hdr10=1:repeat-headers=1:master-display=G(13250,34500)B(7500,3000)R(34000,16000)WP(15635,16450)L(10000000,1):max-cll=1000,400`,
  '-c:a', 'eac3', '-b:a', '640k',
])
ff('hevc10-truehd-71.mkv', [...inputs(8), '-c:v', 'libx265', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p10le', '-x265-params', 'keyint=48:min-keyint=48', '-c:a', 'truehd', '-strict', '-2'])
ff('av1-opus-51.mkv', [...inputs(6), '-c:v', 'libsvtav1', '-preset', '10', '-g', '48', '-pix_fmt', 'yuv420p', '-c:a', 'libopus', '-b:a', '384k', '-mapping_family', '1'])
ff('h264-dts-51.mkv', [...inputs(6), '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', ...gop, '-c:a', 'dca', '-strict', '-2', '-b:a', '1536k'])
ff('mpeg2-mp2.mkv', ['-f', 'lavfi', '-i', lavfiVideo, '-f', 'lavfi', '-i', 'sine=frequency=440:duration=20', '-c:v', 'mpeg2video', '-q:v', '4', '-c:a', 'mp2', '-b:a', '192k'])

// Subtitles: SRT + ASS tracks and an attached font (the ASS style uses it).
const srt = join(out, '.sub.srt')
const ass = join(out, '.sub.ass')
const font = join(out, '.font.ttf')
writeFileSync(srt, '1\n00:00:01,000 --> 00:00:05,000\nLegenda SRT\n\n2\n00:00:06,000 --> 00:00:10,000\nSegunda linha\n')
writeFileSync(ass, `[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,64,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,3,0,2,10,10,40,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:05.00,Default,,0,0,0,,Legenda ASS {\i1}estilizada{\i0}\n`)
const sysFont = join(process.env.WINDIR ?? 'C:\Windows', 'Fonts', 'arial.ttf')
if (existsSync(sysFont)) copyFileSync(sysFont, font)
ff('h264-aac-srt-ass.mkv', [
  ...inputs(6), '-i', srt, '-i', ass,
  ...(existsSync(font) ? ['-attach', font, '-metadata:s:t:0', 'mimetype=application/x-truetype-font', '-metadata:s:t:0', 'filename=arial.ttf'] : []),
  '-map', '0:v', '-map', '1:a', '-map', '2', '-map', '3',
  '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', ...gop, '-c:a', 'aac', '-b:a', '640k', '-c:s:0', 'srt', '-c:s:1', 'ass',
  '-metadata:s:s:0', 'language=por', '-metadata:s:s:1', 'language=eng',
])


// --long: 10-minute files for throughput numbers (20 s is mostly process start-up). Looped stream copies of a
// short encode, so they cost seconds to make: 1080p H.264 + AC-3 5.1, and 4K HEVC Main10 + E-AC-3 5.1 at ~25 Mbps.
if (process.argv.includes('--long')) {
  ff('long-h264-1080p-10min.mkv', ['-stream_loop', '29', '-i', join(out, 'h264-ac3-51.mkv'), '-c', 'copy'])
  const k4 = join(out, '.4k-20s.mkv')
  spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc2=size=3840x2160:rate=24:duration=${D}`, '-f', 'lavfi', '-i', lavfiAudio(6), '-c:v', 'libx265', '-preset', 'ultrafast', '-b:v', '25M', '-pix_fmt', 'yuv420p10le', '-x265-params', 'keyint=48:min-keyint=48', '-c:a', 'eac3', '-b:a', '640k', k4])
  ff('long-hevc10-4k-10min.mkv', ['-stream_loop', '29', '-i', k4, '-c', 'copy'])
}

// Dolby Vision profile 5 needs an RPU that ffmpeg/x265 here cannot synthesise: recorded as untested.
console.log('NOTE dv-p5.mp4 not generated: no local tool writes a DV profile 5 RPU -> "não testado"')
console.log(`\n${readdirSync(out).filter((f) => !f.startsWith('.')).length} files in ${out}`)
