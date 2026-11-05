import type { ReactNode } from 'react'
import { openExternal } from '@/lib/clipboard'
import { useLegal } from '../trust/legal'
import { t } from './strings'
import s from './store.module.css'

/**
 * The honest line under every price (Decreto 7.962 art. 4º, growth-plan §2.4): one-time, it stays on your account,
 * 7 days to change your mind, the Terms one click away; and, on a test server, that nothing is charged.
 */
export function Fine({ sandbox, children }: { sandbox?: boolean; children?: ReactNode }) {
  const terms = useLegal().info?.termsUrl
  return (
    <p className={s.fine}>
      {children ?? `${t.store.detail.once}.`} {t.store.detail.refund}{' '}
      {terms && (
        <button type="button" className={s.linkBtn} onClick={() => openExternal(terms)}>
          {t.store.detail.terms}
        </button>
      )}
      {sandbox && <span className={s.sandboxLine}> {t.store.detail.sandboxPay}</span>}
    </p>
  )
}
