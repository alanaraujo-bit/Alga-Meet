import { GatewayClose, type ClientFrame, type Dispatch, type ServerFrame } from '@alga/shared'

export type GatewayStatus = 'idle' | 'connecting' | 'ready' | 'reconnecting' | 'closed'

interface Handlers {
  onDispatch(d: Dispatch): void
  onStatus(s: GatewayStatus, info?: { retryInMs?: number }): void
  /** Token rejected or session revoked: caller must sign out. */
  onAuthLost(): void
}

/** Realtime connection with heartbeat and jittered exponential backoff. One instance per signed-in session. */
export class Gateway {
  private ws: WebSocket | null = null
  private heartbeat: ReturnType<typeof setInterval> | null = null
  private retry: ReturnType<typeof setTimeout> | null = null
  private attempt = 0
  private awaitingAck = false
  private stopped = false
  private offs: Array<() => void> = []

  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly h: Handlers,
  ) {}

  start(): void {
    this.stopped = false
    const kick = () => this.reconnectNow()
    window.addEventListener('online', kick)
    this.offs.push(() => window.removeEventListener('online', kick))
    if (window.alga.power) this.offs.push(window.alga.power.onResume(kick))
    this.open()
  }

  stop(): void {
    this.stopped = true
    this.offs.forEach((off) => off())
    this.offs = []
    this.cleanup()
    this.ws?.close(1000)
    this.ws = null
    this.h.onStatus('closed')
  }

  send(frame: ClientFrame): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false
    this.ws.send(JSON.stringify(frame))
    return true
  }

  /** Skip the backoff wait (network came back, machine resumed). */
  reconnectNow(): void {
    if (this.stopped || this.ws?.readyState === WebSocket.OPEN) return
    this.attempt = 0
    this.cleanup()
    this.open()
  }

  private open(): void {
    this.h.onStatus(this.attempt === 0 ? 'connecting' : 'reconnecting')
    const ws = new WebSocket(this.url)
    this.ws = ws
    ws.onopen = () => ws.send(JSON.stringify({ op: 'identify', token: this.token } satisfies ClientFrame))
    ws.onmessage = (ev) => {
      let frame: ServerFrame
      try {
        frame = JSON.parse(String(ev.data)) as ServerFrame
      } catch {
        console.error('[gateway] invalid frame', ev.data)
        return
      }
      if (frame.op === 'heartbeat_ack') {
        this.awaitingAck = false
        return
      }
      const d = { t: frame.t, d: frame.d } as Dispatch
      if (d.t === 'READY') {
        this.attempt = 0
        this.startHeartbeat(d.d.heartbeatIntervalMs)
        this.h.onStatus('ready')
      }
      this.h.onDispatch(d)
    }
    ws.onclose = (ev) => {
      if (this.ws !== ws) return
      this.cleanup()
      this.ws = null
      if (ev.code === GatewayClose.AUTH_FAILED || ev.code === GatewayClose.SESSION_REVOKED) {
        this.stopped = true
        this.h.onAuthLost()
        return
      }
      if (this.stopped) return
      const retryInMs = Math.min(30_000, 1000 * 2 ** this.attempt) * (0.7 + Math.random() * 0.6)
      this.attempt++
      this.h.onStatus('reconnecting', { retryInMs })
      this.retry = setTimeout(() => this.open(), retryInMs)
    }
  }

  private startHeartbeat(intervalMs: number): void {
    this.awaitingAck = false
    this.heartbeat = setInterval(() => {
      // Missed ack = zombie connection (e.g. Wi-Fi switch): force a reconnect.
      if (this.awaitingAck) return this.ws?.close(4000)
      this.awaitingAck = true
      this.send({ op: 'heartbeat' })
    }, intervalMs)
  }

  private cleanup(): void {
    if (this.heartbeat) clearInterval(this.heartbeat)
    if (this.retry) clearTimeout(this.retry)
    this.heartbeat = this.retry = null
  }
}
