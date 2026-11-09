import { motion } from 'motion/react'
import type { KeyboardEvent } from 'react'
import { Button } from '@/ui'
import { Eco } from '@/ui/eco/Eco'
import { EASE_IN, EASE_OUT_QUART } from '@/ui/motion'
import { useAnchor } from './anchor'
import { answerOffer } from './store'
import { t } from './strings'
import s from './feedback.module.css'

/**
 * "Travei da última vez. Quer me contar o que aconteceu?": the only time the feedback offers itself, once per crash,
 * in a quiet moment (store.ts). A status, not a dialog: it takes no focus and blocks nothing.
 */
export function CrashOffer() {
  const anchor = useAnchor()
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape') return
    e.stopPropagation()
    answerOffer(false)
  }
  return (
    <motion.div
      className={s.offer}
      role="status"
      style={anchor}
      initial={{ opacity: 0, y: 12, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: 0.26, ease: EASE_OUT_QUART } }}
      exit={{ opacity: 0, y: 8, scale: 0.98, transition: { duration: 0.14, ease: EASE_IN } }}
      onKeyDown={onKey}
    >
      <span aria-hidden>
        <Eco size={56} state="error" />
      </span>
      <div className={s.offerBody}>
        <p className={s.offerText}>{t.offer.text}</p>
        <div className={s.offerActions}>
          <Button size="sm" variant="primary" onClick={() => answerOffer(true)}>{t.offer.tell}</Button>
          <Button size="sm" variant="ghost" onClick={() => answerOffer(false)}>{t.offer.later}</Button>
        </div>
      </div>
    </motion.div>
  )
}
