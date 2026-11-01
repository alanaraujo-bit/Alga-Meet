import type { AuthResponse, ClientFrame, Dispatch, LoginBody, RegisterBody } from '@alga/shared'
import { create } from 'zustand'
import { api, setApiToken } from '@/lib/api'
import { Gateway, type GatewayStatus } from '@/lib/gateway'
import { useData } from './data'

type Phase = 'booting' | 'signed_out' | 'signed_in'

interface SessionState {
  phase: Phase
  gateway: GatewayStatus
  /** ms until next reconnect attempt, when reconnecting. */
  retryInMs: number | null
  /** READY received at least once for this sign-in (data is usable). */
  hydrated: boolean
  boot(): Promise<void>
  login(body: LoginBody): Promise<void>
  register(body: RegisterBody): Promise<void>
  logout(): Promise<void>
  send(frame: ClientFrame): boolean
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
        if (d.t === 'READY') set({ hydrated: true })
        listeners.forEach((l) => l(d))
      },
      onStatus: (s, info) => set({ gateway: s, retryInMs: info?.retryInMs ?? null }),
      onAuthLost: () => void signOutLocal(),
    })
    gw.start()
  }

  const signIn = async (res: AuthResponse) => {
    await tokenStore.set(res.token)
    setApiToken(res.token)
    set({ phase: 'signed_in', hydrated: false })
    startGateway(res.token)
  }

  const signOutLocal = async () => {
    gw?.stop()
    gw = null
    setApiToken(null)
    await tokenStore.set(null)
    useData.getState().reset()
    set({ phase: 'signed_out', hydrated: false, gateway: 'idle' })
  }

  return {
    phase: 'booting',
    gateway: 'idle',
    retryInMs: null,
    hydrated: false,

    boot: async () => {
      const token = await tokenStore.get()
      if (!token) return set({ phase: 'signed_out' })
      setApiToken(token)
      set({ phase: 'signed_in' })
      startGateway(token)
    },

    login: async (body) => signIn(await api<AuthResponse>('POST', '/auth/login', body)),
    register: async (body) => signIn(await api<AuthResponse>('POST', '/auth/register', body)),

    logout: async () => {
      // Best effort server revoke; local sign-out happens regardless.
      await api('POST', '/auth/logout').catch((e: unknown) => console.warn('[session] logout request failed', e))
      await signOutLocal()
    },

    send: (frame) => gw?.send(frame) ?? false,
  }
})
