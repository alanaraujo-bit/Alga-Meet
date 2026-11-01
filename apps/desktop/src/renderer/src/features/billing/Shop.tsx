import type { BillingCatalog, BillingMe, Product } from '@alga/shared'
import { CircleCheck } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { ApiRequestError } from '@/lib/api'
import { errorText } from '@/lib/errors'
import { useData } from '@/store/data'
import { Button, Icon } from '@/ui'
import { needsVerification, openVerifyEmail } from '../auth/VerifyEmail'
import { openSettings } from '../settings/store'
import { CosmeticThumb, ProfileCard, type ProfileUser } from './Cosmetics'
import { COSMETICS, isCosmeticId, itemState, lookFrom, money, type ItemState, type Slot } from './look'
import { BillingGate, ProviderNotice, useBillingReady, Waiting } from './Plan'
import { loadBilling, startCheckout, useBilling } from './store'
import { t } from './strings'
import st from '../settings/settings.module.css'
import s from './billing.module.css'

const SLOTS: Slot[] = ['decoration', 'theme', 'effect', 'nameplate']

export function ShopSection() {
  const ready = useBillingReady()
  const me = useData((x) => x.me)
  if (ready === 'loading' || 'error' in ready) return <BillingGate state={ready} />
  if (!me) return null
  return <Shop catalog={ready.catalog} billing={ready.me} user={me} />
}

function Shop({ catalog, billing, user }: { catalog: BillingCatalog; billing: BillingMe; user: ProfileUser }) {
  const items = useMemo(() => catalog.products.filter((p) => p.kind === 'cosmetic' && isCosmeticId(p.id)), [catalog])
  const look = useMemo(() => lookFrom(billing.items, billing.orders), [billing])
  const state = (p: Product) => itemState(p, billing.items, look, billing.plan.id)
  // Start on something worth previewing: the first item you could get, else the first one.
  const [selected, setSelected] = useState(() => (items.find((p) => state(p) === 'buy') ?? items[0])?.id ?? null)
  const product = items.find((p) => p.id === selected) ?? null
  const arrived = useBilling((x) => x.arrived)
  useEffect(() => () => void (useBilling.getState().arrived && !useBilling.getState().arrived!.startsWith('plan:') && useBilling.setState({ arrived: null })), [])

  const preview = product && isCosmeticId(product.id) ? { ...look, [COSMETICS[product.id]]: product.id } : look
  return (
    <>
      <ProviderNotice catalog={catalog} />
      <p className={s.intro}>{t.shop.intro}</p>
      <div className={s.shopLayout}>
        <div>
          {SLOTS.map((slot) => {
            const list = items.filter((p) => COSMETICS[p.id as keyof typeof COSMETICS] === slot)
            if (!list.length) return null
            return (
              <section key={slot} className={s.shelf} aria-label={t.shop.slots[slot]}>
                <h3 className={st.groupTitle}>{t.shop.slots[slot]}</h3>
                <div className={s.grid}>
                  {list.map((p) => (
                    <Tile key={p.id} product={p} user={user} state={state(p)} selected={p.id === selected} onSelect={() => setSelected(p.id)} />
                  ))}
                </div>
              </section>
            )
          })}
          <p className={s.footnote}>{t.shop.others}</p>
        </div>
        {/* Sticky: whichever shelf you are on, the preview of what you picked stays in view. */}
        <aside className={s.aside} aria-label={t.shop.preview}>
          <figure className={s.previewCol}>
            <div className={s.previewFrame}>
              {/* Remount per item so its motion (sway, motes, fish) plays when you pick it. */}
              <ProfileCard key={selected ?? 'none'} user={user} look={preview} />
            </div>
            <figcaption className={s.caption}>{t.shop.preview}</figcaption>
          </figure>
          {product && <Detail product={product} state={state(product)} arrived={arrived === product.id} enabled={!!catalog.provider} />}
        </aside>
      </div>
    </>
  )
}

const CHIP: Partial<Record<ItemState, string>> = { in_use: t.shop.inUse, owned: t.shop.owned, included: t.shop.included, plus_only: t.shop.plusOnly, unavailable: t.shop.unavailable }

function Tile({ product, user, state, selected, onSelect }: { product: Product; user: ProfileUser; state: ItemState; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" className={s.tile} aria-pressed={selected} onClick={onSelect}>
      <span className={s.thumb}>{isCosmeticId(product.id) && <CosmeticThumb id={product.id} user={user} />}</span>
      <span className={s.tileName}>{product.name}</span>
      <span className={`${s.tileMeta} tnum`}>
        {state === 'buy' ? money(product.priceBrlCents) : <span className={state === 'in_use' || state === 'included' ? s.metaOn : undefined}>{CHIP[state]}</span>}
      </span>
    </button>
  )
}

function Detail({ product, state, arrived, enabled }: { product: Product; state: ItemState; arrived: boolean; enabled: boolean }) {
  const waiting = useBilling((x) => x.waiting)
  const declined = useBilling((x) => x.declined === product.id)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ text: string; gated: boolean } | null>(null)
  useEffect(() => setError(null), [product.id])
  const slot = isCosmeticId(product.id) ? COSMETICS[product.id] : null
  const buy = async () => {
    setBusy(true)
    setError(null)
    try {
      await startCheckout(product)
    } catch (e) {
      // 409 = you already own it (bought on another device): refresh so the page says so.
      if (e instanceof ApiRequestError && e.status === 409) void loadBilling()
      setError({ text: errorText(e), gated: needsVerification(e) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className={`${s.detail} ${arrived ? s.arrived : ''}`}>
      {slot && <span className={s.eyebrow}>{t.shop.slot[slot]}</span>}
      <h3 className={s.detailName}>{product.name}</h3>
      <p className={s.detailDesc}>{product.description}</p>
      <div className={s.detailAction}>
        {arrived ? (
          <span className={s.arrivedLine} role="status">
            <Icon icon={CircleCheck} size={14} />
            {t.shop.arrived}
          </span>
        ) : waiting?.product.id === product.id ? (
          <Waiting />
        ) : state === 'buy' ? (
          <>
            {error?.gated ? (
              <Button variant="primary" onClick={openVerifyEmail}>
                {t.shop.buy(money(product.priceBrlCents))}
              </Button>
            ) : (
              <Button variant="primary" loading={busy} disabled={!enabled || !!waiting} onClick={() => void buy()}>
                {t.shop.buy(money(product.priceBrlCents))}
              </Button>
            )}
            {error && (
              <span className={`${st.rowHint} ${st.error}`} role="alert">
                {error.text}
              </span>
            )}
            {declined && <span className={s.declined}>{t.waiting.declined}</span>}
            <span className={s.fine}>{t.shop.buyFine}</span>
          </>
        ) : state === 'plus_only' ? (
          <>
            <span className={st.rowHint}>{t.shop.plusOnlyLine}</span>
            <Button onClick={() => openSettings('plan')}>{t.shop.seePlus}</Button>
          </>
        ) : (
          <span className={st.rowHint}>{state === 'in_use' ? t.shop.inUseLine : state === 'owned' ? t.shop.ownedLine : state === 'included' ? t.shop.includedLine : t.shop.unavailable}</span>
        )}
      </div>
    </div>
  )
}
