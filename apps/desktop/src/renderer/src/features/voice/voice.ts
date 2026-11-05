import type { Dispatch } from '@alga/shared'
import { create } from 'zustand'
import { media, startCallTelemetry, useMedia } from '@/media'
import { errorText } from '@/lib/errors'
import { voiceJoin } from '@/store/actions'
import { useData } from '@/store/data'
import { displayName } from '@/store/selectors'
import { onDispatch, useSession } from '@/store/session'
import { startCinema } from '../cinema/store'
import { startSoundboard } from '../soundboard/store'
import { useUi } from '@/store/ui'
import { toast } from '@/ui'
import type { Corner } from './layout'
import { mustLeave, refuseOffer } from './directCall'
import { streamNoticeOnTile } from './notice'
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
  /** Channel whose CallStage is on screen (null = none): the mini-player shows only away from the call's stage. */
  stage: string | null
  /** Where the mini-player rests. */
  miniCorner: Corner
  /** Engine notice about your own stream, shown on your tile for a few seconds (not a toast). */
  streamNotice: { text: string; at: number } | null
  /** The E2EE verification sheet (E2ee.tsx) is open. */
  verify: boolean
  /** A direct call refused because the server offered it without E2EE (channel id): the blocking dialog. */
  unsafe: string | null
}

export const useVoice = create<VoiceUi>()(() => ({ joining: null, ring: null, picker: false, focus: null, stats: false, stage: null, miniCorner: 'br', streamNotice: null, verify: false, unsafe: null }))

/** DMs and group DMs: always end-to-end encrypted on this client, whatever the server says (0004 §3.8.3). */
const isDirect = (channelId: string | null): boolean => !!channelId && !!useData.getState().channels[channelId] && !useData.getState().channels[channelId]!.spaceId

/** The server offered a direct call without E2EE: refuse it (never connect), say why. */
class UnsafeCall extends Error {}
function refuseUnsafe(channelId: string): void {
  useVoice.setState({ unsafe: channelId })
}

/** A notice about your stream goes on your tile when the call's stage is on screen; false = keep it a toast. */
export function routeStreamNotice(text: string): boolean {
  const m = useMedia.getState()
  if (!streamNoticeOnTile(text, { sharing: m.screen.active, stage: useVoice.getState().stage, call: m.connection.channelId })) return false
  useVoice.setState({ streamNotice: { text, at: Date.now() } })
  return true
}

const RING_MS = 30_000
let ringTimer: ReturnType<typeof setTimeout> | null = null
/** Outgoing DM call nobody answered yet: ringback until someone joins, we leave, or RING_MS. */
let ringbackTimer: ReturnType<typeof setTimeout> | null = null

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
  stopRingback()
  const st = useData.getState()
  // Starting a DM call (nobody there yet): the server rings the others (CALL_RING), we hear the ringback.
  const calling = !st.channels[channelId]?.spaceId && !Object.values(st.voiceStates).some((v) => v.channelId === channelId && v.userId !== st.me?.id)
  const direct = isDirect(channelId)
  // Direct calls are E2EE on this client regardless of the server's flag: a plain offer is refused before connecting,
  // also on the engine's automatic re-entries (refresh). shortcut: the engine decides the mode from `e2ee`; asking it to
  // require E2EE itself (media.join({ requireE2ee })) would put this rule in the engine too (requested, see docs).
  const offer = async () => {
    const r = await voiceJoin(channelId)
    if (refuseOffer(direct, r.e2ee)) {
      refuseUnsafe(channelId)
      throw new UnsafeCall(t.e2ee.unsafeTitle)
    }
    return r
  }
  try {
    const res = await offer()
    media.setContext({ channelName: useData.getState().channels[channelId]?.name ?? null })
    await media.join({ ...res, channelId, refresh: offer })
    if (calling && inVoice(channelId) && !Object.keys(useMedia.getState().participants).length) {
      media.ring('outgoing')
      ringbackTimer = setTimeout(stopRingback, RING_MS)
    }
  } catch (e) {
    if (!(e instanceof UnsafeCall)) toast.error(errorText(e, useMedia.getState().connection.reason ?? t.joinError))
  } finally {
    if (useVoice.getState().joining === channelId) useVoice.setState({ joining: null })
  }
}

export function leaveVoice(): void {
  useVoice.setState({ focus: null, picker: false })
  stopRingback()
  void media.leave()
}

function stopRingback(): void {
  if (!ringbackTimer) return
  clearTimeout(ringbackTimer)
  ringbackTimer = null
  media.ring(null)
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
  if (ringTimer) media.ring(null)
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
  // The plan changed (purchase confirmed, renewal ended, refund): the share is re-capped or lifted right away.
  if (d.t === 'ENTITLEMENTS_UPDATE') return media.setPlanPresets(d.d.plan.streamPresets)
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
    media.ring('incoming')
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
      // A direct call that ended up connected without E2EE (an engine re-entry, an old server): never stay in it.
      if (mustLeave(isDirect(s.connection.channelId), prev.connection.state, s.connection.state, s.e2ee.state)) {
        const id = s.connection.channelId!
        leaveVoice()
        refuseUnsafe(id)
      }
      // Ringback ends when someone answers or the call drops.
      if (ringbackTimer && (Object.keys(s.participants).length > 0 || s.connection.state === 'idle' || s.connection.state === 'disconnected')) stopRingback()
    }),
    startSoundboard(),
    startCinema(),
    // One aggregate call-quality report per session, only with the user's consent (Me.telemetryOptIn).
    startCallTelemetry(() => useData.getState().me?.telemetryOptIn === true),
    // Me.plan (READY, ME_UPDATE) is the other source of the plan's presets; the engine dedupes.
    useData.subscribe((s, prev) => {
      if (s.me?.plan && s.me.plan !== prev.me?.plan) media.setPlanPresets(s.me.plan.streamPresets)
    }),
  ]
  const plan = useData.getState().me?.plan
  if (plan) media.setPlanPresets(plan.streamPresets)
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
