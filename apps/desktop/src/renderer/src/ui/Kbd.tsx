import s from './misc.module.css'

/** Keyboard hint. "Ctrl K" renders as two keys. */
export function Kbd({ children }: { children: string }) {
  return (
    <span className={s.kbdGroup}>
      {children.split(' ').map((k) => (
        <kbd key={k} className={s.kbd}>
          {k}
        </kbd>
      ))}
    </span>
  )
}
