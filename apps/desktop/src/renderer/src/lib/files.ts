import { AVATAR_CONTENT_TYPES, DEFAULT_MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS, MAX_AVATAR_BYTES, MIN_PASSWORD_LENGTH } from '@alga/shared'

/** Pure helpers for attachments, avatars and passwords (unit-tested in logic.test.ts). */

const nf1 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 })
/** "540 KB", "1,2 MB", "12 bytes" (binary units, like the server's limits). */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} ${n === 1 ? 'byte' : 'bytes'}`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  if (n < 1024 ** 3) return `${nf1.format(n / 1024 ** 2)} MB`
  return `${nf1.format(n / 1024 ** 3)} GB`
}

export type InlineKind = 'image' | 'video' | 'audio' | 'file'
/** How the server serves an Attachment: image/video/audio = inline, anything else = download only. */
export function attachmentKind(contentType: string): InlineKind {
  const top = contentType.split('/')[0]
  return top === 'image' || top === 'video' || top === 'audio' ? top : 'file'
}

/** Local preview of a picked file before upload: only types the server will also serve inline. */
const LOCAL_INLINE = /^(image\/(png|jpeg|gif|webp|avif)|video\/(mp4|webm)|audio\/.+)$/
export const localKind = (type: string): InlineKind => (LOCAL_INLINE.test(type) ? attachmentKind(type) : 'file')

export type FileProblem = 'empty' | 'tooBig' | 'tooMany'
/**
 * Checks files before upload. `already` = files already in the tray (they count towards MAX_ATTACHMENTS).
 * Returns one entry per incoming file, in order; `problem` set = it will not be sent.
 */
export function checkFiles<F extends { size: number }>(already: number, files: readonly F[], maxBytes = DEFAULT_MAX_ATTACHMENT_BYTES): Array<{ file: F; problem?: FileProblem }> {
  let accepted = already
  return files.map((file) => {
    if (file.size === 0) return { file, problem: 'empty' }
    if (file.size > maxBytes) return { file, problem: 'tooBig' }
    if (accepted >= MAX_ATTACHMENTS) return { file, problem: 'tooMany' }
    accepted++
    return { file }
  })
}

/**
 * Rows of an image grid (cells per row). Readable at any count: 3 = one wide + two, 4 = 2×2,
 * otherwise rows of three with the remainder (1 or 2) as a wider first row.
 */
export function gridRows(n: number): number[] {
  if (n <= 0) return []
  if (n <= 2) return [n]
  if (n === 3) return [1, 2]
  if (n === 4) return [2, 2]
  const r = n % 3
  return [...(r ? [r] : []), ...Array<number>(Math.floor(n / 3)).fill(3)]
}

/** Display box of a single image: fits max W×H keeping the ratio, never upscaled. Unknown size = 16:9 box. */
export function fitBox(w: number | undefined, h: number | undefined, maxW: number, maxH: number): { width: number; height: number } {
  if (!w || !h) return { width: maxW, height: Math.round((maxW * 9) / 16) }
  const k = Math.min(1, maxW / w, maxH / h)
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) }
}

// ── Avatars ──────────────────────────────────────────────

export type AvatarProblem = 'type' | 'tooBig'
export function checkAvatar(file: { size: number; type: string }): AvatarProblem | null {
  if (!(AVATAR_CONTENT_TYPES as readonly string[]).includes(file.type)) return 'type'
  if (file.size > MAX_AVATAR_BYTES) return 'tooBig'
  return null
}

/** Largest side we upload after cropping (the server allows more; avatars never show above ~96 px). */
export const AVATAR_OUTPUT_MAX = 1024

/**
 * Square crop over an image shown "cover" in a `view`-px viewport, zoomed by `zoom` (≥ 1) and panned by `pan`
 * (image center offset from the viewport center, in viewport px). `clampPan` keeps the viewport covered.
 */
export function clampPan(img: { w: number; h: number }, view: number, zoom: number, pan: { x: number; y: number }): { x: number; y: number } {
  const k = (view / Math.min(img.w, img.h)) * zoom
  const mx = Math.max(0, (img.w * k - view) / 2)
  const my = Math.max(0, (img.h * k - view) / 2)
  return { x: Math.max(-mx, Math.min(mx, pan.x)), y: Math.max(-my, Math.min(my, pan.y)) }
}
/** Source rectangle (image px) under the viewport, plus the output side (≤ AVATAR_OUTPUT_MAX). */
export function cropRect(img: { w: number; h: number }, view: number, zoom: number, pan: { x: number; y: number }) {
  const k = (view / Math.min(img.w, img.h)) * zoom
  const p = clampPan(img, view, zoom, pan)
  const side = Math.min(img.w, img.h) / zoom
  // The viewport's top-left corner, in image pixels (the image center sits at the viewport center + pan).
  const sx = (img.w - side) / 2 - p.x / k
  const sy = (img.h - side) / 2 - p.y / k
  return { sx, sy, side, out: Math.max(1, Math.min(AVATAR_OUTPUT_MAX, Math.round(side))) }
}

// ── Passwords ────────────────────────────────────────────

const COMMON = ['12345678', '123456789', '1234567890', 'password', 'senha123', 'qwerty', 'abc12345', '11111111', 'iloveyou', 'brasil']
/**
 * Rough strength 0–4 (0 = below MIN_PASSWORD_LENGTH). A hint, not a policy: length counts most,
 * mixing character kinds helps, repeats and your own name hurt.
 */
export function passwordStrength(pw: string, personal: readonly string[] = []): 0 | 1 | 2 | 3 | 4 {
  if (pw.length < MIN_PASSWORD_LENGTH) return 0
  const low = pw.toLowerCase()
  if (COMMON.some((c) => low.includes(c)) || /^(.)\1+$/.test(pw)) return 1
  if (personal.some((p) => p.length >= 3 && low.includes(p.toLowerCase()))) return 1
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length
  let score = 1
  if (pw.length >= 12) score++
  if (pw.length >= 16) score++
  if (kinds >= 3) score++
  if (new Set(pw).size < pw.length / 3) score--
  return Math.max(1, Math.min(4, score)) as 1 | 2 | 3 | 4
}

/** Token from a verification/reset e-mail: a pasted link (`…?token=abc`) or the bare code. */
export function parseEmailToken(input: string): string {
  const s = input.trim()
  const m = /[?&#]token=([^&#\s]+)/.exec(s)
  return (m ? m[1]! : s).replace(/\s+/g, '')
}
