# Sala de Cinema: spike (codecs, ffmpeg LGPL, data channel, relógio, eco)

> 2026-11-05. Máquina de desenvolvimento: Windows 11, 20 threads lógicos. Electron 45.2.1 (Chromium 156.0.8078.75).
> - Scripts: `apps/desktop/scripts/cinema-fixtures.mjs` (fixtures), `cinema-spike.mjs` + `cinema-spike-page.html` (medições).
> - Reproduzir: `node apps/desktop/scripts/cinema-fixtures.mjs --long`, depois
>   `node apps/desktop/scripts/cinema-spike.mjs --ffmpeg=<pasta do ffmpeg LGPL>` (fases: `ffmpeg,mse,dc,gateway`).
> - Passos que dependem do dono ficaram **pendentes (Task 15)**: filme real, entre duas casas, eco com caixa de som.

## Decisões que as medições fixam

| Pergunta | Decisão | Base |
|---|---|---|
| Áudio sem perda (`lossless`) | **`flac` com a contagem de canais da fonte (até 8)** (TrueHD, DTS-HD MA), por **Ruling R10** | FLAC 5.1 e 7.1 passaram: tocam com todos os canais (6/6 e 8/8) no tom certo. |
| Áudio com perda | **≤ 6 canais (AC-3, E-AC-3, DTS): `aac` 640k. 7.1: `opus` 7.1** (libopus, `mapping_family 1`), por **Ruling R10** | AAC 5.1 passa; AAC 7.1 não anexa no MSE; Opus 7.1 passa 8/8. |
| Fontes já compatíveis | AAC/Opus/FLAC/MP3: cópia. Exceção: AAC com mais de 6 canais vira Opus com a mesma contagem | Idem (AAC 7.1 falha). |
| Teto de canais | **8** (7.1 mantido). **Ruling R8 (teto de 6) está superada pelo R10.** | O re-teste com 8 canais verdadeiros mostrou que o Chromium entrega 7.1 em Opus e FLAC. |
| Relógio | **só gateway, PROVISÓRIO** (**Ruling R9**) | Não medido no WebSocket do staging (sem contas): só o piso local (0,39 ms) e um substituto HTTP. Medição real e erro entre clientes ficam na Task 15; se errar a meta, entra refinamento P2P. |
| Eco | **pendente (Task 15)**; fallback: aviso de fone [dono] | Procedimento escrito; não foi tocado áudio alto nesta máquina. |
| ffmpeg para a Task 6 | URL, versão e SHA-256 abaixo | Mesmo binário medido aqui. |

### ffmpeg LGPL que a Task 6 fixa

- Origem: BtbN/FFmpeg-Builds, release imutável `autobuild-2026-11-05-12-48` (o link `latest` é móvel; não usar).
- URL: `https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-11-05-12-48/ffmpeg-n9.0.2-47-gb204e94e90-win64-lgpl-9.0.zip`
- Versão: `n9.0.2-47-gb204e94e90-20261105`, build estático, sem `--enable-gpl`, `--disable-libx264`, `--disable-libx265`.
- SHA-256 do zip: `9d557b1a39b9db87ff9b5cf7a4c2c3fd42e5f3d21c68714b2dd6e104bd48f715` (168 879 685 bytes, 161,1 MiB).
- SHA-256 do `ffmpeg.exe`: `a502236803095e00ca2b6febf4617c10018198bbc52bb29401653859d000fe62` (132 290 560 bytes, 126,2 MiB).
- SHA-256 do `ffprobe.exe`: `5c0a9c0a54571b188b19d995d15bdd2daeef68a72dbe9255a4f2418a32e342e5` (132 089 856 bytes, 126,0 MiB).
- O zip do link `latest` na hora da medição tinha os mesmos dois `.exe` (hashes idênticos), mas outro SHA-256 de zip
  (`3ef1842c...b5f1`, nome interno de pasta diferente). Vale o zip imutável acima.
- Tem decoders de AC-3, E-AC-3, DTS, TrueHD, HEVC, AV1, MPEG-2; encoders `aac`, `libopus`, `flac`. LGPL-3.0 (`--enable-version3`):
  a Task 6 precisa incluir o aviso de licença e o link do código-fonte.

## Fixtures (Step 1)

20 s, 1080p24, GOP de 2 s, um seno por canal (440, 550, 660, 60 Hz LFE, 770, 880, 990, 1100 Hz), gerados com o ffmpeg
GPL do PATH. `node apps/desktop/scripts/cinema-fixtures.mjs` gera 7 arquivos; `--long` acrescenta 2 de 10 min.

| Arquivo | Conteúdo |
|---|---|
| `h264-ac3-51.mkv` | H.264 High + AC-3 5.1 |
| `hevc10-hdr10-eac3-51.mkv` | HEVC Main10 com metadados HDR10 (BT.2020/PQ, mastering display, MaxCLL) + E-AC-3 5.1 |
| `hevc10-truehd-71.mkv` | HEVC Main10 + TrueHD. **O nome engana: o encoder TrueHD do ffmpeg aceita no máximo 6 canais, então a faixa é 5.1(side), não 7.1** (descoberto na rodada de correção) |
| `av1-opus-51.mkv` | AV1 + Opus 5.1 |
| `h264-dts-51.mkv` | H.264 + DTS 5.1 |
| `h264-aac-srt-ass.mkv` | H.264 + AAC 5.1 + faixas SRT e ASS + fonte anexada |
| `mpeg2-mp2.mkv` | MPEG-2 + MP2 (não suportado) |
| `dv-p5.mp4` | **não testado**: nenhuma ferramenta local escreve o RPU do Dolby Vision perfil 5 |
| `long-h264-1080p-10min.mkv`, `long-hevc10-4k-10min.mkv` | 435,9 MB e 1,99 GB (~25 Mbps), só para velocidade |

## Matriz MSE no Electron 45 (Step 3)

**Correção (rodada 1):** a primeira medição de 7.1 (que motivou o R8, hoje superado) usou a faixa do fixture `hevc10-truehd-71`, que na verdade é 5.1, e
concluiu errado que o Chromium não entrega 8 canais. Refeito com um WAV de 8 canais verdadeiros (um tom por canal, ordem
do FFmpeg FL FR FC LFE BL BR SL SR), sem outra mudança: Opus 7.1 e FLAC 7.1 entregam os 8 canais com o tom certo
(tabela abaixo, com o 2º pico de cada canal no JSON do script). A falha dos números antigos era de fixture, não de
mapeamento nem de perda. Só o AAC 7.1 continua falhando (não anexa no MSE). Comando:
`node apps/desktop/scripts/cinema-spike.mjs --phase=mse --mse-rows="7\.1" --ffmpeg=<pasta LGPL>`.

Remux com o ffmpeg LGPL (vídeo copiado; áudio convertido) para fMP4 fragmentado; `MediaSource` + `<video>` numa janela
real; 10 s tocando. Nível e frequência de cada canal lidos por `AnalyserNode` atrás de um `ChannelSplitter`; um canal só
conta como "ok" se passar de -60 dBFS **e** o pico estiver no tom daquele canal (prova de mapeamento certo, não só de
presença). O áudio nunca vai às caixas (o grafo termina num ganho 0).

### Reprodução real

| Faixa | `isTypeSupported` | Toca 10 s | Canais ok | Observação |
|---|---|---|---|---|
| H.264 (`avc1.640028`) | sim | sim | 6/6 | 247 quadros, 0 descartados |
| HEVC Main10 (`hvc1.2.4.L120.B0`) | sim | sim | 6/6 | 248 quadros, 0 descartados; HDR não avaliado numa tela SDR |
| AV1 (`av01.0.08M.08`) | sim | sim | 6/6 | 246 quadros, 0 descartados |
| AAC 5.1 (640k, re-encodado) | sim | sim | 6/6 | -15 dBFS por canal, tons certos |
| AAC 5.1 (cópia da fonte) | sim | sim | 6/6 | |
| Opus 5.1 | sim | sim | 6/6 | exige relabel `aformat=channel_layouts=5.1` na entrada do libopus |
| FLAC 5.1 | sim | sim | 6/6 | |
| AAC 7.1 | sim | **não** | n/d | `SourceBuffer error` ao anexar |
| Opus 7.1 | sim | sim | 8/8 | -15 dBFS por canal, tons nos canais certos |
| FLAC 7.1 | sim | sim | 8/8 | idem |
| AC-3 / E-AC-3 em MP4 | **não** | não | n/d | `addSourceBuffer` recusa o tipo |

**Só vale para esta máquina.** HEVC depende do decoder de hardware (GPU/driver) e AV1 também; em outro PC o mesmo
`isTypeSupported` pode dizer sim e a reprodução falhar, ou o contrário. O motor não pode assumir estes resultados: a Task 12
deve sondar em tempo de execução (`canPlay`/`isTypeSupported` mais um teste de decodificação) e cair para transcodificação
de vídeo ou aviso quando falhar.

### `isTypeSupported` do restante

Sim: `avc1`, `hvc1`/`hev1` (Main e Main10), `av01` 8 e 10 bits, `vp09`, `video/webm vp9`, `mp4a.40.2`, `mp4a.40.5`,
`opus`, `flac` em MP4, `audio/webm opus` e `vorbis`.
Não: Dolby Vision (`dvh1.05.06`, `dvhe.08.06`), `mp4v.20.9` (MPEG-2/4), `ac-3`, `ec-3`, `mp4a.a5`, `mp4a.a6`, DTS
(`dtsc`, `dtsh`), TrueHD (`mlpa`), `mp3` em MP4, `audio/flac`, `audio/ogg flac`.

Consequências para o motor: AC-3, E-AC-3, DTS e TrueHD precisam de transcodificação de áudio (nenhum passa direto).
HEVC e AV1 passam direto (cópia de vídeo). MPEG-2 não toca (o remux funciona, a decodificação não). Dolby Vision perfil 5
não tem tipo suportado: tratar como não suportado ou avisar (o fixture não pôde ser testado). Canais: o Chromium entregou 8 discretos para Opus e FLAC 7.1; não há teto técnico de 6 (Ruling R10 supera o R8); só o AAC 7.1 não anexa.

## Velocidade do ffmpeg LGPL (Step 4, só fixtures)

Tempos em segundos; "×" = duração do arquivo / tempo gasto. Remux = `-c:v copy` para HLS fMP4, `-hls_time 4`.
Áudio = primeira faixa convertida para HLS fMP4. Um filme real do dono ficou **pendente (Task 15)**; os arquivos de
10 min dão a ordem de grandeza.

| Arquivo | Dur. | Keyframes (n, s, ×) | Remux vídeo (s, ×) | AAC 640k (×) | Opus (×) | FLAC (×) |
|---|---|---|---|---|---|---|
| h264-ac3-51 | 20 s | 10, 0,04, 500 | 0,06, 326 | 24 | 54 | 184 |
| hevc10-hdr10-eac3-51 | 20 s | 10, 0,04, 500 | 0,05, 422 | 23 | 55 | 194 |
| hevc10-truehd-71 | 20 s | 10, 0,04, 500 | 0,05, 385 | 38 | 53 | 66 |
| av1-opus-51 | 20 s | 10, 0,05, 400 | 0,06, 319 | 37 | 58 | 154 |
| h264-dts-51 | 20 s | 10, 0,04, 500 | 0,06, 318 | 37 | 54 | 169 |
| h264-aac-srt-ass | 20 s | 10, 0,05, 400 | 0,06, 311 | 38 | 55 | 179 |
| mpeg2-mp2 | 20 s | 40, 0,04, 500 | 0,10, 198 | 35 | 205 | 370 |
| **long 1080p H.264** | 10 min | 300, 0,23, 2609 | 0,81, 742 | 24 | 60 | 283 |
| **long 4K HEVC10 (1,99 GB)** | 10 min | 300, 0,58, 1035 | 3,46, 174 | 24 | 60 | 291 |

Obs.: a linha `hevc10-truehd-71` é TrueHD 5.1 (ver Fixtures), não 7.1.

Leitura: listar keyframes e remuxar vídeo são desprezíveis (4K de 10 min em 0,6 s e 3,5 s). O gargalo é o encoder
AAC nativo, ~24x em tempo real com 1 thread: um filme de 2 h converte o áudio inteiro em ~5 min, bem à frente do
playhead se o motor trabalhar por janela. Opus é 2,5x mais rápido; FLAC ~12x. O libopus exige o relabel de layout
(`5.1(side)` e `7.1(wide)` são recusados). Obs.: o ffmpeg lê o arquivo inteiro para listar keyframes (sem índice);
em disco lento isso passa a pesar mais que a CPU.

## Data channel (Step 5)

Duas instâncias do Electron na mesma máquina, `RTCPeerConnection` sem ICE servers, pedaços de 224 KiB, alto/baixo de
4 MiB / 1 MiB com `bufferedAmountLowThreshold`, 10 s por rodada (1 s inicial descartado).

| `RTCPeerConnection` por par | Mbps sustentado (total) | Por conexão | Caminho |
|---|---|---|---|
| 1 | 381,7 | 381,7 | `host`/`host`, UDP |
| 2 | 414,8 | 207,4 | `host`/`host`, UDP |

Loopback é teto de CPU, não de rede: serve para dizer que o data channel **não** é o limite do código (400 Mbps cobre um
4K de 100 Mbps com folga) e que uma segunda conexão rende só ~9 % a mais na mesma máquina. Entre duas casas o limite é
janela/RTT (a janela do SCTP no Chromium é de ~1 MiB: a 40 ms de RTT dá no máximo ~200 Mbps por conexão); `netem`
(`udp-impair.mjs`) não existe neste worktree e não foi simulado. **Entre duas casas e "direto ou relay": pendente (Task 15).**

## Relógio pelo gateway (Step 6)

Contra um servidor local descartável (`apps/server`, PGlite em memória, porta 4010), não contra o staging: o staging
exige criar contas e não havia credenciais prontas. 2 clientes, `identify` e depois `heartbeat`/`heartbeat_ack` a cada
500 ms, 100 amostras cada.

| | n | mín. | mediana | p95 | máx. |
|---|---|---|---|---|---|
| RTT no gateway local (ms) | 200 | 0,19 | 0,39 | 0,61 | 1,67 |
| GET HTTP com keep-alive no staging público, sem conta (ms) | 39 | 150,9 | 166,3 | 216,5 | 341,4 |

A primeira linha é o piso do código do gateway (custo de processar o frame), não a rede. A segunda é um substituto de
rede **sem credenciais**: `GET /legal` na API pública do staging a partir desta máquina (a amostra do handshake TLS
foi descartada). Não é o gateway, e inclui o processamento HTTP.

**Não medido: o Step 6 contra o WebSocket do staging.** Sem contas, só temos o piso local e o substituto HTTP. A decisão
"só gateway" é **provisória (Ruling R9)**. A regra do brief ("só gateway se p95 ≤ 80 ms") **não** é satisfeita por
nenhum dado deste spike: o piso local (0,6 ms) não mede rede, e o substituto HTTP (mediana 166 / p95 216 ms) está acima
de 80. Pelo R9, o RTT do staging não decide a precisão do offset: o erro vem da assimetria do caminho, e o filtro de menor
ida e volta o reduz. O número real do WebSocket e o erro entre clientes (rVFC) são medidos na Task 15; se não bater a meta,
entra o refinamento P2P.

Achado útil para a Task 12: o gateway fecha o socket com 4008 depois de 120 frames em 60 s (`socket.ts:17,216`, inclui
`identify`). 100 pings em 50 s cabem; os ops do cinema precisam do orçamento próprio já previsto no spec.

## Eco (Step 7): pendente (Task 15)

Não foi tocado áudio alto nesta máquina. Procedimento para o dono, com caixa de som ligada:

1. Instância A entra numa call LiveKit com B (microfone real em A, B só ouve) e abre uma fixture num `<video>`.
2. **Caminho 1 (WebAudio puro):** `createMediaElementSource(video)` → `GainNode` → `AudioContext.destination`.
   Registrar, em B, o nível do áudio do filme que chega de A (`inbound-rtp.totalAudioEnergy` do track do microfone de A,
   média de 20 s, com o filme tocando e A calado), com o processamento de áudio do Chromium ligado (AEC/NS/AGC) e
   desligado.
3. **Caminho 2:** `createMediaElementSource(video)` → `MediaStreamAudioDestinationNode` → `<audio>` com
   `srcObject = destination.stream` (mesmo dispositivo de saída).
4. Atenuação em dB de cada caminho = (nível sem processamento) - (nível com processamento). Vence o caminho com mais
   atenuação; se nenhum passar de ~20 dB, decisão: **aviso de fone** [dono].

Hipótese a verificar (não medida): o AEC do Chromium só tem como referência o áudio que sai pelo mesmo pipeline de
saída de áudio do renderer; os dois caminhos podem se comportar diferente justamente por isso.
