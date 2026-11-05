import { liveStatus, type CustomStatus } from '@alga/shared'
import { create } from 'zustand'
import { useData } from '@/store/data'
import { onDispatch, useSession } from '@/store/session'
import { useSlowNow } from './store'

/** Own custom status: kept on this PC per account (the server only holds it while you are online). */
export const useOwnStatus = create<{ status: CustomStatus | null }>()(() => ({ status: null }))

const keyFor = (userId: string) => `alga.customStatus.${userId}`
let expiry: ReturnType<typeof setTimeout> | undefined

function schedule(s: CustomStatus | null): void {
  clearTimeout(expiry)
  // setTimeout caps at ~24.8 days; longer ones are simply checked again at the next start.
  if (s?.expiresAt) expiry = setTimeout(() => setOwnStatus(null), Math.min(2 ** 31 - 1, Math.max(0, s.expiresAt - Date.now())))
}

function send(): void {
  useSession.getState().send({ op: 'custom_status', status: liveStatus(useOwnStatus.getState().status) ?? null })
}

export function setOwnStatus(s: CustomStatus | null): void {
  const me = useData.getState().me?.id
  const live = liveStatus(s) ?? null
  useOwnStatus.setState({ status: live })
  if (me) {
    if (live) localStorage.setItem(keyFor(me), JSON.stringify(live))
    else localStorage.removeItem(keyFor(me))
  }
  schedule(live)
  send()
}

/** On every READY: load this account's saved status (if still valid) and tell the server again. */
export function startStatusSync(): () => void {
  return onDispatch((d) => {
    if (d.t !== 'READY') return
    let saved: CustomStatus | null = null
    try {
      saved = JSON.parse(localStorage.getItem(keyFor(d.d.user.id)) ?? 'null') as CustomStatus | null
    } catch {
      saved = null
    }
    const live = liveStatus(saved) ?? null
    if (!live) localStorage.removeItem(keyFor(d.d.user.id))
    useOwnStatus.setState({ status: live })
    schedule(live)
    if (live) send()
  })
}

/** Someone's custom status right now (yours from this PC), hidden once expired. */
export function useCustomStatus(userId: string | undefined): CustomStatus | undefined {
  const isMe = useData((st) => !!userId && st.me?.id === userId)
  const theirs = useData((st) => (userId ? st.customs[userId] : undefined))
  const mine = useOwnStatus((st) => (isMe ? st.status : null))
  const s = isMe ? (mine ?? undefined) : theirs
  // Expiry is re-checked every 30 s, and only by rows whose status has one (no clock for the rest).
  return liveStatus(s, useSlowNow(!!s?.expiresAt))
}
