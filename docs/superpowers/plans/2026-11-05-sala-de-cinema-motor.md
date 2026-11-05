# Sala de Cinema — Plano 1: spike + motor

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uma pessoa na chamada escolhe um arquivo de vídeo local; os amigos sentados recebem o filme P2P em qualidade nativa e assistem no mesmo frame, com controle compartilhado — funcionando de ponta a ponta atrás de uma flag, com UI crua. A experiência visual (foyer, poltronas, luzes, canhoto…) é o **Plano 2**, escrito depois deste motor existir.

**Architecture:** O servidor guarda a sessão em memória por chamada (como `Voice.states`) e fala com os clientes por novos ops `cinema_*` no gateway, com cota própria (como `e2ee_*`). O PC de quem projeta roda ffmpeg (LGPL, empacotado) no processo main: copia o vídeo e converte só o áudio incompatível em segmentos fMP4 por faixa, com hash. Os renderers formam uma malha WebRTC (data channels binários) e trocam peças como um enxame; cada um toca com MSE e se mantém sincronizado pelo relógio do servidor medido com `requestVideoFrameCallback`.

**Tech Stack:** Fastify + zod + ws (servidor); Electron 45 / Chromium 156, React + zustand, MSE, WebRTC, WebAudio, OPFS (desktop); ffmpeg/ffprobe LGPL (BtbN); `jassub` (única dependência nova); coturn no servidor de casa; vitest; Playwright dirigindo instâncias reais (padrão `apps/desktop/scripts/media-lab.mjs`).

**Spec:** `docs/superpowers/specs/2026-11-05-sala-de-cinema-design.md` — ler inteiro antes de qualquer tarefa. As seções citadas abaixo (§) são dele.

## Global Constraints

- Trabalhar no worktree `D:\PROJETOS\alga-cinema`, branch `feat/sala-de-cinema` a partir de `main`. Mudanças em arquivos compartilhados (`packages/shared/src/gateway.ts`, `index.ts`, `apps/server/src/gateway/socket.ts`, `app.ts`, `config.ts`, `voice.ts`, `apps/desktop/src/shared/*`, `preload`) só aditivas. **Não** tocar `features/billing/**`, `apps/server/src/billing/**`, `packages/shared/src/billing.ts` (o benefício "cinema" da Casa fica como está, §6.2).
- **LiveKit continua com `canPublishData: false`.** O cinema usa `RTCPeerConnection` próprias; o protocolo P2P só aceita mensagens binárias tipadas (nunca texto livre).
- **Caminho local do arquivo nunca sai do main.** Servidor e pares só veem `CinemaFilm` (título editável, metadados técnicos).
- **ffmpeg:** só build **LGPL** (nunca GPL, nunca `nonfree`); fora do asar (`extraResources`); mesmo status de assinatura do app; ≤ **+40 MB** no instalador; roda só no main, argumentos em array, `windowsHide`, prioridade abaixo do normal, timeout.
- Constantes (copiar exatamente, vivem em `packages/shared/src/cinema.ts`): `CINEMA_MAX_SEATS = 8`, `CINEMA_LEAD_MS = 250`, `CINEMA_HOST_AWAY_MS = 120_000`, `CINEMA_STALL_MS = 2_000`, `CINEMA_RESUME_AHEAD_S = 10`, `CINEMA_SEEK_READY_S = 3`, `CINEMA_READY_TIMEOUT_MS = 10_000`, `CINEMA_COUNTDOWN_AFTER_PAUSE_MS = 15_000`, `CINEMA_COUNTDOWN_MS = 3_000`, `CINEMA_STATUS_INTERVAL_MS = 2_000`, `CINEMA_FRAME_LIMIT = 300` (por 60 s por socket, cota própria), frame ≤ 16 KiB, `CINEMA_ITEMS_PER_FRAME = 200`, reações `['😂', '😱', '😍', '😭', '🔥', '👏']` com limite 1/s e rajada 5, `CINEMA_TURN_TTL_S = 21_600`.
- Sincronia (§6.6): relógio NTP com 8–16 amostras, usa a de menor ida e volta; 1 ping/s nas primeiras 8, depois a cada 15 s. Erro = mediana dos últimos 10 frames (rVFC `mediaTime` vs. esperado no `expectedDisplayTime`). `< 20 ms` nada; `20–500 ms` `playbackRate = 1 ± min(|erro|/3000 ms, 0.05)` com `preservesPitch`; `> 500 ms` ou sem convergir em 5 s → seek para o alvo + latência de seek aprendida.
- Enxame (§6.4): pedaços de 64–224 KiB; `bufferedAmount` alto 256 KiB / baixo 128 KiB; janela crítica 30 s em ordem da fonte mais rápida; depois mais rara primeiro; quem projeta faz super-seed.
- Buffer (§6.5): `SourceBuffer` ~60 s à frente; cache do enxame em OPFS, meta ≥ 10 min à frente a 40 Mbps; cinema ≤ 1,5 GB de RAM.
- Áudio (§6.7): ducking −10 dB, ataque 150 ms, soltura 700 ms, ligado por padrão.
- Disco de quem projeta: orçamento = menor entre tamanho do arquivo e 20% do livre; pasta temporária apagada no fim e no início do app.
- Relay: coturn no `home-server`, **teto 30 Mbps somando tudo** (§6.4).
- Defaults: `controlLock = false`, `waitForStalled = true`.
- Texto de UI em pt-BR em `features/cinema/strings.ts`; comentários de código em inglês.
- Comandos: `npm test -w packages/shared`, `npm test -w apps/server`, `npm test -w apps/desktop`, `npm run typecheck`.

## Review Focus

1. **Arquivo estranho ou hostil** (sem vídeo, duração 0, 40 faixas de áudio, título com HTML/RTL/controle, codec desconhecido, MKV truncado no meio) → ficha recusa com mensagem humana ou abre só até onde o arquivo vai; o main nunca derruba o app. Testes na Task 7 e Task 8.
2. **Par que cai no meio de uma peça ou manda bytes errados** → pedaço parcial descartado, peça pedida de outra fonte; hash errado tira aquele par como fonte daquela peça e é logado. Testes na Task 10.
3. **Quem projeta sai da call ou fecha o app** → todos pausam com `host_away`; volta em < 2 min retoma; depois disso a sessão termina com resumo. Teste na Task 3.
4. **Gateway reconecta no meio do filme** (novo `READY`) → `cinema_hello` devolve o estado; o cliente volta a sentar sem perder posição nem cache. Teste na Task 3 (servidor) e Task 14 (cliente).
5. **Dois amigos apertam pausa/pular ao mesmo tempo** → vence o primeiro que o servidor aplicou (`seq`); o outro recebe `stale` + estado atual; ninguém fica fora do frame da sala. Teste na Task 3.

---

### Task 1: Spike descartável (medir antes de construir)

Responde às 5 perguntas de §9 com números. Nada daqui vai para o app; o resultado é um documento e, no máximo, scripts de medição reaproveitáveis.

**Files:**
- Create: `apps/desktop/scripts/cinema-fixtures.mjs` (gera fixtures de 20 s com o ffmpeg **do PATH**, GPL tudo bem: ferramenta de dev, nada é distribuído) em `apps/desktop/test-fixtures/cinema/` (gitignored)
- Create: `apps/desktop/scripts/cinema-spike.mjs` (Playwright + Electron, padrão de `media-lab.mjs`)
- Create: `docs/benchmarks/cinema-spike.md`
- Modify: `.gitignore` (adicionar `apps/desktop/test-fixtures/cinema/` e `apps/desktop/build/ffmpeg/`)

- [ ] **Step 1: Fixtures.** `cinema-fixtures.mjs` gera, a partir de `testsrc2` + `sine` multicanal: `h264-ac3-51.mkv`, `hevc10-hdr10-eac3-51.mkv` (x265 Main10 com metadados HDR10), `hevc10-truehd-71.mkv`, `av1-opus-51.mkv`, `h264-dts-51.mkv`, `h264-aac-srt-ass.mkv` (com faixas SRT e ASS e uma fonte anexada), `mpeg2-mp2.mkv` (não suportado), `dv-p5.mp4` se o ffmpeg local conseguir marcar perfil 5 (senão, registrar como "não testado"). Run: `node apps/desktop/scripts/cinema-fixtures.mjs` → 7–8 arquivos.
- [ ] **Step 2: Baixar o ffmpeg LGPL do BtbN** (último release `ffmpeg-n*-latest-win64-lgpl-*.zip`) para o scratchpad; anotar URL, versão, SHA-256 e tamanho (zip e `ffmpeg.exe`+`ffprobe.exe` descompactados).
- [ ] **Step 3: Matriz MSE no Electron 45.** O spike abre uma janela do Electron e, para cada fixture remuxado (vídeo copiado; áudio convertido para AAC 5.1 640k, Opus 5.1 e FLAC 5.1/7.1), registra `MediaSource.isTypeSupported` **e** reprodução real (10 s tocando, `getVideoPlaybackQuality`, áudio com nível > −60 dBFS em cada canal via `AnalyserNode` por `ChannelSplitter`). Saída: tabela codec × suportado × toca.
- [ ] **Step 4: Velocidade do ffmpeg LGPL.** Para cada fixture e para **um filme real do dono** (pedir o caminho de um 1080p e de um 4K; medir sem copiar o arquivo para lugar nenhum): tempo para listar keyframes (`ffprobe -select_streams v:0 -show_entries packet=pts_time,flags -of csv`), tempo do remux de vídeo (`-c:v copy`, HLS fmp4, `-hls_time 4`) e da conversão de áudio, em × tempo real.
- [ ] **Step 5: Data channel.** Duas instâncias na mesma máquina e, com o dono, entre duas casas: Mbps sustentado com 1 e 2 `RTCPeerConnection` por par, pedaços de 224 KiB, controle por `bufferedAmountLowThreshold`. Registrar se a conexão direta funcionou ou precisaria de relay.
- [ ] **Step 6: Relógio pelo gateway.** Script com 2 clientes contra o staging fazendo pings (o op ainda não existe: usar `heartbeat`/`heartbeat_ack` com marcação de tempo local para estimar RTT; o offset real fica para a Task 12). Registrar RTT mínimo, mediana e p95.
- [ ] **Step 7: Eco.** Com o dono, caixa de som ligada: instância A toca uma fixture num `<video>` passando por WebAudio enquanto está numa call LiveKit com B; medir o nível do áudio do filme que chega em B (antes/depois do APM). Repetir roteando o áudio do filme por `MediaStreamAudioDestinationNode` → `<audio>`. Registrar atenuação em dB de cada caminho.
- [ ] **Step 8: Escrever `docs/benchmarks/cinema-spike.md`** com as tabelas e, no topo, as decisões que elas fixam:
  - Áudio sem perda → `flac` se o Step 3 aprovou FLAC multicanal, senão `aac` 640k.
  - Áudio com perda → `aac` (ou `opus` se só ele passar com 5.1).
  - Relógio: só gateway (se p95 do RTT ≤ 80 ms) ou gateway + refinamento P2P.
  - Eco: caminho escolhido, ou "sem solução no Chromium → aviso de fone" [dono].
  - URL/versão/SHA-256 do ffmpeg que a Task 6 fixa.
- [ ] **Step 9: Commit**

```bash
git add .gitignore apps/desktop/scripts/cinema-fixtures.mjs apps/desktop/scripts/cinema-spike.mjs docs/benchmarks/cinema-spike.md
git commit -m "docs(cinema): spike — codecs, ffmpeg LGPL, data channel, clock, echo"
```

---

### Task 2: Protocolo compartilhado

**Files:**
- Create: `packages/shared/src/cinema.ts`
- Create: `packages/shared/src/cinema.test.ts`
- Modify: `packages/shared/src/gateway.ts` (somar `CinemaClientFrame` em `ClientFrame` e os dispatches `CINEMA_*` em `Dispatch`, com comentário de protocolo no padrão do arquivo)
- Modify: `packages/shared/src/index.ts` (`export * from './cinema.js'`)

**Interfaces:**
- Produces (usado por Tasks 3–4 e 7–14):

```ts
export type CinemaReaction = (typeof CINEMA_REACTIONS)[number]
export type CinemaTrackId = 'v' | `a${number}` | `s${number}` | 'poster' | 'thumbs'
export interface CinemaAudioTrack { id: number; lang: string | null; title: string | null; sourceCodec: string; channels: number; out: 'copy' | 'aac' | 'opus' | 'flac'; mime: string; default: boolean }
export interface CinemaSubtitleTrack { id: number; lang: string | null; title: string | null; format: 'vtt' | 'ass'; external: boolean }
export interface CinemaFilm {
  title: string; durationS: number; width: number; height: number
  hdr: 'sdr' | 'hdr10' | 'hlg' | 'dv8'
  videoCodec: 'h264' | 'hevc' | 'av1' | 'vp9'; videoMime: string; bitrateKbps: number
  audio: CinemaAudioTrack[]; subtitles: CinemaSubtitleTrack[]
  chapters: { startS: number; title: string }[]
  episode: { season: number; episode: number } | null
}
/** [startS, durS, bytes, sha256 hex] of piece n of a track. */
export type CinemaPieceMeta = [number, number, number, string]
export interface CinemaPlayback {
  playing: boolean; position: number; at: number; seq: number; by: string | null
  reason: 'foyer' | 'user' | 'buffering' | 'waiting' | 'host_away'
  waitingFor: string[]; countdown: boolean
}
export interface CinemaSeat { userId: string; status: 'preparing' | 'ready' | 'stalled' | 'unsupported'; aheadS: number; direct: boolean }
export interface CinemaIceServer { urls: string[]; username?: string; credential?: string }
export interface CinemaSessionView {
  sessionId: string; channelId: string; hostId: string; film: CinemaFilm
  playback: CinemaPlayback; seats: CinemaSeat[]
  options: { controlLock: boolean; waitForStalled: boolean }
  iceServers: CinemaIceServer[]; createdAt: number
}
export interface CinemaSummary { watchedS: number; seats: string[]; reactions: number; peak: { position: number; count: number } | null }
export type CinemaEndReason = 'host_ended' | 'host_left' | 'moderator' | 'call_empty' | 'channel_gone'
export type CinemaErrorReason = 'disabled' | 'not_in_call' | 'forbidden' | 'exists' | 'full' | 'not_found' | 'locked' | 'stale' | 'not_seated' | 'invalid'
export type CinemaSignal =
  | { kind: 'offer' | 'answer'; sdp: string; tag?: string; epoch?: number }
  | { kind: 'ice'; candidates: string[] }
export type CinemaClientFrame =
  | { op: 'cinema_time'; c: number }
  | { op: 'cinema_hello' }
  | { op: 'cinema_open'; channelId: string; film: CinemaFilm; startS: number }
  | { op: 'cinema_pieces'; sessionId: string; track: CinemaTrackId; from: number; items: CinemaPieceMeta[] }
  | { op: 'cinema_film'; sessionId: string; title?: string; addSubtitle?: CinemaSubtitleTrack }
  | { op: 'cinema_seat'; sessionId: string; seated: boolean }
  | { op: 'cinema_status'; sessionId: string; status: CinemaSeat['status']; aheadS: number }
  | { op: 'cinema_control'; sessionId: string; action: 'start' | 'play' | 'pause' | 'seek' | 'continue_without'; position?: number; target?: string; seq: number }
  | { op: 'cinema_options'; sessionId: string; controlLock?: boolean; waitForStalled?: boolean }
  | { op: 'cinema_signal'; sessionId: string; to: string; signal: CinemaSignal }
  | { op: 'cinema_react'; sessionId: string; emoji: CinemaReaction }
  | { op: 'cinema_end'; sessionId: string }
// Dispatch additions:
//  CINEMA_STATE    d: CinemaSessionView | { channelId: string; sessionId: string; ended: true; reason: CinemaEndReason; summary: CinemaSummary }
//  CINEMA_PIECES   d: { sessionId: string; track: CinemaTrackId; from: number; items: CinemaPieceMeta[] }
//  CINEMA_SIGNAL   d: { sessionId: string; from: string; signal: CinemaSignal }
//  CINEMA_REACTION d: { sessionId: string; userId: string; emoji: CinemaReaction; position: number; at: number }
//  CINEMA_PONG     d: { c: number; s: number }
//  CINEMA_ERROR    d: { op: string; reason: CinemaErrorReason; sessionId?: string }
export const CinemaClientFrameSchema  // z.discriminatedUnion('op', [...]), same pattern as E2eeClientFrameSchema
export function positionAt(p: CinemaPlayback, serverNow: number, durationS: number): number
```

- [ ] **Step 1: Escrever os testes que falham** em `cinema.test.ts`:
  - `positionAt` tocando: `positionAt({playing:true, position:100, at:1_000, …}, 3_500, 7200)` → `102.5`; antes de `at` (comando agendado) → `100`; pausado → `position`; nunca passa de `durationS` nem fica abaixo de 0.
  - `CinemaClientFrameSchema` aceita um frame de cada op; recusa: `title` vazio ou > 120, `startS` negativo, `items` com > 200 entradas, sha256 que não é 64 hex, `CinemaTrackId` fora do padrão (`a-1`, `x`), `emoji` fora da lista, `candidates` com > 20, `sdp` > 12 000 caracteres, `position` NaN/Infinity.
- [ ] **Step 2: Rodar e ver falhar.** Run: `npm test -w packages/shared` → FAIL (módulo não existe).
- [ ] **Step 3: Implementar `cinema.ts`** (tipos acima, constantes da seção Global Constraints, `CinemaClientFrameSchema` com `z.discriminatedUnion`, `positionAt`) e somar ao `gateway.ts`/`index.ts`.
- [ ] **Step 4: Rodar.** `npm test -w packages/shared` → PASS; `npm run typecheck` → limpo.
- [ ] **Step 5: Commit** — `git commit -m "feat(shared): cinema gateway protocol"`

---

### Task 3: Servidor — sessão, poltronas, relógio, comandos e espera

**Files:**
- Create: `apps/server/src/cinema.ts` (classe `Cinema`)
- Create: `apps/server/test/cinema.test.ts`
- Modify: `apps/server/src/gateway/socket.ts` (schema inclui `...CinemaClientFrameSchema.options`; cota própria `CINEMA_FRAME_LIMIT` para ops que começam com `cinema_`, como já é feito para `e2ee_`; switch chama `ctx.cinema.handle(conn, frame)`; no `close` do socket chamar `ctx.cinema.socketClosed(conn)`)
- Modify: `apps/server/src/app.ts` (criar `Cinema` depois do `E2ee`, pôr em `Ctx`, `stop()` no shutdown)
- Modify: `apps/server/src/config.ts` (`CINEMA: bool` → `config.cinema.enabled`; ligado por padrão fora de produção)

**Interfaces:**
- Consumes: Task 2 inteira; `Voice.stateOf/inChannel`, `voice.onLeave` (encadear: `const prev = voice.onLeave; voice.onLeave = (u, c) => { prev(u, c); this.left(u, c) }`), `Hub.dispatch`, `loadChannel`, `memberPermissions`, `PRIVATE_CHANNEL_PERMISSIONS`.
- Produces: `class Cinema { constructor(config: Config, db: Db, hub: Hub, voice: Voice, log: FastifyBaseLogger); handle(conn: Conn, frame: CinemaClientFrame): Promise<void>; socketClosed(conn: Conn): void; left(userId: string, channelId: string): void; sessionOf(channelId: string): CinemaSessionView | undefined; stop(): void }`. Cada poltrona guarda o `Conn` que sentou: dispatches só da sessão (`CINEMA_PIECES`, `CINEMA_SIGNAL`, `CINEMA_REACTION`, `CINEMA_PONG`, `CINEMA_ERROR`) vão por `conn.send` só a esse socket; `CINEMA_STATE` vai a todos na chamada.

**Regras desta task** (§6.2, §6.6):
- `cinema_time` → `CINEMA_PONG { c, s: Date.now() }` no mesmo socket, sem tocar no banco.
- `cinema_hello` → `CINEMA_STATE` da chamada atual do usuário, se houver; se ele estava sentado, o socket novo vira o da poltrona.
- `cinema_open`: flag ligada; estar na chamada `channelId`; em espaço precisa `STREAM`; uma sessão por chamada (`exists`). Quem abre senta. `playback = { playing:false, position:startS, reason:'foyer', seq:0, … }`.
- `cinema_seat`: estar na chamada; ≤ 8 (`full`).
- `cinema_control`: precisa estar sentado; `controlLock` ligado → só quem projeta (`locked`); `seq` menor que o atual → `stale` + `CINEMA_STATE` só para ele. Cada comando aplicado incrementa `seq`, grava `by`.
  - `start` (só quem projeta) e `seek`: `playing:false, reason:'buffering'`, posição alvo; quando todos os sentados (fora `unsupported`) mandarem `ready`, ou depois de `CINEMA_READY_TIMEOUT_MS`, vira `playing:true, at: now + CINEMA_LEAD_MS`.
  - `play`: `at = now + LEAD`; se estava pausado havia > `CINEMA_COUNTDOWN_AFTER_PAUSE_MS`, `countdown:true` e `at = now + CINEMA_COUNTDOWN_MS`.
  - `pause`: `at = now + LEAD`, `position = positionAt(p, at, film.durationS)` — todos param nesse ponto exato.
  - `continue_without`: tira `target` de `waitingFor` e retoma.
- `cinema_status` (no máximo 1 a cada `CINEMA_STATUS_INTERVAL_MS` por poltrona; mais rápido é ignorado): `stalled` tocando com `waitForStalled` → pausa (`reason:'waiting'`, `waitingFor` += ele). Quem saiu de `waitingFor` por timeout ou `continue_without` não volta a pausar a sala até mandar um `ready`. `ready` de quem está em `waitingFor` → sai da lista; lista vazia → `play` com `countdown:true`.
- Quem projeta sai da call (`left`) ou perde todos os sockets → `reason:'host_away'` (pausa); volta (`cinema_hello`/`cinema_seat`) em < `CINEMA_HOST_AWAY_MS` → `reason:'user'`, pausado. Estourou → fim `host_left`.
- Poltrona sai da call → levanta. Ninguém mais na call → fim `call_empty`.

- [ ] **Step 1: Escrever os testes que falham** (padrão de `soundboard.test.ts`: `register`, espaço, `postWebhook participant_joined`, `connect`):
  - `cinema_time` responde `CINEMA_PONG` com o `c` enviado e `s` entre o envio e o recebimento.
  - abrir sem estar na chamada → `CINEMA_ERROR not_in_call`; sem `STREAM` num espaço → `forbidden`; segunda sessão → `exists`; flag desligada (`startServer({ CINEMA: 'false' })`) → `disabled`.
  - abrir → todos na chamada recebem `CINEMA_STATE` com `reason:'foyer'`, host sentado; quem não está na chamada não recebe.
  - nona poltrona → `full`.
  - `start` → `buffering`; os dois mandam `ready` → `playing:true` e `at - Date.now()` entre 0 e `CINEMA_LEAD_MS + 50`.
  - `start` com um que nunca fica pronto → toca depois de ~10 s (`vi.useFakeTimers` ou constante injetável no construtor).
  - **(Review Focus 5)** dois `pause` com o mesmo `seq` → o primeiro aplica, o segundo recebe `stale` e o estado atual; `seq` final = anterior + 1.
  - `pause` → `position` igual a `positionAt` no `at` calculado (±1 ms).
  - `play` depois de 16 s pausado → `countdown:true`, `at ≈ now + 3000`.
  - `stalled` tocando → `waiting` com `waitingFor:[b]`; `ready` de b → volta a tocar com `countdown:true`; com `waitForStalled:false` o `stalled` não pausa.
  - `continue_without b` → toca; um novo `stalled` de b (sem `ready` antes) não pausa.
  - `controlLock` → `pause` de b → `locked`.
  - **(Review Focus 3)** host sai da call → `host_away`; volta em 1 s → `user`; não volta em `CINEMA_HOST_AWAY_MS` (constante injetável) → `CINEMA_STATE ended:true, reason:'host_left'`.
  - **(Review Focus 4)** socket de b fecha e outro socket de b manda `cinema_hello` → recebe o estado e continua sentado; dispatches de sessão passam a ir só para o socket novo.
  - 301 frames `cinema_time` em 60 s fecham o socket com `RATE_LIMITED`; os 120 frames normais continuam valendo separados.
- [ ] **Step 2: Rodar e ver falhar.** `npm test -w apps/server -- cinema` → FAIL.
- [ ] **Step 3: Implementar** `Cinema` e as mudanças em `socket.ts`/`app.ts`/`config.ts`. Timers por sessão (`setTimeout`) limpos em `stop()` e no fim da sessão.
- [ ] **Step 4: Rodar.** `npm test -w apps/server` → PASS (todos, incluindo `e2ee.test.ts` e `voice.test.ts` intactos); `npm run typecheck`.
- [ ] **Step 5: Commit** — `git commit -m "feat(server): cinema sessions, seats, clock and scheduled playback"`

---

### Task 4: Servidor — sinalização, peças, reações, TURN, moderação e resumo

**Files:**
- Modify: `apps/server/src/cinema.ts`
- Modify: `apps/server/test/cinema.test.ts`
- Modify: `apps/server/src/config.ts` (`CINEMA_STUN_URLS`, `CINEMA_TURN_URLS` — listas separadas por vírgula —, `CINEMA_TURN_SECRET`)
- Modify: `apps/server/src/metrics.ts` (`cinemaSessions` counter por resultado de abertura, `cinemaSeats` gauge, `cinemaEnded` por `reason`)

**Interfaces:**
- Consumes: Task 3; `blockedWith` de `apps/server/src/access.ts`.
- Produces: `CinemaSeat.direct` calculado por destinatário (`false` quando quem recebe e aquela poltrona se bloquearam); `iceServers` por destinatário sentado: STUN + TURN com credencial temporária no padrão TURN REST: `username = \`${expiraEmUnix}:${userId}\``, `credential = base64(HMAC-SHA1(CINEMA_TURN_SECRET, username))`, validade `CINEMA_TURN_TTL_S`. Sem `CINEMA_TURN_SECRET`: só STUN.

**Regras:**
- `cinema_signal`: remetente e `to` sentados na mesma sessão e sem bloqueio entre eles (senão `forbidden`); entrega `CINEMA_SIGNAL { from }` só ao socket da poltrona de `to`.
- `cinema_pieces`: só quem projeta; `from` contíguo com o que já existe na faixa (senão `invalid`); guarda em memória e repassa a todos os sentados menos ele. Quem senta depois recebe tudo o que existe, em frames de até `CINEMA_ITEMS_PER_FRAME` itens, antes do primeiro `CINEMA_STATE` de sentado.
- `cinema_film`: só quem projeta; título limpo (trim, sem caracteres de controle, 1–120); `addSubtitle` acrescenta faixa com `external:true`; `CINEMA_STATE` para todos.
- `cinema_react`: sentado; token bucket 1/s rajada 5 (excesso ignorado em silêncio); grava `(userId, emoji, position = positionAt(now), at)`; `CINEMA_REACTION` para os sentados.
- `cinema_end`: quem projeta → `host_ended`; num espaço, quem tem `MUTE_MEMBERS` ou `MOVE_MEMBERS` → `moderator`.
- Resumo no fim: `watchedS` = tempo de mídia efetivamente tocado (soma dos trechos `playing`), `seats` = todos que sentaram em algum momento, `reactions` = total, `peak` = balde de 10 s com mais reações (`position` = início do balde) ou `null`.
- Canal apagado com sessão aberta → `channel_gone` (pendurar na mesma saída de `left` de cada um).

- [ ] **Step 1: Testes que falham:**
  - sinal de a para b chega só a b com `from:a`; para quem não está sentado → `forbidden`; entre bloqueados → `forbidden`, e o `CINEMA_STATE` de a mostra a poltrona de b com `direct:false` (e o de terceiros, `direct:true`).
  - `iceServers` com `CINEMA_TURN_SECRET='s'` e `CINEMA_TURN_URLS='turn:x:3479'`: `username` termina em `:${userId}`, expira em ~6 h, `credential` confere com HMAC-SHA1 calculado no teste.
  - peças: host manda 0..199 e 200..399 → sentados recebem; `from` com buraco → `invalid`; não-host → `forbidden`; quem senta depois recebe 2 frames `CINEMA_PIECES` (0 e 200) antes do estado.
  - título `"<b>Duna</b>\u0007"` vira `"<b>Duna</b>"` (sem o controle; HTML fica como texto); título vazio → `invalid`.
  - 8 reações em 1 s → 5 entregues; emoji fora da lista → `CINEMA_ERROR invalid` (schema).
  - `cinema_end` de um membro comum → `forbidden`; de moderador → `ended, reason:'moderator'`.
  - resumo: tocar 10 s (fake timers), 3 reações perto de 5 s e 1 perto de 30 s → `peak.position = 0`, `count = 3`, `watchedS ≈ 10`.
- [ ] **Step 2: Rodar e ver falhar.** `npm test -w apps/server -- cinema`
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar tudo.** `npm test -w apps/server` → PASS; `npm run typecheck`.
- [ ] **Step 5: Commit** — `git commit -m "feat(server): cinema signaling, piece index, reactions, TURN credentials, summary"`

---

### Task 5: coturn no servidor de casa

**Files:**
- Modify: `infra/home-sfu/docker-compose.yaml` (serviço `coturn`, imagem oficial `coturn/coturn` com tag fixa, `network_mode: host`)
- Create: `infra/home-sfu/turnserver.conf` (template sem segredo)
- Modify: `infra/home-sfu/upnp.sh` (abrir `3479/udp`, `3479/tcp` e `49160-49200/udp`) e `infra/home-sfu/README.md` (seção "Relay da Sala de Cinema")
- Modify: `infra/home-sfu/railway-env.mjs` se é ele que publica variáveis no staging (`CINEMA_TURN_URLS`, `CINEMA_TURN_SECRET`)

**Valores fixos:** porta `3479` (a `3478/udp` já é do TURN do LiveKit); `use-auth-secret` + `static-auth-secret` vindo de env; `realm` = domínio DuckDNS do kit; `bps-capacity=30000000` (teto total 30 Mbps, §6.4); `max-bps` por sessão igual; `min-port=49160`/`max-port=49200`; `no-cli`, `no-multicast-peers`, `denied-peer-ip` para faixas privadas (o relay não pode virar porta para a LAN de casa); logs sem IP completo se o coturn permitir.

- [ ] **Step 1:** Escrever o template e o serviço; `docker compose -f infra/home-sfu/docker-compose.yaml config` → válido.
- [ ] **Step 2:** `doctor.sh` ganha checagem do coturn (porta respondendo a um STUN binding request).
- [ ] **Step 3: Pedir ao dono** autorização para subir no `home-server` (SSH por chave já autorizado; nada de sudo). Subir, rodar `doctor.sh`, testar com `turnutils_uclient` usando uma credencial gerada como na Task 4. Se algo pedir sudo, vira passo do dono no README.
- [ ] **Step 4:** Publicar `CINEMA_TURN_URLS`/`CINEMA_TURN_SECRET` no staging (segredo nunca no git nem no chat).
- [ ] **Step 5: Commit** — `git commit -m "infra(home-sfu): coturn relay for the cinema, 30 Mbps cap"`

---

### Task 6: ffmpeg empacotado

**Files:**
- Create: `apps/desktop/scripts/fetch-ffmpeg.mjs` (baixa a URL fixada no spike, confere SHA-256, extrai só `ffmpeg.exe`, `ffprobe.exe` e `LICENSE` para `apps/desktop/build/ffmpeg/`; não baixa de novo se o hash bate)
- Modify: `apps/desktop/package.json` (`build` roda o fetch antes do `electron-vite build`)
- Modify: `apps/desktop/electron-builder.yml` (`extraResources: - from: build/ffmpeg, to: ffmpeg`)
- Create: `apps/desktop/src/main/cinema/ffmpeg.ts`
- Create: `apps/desktop/src/main/cinema/ffmpeg.test.ts`
- Modify: `THIRD-PARTY-NOTICES` do app, se existir, com a licença LGPL e o link do código-fonte do build

**Interfaces:**
- Produces:

```ts
export interface FfmpegBins { ffmpeg: string; ffprobe: string }
export function ffmpegBins(): FfmpegBins  // packaged: process.resourcesPath/ffmpeg; dev: apps/desktop/build/ffmpeg
export type FfmpegCheck = { ok: true; version: string } | { ok: false; reason: 'missing' | 'blocked' | 'crashed'; detail: string }
export function checkFfmpeg(): Promise<FfmpegCheck>  // runs `ffmpeg -version`, 5 s timeout
export interface RunOpts { timeoutMs: number; signal?: AbortSignal; onStdoutLine?: (line: string) => void }
export function runTool(bin: string, args: readonly string[], opts: RunOpts): Promise<{ code: number; stdout: string; stderr: string }>
```

- [ ] **Step 1: Testes que falham** (`ffmpeg.test.ts`, com um executável falso — um `.cmd`/node script temporário):
  - `checkFfmpeg` com binário ausente → `{ ok:false, reason:'missing' }`; com `EPERM`/`EACCES` no spawn (antivírus) → `'blocked'`; saindo com código ≠ 0 → `'crashed'`; com saída `ffmpeg version n7.1…` → `{ ok:true, version:'n7.1…' }`.
  - `runTool` mata o processo no timeout e rejeita com `timeout`; `signal.abort()` mata; argumentos com espaços/aspas/`&` chegam intactos (sem shell).
- [ ] **Step 2:** `npm test -w apps/desktop -- ffmpeg` → FAIL.
- [ ] **Step 3: Implementar** com `child_process.spawn(bin, args, { windowsHide: true, shell: false })` e `os.setPriority(pid, os.constants.priority.PRIORITY_BELOW_NORMAL)`.
- [ ] **Step 4:** testes PASS; `node apps/desktop/scripts/fetch-ffmpeg.mjs` baixa e confere; `npm run build -w apps/desktop` e `npx electron-builder --dir` → `release/win-unpacked/resources/ffmpeg/ffmpeg.exe` existe; anotar o aumento de tamanho do instalador (≤ 40 MB).
- [ ] **Step 5: Commit** — `git commit -m "feat(desktop): bundle LGPL ffmpeg for the cinema host"`

---

### Task 7: Ficha do filme (probe → `CinemaFilm`) e nomes

**Files:**
- Create: `apps/desktop/src/main/cinema/probe.ts` (mapeamento puro)
- Create: `apps/desktop/src/main/cinema/names.ts` (título, episódio, irmãos)
- Create: `apps/desktop/src/main/cinema/probe.test.ts`, `names.test.ts`
- Create: `apps/desktop/src/main/cinema/__fixtures__/*.json` (saídas reais de `ffprobe -show_streams -show_format -show_chapters -of json` dos fixtures da Task 1)

**Interfaces:**
- Consumes: `CinemaFilm` (Task 2), `runTool`/`ffmpegBins` (Task 6).
- Produces:

```ts
export type CinemaWarning = 'dv_profile5' | 'high_bitrate' | 'pgs_ignored' | 'audio_converted' | 'atmos_dropped'
export type CinemaProbeError = 'no_video' | 'unsupported_video' | 'no_duration' | 'unreadable'
export function filmFromProbe(probe: unknown, fileName: string, rules: { lossless: 'flac' | 'aac'; lossy: 'aac' | 'opus' }): { film: CinemaFilm; warnings: CinemaWarning[] } | { error: CinemaProbeError }
export function probeFile(path: string): Promise<ReturnType<typeof filmFromProbe>>  // runs ffprobe, 15 s timeout
export function cleanTitle(fileName: string): string
export function parseEpisode(fileName: string): { season: number; episode: number } | null
export function nextEpisodes(dir: string, current: string): Promise<string[]>  // same folder, same show, sorted
```

**Regras (tabela do §6.3, copiar):** vídeo `h264|hevc|av1|vp9` → cópia; outros → `unsupported_video`. `hdr`: `smpte2084` → `hdr10`, `arib-std-b67` → `hlg`; side data Dolby Vision perfil 8 → `dv8`; perfil 5 → aviso `dv_profile5`. Áudio `aac|opus|flac|mp3` → `copy`; `ac3|eac3|dts` (core) → `rules.lossy`; `truehd|dts-hd ma` → `rules.lossless` (+ `atmos_dropped` se `truehd` com Atmos); `channels` preservado até 8. Legendas `subrip|webvtt` → `vtt`, `ass|ssa` → `ass`; `hdmv_pgs_subtitle|dvd_subtitle` → `pgs_ignored`. `videoMime` com codec string RFC 6381 real (ex.: `hvc1.2.4.L150.90` a partir de profile/level). `bitrateKbps > 60_000` → `high_bitrate`.

- [ ] **Step 1: Testes que falham:**
  - cada fixture JSON → `CinemaFilm` esperado (codec, mime, hdr, faixas, `out` de cada áudio, capítulos, avisos).
  - **(Review Focus 1)** JSON sem stream de vídeo → `no_video`; `mpeg2video` → `unsupported_video`; `duration` ausente/0 → `no_duration`; JSON truncado/lixo → `unreadable`; 40 faixas de áudio → todas mapeadas, nenhuma exceção; título de stream com `<script>`/RTL/`\u0000` → string sem caracteres de controle, o resto intacto (escapar é papel da UI).
  - `cleanTitle('Duna.Parte.Dois.2024.2160p.WEB-DL.DDP5.1.HDR.mkv')` → `'Duna Parte Dois (2024)'`; `'The.Office.US.S02E03.720p.mkv'` → `'The Office US'`; `'filme_caseiro.mp4'` → `'filme caseiro'`.
  - `parseEpisode`: `S01E02`, `s1e2`, `1x02` → `{1,2}`; `2024.1080p` → `null`.
  - `nextEpisodes` numa pasta temporária com `S01E01..E03` + um `.srt` + outra série → `['…S01E02…','…S01E03…']` a partir do E01.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS + `npm run typecheck`.
- [ ] **Step 5: Commit** — `git commit -m "feat(desktop): cinema film probe and naming"`

---

### Task 8: Gerador de peças (main)

**Files:**
- Create: `apps/desktop/src/main/cinema/mp4.ts` (leitor mínimo de caixas: `mdhd` timescale do init, `tfdt` do segmento)
- Create: `apps/desktop/src/main/cinema/pieces.ts` (runs de ffmpeg por faixa, playlist incremental, hashes, orçamento de disco, limpeza)
- Create: `apps/desktop/src/main/cinema/extras.ts` (legendas → `.vtt`/`.ass` + fontes; legenda solta com detecção de codificação; capa; sprite de miniaturas)
- Create: `apps/desktop/src/main/cinema/pieces.test.ts`, `mp4.test.ts`, `extras.test.ts`

**Interfaces:**
- Consumes: Tasks 6–7.
- Produces:

```ts
export function initTimescale(init: Uint8Array): number
export function segmentStart(seg: Uint8Array, timescale: number): number  // seconds, from tfdt
export interface PieceEvent { track: CinemaTrackId; from: number; items: CinemaPieceMeta[] }
export class PieceFactory {
  constructor(opts: { path: string; film: CinemaFilm; dir: string; budgetBytes: number; bins: FfmpegBins })
  start(startS: number, audioIds: number[]): void
  ensure(track: CinemaTrackId, atS: number): void   // seek beyond the frontier: new run from the keyframe ≤ atS
  addAudio(audioId: number): void
  init(track: CinemaTrackId): Promise<Uint8Array | null>
  piece(track: CinemaTrackId, n: number): Promise<Uint8Array | null>
  onPieces(cb: (e: PieceEvent) => void): () => void
  onError(cb: (e: { track: CinemaTrackId; reason: string }) => void): () => void
  close(): Promise<void>   // kills runs, deletes dir
}
export function cleanupStale(root: string): Promise<void>  // called at app start
export function decodeSubtitle(bytes: Uint8Array): string  // UTF-8 (fatal) else windows-1252
```

**Decisões:**
- Uma run = um processo ffmpeg por faixa: vídeo `-map 0:v:0 -c:v copy` (+ `-tag:v hvc1` para HEVC); áudio `-map 0:a:<id>` com o `out` da ficha (`aac -b:a 640k` / `libopus -mapping_family 1` / `flac` / `copy`). Muxer `-f hls -hls_segment_type fmp4 -hls_time 4 -hls_playlist_type event -hls_flags independent_segments`, `-start_number <n>`, nomes `<track>/<n>.m4s` + `<track>/init.mp4`.
- **Timestamps absolutos:** run iniciada em `-ss X` usa `-copyts` para que `tfdt` = tempo de mídia real; `startS` de cada peça vem de `segmentStart` (não do EXTINF); `durS` do EXTINF.
- Peças de runs diferentes nunca se sobrepõem: a run nova começa no próximo `n` livre e no keyframe ≤ alvo; uma run para quando alcança a peça seguinte já existente.
- Peça regenerada (evicção) com bytes diferentes = nova entrada do índice com o mesmo `n` e novo hash; o servidor repassa e os pares descartam a versão antiga (o enxame da Task 10 compara hash).
- Orçamento de disco: ao passar `budgetBytes`, apagar primeiro as peças mais distantes **antes** da posição atual da sala (mais de 10 min atrás).
- `extras`: cada legenda de texto vira um arquivo inteiro (`s<id>`, uma peça só); fontes anexadas (`-dump_attachment:t ""`) vão junto da faixa ASS; capa = 3 candidatos (10/25/40%), escolhe maior luminância média sem estourar, WebP 960 px (`poster`); miniaturas = 1 quadro a cada 10 s em sprite WebP 160 px de largura (`thumbs`), em segundo plano depois das primeiras peças.

- [ ] **Step 1: Testes que falham** (com os fixtures da Task 1; pular com `it.skipIf(!fixtures)` quando não houver):
  - `initTimescale`/`segmentStart` em segmentos reais gerados pelo ffmpeg LGPL.
  - `h264-ac3-51.mkv` inteiro: vídeo e `a0` geram peças contíguas cobrindo 20 s (soma de `durS` ≈ duração ± 0,1 s); bytes das amostras de vídeo idênticos aos pacotes do arquivo (comparar o `mdat` com `ffprobe -show_packets -show_data_hash sha256` do original) — **vídeo nativo, §8**.
  - `start(0)` e depois `ensure('v', 15)` antes do frontier → nova run; índice final sem buraco nem sobreposição; `startS` da primeira peça da run 2 ≤ 15 e é keyframe.
  - `close()` mata processos e apaga a pasta; `cleanupStale` apaga pastas órfãs com mais de 1 h.
  - orçamento de 1 MB → peças antigas somem, recentes ficam.
  - **(Review Focus 1)** MKV truncado na metade: peças até onde dá, depois `onError` com motivo; nenhuma exceção não tratada.
  - `decodeSubtitle` de bytes Windows-1252 com `ção` → `'ção'`; UTF-8 com BOM → sem BOM.
  - capa e sprite existem e são WebP válidos.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS + typecheck.
- [ ] **Step 5: Commit** — `git commit -m "feat(desktop): cinema piece factory (copy video, convert audio, subtitles, poster, thumbs)"`

---

### Task 9: Bridge `window.alga.cinema` (+ etiqueta E2EE)

**Files:**
- Modify: `apps/desktop/src/shared/ipc.ts` (canais `alga:cinema:*`), `apps/desktop/src/shared/bridge.ts` (tipo `cinema`), `apps/desktop/src/preload/index.ts`
- Create: `apps/desktop/src/main/cinema/ipc.ts` (`registerCinemaIpc()`, chamado em `main/index.ts` junto dos outros `register*Ipc`)
- Modify: `apps/desktop/src/main/mls/e2ee.ts` (+ `session.ts` se preciso) para `cinemaTag`
- Create: `apps/desktop/src/main/cinema/ipc.test.ts`

**Interfaces:**
- Consumes: Tasks 6–8; validadores `str/int/obj/arr` de `main/ipc.ts`.
- Produces (renderer):

```ts
cinema: {
  checkFfmpeg(): Promise<FfmpegCheck>
  pick(): Promise<{ fileId: string; name: string } | null>       // dialog.showOpenDialog, filtros de vídeo
  fromDrop(file: File): Promise<{ fileId: string; name: string }> // preload: webUtils.getPathForFile
  probe(fileId: string): Promise<{ film: CinemaFilm; warnings: CinemaWarning[]; next: string[] } | { error: CinemaProbeError }>
  start(fileId: string, startS: number, audioIds: number[]): Promise<void>
  ensure(fileId: string, track: CinemaTrackId, atS: number): void
  addAudio(fileId: string, audioId: number): void
  addSubtitle(fileId: string): Promise<CinemaSubtitleTrack | null>   // pick .srt/.ass, decoded, becomes a track
  init(fileId: string, track: CinemaTrackId): Promise<ArrayBuffer | null>
  piece(fileId: string, track: CinemaTrackId, n: number): Promise<ArrayBuffer | null>
  onPieces(cb: (e: PieceEvent & { fileId: string }) => void): Unsubscribe
  onError(cb: (e: { fileId: string; track: CinemaTrackId; reason: string }) => void): Unsubscribe
  close(fileId: string): Promise<void>
}
e2ee: { /* existing */ cinemaTag(channelId: string, epoch: number, message: string): Promise<string | null> }
```

`fileId` é aleatório (16 bytes base64url); o main guarda `fileId → { path, factory }`; o caminho nunca volta ao renderer. `cinemaTag` = base64 de HMAC-SHA256 com a chave `export_secret("Alga Cinema v1", channelId, 32)` daquele `epoch` (guardar as 16 últimas épocas, como as chaves de mídia); `null` se a chamada não é E2EE ou a época não existe mais.

- [ ] **Step 1: Testes que falham:** `fileId` desconhecido → rejeita; `track` fora do padrão, `n` negativo ou não inteiro, `atS` NaN → rejeita (validadores); `piece` devolve `ArrayBuffer` (não `Buffer`, não base64); dois `pick` do mesmo arquivo → dois `fileId`; `close` invalida o `fileId`; `cinemaTag` igual em duas sessões MLS do mesmo grupo e época (usar o harness de `apps/server/test/e2ee.test.ts` ou `mls.test.ts`), diferente para outra `channelId`.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS + typecheck.
- [ ] **Step 5: Commit** — `git commit -m "feat(desktop): cinema bridge and E2EE fingerprint tag"`

---

### Task 10: Protocolo binário e enxame (renderer)

**Files:**
- Create: `apps/desktop/src/renderer/src/features/cinema/swarm/protocol.ts`, `scheduler.ts`, `assembler.ts`, `cache.ts` (OPFS), `swarm.ts`
- Create: `…/swarm/protocol.test.ts`, `scheduler.test.ts`, `assembler.test.ts`, `swarm.test.ts`

**Interfaces:**
- Consumes: `CinemaPieceMeta`, `CinemaTrackId` (Task 2).
- Produces:

```ts
// protocol.ts — every message: u8 type + body; little-endian
export type WireMsg =
  | { t: 'have'; track: CinemaTrackId; bits: Uint8Array }          // bitfield of pieces held
  | { t: 'got'; track: CinemaTrackId; n: number }                  // incremental have
  | { t: 'req'; track: CinemaTrackId; n: number }
  | { t: 'cancel'; track: CinemaTrackId; n: number }
  | { t: 'chunk'; track: CinemaTrackId; n: number; offset: number; total: number; data: Uint8Array }
  | { t: 'init'; track: CinemaTrackId; data: Uint8Array }          // init segment (≤ 64 KiB)
export function encode(m: WireMsg): ArrayBuffer
export function decode(buf: ArrayBuffer): WireMsg | null              // null = malformed, never throws
// scheduler.ts — pure
export interface SwarmView {
  now: number; playheadS: number; tracks: CinemaTrackId[]
  index: Map<CinemaTrackId, CinemaPieceMeta[]>
  mine: Map<CinemaTrackId, Set<number>>
  peers: { id: string; isHost: boolean; has: Map<CinemaTrackId, Set<number>>; inflight: number; mbps: number; bannedFor: Set<string> }[]
  inflight: Set<string>                                               // `${track}:${n}`
  budgetPieces: number                                                // cache capacity left
}
export function nextRequests(v: SwarmView, maxNew: number): { peer: string; track: CinemaTrackId; n: number }[]
export function hostShouldSend(hostView: SwarmView, peerId: string, track: CinemaTrackId, n: number): boolean // super-seed
// cache.ts — OPFS in the app, memory in tests
export interface PieceCache { put(key: string, buf: ArrayBuffer): Promise<void>; get(key: string): Promise<ArrayBuffer | null>; delete(key: string): Promise<void>; clear(): Promise<void>; bytes(): number }
export function opfsCache(sessionId: string): Promise<PieceCache>
export function memoryCache(): PieceCache
// swarm.ts — RTCDataChannel satisfies ChannelLike; tests use a MessageChannel-backed fake
export interface ChannelLike { send(data: ArrayBuffer): void; readonly bufferedAmount: number; bufferedAmountLowThreshold: number; onmessage: ((e: { data: ArrayBuffer }) => void) | null; onbufferedamountlow: (() => void) | null; close(): void }
export class Swarm {
  constructor(opts: { sessionId: string; isHost: boolean; cache: PieceCache; source?: (track: CinemaTrackId, n: number) => Promise<ArrayBuffer | null> })
  addPeer(id: string, ch: ChannelLike): void; removePeer(id: string): void
  setIndex(track: CinemaTrackId, from: number, items: CinemaPieceMeta[]): void
  setPlayhead(s: number): void; setTracks(t: CinemaTrackId[]): void
  get(track: CinemaTrackId, n: number): Promise<ArrayBuffer | null>    // from cache
  init(track: CinemaTrackId): Promise<ArrayBuffer | null>
  aheadS(track: CinemaTrackId): number
  stats(): { fromHostPct: number; fromPeersPct: number; downMbps: number; upMbps: number; peers: number }
  onPiece(cb: (track: CinemaTrackId, n: number) => void): () => void
  close(): Promise<void>                                              // clears OPFS dir of the session
}
```

**Regras do scheduler (§6.4):** peças dentro de `playheadS .. playheadS + 30` primeiro, em ordem, do par com mais `mbps` que tem a peça; depois mais rara primeiro (menos pares têm), desempate pela mais próxima; nunca pede o que já tem ou está em voo; nunca pede de par em `bannedFor` daquela peça; respeita `budgetPieces`. Super-seed: quem projeta só manda uma peça a um par se nenhum outro par já a tem **ou** se ela está na janela crítica de quem pede. Pedaços de 224 KiB (dentro de 64–224 KiB); envio pausa em `bufferedAmount > 256 KiB` e retoma em `bufferedamountlow` (128 KiB). Peça montada → SHA-256 (`crypto.subtle`) contra o índice; diferente → descarta, `bannedFor` do par para aquela peça, pede de outro. Cache: OPFS em `cinema/<sessionId>/<track>/<n>`, apagado em `close()` e na abertura do app; peças mais de 10 min atrás do playhead saem primeiro quando falta espaço.

- [ ] **Step 1: Testes que falham:**
  - `encode`/`decode` ida e volta de cada tipo; **(Review Focus 2)** `decode` de buffer truncado, tipo desconhecido, `offset+len > total`, `total` > 64 MiB, track inválido → `null`, nunca exceção.
  - `nextRequests`: janela crítica em ordem pelo par mais rápido; fora dela, a mais rara primeiro; ignora `inflight` e banidos; respeita `maxNew` e `budgetPieces`.
  - `hostShouldSend`: peça que um amigo já tem e fora da janela crítica de quem pede → `false`; na janela crítica → `true`.
  - `assembler`: chunks fora de ordem montam a peça; chunk duplicado ignorado; par removido no meio → parcial descartado.
  - `Swarm` com 3 pares em memória (`memoryCache` + `ChannelLike` sobre `MessageChannel` do Node): host com 20 peças, 2 amigos terminam com tudo e o host enviou ≤ 1,5× o total de bytes (super-seed); par que manda bytes corrompidos é banido daquela peça e a peça chega certa por outro.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS + typecheck.
- [ ] **Step 5: Commit** — `git commit -m "feat(desktop): cinema swarm (wire protocol, scheduler, super-seed, hash check, OPFS cache)"`

---

### Task 11: Malha de pares (renderer)

**Files:**
- Create: `apps/desktop/src/renderer/src/features/cinema/mesh.ts`, `mesh.test.ts`

**Interfaces:**
- Consumes: `Gateway.send` (`lib/gateway.ts`), `onDispatch` (`store/session.ts`), `CinemaSignal`, `CinemaSeat.direct`, `iceServers` (Task 4), `window.alga.e2ee.cinemaTag` (Task 9), `useMedia(s => s.e2ee)`.
- Produces:

```ts
export class Mesh {
  constructor(opts: { sessionId: string; channelId: string; selfId: string; iceServers: CinemaIceServer[]; e2ee: { epoch: number } | null; send: (f: CinemaClientFrame) => boolean })
  sync(seats: CinemaSeat[]): void            // opens/closes connections to match the seats with direct:true
  onSignal(from: string, s: CinemaSignal): Promise<void>
  onChannel(cb: (peerId: string, ch: RTCDataChannel) => void): () => void
  onPeerGone(cb: (peerId: string) => void): () => void
  relayed(): string[]                         // peers whose selected candidate pair is 'relay'
  close(): void
}
// pure helpers (the vitest environment is Node: no RTCPeerConnection; real WebRTC is covered in Tasks 14–15)
export function isOfferer(selfId: string, peerId: string): boolean
export class CandidateBatcher { constructor(flush: (c: string[]) => void, opts?: { max?: number; waitMs?: number }); add(c: string): void; close(): void }
export function tagInput(sessionId: string, from: string, to: string, fingerprint: string): string
export function fingerprintOf(sdp: string): string | null
```

**Regras:** uma `RTCPeerConnection` por par, um data channel `cinema` binário (`ordered: true`, `binaryType: 'arraybuffer'`); quem tem `selfId` menor abre a oferta (o outro é "polite" na negociação perfeita). Candidatos ICE agrupados (até 20 por frame, ou a cada 200 ms). Poltrona com `direct:false` → nunca conecta (as peças chegam por outros). Em chamada E2EE: a oferta/resposta leva `tag = cinemaTag(channelId, epoch, \`${sessionId}|${from}|${to}|${fingerprint}\`)` e `epoch`; quem recebe recalcula; diferente ou `null` → fecha e loga (nunca cai para conexão sem verificação). Conexão `failed` → tenta de novo 2 vezes com `iceRestart`, depois desiste daquele par.

- [ ] **Step 1: Testes que falham** (só lógica pura; o vitest do desktop roda em Node):
  - `isOfferer('a','b')` → `true`, `isOfferer('b','a')` → `false`.
  - `CandidateBatcher`: 30 candidatos em 50 ms → `flush` 2 vezes (20 + 10); 1 candidato → `flush` após 200 ms; `close` descarta pendentes.
  - `fingerprintOf` extrai `a=fingerprint:sha-256 …` de um SDP real (fixture de texto); SDP sem fingerprint → `null`.
  - `tagInput('s','a','b','AB:CD')` → `'s|a|b|AB:CD'` (a ordem importa: trocar `from`/`to` muda a etiqueta).
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS + typecheck.
- [ ] **Step 5: Commit** — `git commit -m "feat(desktop): cinema peer mesh with E2EE-bound fingerprints"`

---

### Task 12: Relógio, sincronia e player

**Files:**
- Create: `apps/desktop/src/renderer/src/features/cinema/clock.ts`, `sync.ts`, `player.ts`
- Create: `clock.test.ts`, `sync.test.ts`, `player.test.ts`

**Interfaces:**
- Consumes: `positionAt`, `CinemaPlayback`, `CinemaFilm` (Task 2); `Swarm.get/init/aheadS` (Task 10).
- Produces:

```ts
export class ClockEstimator {
  add(sample: { c: number; s: number; r: number }): void  // client send, server time, client receive (ms)
  offsetMs(): number | null                               // server - client, from the min-RTT sample of the last 16
  serverNow(clientNow?: number): number
  nextPingDelayMs(): number                               // 1000 until 8 samples, then 15000
  jumped(clientNow: number, perfNow: number): boolean     // wall-clock jump > 1 s (sleep/resume) → caller resets
  reset(): void
}
export type SyncAction = { kind: 'none' } | { kind: 'rate'; rate: number } | { kind: 'seek'; toS: number }
export class SyncController {
  constructor(opts?: { seekLatencyMs?: number })
  frame(errMs: number, nowMs: number): SyncAction          // feed one rVFC sample; median of last 10
  learnSeekLatency(ms: number): void
}
export function bufferPlan(buffered: { startS: number; endS: number }[], playheadS: number, pieces: CinemaPieceMeta[]): { append: number[]; removeBeforeS: number | null }
export function scheduleDelayMs(atServerMs: number, offsetMs: number, clientNowMs: number): number
export function canPlay(film: CinemaFilm, audioId: number): Promise<{ ok: true } | { ok: false; reason: 'video_codec' | 'audio_codec' }>
export class CinemaPlayer {
  constructor(video: HTMLVideoElement, swarm: Swarm, film: CinemaFilm)
  setAudio(audioId: number): Promise<void>                 // swaps the audio SourceBuffer at the current position
  apply(p: CinemaPlayback, serverNow: () => number): void  // schedules play/pause/seek at p.at
  aheadS(): number
  onStall(cb: (stalled: boolean) => void): () => void      // true after CINEMA_STALL_MS without data
  stats(): { droppedFrames: number; syncErrP95Ms: number; bufferedAheadS: number }
  destroy(): void
}
```

**Regras:** `SourceBuffer` em modo `'segments'` (timestamps absolutos das peças); manter ~60 s à frente e remover o que ficou > 30 s para trás. `apply`: comando com `at` no futuro → `setTimeout` até `at - offset` e então `play()`/`pause()`; pausa termina com `currentTime = position` exato; seek usa `fastSeek` não — `currentTime` e espera `seeked`, medindo latência para `learnSeekLatency`. A cada frame (`requestVideoFrameCallback`): `esperado = positionAt(p, serverNow(expectedDisplayTime convertido))`, `err = mediaTime - esperado` em ms, `SyncController.frame` → aplica `playbackRate` (com `preservesPitch = true`) ou seek. Janela oculta (rVFC para): ao voltar, seek direto para o esperado. `canPlay`: `MediaSource.isTypeSupported` + decodificar o init + 1ª peça num `MediaSource` escondido.

- [ ] **Step 1: Testes que falham:**
  - `ClockEstimator`: amostras com RTT 40/10/80 ms → usa a de 10 ms (`offset = s - (c + r)/2`); 16 amostras máximo; `nextPingDelayMs` 1000 até 8, depois 15000; **(clock jump)** `jumped` com relógio de parede pulando 5 s e `performance.now` andando 10 ms → `true`.
  - `SyncController`: erros de 10 ms → `none`; 100 ms → `rate` com `1 - 100/3000` (adiantado → mais devagar); 400 ms → taxa limitada a `0.95`/`1.05`; 600 ms → `seek`; 100 ms que não converge por 5 s → `seek`; a mediana ignora um pico isolado de 900 ms entre nove de 10 ms.
  - `player.test.ts` (Node, sem MSE): só a lógica pura extraída do player — `bufferPlan(bufferedRanges, playheadS, pieces)` decide o que anexar (até 60 s à frente) e o que remover (> 30 s atrás); `scheduleDelayMs(p.at, offset, clientNow)` nunca negativo. O comportamento real (play agendado em ±1 frame, pausa no frame exato, `setAudio` sem mudar o frame de vídeo, `canPlay`) é verificado no Electron pela Task 15.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS + typecheck.
- [ ] **Step 5: Commit** — `git commit -m "feat(desktop): cinema clock, sync controller and MSE player"`

---

### Task 13: Áudio do filme e legendas

**Files:**
- Create: `apps/desktop/src/renderer/src/features/cinema/audio.ts`, `subtitles.ts`, `SubtitleOverlay.tsx`, `ass.ts` (wrapper do JASSUB)
- Create: `audio.test.ts`, `subtitles.test.ts`
- Modify: `apps/desktop/package.json` (`jassub`), `apps/desktop/src/main/security.ts` e `renderer/index.html` se o worker/wasm do JASSUB pedir ajuste de CSP (mínimo necessário; documentar no comentário)

**Interfaces:**
- Consumes: `useMedia(s => s.participants)` (`speaking`), dispositivo de saída da call (`media/sounds.ts` `setCueOutput` como referência), decisão de eco do spike (Task 1).
- Produces:

```ts
export function duckGain(speakingAnyone: boolean, prevGainDb: number, dtMs: number): number  // -10 dB target, 150 ms attack, 700 ms release
export class FilmAudio {
  constructor(video: HTMLVideoElement)
  setVolume(v: number): void; setMuted(m: boolean): void; setDucking(on: boolean): void
  setOutput(deviceId: string | null): Promise<void>
  destroy(): void
}
export interface Cue { startS: number; endS: number; text: string }
export function parseVtt(text: string): Cue[]
export function parseSrt(text: string): Cue[]
export function activeCues(cues: Cue[], t: number, offsetS: number): Cue[]
```

**Regras:** o som do filme passa por `MediaElementSource → GainNode (volume) → GainNode (ducking) → destino`, no caminho que o spike aprovou contra eco; ducking reage a **outros** falando (`participants[*].speaking`), não a si. Volume do filme e das vozes são independentes (o das vozes é o que já existe). Se o spike disse "sem solução no Chromium", `FilmAudio` expõe `echoRisk(): boolean` (saída não é fone, quando o rótulo do dispositivo permite saber) para a UI avisar. Legendas de texto renderizadas em `SubtitleOverlay` (tokens do design system, contorno, tamanhos P/M/G, sobe 64 px quando os controles aparecem); ASS via JASSUB em worker com `OffscreenCanvas`, `maxRenderHeight: 1080`, fontes anexadas carregadas da peça da faixa. Atraso por pessoa ±0,1 s (`offsetS`).

- [ ] **Step 1: Testes que falham:** `duckGain` vai a −10 dB em ~150 ms e volta a 0 em ~700 ms (tolerância 10%); `parseSrt` com índices, `-->`, vírgula decimal, linhas em branco extras, tags `<i>`; `parseVtt` com cabeçalho e cue settings; `activeCues` com `offsetS = +0.5` desloca; legenda vazia → `[]` sem exceção.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS + typecheck.
- [ ] **Step 5: Commit** — `git commit -m "feat(desktop): cinema film audio (ducking, volumes) and subtitles"`

---

### Task 14: Store do cinema e UI crua atrás da flag

UI de engenharia só para provar o motor ponta a ponta. Nada aqui é a experiência final (Plano 2 substitui), mas segue tokens do design system e pt-BR.

**Files:**
- Create: `apps/desktop/src/renderer/src/features/cinema/store.ts` (`useCinema`, `handleCinemaDispatch`, `startCinema()` → cleanup), `actions.ts`, `strings.ts`, `CinemaDev.tsx` (palco cru), `cinema.module.css`
- Create: `store.test.ts`
- Modify: `apps/desktop/src/renderer/src/features/voice/ControlsDock.tsx` (botão "Cinema" quando a flag `cinema` do `AppConfig`/servidor está ligada), `features/voice/CallStage.tsx` (mostra `CinemaDev` quando há sessão e eu estou sentado; cartão "Sentar" quando há sessão e não estou), onde `startSoundboard()` é ligado (`voice.ts startVoiceSync`) também liga `startCinema()`

**Interfaces:**
- Consumes: Tasks 2, 9–13.
- Produces: `useCinema` com `{ session: CinemaSessionView | null; mine: { seated: boolean; status; audioId; subtitleId; offsetS } ; host: { fileId: string | null }; stats; error }` e ações `openFromFile()`, `seat(b)`, `control(action, position?)`, `react(emoji)`, `setAudio(id)`, `setSubtitle(id)`, `end()`.

**Fluxo:** depois de cada `READY`, `cinema_hello`; com sessão e sentado, relógio pinga (`ClockEstimator.nextPingDelayMs`), `Mesh` sincroniza com `seats`, `Swarm` recebe índice de `CINEMA_PIECES` (e, no host, de `window.alga.cinema.onPieces`, que também vira `cinema_pieces` para o servidor em lotes de 200), `CinemaPlayer.apply` em cada `CINEMA_STATE`, `cinema_status` a cada 2 s (ou na hora em `stalled`/`ready`). Host: `pick` → `checkFfmpeg` (falha → mensagem clara, §6.3) → `probe` → ficha mínima (título editável, faixas, avisos, quem da chamada não decodifica via `canPlay` deles reportado como `unsupported`) → `start` + `cinema_open`. Seek fora do que já existe → host recebe o `CINEMA_STATE` e chama `ensure`. `CinemaDev` mostra vídeo, play/pause, timeline com o carregado, seletor de áudio/legenda, volume do filme, ducking on/off, e o painel `S` com `Swarm.stats()` + `CinemaPlayer.stats()` + `Mesh.relayed()`.

Clientes antigos na mesma chamada: confirmar que `store/session.ts` ignora tipos de dispatch desconhecidos sem erro (é o que torna `CINEMA_*` seguro para versões velhas, §6.2); se não ignorar, isso é bug a corrigir aqui.

- [ ] **Step 1: Testes que falham** (`store.test.ts`, com gateway e bridge falsos): `READY` → manda `cinema_hello`; `CINEMA_STATE` de sessão → `session` setada; `ended` → `session = null` e resumo guardado; **(Review Focus 4)** novo `READY` com sessão e sentado → `cinema_hello` e, ao receber o estado, não recria o `Swarm` (mesmo cache); `CINEMA_ERROR stale` → aplica o estado que vem junto sem mostrar erro; host com `checkFfmpeg` `blocked` → `error` com o texto de `strings.ts` (`ffmpegBlocked`).
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS + `npm run typecheck` + `npm test -w apps/desktop`.
- [ ] **Step 5: Ver funcionando:** `npm run dev -- --profiles=bob` (duas janelas), entrar na mesma call, abrir um fixture, sentar, tocar, pausar, pular, trocar áudio. Capturar tela das duas janelas no mesmo frame.
- [ ] **Step 6: Commit** — `git commit -m "feat(desktop): cinema store and dev stage behind the flag"`

---

### Task 15: Ponta a ponta com instâncias reais e números do §8

**Files:**
- Create: `apps/desktop/scripts/cinema-lab.mjs` (Playwright, 2–4 instâncias, padrão `media-lab.mjs`; usa `scripts/netem/udp-impair.mjs` para perda/latência)
- Create: `docs/benchmarks/cinema-engine.md`
- Modify: `docs/STATE.md` (linha da Sala de Cinema: motor feito, números, o que falta = Plano 2)

**O que o script mede** (cada instância grava `(serverNow, mediaTime)` de cada frame via rVFC num log; o script compara offline):
- player: play agendado começa em ±1 frame de `at`; pausa termina no frame exato; `setAudio` troca a faixa sem mudar o frame de vídeo; `canPlay` correto para cada fixture (o `mpeg2` nem chega a abrir, §6.3);
- primeiro frame em todos ≤ 10 s após "Abrir sessão" (fixture 1080p 8 Mbps);
- erro entre quaisquer dois clientes p95 ≤ 42 ms depois de 10 s; nunca > 3 frames (125 ms) por > 1 s;
- pausa: todos no mesmo frame (`mediaTime` igual ± 1 frame) em ≤ 300 ms;
- entrar no meio ≤ 8 s até sincronizado;
- 4 instâncias, 20 min de fixture em loop, netem 1% perda + 40 ms: zero travamentos com host em ≥ 1,5× o bitrate;
- `fromHostPct` do super-seed (host envia ≤ 1,5× o tamanho do filme);
- RAM por instância (≤ 1,5 GB); tamanho do instalador (≤ +40 MB).

- [ ] **Step 1:** Escrever `cinema-lab.mjs`; rodar `node apps/desktop/scripts/cinema-lab.mjs --instances 2` → relatório.
- [ ] **Step 2:** Rodar com 4 instâncias + netem; corrigir o que reprovar (cada correção com teste na task dona do código).
- [ ] **Step 3: Teste real entre casas com o dono** (um filme dele, um amigo em outra casa): registrar sincronia, relay usado ou não, eco (com e sem fone).
- [ ] **Step 4:** Escrever `docs/benchmarks/cinema-engine.md` e atualizar `docs/STATE.md`; nota curta em `docs/decisions/0004-e2ee.md` (cinema: DTLS P2P, fingerprints amarradas ao MLS em chamada E2EE, servidor só vê metadados) e em `docs/ARCHITECTURE.md` D2 (a malha P2P rejeitada para mídia de chamada é usada só para as peças do cinema, ≤ 8 pessoas).
- [ ] **Step 5: Commit** — `git commit -m "test(cinema): end-to-end lab and engine benchmarks"`

---

## Depois deste plano

**Plano 2 — Experiência** (escrito sobre as interfaces reais deste): ficha bonita, foyer com capa e poltronas, luzes (§7.1), contagem, assistindo com interface que some, poltronas que acendem com a fala, reações subindo, timeline social (carregado, capítulos, Pular abertura, mapa de calor, miniaturas), pausa com quem pausou, intervalo com "Pronto", esperando alguém, créditos/próximo episódio, canhoto, "Continuar de", miniplayer, atalhos (§7.4), movimento reduzido e acessibilidade (§7.5), aviso de IP na primeira vez, presença "Numa sessão de cinema", denúncia, capturas no padrão `docs/screenshots/`, versão nova do desktop.
