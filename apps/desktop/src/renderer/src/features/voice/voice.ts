import type { Dispatch } from '@alga/shared'
import { create } from 'zustand'
import { media, useMedia } from '@/media'
import { errorText } from '@/lib/errors'
import { voiceJoin } from '@/store/actions'
import { useData } from '@/store/data'
import { displayName } from '@/store/selectors'
import { onDispatch, useSession } from '@/store/session'
import { useUi } from '@/store/ui'
import { toast } from '@/ui'
import { t } from './strings'

export interface Ring {
  channelId: string
  fromUserId: string
  at: number
}

interface VoiceUi {
  /** Channel we asked the server to join and are waiting on (token + LiveKit connect). */
  joining: string | null
  ring: Ring | null
  picker: boolean
  /** userId of the stream shown big (focus mode). */
  focus: string | null
  stats: boolean
}

export const useVoice = create<VoiceUi>()(() => ({ joining: null, ring: null, picker: false, focus: null, stats: false }))

const RING_MS = 30_000
let ringTimer: ReturnType<typeof setTimeout> | null = null

export const inVoice = (channelId?: string) => {
  const c = useMedia.getState().connection
  const live = c.state === 'connecting' || c.state === 'connected' || c.state === 'reconnecting'
  return live && (!channelId || c.channelId === channelId)
}

/** Join a voice channel or DM call. Idempotent while already there; switching rooms leaves the old one. */
export async function joinVoice(channelId: string): Promise<void> {
  if (inVoice(channelId) || useVoice.getState().joining === channelId) return
  useVoice.setState({ joining: channelId, focus: null })
  if (useVoice.getState().ring?.channelId === channelId) clearRing()
  try {
    const res = await voiceJoin(channelId)
    await media.join({ ...res, channelId, refresh: () => voiceJoin(channelId) })
  } catch (e) {
    toast.error(errorText(e, useMedia.getState().connection.reason ?? t.joinError))
  } finally {
    if (useVoice.getState().joining === channelId) useVoice.setState({ joining: null })
  }
}

export function leaveVoice(): void {
  useVoice.setState({ focus: null, picker: false })
  void media.leave()
}

/** Open the call: voice channels live in their space, DM calls in the DM. */
export function openCall(channelId: string): void {
  const ch = useData.getState().channels[channelId]
  if (!ch) return
  if (ch.spaceId) useUi.getState().go({ kind: 'space', spaceId: ch.spaceId, channelId })
  else useUi.getState().go({ kind: 'dm', channelId })
}

function clearRing(): void {
  if (ringTimer) clearTimeout(ringTimer)
  ringTimer = null
  useVoice.setState({ ring: null })
}
export const declineRing = clearRing
export async function acceptRing(): Promise<void> {
  const r = useVoice.getState().ring
  if (!r) return
  clearRing()
  openCall(r.channelId)
  await joinVoice(r.channelId)
}

function onEvent(d: Dispatch): void {
  if (d.t === 'VOICE_DISCONNECT') {
    // Server removed us (full, moderator, access lost): leave for good, say why, never auto-rejoin.
    if (useMedia.getState().connection.channelId === d.d.channelId || useVoice.getState().joining === d.d.channelId) {
      leaveVoice()
      toast.error(t.removed[d.d.reason] ?? t.state.disconnected)
    }
    return
  }
  if (d.t === 'VOICE_MOVE') {
    // A moderator moved us: the server already dropped the old room. Follow, and say where we went.
    const ch = useData.getState().channels[d.d.channelId]
    const wasViewingCall = (() => {
      const v = useUi.getState().view
      return v.kind === 'space' && v.channelId === useMedia.getState().connection.channelId
    })()
    if (ch) toast.info(t.moved(ch.name))
    if (wasViewingCall) openCall(d.d.channelId)
    void joinVoice(d.d.channelId)
    return
  }
  if (d.t === 'CALL_RING') {
    if (inVoice(d.d.channelId)) return
    if (ringTimer) clearTimeout(ringTimer)
    useVoice.setState({ ring: { ...d.d, at: Date.now() } })
    ringTimer = setTimeout(clearRing, RING_MS)
    if (!document.hasFocus() && useUi.getState().notifyCalls) {
      const st = useData.getState()
      window.alga?.notify?.({ title: t.ring.notifyTitle, body: t.ring.notifyBody(displayName(st, d.d.fromUserId)), tag: `call:${d.d.channelId}` })
      window.alga?.window?.flashFrame?.()
    }
    return
  }
  // The caller hung up before anyone answered: the ring goes away with the call.
  if (d.t === 'VOICE_STATE_REMOVE') {
    const r = useVoice.getState().ring
    if (r && r.channelId === d.d.channelId && !Object.values(useData.getState().voiceStates).some((v) => v.channelId === r.channelId)) clearRing()
  }
}

/** Last flags we told the gateway, so we only send on real changes (it fans out at most 1/s anyway). */
let sent = ''
function syncVoiceState(force = false): void {
  const m = useMedia.getState()
  if (m.connection.state !== 'connected' && m.connection.state !== 'reconnecting') {
    sent = ''
    return
  }
  const frame = { op: 'voice_state' as const, selfMute: m.self.muted || m.self.deafened, selfDeaf: m.self.deafened, streaming: m.screen.active, video: false }
  const key = JSON.stringify(frame)
  if (!force && key === sent) return
  if (useSession.getState().send(frame)) sent = key
}

/** Wire the voice layer once per signed-in shell. Returns the cleanup. */
export function startVoiceSync(): () => void {
  const offs = [
    onDispatch((d) => {
      onEvent(d)
      // A fresh READY means a new gateway session: the server forgot our self flags.
      if (d.t === 'READY') syncVoiceState(true)
    }),
    useMedia.subscribe((s, prev) => {
      if (s.self.muted !== prev.self.muted || s.self.deafened !== prev.self.deafened || s.screen.active !== prev.screen.active || s.connection.state !== prev.connection.state) {
        syncVoiceState(s.connection.state !== prev.connection.state)
      }
      // Stream ended (the sharer stopped): leave focus mode instead of showing a dead player.
      const f = useVoice.getState().focus
      if (f && prev.participants[f]?.streaming && !s.participants[f]?.streaming) useVoice.setState({ focus: null })
      if (s.connection.state === 'idle' && prev.connection.state !== 'idle') useVoice.setState({ focus: null, picker: false })
    }),
  ]
  const onKey = (e: KeyboardEvent) => {
    if (e.ctrlKey && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'e' && inVoice()) {
      e.preventDefault()
      useVoice.setState((v) => ({ stats: !v.stats }))
    }
  }
  window.addEventListener('keydown', onKey)
  return () => {
    offs.forEach((off) => off())
    window.removeEventListener('keydown', onKey)
    leaveVoice()
    clearRing()
  }
}
