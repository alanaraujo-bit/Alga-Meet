// Dev-only bench (#media-lab): exercises the whole engine through its public API.
// index.html?url=ws://localhost:7880&token=...&autojoin=1&mic=0#media-lab
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { media, useMedia, type ContentType, type ProcessingMode, type ScreenPresetId, type VideoCodecId } from './index'
import * as lab from './lab'

const q = new URLSearchParams(location.search)
lab.instrument()
Object.assign(window, { __mediaLab: { media, useMedia, ...lab } })

const S: Record<string, CSSProperties> = {
  page: { minHeight: '100vh', background: '#0c0d10', color: '#e6e8ec', font: '13px/1.4 system-ui, sans-serif', padding: 16, display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', alignContent: 'start' },
  card: { background: '#15171c', border: '1px solid #262a33', borderRadius: 8, padding: 12, display: 'grid', gap: 8, alignContent: 'start' },
  h: { margin: 0, fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, color: '#8a909c' },
  row: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  btn: { background: '#2a2f3a', color: '#e6e8ec', border: '1px solid #3a404d', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' },
  mono: { fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 11, color: '#b8bdc8', whiteSpace: 'pre-wrap', wordBreak: 'break-all' },
}

const Card = ({ title, children, wide }: { title: string; children: ReactNode; wide?: boolean }) => (
  <section style={{ ...S.card, ...(wide ? { gridColumn: '1 / -1' } : {}) }}>
    <h2 style={S.h}>{title}</h2>
    {children}
  </section>
)

function Meter({ level, mark, on }: { level: number; mark?: number; on?: boolean }) {
  return (
    <div style={{ position: 'relative', height: 8, background: '#262a33', borderRadius: 4, overflow: 'hidden', flex: 1, minWidth: 120 }}>
      <div style={{ width: `${Math.round(level * 100)}%`, height: '100%', background: on ? '#3ecf8e' : '#5b6170', transition: 'width 60ms linear' }} />
      {mark !== undefined && <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${mark * 100}%`, width: 2, background: '#f5a524' }} />}
    </div>
  )
}

const fmt = (o: unknown) => JSON.stringify(o, (_k, v) => (typeof v === 'number' ? Math.round(v * 10) / 10 : v), 1)

export function MediaLab() {
  const s = useMedia()
  const [sources, setSources] = useState<Array<{ id: string; name: string }>>([])
  const [sourceId, setSourceId] = useState<string>('')
  const [shareAudio, setShareAudio] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const url = q.get('url') ?? 'ws://localhost:7880'
  const token = q.get('token') ?? ''

  const run = (f: () => Promise<unknown> | unknown) => () => {
    setErr(null)
    Promise.resolve()
      .then(f)
      .catch((e: unknown) => setErr(String(e)))
  }
  const join = run(() => media.join({ url, token, bitrateKbps: Number(q.get('kbps') ?? 64), channelId: 'lab', publishMic: q.get('mic') !== '0' }))

  useEffect(() => {
    void media.refreshDevices(false)
    if (q.get('autojoin') === '1' && token) join()
    void media.getScreenSources().then((l) => setSources(l.map((x) => ({ id: x.id, name: `${x.kind}: ${x.name}` }))))
  }, [])

  const offered = s.screen.offered.length ? s.screen.offered : []
  const statePill = { connected: '#3ecf8e', connecting: '#f5a524', reconnecting: '#f5a524', disconnected: '#f04f5f', idle: '#5b6170' }[s.connection.state]

  return (
    <div style={S.page} data-testid="media-lab">
      <Card title="Conexão" wide>
        <div style={S.row}>
          <span data-testid="conn-state" style={{ color: statePill, fontWeight: 600 }}>{s.connection.state}</span>
          {s.connection.reason && <span style={{ color: '#f5a524' }}>{s.connection.reason}</span>}
          <span>join: {s.connection.joinMs ?? '–'} ms</span>
          <span>reconexões: {s.connection.reconnects} (última {s.connection.lastReconnectMs ?? '–'} ms)</span>
          <span>perfil: {window.alga?.config?.profile}</span>
          <span style={{ flex: 1 }} />
          <button style={S.btn} onClick={join}>Entrar</button>
          <button style={S.btn} onClick={run(() => media.leave())}>Sair</button>
        </div>
        {(err || s.notice) && <div style={{ color: '#f5a524' }}>{err ?? s.notice?.text}</div>}
      </Card>

      <Card title="Você">
        <div style={S.row}>
          <button style={S.btn} onClick={run(() => media.toggleMute())}>{s.self.muted ? 'Desmutar' : 'Mutar'}</button>
          <button style={S.btn} onClick={run(() => media.toggleDeafen())}>{s.self.deafened ? 'Ensurdecer: ON' : 'Ensurdecer'}</button>
          <span style={{ color: s.self.speaking ? '#3ecf8e' : '#5b6170' }}>● {s.self.speaking ? 'falando' : 'silêncio'}</span>
        </div>
        <div style={S.row}>
          <Meter level={s.self.level} mark={(s.self.thresholdDb + 60) / 60} on={s.self.gateOpen} />
          <span style={S.mono}>{Math.round(s.self.levelDb)} dB / limiar {Math.round(s.self.thresholdDb)} dB</span>
        </div>
        <div style={S.row}>
          Processamento
          <select value={s.self.processing} onChange={(e) => run(() => media.setProcessing(e.target.value as ProcessingMode))()}>
            <option value="standard">Padrão</option>
            <option value="advanced">Supressão avançada</option>
            <option value="off">Desligado</option>
          </select>
          <span style={S.mono}>ativo: {s.self.processingActive}</span>
        </div>
        <div style={S.row}>
          Entrada
          <select value={s.self.inputMode} onChange={(e) => media.setInputMode(e.target.value as 'vad' | 'ptt')}>
            <option value="vad">Detecção de voz</option>
            <option value="ptt">Push-to-talk</option>
          </select>
          <button style={S.btn} onPointerDown={() => media.pttDown()} onPointerUp={() => media.pttUp()} onPointerLeave={() => s.self.pttPressed && media.pttUp()}>
            Segurar p/ falar
          </button>
          <span>PTT: {s.self.pttPressed ? 'aberto' : 'fechado'}</span>
        </div>
        <div style={S.row}>
          <label>
            <input type="checkbox" checked={s.self.sensitivityDb === null} onChange={(e) => media.setSensitivity(e.target.checked ? null : -50)} /> auto
          </label>
          <input type="range" min={-100} max={0} disabled={s.self.sensitivityDb === null} value={s.self.sensitivityDb ?? Math.round(s.self.thresholdDb)} onChange={(e) => media.setSensitivity(Number(e.target.value))} />
          <span>{s.self.sensitivityDb ?? 'auto'} dB</span>
        </div>
        <div style={S.row}>
          Teste de mic
          <button style={S.btn} onClick={run(() => (s.micTest.active ? media.stopMicTest() : media.startMicTest({ loopback: false })))}>{s.micTest.active ? 'Parar' : 'Medidor'}</button>
          <button style={S.btn} onClick={run(() => media.startMicTest({ loopback: true }))}>Ouvir-me</button>
        </div>
        {s.local && <div style={S.mono}>envio: {fmt(s.local)}</div>}
      </Card>

      <Card title="Dispositivos">
        <div style={S.row}>
          Entrada
          <select value={s.devices.inputId ?? ''} onChange={(e) => run(() => media.setInputDevice(e.target.value || null))()}>
            <option value="">Padrão do sistema</option>
            {s.devices.inputs.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label}</option>)}
          </select>
        </div>
        <div style={S.row}>
          Saída
          <select value={s.devices.outputId ?? ''} onChange={(e) => run(() => media.setOutputDevice(e.target.value || null))()}>
            <option value="">Padrão do sistema</option>
            {s.devices.outputs.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label}</option>)}
          </select>
        </div>
      </Card>

      <Card title={`Participantes (${Object.keys(s.participants).length})`}>
        {Object.values(s.participants).map((p) => (
          <div key={p.identity} style={{ display: 'grid', gap: 4, borderTop: '1px solid #262a33', paddingTop: 6 }} data-testid={`participant-${p.identity}`}>
            <div style={S.row}>
              <span style={{ color: p.speaking ? '#3ecf8e' : '#e6e8ec', fontWeight: 600 }}>{p.name}</span>
              {p.micMuted && <span>🔇</span>}
              {p.streaming && <span style={{ color: '#f04f5f' }}>AO VIVO</span>}
              <span style={S.mono}>{p.quality}</span>
              <Meter level={p.level} on={p.speaking} />
            </div>
            <div style={S.row}>
              <input type="range" min={0} max={200} value={Math.round(p.volume * 100)} onChange={(e) => media.setVolume(p.identity, Number(e.target.value) / 100)} />
              <span>{Math.round(p.volume * 100)}%</span>
              <label>
                <input type="checkbox" checked={p.locallyMuted} onChange={(e) => media.setLocalMute(p.identity, e.target.checked)} /> mutar p/ mim
              </label>
            </div>
            {p.audio && <div style={S.mono}>{fmt(p.audio)}</div>}
          </div>
        ))}
      </Card>

      <Card title="Transmitir tela">
        <div style={S.row}>
          Fonte
          <select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
            <option value="">Automática (getDisplayMedia)</option>
            {sources.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
          <label>
            <input type="checkbox" checked={shareAudio} onChange={(e) => setShareAudio(e.target.checked)} /> áudio do sistema
          </label>
        </div>
        <div style={S.row}>
          <select value={s.screen.preset} onChange={(e) => media.setScreenDefaults({ quality: e.target.value as ScreenPresetId })}>
            {offered.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          <select value={s.screen.contentType} onChange={(e) => media.setScreenDefaults({ contentType: e.target.value as ContentType })}>
            <option value="motion">Movimento (jogos/vídeo)</option>
            <option value="detail">Detalhe (texto/código)</option>
          </select>
          <select value={s.screen.codecAuto ? '' : s.screen.codec} onChange={(e) => media.setScreenDefaults({ codec: (e.target.value || null) as VideoCodecId | null })}>
            <option value="">auto ({s.screen.codec})</option>
            {(['h264', 'h265', 'vp8', 'vp9', 'av1'] as const).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <span style={S.mono}>HW enc: {String(s.screen.hardwareEncoder)}</span>
        </div>
        <div style={S.row}>
          <button style={S.btn} onClick={run(() => media.startScreenShare({ sourceId: sourceId || null, audio: shareAudio }))}>Iniciar</button>
          <button style={S.btn} disabled={!s.screen.active || !sourceId} onClick={run(() => media.switchScreenSource(sourceId))}>Trocar fonte</button>
          <button style={S.btn} onClick={run(() => media.stopScreenShare())}>Parar</button>
          <span data-testid="share-state">{s.screen.active ? `transmitindo ${s.screen.preset} ${s.screen.codec}` : 'parado'}</span>
        </div>
        {s.screen.error && <div style={{ color: '#f04f5f' }}>{s.screen.error}</div>}
        {s.screen.stats && <div style={S.mono} data-testid="share-stats">{fmt(s.screen.stats)}</div>}
      </Card>

      <Card title="Assistir" wide>
        {Object.values(s.participants)
          .filter((p) => p.streaming)
          .map((p) => <Viewer key={p.identity} identity={p.identity} name={p.name} />)}
      </Card>
    </div>
  )
}

function Viewer({ identity, name }: { identity: string; name: string }) {
  const v = useMedia((s) => s.viewers[identity])
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => (v?.subscribed && ref.current ? media.attachScreen(identity, ref.current) : undefined), [identity, v?.subscribed])
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <div style={S.row}>
        <strong>{name}</strong>
        {v ? <button style={S.btn} onClick={() => media.unwatch(identity)}>Parar de assistir</button> : <button style={S.btn} data-testid={`watch-${identity}`} onClick={() => media.watch(identity, 'source')}>Assistir</button>}
        {v && (
          <>
            <select value={v.quality} onChange={(e) => void media.setStreamQuality(identity, e.target.value as 'auto' | 'source')}>
              <option value="auto">Automática</option>
              <option value="source">Original</option>
            </select>
            áudio da live
            <input type="range" min={0} max={200} value={Math.round(v.volume * 100)} onChange={(e) => media.setStreamVolume(identity, Number(e.target.value) / 100)} />
          </>
        )}
      </div>
      {v && (
        <div style={{ position: 'relative', width: 'min(100%, 1280px)', aspectRatio: '16 / 9', background: '#000' }}>
          <video ref={ref} data-testid={`video-${identity}`} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          {v.stats && <div style={{ ...S.mono, position: 'absolute', top: 6, left: 6, background: '#000a', padding: 6, borderRadius: 4 }}>{fmt(v.stats)}</div>}
        </div>
      )}
    </div>
  )
}
