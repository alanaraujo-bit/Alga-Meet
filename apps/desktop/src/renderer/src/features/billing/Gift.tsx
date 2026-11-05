import { GIFT_MAX_SCHEDULE_DAYS, GIFT_MESSAGE_MAX, GIFT_MIN_FRIENDSHIP_HOURS, PLUS_PASS_PRODUCT_ID, type BillingCatalog, type BillingMe, type Gift, type Product, type PublicUser, type Wishlist } from '@alga/shared'
import { ArrowRight, Check, ChevronLeft, CircleCheck, Search } from '@/ui/icons'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ApiRequestError } from '@/lib/api'
import { errorText } from '@/lib/errors'
import { useData } from '@/store/data'
import { Avatar, Button, EmptyState, Icon, Modal, SegmentedControl, TextField } from '@/ui'
import { needsVerification, openVerifyEmail } from '../auth/VerifyEmail'
import { TeenPurchaseNotice, useIsTeen } from '../trust/Privacy'
import { CosmeticThumb, ProfileCard, type ProfileUser } from './Cosmetics'
import { reducedMotion } from './engine'
import { Calendar, Gift as GiftIcon, Sparkle } from './icons'
import { COSMETICS, isCosmeticId, money, type CosmeticId, type Look } from './look'
import { Fine } from './Fine'
import { RefundButton, Waiting } from './Plan'
import {
  acceptGift, closeGift, closeReveal, day, declineGift, equip, friendWishlist, openReveal, quote, sendPass, startGift, useBilling, useLook,
} from './store'
import { t } from './strings'
import s from './gift.module.css'

/*
 * Gifts (growth-plan §2.4), the part that should feel like Brazil: from an item page or a friend's card in ≤ 3 taps
 * (Presentear → who/what → Pagar), Pix first, the friend's wishlist on top, the item shown on *their* card before you
 * pay. The recipient opens it (a silk ribbon that unties in 1.2 s, still with reduced motion) or refuses it (the
 * payer gets the money back). Friends of 72 h+, nothing they already have, 16–17 receive but never buy.
 */

const HOUR = 3_600_000
const isGiftable = (p: Product) => !!p.giftable && p.available !== false && !p.retired

// ── Friends ──

export interface Friend {
  user: PublicUser
  since: string
  /** Friends for GIFT_MIN_FRIENDSHIP_HOURS: the server refuses gifts and passes before that. */
  ready: boolean
}
export function useFriends(): Friend[] {
  const rels = useData((x) => x.relationships)
  return useMemo(
    () =>
      Object.values(rels)
        .filter((r) => r.type === 'friend')
        .map((r) => ({ user: r.user, since: r.since, ready: Date.now() - Date.parse(r.since) >= GIFT_MIN_FRIENDSHIP_HOURS * HOUR }))
        .sort((a, b) => Number(b.ready) - Number(a.ready) || a.user.displayName.localeCompare(b.user.displayName, 'pt-BR')),
    [rels],
  )
}

export function FriendPicker({ onPick, note }: { onPick: (u: PublicUser) => void; note?: string }) {
  const friends = useFriends()
  const [q, setQ] = useState('')
  const list = friends.filter((f) => !q || `${f.user.displayName} ${f.user.username}`.toLowerCase().includes(q.toLowerCase()))
  if (!friends.length) return <EmptyState icon={GiftIcon} title={t.gift.noFriends} />
  return (
    <div className={s.picker}>
      {friends.length > 6 && <TextField size="sm" leadingIcon={Search} ariaLabel={t.gift.search} placeholder={t.gift.search} value={q} onChange={(e) => setQ(e.target.value)} autoFocus />}
      <ul className={s.friends} role="list">
        {list.map((f) => (
          <li key={f.user.id}>
            <button type="button" className={s.friend} disabled={!f.ready} onClick={() => onPick(f.user)} data-autofocus={f === list[0] || undefined}>
              <Avatar user={f.user} size={32} decorative />
              <span className={s.friendText}>
                <span className={s.friendName}>{f.user.displayName}</span>
                <span className={s.friendSub}>@{f.user.username}</span>
              </span>
              {f.ready ? <Icon icon={ArrowRight} size={14} className={s.go} /> : <span className={s.chip}>{t.gift.tooNewChip}</span>}
            </button>
          </li>
        ))}
      </ul>
      {friends.some((f) => !f.ready) && <p className={s.note}>{t.gift.tooNew}</p>}
      {note && <p className={s.note}>{note}</p>}
    </div>
  )
}

// ── The gift dialog ──

export function GiftDialog() {
  const open = useBilling((x) => x.giftDialog)
  const catalog = useBilling((x) => x.catalog)
  if (!open || !catalog) return null
  return <GiftFlow key={`${open.productId}:${open.recipientId}`} catalog={catalog} productId={open.productId} recipientId={open.recipientId} />
}

function GiftFlow({ catalog, productId, recipientId }: { catalog: BillingCatalog; productId?: string; recipientId?: string }) {
  const teen = useIsTeen()
  const users = useData((x) => x.users)
  const friends = useFriends()
  const [recipient, setRecipient] = useState<PublicUser | null>(() => (recipientId ? (friends.find((f) => f.user.id === recipientId)?.user ?? users[recipientId] ?? null) : null))
  const [product, setProduct] = useState<Product | null>(() => catalog.products.find((p) => p.id === productId) ?? null)
  const step = !recipient ? 'who' : !product ? 'what' : 'review'
  const title = recipient ? t.gift.titleFor(recipient.displayName) : t.gift.title
  return (
    <Modal open onClose={closeGift} title={title} width={step === 'review' ? 640 : 460}>
      {teen ? (
        <TeenPurchaseNotice />
      ) : step === 'who' ? (
        <>
          <p className={s.stepLabel}>{t.gift.pickFriend}</p>
          {product && <ProductLine product={product} />}
          <FriendPicker onPick={setRecipient} />
        </>
      ) : step === 'what' ? (
        <ItemPicker catalog={catalog} recipient={recipient!} onPick={setProduct} />
      ) : (
        <Review catalog={catalog} product={product!} recipient={recipient!} back={() => (productId ? setRecipient(null) : setProduct(null))} />
      )}
    </Modal>
  )
}

function ProductLine({ product }: { product: Product }) {
  const me = useData((x) => x.me)
  return (
    <div className={s.productLine}>
      <span className={s.productThumb}>{isCosmeticId(product.id) && me ? <CosmeticThumb id={product.id} user={me} /> : <Icon icon={Sparkle} size={16} />}</span>
      <span className={s.friendText}>
        <span className={s.friendName}>{product.name}</span>
        <span className={`${s.friendSub} tnum`}>{money(product.priceBrlCents)}</span>
      </span>
    </div>
  )
}

/** Their wishlist first (only if they show it to friends), then the collection, then Plus. Owned items never show. */
function ItemPicker({ catalog, recipient, onPick }: { catalog: BillingCatalog; recipient: PublicUser; onPick: (p: Product) => void }) {
  const [wish, setWish] = useState<Wishlist | null | undefined>(undefined)
  useEffect(() => {
    let live = true
    friendWishlist(recipient.id).then((w) => live && setWish(w), () => live && setWish(null))
    return () => void (live = false)
  }, [recipient.id])
  const giftable = catalog.products.filter(isGiftable)
  const wished = (wish?.items ?? []).map((id) => giftable.find((p) => p.id === id)).filter((p): p is Product => !!p)
  const rest = giftable.filter((p) => p.kind !== 'plan' && !wished.includes(p))
  const plus = giftable.filter((p) => p.kind === 'plan' && p.billing === 'one_time')
  const grid = (list: Product[]) => (
    <div className={s.items}>
      {list.map((p) => (
        <button key={p.id} type="button" className={s.item} onClick={() => onPick(p)} data-cosmetic-hover>
          <span className={s.itemThumb}>{isCosmeticId(p.id) ? <CosmeticThumb id={p.id} user={recipient as ProfileUser} /> : <span className={s.bundleGlyph}>{p.kind === 'bundle' ? (p.items ?? []).length : 'Plus'}</span>}</span>
          <span className={s.itemName}>{p.kind === 'plan' ? (p.interval === 'year' ? t.gift.plusYear : t.gift.plusMonth) : p.name}</span>
          <span className={`${s.itemPrice} tnum`}>{money(p.priceBrlCents)}</span>
        </button>
      ))}
    </div>
  )
  return (
    <div className={s.itemPicker}>
      <p className={s.stepLabel}>{t.gift.pickItem}</p>
      {wished.length > 0 && (
        <section>
          <h4 className={s.sectionLabel}>{t.gift.fromWishlist(recipient.displayName)}</h4>
          {grid(wished)}
        </section>
      )}
      <section>
        <h4 className={s.sectionLabel}>{t.gift.allItems}</h4>
        {grid(rest)}
      </section>
      {plus.length > 0 && (
        <section>
          <h4 className={s.sectionLabel}>{t.gift.plus}</h4>
          {grid(plus)}
        </section>
      )}
    </div>
  )
}

const dayOffset = (n: number) => {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function Review({ catalog, product, recipient, back }: { catalog: BillingCatalog; product: Product; recipient: PublicUser; back: () => void }) {
  const waiting = useBilling((x) => x.waiting)
  const arrived = useBilling((x) => x.arrived)
  const [message, setMessage] = useState('')
  const [when, setWhen] = useState<'now' | 'later'>('now')
  const [date, setDate] = useState(dayOffset(1))
  const [amount, setAmount] = useState<number | null>(null)
  const [blocked, setBlocked] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ text: string; gated: boolean } | null>(null)
  // The server's quote for *them* (a bundle they partly own costs less; 409 = they already have it all).
  useEffect(() => {
    let live = true
    setAmount(null)
    setBlocked(null)
    quote(product.id, recipient.id).then(
      (q) => live && setAmount(q.amountCents),
      (e) => live && (e instanceof ApiRequestError && e.status === 409 ? setBlocked(errorText(e)) : setAmount(product.priceBrlCents)),
    )
    return () => void (live = false)
  }, [product.id, product.priceBrlCents, recipient.id])
  const mine = waiting?.giftId && waiting.recipient?.id === recipient.id && waiting.product.id === product.id
  const done = arrived?.startsWith('gift:') && (!waiting || !mine)
  const deliverAt = when === 'later' ? new Date(`${date}T09:00:00`).toISOString() : undefined
  const pay = async () => {
    setBusy(true)
    setError(null)
    try {
      await startGift(product, recipient, { message: message.trim() || undefined, deliverAt })
    } catch (e) {
      setError({ text: errorText(e), gated: needsVerification(e) })
    } finally {
      setBusy(false)
    }
  }
  // Their card, wearing the gift: the moment that makes the choice.
  const theirs = useLook(recipient.id)
  const look: Look = { ...theirs }
  for (const id of product.kind === 'bundle' ? (product.items ?? []) : [product.id]) if (isCosmeticId(id)) look[COSMETICS[id]] = id
  const price = amount ?? product.priceBrlCents
  return (
    <div className={s.review}>
      <div className={s.reviewCard}>
        <div className={s.onThem}>
          <ProfileCard user={recipient as ProfileUser} look={look} />
        </div>
        <p className={s.onThemCaption}>{product.kind === 'plan' ? t.gift.plus : `${product.name} em ${recipient.displayName}`}</p>
      </div>
      <div className={s.reviewForm}>
        {done ? (
          <div className={s.done} role="status">
            <Icon icon={CircleCheck} size={20} />
            <p>{deliverAt ? t.gift.scheduled(recipient.displayName, day(deliverAt)) : t.gift.paid(recipient.displayName)}</p>
            <Button variant="primary" onClick={closeGift} data-autofocus>
              OK
            </Button>
          </div>
        ) : mine ? (
          <Waiting />
        ) : (
          <>
            <button type="button" className={s.back} onClick={back}>
              <Icon icon={ChevronLeft} size={14} />
              {t.gift.back}
            </button>
            <label className={s.field}>
              <span className={s.fieldLabel}>{t.gift.message}</span>
              <textarea
                className={s.textarea}
                maxLength={GIFT_MESSAGE_MAX}
                rows={3}
                value={message}
                placeholder={t.gift.messagePlaceholder}
                onChange={(e) => setMessage(e.target.value)}
              />
              <span className={`${s.fieldHint} tnum`}>{t.gift.messageHint(message.length, GIFT_MESSAGE_MAX)}</span>
            </label>
            <div className={s.field}>
              <span className={s.fieldLabel}>{t.gift.when}</span>
              <SegmentedControl label={t.gift.when} value={when} onChange={setWhen} items={[{ value: 'now', label: t.gift.now }, { value: 'later', label: t.gift.later }]} />
              {when === 'later' && (
                <label className={s.date}>
                  <Icon icon={Calendar} size={14} />
                  <input type="date" aria-label={t.gift.date} min={dayOffset(1)} max={dayOffset(GIFT_MAX_SCHEDULE_DAYS)} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
                </label>
              )}
            </div>
            <dl className={s.summary}>
              <div>
                <dt>{product.kind === 'plan' ? t.gift.plus : product.name}</dt>
                <dd className="tnum">{amount == null && !blocked ? '…' : money(price)}</dd>
              </div>
              <div className={s.total}>
                <dt>{t.gift.total}</dt>
                <dd className="tnum">{money(price)}</dd>
              </div>
            </dl>
            {blocked ? (
              <p className={s.blocked} role="alert">
                {blocked}
              </p>
            ) : (
              <>
                {error?.gated ? (
                  <Button variant="primary" size="lg" full onClick={openVerifyEmail}>
                    {t.gift.pay(money(price))}
                  </Button>
                ) : (
                  <Button variant="primary" size="lg" full loading={busy} disabled={!catalog.provider || amount == null || !!waiting} onClick={() => void pay()}>
                    {t.gift.pay(money(price))}
                  </Button>
                )}
                {error && !error.gated && (
                  <p className={s.blocked} role="alert">
                    {error.text}
                  </p>
                )}
              </>
            )}
            <p className={s.pix}>{t.gift.pix}</p>
            <Fine sandbox={!!catalog.provider?.sandbox}>{`${t.gift.once} ${t.gift.decline}`}</Fine>
          </>
        )}
      </div>
    </div>
  )
}

// ── The reveal (recipient) ──

type Phase = 'closed' | 'opening' | 'open' | 'refusing'

export function GiftReveal() {
  const id = useBilling((x) => x.revealing)
  const gift = useBilling((x) => x.me?.gifts?.find((g) => g.id === id))
  const catalog = useBilling((x) => x.catalog)
  if (!id || !gift || !catalog) return null
  return <Reveal key={gift.id} gift={gift} catalog={catalog} />
}

const RIBBON_MS = 1200

function Reveal({ gift, catalog }: { gift: Gift; catalog: BillingCatalog }) {
  const me = useData((x) => x.me)
  const [phase, setPhase] = useState<Phase>(gift.status === 'accepted' ? 'open' : 'closed')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [used, setUsed] = useState(false)
  const timer = useRef(0)
  useEffect(() => () => clearTimeout(timer.current), [])
  const product = catalog.products.find((p) => p.id === gift.productId)
  const pass = gift.productId === PLUS_PASS_PRODUCT_ID
  const plus = pass || product?.kind === 'plan'
  const ids = gift.items.filter(isCosmeticId)
  const look: Look = {}
  for (const id of ids) look[COSMETICS[id]] = id
  const name = gift.sender?.displayName
  const what = pass ? t.plus.passTitle : product?.kind === 'plan' ? (product.interval === 'year' ? t.gift.plusYear : t.gift.plusMonth) : (product?.name ?? '')

  const open = async () => {
    setBusy(true)
    setError(null)
    try {
      await acceptGift(gift.id)
      if (reducedMotion()) return setPhase('open')
      setPhase('opening')
      timer.current = window.setTimeout(() => setPhase('open'), RIBBON_MS)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  const refuse = async () => {
    setBusy(true)
    try {
      await declineGift(gift.id)
      closeReveal()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  const use = async () => {
    setBusy(true)
    try {
      for (const id of ids) await equip(COSMETICS[id], id)
      setUsed(true)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open onClose={closeReveal} title={name ? t.gift.from(name) : t.gift.fromSomeone} width={420} hideClose={phase === 'opening'}>
      <div className={s.reveal} data-phase={phase}>
        <div className={s.box} aria-hidden={phase === 'closed' || phase === 'refusing'}>
          {/* Inside: the gift on your own card (or the Plus mark), lit the moment the ribbon lets go. */}
          <div className={s.boxInside}>
            {plus ? (
              <span className={s.plusMark}>
                <Icon icon={Sparkle} size={24} />
                <span>Alga Plus</span>
                <span className={s.plusSub}>{what}</span>
              </span>
            ) : me ? (
              <div className={s.revealCard}>
                <ProfileCard user={me} look={look} motion={phase === 'open' ? 'play' : 'rest'} key={phase === 'open' ? 'open' : 'shut'} />
              </div>
            ) : null}
          </div>
          {/* The wrapping: night paper and a silk ribbon (Fita de seda's gradient) tied once; it unties in 1.2 s. */}
          <div className={s.paper}>
            <span className={s.ribbonV} />
            <span className={s.ribbonH} />
            <span className={s.bow}>
              <span className={s.loopL} />
              <span className={s.loopR} />
              <span className={s.knot} />
            </span>
          </div>
        </div>
        {gift.message && phase !== 'open' && <blockquote className={s.message}>“{gift.message}”</blockquote>}
        {phase === 'open' ? (
          <div className={s.revealText} role="status">
            <p className={s.revealTitle}>{what}</p>
            <p className={s.revealLine}>{plus ? t.gift.openedPlus : used ? t.gift.used : t.gift.opened}</p>
            {gift.message && <blockquote className={s.messageSmall}>“{gift.message}”{name ? ` — ${name}` : ''}</blockquote>}
            <div className={s.revealActions}>
              {!plus && ids.length > 0 && !used && (
                <Button variant="primary" loading={busy} onClick={() => void use()} data-autofocus>
                  {t.gift.use}
                </Button>
              )}
              <Button variant={plus || used ? 'primary' : 'ghost'} onClick={closeReveal}>
                {used || plus ? 'OK' : t.gift.later2}
              </Button>
            </div>
          </div>
        ) : phase === 'refusing' ? (
          <div className={s.revealText}>
            <p className={s.revealLine}>{t.gift.refuseConfirm}</p>
            <div className={s.revealActions}>
              <Button variant="ghost" onClick={() => setPhase('closed')} data-autofocus>
                {t.gift.back}
              </Button>
              <Button variant="secondary" loading={busy} onClick={() => void refuse()}>
                {t.gift.refuse}
              </Button>
            </div>
          </div>
        ) : phase === 'closed' ? (
          <div className={s.revealActions}>
            <Button variant="primary" size="lg" loading={busy} onClick={() => void open()} data-autofocus icon={GiftIcon}>
              {t.gift.open}
            </Button>
            {/* Refusing is always offered and never shamed: it only exists before opening. */}
            <Button variant="ghost" onClick={() => setPhase('refusing')}>
              {t.gift.refuse}
            </Button>
          </div>
        ) : null}
        {error && (
          <p className={s.blocked} role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  )
}

// ── Plus passes (subscribers): a friend, an optional line, sent; it starts when they open it ──

export function PassDialog() {
  const open = useBilling((x) => x.passDialog)
  const left = useBilling((x) => x.me?.plus?.passesLeft ?? 0)
  const [to, setTo] = useState<PublicUser | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<string | null>(null)
  const close = () => {
    useBilling.setState({ passDialog: false })
    setTo(null)
    setMessage('')
    setError(null)
    setSent(null)
  }
  if (!open) return null
  const send = async () => {
    if (!to) return
    setBusy(true)
    setError(null)
    try {
      await sendPass(to.id, message.trim() || undefined)
      setSent(to.displayName)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open onClose={close} title={t.plus.passTitle} width={460} description={sent ? undefined : t.plus.passesLine(left)}>
      {sent ? (
        <div className={s.done} role="status">
          <Icon icon={CircleCheck} size={20} />
          <p>{t.plus.passSent(sent)}</p>
          <Button variant="primary" onClick={close} data-autofocus>
            OK
          </Button>
        </div>
      ) : !to ? (
        <FriendPicker onPick={setTo} note={t.plus.passRule} />
      ) : (
        <div className={s.reviewForm}>
          <button type="button" className={s.back} onClick={() => setTo(null)}>
            <Icon icon={ChevronLeft} size={14} />
            {t.gift.back}
          </button>
          <div className={s.productLine}>
            <Avatar user={to} size={32} decorative />
            <span className={s.friendText}>
              <span className={s.friendName}>{to.displayName}</span>
              <span className={s.friendSub}>{t.plus.passTitle}</span>
            </span>
          </div>
          <label className={s.field}>
            <span className={s.fieldLabel}>{t.gift.message}</span>
            <textarea className={s.textarea} maxLength={GIFT_MESSAGE_MAX} rows={3} value={message} placeholder={t.gift.messagePlaceholder} onChange={(e) => setMessage(e.target.value)} />
          </label>
          <Button variant="primary" size="lg" full loading={busy} disabled={left <= 0} onClick={() => void send()} icon={GiftIcon}>
            {t.plus.passSend}
          </Button>
          {error && (
            <p className={s.blocked} role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </Modal>
  )
}

// ── Presentes (store tab): received and sent, refunds per the server's window ──

export function GiftsTab({ catalog, billing }: { catalog: BillingCatalog; billing: BillingMe }) {
  const meId = useData((x) => x.me?.id)
  const gifts = billing.gifts ?? []
  const received = gifts.filter((g) => g.recipient?.id === meId)
  const sent = gifts.filter((g) => g.sender?.id === meId)
  const name = (p: Product | undefined, g: Gift) => (g.productId === PLUS_PASS_PRODUCT_ID ? t.plus.passTitle : p?.kind === 'plan' ? (p.interval === 'year' ? t.gift.plusYear : t.gift.plusMonth) : (p?.name ?? g.productId))
  const row = (g: Gift, dir: 'in' | 'out') => {
    const p = catalog.products.find((x) => x.id === g.productId)
    const other = dir === 'in' ? g.sender : g.recipient
    const order = g.orderId ? billing.orders.find((o) => o.id === g.orderId) : undefined
    return (
      <li key={g.id} className={s.giftRow}>
        <span className={s.giftThumb}>{g.items[0] && isCosmeticId(g.items[0]) && other ? <CosmeticThumb id={g.items[0] as CosmeticId} user={other as ProfileUser} /> : <Icon icon={Sparkle} size={16} />}</span>
        <span className={s.friendText}>
          <span className={s.friendName}>{name(p, g)}</span>
          <span className={s.friendSub}>
            {dir === 'in' ? t.gift.fromWhom(other?.displayName ?? t.gift.unknownUser) : t.gift.toWhom(other?.displayName ?? t.gift.unknownUser)} · {day(g.deliveredAt ?? g.deliverAt ?? g.createdAt)} · {t.gift.status[g.status]}
          </span>
          {g.message && <span className={s.giftMsg}>“{g.message}”</span>}
        </span>
        {dir === 'in' && g.status === 'delivered' && (
          <Button size="sm" variant="primary" icon={GiftIcon} onClick={() => openReveal(g.id)}>
            {t.gift.openNow}
          </Button>
        )}
        {dir === 'in' && g.status === 'accepted' && <Icon icon={Check} size={14} className={s.go} />}
        {dir === 'out' && order && <RefundButton order={order} kind="gift" />}
      </li>
    )
  }
  return (
    <div className={s.tab}>
      <section>
        <h4 className={s.sectionLabel}>{t.gift.received}</h4>
        {received.length ? <ul className={s.giftList}>{received.map((g) => row(g, 'in'))}</ul> : <p className={s.note}>{t.gift.none}</p>}
      </section>
      <section>
        <h4 className={s.sectionLabel}>{t.gift.sent}</h4>
        {sent.length ? <ul className={s.giftList}>{sent.map((g) => row(g, 'out'))}</ul> : <p className={s.note}>{t.gift.none}</p>}
      </section>
    </div>
  )
}
