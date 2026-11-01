import type { HTMLAttributes, Ref } from 'react'
import s from './scroll.module.css'

/** Scroll container with the house scrollbar; `fade` hints at more content without a hard edge. */
export function ScrollArea({ fade, className, ref, ...rest }: HTMLAttributes<HTMLDivElement> & { fade?: boolean; ref?: Ref<HTMLDivElement> }) {
  return <div ref={ref} {...rest} className={`${s.scroll} ${fade ? s.fade : ''} ${className ?? ''}`} />
}
