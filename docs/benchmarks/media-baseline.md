# Linha de base de mídia (voz + tela) — 2026-11-01

Medições reais do motor de mídia (`apps/desktop/src/renderer/src/media`) com **duas instâncias Electron separadas** (`--profile=lab-a` e `--profile=lab-b`) falando por um **SFU LiveKit local**. Nada aqui é mock: áudio passa por Opus/RTP/SFU, vídeo por captura de tela real, encoder, SFU e decoder.

- Reproduzir: `node apps/desktop/scripts/media-lab.mjs` (fases: `--phase=voice,speech,codecs,screen,synthetic,reconnect`; `--codec=h265|h264`; `--proposed-csp`).
- Dados brutos (todas as amostras, por processo): [`media-baseline.json`](media-baseline.json).
- Capturas do MediaLab durante os testes: `docs/screenshots/2026-11-01-media-lab-*.png`.

## Ambiente [MEDIDO]

| Item | Valor |
|---|---|
| SO | Windows 11 Pro 10.0.26300 |
| CPU / GPU | Intel i5-13600KF (20 threads lógicas, sem iGPU) / NVIDIA RTX 3070, driver 32.0.16.1088 |
| Monitor | 1920×1080 (consulta DPI-aware), ~180 Hz (`requestAnimationFrame` a 182 Hz) |
| Runtime | Electron 45.2.1 / Chromium 156.0.8078.75, `livekit-client` 2.23.0 |
| SFU | LiveKit 1.13.11 (mesmo binário de `scripts/livekit.mjs`), em `127.0.0.1:7890` com config própria do lab (portas 7890/7891/50300-50400), para não colidir com o SFU de dev da equipe em `:7880` |

**Como ler CPU:** `app.getAppMetrics().cpu.percentCPUUsage` do Electron é **% da máquina inteira** (calibrado: uma thread 100 % ocupada = 4,9 %). Aqui **5 % ≈ 1 núcleo lógico**. Valores somam todos os processos da instância (browser, GPU, utility, renderer). Memória = soma de `privateBytes` (privada) por instância.

## Resumo

| Métrica | Resultado | |
|---|---|---|
| Latência de áudio A→B pelo SFU (modo Desligado) | mediana **46,3 ms**, p95 49,5 ms (n=40) | [MEDIDO] |
| Latência A→B, modo Padrão (APM) | mediana **53,0 ms**, p95 55,4 ms (n=40) | [MEDIDO] |
| Latência A→B, Supressão avançada (RNNoise, CSP proposta) | mediana **62,1 ms**, p95 64,6 ms (n=40) | [MEDIDO] |
| Tempo de entrada no canal | 1ª entrada do processo 168–216 ms; seguintes mediana **132 ms**, p95 137 ms (n=7) | [MEDIDO] |
| Recuperação após reiniciar o SFU (queda de 3,1 s) | mediana **3,4 s** depois do SFU voltar (política nova) vs 6,0 s (padrão do LiveKit) | [MEDIDO] |
| Opus negociado | mono, `usedtx=1`, `useinbandfec=1`, RED (pt 63 `111/111`), teto 64 kbps | [MEDIDO] |
| Tela 1080p60, HEVC por hardware (NVENC) | **49 fps** enviados / 50 recebidos, 1920×1080, 9,4 Mbps, 0 congelamentos, CPU 3,4 % (≈0,7 núcleo) | [MEDIDO] |
| Tela 4K30 (fonte sintética), HEVC NVENC | **30 fps** 3840×2160, 19,5 Mbps, sem limitação, CPU 4,0 % | [MEDIDO] |
| Ocioso | 0,0 % CPU, **~200 MB** privados por instância (Discord: ~808 MB) | [MEDIDO] |
| Em chamada (só voz) | 1,7 % CPU (≈0,3 núcleo), 370 MB privados (quem fala) | [MEDIDO] |

## 1. Voz

### 1.1 Latência boca→ouvido A→B pelo SFU [MEDIDO]

**Método.** A instância A recebe pelo microfone falso do Chromium (`--use-fake-device-for-media-stream --use-file-for-fake-audio-capture=beeps.wav`) um WAV gerado com ffmpeg: *bursts* de 40 ms de 1 kHz a −10 dBFS a cada 750 ms sobre silêncio digital. Em A, um `AnalyserNode` lê a faixa **crua** do microfone (antes do nosso processamento). Em B, outro lê a faixa **remota** de A, já decodificada e após o jitter buffer. A cada 2 ms cada lado procura, dentro da janela de 2048 amostras, a **primeira amostra acima de −30 dBFS** após ≥250 ms de silêncio. O instante dessa amostra vem em `performance.timeOrigin + performance.now()`. As duas instâncias usam o mesmo relógio da máquina. O deslocamento entre os dois renderers foi medido (25 idas e voltas via Playwright, melhor RTT 0,7–1,4 ms): **|offset| ≤ 0,1 ms**, e foi descontado. Cada onset de A é pareado com o primeiro de B nos 400 ms seguintes. Janelas de 30 s, 40 amostras por modo, 0 perdidos em todos. Entrada em **detecção de voz automática**: o caminho inclui o *lookahead* de 10 ms do gate e o DTX.

| Modo de processamento | n | mediana | p95 | mín–máx |
|---|---|---|---|---|
| Desligado (sem APM) | 40 | **46,3 ms** | 49,5 ms | 41,7–49,7 ms |
| Padrão (APM: eco + ruído + ganho) | 40 | **53,0 ms** | 55,4 ms | 48,7–55,5 ms |
| Supressão avançada (RNNoise + eco + ganho)¹ | 40 | **62,1 ms** | 64,6 ms | 56,7–65,4 ms |

Repetibilidade: em 3 rodadas no mesmo dia, a mediana do Desligado variou de 46,3 a 53,4 ms e a do Padrão de 53,0 a 57,5 ms.

¹ Medido com a CSP proposta (ver 1.4). O RNNoise soma **+9 ms** ao Padrão, coerente com seu quadro de 10 ms.

**O que isso não inclui:** a latência do hardware de áudio. A entrada falsa não tem ADC, e B mede antes do dispositivo de saída. O contexto de reprodução de B reporta `baseLatency` 10 ms e `outputLatency` 42 ms. É uma estimativa do Chromium com o dispositivo de saída falso, não uma medição. Boca→ouvido real = valor acima + captura do microfone + saída do fone. **PENDENTE:** medir com cabo de loopback físico.

### 1.2 Tempo de entrada [MEDIDO]

`media.join()` → conectado **e** microfone publicado, por `performance.now()` no renderer.

- Primeira entrada do processo (WebRTC frio, worklet carregando): 216 ms (B) e 168 ms (A).
- Entradas seguintes (A sai e entra 7×): mediana **132 ms**, p95 137 ms, mín 131, máx 137.
- Outra rodada no mesmo dia: mediana 171 ms, p95 470 ms (n=6). Em localhost isso é praticamente só sinalização + ICE/DTLS.

### 1.3 Opus negociado [MEDIDO]

Fonte: SDP de oferta e resposta do PeerConnection de publicação (`publisherSdpAudio()`), `RTCRtpSender.getParameters()` e `getStats()`.

- Resposta do SFU para Opus (o que o encoder obedece): `a=fmtp:111 minptime=10;usedtx=1;useinbandfec=1`. **Sem `stereo=1`, então o encoder é mono.** **DTX ligado, FEC in-band ligado.**
- **RED negociado:** `a=rtpmap:63 red/48000/2`, `a=fmtp:63 111/111` (cada pacote carrega o quadro anterior). Na lista de codecs do sender, `audio/red` vem antes de `audio/opus`.
- Bitrate: `encodings[0].maxBitrate = 64000` e `targetBitrate = 64000` (o padrão por canal; `VoiceJoinResponse.bitrateKbps` sobrescreve).
- **O DTX funciona (pacotes/s de `outbound-rtp`):**

  | Situação | pacotes/s | kbps |
  |---|---|---|
  | B com microfone em silêncio | 4,8 | 0,1 |
  | A com bipes (~45 % do tempo aberto, por causa da retenção) | 21,3 | 26 |
  | A com fala contínua (TTS) | 32,6–33,7 | 75–79 |

  Os 75–79 kbps em fala incluem o RED (redundância) e os cabeçalhos RTP. O teto do Opus é 64 kbps.
- O FEC só entra em ação quando o receptor reporta perda. Em localhost a perda foi 0 %. **PENDENTE:** a eficácia de FEC e RED com perda real.

### 1.4 Processamento e onsets de fala [MEDIDO]

- **Com a CSP do app como está (`script-src 'self'`), o WebAssembly é bloqueado.** O RNNoise não roda (o worklet sairia mudo). O motor detecta isso compilando o `.wasm` antes de usar. Ele cai para o Padrão e avisa: `processingActive: "standard"`, aviso "*Supressão avançada indisponível (a CSP do app bloqueia WebAssembly…)*", microfone `live`. **Para ligar a Supressão avançada, falta `'wasm-unsafe-eval'` em `script-src`** (fora do meu escopo: `src/renderer/index.html` + `FALLBACK_CSP` em `src/main/security.ts`). As medições de RNNoise usaram `--proposed-csp`. Essa opção aplica a mudança **só no `index.html` do build do lab** e a desfaz no fim.
- **Fala real (TTS Windows SAPI, pt-BR, 8 frases com pausas de 900 ms):** limiar de onset −40 dBFS, silêncio ≥400 ms, 40 s por modo.

  | Modo | onsets de frase entregues | atraso do onset (mediana / p95) |
  |---|---|---|
  | Desligado | 11/11 | 51,3 / 63,3 ms |
  | Padrão | 11/11 | 38,7 / 52,9 ms |
  | Supressão avançada | 11/11 | 45,5 / 53,1 ms |

  Nenhum modo perdeu o começo de uma frase. Em fala o onset é gradual, então a dispersão (±10 ms) reflete onde o limiar cruza a envoltória, que muda com AGC/NS. A latência precisa é a dos bipes (1.1). Não há atraso extra que indique corte de sílaba inicial no RNNoise.
- **PENDENTE:** avaliar se o RNNoise deixa a voz "robótica" em horas de uso. Isso exige teste de escuta (MOS/ABX) com microfones e ruídos reais e não é mensurável por esse arranjo.

### 1.5 Reconexão após matar o SFU [MEDIDO]

**Método.** Com A e B na sala, o processo `livekit-server` do lab é morto com `taskkill /T /F`. Depois de ~3,1 s ele é religado (sobe em 60–124 ms). O estado de cada instância (`connection.state` e `readyState` da faixa do mic) é amostrado a cada 100 ms. São 3 rodadas por configuração. "Recuperado" = `connected` com o outro participante de volta.

| Política de reconexão | recuperação depois do SFU voltar (6 amostras: A e B × 3) | `reconnecting → connected` (inclui os 3,1 s fora) |
|---|---|---|
| Padrão do LiveKit `[0, 300, 1200, 2700, 4800, 7000…]` | 4,5 / 6,8 / 6,7 / 4,7 / 8,3 / 5,4 s → mediana **6,0 s** | mediana 8,7 s |
| **Nova (adotada)** `[0, 300, 600, 1000, 1500, 2000, 2500, 3000…]` | 2,4 / 6,1 / 3,8 / 3,0 / 4,5 / 2,9 s → mediana **3,4 s** | mediana 6,3 s |

- Durante `reconnecting` o microfone continua `live`. Isso é esperado: a faixa é mantida para retomar sem pedir o dispositivo de novo.
- O caminho "reconexão falhou de vez → captura parada" está implementado (`teardown()` no `Disconnected`), mas **não foi exercitado**, porque o SFU sempre voltou. **PENDENTE:** testar com o SFU fora por mais de 45 s.

### 1.6 CPU e memória — voz [MEDIDO]

Amostras a cada 1 s via `electronApp.evaluate(() => app.getAppMetrics())`.

| Estado | Instância | CPU (mediana / p95, % da máquina) | Privada (MB) | Working set (MB) |
|---|---|---|---|---|
| Ocioso (rota padrão do app, 20 s) | A | 0,0 / 1,0 | 201,8 | 338 |
| Ocioso | B | 0,0 / 0,1 | 200,4 | 413 |
| Em chamada, só voz (30 s; A falando bipes, B ouvindo) | A | 1,7 / 2,2 (≈0,34 núcleo) | 369,9 | 649 |
| Em chamada | B | 0,5 / 0,7 | 331,9 | 687 |

Por processo, em chamada (A): renderer 0,9 % / 114 MB, GPU 0,7 % / 95 MB, utility (áudio/rede) 0,1 % / 86 MB, browser 0 % / 75 MB. **Referência: o Discord ocioso usa ~808 MB privados** (`docs/research/discord-benchmark.md`). Estamos em ~1/4.

## 2. Transmissão de tela

**Fonte.** O monitor desta máquina é **1080p**. A captura real é da tela inteira (`window.alga.screen.getSources/select` → `getDisplayMedia`) com um padrão em movimento em tela cheia por cima (`ffplay testsrc2 1920x1080@60`). Sem encoder, a captura crua desse padrão entrega **51,9 fps** (`MediaStreamTrackProcessor`, 5 s). Esse é o teto da fonte, não do pipeline. Resoluções acima do monitor usam um `<canvas>` sintético em movimento (`syntheticScreen`) publicado pelo mesmo caminho (`startScreenShare({ stream })`).

**Viewer.** B assiste em "Original" (top layer). As métricas vêm de `getStats()` a cada 1 s (fps, resolução, bitrate, encoder/decoder, `powerEfficient*`, `qualityLimitationReason`, congelamentos). O ritmo de quadros vem de `requestVideoFrameCallback` no `<video>` de B. Medição após 12 s de rampa do estimador de banda.

> **Armadilha encontrada:** `--use-fake-device-for-media-stream` troca o `getDisplayMedia` por uma fonte falsa do Chromium a **20 fps** (id `screen:-3:0`). A primeira matriz de codecs saiu toda a 20 fps por isso e foi descartada. Nas fases de tela, A roda **sem** dispositivos falsos e sem microfone. B usa um microfone falso mudo, porque o Chromium só expõe `encoder/decoderImplementation` para páginas que estão capturando.

### 2.1 1080p60, captura real, 60 s [MEDIDO]

| | **HEVC (NVENC)** | H.264 (OpenH264, software) |
|---|---|---|
| Codec negociado | `video/H265 profile-id=1` | `video/H264 profile-level-id=42e01f` |
| Encoder | `MediaFoundationVideoEncodeAccelerator (NVIDIA HEVC Encoder MFT)` ×3 camadas, `powerEfficientEncoder: true` | `OpenH264` ×3, `false` |
| Envio (camada alta) | **49 fps** mediana, 1920×1080 | 48 fps, 1920×1080 |
| Bitrate total (3 camadas de simulcast) | 9,4 Mbps | 9,8 Mbps |
| `qualityLimitationReason` | `none` em 59/59 amostras | `none` 59/59 |
| Recepção | 50 fps, 1920×1080, `D3D11VideoDecoder` (HW), 0 congelamentos, 0 quadros descartados, jitter buffer 7,9 ms | 48 fps, D3D11 (HW), 0 congelamentos, jitter buffer 8,3 ms |
| Ritmo no receptor (rVFC, ~2 900 quadros) | média 20,3 ms, desvio 6,9, p95 33,5, p99 39,0, máx 55,6 ms | 20,7 / 7,3 / 38,8 / 39,1 / 55,8 ms |
| CPU (mediana / p95) | A **3,4 / 4,0 %** (renderer 1,1, GPU 0,9, browser 1,2); B 1,3 % | A 3,4 / 3,8 % (**renderer 2,0**, GPU 0); B 1,3 % |
| Memória privada | A 542 MB (GPU 264 MB), B 358 MB | A 439 MB (GPU 98 MB), B 354 MB |

O pipeline entregou 49–50 dos ~52 fps que a fonte produz (−6 %). O ritmo no receptor segue a cadência irregular da fonte: deltas de 16,7/33,3 ms num monitor de 180 Hz. **PENDENTE:** 60 fps reais com fonte de 60 fps garantidos (jogo ou captura de jogo).

### 2.2 Matriz de codecs, 1080p60 captura real, 25 s cada [MEDIDO]

| Codec | fps enviados (mediana) | resolução alta | Mbps | limitação | encoder | CPU A (renderer) | Privada A |
|---|---|---|---|---|---|---|---|
| **H.265** | 47 | 1920×1080 | 9,5 | none | NVIDIA HEVC MFT (HW) | 3,2 % (1,0 %) | 606 MB |
| H.264 | 49 | 1920×1080 | 9,8 | none | OpenH264 (SW) | 3,3 % (2,0 %) | 445 MB |
| VP8 | 48 | 1920×1080 | 10,1 | none | libvpx (SW) | **6,9 % (5,3 %)** | 609 MB |
| VP9 | 4 | só 720p/360p | 0,9 | bandwidth | libvpx (SW) | 1,7 % | 1 019 MB |
| AV1 | 0 | só 360p | 0,9 | bandwidth | libaom (SW) | 1,8 % | 1 102 MB |
| H.264 + `--enable-features=PlatformH264CbpEncoding` | 47 | 1920×1080 | 9,6 | none | **ainda OpenH264** | 3,4 % (2,0 %) | 481 MB |
| H.264, conteúdo "detalhe" (`maintain-resolution`) | 15 | 1080p (cai) | 2,0 | bandwidth 13/24 | OpenH264 | 3,7 % | — |

- **Recepção:** decodificação por hardware (`D3D11VideoDecoder`) para H.264/HEVC/VP9/AV1, `libvpx` (software) para VP8. H.264/HEVC estão no JSON (2.1). VP8/VP9/AV1 vêm do log da rodada descartada (fonte falsa de 20 fps; a escolha do decoder não depende da fonte), porque nesta matriz B ainda não capturava e o Chromium ocultou `decoderImplementation`.
- `mediaCapabilities.encodingInfo({type:'webrtc'})` nesta máquina: `powerEfficient` **true só para H.265** e false para H.264/VP8/VP9/AV1. A decodificação é `powerEfficient` para H.264/H.265/VP9/AV1. O probe bate com o encoder realmente usado.
- A memória privada do renderer de A cresceu a cada sessão de tela no mesmo processo: 143 → 302 → 708 → 797 → 889 MB ao longo de VP8/VP9/AV1/detalhe. **PENDENTE:** descobrir se é vazamento (motor/LiveKit) ou cache dos encoders de software. Repetir 20× start/stop com o mesmo codec.

### 2.3 Acima de 1080p (fonte sintética) [MEDIDO, com ressalva]

| Preset | Codec | fps enviados | resolução | Mbps | limitação | CPU A |
|---|---|---|---|---|---|---|
| 4K30 | **H.265 NVENC** | **30** | 3840×2160 | 19,5 | none 24/24 | 4,0 % (GPU 2,7 %) |
| 4K30 | H.264 OpenH264 | 30 | cai para 2560×1440 | 19,5 | **cpu 18/24** | 5,2 % (renderer 4,3 %) |
| 1440p60 | H.265 NVENC | 31 (fonte: 57) | 2560×1440 | 15,9 | none | 3,6 % |
| 1440p60 | H.264 OpenH264 | 7 | 2560×1440 | 6,0 | none | 3,2 % |

- **4K30 é conclusivo:** o NVENC segura 3840×2160@30 sem limitação. O OpenH264 é limitado por CPU e o WebRTC rebaixa a resolução.
- **1440p60 é inconclusivo.** O canvas sintético produz 54–57 fps quando lido direto, mas no caminho WebRTC chegou a 20–31 fps com `qualityLimitationReason: none` (o encoder não era o gargalo). Isso também ocorreu em 1080p sintético (20 fps contra 49 fps da captura real). É um artefato da fonte de teste. **PENDENTE:** 1440p60 com monitor 1440p real.
- [HIPÓTESE] A taxa de pixels de 4K30 (249 Mpx/s) é maior que a de 1440p60 (221 Mpx/s) e o NVENC segurou 4K30 sem limitação. Então o NVENC deve segurar 1440p60. Isso não foi medido.

## 3. O que localhost não prova (PENDENTE)

- **Rede real:** RTT > 1 ms, jitter, perda, NAT/TURN/TCP, rampa do estimador de banda em uplinks domésticos (o simulcast desliga a camada alta quando a banda não chega), eficácia de FEC e RED sob perda.
- **Máquinas independentes:** relógios separados, outras GPUs (AMD AMF, Intel QSV), CPUs fracas, notebook na bateria, espectador sem decodificação HEVC por hardware (caminho do codec reserva H.264 não exercitado: aqui todos decodificam HEVC).
- **Latência de hardware de áudio:** ADC/DAC, buffers WASAPI, Bluetooth.
- **60 fps reais** e **1440p60 real** (limites da fonte de teste e do monitor desta máquina).
- **Qualidade perceptual:** VMAF/PSNR de HEVC vs H.264 a 8 Mbps; MOS/ABX de voz e RNNoise.
- **Sessões longas (horas):** memória, deriva, estabilidade. Inclui o crescimento de memória visto em 2.2.
- **Não exercitado na automação** (lógica implementada): troca/desconexão física de dispositivo, PTT por atalho global, falha definitiva de reconexão, áudio do sistema na live (o engenheiro nativo mediu `restrictOwnAudio` em `docs/decisions/0002-screen-audio-capture.md`; o motor já pede a constraint).
