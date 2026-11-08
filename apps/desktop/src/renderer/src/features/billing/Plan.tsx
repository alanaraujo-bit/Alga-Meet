import {
  ANNUAL_ITEM_MAX_CENTS, PLUS_BADGES, STREAM_PRESETS, type BillingCatalog, type BillingMe, type Order, type OrderStatus, type PlanSummary, type Product,
  type StreamPreset, type Subscription, type SubscriptionStatus,
} from '@alga/shared'
import { Check, CircleCheck, Clock, ExternalLink, FlaskConical, Lock, Minus } from '@/ui/icons'
import { useEffect, useState } from 'react'
import { errorText } from '@/lib/errors'
import { useData } from '@/store/data'
import { Button, Icon, Modal, SegmentedControl, Spinner, toast } from '@/ui'
import { needsVerification, openVerifyEmail, toastError } from '../auth/VerifyEmail'
import { Group, Row } from '../settings/Frame'
import { openSettings } from '../settings/store'
import { TeenPurchaseNotice, useIsTeen } from '../trust/Privacy'
import { ACCENTS, INDIGO } from './accents'
import { canSetAppIcon } from './appIcon'
import { CosmeticThumb, demoLevel, SpeakingSample } from './Cosmetics'
import { Gift as GiftIcon, Medal, Sparkle, Ticket } from './icons'
import { historyOf, isCosmeticId, money, type CosmeticId } from './look'
import { AppIcon } from './render/AppIcon'
import { AuraGlyph } from './render/Voice'
import {
  cancelRenewal, claimAnnualItem, day, equip, equipAccent, loadBilling, openGift, refundOrder, refundPlan, reopenCheckout, resumeRenewal, startCheckout,
  stopWaiting, useBilling,
} from './store'
import { t } from './strings'
import st from '../settings/settings.module.css'
import s from './billing.module.css'
import p from './plus.module.css'

const MB = 1024 * 1024

export const presetLabel = (preset: StreamPreset) => {
  const { height, fps } = STREAM_PRESETS[preset]
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
  const plans = catalog.products.filter((x) => x.kind === 'plan' && x.purchasable)
  const plus = me.plan.id !== 'free'
  const sub = me.subscription
  // The confirmation moment is shown once, here; leaving the page ends it.
  useEffect(() => () => void (useBilling.getState().arrived?.startsWith('plan:') && useBilling.setState({ arrived: null })), [])
  const planArrived = !!arrived?.startsWith('plan:')
  const planWaiting = waiting?.product.kind === 'plan' && !waiting.giftId ? waiting : null
  const teen = useIsTeen()
  const badge = me.plus?.badge

  return (
    <>
      <ProviderNotice catalog={catalog} />
      <Group title={t.plan.current}>
        <div className={`${s.planCard} ${plus ? s.planPlus : ''} ${planArrived ? s.arrived : ''}`}>
          <div className={s.planText}>
            <span className={s.planName}>
              {me.plan.name}
              {plus && badge && (
                <span className={p.badgeChip}>
                  <Icon icon={Medal} size={12} />
                  {t.plus.badge(badge)}
                </span>
              )}
            </span>
            {planArrived ? (
              <span className={s.arrivedLine} role="status">
                <Icon icon={CircleCheck} size={14} />
                {t.plan.arrived}
              </span>
            ) : plus && sub ? (
              <span className={`${s.planLine} ${sub.status === 'past_due' ? s.warn : ''}`}>
                {sub.status === 'past_due'
                  ? t.plan.pastDueLine
                  : sub.kind === 'pass'
                    ? `${t.plus.passTitle} · até ${day(sub.currentPeriodEnd)}`
                    : sub.kind === 'period'
                      ? `${t.plus.payOnce} · até ${day(sub.currentPeriodEnd)} · sem renovação`
                      : sub.cancelAtPeriodEnd
                        ? t.plan.canceledLine(day(sub.currentPeriodEnd), money(sub.amountCents, sub.currency))
                        : t.plan.plusLine(catalog.products.find((x) => x.id === sub.productId)?.interval, day(sub.currentPeriodEnd), money(sub.amountCents, sub.currency))}
              </span>
            ) : (
              <span className={s.planLine}>{t.plan.freeLine}</span>
            )}
          </div>
          {/* Not during the confirmation moment: "cancel" is not the next thing to say to someone who just paid. */}
          {plus && sub && sub.kind !== 'period' && sub.kind !== 'pass' && sub.status === 'active' && !sub.cancelAtPeriodEnd && !planArrived && (
            <CancelRenewal until={day(sub.currentPeriodEnd)} freeMb={Math.round((catalog.plans.find((x) => x.id === 'free')?.maxAttachmentBytes ?? 0) / MB)} />
          )}
          {plus && sub && sub.kind !== 'period' && sub.kind !== 'pass' && sub.status === 'active' && sub.cancelAtPeriodEnd && <ResumeRenewal />}
        </div>
        {!plus && planWaiting && <Waiting />}
        {!plus && !planWaiting && declined && plans.some((x) => x.id === declined) && <p className={s.declined}>{t.waiting.declined}</p>}
      </Group>

      {plus && <PlusHome catalog={catalog} me={me} />}
      {!plus && <Worth catalog={catalog} />}
      <Compare catalog={catalog} current={me.plan} />
      {!plus && !planWaiting && plans.length > 0 && (teen ? <Group><TeenPurchaseNotice /></Group> : <Subscribe plans={plans} enabled={!!catalog.provider} sandbox={!!catalog.provider?.sandbox} />)}
      {!teen && (
        <Group title={t.plus.giftPlus} description={t.plus.giftPlusLine}>
          <div className={p.giftPlus}>
            {plans.filter((x) => x.billing === 'one_time').map((x) => (
              <Button key={x.id} icon={GiftIcon} onClick={() => openGift({ productId: x.id })} disabled={!catalog.provider}>
                {x.interval === 'year' ? t.gift.plusYear : t.gift.plusMonth} · <span className="tnum">{money(x.priceBrlCents)}</span>
              </Button>
            ))}
          </div>
        </Group>
      )}
      <History catalog={catalog} me={me} />
    </>
  )
}

export function Waiting() {
  const w = useBilling((x) => x.waiting)
  return (
    <div className={s.waiting} role="status">
      <Spinner size={16} />
      <div className={s.waitingText}>
        <span className={st.rowLabel}>{t.waiting.title}</span>
        <span className={st.rowHint}>{w?.inApp ? t.pay.waitingInApp : t.waiting.body}</span>
        {w?.pixOnly && <span className={st.rowHint}>{t.gift.pixOnly}</span>}
        <span className={s.waitingActions}>
          <Button size="sm" variant={w?.inApp ? 'primary' : 'secondary'} icon={w?.inApp ? undefined : ExternalLink} onClick={reopenCheckout}>
            {w?.inApp ? t.pay.resume : t.waiting.reopen}
          </Button>
          <Button size="sm" variant="ghost" onClick={stopWaiting}>
            {t.waiting.stop}
          </Button>
        </span>
      </div>
    </div>
  )
}

// ── Plus v2 for subscribers: the wardrobe in use, the badge, passes, the annual item ──

function PlusHome({ catalog, me }: { catalog: BillingCatalog; me: BillingMe }) {
  const status = me.plus
  const usable = (id: string) => me.items.some((e) => e.sku === id)
  const auras = catalog.products.filter((x) => x.cosmeticType === 'voice_aura' && isCosmeticId(x.id) && usable(x.id))
  const icons = catalog.products.filter((x) => x.cosmeticType === 'app_icon' && isCosmeticId(x.id) && usable(x.id))
  const accents = catalog.products.filter((x) => x.cosmeticType === 'app_accent' && ACCENTS[x.id] && usable(x.id))
  const monthly = catalog.products.filter((x) => x.includedIn?.includes('plus') && x.includedFrom && Date.parse(x.includedFrom) <= Date.now())
  const equipped = useData((x) => x.me?.cosmetics)
  // The sample speaks with your own face (photo or Eco): the account, not the billing record, is a user.
  const self = useData((x) => x.me)
  return (
    <>
      <Group title={t.plus.wardrobe} description={t.plus.wardrobeLine}>
        {monthly.length > 0 && (
          <Row label={t.plus.monthly} hint={monthly.map((x) => x.name).join(', ')}>
            <Button size="sm" variant="ghost" onClick={() => openSettings('shop')}>
              {t.seeInStore}
            </Button>
          </Row>
        )}
        <Picker
          title={t.plus.aura}
          hint={t.plus.auraLine}
          value={equipped?.voiceAura ?? null}
          options={[{ id: null, label: t.plus.auraDefault }, ...auras.map((x) => ({ id: x.id, label: x.name }))]}
          render={(id) => (
            <SpeakingSample user={self ?? { id: 'me', displayName: '', avatarUrl: null }} size={56} aura={(id ?? undefined) as CosmeticId | undefined} level={demoLevel(id ? id.length * 0.31 : 0)} className={p.auraSample}>
              <span className={p.auraPill}>
                <AuraGlyph id={(id ?? undefined) as CosmeticId | undefined} />
              </span>
            </SpeakingSample>
          )}
          onPick={(id) => equip('aura', id as CosmeticId | null)}
        />
        <Picker
          title={t.plus.icon}
          hint={canSetAppIcon() ? t.plus.iconLine : `${t.plus.iconLine} ${t.plus.iconPending}`}
          value={equipped?.appIcon ?? null}
          options={[{ id: null, label: t.plus.iconDefault }, ...icons.map((x) => ({ id: x.id, label: x.name.replace(/^Ícone /, '') }))]}
          render={(id) => (id ? <AppIcon id={id as CosmeticId} size={48} /> : <DefaultIcon />)}
          onPick={(id) => equip('icon', id as CosmeticId | null)}
        />
        <Picker
          title={t.plus.accent}
          hint={t.plus.accentLine}
          value={equipped?.appAccent ?? null}
          options={[{ id: null, label: t.plus.accentDefault }, ...accents.map((x) => ({ id: x.id, label: x.name.replace(/^Cor /, '') }))]}
          render={(id) => <Swatch fill={id ? ACCENTS[id]!.fill : INDIGO.fill} accent={id ? ACCENTS[id]!.accent : INDIGO.accent} />}
          onPick={(id) => equipAccent(id)}
        />
        <Row label={t.plus.banner} hint={t.plus.bannerLine} />
      </Group>

      {status && <Tenure months={status.tenureMonths} />}

      {status && status.passesLeft >= 0 && me.subscription?.kind !== 'pass' && (
        <Group title={t.plus.passes} description={status.passesLeft > 0 ? t.plus.passesLine(status.passesLeft) : t.plus.passesNone}>
          <Row label={<span className={p.passes}>{Array.from({ length: 2 }, (_, i) => <Icon key={i} icon={Ticket} size={16} filled={i < status.passesLeft} />)}</span>} hint={t.plus.passRule}>
            <Button size="sm" icon={Ticket} disabled={status.passesLeft <= 0} onClick={() => useBilling.setState({ passDialog: true })}>
              {t.plus.passSend}
            </Button>
          </Row>
        </Group>
      )}

      {status?.annualItem && <AnnualItem catalog={catalog} me={me} annual={status.annualItem} />}
    </>
  )
}

interface Option {
  id: string | null
  label: string
}
/** A row of choices drawn as the thing itself (a speaking ring, an icon, a color). Applies at once; the choice is on the account. */
function Picker({ title, hint, value, options, render, onPick }: { title: string; hint: string; value: string | null; options: Option[]; render: (id: string | null) => React.ReactNode; onPick: (id: string | null) => Promise<void> }) {
  const [busy, setBusy] = useState<string | null | undefined>(undefined)
  const pick = async (id: string | null) => {
    setBusy(id)
    try {
      await onPick(id)
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(undefined)
    }
  }
  return (
    <div className={p.picker}>
      <div className={p.pickerHead}>
        <span className={st.rowLabel}>{title}</span>
        <span className={st.rowHint}>{hint}</span>
      </div>
      <div className={p.options} role="radiogroup" aria-label={title}>
        {options.map((o) => (
          <button key={o.id ?? 'default'} type="button" role="radio" aria-checked={value === o.id} className={p.option} onClick={() => void pick(o.id)} disabled={busy !== undefined} data-cosmetic-hover>
            <span className={p.optionArt}>{render(o.id)}</span>
            <span className={p.optionLabel}>
              {value === o.id && <Icon icon={Check} size={12} />}
              {o.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

function Swatch({ fill, accent }: { fill: string; accent: string }) {
  return (
    <span className={p.swatch} style={{ ['--fill' as string]: fill, ['--acc' as string]: accent }}>
      <span className={p.swatchBtn}>Aa</span>
      <span className={p.swatchDot} />
    </span>
  )
}

function DefaultIcon() {
  return (
    <span className={p.defaultIcon} aria-hidden>
      <svg viewBox="0 0 256 256" width={48} height={48}>
        <rect x="8" y="8" width="240" height="240" rx="56" fill="#16161f" />
        <rect x="9" y="9" width="238" height="238" rx="55" fill="none" stroke="#fff" strokeOpacity="0.09" strokeWidth="2" />
        <g transform="translate(28 28) scale(0.78125)" fill="#8b8ef7">
          <path d="M106 24C113 24 118 31 121 40C127 58 129 84 126 108C123 132 117 150 117 176C117 198 121 214 123 222C125 229 122 233 117 232C108 230 98 222 91 210C80 192 75 168 75 142C75 108 84 78 94 50C97.5 40.2 99 24 106 24Z" />
          <path d="M160 78C166 78 169.6 85.6 172 92C178 108 181 124 180 142C179 166 171 186 158 202C150 212 144 220 140 225C137 229 132 228 132 223C131 204 133 172 137 150C141 126 146 104 151 90C153.3 83.6 155 78 160 78Z" />
        </g>
      </svg>
    </span>
  )
}

/** Months summed, not consecutive (PLUS_BADGES): the ladder, lit up to where you are. Information, not a goal bar. */
function Tenure({ months }: { months: number }) {
  const next = PLUS_BADGES.find((b) => b > months)
  return (
    <Group title={t.plus.tenure} description={t.plus.tenureLine}>
      <div className={p.ladder} role="list">
        {PLUS_BADGES.map((b) => (
          <span key={b} role="listitem" className={p.rung} data-on={months >= b || undefined} aria-label={`${t.plus.badge(b)}${months >= b ? ' ✓' : ''}`}>
            <span className={p.medal}>
              <Icon icon={Medal} size={16} filled={months >= b} />
            </span>
            <span className={`${p.rungLabel} tnum`}>{b}</span>
          </span>
        ))}
      </div>
      <p className={`${p.tenureLine} tnum`}>
        {t.plus.tenureMonths(months)}
        {next ? ` · ${t.plus.tenureNext(next)}` : ''}
      </p>
    </Group>
  )
}

function AnnualItem({ catalog, me, annual }: { catalog: BillingCatalog; me: BillingMe; annual: { available: boolean; claimedProductId: string | null } }) {
  const [pick, setPick] = useState<Product | null>(null)
  const [busy, setBusy] = useState(false)
  const user = useData((x) => x.me)
  const claimed = annual.claimedProductId ? catalog.products.find((x) => x.id === annual.claimedProductId) : null
  const options = catalog.products.filter(
    (x) => x.kind === 'cosmetic' && x.collectionId === 'hora_azul' && x.available && x.priceBrlCents > 0 && x.priceBrlCents <= ANNUAL_ITEM_MAX_CENTS && isCosmeticId(x.id) && !me.items.some((e) => e.sku === x.id),
  )
  const claim = async () => {
    if (!pick) return
    setBusy(true)
    try {
      await claimAnnualItem(pick.id)
      toast.success(t.plus.annualDone(pick.name))
      setPick(null)
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Group title={t.plus.annual} description={claimed ? t.plus.annualClaimed(claimed.name) : t.plus.annualLine}>
      {annual.available && !claimed && user && (
        <div className={p.annualGrid}>
          {options.map((x) => (
            <button key={x.id} type="button" className={p.annualItem} onClick={() => setPick(x)} data-cosmetic-hover>
              <span className={p.annualThumb}>
                <CosmeticThumb id={x.id as CosmeticId} user={user} />
              </span>
              <span className={p.optionLabel}>{x.name}</span>
            </button>
          ))}
        </div>
      )}
      <Modal
        open={!!pick}
        onClose={() => setPick(null)}
        title={t.plus.annualPick}
        description={pick ? t.plus.annualConfirm(pick.name) : ''}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPick(null)} data-autofocus>
              {t.gift.back}
            </Button>
            <Button variant="primary" loading={busy} onClick={() => void claim()}>
              {t.plus.annualPick}
            </Button>
          </>
        }
      />
    </Group>
  )
}

// ── For free users: show the wardrobe, then the plain comparison ──

/** What Plus looks like on you, drawn (not listed): the Frondes aura speaking, the icons, the colors. */
function Worth({ catalog }: { catalog: BillingCatalog }) {
  const me = useData((x) => x.me)
  if (!me) return null
  const has = (id: string) => catalog.products.some((x) => x.id === id)
  return (
    <Group title={t.plus.worth}>
      <div className={p.worth}>
        <figure className={p.worthCell}>
          <SpeakingSample user={me} size={56} aura="aura_ha_frondes" level={demoLevel()} className={p.auraSample}>
            <span className={p.auraPill}>
              <AuraGlyph id="aura_ha_frondes" />
              {me.displayName}
            </span>
          </SpeakingSample>
          <figcaption>{t.plus.aura}</figcaption>
        </figure>
        <figure className={p.worthCell}>
          <span className={p.icons}>
            {(['icon_ha_noite', 'icon_ha_porcelana'] as const).filter(has).map((id) => (
              <AppIcon key={id} id={id} size={48} />
            ))}
          </span>
          <figcaption>{t.plus.icon}</figcaption>
        </figure>
        <figure className={p.worthCell}>
          <span className={p.icons}>
            {Object.values(ACCENTS).map((a) => (
              <Swatch key={a.fill} fill={a.fill} accent={a.accent} />
            ))}
          </span>
          <figcaption>{t.plus.accent}</figcaption>
        </figure>
        <figure className={p.worthCell}>
          <span className={`${p.streamBadge} tnum`}>
            <Icon icon={Sparkle} size={14} />
            1440p60 · 4K30
          </span>
          <figcaption>{t.compare.stream}</figcaption>
        </figure>
      </div>
    </Group>
  )
}

function Compare({ catalog, current }: { catalog: BillingCatalog; current: PlanSummary }) {
  const free = catalog.plans.find((x) => x.id === 'free')
  const paid = catalog.plans.find((x) => x.id === 'plus')
  if (!free || !paid) return null
  const extra = paid.streamPresets.filter((x) => !free.streamPresets.includes(x))
  const yes = (text: string) => (
    <>
      <span className={s.plusMark}>+</span> {text}
    </>
  )
  const rows: Array<[string, React.ReactNode, React.ReactNode]> = [
    [t.compare.voice, t.compare.voiceBoth, t.compare.voiceBoth],
    [t.compare.stream, free.streamPresets.map(presetLabel).join(' · '), yes(extra.map(presetLabel).join(' · '))],
    [t.compare.files, t.compare.filesUpTo(Math.round(free.maxAttachmentBytes / MB)), t.compare.filesUpTo(Math.round(paid.maxAttachmentBytes / MB))],
    [t.compare.social, t.compare.socialBoth, t.compare.socialBoth],
    [t.compare2.wardrobe, t.compare2.wardrobeFree, yes(t.compare2.wardrobePlus)],
    [t.compare2.tenure, t.compare2.no, yes(PLUS_BADGES.join(' · ') + ' meses')],
    [t.compare2.banner, t.compare2.bannerFree, yes(t.compare2.bannerPlus)],
    [t.compare2.passes, t.compare2.no, yes(t.compare2.passesPlus)],
    [t.compare2.annual, t.compare2.no, yes(t.compare2.annualPlus)],
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
  const [pay, setPay] = useState<'renew' | 'once'>('renew')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ text: string; gated: boolean } | null>(null)
  const pick = (iv: 'month' | 'year', once: boolean) => plans.find((x) => x.interval === iv && (x.billing === 'one_time') === once && x.purchasable)
  const prod = pick(interval, pay === 'once') ?? pick(interval, false) ?? plans[0]!
  const once = prod.billing === 'one_time'
  const monthly = plans.find((x) => x.interval === 'month')
  const hasOnce = plans.some((x) => x.billing === 'one_time')
  const go = async () => {
    setBusy(true)
    setError(null)
    try {
      await startCheckout(prod)
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
          <span className={p.toggles}>
            <SegmentedControl label={t.subscribe.monthly} value={interval} onChange={setPeriod} items={[{ value: 'month', label: t.subscribe.monthly }, { value: 'year', label: t.subscribe.yearly }]} />
            {hasOnce && <SegmentedControl label={t.plus.payOnce} value={pay} onChange={setPay} items={[{ value: 'renew', label: t.plus.payRenew }, { value: 'once', label: t.plus.payOnce }]} />}
          </span>
          <span className={`${s.price} tnum`}>
            {money(prod.priceBrlCents)}
            <span className={s.per}>{once ? (prod.interval === 'year' ? ' · 12 meses' : ' · 1 mês') : prod.interval === 'year' ? t.subscribe.perYear : t.subscribe.perMonth}</span>
          </span>
          <span className={st.rowHint}>
            {once ? t.plus.onceNote(prod.interval === 'year' ? '12 meses' : '1 mês') : prod.interval === 'year' && monthly ? t.subscribe.yearlyNote(money(Math.round(prod.priceBrlCents / 12))) : t.subscribe.monthlyNote}
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
        {/* Renewal (or not) and the 7-day right of withdrawal, said before the click, next to the button. */}
        <p className={s.subscribeFine}>{once ? t.plus.onceFine : t.subscribe.fine}</p>
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

const refundable = (until: string | null | undefined) => !!until && Date.parse(until) > Date.now()

/**
 * "Pedir reembolso" (Termos 9.5): on every paid order and the first Plus charge while the server's window is open;
 * a confirmation that says what happens, then the state changes when the provider confirms (never assumed).
 */
export function RefundButton({ order, sub, kind }: { order?: Order; sub?: Subscription; kind?: 'gift' | 'casa' }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const row = order ?? sub
  if (!row) return null
  if (row.refundRequestedAt) return <span className={s.refundPending}>{t.refund.pending}</span>
  const until = row.refundableUntil
  const ok = (order ? order.status === 'paid' && order.amountCents > 0 : sub?.status === 'active') && refundable(until)
  if (!ok) return null
  const confirm = async () => {
    setBusy(true)
    try {
      if (order) await refundOrder(order.id)
      else await refundPlan()
      setOpen(false)
      toast.success(t.refund.asked)
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)} title={t.refund.until(day(until))}>
        {t.refund.ask}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t.refund.title}
        description={kind === 'gift' ? t.refund.bodyGift : kind === 'casa' ? t.refund.bodyCasa : sub ? t.refund.bodyPlan : t.refund.body}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} data-autofocus>
              {t.refund.keep}
            </Button>
            <Button variant="primary" loading={busy} onClick={() => void confirm()}>
              {t.refund.confirm}
            </Button>
          </>
        }
      />
    </>
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
          const product = catalog.products.find((x) => x.id === r.productId)
          const ok = r.status === 'paid' || r.status === 'active'
          const order = r.kind === 'order' ? me.orders.find((o) => o.id === r.id) : undefined
          const sub = r.kind === 'subscription' ? me.subscriptions.find((x) => x.id === r.id) : undefined
          return (
            <div key={r.id} className={s.historyRow}>
              <span className={s.historyIcon} data-ok={ok || undefined}>
                <Icon icon={ok ? Check : r.status === 'pending' ? Clock : Minus} size={14} />
              </span>
              <span className={st.rowText}>
                <span className={st.rowLabel}>{product?.name ?? t.history.unknown}</span>
                <span className={`${st.rowHint} tnum`}>
                  {day(r.createdAt)} · {r.kind === 'order' ? t.history.order[r.status as OrderStatus] : t.history.subscription[r.status as SubscriptionStatus]}
                  {order?.giftId ? ' · presente' : order?.spaceId ? ' · Casa' : ''}
                  {(order ?? sub)?.refundableUntil && refundable((order ?? sub)!.refundableUntil) ? ` · ${t.refund.until(day((order ?? sub)!.refundableUntil))}` : ''}
                </span>
              </span>
              {r.sandbox && <span className={s.testChip}>{t.test}</span>}
              <RefundButton order={order} sub={sub?.kind === 'renewing' ? sub : undefined} kind={order?.giftId ? 'gift' : order?.spaceId ? 'casa' : undefined} />
              <span className={`${s.amount} tnum`}>{money(r.amountCents, r.currency)}</span>
            </div>
          )
        })
      )}
    </Group>
  )
}

/** Settings › Voz e vídeo: the presets the plan allows (Me.plan), with one calm way to the plan page (never for 16–17). */
export function StreamPlanGroup() {
  const plan = useData((x) => x.me?.plan)
  const teen = useIsTeen()
  if (!plan) return null
  const all = Object.keys(STREAM_PRESETS) as StreamPreset[]
  const locked = all.some((x) => !plan.streamPresets.includes(x))
  return (
    <Group title={t.voice.title} description={t.voice.body}>
      <div className={s.presets} role="list">
        {all.map((x) => {
          const ok = plan.streamPresets.includes(x)
          return (
            <span key={x} role="listitem" className={`${s.preset} ${ok ? '' : s.presetLocked} tnum`} aria-label={`${presetLabel(x)}: ${ok ? t.voice.allowed : t.voice.locked}`}>
              <Icon icon={ok ? Check : Lock} size={12} />
              {presetLabel(x)}
            </span>
          )
        })}
      </div>
      <div className={s.planHint}>
        <span>{locked ? t.voice.hintFree : t.voice.hintPlus}</span>
        {locked && !teen && (
          <Button size="sm" variant="ghost" onClick={() => openSettings('plan')}>
            {t.voice.seePlan}
          </Button>
        )}
      </div>
    </Group>
  )
}
