import type { PublicUser } from '@alga/shared'
import { useState } from 'react'
import { useMedia } from '@/media'
import { errorText } from '@/lib/errors'
import { useData } from '@/store/data'
import { Button, Icon, type MenuEntry } from '@/ui'
import { useIsTeen } from '../trust/Privacy'
import { CoatHanger, Gift } from './icons'
import { HORA_AZUL } from './hora-azul'
import { isCosmeticId } from './look'
import { endTryOn, openGift, openStore, startTryOn, useMyTryOn, useTryOnOf } from './store'
import { t } from './strings'
import s from './store.module.css'

/*
 * Provador na chamada (growth-plan §2.4): the item on you for 5 minutes for the people in your call, with the
 * "provando" tag on your profile card; one at a time, 10 a day, ends by itself (no countdown on screen); not for
 * 16–17 (they try on the profile only). From the tag, a friend can gift it.
 */

/** In the item detail, under the buy button. */
export function TryOnCall({ productId, name }: { productId: string; name: string }) {
  const teen = useIsTeen()
  const connected = useMedia((m) => m.connection.state === 'connected')
  const mine = useMyTryOn()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (teen) return null
  const on = mine?.productId === productId
  const go = async () => {
    setBusy(true)
    setError(null)
    try {
      if (on) await endTryOn()
      else await startTryOn(productId)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className={s.tryCall} data-on={on || undefined}>
      <span className={s.tryCallIcon}>
        <Icon icon={CoatHanger} size={16} />
      </span>
      <span className={s.tryCallText}>
        <span className={s.tryCallTitle}>{on ? t.store.detail.tryCallOn : t.store.detail.tryCall}</span>
        <span className={s.tryCallLine}>{!connected && !on ? t.store.detail.tryCallNeedsCall : on ? t.store.detail.tryCallOnLine : t.store.detail.tryCallLine}</span>
        {error && (
          <span className={s.tryCallError} role="alert">
            {error}
          </span>
        )}
      </span>
      <Button size="sm" variant={on ? 'ghost' : 'secondary'} loading={busy} disabled={!connected && !on} onClick={() => void go()} aria-label={on ? t.store.detail.tryCallStop : `${t.store.detail.tryCall}: ${name}`}>
        {on ? t.store.detail.tryCallStop : t.store.detail.tryCall}
      </Button>
    </div>
  )
}

const canGiftTo = (userId: string) => {
  const st = useData.getState()
  return userId !== st.me?.id && st.relationships[userId]?.type === 'friend' && st.me?.ageBracket !== 'teen'
}

/**
 * The store's hooks on someone's profile card (member list, chat author, call tile): the "provando" tag while they
 * try something on in your call (with "Presentear" it), and "Presentear" for friends. Nothing for yourself.
 */
export function ProfileStoreActions({ user, onDone }: { user: PublicUser; onDone?: () => void }) {
  const tryOn = useTryOnOf(user.id)
  const friend = useData((x) => x.relationships[user.id]?.type === 'friend' && x.me?.id !== user.id && x.me?.ageBracket !== 'teen')
  const item = tryOn && isCosmeticId(tryOn.productId) ? HORA_AZUL[tryOn.productId].name : null
  if (!item && !friend) return null
  return (
    <div className={s.profileStore}>
      {item && (
        <span className={s.tryTag} title={t.tryTagLine(item)}>
          <Icon icon={CoatHanger} size={12} />
          <span className={s.tryTagWord}>{t.tryTag}</span>
          <span className={s.tryTagItem}>{item}</span>
        </span>
      )}
      <span className={s.profileStoreActions}>
        {item && tryOn && (
          <Button size="sm" variant="ghost" onClick={() => (onDone?.(), openStore('collection', tryOn.productId))}>
            {t.seeInStore}
          </Button>
        )}
        {friend && (
          <Button size="sm" icon={Gift} onClick={() => (onDone?.(), openGift({ recipientId: user.id, ...(tryOn ? { productId: tryOn.productId } : {}) }))}>
            {t.store.detail.gift}
          </Button>
        )}
      </span>
    </div>
  )
}

/** "Presentear" in someone's ⋯ / context menu (friends only, adults only). */
export function giftEntries(user: PublicUser): MenuEntry[] {
  if (!canGiftTo(user.id)) return []
  return [{ label: t.store.detail.gift, icon: Gift, onSelect: () => openGift({ recipientId: user.id }) }]
}
