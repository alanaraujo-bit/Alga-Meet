import { useRef } from 'react'
import { useEnvelope } from './Avatar'
import s from './misc.module.css'

/**
 * "People are in voice here": a 6 px indigo dot (docs/design/brand/concepts/README.md, "O sinal de voz"). With
 * `getLevel` (your own room) a 1.5 px ring, 3 px outside the dot, follows the loudest voice; without it the dot is
 * still. The logo (LogoMark) lives only in the title bar, login and splash: it is never a status glyph.
 */
export function VoiceDot({ getLevel, label, className }: { getLevel?: () => number; label?: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  useEnvelope(ref, getLevel ?? null)
  return <span ref={ref} className={`${s.voiceDot} ${className ?? ''}`} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} />
}
