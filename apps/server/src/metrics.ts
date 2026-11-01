/**
 * Prometheus metrics without a client library: counters, gauges and histograms rendered in the text exposition
 * format 0.0.4 (https://prometheus.io/docs/instrumenting/exposition_formats/). One registry per process (that is
 * what Prometheus scrapes); gauges that mirror live state (sockets, voice rooms, memory) are set right before each
 * render by src/observability.ts. Label values must come from small fixed sets (route templates, enums), never from
 * user input. Every metric is listed in docs/infra/observability.md.
 */

type Labels = Record<string, string>

/** A bug that puts unbounded values in a label stops adding series here instead of growing memory forever. */
const MAX_SERIES = 2000

const escape = (v: string) => v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"')
const num = (n: number) => (Number.isFinite(n) ? String(n) : Number.isNaN(n) ? 'NaN' : n > 0 ? '+Inf' : '-Inf')
const keyOf = (l: Labels) => JSON.stringify(Object.entries(l).sort(([a], [b]) => (a < b ? -1 : 1)))
function fmt(l: Labels, extra?: [string, string]): string {
  const pairs = Object.entries(l).sort(([a], [b]) => (a < b ? -1 : 1))
  if (extra) pairs.push(extra)
  return pairs.length ? `{${pairs.map(([k, v]) => `${k}="${escape(v)}"`).join(',')}}` : ''
}

abstract class Metric<V> {
  protected readonly series = new Map<string, { labels: Labels; value: V }>()
  constructor(readonly name: string, readonly help: string, readonly type: 'counter' | 'gauge' | 'histogram') {}

  protected slot(labels: Labels, init: () => V): { labels: Labels; value: V } | undefined {
    const k = keyOf(labels)
    let s = this.series.get(k)
    if (!s && this.series.size < MAX_SERIES) this.series.set(k, (s = { labels: { ...labels }, value: init() }))
    return s
  }

  render(): string {
    const head = `# HELP ${this.name} ${this.help.replace(/\\/g, '\\\\').replace(/\n/g, '\\n')}\n# TYPE ${this.name} ${this.type}\n`
    return head + [...this.series.values()].map((s) => this.lines(s.labels, s.value)).join('')
  }

  protected abstract lines(labels: Labels, value: V): string
}

export class Counter extends Metric<number> {
  inc(labels: Labels = {}, n = 1): void {
    const s = this.slot(labels, () => 0)
    if (s && n > 0) s.value += n
  }

  get(labels: Labels = {}): number {
    return this.series.get(keyOf(labels))?.value ?? 0
  }

  protected lines(labels: Labels, v: number): string {
    return `${this.name}${fmt(labels)} ${num(v)}\n`
  }
}

/** `type: 'counter'` for monotonic values read from elsewhere at scrape time (process CPU seconds). */
export class Gauge extends Metric<number> {
  set(labels: Labels, v: number): void {
    const s = this.slot(labels, () => 0)
    if (s) s.value = v
  }

  /** Drops every series (gauges rebuilt from scratch at each scrape, so vanished label sets disappear). */
  reset(): void {
    this.series.clear()
  }

  protected lines(labels: Labels, v: number): string {
    return `${this.name}${fmt(labels)} ${num(v)}\n`
  }
}

interface Hist { buckets: number[]; sum: number; count: number }

export class Histogram extends Metric<Hist> {
  constructor(name: string, help: string, readonly bounds: number[]) {
    super(name, help, 'histogram')
  }

  observe(labels: Labels, v: number): void {
    const s = this.slot(labels, () => ({ buckets: this.bounds.map(() => 0), sum: 0, count: 0 }))
    if (!s || !Number.isFinite(v)) return
    const i = this.bounds.findIndex((b) => v <= b)
    if (i >= 0) s.value.buckets[i]!++
    s.value.sum += v
    s.value.count++
  }

  /** Starts a timer; the returned function observes the elapsed seconds. */
  start(labels: Labels): () => void {
    const t0 = performance.now()
    return () => this.observe(labels, (performance.now() - t0) / 1000)
  }

  count(labels: Labels = {}): number {
    return this.series.get(keyOf(labels))?.value.count ?? 0
  }

  protected lines(labels: Labels, h: Hist): string {
    let out = ''
    let acc = 0
    this.bounds.forEach((b, i) => {
      acc += h.buckets[i]!
      out += `${this.name}_bucket${fmt(labels, ['le', num(b)])} ${acc}\n`
    })
    out += `${this.name}_bucket${fmt(labels, ['le', '+Inf'])} ${h.count}\n`
    out += `${this.name}_sum${fmt(labels)} ${num(h.sum)}\n${this.name}_count${fmt(labels)} ${h.count}\n`
    return out
  }
}

export class Registry {
  private readonly all: Metric<unknown>[] = []

  private add<M extends Metric<any>>(m: M): M {
    if (this.all.some((x) => x.name === m.name)) throw new Error(`duplicate metric ${m.name}`)
    this.all.push(m)
    return m
  }

  counter(name: string, help: string): Counter {
    return this.add(new Counter(name, help, 'counter'))
  }

  gauge(name: string, help: string, type: 'gauge' | 'counter' = 'gauge'): Gauge {
    return this.add(new Gauge(name, help, type))
  }

  histogram(name: string, help: string, bounds: number[]): Histogram {
    return this.add(new Histogram(name, help, [...bounds].sort((a, b) => a - b)))
  }

  render(): string {
    return this.all.map((m) => m.render()).join('')
  }
}

const LATENCY = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]
const PERCENT = [0.1, 0.5, 1, 2, 5, 10, 25, 50]

export const registry = new Registry()
const r = registry

/** Every instrument of the process. Names follow Prometheus conventions (base units, `_total` for counters). */
export const metrics = {
  // HTTP (src/observability.ts onResponse hook). route = Fastify route template, "unmatched" for 404s without one.
  httpRequests: r.counter('alga_http_requests_total', 'HTTP requests by method, route template and status class.'),
  httpDuration: r.histogram('alga_http_request_duration_seconds', 'HTTP request latency by method, route template and status class.', LATENCY),
  rateLimited: r.counter('alga_rate_limited_total', 'Requests refused by a rate limit (route template; "gateway" = socket closed with 4008).'),
  rateLimitEvictions: r.counter('alga_ratelimit_evictions_total', 'Rate-limit keys pushed out of a full in-memory store (5000 keys; route template, "global" = the shared default). Nonzero = limits can leak.'),

  // Gateway (src/gateway/).
  gatewayConnections: r.gauge('alga_gateway_connections', 'Identified gateway sockets.'),
  gatewayUsers: r.gauge('alga_gateway_users_online', 'Users with at least one identified gateway socket.'),
  dispatches: r.counter('alga_gateway_dispatches_total', 'Dispatch fan-outs by event type (one per Hub.dispatch call with at least one recipient online).'),
  framesSent: r.counter('alga_gateway_frames_sent_total', 'Dispatch frames written to sockets by event type (fan-out size).'),
  readyLatency: r.histogram('alga_gateway_ready_seconds', 'From the identify frame to READY sent.', LATENCY),
  gatewayCloses: r.counter('alga_gateway_disconnects_total', 'Closed gateway sockets by close code.'),

  // Voice (src/voice.ts, src/routes/voice.ts).
  voiceRooms: r.gauge('alga_voice_rooms', 'Voice rooms with at least one participant (from LiveKit webhooks).'),
  voiceParticipants: r.gauge('alga_voice_participants', 'Users in voice (from LiveKit webhooks).'),
  voiceTokens: r.counter('alga_voice_tokens_issued_total', 'LiveKit join tokens issued by POST /voice/join (kind: space | private).'),
  voiceJoins: r.counter('alga_voice_joins_total', 'participant_joined handled, by result (joined | channel_full | access_lost | no_channel).'),
  livekitWebhookDuration: r.histogram('alga_livekit_webhook_duration_seconds', 'LiveKit webhook processing time by event.', LATENCY),
  livekitWebhookFailures: r.counter('alga_livekit_webhook_failures_total', 'LiveKit webhooks rejected (signature) or failed (handler).'),

  // Database (src/db/index.ts wraps the driver's query function).
  dbQueryDuration: r.histogram('alga_db_query_duration_seconds', 'Database query time by driver and statement kind.', LATENCY),
  dbQueryErrors: r.counter('alga_db_query_errors_total', 'Database queries that failed, by driver and statement kind.'),

  // E-mail and billing.
  emailsSent: r.counter('alga_email_sent_total', 'E-mails accepted by the provider, by kind.'),
  emailFailures: r.counter('alga_email_failures_total', 'E-mails the provider refused or that errored, by kind.'),
  billingWebhooks: r.counter('alga_billing_webhooks_total', 'Payment webhooks by provider and outcome (applied | duplicate | rejected | unknown_provider | error).'),

  // Call quality (src/telemetry.ts; opt-in reports from the desktop).
  callReports: r.counter('alga_call_quality_reports_total', 'Call-quality reports received, by OS.'),
  callJoin: r.histogram('alga_call_join_seconds', 'Client-measured voice join time.', [0.25, 0.5, 1, 2, 3, 5, 10, 20]),
  callRtt: r.histogram('alga_call_rtt_seconds', 'Average round-trip time to the SFU per session.', [0.01, 0.02, 0.05, 0.1, 0.15, 0.2, 0.3, 0.5, 1]),
  callRttP95: r.histogram('alga_call_rtt_p95_seconds', 'p95 round-trip time to the SFU per session.', [0.01, 0.02, 0.05, 0.1, 0.15, 0.2, 0.3, 0.5, 1]),
  callJitter: r.histogram('alga_call_jitter_seconds', 'Inbound audio jitter per session.', [0.005, 0.01, 0.02, 0.03, 0.05, 0.1, 0.2]),
  callLoss: r.histogram('alga_call_packet_loss_percent', 'Inbound audio packet loss per session (0-100).', PERCENT),
  callConcealment: r.histogram('alga_call_concealment_percent', 'Concealed inbound audio per session (0-100).', PERCENT),
  callReconnects: r.histogram('alga_call_reconnects', 'Successful reconnections per session.', [0, 1, 2, 3, 5, 10]),
  callReconnectFailures: r.counter('alga_call_reconnect_failures_total', 'Sessions that ended because a reconnection gave up.'),
  callDuration: r.histogram('alga_call_session_seconds', 'Voice session length.', [60, 300, 900, 1800, 3600, 7200, 14400]),
  callStreams: r.counter('alga_call_streams_total', 'Sessions with a screen share, by fps and resolution bucket.'),
  callEncoders: r.counter('alga_call_video_encoder_total', 'Sessions publishing video, by codec and hardware encoder (true | false | unknown).'),

  // Process (set at scrape time).
  buildInfo: r.gauge('alga_build_info', 'Always 1; the label carries the server version.'),
  startTime: r.gauge('process_start_time_seconds', 'Process start time (Unix seconds).'),
  cpuSeconds: r.gauge('process_cpu_seconds_total', 'User + system CPU time.', 'counter'),
  rss: r.gauge('process_resident_memory_bytes', 'Resident set size.'),
  heapUsed: r.gauge('nodejs_heap_used_bytes', 'V8 heap in use.'),
  heapTotal: r.gauge('nodejs_heap_total_bytes', 'V8 heap reserved.'),
  external: r.gauge('nodejs_external_memory_bytes', 'Memory of C++ objects bound to JS (Buffers included).'),
  loopLag: r.gauge('nodejs_eventloop_lag_seconds', 'Event-loop delay since the previous scrape (stat: mean | p50 | p99 | max).'),
}
