import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { open } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { CinemaAudioTrack, CinemaFilm } from '@alga/shared'

// One ffmpeg run of the piece factory (pieces.ts): its command line, its playlist, reading its segments.

export const HLS_TIME_S = 4
/** The moof (with tfdt) sits in the first few KiB of a segment. */
const HEAD_BYTES = 256 * 1024
/** Opus mapping family 1 (Vorbis order) layouts by channel count; libopus refuses the 5.1(side)/7.1(wide) variants. */
const OPUS_LAYOUTS = ['', 'mono', 'stereo', '3.0', 'quad', '5.0', '5.1', '6.1', '7.1']
/** ffmpeg on Windows puts the HLS init segment in the cwd when the paths use backslashes. */
const ff = (p: string) => p.replace(/\\/g, '/')

function audioArgs(a: CinemaAudioTrack): string[] {
  const ch = Math.min(Math.max(a.channels, 1), 8)
  switch (a.out) {
    case 'copy': return ['-c:a', 'copy', '-copypriorss', '0'] // no packets before the seek point: continuations do not overlap
    case 'aac': return ['-c:a', 'aac', '-b:a', '640k', '-ac', String(ch)]
    // ~96 kbps per channel (576k for 5.1, 768k for 7.1); > 8 source channels are downmixed to 7.1 by the layout.
    case 'opus': return ['-af', `aformat=channel_layouts=${OPUS_LAYOUTS[ch]}`, '-c:a', 'libopus', '-b:a', `${96 * ch}k`, '-mapping_family', '1']
    case 'flac': return ['-c:a', 'flac', ...(ch === 8 ? ['-ac', '8'] : [])]
  }
}

export interface RunSpec {
  path: string; film: CinemaFilm; videoStreamIndex: number; audio: CinemaAudioTrack | null; readRate?: number
  /** Run number in the track (names its files) and first piece number. */
  k: number; n: number
  /** -ss value (0: none) and -to value in the stream's own clock (null: to the end). */
  seek: number; to: number | null
  dir: string; playlist: string; initFile: string
}

/** HLS fMP4 run: absolute timestamps (-copyts, frag_discont), segments `r<k>-<n>.m4s` from n on. */
export function runArgs(s: RunSpec): string[] {
  const media = s.audio
    ? ['-map', `0:a:${s.audio.id}`, ...audioArgs(s.audio)]
    : ['-map', `0:${s.videoStreamIndex}`, '-c:v', 'copy', ...(s.film.videoCodec === 'hevc' ? ['-tag:v', 'hvc1'] : []), '-avoid_negative_ts', 'disabled']
  return [
    '-v', 'error', '-y', '-copyts', '-start_at_zero', ...(s.readRate ? ['-readrate', String(s.readRate)] : []),
    ...(s.seek > 0 ? ['-ss', s.seek.toFixed(3)] : []), '-i', s.path, ...media, ...(s.to === null ? [] : ['-to', s.to.toFixed(3)]),
    '-f', 'hls', '-hls_segment_type', 'fmp4', '-hls_time', String(HLS_TIME_S), '-hls_playlist_type', 'event',
    '-hls_flags', 'independent_segments+temp_file', '-hls_segment_options', 'movflags=+frag_discont',
    '-start_number', String(s.n), '-hls_fmp4_init_filename', basename(s.initFile),
    '-hls_segment_filename', ff(join(s.dir.replace(/%/g, '%%'), `r${s.k}-%d.m4s`)), ff(s.playlist),
  ]
}

/** Entries of run `k`'s playlist; segment files are `r<k>-<n>.m4s`, so a lingering killed run never collides with the next. */
export function parsePlaylist(text: string, k: number): { durS: number; name: string; n: number }[] {
  const out: { durS: number; name: string; n: number }[] = []
  let dur: number | null = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    const m = /^r(\d+)-(\d+)\.m4s$/.exec(line)
    if (line.startsWith('#EXTINF:')) dur = Number.parseFloat(line.slice(8))
    else if (dur !== null && m && Number(m[1]) === k) {
      out.push({ durS: dur, name: line, n: Number(m[2]) })
      dur = null
    }
  }
  return out
}

/** Streams the file through SHA-256: big segments never block the main process. */
export async function hashFile(file: string): Promise<string> {
  const h = createHash('sha256')
  for await (const chunk of createReadStream(file)) h.update(chunk as Buffer)
  return h.digest('hex')
}

/** The first bytes of a segment (enough for its moof). */
export async function head(file: string): Promise<Uint8Array> {
  const fh = await open(file, 'r')
  try {
    const b = Buffer.alloc(HEAD_BYTES)
    const { bytesRead } = await fh.read(b, 0, HEAD_BYTES, 0)
    return b.subarray(0, bytesRead)
  } finally {
    await fh.close()
  }
}
