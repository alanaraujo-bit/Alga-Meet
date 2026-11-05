/**
 * Soundboard (spec: docs/superpowers/specs/2026-11-04-soundboard-design.md).
 *
 * GET    /spaces/:id/sounds                    -> SpaceSound[]                (members)
 * POST   /spaces/:id/sounds                    multipart: file (WAV, see parseWav) + payload_json (SoundMetaBody)
 *                                              -> 201 SpaceSound              (MANAGE_SOUNDBOARD; ≤ MAX_SOUNDS_PER_SPACE)
 * PATCH  /spaces/:id/sounds/:soundId           SoundMetaBody -> SpaceSound    (MANAGE_SOUNDBOARD)
 * DELETE /spaces/:id/sounds/:soundId           -> 204                         (MANAGE_SOUNDBOARD)
 * GET    /spaces/:id/sounds/:soundId/audio     -> audio/wav (immutable)       (members)
 * POST   /channels/:id/soundboard/play         SoundboardPlayBody -> 204      (in that voice channel, USE_SOUNDBOARD,
 *                                              not server-muted). 429 details: { retryAfterMs, reason }.
 * Gateway: SPACE_SOUNDS_UPDATE (space members), SOUNDBOARD_PLAY (users in the voice channel).
 */
import { z } from 'zod'

export const MAX_SOUNDS_PER_SPACE = 24
export const MAX_SOUND_MS = 5000
/** The validator's ceiling: rounding in the client's resampler may add a few ms. */
export const MAX_SOUND_MS_TOLERANCE = 5050
export const MAX_SOUND_BYTES = 512 * 1024
export const SOUND_SAMPLE_RATE = 48000
/** After your sound ends, you wait this long before playing again. */
export const SOUND_COOLDOWN_MS = 3000
export const CHANNEL_MAX_CONCURRENT = 3
export const PLAYS_PER_MINUTE = 10

export interface SpaceSound {
  id: string
  spaceId: string
  name: string
  emoji: string | null
  durationMs: number
  createdBy: string
  createdAt: string
}

/** Built-in pack shipped with the app; available in every space and outside the 24-sound limit. */
export interface AlgaSound {
  id: `alga:${string}`
  name: string
  emoji: string
  durationMs: number
}

/** Filled by the "Alga" pack task; an empty list hides the section. */
export const ALGA_SOUNDS: readonly AlgaSound[] = []

export const algaSound = (id: string): AlgaSound | undefined => ALGA_SOUNDS.find((s) => s.id === id)

// One emoji: an RGI sequence (skin tones, ZWJ families, flags, keycaps) or a pictograph with optional VS16.
const EMOJI_RE = new RegExp('^(?:\\p{RGI_Emoji}|\\p{Extended_Pictographic}\\uFE0F?)$', 'v')

export const SoundMetaBody = z.object({
  name: z.string().trim().min(1).max(32),
  emoji: z.string().max(32).regex(EMOJI_RE).nullable().optional(),
})
export type SoundMetaBody = z.infer<typeof SoundMetaBody>

export const SoundboardPlayBody = z.object({ soundId: z.string().min(1).max(64) })

export type SoundboardLimitReason = 'cooldown' | 'channel_busy' | 'burst'

/** Accepts only RIFF/WAVE PCM 16-bit mono 48 kHz, 1 ms … MAX_SOUND_MS_TOLERANCE, with every chunk inside the buffer. */
export function parseWav(buf: Uint8Array): { ok: true; durationMs: number; samples: number } | { ok: false; reason: string } {
  const fail = (reason: string) => ({ ok: false as const, reason })
  if (buf.length < 44) return fail('too short')
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const tag = (at: number) => String.fromCharCode(buf[at]!, buf[at + 1]!, buf[at + 2]!, buf[at + 3]!)
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return fail('not a WAVE file')
  let fmt = false
  for (let at = 12; at + 8 <= buf.length;) {
    const id = tag(at)
    const size = v.getUint32(at + 4, true)
    const body = at + 8
    if (body + size > buf.length) return fail(`chunk ${id} exceeds the file`)
    if (id === 'fmt ') {
      if (size < 16) return fail('bad fmt chunk')
      let format = v.getUint16(body, true)
      // WAVE_FORMAT_EXTENSIBLE: the real format is the first 2 bytes of the subformat GUID.
      if (format === 0xfffe && size >= 40) format = v.getUint16(body + 24, true)
      if (format !== 1) return fail('not PCM')
      if (v.getUint16(body + 2, true) !== 1) return fail('not mono')
      if (v.getUint32(body + 4, true) !== SOUND_SAMPLE_RATE) return fail('not 48 kHz')
      if (v.getUint16(body + 14, true) !== 16) return fail('not 16-bit')
      fmt = true
    } else if (id === 'data') {
      if (!fmt) return fail('data before fmt')
      const samples = Math.floor(size / 2)
      const durationMs = Math.round((samples * 1000) / SOUND_SAMPLE_RATE)
      if (samples === 0) return fail('empty')
      if (durationMs > MAX_SOUND_MS_TOLERANCE) return fail('too long')
      return { ok: true, durationMs, samples }
    }
    at = body + size + (size & 1)
  }
  return fail('no data chunk')
}
