import s from './misc.module.css'

/** Indeterminate progress. Always pair with text nearby (a lone spinner is a bug, study §17 #10). */
export function Spinner({ size = 16, label }: { size?: 12 | 16 | 20 | 24; label?: string }) {
  return (
    <span className={s.spinner} style={{ width: size, height: size }} role={label ? 'status' : undefined} aria-label={label}>
      <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden>
        <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="1.75" />
        <path d="M8 1.5a6.5 6.5 0 0 1 6.5 6.5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      </svg>
    </span>
  )
}
