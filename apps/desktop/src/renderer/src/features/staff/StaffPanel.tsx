import type { AdminAppeal, AdminReport, PatchAppealBody, PublicUser, QuarantinedFile } from '@alga/shared'
import { AlertTriangle, CheckCircle2, Eye, FileLock2, FileText, RefreshCw, ScrollText, ShieldAlert, X, type LucideIcon } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { api, ApiRequestError } from '@/lib/api'
import { errorText } from '@/lib/errors'
import { formatBytes } from '@/lib/files'
import { ago, clock } from '@/lib/format'
import { useData } from '@/store/data'
import { Avatar, Button, EmptyState, Icon, IconButton, Kbd, Modal, SegmentedControl, Spinner, Tabs } from '@/ui'
import { EASE_IN, EASE_OUT_QUART } from '@/ui/motion'
import { cap, longDate, longDateTime, REASON, RULE } from '../trust/strings'
import {
  APPEAL_KEYS,
  decisionBody,
  keyFor,
  QUARANTINE_KEYS,
  readTarget,
  REPORT_KEYS,
  step,
  SUSPEND_DAYS,
  tierOf,
  unavailable,
  type Decision,
  type SnapAttachment,
  type SuspendDays,
  type Target,
} from './queue'
import { closeStaff, useStaff } from './store'
import { ACTION_LABEL, t } from './strings'
import s from './staff.module.css'

type Tab = 'reports' | 'appeals' | 'quarantine'
const TABS: Tab[] = ['reports', 'appeals', 'quarantine']
type ReportStatus = AdminReport['status']
type AppealStatus = AdminAppeal['status']

/** Staff-only triage over the whole window (below the title bar). Lazy chunk: only staff ever load it. */
export default function StaffPanel() {
  const open = useStaff((x) => x.open)
  return createPortal(<AnimatePresence>{open && <Panel key="staff" />}</AnimatePresence>, document.body)
}

// ── data ───────────────────────────────────────────────────────

/** One admin list. Every admin call is audit-logged by the server, so nothing here polls: load, act, reload. */
function useQueue<T extends { id: string }>(path: string) {
  const [items, setItems] = useState<T[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(() => {
    setError(null)
    api<T[]>('GET', path).then(setItems, (e: unknown) => setError(errorText(e, t.loadError)))
  }, [path])
  useEffect(() => {
    setItems(null)
    load()
  }, [load])
  return { items, error, load, setItems }
}

const people = new Map<string, Promise<PublicUser | null>>()
/** A name for an id: the local store first (same spaces, friends), else GET /users/:id once per id. */
function usePerson(id: string | null | undefined): PublicUser | null {
  const known = useData((x) => (id ? x.users[id] : undefined))
  const [fetched, setFetched] = useState<PublicUser | null>(null)
  useEffect(() => {
    if (!id || known) return
    let live = true
    if (!people.has(id))
      people.set(
        id,
        api<PublicUser>('GET', `/users/${id}`).catch(() => null),
      )
    void people.get(id)!.then((u) => live && setFetched(u))
    return () => {
      live = false
    }
  }, [id, known])
  return known ?? (fetched?.id === id ? fetched : null)
}

// ── pending decision (one confirmation dialog for everything) ──

type Pending =
  | { kind: 'report'; report: AdminReport; decision: Decision; who: string }
  | {
      kind: 'appeal'
      appeal: AdminAppeal
      status: PatchAppealBody['status']
      who: string
    }
  | { kind: 'quarantine'; attachment: SnapAttachment; reportId: string }
  | { kind: 'release'; file: QuarantinedFile }

const targetName = (target: Target) =>
  target.kind === 'message' ? (target.author?.displayName ?? t.gone) : target.kind === 'user' ? (target.user?.displayName ?? t.gone) : target.name

function Panel() {
  const [tab, setTab] = useState<Tab>('reports')
  const [reportStatus, setReportStatus] = useState<ReportStatus>('open')
  const [appealStatus, setAppealStatus] = useState<AppealStatus>('open')
  const reports = useQueue<AdminReport>(`/admin/reports?status=${reportStatus}`)
  const appeals = useQueue<AdminAppeal>(`/admin/appeals?status=${appealStatus}`)
  const quarantine = useQueue<QuarantinedFile>('/admin/quarantine')
  const [selected, setSelected] = useState<Record<Tab, string | null>>({
    reports: null,
    appeals: null,
    quarantine: null,
  })
  const [pending, setPending] = useState<Pending | null>(null)
  const [done, setDone] = useState<{ text: string; at: Date } | null>(null)
  const root = useRef<HTMLDivElement>(null)

  const list: Array<{ id: string }> | null = tab === 'reports' ? reports.items : tab === 'appeals' ? appeals.items : quarantine.items
  const error = tab === 'reports' ? reports.error : tab === 'appeals' ? appeals.error : quarantine.error
  const reload = tab === 'reports' ? reports.load : tab === 'appeals' ? appeals.load : quarantine.load
  // The selection follows the list: first item by default, and the same position after the current one leaves.
  const index = list
    ? Math.max(
        0,
        list.findIndex((x) => x.id === selected[tab]),
      )
    : -1
  const current = list?.[index] ?? null
  const select = useCallback((id: string | null) => setSelected((x) => ({ ...x, [tab]: id })), [tab])

  const report = tab === 'reports' ? (current as AdminReport | null) : null
  const appeal = tab === 'appeals' ? (current as AdminAppeal | null) : null
  const qfile = tab === 'quarantine' ? (current as QuarantinedFile | null) : null
  const target = useMemo(() => (report ? readTarget(report) : null), [report])

  const askReport = useCallback(
    (d: Decision) => {
      if (!report || !target || report.status !== 'open' || unavailable(report, d)) return
      setPending({
        kind: 'report',
        report,
        decision: d,
        who: targetName(target),
      })
    },
    [report, target],
  )
  const appealUser = usePerson(appeal?.userId)
  const askAppeal = (status: PatchAppealBody['status']) => {
    if (appeal?.status === 'open')
      setPending({
        kind: 'appeal',
        appeal,
        status,
        who: appealUser?.displayName ?? '',
      })
  }
  const askRelease = (file: QuarantinedFile) => !file.releasedAt && !file.purgedAt && setPending({ kind: 'release', file })

  // Keyboard-first: ↑↓/j k move, 1 2 3 switch queues, letters open a decision (always confirmed), Esc closes.
  const keys = useRef<(e: KeyboardEvent) => void>(() => undefined)
  keys.current = (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return
    if (document.querySelector('[role="dialog"][aria-modal="true"]:not([data-staff]), [role="menu"]')) return
    const el = e.target as HTMLElement
    const typing = el.closest('input, textarea, select, [contenteditable="true"]')
    if (e.key === 'Escape') {
      e.preventDefault()
      return closeStaff()
    }
    if (typing) return
    const k = e.key.toLowerCase()
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || k === 'j' || k === 'k') {
      if (!list?.length) return
      e.preventDefault()
      const next = list[step(index, list.length, e.key === 'ArrowDown' || k === 'j' ? 1 : -1)]
      if (next) {
        select(next.id)
        root.current?.querySelector<HTMLElement>(`[data-row="${next.id}"]`)?.focus()
      }
    } else if (k === '1' || k === '2' || k === '3') {
      e.preventDefault()
      setTab(TABS[Number(k) - 1]!)
    } else if (tab === 'reports' && REPORT_KEYS[k]) {
      e.preventDefault()
      askReport(REPORT_KEYS[k])
    } else if (tab === 'appeals' && APPEAL_KEYS[k]) {
      e.preventDefault()
      askAppeal(APPEAL_KEYS[k])
    } else if (tab === 'quarantine' && QUARANTINE_KEYS[k] && qfile) {
      e.preventDefault()
      askRelease(qfile)
    }
  }
  useEffect(() => {
    const returnTo = document.activeElement as HTMLElement | null
    const onKey = (e: KeyboardEvent) => keys.current(e)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (returnTo?.isConnected) returnTo.focus()
    }
  }, [])
  useEffect(() => {
    // First focus on the queue, so ↑↓ and the letters work at once.
    root.current?.querySelector<HTMLElement>('[role="listbox"]')?.focus()
  }, [])

  /** After a decision: the item leaves an "open" queue, the next one takes its place, one status line says it is logged. */
  const settle = (what: string, leaves: boolean) => {
    setDone({ text: what, at: new Date() })
    if (!leaves || !list) return reload()
    const rest = list.filter((x) => x.id !== current?.id)
    select(rest[Math.min(index, rest.length - 1)]?.id ?? null)
    if (tab === 'reports') reports.setItems((l) => l?.filter((x) => x.id !== current?.id) ?? l)
    if (tab === 'appeals') appeals.setItems((l) => l?.filter((x) => x.id !== current?.id) ?? l)
  }

  const counts = {
    reports: reportStatus === 'open' ? (reports.items?.length ?? 0) : 0,
    appeals: appealStatus === 'open' ? (appeals.items?.length ?? 0) : 0,
    quarantine: quarantine.items?.filter((q) => !q.releasedAt && !q.purgedAt).length ?? 0,
  }

  return (
    <motion.div
      ref={root}
      className={s.root}
      role="dialog"
      aria-modal="true"
      aria-label={t.open}
      data-staff
      initial={{ opacity: 0, scale: 0.985 }}
      animate={{
        opacity: 1,
        scale: 1,
        transition: { duration: 0.22, ease: EASE_OUT_QUART },
      }}
      exit={{
        opacity: 0,
        scale: 0.99,
        transition: { duration: 0.14, ease: EASE_IN },
      }}
    >
      <section className={s.queue} aria-label={t.tabs[tab]}>
        <header className={s.queueHead}>
          <div className={s.titleRow}>
            <h1 className={s.title}>{t.title}</h1>
            <IconButton icon={RefreshCw} label={t.refresh} size="sm" onClick={() => [reports.load, appeals.load, quarantine.load].forEach((f) => f())} />
          </div>
          <Tabs
            label={t.title}
            value={tab}
            onChange={setTab}
            items={TABS.map((x) => ({
              value: x,
              label: t.tabs[x],
              badge: counts[x],
            }))}
          />
          {tab === 'reports' && (
            <SegmentedControl
              label={t.tabs.reports}
              value={reportStatus}
              onChange={setReportStatus}
              items={(['open', 'resolved', 'dismissed'] as const).map((v) => ({
                value: v,
                label: t.reportStatus[v],
              }))}
            />
          )}
          {tab === 'appeals' && (
            <SegmentedControl
              label={t.tabs.appeals}
              value={appealStatus}
              onChange={setAppealStatus}
              items={(['open', 'upheld', 'rejected'] as const).map((v) => ({
                value: v,
                label: t.appealStatus[v],
              }))}
            />
          )}
        </header>
        <div className={s.list} role="listbox" tabIndex={-1} aria-label={t.tabs[tab]} aria-activedescendant={current ? `row-${current.id}` : undefined}>
          {error && !list ? (
            <div className={s.listNote}>
              <span className={s.error}>{error}</span>
              <Button size="sm" onClick={reload}>
                {t.retry}
              </Button>
            </div>
          ) : !list ? (
            <div className={s.listNote}>
              <Spinner size={16} label={t.loading} />
            </div>
          ) : list.length === 0 ? (
            <QueueEmpty tab={tab} open={tab === 'reports' ? reportStatus === 'open' : tab === 'appeals' ? appealStatus === 'open' : true} />
          ) : tab === 'reports' ? (
            reports.items!.map((r) => <ReportRow key={r.id} r={r} selected={r.id === current?.id} onSelect={() => select(r.id)} />)
          ) : tab === 'appeals' ? (
            appeals.items!.map((a) => <AppealRow key={a.id} a={a} selected={a.id === current?.id} onSelect={() => select(a.id)} />)
          ) : (
            quarantine.items!.map((q) => <QuarantineRow key={q.id} q={q} selected={q.id === current?.id} onSelect={() => select(q.id)} />)
          )}
        </div>
        <footer className={s.legend}>
          <Kbd>↑ ↓</Kbd> {t.legend.move}
          <Kbd>1 2 3</Kbd> {t.legend.queues}
          <Kbd>Esc</Kbd> {t.legend.close}
        </footer>
      </section>

      <section className={s.detail} aria-label={t.decision}>
        <div className={s.detailBar}>
          {done ? (
            <span className={s.done} role="status">
              <Icon icon={CheckCircle2} size={14} />
              {t.done(done.text, clock(done.at))}
            </span>
          ) : (
            <span />
          )}
          <IconButton icon={X} label={t.close} shortcut="Esc" onClick={closeStaff} />
        </div>
        <div className={s.detailScroll}>
          {report && target ? (
            <ReportDetail
              key={report.id}
              r={report}
              target={target}
              files={quarantine.items ?? []}
              onDecide={askReport}
              onQuarantine={(a) =>
                setPending({
                  kind: 'quarantine',
                  attachment: a,
                  reportId: report.id,
                })
              }
              onRelease={askRelease}
            />
          ) : appeal ? (
            <AppealDetail key={appeal.id} a={appeal} onDecide={askAppeal} />
          ) : qfile ? (
            <QuarantineDetail key={qfile.id} q={qfile} onRelease={() => askRelease(qfile)} />
          ) : (
            list && list.length > 0 && <p className={s.pick}>{t.empty.pick}</p>
          )}
        </div>
      </section>

      <DecisionDialog
        pending={pending}
        onClose={() => setPending(null)}
        onDone={(what, leaves) => {
          const p = pending
          setPending(null)
          settle(what, leaves)
          if (p?.kind === 'quarantine' || p?.kind === 'release' || (p?.kind === 'report' && p.report.reason === 'csam')) quarantine.load()
        }}
      />
    </motion.div>
  )
}

function QueueEmpty({ tab, open }: { tab: Tab; open: boolean }) {
  const [title, body] =
    tab === 'reports' ? (open ? t.empty.reports : t.empty.done) : tab === 'appeals' ? (open ? t.empty.appeals : t.empty.done) : t.empty.quarantine
  return (
    <div className={s.empty}>
      <EmptyState icon={tab === 'quarantine' ? FileLock2 : CheckCircle2} title={title}>
        {body}
      </EmptyState>
    </div>
  )
}

// ── rows ───────────────────────────────────────────────────────

function Row({ id, selected, onSelect, children }: { id: string; selected: boolean; onSelect: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="option"
      id={`row-${id}`}
      data-row={id}
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      className={s.row}
      onClick={onSelect}
    >
      {children}
    </button>
  )
}

function TierChip({ reason, priority }: Pick<AdminReport, 'reason' | 'priority'>) {
  const tier = tierOf({ reason, priority })
  if (tier === 'normal') return null
  return (
    <span className={tier === 'csam' ? s.tierCsam : s.tierUrgent}>
      <Icon icon={tier === 'csam' ? ShieldAlert : AlertTriangle} size={12} />
      {t.tier[tier]}
    </span>
  )
}

function ReportRow({ r, selected, onSelect }: { r: AdminReport; selected: boolean; onSelect: () => void }) {
  const target = useMemo(() => readTarget(r), [r])
  // Never a preview of the text for csam: the list is glanced at, the detail is a deliberate look.
  const summary =
    target.kind === 'message'
      ? `${target.author?.displayName ?? t.gone}${r.reason === 'csam' || !target.content ? '' : ` · ${target.content}`}`
      : target.kind === 'user'
        ? target.user
          ? `@${target.user.username}`
          : t.gone
        : target.name
  return (
    <Row id={r.id} selected={selected} onSelect={onSelect}>
      <span className={s.rowTop}>
        <TierChip reason={r.reason} priority={r.priority} />
        <span className={s.rowTitle}>{REASON[r.reason][0]}</span>
        <span className={`${s.rowAge} tnum`}>{ago(r.status === 'open' ? r.createdAt : (r.resolvedAt ?? r.createdAt))}</span>
      </span>
      <span className={s.rowSub}>
        <span className={s.rowKind}>{t.target[target.kind]}</span>
        <span className={s.rowText}>{summary}</span>
      </span>
    </Row>
  )
}

function AppealRow({ a, selected, onSelect }: { a: AdminAppeal; selected: boolean; onSelect: () => void }) {
  const who = usePerson(a.userId)
  return (
    <Row id={a.id} selected={selected} onSelect={onSelect}>
      <span className={s.rowTop}>
        <span className={s.rowTitle}>
          {t.appeal.action[a.action.type]} · {REASON[a.action.reason as keyof typeof REASON]?.[0] ?? cap(RULE[a.action.reason])}
        </span>
        <span className={`${s.rowAge} tnum`}>{ago(a.createdAt)}</span>
      </span>
      <span className={s.rowSub}>
        <span className={s.rowText}>{who ? `${who.displayName} · @${who.username}` : '…'}</span>
      </span>
    </Row>
  )
}

function QuarantineRow({ q, selected, onSelect }: { q: QuarantinedFile; selected: boolean; onSelect: () => void }) {
  return (
    <Row id={q.id} selected={selected} onSelect={onSelect}>
      <span className={s.rowTop}>
        <span className={s.rowTitle}>{q.filename}</span>
        <span className={`${s.rowAge} tnum`}>{ago(q.createdAt)}</span>
      </span>
      <span className={s.rowSub}>
        <span className={s.rowKind}>{q.releasedAt ? t.released : q.purgedAt ? t.purged : t.quarantined}</span>
        <span className={s.rowText}>
          {q.contentType} · {formatBytes(q.size)}
        </span>
      </span>
    </Row>
  )
}

// ── details ────────────────────────────────────────────────────

function Section({ title, icon, children }: { title: string; icon?: LucideIcon; children: ReactNode }) {
  return (
    <section className={s.section}>
      <h3 className={s.sectionTitle}>
        {icon && <Icon icon={icon} size={14} />}
        {title}
      </h3>
      {children}
    </section>
  )
}

function PersonLine({ user, fallback, extra }: { user: PublicUser | null; fallback?: string; extra?: ReactNode }) {
  return (
    <span className={s.person}>
      {user && <Avatar user={user} size={20} decorative />}
      <span className={s.personName}>{user ? user.displayName : (fallback ?? '…')}</span>
      {user && <span className={s.muted}>@{user.username}</span>}
      {extra}
    </span>
  )
}

function ReportDetail({
  r,
  target,
  files,
  onDecide,
  onQuarantine,
  onRelease,
}: {
  r: AdminReport
  target: Target
  files: QuarantinedFile[]
  onDecide: (d: Decision) => void
  onQuarantine: (a: SnapAttachment) => void
  onRelease: (q: QuarantinedFile) => void
}) {
  const csam = r.reason === 'csam'
  const reporter = usePerson(r.reporterId)
  const owner = usePerson(target.kind === 'space' ? r.targetUserId : null)
  const [reveal, setReveal] = useState(false)
  return (
    <article className={s.article}>
      <header className={s.head}>
        <div className={s.headMeta}>
          <TierChip reason={r.reason} priority={r.priority} />
          <span className={`${s.muted} tnum`}>
            {t.target[target.kind]} · {t.reported(ago(r.createdAt))} · {longDateTime(r.createdAt)}
          </span>
        </div>
        <h2 className={s.headTitle}>{REASON[r.reason][0]}</h2>
        <p className={s.headSub}>{REASON[r.reason][1]}</p>
      </header>

      {csam && (
        <div className={s.care} role="note">
          <Icon icon={ShieldAlert} size={16} />
          <p>{t.csamCare}</p>
        </div>
      )}

      <Section title={t.target[target.kind]}>
        {target.kind === 'message' ? (
          <div className={s.quote}>
            <div className={s.quoteHead}>
              <PersonLine user={target.author} fallback={t.gone} />
              <span className={s.muted}>
                {t.inChannel(target.channelName, target.dm)}
                {target.createdAt && ` · ${longDateTime(target.createdAt)}`}
                {target.edited && ` · ${t.edited}`}
              </span>
            </div>
            {csam && !reveal ? (
              <Button size="sm" variant="ghost" icon={Eye} onClick={() => setReveal(true)}>
                {t.showText}
              </Button>
            ) : (
              <p className={s.quoteText}>{target.content || <span className={s.muted}>{t.noText}</span>}</p>
            )}
            {target.attachments.length > 0 && (
              <div className={s.files}>
                <span className={s.filesTitle}>{t.attachments}</span>
                {target.attachments.map((a) => (
                  <AttachmentLine
                    key={a.id}
                    a={a}
                    q={files.find((f) => f.attachmentId === a.id && !f.releasedAt)}
                    open={r.status === 'open'}
                    onQuarantine={() => onQuarantine(a)}
                    onRelease={onRelease}
                  />
                ))}
              </div>
            )}
          </div>
        ) : target.kind === 'user' ? (
          <div className={s.quote}>
            <PersonLine user={target.user} fallback={t.gone} />
            {target.user?.bio && <p className={s.quoteText}>{target.user.bio}</p>}
          </div>
        ) : (
          <div className={s.quote}>
            <span className={s.personName}>{target.name}</span>
            <span className={s.muted}>
              {target.memberCount !== null && t.members(target.memberCount)}
              {target.createdAt && ` · ${longDate(target.createdAt)}`}
            </span>
            <PersonLine user={owner} extra={<span className={s.chip}>{t.owner}</span>} />
          </div>
        )}
      </Section>

      <Section title={t.details}>
        <p className={s.body}>{r.details || <span className={s.muted}>{t.noDetails}</span>}</p>
      </Section>

      <Section title={t.reporter}>
        {r.reporterId ? (
          <PersonLine
            user={reporter}
            extra={
              r.reporterFalseReports !== null && (
                <span className={`${s.chip} ${r.reporterFalseReports > 0 ? s.chipWarn : ''}`}>{t.falseReports(r.reporterFalseReports)}</span>
              )
            }
          />
        ) : (
          <span className={s.muted}>{t.reporterGone}</span>
        )}
      </Section>

      {r.status === 'open' ? (
        <DecisionBar r={r} onDecide={onDecide} />
      ) : (
        <Decided
          by={r.staffId}
          at={r.resolvedAt}
          note={r.staffNote}
          outcome={`${t.outcome[r.status as 'resolved' | 'dismissed']}${r.status === 'resolved' && r.action ? ` · ${ACTION_LABEL[r.action]}` : ''}`}
        />
      )}
    </article>
  )
}

function AttachmentLine({
  a,
  q,
  open,
  onQuarantine,
  onRelease,
}: {
  a: SnapAttachment
  q?: QuarantinedFile
  open: boolean
  onQuarantine: () => void
  onRelease: (q: QuarantinedFile) => void
}) {
  return (
    <div className={s.file}>
      <Icon icon={q ? FileLock2 : FileText} size={16} />
      <span className={s.fileText}>
        <span className={s.fileName}>{a.filename}</span>
        <span className={`${s.muted} tnum`}>
          {a.contentType} · {formatBytes(a.size)}
          {a.width && a.height ? ` · ${a.width}×${a.height}` : ''}
        </span>
      </span>
      {q ? (
        <>
          <span className={s.chip}>{q.purgedAt ? t.purged : t.quarantined}</span>
          {!q.purgedAt && (
            <Button size="sm" variant="ghost" onClick={() => onRelease(q)}>
              {t.release}
            </Button>
          )}
        </>
      ) : (
        open && (
          <Button size="sm" onClick={onQuarantine}>
            {t.quarantine}
          </Button>
        )
      )}
    </div>
  )
}

const DECISIONS: Decision[] = ['dismiss', 'none', 'remove_content', 'warn', 'suspend', 'ban']

function DecisionBar({ r, onDecide }: { r: AdminReport; onDecide: (d: Decision) => void }) {
  const why = [...new Set(DECISIONS.map((d) => unavailable(r, d)).filter((x) => x !== null))]
  return (
    <Section title={t.decision}>
      <div className={s.decisions}>
        {DECISIONS.map((d) => (
          <Button key={d} size="sm" disabled={!!unavailable(r, d)} onClick={() => onDecide(d)}>
            {d === 'none' ? t.noneShort : t.decisions[d]}
            <Kbd>{keyFor(REPORT_KEYS, d)}</Kbd>
          </Button>
        ))}
      </div>
      {why.map((w) => (
        <p key={w} className={s.muted}>
          {t.unavailable[w]}
        </p>
      ))}
      {r.reason === 'csam' && <p className={s.muted}>{t.csamResolve}</p>}
    </Section>
  )
}

function Decided({ by, at, note, outcome }: { by: string | null; at: string | null; note: string | null; outcome: string }) {
  const staff = usePerson(by)
  return (
    <Section title={t.decision}>
      <div className={s.quote}>
        <span className={s.personName}>{outcome}</span>
        {/* AdminAppeal carries no staffId: then only the date. */}
        <span className={s.muted}>{by ? t.decided(staff?.displayName ?? '…', at ? longDateTime(at) : '—') : at ? longDateTime(at) : '—'}</span>
        {note && <p className={s.quoteText}>{note}</p>}
        <span className={s.audit}>
          <Icon icon={ScrollText} size={12} />
          {t.audit}
        </span>
      </div>
    </Section>
  )
}

function AppealDetail({ a, onDecide }: { a: AdminAppeal; onDecide: (s: PatchAppealBody['status']) => void }) {
  const who = usePerson(a.userId)
  return (
    <article className={s.article}>
      <header className={s.head}>
        <div className={s.headMeta}>
          <span className={`${s.muted} tnum`}>{t.appeal.sent(ago(a.createdAt), longDateTime(a.createdAt))}</span>
        </div>
        <h2 className={s.headTitle}>
          {t.appeal.action[a.action.type]}: {RULE[a.action.reason]}
        </h2>
        <PersonLine user={who} />
      </header>
      <Section title={t.appeal.measure}>
        <div className={s.quote}>
          <span className={s.personName}>
            {t.appeal.action[a.action.type]}
            {a.action.until ? ` · até ${longDateTime(a.action.until)}` : ''}
          </span>
          <span className={s.muted}>
            {cap(RULE[a.action.reason])} · {longDate(a.action.createdAt)}
            {a.action.reportId ? ` · ${t.appeal.fromReport}` : ''}
          </span>
        </div>
      </Section>
      <Section title={t.appeal.message}>
        <p className={s.body}>{a.message}</p>
      </Section>
      {a.status === 'open' ? (
        <Section title={t.decision}>
          <div className={s.decisions}>
            <Button size="sm" onClick={() => onDecide('rejected')}>
              {t.appeal.keep}
              <Kbd>{keyFor(APPEAL_KEYS, 'rejected')}</Kbd>
            </Button>
            <Button size="sm" onClick={() => onDecide('upheld')}>
              {t.appeal.revert}
              <Kbd>{keyFor(APPEAL_KEYS, 'upheld')}</Kbd>
            </Button>
          </div>
        </Section>
      ) : (
        <Decided by={null} at={a.decidedAt} note={a.staffNote} outcome={t.appeal.decided[a.status as 'upheld' | 'rejected']} />
      )}
    </article>
  )
}

function QuarantineDetail({ q, onRelease }: { q: QuarantinedFile; onRelease: () => void }) {
  const by = usePerson(q.staffId)
  const facts: Array<[string, ReactNode]> = [
    [t.q.kind, `${q.contentType} · ${formatBytes(q.size)}`],
    [t.q.hash, q.sha256 ? <code className={s.hash}>{q.sha256}</code> : <span className={s.muted}>{t.q.hashPending}</span>],
    [t.q.stored, q.evidenceStored ? 'Sim' : 'Ainda não'],
    ['Origem', q.staffId ? t.q.by(by?.displayName ?? '…') : t.q.auto],
    [t.q.protocol, q.authorityProtocol ?? <span className={s.muted}>{t.q.noProtocol}</span>],
  ]
  return (
    <article className={s.article}>
      <header className={s.head}>
        <div className={s.headMeta}>
          <span className={s.chip}>{q.releasedAt ? t.released : q.purgedAt ? t.purged : t.quarantined}</span>
          <span className={`${s.muted} tnum`}>{longDateTime(q.createdAt)}</span>
        </div>
        <h2 className={s.headTitle}>{q.filename}</h2>
        <p className={s.headSub}>{t.q.noView}</p>
      </header>
      <Section title={t.q.record}>
        <dl className={s.facts}>
          {facts.map(([k, v]) => (
            <div key={k} className={s.fact}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </Section>
      {!q.releasedAt && !q.purgedAt && (
        <Section title={t.decision}>
          <div className={s.decisions}>
            <Button size="sm" onClick={onRelease}>
              {t.release}
              <Kbd>{keyFor(QUARANTINE_KEYS, 'release')}</Kbd>
            </Button>
          </div>
        </Section>
      )}
    </article>
  )
}

// ── the confirmation ───────────────────────────────────────────

function DecisionDialog({ pending, onClose, onDone }: { pending: Pending | null; onClose: () => void; onDone: (what: string, leaves: boolean) => void }) {
  const [note, setNote] = useState('')
  const [days, setDays] = useState<SuspendDays>(7)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    setNote('')
    setDays(7)
    setError(null)
  }, [pending])
  if (!pending) return <Modal open={false} onClose={onClose} title="" />

  const cfg =
    pending.kind === 'report'
      ? {
          title: t.confirmTitle(t.decisions[pending.decision], pending.who),
          body:
            pending.decision !== 'dismiss' && pending.report.reason === 'csam'
              ? `${t.consequence[pending.decision]} ${t.csamResolve}`
              : t.consequence[pending.decision],
          confirm: t.decisions[pending.decision],
          danger: pending.decision === 'ban' || pending.decision === 'suspend' || pending.decision === 'remove_content',
          note: true,
        }
      : pending.kind === 'appeal'
        ? {
            title: `${pending.status === 'upheld' ? t.appeal.revert : t.appeal.keep}: ${pending.who}?`,
            body: pending.status === 'upheld' ? t.appeal.revertBody : t.appeal.keepBody,
            confirm: pending.status === 'upheld' ? t.appeal.revert : t.appeal.keep,
            danger: false,
            note: true,
          }
        : pending.kind === 'quarantine'
          ? {
              title: t.q.quarantineTitle(pending.attachment.filename),
              body: t.q.quarantineBody,
              confirm: t.quarantine,
              danger: false,
              note: true,
            }
          : {
              title: t.q.releaseTitle(pending.file.filename),
              body: t.q.releaseBody,
              confirm: t.release,
              danger: false,
              note: false,
            }

  const run = async (e?: FormEvent) => {
    e?.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const n = note.trim() || undefined
      if (pending.kind === 'report') {
        await api('PATCH', `/admin/reports/${pending.report.id}`, decisionBody(pending.decision, { days, note: n }))
        onDone(`${t.decisionDone[pending.decision]}: ${pending.who}`, true)
      } else if (pending.kind === 'appeal') {
        await api('PATCH', `/admin/appeals/${pending.appeal.id}`, {
          status: pending.status,
          note: n,
        } satisfies PatchAppealBody)
        onDone(`${pending.status === 'upheld' ? t.appeal.revertDone : t.appeal.keepDone}: ${pending.who}`, true)
      } else if (pending.kind === 'quarantine') {
        await api('POST', `/admin/attachments/${pending.attachment.id}/quarantine`, { reportId: pending.reportId, note: n })
        onDone(`${t.q.quarantineDone}: ${pending.attachment.filename}`, false)
      } else {
        await api('POST', `/admin/quarantine/${pending.file.id}/release`)
        onDone(`${t.q.releaseDone}: ${pending.file.filename}`, false)
      }
    } catch (err) {
      setError(pending.kind === 'release' && err instanceof ApiRequestError && err.status === 409 ? `${err.message} ${t.q.pendingCopy}` : errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={cfg.title}
      description={cfg.body}
      width={520}
      footer={
        <>
          <span className={s.footAudit}>
            <Icon icon={ScrollText} size={12} />
            {cfg.note ? t.auditFoot : t.auditFootNoNote}
          </span>
          {/* Without a note field, the first focus is Cancelar: Enter alone never releases evidence. */}
          <Button variant="ghost" onClick={onClose} data-autofocus={cfg.note ? undefined : true}>
            {t.cancel}
          </Button>
          <Button variant={cfg.danger ? 'danger' : 'primary'} loading={busy} onClick={() => void run()}>
            {cfg.confirm}
          </Button>
        </>
      }
    >
      {(cfg.note || error) && (
        <form
          className={s.form}
          onSubmit={(e) => void run(e)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void run(e)
          }}
        >
          {pending.kind === 'report' && pending.decision === 'suspend' && (
            <div className={s.field}>
              <span className={s.fieldLabel}>{t.until}</span>
              <SegmentedControl
                label={t.until}
                value={String(days)}
                onChange={(v) => setDays(Number(v) as SuspendDays)}
                items={SUSPEND_DAYS.map((d) => ({
                  value: String(d),
                  label: t.days(d),
                }))}
              />
              <span className={`${s.muted} tnum`}>{t.untilLine(longDateTime(new Date(Date.now() + days * 86_400_000).toISOString()))}</span>
            </div>
          )}
          {cfg.note && (
            <label className={s.field}>
              <span className={s.fieldLabel}>
                {t.note} <span className={s.muted}>· {t.noteOptional}</span>
              </span>
              <textarea
                className={s.textarea}
                rows={3}
                maxLength={2000}
                value={note}
                placeholder={t.notePlaceholder}
                data-autofocus
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
          )}
          {error && (
            <p className={s.error} role="alert">
              {error}
            </p>
          )}
        </form>
      )}
    </Modal>
  )
}
