import type { BillingCatalog, BillingMe, Product } from '@alga/shared'
import { CircleCheck, RotateCcw } from '@/ui/icons'
import { useEffect, useMemo, useReducer, useState, type ReactNode } from 'react'
import { ApiRequestError } from '@/lib/api'
import { errorText } from '@/lib/errors'
import { useData } from '@/store/data'
import { Button, Icon, IconButton, Tabs } from '@/ui'
import { needsVerification, openVerifyEmail } from '../auth/VerifyEmail'
import { openSettings } from '../settings/store'
import { TeenPurchaseNotice, useIsTeen } from '../trust/Privacy'
import { Cosmetic, CosmeticThumb, DecoratedAvatar, demoLevel, Nameplate, ProfileCard, SpeakingSample, StreamSample, type ProfileUser } from './Cosmetics'
import { Fine } from './Fine'
import { GiftsTab } from './Gift'
import { Gift as GiftIcon, Sparkle } from './icons'
import { HORA_AZUL } from './hora-azul'
import { bundleView, COSMETICS, isCosmeticId, itemState, money, SLOTS, type CosmeticId, type ItemState, type Look, type Slot } from './look'
import { BillingGate, ProviderNotice, useBillingReady, Waiting } from './Plan'
import { AppIcon } from './render/AppIcon'
import { AuraGlyph } from './render/Voice'
import { equip, loadBilling, openGift, quote, startCheckout, useBilling, useCosmeticPreview, type StoreTab } from './store'
import { t } from './strings'
import { TryOnCall } from './TryOn'
import { WishButton, WishlistTab } from './Wish'
import st from '../settings/settings.module.css'
import s from './store.module.css'

/*
 * Personalização (growth-plan §2.4, package C): the Hora Azul collection in its real contexts, bundles with the
 * honest saving (the items are sold apart at those prices), your own card as the fitting room (try any number of
 * items at once), wishlist and gifts. Prices in reais, one-time, "fica na sua conta", 7-day refund said next to the
 * button. Nothing here blinks, counts down or nags.
 */

const PROFILE_SLOTS = new Set<Slot>(['decoration', 'nameplate', 'effect', 'theme'])
const HEROES: CosmeticId[] = ['deco_ha_halo_vidro', 'effect_ha_hora_azul', 'nameplate_ha_crepusculo', 'aura_ha_respiro', 'frame_ha_cinema']
/** "Novo" is a static label for 14 days after a wave opens, inside the store only (§2.4). */
const NEW_MS = 14 * 86_400_000

export function ShopSection() {
  const ready = useBillingReady()
  const me = useData((x) => x.me)
  if (ready === 'loading' || 'error' in ready) return <BillingGate state={ready} />
  if (!me) return null
  return <Shop catalog={ready.catalog} billing={ready.me} user={me} />
}

function Shop({ catalog, billing, user }: { catalog: BillingCatalog; billing: BillingMe; user: ProfileUser }) {
  const items = useMemo(() => catalog.products.filter((p) => p.kind === 'cosmetic' && isCosmeticId(p.id)), [catalog])
  const bundles = useMemo(() => catalog.products.filter((p) => p.kind === 'bundle'), [catalog])
  const preview = useCosmeticPreview(user.id)
  const state = (p: Product) => itemState(p, billing.items, preview.equipped, billing.plan.id)
  const tab = useBilling((x) => x.tab)
  const focus = useBilling((x) => x.focus)
  const [selected, setSelected] = useState<string | null>(() => focus ?? (items.find((p) => p.hero && state(p) === 'buy') ?? items[0])?.id ?? null)
  // Another place opened the store on an item ("Ver na loja", a toast): select it once.
  useEffect(() => {
    if (!focus) return
    setSelected(focus)
    useBilling.setState({ focus: null })
  }, [focus])
  const arrived = useBilling((x) => x.arrived)
  useEffect(() => () => void (useBilling.getState().arrived && !useBilling.getState().arrived!.startsWith('plan:') && useBilling.setState({ arrived: null })), [])
  const product = catalog.products.find((p) => p.id === selected) ?? null
  const setTab = (v: StoreTab) => useBilling.setState({ tab: v })
  const collection = catalog.collections?.find((c) => c.id === 'hora_azul')

  return (
    <>
      <ProviderNotice catalog={catalog} />
      <CollectionHero catalog={catalog} user={user} onPick={(id) => (setSelected(id), setTab('collection'))} />
      <div className={s.tabs}>
        <Tabs
          label={t.store.tabsLabel}
          value={tab}
          onChange={setTab}
          items={[
            { value: 'collection', label: t.store.tabs.collection },
            { value: 'bundles', label: t.store.tabs.bundles },
            { value: 'wishlist', label: t.store.tabs.wishlist },
            { value: 'gifts', label: t.store.tabs.gifts },
          ]}
        />
      </div>
      {tab === 'gifts' ? (
        <GiftsTab catalog={catalog} billing={billing} />
      ) : (
        <div className={s.layout}>
          <div className={s.main}>
            {tab === 'collection' &&
              ([1, 2] as const).map((wave) => {
                const w = collection?.waves.find((x) => x.wave === wave)
                const list = items.filter((p) => (p.wave ?? 1) === wave)
                if (!list.length) return null
                const isNew = !!w?.open && !!w.opensAt && Date.now() - Date.parse(w.opensAt) < NEW_MS
                return (
                  <section key={wave} className={s.wave} aria-label={t.store.wave(wave)}>
                    <header className={s.waveHead}>
                      <span className={s.waveName}>{t.store.wave(wave)}</span>
                      <span className={s.waveMeta}>{w?.open ? t.store.waveOpen(list.filter((p) => p.purchasable).length) : t.store.waveSoon}</span>
                    </header>
                    {!w?.open && <p className={s.waveLine}>{t.store.waveSoonLine}</p>}
                    {SLOTS.map((slot) => {
                      const shelf = list.filter((p) => COSMETICS[p.id as CosmeticId] === slot)
                      if (!shelf.length) return null
                      return (
                        <div key={slot} className={s.shelf} role="group" aria-label={t.shop.slots[slot]}>
                          <h3 className={st.groupTitle}>{t.shop.slots[slot]}</h3>
                          <div className={s.grid}>
                            {shelf.map((p) => (
                              <Tile key={p.id} product={p} user={user} state={state(p)} isNew={isNew} selected={p.id === selected} onSelect={() => setSelected(p.id)} />
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </section>
                )
              })}
            {tab === 'bundles' && <Bundles bundles={bundles} catalog={catalog} billing={billing} user={user} selected={selected} onSelect={setSelected} />}
            {tab === 'wishlist' && <WishlistTab catalog={catalog} user={user} selected={selected} onSelect={setSelected} state={state} />}
            {tab === 'collection' && <p className={s.footnote}>{t.shop.others}</p>}
          </div>
          {/* Sticky: whichever shelf you are on, the item on you stays in view. */}
          <aside className={s.aside} aria-label={t.shop.preview}>
            {product && <Preview product={product} user={user} preview={preview} catalog={catalog} />}
            {product && (product.kind === 'bundle' ? (
              <BundleDetail bundle={product} catalog={catalog} billing={billing} arrived={arrived === product.id} enabled={!!catalog.provider} />
            ) : (
              <Detail product={product} state={state(product)} look={preview.equipped} catalog={catalog} arrived={arrived === product.id} enabled={!!catalog.provider} preview={preview} />
            ))}
          </aside>
        </div>
      )}
    </>
  )
}

// ── The collection's hero: the five heroes in the places they live ──

function CollectionHero({ catalog, user, onPick }: { catalog: BillingCatalog; user: ProfileUser; onPick: (id: string) => void }) {
  const c = catalog.collections?.find((x) => x.id === 'hora_azul')
  const [round, replay] = useReducer((n: number) => n + 1, 0)
  const sold = (id: string) => catalog.products.find((p) => p.id === id)
  return (
    <section className={s.hero} aria-label={c?.name ?? 'Hora Azul'}>
      <div className={s.heroSky} aria-hidden />
      <div className={s.heroText}>
        <span className={s.eyebrow}>{t.store.eyebrow}</span>
        <h3 className={s.heroTitle}>{c?.name ?? 'Hora Azul'}</h3>
        <p className={s.heroLede}>{t.store.lede}</p>
        <p className={s.heroHonest}>{t.store.honest}</p>
      </div>
      <div className={s.heroStage} key={round}>
        {/* The card the heroes dress: the effect plays on open, the halo and the plate on top. */}
        <button type="button" className={s.heroCard} onClick={() => onPick('effect_ha_hora_azul')} aria-label={sold('effect_ha_hora_azul')?.name}>
          <ProfileCard user={{ ...user, bio: '' }} look={{ effect: 'effect_ha_hora_azul', decoration: 'deco_ha_halo_vidro', nameplate: 'nameplate_ha_crepusculo', theme: 'theme_ha_noite_indigo' }} />
        </button>
        <div className={s.heroSide}>
          <button type="button" className={s.heroTile} onClick={() => onPick('aura_ha_respiro')} aria-label={sold('aura_ha_respiro')?.name}>
            <SpeakingSample user={user} size={64} aura="aura_ha_respiro" decoration="deco_ha_halo_vidro" level={demoLevel()}>
              <span className={s.heroPill}>{user.displayName}</span>
            </SpeakingSample>
          </button>
          <button type="button" className={s.heroStream} onClick={() => onPick('frame_ha_cinema')} aria-label={sold('frame_ha_cinema')?.name}>
            <StreamSample id="frame_ha_cinema" width={232} />
          </button>
        </div>
      </div>
      <div className={s.heroStrip}>
        {HEROES.map((id) => {
          const p = sold(id)
          return (
            <button key={id} type="button" className={s.heroChip} onClick={() => onPick(id)}>
              <Icon icon={Sparkle} size={12} />
              <span>{HORA_AZUL[id].name}</span>
              <span className={`${s.heroPrice} tnum`}>{p?.available === false ? t.store.wave(p.wave ?? 2) : p ? money(p.priceBrlCents) : ''}</span>
            </button>
          )
        })}
        <IconButton icon={RotateCcw} label="Repetir" size="sm" onClick={replay} />
      </div>
    </section>
  )
}

// ── Tiles ──

const CHIP: Partial<Record<ItemState, string>> = { in_use: t.shop.inUse, owned: t.shop.owned, included: t.shop.included, plus_only: t.shop.plusOnly, unavailable: t.shop.unavailable }

function Tile({ product, user, state, isNew, selected, onSelect }: { product: Product; user: ProfileUser; state: ItemState; isNew: boolean; selected: boolean; onSelect: () => void }) {
  return (
    <div className={s.tile} data-selected={selected || undefined} data-hero={product.hero || undefined}>
      <button type="button" className={s.tileBtn} aria-pressed={selected} onClick={onSelect} data-cosmetic-hover>
        <span className={s.thumb}>{isCosmeticId(product.id) && <CosmeticThumb id={product.id} user={user} />}</span>
        <span className={s.tileName}>
          {product.name}
          {isNew && state === 'buy' && <span className={s.newChip}>{t.store.newBadge}</span>}
        </span>
        <span className={`${s.tileMeta} tnum`}>
          {state === 'buy' || state === 'soon' ? money(product.priceBrlCents) : <span className={state === 'in_use' || state === 'included' ? s.metaOn : undefined}>{CHIP[state]}</span>}
        </span>
      </button>
      {(state === 'buy' || state === 'soon') && (
        <span className={s.tileWish}>
          <WishButton productId={product.id} compact />
        </span>
      )}
    </div>
  )
}

// ── The fitting room: your card with what you are trying, then the item where else it shows ──

type Preview = ReturnType<typeof useCosmeticPreview>

function Preview({ product, user, preview, catalog }: { product: Product; user: ProfileUser; preview: Preview; catalog: BillingCatalog }) {
  const [round, replay] = useReducer((n: number) => n + 1, 0)
  const ids = product.kind === 'bundle' ? (product.items ?? []).filter(isCosmeticId) : isCosmeticId(product.id) ? [product.id] : []
  const look: Look = { ...preview.look }
  for (const id of ids) look[COSMETICS[id]] = id
  const slot = ids.length === 1 ? COSMETICS[ids[0]!] : null
  const tried = Object.values(preview.trying).filter((id): id is CosmeticId => !!id)
  const triedCents = tried.reduce((sum, id) => sum + (catalog.products.find((p) => p.id === id)?.priceBrlCents ?? 0), 0)
  const callIds = ids.filter((id) => !PROFILE_SLOTS.has(COSMETICS[id]))
  return (
    <div className={s.preview}>
      <div className={s.previewHead}>
        <span className={s.previewTitle}>{t.store.look.title}</span>
        {tried.length > 0 && (
          <span className={s.previewTried}>
            {t.store.look.trying(tried.length)} · <span className="tnum">{t.store.look.total(money(triedCents))}</span>
            <button type="button" className={s.linkBtn} onClick={() => preview.clear()}>
              {t.store.look.clear}
            </button>
          </span>
        )}
        <IconButton icon={RotateCcw} label="Repetir o gesto" size="sm" onClick={replay} />
      </div>
      {/* Remount per item (and per replay) so its gesture plays when you pick it. */}
      <div className={s.previewCard} key={`${product.id}:${round}`}>
        <ProfileCard user={user} look={look} />
      </div>
      {(slot === 'decoration' || slot === 'nameplate' || product.kind === 'bundle') && (
        <figure className={s.context} key={`row:${product.id}:${round}`}>
          <div className={s.sampleRow} data-cosmetic-hover>
            <DecoratedAvatar user={user} size={32} decoration={look.decoration} decorative motion="play" presence="online" />
            <span className={s.sampleName}>
              <Nameplate id={look.nameplate} row motion="play">
                {user.displayName}
              </Nameplate>
            </span>
          </div>
          <figcaption className={s.caption}>{t.store.inContext.row}</figcaption>
        </figure>
      )}
      {callIds.map((id) => (
        <figure className={s.context} key={`${id}:${round}`}>
          <div className={s.sampleStage}>
            {COSMETICS[id] === 'aura' ? (
              <SpeakingSample user={user} size={80} aura={id} decoration={look.decoration} level={demoLevel()}>
                <span className={s.heroPill}>
                  <AuraGlyph id={id} />
                  {user.displayName}
                </span>
              </SpeakingSample>
            ) : COSMETICS[id] === 'icon' ? (
              <TaskbarSample id={id} />
            ) : (
              <Cosmetic id={id} size={96} state="play" user={user} />
            )}
          </div>
          <figcaption className={s.caption}>{COSMETICS[id] === 'icon' ? t.shop.where.onlyYou : COSMETICS[id] === 'aura' ? t.store.inContext.tile : COSMETICS[id] === 'frame' ? t.store.inContext.stream : t.shop.where.call}</figcaption>
        </figure>
      ))}
      {slot && PROFILE_SLOTS.has(slot) && <p className={s.caption}>{slot === 'theme' || slot === 'effect' ? t.shop.where.cardOnly : t.store.look.hint}</p>}
    </div>
  )
}

/** The app icon where it lives: a taskbar strip at 24 px next to two neutral apps, and the 64 px tile. */
function TaskbarSample({ id }: { id: CosmeticId }) {
  return (
    <span className={s.taskbarWrap}>
      <AppIcon id={id} size={64} />
      <span className={s.taskbar} aria-hidden>
        <span className={s.taskApp} />
        <span className={s.taskMine}>
          <AppIcon id={id} size={24} />
        </span>
        <span className={s.taskApp} />
      </span>
    </span>
  )
}

// ── Detail: what it is, what it costs, every action next to its fine print ──

function Detail({ product, state, look, catalog, arrived, enabled, preview }: { product: Product; state: ItemState; look: Look; catalog: BillingCatalog; arrived: boolean; enabled: boolean; preview: Preview }) {
  const waiting = useBilling((x) => x.waiting)
  const declined = useBilling((x) => x.declined === product.id)
  // 16–17: the explanation takes the buttons' place (no generic error from the server's refusal).
  const teen = useIsTeen()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ text: string; gated: boolean } | null>(null)
  useEffect(() => setError(null), [product.id])
  const id = isCosmeticId(product.id) ? product.id : null
  const slot = id ? COSMETICS[id] : null
  const names = useMemo(() => Object.fromEntries(catalog.products.map((p) => [p.id, p.name])), [catalog])
  const trying = !!id && preview.trying[COSMETICS[id]] === id
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
  const tryProfile = id && PROFILE_SLOTS.has(COSMETICS[id]) && state !== 'in_use' && (
    <Button size="sm" variant="ghost" onClick={() => (trying ? preview.clear(COSMETICS[id]) : preview.tryOn(id))} aria-pressed={trying}>
      {trying ? t.store.detail.untry : t.store.detail.tryProfile}
    </Button>
  )
  return (
    <div className={`${s.detail} ${arrived ? s.arrived : ''}`}>
      <div className={s.detailHead}>
        {slot && <span className={s.eyebrow}>{t.shop.slot[slot]}{product.hero ? ' · ★' : ''}</span>}
        <h3 className={s.detailName}>{product.name}</h3>
        <p className={s.detailDesc}>{product.description}</p>
      </div>
      {(state === 'buy' || state === 'soon') && <span className={`${s.bigPrice} tnum`}>{money(product.priceBrlCents)}</span>}
      <div className={s.actions}>
        {arrived && id ? (
          <Equip
            id={id}
            inUse={state === 'in_use'}
            lead={
              <span className={s.arrivedLine} role="status">
                <Icon icon={CircleCheck} size={14} />
                {t.shop.arrived}
              </span>
            }
          />
        ) : waiting?.product.id === product.id && !waiting.giftId ? (
          <Waiting />
        ) : state === 'buy' && teen ? (
          <>
            <TeenPurchaseNotice />
            <div className={s.row}>
              <WishButton productId={product.id} />
              {tryProfile}
            </div>
          </>
        ) : state === 'buy' ? (
          <>
            {error?.gated ? (
              <Button variant="primary" size="lg" full onClick={openVerifyEmail}>
                {t.shop.buy(money(product.priceBrlCents))}
              </Button>
            ) : (
              <Button variant="primary" size="lg" full loading={busy} disabled={!enabled || !!waiting} onClick={() => void buy()}>
                {t.shop.buy(money(product.priceBrlCents))}
              </Button>
            )}
            <div className={s.row}>
              {product.giftable && (
                <Button icon={GiftIcon} onClick={() => openGift({ productId: product.id })} disabled={!enabled}>
                  {t.store.detail.gift}
                </Button>
              )}
              <WishButton productId={product.id} />
              {tryProfile}
            </div>
            {error && (
              <span className={`${st.rowHint} ${st.error}`} role="alert">
                {error.text}
              </span>
            )}
            {declined && <span className={s.declined}>{t.waiting.declined}</span>}
            <Fine sandbox={!!catalog.provider?.sandbox} />
            {id && <TryOnCall productId={id} name={product.name} />}
          </>
        ) : state === 'soon' ? (
          <>
            <span className={st.rowHint}>{t.store.waveSoonLine}</span>
            <div className={s.row}>
              <WishButton productId={product.id} />
              {tryProfile}
            </div>
          </>
        ) : state === 'plus_only' ? (
          <>
            <span className={st.rowHint}>{t.shop.plusOnlyLine}</span>
            {!teen && <Button onClick={() => openSettings('plan')}>{t.shop.seePlus}</Button>}
          </>
        ) : id && (state === 'in_use' || state === 'owned' || state === 'included') ? (
          <>
            <Equip
              id={id}
              inUse={state === 'in_use'}
              lead={<span className={st.rowHint}>{state === 'in_use' ? t.shop.inUseLine : slot && look[slot] ? t.shop.replaces(names[look[slot]!] ?? '') : state === 'owned' ? t.shop.ownedLine : t.shop.includedLine}</span>}
            />
            {product.giftable && !teen && product.available !== false && (
              <Button icon={GiftIcon} onClick={() => openGift({ productId: product.id })} disabled={!enabled}>
                {t.store.detail.gift}
              </Button>
            )}
          </>
        ) : (
          <span className={st.rowHint}>{t.shop.unavailable}</span>
        )}
      </div>
    </div>
  )
}

/** Use it on the profile / take it off. Feedback in place: the tile chip, the preview and this line change. */
function Equip({ id, inUse, lead }: { id: CosmeticId; inUse: boolean; lead: ReactNode }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => setError(null), [id])
  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      await equip(COSMETICS[id], inUse ? null : id)
    } catch (e) {
      // 403 = the item left your account meanwhile (refund, plan ended): refresh so the page says so.
      if (e instanceof ApiRequestError && e.status === 403) void loadBilling()
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      {lead}
      <Button variant={inUse ? 'secondary' : 'primary'} size="lg" full loading={busy} onClick={() => void run()}>
        {inUse ? t.shop.unequip : t.shop.equip}
      </Button>
      {error && (
        <span className={`${st.rowHint} ${st.error}`} role="alert">
          {error}
        </span>
      )}
    </>
  )
}

// ── Bundles ──

function Bundles({ bundles, catalog, billing, user, selected, onSelect }: { bundles: Product[]; catalog: BillingCatalog; billing: BillingMe; user: ProfileUser; selected: string | null; onSelect: (id: string) => void }) {
  return (
    <section aria-label={t.store.bundles.title}>
      <p className={s.waveLine}>{t.store.bundles.line}</p>
      {bundles.some((b) => b.available === false) && <p className={s.waveLine}>{t.store.bundles.soonLine}</p>}
      <div className={s.bundles}>
        {bundles.map((b) => {
          const v = bundleView(b, catalog.products, billing.items)
          return (
            <button key={b.id} type="button" className={s.bundle} aria-pressed={selected === b.id} onClick={() => onSelect(b.id)} data-cosmetic-hover>
              <span className={s.bundleArt}>
                {v.items.filter((p) => isCosmeticId(p.id)).map((p) => (
                  <span key={p.id} className={s.bundleThumb}>
                    <CosmeticThumb id={p.id as CosmeticId} user={user} />
                  </span>
                ))}
              </span>
              <span className={s.bundleText}>
                <span className={s.tileName}>{b.name}</span>
                <span className={s.tileMeta}>{b.description}</span>
                <span className={`${s.bundlePrice} tnum`}>
                  <strong>{money(b.priceBrlCents)}</strong>
                  <span>
                    {t.store.bundles.items(v.items.length)} · {t.store.bundles.separate(money(v.separateCents))}
                  </span>
                </span>
                <span className={s.saving}>{b.available === false ? t.store.bundles.soon : t.store.bundles.save(money(v.savingCents))}</span>
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}

function BundleDetail({ bundle, catalog, billing, arrived, enabled }: { bundle: Product; catalog: BillingCatalog; billing: BillingMe; arrived: boolean; enabled: boolean }) {
  const teen = useIsTeen()
  const waiting = useBilling((x) => x.waiting)
  const v = bundleView(bundle, catalog.products, billing.items)
  const all = v.owned === v.items.length
  // "Completar o conjunto": the server's quote is the price (bundle × missing ÷ all, down to ,90).
  const [price, setPrice] = useState<number | null>(v.owned ? null : bundle.priceBrlCents)
  useEffect(() => {
    if (!v.owned || all || bundle.available === false) return setPrice(bundle.priceBrlCents)
    let live = true
    quote(bundle.id).then((q) => live && setPrice(q.amountCents), () => live && setPrice(null))
    return () => void (live = false)
  }, [bundle.id, bundle.priceBrlCents, bundle.available, v.owned, all])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const buy = async () => {
    setBusy(true)
    setError(null)
    try {
      await startCheckout(bundle)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className={`${s.detail} ${arrived ? s.arrived : ''}`}>
      <div className={s.detailHead}>
        <span className={s.eyebrow}>{t.store.bundles.title}</span>
        <h3 className={s.detailName}>{bundle.name}</h3>
        <p className={s.detailDesc}>{bundle.description}</p>
      </div>
      <ul className={s.bundleList}>
        {v.items.map((p) => (
          <li key={p.id}>
            <span>{p.name}</span>
            <span className="tnum">{billing.items.some((e) => e.sku === p.id) ? t.shop.owned : money(p.priceBrlCents)}</span>
          </li>
        ))}
        <li className={s.bundleSum}>
          <span>{t.store.bundles.sum}</span>
          <span className="tnum">{money(v.separateCents)}</span>
        </li>
      </ul>
      {all ? (
        <span className={st.rowHint}>{t.store.bundles.owned}</span>
      ) : (
        <>
          <span className={`${s.bigPrice} tnum`}>{price != null ? money(price) : '…'}</span>
          {v.owned > 0 && price != null && <span className={st.rowHint}>{t.store.bundles.completeLine(money(price), v.owned)}</span>}
          <div className={s.actions}>
            {waiting?.product.id === bundle.id ? (
              <Waiting />
            ) : bundle.available === false ? (
              <>
                <span className={st.rowHint}>{t.store.bundles.soonLine}</span>
                <WishButton productId={bundle.id} />
              </>
            ) : teen ? (
              <TeenPurchaseNotice />
            ) : (
              <>
                <Button variant="primary" size="lg" full loading={busy} disabled={!enabled || !!waiting || price == null} onClick={() => void buy()}>
                  {v.owned ? `${t.store.bundles.complete} · ${price != null ? money(price) : ''}` : t.shop.buy(money(bundle.priceBrlCents))}
                </Button>
                <div className={s.row}>
                  <Button icon={GiftIcon} onClick={() => openGift({ productId: bundle.id })} disabled={!enabled}>
                    {t.store.detail.gift}
                  </Button>
                  <WishButton productId={bundle.id} />
                </div>
                {error && (
                  <span className={`${st.rowHint} ${st.error}`} role="alert">
                    {error}
                  </span>
                )}
                <Fine sandbox={!!catalog.provider?.sandbox} />
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
