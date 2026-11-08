import type {
  AnnualItemBody, BillingCatalog, BillingMe, CheckoutResponse, Gift, GiftBody, Me, Order, PatchSpaceUpgradeBody, PatchWishlistBody, PayBody,
  PayResponse, PlusPassBody, Product, PublicUser, PutCosmeticsBody, Quote, SpaceContributionBody, SpaceUpgrade, Subscription, TryOn, TryOnBody, Wishlist,
} from '@alga/shared'
import { useEffect, useMemo, useState } from 'react'
import { create } from 'zustand'
import { api, ApiRequestError } from '@/lib/api'
import { errorText } from '@/lib/errors'
import { useData } from '@/store/data'
import { onDispatch, useSession } from '@/store/session'
import { toast } from '@/ui'
import { openSettings, useSettings } from '../settings/store'
import { applyAccent } from './accents'
import { applyAppIcon } from './appIcon'
import { COSMETICS, lookOf, SLOT_KEY, skuFor, withTryOn, type CosmeticId, type Look, type Slot } from './look'
import { t } from './strings'

interface Waiting {
  product: Product
  url: string
  reference: string
  kind: CheckoutResponse['kind']
  /** A gift: who gets it (the sender's confirmation is the order turning paid). */
  giftId?: string
  recipient?: PublicUser
  deliverAt?: string
  /** A Casa contribution. */
  spaceId?: string
  amountCents?: number
  pixOnly?: boolean
  /** Paid in the app's own checkout (PayDialog) instead of the provider page. */
  inApp?: boolean
}

/** Where the store opens: a tab, an item, or a gift to start. */
export type StoreTab = 'collection' | 'bundles' | 'wishlist' | 'gifts'

interface BillingState {
  catalog: BillingCatalog | null
  me: BillingMe | null
  loadError: string | null
  /** A checkout open in the browser. Only the provider confirms it (webhook → events); the app never assumes it. */
  waiting: Waiting | null
  /** The in-app checkout dialog over the waiting checkout. */
  payOpen: boolean
  /** The provider declined/abandoned the last checkout (seen on refresh). */
  declined: string | null
  /**
   * What a confirmed payment just did: a SKU (item, `plan:plus`), `gift:<id>` or `casa:<spaceId>`. Drives the
   * confirmation moment in place, cleared when seen.
   */
  arrived: string | null
  wishlist: Wishlist | null
  /** Your try-on in the call (POST /billing/try-on), until it ends or expires. */
  tryOn: TryOn | null
  /** The gift being revealed (recipient): GIFT_RECEIVED opens it, "Abrir" in Presentes too. */
  revealing: string | null
  /** The gift dialog: from an item (pick the friend) or from a friend (pick the item). */
  giftDialog: { productId?: string; recipientId?: string } | null
  passDialog: boolean
  casaDialog: string | null
  /** The store's tab and selected item, so other places can open it on something. */
  tab: StoreTab
  focus: string | null
}

export const useBilling = create<BillingState>()(() => ({
  catalog: null, me: null, loadError: null, waiting: null, payOpen: false, declined: null, arrived: null, wishlist: null, tryOn: null, revealing: null,
  giftDialog: null, passDialog: false, casaDialog: null, tab: 'collection', focus: null,
}))

export async function loadBilling(): Promise<void> {
  try {
    const [catalog, me] = await Promise.all([api<BillingCatalog>('GET', '/billing/catalog'), api<BillingMe>('GET', '/billing/me')])
    useBilling.setState({ catalog, me, loadError: null })
    settleWaiting(me)
  } catch (e) {
    useBilling.setState({ loadError: errorText(e, t.loadError) })
  }
}

/**
 * A waiting checkout ends when the server's row does: paid/active = confirmed by the provider (the moment), declined
 * or expired = say so. Gifts and Casa grant nothing to you, so the order row is the only signal for them.
 */
function settleWaiting(me: BillingMe) {
  const w = useBilling.getState().waiting
  if (!w) return
  const row = w.kind === 'subscription' ? me.subscriptions.find((s) => s.id === w.reference) : me.orders.find((o) => o.id === w.reference)
  if (!row) return
  if (row.status === 'canceled' || row.status === 'expired') return useBilling.setState({ waiting: null, declined: w.product.id })
  if (row.status === 'paid' || row.status === 'active') {
    const arrived = w.giftId ? `gift:${w.giftId}` : w.spaceId ? `casa:${w.spaceId}` : skuFor(w.product)
    useBilling.setState({ waiting: null, arrived })
    celebrate(w, arrived)
  }
}

async function checkout(w: Omit<Waiting, 'url' | 'reference' | 'kind'>, res: CheckoutResponse) {
  const inApp = !!useBilling.getState().catalog?.provider?.inApp
  useBilling.setState({
    waiting: { ...w, url: res.url, reference: res.reference, kind: res.kind, giftId: res.giftId ?? w.giftId, amountCents: res.amountCents, pixOnly: res.pixOnly, inApp },
    payOpen: inApp, declined: null, arrived: null,
  })
  if (!inApp) await window.alga.app.openExternal(res.url)
}

/** In-app payment of the waiting checkout. Approved: the server already applied it, so the refresh settles it now. */
export async function pay(body: PayBody): Promise<PayResponse> {
  const res = await api<PayResponse>('POST', '/billing/pay', body)
  if (res.status === 'approved') await loadBilling()
  return res
}

export const closePay = () => useBilling.setState({ payOpen: false })
/** The provider's own page, for whoever prefers it (MP balance, saved cards). */
export const payOnProviderPage = () => {
  const w = useBilling.getState().waiting
  if (!w) return
  useBilling.setState({ payOpen: false })
  void window.alga.app.openExternal(w.url)
}

/** Creates the pending checkout on the server and opens the provider page in the browser. Grants nothing. */
export async function startCheckout(product: Product): Promise<void> {
  await checkout({ product }, await api<CheckoutResponse>('POST', '/billing/checkout', { productId: product.id }))
}

/** A gift: pending order + unpaid gift on the server, the provider page in the browser. */
export async function startGift(product: Product, recipient: PublicUser, opts: { message?: string; deliverAt?: string } = {}): Promise<void> {
  const body: GiftBody = { productId: product.id, recipientId: recipient.id, ...(opts.message ? { message: opts.message } : {}), ...(opts.deliverAt ? { deliverAt: opts.deliverAt } : {}) }
  await checkout({ product, recipient, deliverAt: opts.deliverAt }, await api<CheckoutResponse>('POST', '/billing/gifts', body))
}

/** A Casa contribution for `spaceId` (members 18+). */
export async function startContribution(spaceId: string, product: Product, showOnWall: boolean): Promise<void> {
  const body: SpaceContributionBody = { productId: product.id, showOnWall }
  await checkout({ product, spaceId }, await api<CheckoutResponse>('POST', `/spaces/${spaceId}/upgrade/contributions`, body))
}

export const reopenCheckout = () => {
  const w = useBilling.getState().waiting
  if (w?.inApp) useBilling.setState({ payOpen: true })
  else if (w) void window.alga.app.openExternal(w.url)
}
/** Stop waiting here; the pending checkout simply expires on the server after 24 h. */
export const stopWaiting = () => useBilling.setState({ waiting: null, payOpen: false })

export const quote = (productId: string, recipientId?: string) =>
  api<Quote>('GET', `/billing/quote?productId=${encodeURIComponent(productId)}${recipientId ? `&recipientId=${encodeURIComponent(recipientId)}` : ''}`)

export async function cancelRenewal(): Promise<Subscription> {
  const sub = await api<Subscription>('POST', '/billing/subscription/cancel')
  await loadBilling()
  return sub
}

/** Undo a cancel while the period is still paid: renewals resume at the provider. */
export async function resumeRenewal(): Promise<Subscription> {
  const sub = await api<Subscription>('POST', '/billing/subscription/resume')
  await loadBilling()
  return sub
}

/** The 7-day right of withdrawal (Termos 9.5): an order (item, bundle, gift, one-time Plus, Casa) or the first Plus charge. */
export async function refundOrder(id: string): Promise<Order> {
  const o = await api<Order>('POST', `/billing/orders/${id}/refund`)
  await loadBilling()
  return o
}
export async function refundPlan(): Promise<Subscription> {
  const s = await api<Subscription>('POST', '/billing/subscription/refund')
  await loadBilling()
  return s
}

// ── Gifts (recipient) ──
export async function acceptGift(id: string): Promise<Gift> {
  const g = await api<Gift>('POST', `/billing/gifts/${id}/accept`)
  await loadBilling()
  return g
}
export async function declineGift(id: string): Promise<Gift> {
  const g = await api<Gift>('POST', `/billing/gifts/${id}/decline`)
  await loadBilling()
  return g
}
export const openReveal = (id: string) => useBilling.setState({ revealing: id })
export const closeReveal = () => useBilling.setState({ revealing: null })
export const openGift = (opts: { productId?: string; recipientId?: string } = {}) => useBilling.setState({ giftDialog: opts })
export const closeGift = () => useBilling.setState({ giftDialog: null })

// ── Plus v2 ──
export async function sendPass(recipientId: string, message?: string): Promise<Gift> {
  const g = await api<Gift>('POST', '/billing/passes', { recipientId, ...(message ? { message } : {}) } satisfies PlusPassBody)
  await loadBilling()
  return g
}
export async function claimAnnualItem(productId: string): Promise<Order> {
  const o = await api<Order>('POST', '/billing/plus/annual-item', { productId } satisfies AnnualItemBody)
  await loadBilling()
  return o
}

// ── Wishlist ──
export async function loadWishlist(): Promise<void> {
  try {
    useBilling.setState({ wishlist: await api<Wishlist>('GET', '/billing/wishlist') })
  } catch {
    // The store works without it; the hearts just start empty.
  }
}
export async function setWished(productId: string, on: boolean): Promise<void> {
  const prev = useBilling.getState().wishlist
  // Optimistic: the heart answers in the same frame; the server's list replaces it (or the old one comes back).
  if (prev) useBilling.setState({ wishlist: { ...prev, items: on ? [...prev.items.filter((i) => i !== productId), productId] : prev.items.filter((i) => i !== productId) } })
  try {
    useBilling.setState({ wishlist: await api<Wishlist>(on ? 'PUT' : 'DELETE', `/billing/wishlist/${encodeURIComponent(productId)}`) })
  } catch (e) {
    useBilling.setState({ wishlist: prev })
    throw e
  }
}
export async function setWishlistVisible(visible: boolean): Promise<void> {
  useBilling.setState({ wishlist: await api<Wishlist>('PATCH', '/billing/wishlist', { visible } satisfies PatchWishlistBody) })
}
/** A friend's list (only friends, only when they show it): null otherwise. */
export async function friendWishlist(userId: string): Promise<Wishlist | null> {
  try {
    return await api<Wishlist>('GET', `/users/${userId}/wishlist`)
  } catch (e) {
    if (e instanceof ApiRequestError && (e.status === 404 || e.status === 403)) return null
    throw e
  }
}

// ── Try-on in the call ──
export async function startTryOn(productId: string): Promise<TryOn> {
  const tryOn = await api<TryOn>('POST', '/billing/try-on', { productId } satisfies TryOnBody)
  useBilling.setState({ tryOn })
  return tryOn
}
export async function endTryOn(): Promise<void> {
  useBilling.setState({ tryOn: null })
  await api('DELETE', '/billing/try-on')
}
/** Your try-on while it lasts (cleared at expiresAt without waiting for the server's USER_UPDATE). */
export function useMyTryOn(): TryOn | null {
  const tryOn = useBilling((x) => x.tryOn)
  const live = useUntil(tryOn?.expiresAt)
  return tryOn && live ? tryOn : null
}

// ── Casa ──
export const loadSpaceUpgrade = (spaceId: string) => api<SpaceUpgrade>('GET', `/spaces/${spaceId}/upgrade`)
export const patchSpaceUpgrade = (spaceId: string, body: PatchSpaceUpgradeBody) => api<SpaceUpgrade>('PATCH', `/spaces/${spaceId}/upgrade`, body)
export const openCasa = (spaceId: string) => useBilling.setState({ casaDialog: spaceId })
export const closeCasa = () => useBilling.setState({ casaDialog: null })

/** Opens Personalização on a tab and, optionally, an item. */
export function openStore(tab: StoreTab = 'collection', focus: string | null = null) {
  useBilling.setState({ tab, focus })
  openSettings('shop')
}

/** Equip (or, with null, take off) one slot. The server answers with Me and tells everyone else (USER_UPDATE). */
export async function equip(slot: Slot, id: CosmeticId | null): Promise<void> {
  const me = await api<Me>('PUT', '/users/@me/cosmetics', { [SLOT_KEY[slot]]: id } satisfies PutCosmeticsBody)
  useData.getState().apply({ t: 'ME_UPDATE', d: me })
}
/** The Plus app color (private slot, no renderer: it recolors the UI). */
export async function equipAccent(id: string | null): Promise<void> {
  const me = await api<Me>('PUT', '/users/@me/cosmetics', { appAccent: id } satisfies PutCosmeticsBody)
  useData.getState().apply({ t: 'ME_UPDATE', d: me })
}

/**
 * Live billing: ENTITLEMENTS_UPDATE patches plan + items at once, then everything is refetched (and a waiting checkout
 * settles from its row); GIFT_RECEIVED opens the reveal; SPACE_UPGRADE_UPDATE patches the space's Casa; READY
 * reloads; focus re-checks a waiting checkout. The private slots (app icon, app color) follow Me. Returns the unsubscribe.
 */
export function startBilling(): () => void {
  void loadBilling()
  void loadWishlist()
  const off = onDispatch((d) => {
    if (d.t === 'READY') return void (loadBilling(), loadWishlist())
    if (d.t === 'GIFT_RECEIVED') {
      if (!useBilling.getState().revealing) useBilling.setState({ revealing: d.d.id })
      return void loadBilling()
    }
    if (d.t === 'GIFT_UPDATE') return void loadBilling()
    if (d.t === 'SPACE_UPGRADE_UPDATE') {
      const { spaceId, upgrade } = d.d
      useData.setState((st) => (st.spaces[spaceId] ? { spaces: { ...st.spaces, [spaceId]: { ...st.spaces[spaceId]!, upgrade: upgrade ?? undefined } } } : {}))
      return void loadBilling()
    }
    if (d.t === 'USER_UPDATE' && d.d.id === useData.getState().me?.id && !d.d.tryOn && useBilling.getState().tryOn) return void useBilling.setState({ tryOn: null })
    if (d.t !== 'ENTITLEMENTS_UPDATE') return
    const st = useBilling.getState()
    useBilling.setState({ me: st.me ? { ...st.me, plan: d.d.plan, items: d.d.items } : st.me })
    void loadBilling()
    void loadWishlist() // owned items leave the list
  })
  const onFocus = () => useBilling.getState().waiting && void loadBilling()
  window.addEventListener('focus', onFocus)
  const offSession = useSession.subscribe((s) => s.phase === 'signed_out' && useBilling.setState({ me: null, waiting: null, payOpen: false, declined: null, arrived: null, wishlist: null, tryOn: null, revealing: null }))
  // The private slots: the accent recolors the UI, the icon goes to the window (when the main process has the IPC).
  const sync = (me: Me | null) => {
    applyAccent(me?.cosmetics?.appAccent)
    applyAppIcon(me?.cosmetics?.appIcon)
  }
  sync(useData.getState().me)
  const offMe = useData.subscribe((s, prev) => s.me?.cosmetics !== prev.me?.cosmetics && sync(s.me))
  return () => {
    off()
    offSession()
    offMe()
    window.removeEventListener('focus', onFocus)
  }
}

/** The page that confirms it in place is open: no toast on top of it. Otherwise one quiet toast with a way there. */
function celebrate(w: Waiting, arrived: string) {
  const open = useSettings.getState().section
  if (w.spaceId) return useBilling.getState().casaDialog === w.spaceId || toast.success(t.casa.paid)
  if (w.giftId) return useBilling.getState().giftDialog || toast.success(w.deliverAt ? t.gift.scheduled(w.recipient?.displayName ?? '', day(w.deliverAt)) : t.gift.paid(w.recipient?.displayName ?? ''))
  const section = w.product.kind === 'plan' ? 'plan' : 'shop'
  if (open === section) return
  const text = w.product.kind === 'plan' ? t.arrived.planToast : t.arrived.itemToast(w.product.name)
  toast.success(text, { action: { label: t.arrived.see, run: () => (section === 'shop' ? openStore('collection', arrived) : openSettings(section)) } })
}

const dateFmt = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' })
export const day = (iso: string | null | undefined) => (iso ? dateFmt.format(new Date(iso)) : '—')

/** False once `iso` has passed (re-renders at that moment). Undefined = no deadline. */
export function useUntil(iso: string | undefined): boolean {
  const [, tick] = useState(0)
  const ms = iso ? Date.parse(iso) - Date.now() : Infinity
  useEffect(() => {
    if (!Number.isFinite(ms) || ms <= 0) return
    const id = setTimeout(() => tick((n) => n + 1), Math.min(ms + 50, 2 ** 31 - 1))
    return () => clearTimeout(id)
  }, [ms])
  return ms > 0
}

/**
 * The look a user's profile shows: what they equipped (PublicUser.cosmetics), with a try-on on top while it lasts
 * (PublicUser.tryOn, "provando"), live through USER_UPDATE / ME_UPDATE. Every place that draws cosmetics uses this,
 * so a try-on shows on the stage, the list and the card at once.
 */
export function useLook(userId: string | undefined): Look {
  const equipped = useData((x) => (userId ? x.users[userId]?.cosmetics : undefined))
  const tryOn = useData((x) => (userId ? x.users[userId]?.tryOn : undefined))
  const live = useUntil(tryOn?.expiresAt)
  return useMemo(() => withTryOn(lookOf(equipped), live ? tryOn : undefined), [equipped, tryOn, live])
}

/** Someone's try-on while it lasts (the "provando" tag). */
export function useTryOnOf(userId: string | undefined): TryOn | null {
  const tryOn = useData((x) => (userId ? x.users[userId]?.tryOn : undefined))
  const live = useUntil(tryOn?.expiresAt)
  return tryOn && live ? tryOn : null
}

/** Items being tried on (local only, never sent): one per slot, over what is equipped. */
const useTrying = create<{ look: Look }>()(() => ({ look: {} }))
const tryOn = (id: CosmeticId) => useTrying.setState((st) => ({ look: { ...st.look, [COSMETICS[id]]: id } }))
const clearTry = (slot?: Slot) => useTrying.setState((st) => ({ look: slot ? { ...st.look, [slot]: undefined } : {} }))

/**
 * Try-on for the store/provador UI: `look` = what `userId` (you) wears with the tried items on top. `tryOn(id)`
 * puts an item in its slot, `clear(slot?)` takes one (or all) off. Render `look` with ProfileCard / <Cosmetic>.
 */
export function useCosmeticPreview(userId: string | undefined) {
  const equipped = useLook(userId)
  const trying = useTrying((st) => st.look)
  const look = useMemo<Look>(() => {
    const out: Look = { ...equipped }
    for (const [slot, id] of Object.entries(trying) as [Slot, CosmeticId | undefined][]) if (id) out[slot] = id
    return out
  }, [equipped, trying])
  return { look, equipped, trying, tryOn, clear: clearTry }
}
