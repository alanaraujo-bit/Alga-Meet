import { STREAM_PRESETS, type BillingCatalog, type BillingMe, type OrderStatus, type PlanSummary, type Product, type StreamPreset, type SubscriptionStatus } from '@alga/shared'
import { Check, CircleCheck, Clock, ExternalLink, FlaskConical, Lock, Minus } from '@/ui/icons'
import { useEffect, useState } from 'react'
import { errorText } from '@/lib/errors'
import { useData } from '@/store/data'
import { Button, Icon, Modal, SegmentedControl, Spinner, toast } from '@/ui'
import { needsVerification, openVerifyEmail, toastError } from '../auth/VerifyEmail'
import { Group, Row } from '../settings/Frame'
import { openSettings } from '../settings/store'
import { TeenPurchaseNotice, useIsTeen } from '../trust/Privacy'
import { historyOf, money } from './look'
import { cancelRenewal, loadBilling, reopenCheckout, resumeRenewal, startCheckout, stopWaiting, useBilling } from './store'
import { t } from './strings'
import st from '../settings/settings.module.css'
import s from './billing.module.css'

const dateFmt = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' })
const day = (iso: string | null | undefined) => (iso ? dateFmt.format(new Date(iso)) : '—')
const MB = 1024 * 1024

export const presetLabel = (p: StreamPreset) => {
  const { height, fps } = STREAM_PRESETS[p]
  return `${height === 2160 ? '4K' : `${height}p`}${fps}`
}

/** Sandbox / payments-off notice, shared by Assinatura and Personalização. */
export function ProviderNotice({ catalog }: { catalog: BillingCatalog }) {
  if (catalog.provider && !catalog.provider.sandbox) return null
  return (
    <div className={s.notice} role="note">
      {catalog.provider ? (
        <>
          <span className={s.sandboxChip}>
            <Icon icon={FlaskConical} size={12} />
            {t.sandbox}
          </span>
          <span>{t.sandboxBody}</span>
        </>
      ) : (
        <span>{t.disabled}</span>
      )}
    </div>
  )
}

/** Loading / error gate for the billing pages. */
export function useBillingReady(): { catalog: BillingCatalog; me: BillingMe } | 'loading' | { error: string } {
  const catalog = useBilling((x) => x.catalog)
  const me = useBilling((x) => x.me)
  const error = useBilling((x) => x.loadError)
  useEffect(() => {
    if (!catalog || !me) void loadBilling()
  }, [catalog, me])
  if (catalog && me) return { catalog, me }
  return error ? { error } : 'loading'
}

export function BillingGate({ state }: { state: 'loading' | { error: string } }) {
  if (state === 'loading') return <Row label={<Spinner size={16} label="Carregando" />} />
  return (
    <Row label={<span className={st.error}>{state.error}</span>}>
      <Button size="sm" onClick={() => void loadBilling()}>
        {t.retry}
      </Button>
    </Row>
  )
}

export function PlanSection() {
  const ready = useBillingReady()
  if (ready === 'loading' || 'error' in ready) return <BillingGate state={ready} />
  return <PlanPage catalog={ready.catalog} me={ready.me} />
}

function PlanPage({ catalog, me }: { catalog: BillingCatalog; me: BillingMe }) {
  const waiting = useBilling((x) => x.waiting)
  const arrived = useBilling((x) => x.arrived)
  const declined = useBilling((x) => x.declined)
  const plans = catalog.products.filter((p) => p.kind === 'plan' && p.purchasable)
  const plus = me.plan.id !== 'free'
  const sub = me.subscription
  // The confirmation moment is shown once, here; leaving the page ends it.
  useEffect(() => () => void (useBilling.getState().arrived?.startsWith('plan:') && useBilling.setState({ arrived: null })), [])
  const planArrived = !!arrived?.startsWith('plan:')
  const planWaiting = waiting?.product.kind === 'plan' ? waiting : null
  const teen = useIsTeen()

  return (
    <>
      <ProviderNotice catalog={catalog} />
      <Group title={t.plan.current}>
        <div className={`${s.planCard} ${plus ? s.planPlus : ''} ${planArrived ? s.arrived : ''}`}>
          <div className={s.planText}>
            <span className={s.planName}>{me.plan.name}</span>
            {planArrived ? (
              <span className={s.arrivedLine} role="status">
                <Icon icon={CircleCheck} size={14} />
                {t.plan.arrived}
              </span>
            ) : plus && sub ? (
              <span className={`${s.planLine} ${sub.status === 'past_due' ? s.warn : ''}`}>
                {sub.status === 'past_due'
                  ? t.plan.pastDueLine
                  : sub.cancelAtPeriodEnd
                    ? t.plan.canceledLine(day(sub.currentPeriodEnd), money(sub.amountCents, sub.currency))
                    : t.plan.plusLine(catalog.products.find((p) => p.id === sub.productId)?.interval, day(sub.currentPeriodEnd), money(sub.amountCents, sub.currency))}
              </span>
            ) : (
              <span className={s.planLine}>{t.plan.freeLine}</span>
            )}
          </div>
          {/* Not during the confirmation moment: "cancel" is not the next thing to say to someone who just paid. */}
          {plus && sub && sub.status === 'active' && !sub.cancelAtPeriodEnd && !planArrived && (
            <CancelRenewal until={day(sub.currentPeriodEnd)} freeMb={Math.round((catalog.plans.find((p) => p.id === 'free')?.maxAttachmentBytes ?? 0) / MB)} />
          )}
          {plus && sub && sub.status === 'active' && sub.cancelAtPeriodEnd && <ResumeRenewal />}
        </div>
        {!plus && planWaiting && <Waiting />}
        {!plus && !planWaiting && declined && plans.some((p) => p.id === declined) && <p className={s.declined}>{t.waiting.declined}</p>}
      </Group>

      <Compare catalog={catalog} current={me.plan} />
      {!plus && !planWaiting && plans.length > 0 && (teen ? <Group><TeenPurchaseNotice /></Group> : <Subscribe plans={plans} enabled={!!catalog.provider} sandbox={!!catalog.provider?.sandbox} />)}
      <History catalog={catalog} me={me} />
    </>
  )
}

export function Waiting() {
  return (
    <div className={s.waiting} role="status">
      <Spinner size={16} />
      <div className={s.waitingText}>
        <span className={st.rowLabel}>{t.waiting.title}</span>
        <span className={st.rowHint}>{t.waiting.body}</span>
        <span className={s.waitingActions}>
          <Button size="sm" icon={ExternalLink} onClick={reopenCheckout}>
            {t.waiting.reopen}
          </Button>
          <Button size="sm" variant="ghost" onClick={stopWaiting}>
            {t.waiting.stop}
          </Button>
        </span>
      </div>
    </div>
  )
}

function Compare({ catalog, current }: { catalog: BillingCatalog; current: PlanSummary }) {
  const free = catalog.plans.find((p) => p.id === 'free')
  const paid = catalog.plans.find((p) => p.id === 'plus')
  if (!free || !paid) return null
  const collection = catalog.products.filter((p) => p.kind === 'cosmetic' && p.includedIn?.includes('plus')).map((p) => p.name.replace(/^(Tema|Placa) /, (m) => m.toLowerCase()))
  const extra = paid.streamPresets.filter((p) => !free.streamPresets.includes(p))
  const rows: Array<[string, React.ReactNode, React.ReactNode]> = [
    [t.compare.voice, t.compare.voiceBoth, t.compare.voiceBoth],
    [t.compare.stream, free.streamPresets.map(presetLabel).join(' · '), <><span className={s.plusMark}>+</span> {extra.map(presetLabel).join(' · ')}</>],
    [t.compare.files, t.compare.filesUpTo(Math.round(free.maxAttachmentBytes / MB)), t.compare.filesUpTo(Math.round(paid.maxAttachmentBytes / MB))],
    [t.compare.social, t.compare.socialBoth, t.compare.socialBoth],
    [t.compare.collection, t.compare.collectionNone, collection.length ? `${collection.join(' e ')}, ${t.compare.collectionWhile}` : t.compare.collectionNone],
  ]
  return (
    <Group title={t.compare.title} description={t.compare.body}>
      <table className={s.compare}>
        <thead>
          <tr>
            <th />
            <th scope="col" aria-current={current.id === 'free' || undefined}>
              {free.name}
            </th>
            <th scope="col" aria-current={current.id === 'plus' || undefined}>
              {paid.name}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, a, b]) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              <td>{a}</td>
              <td>{b}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Group>
  )
}

function Subscribe({ plans, enabled, sandbox }: { plans: Product[]; enabled: boolean; sandbox: boolean }) {
  const [interval, setPeriod] = useState<'month' | 'year'>('month')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ text: string; gated: boolean } | null>(null)
  const p = plans.find((x) => x.interval === interval) ?? plans[0]!
  const monthly = plans.find((x) => x.interval === 'month')
  const go = async () => {
    setBusy(true)
    setError(null)
    try {
      await startCheckout(p)
    } catch (e) {
      setError({ text: errorText(e), gated: needsVerification(e) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Group>
      <div className={s.subscribe}>
        <div className={s.priceBlock}>
          {plans.length > 1 && (
            <SegmentedControl
              label={t.subscribe.monthly}
              value={interval}
              onChange={setPeriod}
              items={[
                { value: 'month', label: t.subscribe.monthly },
                { value: 'year', label: t.subscribe.yearly },
              ]}
            />
          )}
          <span className={`${s.price} tnum`}>
            {money(p.priceBrlCents)}
            <span className={s.per}>{p.interval === 'year' ? t.subscribe.perYear : t.subscribe.perMonth}</span>
          </span>
          <span className={st.rowHint}>
            {p.interval === 'year' && monthly ? t.subscribe.yearlyNote(money(Math.round(p.priceBrlCents / 12))) : t.subscribe.monthlyNote}
          </span>
        </div>
        <div className={s.ctaBlock}>
          {error?.gated ? (
            <Button variant="primary" onClick={openVerifyEmail}>
              {t.subscribe.cta}
            </Button>
          ) : (
            <Button variant="primary" size="lg" loading={busy} disabled={!enabled} onClick={() => void go()}>
              {t.subscribe.cta}
            </Button>
          )}
          <span className={s.where}>
            <Icon icon={ExternalLink} size={12} />
            {sandbox ? t.subscribe.whereSandbox : t.subscribe.where}
          </span>
        </div>
        {/* Renewal and the 7-day right of withdrawal, said before the click, next to the button. */}
        <p className={s.subscribeFine}>{t.subscribe.fine}</p>
      </div>
      {error && (
        <p className={`${st.rowHint} ${st.error}`} role="alert">
          {error.text}
        </p>
      )}
    </Group>
  )
}

function CancelRenewal({ until, freeMb }: { until: string; freeMb: number }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const confirm = async () => {
    setBusy(true)
    try {
      const sub = await cancelRenewal()
      setOpen(false)
      toast.success(t.cancel.done(day(sub.currentPeriodEnd)))
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        {t.plan.cancel}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t.cancel.title}
        description={t.cancel.body(until, freeMb)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} data-autofocus>
              {t.cancel.keep}
            </Button>
            <Button variant="danger" loading={busy} onClick={() => void confirm()}>
              {t.cancel.confirm}
            </Button>
          </>
        }
      />
    </>
  )
}

/** Undo the cancel while the period is paid. No modal: nothing is charged now, and the line says when it renews. */
function ResumeRenewal() {
  const [busy, setBusy] = useState(false)
  const resume = async () => {
    setBusy(true)
    try {
      await resumeRenewal()
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Button variant="secondary" size="sm" loading={busy} onClick={() => void resume()}>
      {t.plan.resume}
    </Button>
  )
}

function History({ catalog, me }: { catalog: BillingCatalog; me: BillingMe }) {
  const rows = historyOf(me)
  return (
    <Group title={t.history.title}>
      {rows.length === 0 ? (
        <p className={s.empty}>{t.history.empty}</p>
      ) : (
        rows.map((r) => {
          const product = catalog.products.find((p) => p.id === r.productId)
          const ok = r.status === 'paid' || r.status === 'active'
          return (
            <div key={r.id} className={s.historyRow}>
              <span className={s.historyIcon} data-ok={ok || undefined}>
                <Icon icon={ok ? Check : r.status === 'pending' ? Clock : Minus} size={14} />
              </span>
              <span className={st.rowText}>
                <span className={st.rowLabel}>{product?.name ?? t.history.unknown}</span>
                <span className={`${st.rowHint} tnum`}>
                  {day(r.createdAt)} · {r.kind === 'order' ? t.history.order[r.status as OrderStatus] : t.history.subscription[r.status as SubscriptionStatus]}
                </span>
              </span>
              {r.sandbox && <span className={s.testChip}>{t.test}</span>}
              <span className={`${s.amount} tnum`}>{money(r.amountCents, r.currency)}</span>
            </div>
          )
        })
      )}
    </Group>
  )
}

/** Settings › Voz e vídeo: the presets the plan allows (Me.plan), with one calm way to the plan page. */
export function StreamPlanGroup() {
  const plan = useData((x) => x.me?.plan)
  if (!plan) return null
  const all = Object.keys(STREAM_PRESETS) as StreamPreset[]
  const locked = all.some((p) => !plan.streamPresets.includes(p))
  return (
    <Group title={t.voice.title} description={t.voice.body}>
      <div className={s.presets} role="list">
        {all.map((p) => {
          const ok = plan.streamPresets.includes(p)
          return (
            <span key={p} role="listitem" className={`${s.preset} ${ok ? '' : s.presetLocked} tnum`} aria-label={`${presetLabel(p)}: ${ok ? t.voice.allowed : t.voice.locked}`}>
              <Icon icon={ok ? Check : Lock} size={12} />
              {presetLabel(p)}
            </span>
          )
        })}
      </div>
      <div className={s.planHint}>
        <span>{locked ? t.voice.hintFree : t.voice.hintPlus}</span>
        {locked && (
          <Button size="sm" variant="ghost" onClick={() => openSettings('plan')}>
            {t.voice.seePlan}
          </Button>
        )}
      </div>
    </Group>
  )
}
