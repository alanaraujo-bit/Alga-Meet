import type { PresenceStatus } from '@alga/shared'
import { useEffect, useId, useState, type RefObject } from 'react'
import s from './Avatar.module.css'
import { Eco } from './eco/Eco'
import { ecoBackdrop, ecoFor, type EcoLook } from './eco/ecoRules'
import type { EcoSpec } from '@alga/shared'

export type AvatarSize = 16 | 20 | 24 | 32 | 36 | 40 | 48 | 56 | 64 | 80 | 88 | 96 | 112 | 128

const DOT: Record<AvatarSize, number> = { 16: 0, 20: 8, 24: 8, 32: 10, 36: 11, 40: 12, 48: 13, 56: 14, 64: 16, 80: 18, 88: 19, 96: 20, 112: 22, 128: 24 }

export const PRESENCE_LABEL: Record<PresenceStatus, string> = {
  online: 'Online',
  idle: 'Ausente',
  dnd: 'Não perturbe',
  offline: 'Offline',
}

/** 8 hues for the whisper of tint on initials avatars and space tiles: cool-to-warm around the indigo, no teal/cyan
 *  (H 160–220 is gone with the old accent) and no 40–110 band, which reads as mud. */
const HUES = [140, 235, 255, 275, 295, 315, 340, 15] as const

/**
 * Hues measured from people's own avatars (personHue.ts), by user id. Once known, the person's color wins over the
 * hash everywhere hueFor is used (profile banner, stage spot, name chip): the app is tinted by who is in it.
 */
export const measuredHue = new Map<string, number>()

/** Stable hue per id so initials avatars are recognizable without being loud (or the avatar's own hue, once measured). */
export function hueFor(id: string): number {
  const m = measuredHue.get(id)
  if (m !== undefined) return m
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return HUES[h % HUES.length]!
}

/** Same hash as an 8% tint over the raised surface (space tiles without an icon): near-neutral, still tellable apart. */
export const tintFor = (id: string): string => `color-mix(in srgb, oklch(0.5 0.07 ${hueFor(id)}) 8%, var(--bg-raised))`

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  const first = Array.from(parts[0]!)[0] ?? ''
  const second = parts.length > 1 ? (Array.from(parts[parts.length - 1]!)[0] ?? '') : ''
  return (first + second).toUpperCase()
}

/** Presence is shape + color (never color alone): dot, crescent, bar, ring. */
export function PresenceGlyph({ status }: { status: PresenceStatus }) {
  const id = useId()
  const color = `var(--${status})`
  return (
    <svg viewBox="0 0 10 10" aria-hidden>
      <mask id={id}>
        <rect width="10" height="10" fill="#fff" />
        {status === 'idle' && <circle cx="2.6" cy="2.6" r="3.6" fill="#000" />}
        {status === 'dnd' && <rect x="2.2" y="4" width="5.6" height="2" rx="1" fill="#000" />}
        {status === 'offline' && <circle cx="5" cy="5" r="2.4" fill="#000" />}
      </mask>
      <circle cx="5" cy="5" r="5" fill={color} mask={`url(#${id})`} />
    </svg>
  )
}

export interface AvatarUser {
  id: string
  displayName: string
  avatarUrl: string | null
  accentColor?: string | null
  /** The Eco they picked (PublicUser.eco); absent = the automatic one. */
  eco?: EcoSpec
}

export function Avatar({
  user,
  size = 32,
  presence,
  speaking,
  glowRef,
  glow,
  decorative,
}: {
  user: AvatarUser
  size?: AvatarSize
  presence?: PresenceStatus
  /** Static speaking state; for live levels pass glowRef to useSpeakingGlow instead. */
  speaking?: boolean
  glowRef?: RefObject<HTMLSpanElement | null>
  /** Render the glow layer driven by an inherited --speak (an ancestor runs useEnvelope). */
  glow?: boolean
  /** Name is already visible next to it. */
  decorative?: boolean
}) {
  // Remember which URL failed, so a new avatar gets a fresh try.
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null)
  const broken = !!user.avatarUrl && brokenUrl === user.avatarUrl
  const photo = !!user.avatarUrl && !broken
  // No photo: the Eco they picked (Configurações › Minha conta › Seu Eco), else the one born from their id.
  const eco: EcoLook | null = photo ? null : (user.eco ?? ecoFor(user.id))
  const showDot = presence && DOT[size] > 0
  const label = decorative ? undefined : presence ? `${user.displayName}, ${PRESENCE_LABEL[presence]}` : user.displayName
  return (
    <span
      className={`${s.avatar} ${showDot ? s.withPresence : ''}`}
      style={{ width: size, height: size, ['--dot' as string]: `${DOT[size]}px`, ...(speaking !== undefined && { ['--speak' as string]: speaking ? 1 : 0 }) }}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <span className={s.face} style={{ background: eco ? ecoBackdrop(eco.accent) : undefined }}>
        {eco ? <Eco spec={eco} framing="avatar" size={size} /> : <img src={user.avatarUrl!} alt="" draggable={false} onError={() => setBrokenUrl(user.avatarUrl)} />}
      </span>
      {(speaking || glowRef || glow) && <span ref={glowRef} className={s.glow} />}
      {showDot && (
        <span className={s.presence}>
          <PresenceGlyph status={presence} />
        </span>
      )}
    </span>
  )
}

const reducedMotion = () =>
  document.documentElement.classList.contains('reduce-motion') || matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Writes a live audio level to `--speak` on an element without re-rendering React:
 * a compressor-like envelope (attack ~60ms, release ~240ms) applied every frame.
 * Reduced motion: no continuous movement, the value steps between 0 and 1 (state stays visible).
 * `getLevel` returns the current level 0..1 (from the media engine).
 */
export function useEnvelope(ref: RefObject<HTMLElement | null>, getLevel: (() => number) | null, target: 'self' | 'parent' = 'self') {
  useEffect(() => {
    const el = target === 'parent' ? ref.current?.parentElement : ref.current
    if (!el || !getLevel) return
    let env = 0
    let last = performance.now()
    let raf = 0
    let written = ''
    const tick = (now: number) => {
      const dt = now - last
      last = now
      const level = Math.max(0, Math.min(1, getLevel()))
      if (reducedMotion()) env = level > 0.06 ? 1 : 0
      else env += (level - env) * (1 - Math.exp(-dt / (level > env ? 60 : 240)))
      const v = env < 0.01 ? '0' : env.toFixed(3)
      if (v !== written) el.style.setProperty('--speak', (written = v))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      el.style.setProperty('--speak', '0')
    }
  }, [ref, getLevel, target])
}

/** Speaking glow on an Avatar: pass the Avatar's `glowRef`; the envelope lands on the avatar itself. */
export const useSpeakingGlow = (ref: RefObject<HTMLElement | null>, getLevel: (() => number) | null) => useEnvelope(ref, getLevel, 'parent')
