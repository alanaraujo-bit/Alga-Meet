import type { PresenceStatus } from '@alga/shared'
import { useEffect, useId, useState, type RefObject } from 'react'
import s from './Avatar.module.css'

export type AvatarSize = 16 | 20 | 24 | 32 | 36 | 40 | 56 | 80

const DOT: Record<AvatarSize, number> = { 16: 0, 20: 8, 24: 8, 32: 10, 36: 11, 40: 12, 56: 14, 80: 18 }

export const PRESENCE_LABEL: Record<PresenceStatus, string> = {
  online: 'Online',
  idle: 'Ausente',
  dnd: 'Não perturbe',
  offline: 'Offline',
}

/** Stable hue per user id so initials avatars are recognizable without being loud. */
export function hueFor(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return h % 360
}

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
}

export function Avatar({
  user,
  size = 32,
  presence,
  speaking,
  glowRef,
  decorative,
}: {
  user: AvatarUser
  size?: AvatarSize
  presence?: PresenceStatus
  /** Static speaking state; for live levels pass glowRef to useSpeakingGlow instead. */
  speaking?: boolean
  glowRef?: RefObject<HTMLSpanElement | null>
  /** Name is already visible next to it. */
  decorative?: boolean
}) {
  const [broken, setBroken] = useState(false)
  const hue = hueFor(user.id)
  const showDot = presence && DOT[size] > 0
  const label = decorative ? undefined : presence ? `${user.displayName}, ${PRESENCE_LABEL[presence]}` : user.displayName
  return (
    <span
      className={`${s.avatar} ${showDot ? s.withPresence : ''}`}
      style={{ width: size, height: size, ['--dot' as string]: `${DOT[size]}px`, ['--speak' as string]: speaking ? 1 : 0 }}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <span
        className={s.face}
        style={{
          background: user.accentColor ?? `oklch(0.4 0.055 ${hue})`,
          color: user.accentColor ? '#fff' : `oklch(0.93 0.035 ${hue})`,
          fontSize: Math.max(8, Math.round(size * 0.38)),
        }}
      >
        {user.avatarUrl && !broken ? <img src={user.avatarUrl} alt="" draggable={false} onError={() => setBroken(true)} /> : initials(user.displayName)}
      </span>
      {(speaking || glowRef) && <span ref={glowRef} className={s.glow} />}
      {showDot && (
        <span className={s.presence}>
          <PresenceGlyph status={presence} />
        </span>
      )}
    </span>
  )
}

/**
 * Drives the speaking glow from a live audio level without re-rendering React:
 * a compressor-like envelope (attack ~60ms, release ~240ms) written to --speak each frame.
 * `getLevel` returns the current RMS level 0..1 (from the media engine).
 */
export function useSpeakingGlow(ref: RefObject<HTMLElement | null>, getLevel: (() => number) | null) {
  useEffect(() => {
    const el = ref.current?.parentElement
    if (!el || !getLevel) return
    let env = 0
    let last = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const dt = now - last
      last = now
      const target = Math.max(0, Math.min(1, getLevel()))
      const tau = target > env ? 60 : 240
      env += (target - env) * (1 - Math.exp(-dt / tau))
      el.style.setProperty('--speak', env < 0.01 ? '0' : env.toFixed(3))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      el.style.setProperty('--speak', '0')
    }
  }, [ref, getLevel])
}
