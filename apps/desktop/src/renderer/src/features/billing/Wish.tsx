import { WISHLIST_MAX, type BillingCatalog, type Product } from '@alga/shared'
import { useState } from 'react'
import { ApiRequestError } from '@/lib/api'
import { toastError } from '../auth/VerifyEmail'
import { Group, Row } from '../settings/Frame'
import { useIsTeen } from '../trust/Privacy'
import { Button, EmptyState, Icon, Switch, toast } from '@/ui'
import { CosmeticThumb, type ProfileUser } from './Cosmetics'
import { Heart } from './icons'
import { isCosmeticId, money, type CosmeticId, type ItemState } from './look'
import { setWished, setWishlistVisible, useBilling } from './store'
import { t } from './strings'
import s from './store.module.css'

/*
 * Lista de desejos (growth-plan §2.4): up to 20 items, seen only by friends in the gift dialog, never announced.
 * On by default for 18+, off for 16–17 (and the switch is not offered to them).
 */

export const useWished = (productId: string) => useBilling((x) => !!x.wishlist?.items.includes(productId))

/** "Quero": a heart that answers in the same frame. `compact` = the 28 px icon on a tile. */
export function WishButton({ productId, compact }: { productId: string; compact?: boolean }) {
  const on = useWished(productId)
  const [busy, setBusy] = useState(false)
  const toggle = async () => {
    setBusy(true)
    try {
      await setWished(productId, !on)
    } catch (e) {
      if (e instanceof ApiRequestError && e.status === 409 && !on) toast.info(t.store.wishlist.full)
      else toastError(e)
    } finally {
      setBusy(false)
    }
  }
  const label = on ? t.store.detail.wishRemove : t.store.detail.wishAdd
  if (compact)
    return (
      <button type="button" className={s.heart} aria-pressed={on} aria-label={label} title={label} disabled={busy} onClick={() => void toggle()}>
        <Icon icon={Heart} size={14} filled={on} />
      </button>
    )
  return (
    <Button icon={Heart} variant="ghost" aria-pressed={on} onClick={() => void toggle()} className={on ? s.wished : undefined}>
      {on ? t.store.detail.wished : t.store.detail.wish}
    </Button>
  )
}

export function WishlistTab({ catalog, user, selected, onSelect, state }: { catalog: BillingCatalog; user: ProfileUser; selected: string | null; onSelect: (id: string) => void; state: (p: Product) => ItemState }) {
  const wishlist = useBilling((x) => x.wishlist)
  const teen = useIsTeen()
  const items = (wishlist?.items ?? []).map((id) => catalog.products.find((p) => p.id === id)).filter((p): p is Product => !!p)
  return (
    <section aria-label={t.store.wishlist.title}>
      <Group description={teen ? t.store.wishlist.teen : t.store.wishlist.line}>
        {!teen && wishlist && (
          <Row label={t.store.wishlist.visible} hint={t.store.wishlist.visibleHint}>
            <Switch checked={wishlist.visible} label={t.store.wishlist.visible} onChange={(v) => void setWishlistVisible(v).catch(toastError)} />
          </Row>
        )}
      </Group>
      {items.length === 0 ? (
        <EmptyState icon={Heart} title={t.store.wishlist.empty} />
      ) : (
        <>
          <p className={s.waveLine}>
            {items.length} / {WISHLIST_MAX}
          </p>
          <div className={s.grid}>
            {items.map((p) => (
              <div key={p.id} className={s.tile} data-selected={selected === p.id || undefined}>
                <button type="button" className={s.tileBtn} aria-pressed={selected === p.id} onClick={() => onSelect(p.id)} data-cosmetic-hover>
                  <span className={s.thumb}>{isCosmeticId(p.id) ? <CosmeticThumb id={p.id as CosmeticId} user={user} /> : <span className={s.bundleGlyph}>{(p.items ?? []).length}</span>}</span>
                  <span className={s.tileName}>{p.name}</span>
                  <span className={`${s.tileMeta} tnum`}>{state(p) === 'soon' ? t.store.waveSoon : money(p.priceBrlCents)}</span>
                </button>
                <span className={s.tileWish}>
                  <WishButton productId={p.id} compact />
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  )
}
