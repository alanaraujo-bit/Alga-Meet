import type { LegalInfo } from '@alga/shared'
import { AlertCircle, ExternalLink } from '@/ui/icons'
import { useEffect, useId } from 'react'
import { create } from 'zustand'
import { api } from '@/lib/api'
import { openExternal } from '@/lib/clipboard'
import { errorText } from '@/lib/errors'
import { Icon } from '@/ui'
import { t } from './strings'
import s from './trust.module.css'

/** GET /legal: the version the user accepts and where the published texts live (opened in the browser). */
const useLegalStore = create<{ info: LegalInfo | null; error: string | null }>()(() => ({ info: null, error: null }))
let inflight: Promise<LegalInfo | null> | null = null

export function loadLegal(): Promise<LegalInfo | null> {
  inflight ??= api<LegalInfo>('GET', '/legal')
    .then((info) => (useLegalStore.setState({ info, error: null }), info))
    .catch((e: unknown) => (useLegalStore.setState({ error: errorText(e, t.legal.loadError) }), null))
    .finally(() => (inflight = null))
  return inflight
}

/** Fetched again on every mount: the version may have changed since the last screen that showed it. */
export function useLegal() {
  useEffect(() => void loadLegal(), [])
  return useLegalStore()
}

/** "1 de novembro de 2026" for date-shaped versions, the label itself otherwise. */
export function versionLabel(v: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(v)
    ? new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${v}T12:00:00Z`))
    : v
}

export function DocLink({ url, children }: { url: string; children: string }) {
  return (
    <a
      href={url}
      className={s.docLink}
      onClick={(e) => {
        e.preventDefault()
        openExternal(url)
      }}
    >
      {children}
    </a>
  )
}

/** The three published texts as rows (gate, settings). */
export function LegalDocs({ info }: { info: LegalInfo }) {
  return (
    <ul className={s.docs}>
      {(
        [
          [info.termsUrl, t.legal.terms],
          [info.guidelinesUrl, t.legal.guidelines],
          [info.privacyUrl, t.legal.privacy],
        ] as const
      ).map(([url, label]) => (
        <li key={url}>
          <a
            href={url}
            className={s.docRow}
            onClick={(e) => {
              e.preventDefault()
              openExternal(url)
            }}
          >
            <span>{label}</span>
            <span className={s.docRowHint}>
              {t.legal.opensBrowser}
              <Icon icon={ExternalLink} size={12} />
            </span>
          </a>
        </li>
      ))}
    </ul>
  )
}

/**
 * Unticked by default, links in the sentence (`links={false}` where the texts are listed right above). Terms + Diretrizes
 * are accepted; the Política is read, not consented to (consent is not its legal basis).
 */
export function AcceptTerms({ checked, onChange, error, links = true }: { checked: boolean; onChange: (v: boolean) => void; error?: string | null; links?: boolean }) {
  const { info, error: loadError } = useLegalStore()
  const id = useId()
  const [a, b, c, d] = t.legal.accept
  const doc = (url: string | undefined, label: string) => (links && url ? <DocLink url={url}>{label}</DocLink> : label)
  return (
    <div className={s.checkField}>
      <div className={`${s.check} ${error ? s.checkInvalid : ''}`}>
        <input id={id} type="checkbox" checked={checked} aria-invalid={!!error || undefined} aria-describedby={error ? `${id}-err` : undefined} onChange={(e) => onChange(e.target.checked)} />
        <label htmlFor={id}>
          {a}
          {doc(info?.termsUrl, t.legal.terms)}
          {b}
          {doc(info?.guidelinesUrl, t.legal.guidelines)}
          {c}
          {doc(info?.privacyUrl, t.legal.privacy)}
          {d}
        </label>
      </div>
      {error ? (
        <span id={`${id}-err`} className={s.checkError} role="alert">
          <Icon icon={AlertCircle} size={12} />
          {error}
        </span>
      ) : (
        loadError &&
        !info && (
          <span className={s.checkError} role="alert">
            {loadError}{' '}
            <button type="button" className={s.inlineButton} onClick={() => void loadLegal()}>
              {t.legal.retry}
            </button>
          </span>
        )
      )}
    </div>
  )
}
