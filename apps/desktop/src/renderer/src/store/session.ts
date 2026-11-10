import { GatewayClose, type AccountRestriction, type AuthResponse, type ClientFrame, type Dispatch, type LoginBody, type RegisterBody } from '@alga/shared'
import { create } from 'zustand'
import { api, ApiRequestError, setApiToken } from '@/lib/api'
import { Gateway, type GatewayStatus } from '@/lib/gateway'
import { useData } from './data'

type Phase = 'booting' | 'signed_out' | 'signed_in'

/** Why the auth screen opened, said once there: the gateway closed with 4010, or the account was just deleted. */
export type AuthNotice = { kind: 'restricted' } | { kind: 'deletion'; purgeAfter: string }

interface SessionState {
  phase: Phase
  gateway: GatewayStatus
  /** ms until next reconnect attempt, when reconnecting. */
  retryInMs: number | null
  /** READY received at least once for this sign-in (data is usable). */
  hydrated: boolean
  /** The last READY said this server runs the cinema (features started after READY read it here). */
  cinema: boolean
  /** The last READY said this server plays music in calls (older ones close the socket on music_*). */
  music: boolean
  /** Login (or the birth-date declaration) answered 403 with a restriction: the restricted-account screen shows it. */
  restricted: AccountRestriction | null
  notice: AuthNotice | null
  /** This login canceled a pending account deletion (AuthResponse.deletionCanceled): said once in the shell. */
  deletionCanceled: boolean
  boot(): Promise<void>
  login(body: LoginBody): Promise<void>
  register(body: RegisterBody): Promise<void>
  logout(): Promise<void>
  /** Local sign-out after the server already ended every session (deletion, restriction). */
  signOutWith(notice: AuthNotice | null, restricted?: AccountRestriction): Promise<void>
  send(frame: ClientFrame): boolean
  /** Skip the backoff wait ("Tentar agora"). */
  reconnect(): void
}

let gw: Gateway | null = null
const listeners = new Set<(d: Dispatch) => void>()

/** Subscribe to raw gateway dispatches (transient events like CALL_RING, notifications). */
export function onDispatch(cb: (d: Dispatch) => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

// Bridge may be partial while the native layer is in development; fall back to memory-only.
let memToken: string | null = null
const tokenStore = {
  get: () => (window.alga.auth ? window.alga.auth.getToken() : Promise.resolve(memToken)),
  set: (t: string | null) => (window.alga.auth ? window.alga.auth.setToken(t) : Promise.resolve(void (memToken = t))),
}

export const useSession = create<SessionState>()((set, get) => {
  const startGateway = (token: string) => {
    gw?.stop()
    gw = new Gateway(window.alga.config.gatewayUrl, token, {
      onDispatch: (d) => {
        useData.getState().apply(d)
        if (d.t === 'READY') set({ hydrated: true, cinema: d.d.cinema === true, music: d.d.music === true })
        listeners.forEach((l) => l(d))
      },
      onStatus: (s, info) => set({ gateway: s, retryInMs: info?.retryInMs ?? null }),
      onAuthLost: (code) => void signOutLocal(code === GatewayClose.ACCOUNT_RESTRICTED && !get().notice ? { notice: { kind: 'restricted' } } : {}),
    })
    gw.start()
  }

  const signIn = async (res: AuthResponse) => {
    await tokenStore.set(res.token)
    setApiToken(res.token)
    set({ phase: 'signed_in', hydrated: false, restricted: null, notice: null, deletionCanceled: !!res.deletionCanceled })
    startGateway(res.token)
  }

  const signOutLocal = async (extra: Partial<Pick<SessionState, 'notice' | 'restricted'>> = {}) => {
    gw?.stop()
    gw = null
    setApiToken(null)
    await tokenStore.set(null)
    useData.getState().reset()
    set({ phase: 'signed_out', hydrated: false, cinema: false, music: false, gateway: 'idle', deletionCanceled: false, ...extra })
  }

  const authCall = async (path: string, body: LoginBody | RegisterBody) => {
    try {
      return await api<AuthResponse>('POST', path, body)
    } catch (e) {
      if (e instanceof ApiRequestError && e.restriction) set({ restricted: e.restriction, notice: null })
      throw e
    }
  }

  return {
    phase: 'booting',
    gateway: 'idle',
    retryInMs: null,
    hydrated: false,
    cinema: false,
    music: false,
    restricted: null,
    notice: null,
    deletionCanceled: false,

    boot: async () => {
      const token = await tokenStore.get()
      if (!token) return set({ phase: 'signed_out' })
      setApiToken(token)
      set({ phase: 'signed_in' })
      startGateway(token)
    },

    login: async (body) => signIn(await authCall('/auth/login', body)),
    register: async (body) => signIn(await authCall('/auth/register', body)),

    logout: async () => {
      // Best effort server revoke; local sign-out happens regardless.
      await api('POST', '/auth/logout').catch((e: unknown) => console.warn('[session] logout request failed', e))
      await signOutLocal({ notice: null, restricted: null })
    },
    signOutWith: (notice, restricted) => signOutLocal({ notice, restricted: restricted ?? null }),

    send: (frame) => gw?.send(frame) ?? false,
    reconnect: () => gw?.reconnectNow(),
  }
})
