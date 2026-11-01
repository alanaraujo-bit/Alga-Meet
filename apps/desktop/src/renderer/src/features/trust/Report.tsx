import { REMOVED_USER_ID, type Message, type PublicUser, type ReportReason, type ReportReceipt } from '@alga/shared'
import { AlertCircle, CheckCircle2, ChevronDown, Flag, LifeBuoy, ShieldAlert } from 'lucide-react'
import { useState } from 'react'
import { create } from 'zustand'
import { api, ApiRequestError } from '@/lib/api'
import { errorText } from '@/lib/errors'
import { setRelationship } from '@/store/actions'
import { useData } from '@/store/data'
import { displayName } from '@/store/selectors'
import { Avatar, Button, Icon, Modal, tintFor, type MenuEntry } from '@/ui'
import { initials } from '@/ui/Avatar'
import { COMMON, MORE, REASON, URGENT, t } from './strings'
import s from './trust.module.css'

/**
 * "Denunciar" for messages, profiles and spaces (POST /reports). One dialog for the whole app, opened with openReport().
 * The reporter is never revealed to the target; csam goes to the top of the queue and quarantines the attachments.
 */
export type ReportTarget = { kind: 'message'; message: Message } | { kind: 'user'; user: PublicUser } | { kind: 'space'; spaceId: string }

const useReport = create<{ target: ReportTarget | null; open: boolean; n: number }>()(() => ({ target: null, open: false, n: 0 }))
export const openReport = (target: ReportTarget) => useReport.setState((x) => ({ target, open: true, n: x.n + 1 }))
// The target stays while the dialog plays its exit.
const close = () => useReport.setState({ open: false })

/** Who answers for a target, when it is a person you could block. */
function targetUser(target: ReportTarget): PublicUser | null {
  if (target.kind === 'user') return target.user
  if (target.kind === 'message') return target.message.author
  return null
}

/** Ready-made context-menu entries for a message: none for your own, a pending or a removed author's message. */
export function messageReportEntries(m: Message): MenuEntry[] {
  const me = useData.getState().me?.id
  if (!me || m.author.id === me || m.author.id === REMOVED_USER_ID || m.nonce === m.id) return []
  return [
    { kind: 'group', label: t.report.group },
    { label: t.report.menu.message, icon: Flag, onSelect: () => openReport({ kind: 'message', message: m }) },
  ]
}

/** Context-menu entry for a profile (member list, friends); nothing for yourself. */
export function userReportEntries(user: PublicUser): MenuEntry[] {
  if (user.id === useData.getState().me?.id || user.id === REMOVED_USER_ID) return []
  return [{ label: t.report.menu.user, icon: Flag, onSelect: () => openReport({ kind: 'user', user }) }]
}

export function ReportHost() {
  const target = useReport((x) => x.target)
  const open = useReport((x) => x.open)
  const n = useReport((x) => x.n)
  return target ? <ReportFlow key={n} target={target} open={open} /> : null
}

const LIFE: ReportReason[] = ['self_harm', 'violence']

function ReportFlow({ target, open }: { target: ReportTarget; open: boolean }) {
  const [step, setStep] = useState<'reason' | 'details' | 'done'>('reason')
  const [reason, setReason] = useState<ReportReason | null>(null)
  const [more, setMore] = useState(false)
  const [details, setDetails] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [duplicate, setDuplicate] = useState(false)

  const send = async () => {
    if (!reason) return
    setBusy(true)
    setError(null)
    const id = target.kind === 'message' ? target.message.id : target.kind === 'user' ? target.user.id : target.spaceId
    try {
      const r = await api<ReportReceipt>('POST', '/reports', { targetType: target.kind, targetId: id, reason, ...(details.trim() && { details: details.trim() }) })
      // A repeat of your own open report answers with the first one (200): its date gives it away.
      setDuplicate(Date.now() - Date.parse(r.createdAt) > 2 * 60 * 1000)
      setStep('done')
    } catch (e) {
      setError(e instanceof ApiRequestError && e.code === 'rate_limited' ? t.report.rateLimited : errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const footer =
    step === 'reason' ? (
      <>
        <Button variant="ghost" onClick={close}>
          {t.report.cancel}
        </Button>
        <Button type="submit" form="report-reason" variant="primary">
          {t.report.next}
        </Button>
      </>
    ) : step === 'details' ? (
      <>
        <Button variant="ghost" onClick={() => setStep('reason')}>
          {t.report.back}
        </Button>
        <Button type="submit" form="report-details" variant="primary" loading={busy}>
          {t.report.submit}
        </Button>
      </>
    ) : (
      <Button variant="primary" autoFocus onClick={close}>
        {t.report.close}
      </Button>
    )

  return (
    <Modal open={open} onClose={close} title={t.report.title[target.kind]} width={480} footer={footer}>
      {step === 'done' ? (
        <Done target={target} urgent={!!reason && URGENT.includes(reason)} duplicate={duplicate} />
      ) : (
        <>
          <Subject target={target} />
          {step === 'reason' ? (
            <form
              id="report-reason"
              className={s.reportForm}
              onSubmit={(e) => {
                e.preventDefault()
                if (reason) setStep('details')
                else setError(t.report.pick)
              }}
            >
              <fieldset className={s.fieldset}>
                <legend className={s.question}>{t.report.question}</legend>
                <ReasonGroup label={t.report.urgent} reasons={URGENT} value={reason} onPick={(r) => (setReason(r), setError(null))} />
                <ReasonGroup label={t.report.others} reasons={more || (reason && MORE.includes(reason)) ? [...COMMON, ...MORE] : COMMON} value={reason} onPick={(r) => (setReason(r), setError(null))} />
                {!more && !(reason && MORE.includes(reason)) && (
                  <button type="button" className={s.more} onClick={() => setMore(true)}>
                    <Icon icon={ChevronDown} size={14} />
                    {t.report.more}
                  </button>
                )}
              </fieldset>
              {error && <Inline text={error} />}
            </form>
          ) : (
            <form
              id="report-details"
              className={s.reportForm}
              onSubmit={(e) => {
                e.preventDefault()
                void send()
              }}
            >
              <div className={s.chosen}>
                <span className={s.chosenLabel}>{REASON[reason!][0]}</span>
                <button type="button" className={s.inlineButton} onClick={() => setStep('reason')}>
                  {t.report.change}
                </button>
              </div>
              {reason === 'csam' && (
                <div className={`${s.callout} ${s.calloutUrgent}`}>
                  <Icon icon={ShieldAlert} size={16} />
                  <div>
                    <p className={s.calloutTitle}>{t.report.csamTitle}</p>
                    <p>{target.kind === 'message' ? t.report.csamMessage : t.report.csamOther}</p>
                    <p>{t.report.csamIdentified}</p>
                    <p>{t.report.csamDontShare}</p>
                  </div>
                </div>
              )}
              {reason && LIFE.includes(reason) && (
                <div className={s.callout}>
                  <Icon icon={LifeBuoy} size={16} />
                  <div>
                    <p className={s.calloutTitle}>{t.report.lifeTitle}</p>
                    <p>{t.report.lifeBody}</p>
                  </div>
                </div>
              )}
              <label className={s.textField}>
                <span className={s.textLabel}>{t.report.details}</span>
                <textarea
                  className={s.textarea}
                  rows={4}
                  maxLength={1000}
                  autoFocus
                  value={details}
                  placeholder={t.report.detailsPlaceholder}
                  onChange={(e) => setDetails(e.target.value)}
                />
                <span className={`${s.textHint} tnum`}>{t.report.detailsCount(details.length)}</span>
              </label>
              {reason !== 'csam' && <p className={s.anon}>{t.report.anonymous}</p>}
              {error && <Inline text={error} />}
            </form>
          )}
        </>
      )}
    </Modal>
  )
}

function Inline({ text }: { text: string }) {
  return (
    <p className={s.inlineError} role="alert">
      <Icon icon={AlertCircle} size={14} />
      {text}
    </p>
  )
}

function ReasonGroup({ label, reasons, value, onPick }: { label: string; reasons: ReportReason[]; value: ReportReason | null; onPick: (r: ReportReason) => void }) {
  return (
    <div className={s.reasonGroup} role="group" aria-label={label}>
      <span className={s.groupLabel} aria-hidden>
        {label}
      </span>
      {reasons.map((r) => (
        <label key={r} className={s.option}>
          <input type="radio" name="reason" value={r} checked={value === r} onChange={() => onPick(r)} />
          <span className={s.optionText}>
            <span className={s.optionLabel}>{REASON[r][0]}</span>
            {value === r && <span className={s.optionHint}>{REASON[r][1]}</span>}
          </span>
        </label>
      ))}
    </div>
  )
}

/** What is being reported, as the reporter sees it. */
function Subject({ target }: { target: ReportTarget }) {
  const spaceId = useData((x) => (target.kind === 'message' ? x.channels[target.message.channelId]?.spaceId : null))
  const authorName = useData((x) => (target.kind === 'message' ? displayName(x, target.message.author.id, spaceId) : ''))
  const space = useData((x) => (target.kind === 'space' ? x.spaces[target.spaceId] : undefined))
  const count = useData((x) => (target.kind === 'space' ? Object.keys(x.members[target.spaceId] ?? {}).length : 0))
  if (target.kind === 'message') {
    const m = target.message
    return (
      <figure className={s.subject}>
        <Avatar user={m.author} size={24} decorative />
        <div className={s.subjectText}>
          <span className={s.subjectName}>{authorName}</span>
          <blockquote className={s.quote}>{m.content || t.report.attachments(m.attachments.length)}</blockquote>
          {m.content && m.attachments.length > 0 && <span className={s.subjectMeta}>{t.report.attachments(m.attachments.length)}</span>}
        </div>
      </figure>
    )
  }
  if (target.kind === 'user') {
    return (
      <figure className={s.subject}>
        <Avatar user={target.user} size={32} decorative />
        <div className={s.subjectText}>
          <span className={s.subjectName}>{target.user.displayName}</span>
          <span className={s.subjectMeta}>@{target.user.username}</span>
        </div>
      </figure>
    )
  }
  return (
    <figure className={s.subject}>
      <span className={s.spaceTile} style={{ background: space?.iconUrl ? undefined : tintFor(target.spaceId) }} aria-hidden>
        {space?.iconUrl ? <img src={space.iconUrl} alt="" draggable={false} /> : initials(space?.name ?? '')}
      </span>
      <div className={s.subjectText}>
        <span className={s.subjectName}>{space?.name ?? ''}</span>
        <span className={s.subjectMeta}>{t.report.members(count)}</span>
      </div>
    </figure>
  )
}

function Done({ target, urgent, duplicate }: { target: ReportTarget; urgent: boolean; duplicate: boolean }) {
  const who = targetUser(target)
  const blocked = useData((x) => !!who && x.relationships[who.id]?.type === 'blocked')
  const isRemoved = who?.id === REMOVED_USER_ID
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const block = async () => {
    if (!who) return
    setBusy(true)
    setError(null)
    try {
      await setRelationship(who.id, 'blocked')
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className={s.done} role="status">
      <span className={s.doneIcon}>
        <Icon icon={CheckCircle2} size={20} />
      </span>
      <h3 className={s.doneTitle}>{t.report.doneTitle}</h3>
      <p className={s.doneBody}>{duplicate ? t.report.duplicate : t.report.doneBody}</p>
      {urgent && !duplicate && <p className={s.doneBody}>{t.report.doneUrgent}</p>}
      {who && !isRemoved && (
        <div className={s.blockOffer}>
          {blocked ? (
            <span className={s.okLine}>
              <Icon icon={CheckCircle2} size={12} />
              {t.report.blocked(who.displayName)}
            </span>
          ) : (
            <>
              <span>{t.report.blockOffer(who.displayName)}</span>
              <Button size="sm" loading={busy} onClick={() => void block()}>
                {t.report.block(who.displayName)}
              </Button>
            </>
          )}
          {error && <Inline text={error} />}
        </div>
      )}
    </div>
  )
}
