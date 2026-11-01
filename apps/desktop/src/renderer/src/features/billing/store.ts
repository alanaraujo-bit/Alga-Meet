import type { BillingCatalog, BillingMe, CheckoutResponse, Me, Product, PutCosmeticsBody, Subscription } from '@alga/shared'
import { useMemo } from 'react'
import { create } from 'zustand'
import { api } from '@/lib/api'
import { errorText } from '@/lib/errors'
import { useData } from '@/store/data'
import { onDispatch, useSession } from '@/store/session'
import { toast } from '@/ui'
import { openSettings, useSettings } from '../settings/store'
import { granted, lookOf, SLOT_KEY, skuFor, type CosmeticId, type Look, type Slot } from './look'
import { t } from './strings'

interface Waiting {
  product: Product
  url: string
  reference: string
  kind: CheckoutResponse['kind']
}

interface BillingState {
  catalog: BillingCatalog | null
  me: BillingMe | null
  loadError: string | null
  /** A checkout open in the browser. Only the provider confirms it (ENTITLEMENTS_UPDATE); the app never assumes it. */
  waiting: Waiting | null
  /** The provider declined/abandoned the last checkout (seen on refresh). */
  declined: string | null
  /** SKU a confirmed purchase just granted: drives the confirmation moment, cleared when seen. */
  arrived: string | null
}

export const useBilling = create<BillingState>()(() => ({ catalog: null, me: null, loadError: null, waiting: null, declined: null, arrived: null }))

export async function loadBilling(): Promise<void> {
  try {
    const [catalog, me] = await Promise.all([api<BillingCatalog>('GET', '/billing/catalog'), api<BillingMe>('GET', '/billing/me')])
    useBilling.setState({ catalog, me, loadError: null })
    settleWaiting(me)
  } catch (e) {
    useBilling.setState({ loadError: errorText(e, t.loadError) })
  }
}

/** A waiting checkout whose row the server ended (declined, expired) stops waiting and says so. */
function settleWaiting(me: BillingMe) {
  const w = useBilling.getState().waiting
  if (!w) return
  const row = w.kind === 'subscription' ? me.subscriptions.find((s) => s.id === w.reference) : me.orders.find((o) => o.id === w.reference)
  if (row && (row.status === 'canceled' || row.status === 'expired')) useBilling.setState({ waiting: null, declined: w.product.id })
}

/** Creates the pending checkout on the server and opens the provider page in the browser. Grants nothing. */
export async function startCheckout(product: Product): Promise<void> {
  const res = await api<CheckoutResponse>('POST', '/billing/checkout', { productId: product.id })
  useBilling.setState({ waiting: { product, url: res.url, reference: res.reference, kind: res.kind }, declined: null, arrived: null })
  await window.alga.app.openExternal(res.url)
}
export const reopenCheckout = () => {
  const w = useBilling.getState().waiting
  if (w) void window.alga.app.openExternal(w.url)
}
/** Stop waiting here; the pending checkout simply expires on the server after 24 h. */
export const stopWaiting = () => useBilling.setState({ waiting: null })

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

/** Equip (or, with null, take off) one slot. The server answers with Me and tells everyone else (USER_UPDATE). */
export async function equip(slot: Slot, id: CosmeticId | null): Promise<void> {
  const me = await api<Me>('PUT', '/users/@me/cosmetics', { [SLOT_KEY[slot]]: id } satisfies PutCosmeticsBody)
  useData.getState().apply({ t: 'ME_UPDATE', d: me })
}

/**
 * Live entitlements: ENTITLEMENTS_UPDATE patches plan + items at once (history is refetched), READY reloads
 * (something may have changed while offline), focus re-checks a waiting checkout. Returns the unsubscribe.
 */
export function startBilling(): () => void {
  void loadBilling()
  const off = onDispatch((d) => {
    if (d.t === 'READY') return void loadBilling()
    if (d.t !== 'ENTITLEMENTS_UPDATE') return
    const st = useBilling.getState()
    const before = st.me?.items ?? []
    const now = granted(before, d.d.items)
    const w = st.waiting
    const done = w && now.includes(skuFor(w.product)) ? w : null
    useBilling.setState({ me: st.me ? { ...st.me, plan: d.d.plan, items: d.d.items } : st.me, ...(done && { waiting: null, arrived: skuFor(done.product) }) })
    if (done) celebrate(done.product)
    void loadBilling()
  })
  const onFocus = () => useBilling.getState().waiting && void loadBilling()
  window.addEventListener('focus', onFocus)
  const offSession = useSession.subscribe((s) => s.phase === 'signed_out' && useBilling.setState({ me: null, waiting: null, declined: null, arrived: null }))
  return () => {
    off()
    offSession()
    window.removeEventListener('focus', onFocus)
  }
}

/** The page that confirms it in place is open: no toast on top of it. Otherwise one quiet toast with a way there. */
function celebrate(p: Product) {
  const section = p.kind === 'plan' ? 'plan' : 'shop'
  if (useSettings.getState().section === section) return
  const text = p.kind === 'plan' ? t.arrived.planToast : t.arrived.itemToast(p.name)
  toast.success(text, { action: { label: t.arrived.see, run: () => openSettings(section) } })
}

/** The look a user's profile shows: what they equipped (PublicUser.cosmetics), live through USER_UPDATE / ME_UPDATE. */
export function useLook(userId: string | undefined): Look {
  const equipped = useData((x) => (userId ? x.users[userId]?.cosmetics : undefined))
  return useMemo(() => lookOf(equipped), [equipped])
}
