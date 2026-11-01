# E2EE na mídia (fase 1b) e regressões de tela — 2026-11-01

Mede o motor de mídia com E2EE de verdade: MLS (OpenMLS no `utilityProcess`, fase 1a), o Delivery Service da nossa API,
o cifrador de quadros do `livekit-client` com uma chave por remetente, RED restaurado e o codec escolhido pela sala.
Também as regressões que o QA achou na tela (BUG-02, BUG-03 de `docs/qa/2026-11-01-report.md`), antes e depois.
Decisão: `docs/decisions/0004-e2ee.md` §11. Contrato para a UI: `apps/desktop/src/renderer/src/media/README.md` §E2EE.

- Reproduzir: `node apps/desktop/scripts/media-e2ee.mjs` (ou `media-lab.mjs --e2ee`), fases `--phase=bugs,join,codec,nokey,cpu,loss`.
- Dados brutos: [`e2ee-media.json`](e2ee-media.json).

## Resumo [MEDIDO]

| Medida | Meta (0004 §4.6) | Resultado | |
|---|---|---|---|
| Entrada até o primeiro áudio decifrado, p50 / p95 | p95 +≤ 150 ms | 309 / 497 ms contra 309 / 355 ms sem E2EE: **+0 / +142 ms** (o p95 é uma entrada só; MLS ativo em p50 39 / p95 67 ms, em paralelo) | ✅ (por pouco) |
| CPU por faixa de voz, transmissor / receptor | +≤ 1 % de um núcleo | **+0,6 / +0,9** (RED ligado; receptor com janelas ruidosas descartadas, §6) | ✅ no limite |
| CPU da tela (1280×720 a ~48 fps, HEVC), transmissor / espectador | +≤ 3 % | **+2,2 / +1,3** | ✅ |
| Voz a 5 / 10 % de perda, RED restaurado | ≈ sem E2EE | 0,9–1,5 / 0,7–1,2 % contra 0,5–0,9 / 1,1–2,0 % sem E2EE; sem RED 1,9–2,2 / 1,7–3,4 % | ✅ (ruído alto, §7) |
| Espectador sem HEVC entra numa transmissão E2EE | recebe vídeo | A muda para H.264 e C tem imagem em 0,9–2,0 s; quando C sai, volta a HEVC (3/3) | ✅ |
| Cliente sem chaves na sala | 0 quadros | **0 de 591** quadros decodificados, áudio sem energia; `mismatch = ["intruder"]` em A e B | ✅ |
| QA BUG-02 (janela 640×360) | B vê a janela | antes **0/16**, depois **24/24** (H.264); reserva em tempo de execução 2/2 | ✅ |
| QA BUG-03 ("Original", 60 fps ao vivo) | 960×540, ~60 fps | antes 640×360 a 30 fps; depois **960×540**, **46–47 fps em 10 s, 50 em 25 s** (igual a começar em 60) | ✅ |

## Montagem

- **Máquina:** i5-13600KF (20 threads) + RTX 3070, Windows 11 Pro 10.0.26300, Electron 45.2.1 (Chromium 156), a mesma
  de `media-baseline.md`. "% de um núcleo" = tempo de CPU ÷ tempo de parede × 100 (`app.getAppMetrics()`,
  `cumulativeCPUUsage`, processo do renderer).
- **Pilha própria:** API em `:4470` (`--dev`, PGlite numa pasta temporária; é o Delivery Service), LiveKit 1.13.11 em
  `:7970` com webhook para ela, ICE-lite numa porta UDP só (`:7972`) atrás do proxy de `scripts/netem/udp-impair.mjs`
  (sem perda fora da fase de perda). Build do lab em `node_modules/.alga-e2ee-lab`, perfis `e2ee-lab-*`. Nada em
  `:4000`/`:7880`, nos perfis `default`/`bob` ou em `apps/desktop/out`; tudo o que o script sobe ele derruba.
- **Contas de verdade:** três usuários amigos e uma DM em grupo; cada instância entra como o app (`POST /voice/join` +
  `media.join`), com o main registrando o dispositivo e o MLS no `utilityProcess`. "Sem E2EE" = os dois lados com
  `media.labNoE2ee` (mesma sala, mesmo caminho, só sem MLS e sem cifrador).
- **Mídia:** microfone falso do Chromium (tom de 1 kHz contínuo para entrada e CPU; TTS pt-BR para perda). **Quem
  transmite roda sem dispositivos falsos** e captura uma janela de verdade (`ffplay testsrc2`, 60 fps): com
  `--use-fake-device-for-media-stream` o Chromium troca qualquer `getDisplayMedia` pela tela sintética dele, e foi por
  isso que BUG-02/BUG-03 escaparam dos labs anteriores.
- **Limites:** uma máquina, loopback, uma GPU NVIDIA, dois a quatro participantes; o `POST /voice/join` aceita 10 por
  minuto por usuário, então as entradas são espaçadas em 6,5 s.

## 1. BUG-02 — janela pequena, espectador sem imagem [MEDIDO]

A transmite uma janela `ffplay` de 640×360 (sem borda) ou 642×392 (com borda) em 720p30; B (RTX 3070, HEVC por hardware)
assiste em Automática. Sem E2EE, tokens diretos do LiveKit (é o caminho de hoje).

| | Antes (`HEAD`) | Depois |
|---|---|---|
| B vê imagem em 15 s | **0 de 16** (12 + 4 numa segunda rodada) | **24 de 24** (duas rodadas de 12) |
| Codec que sai | HEVC (as camadas ¼ são 160×90 e 160×98) | H.264 (regra `HEVC_MIN_SIDE`: camada < 144 px) |
| Decodificador em B | `NullVideoDecoder (fallback from: ExternalDecoder (D3D11VideoDecoder))`, 0×0, ~2 Mbps chegando | `ExternalDecoder (D3D11VideoDecoder)`, 640×360 / 640×392, 28–29 fps |
| Primeiro quadro | nunca | 51–1 329 ms (mediana ~1,17 s: espera o próximo quadro-chave) |

- **Causa:** a escada de 3 camadas de uma janela de 640×360 tem a camada ¼ com 90 px de altura. O decodificador HEVC
  por hardware (NVDEC: mínimo 144×144) recusa, o Chromium cai para o decodificador nulo (não há HEVC por software) e o
  receptor fica assim para sempre, mesmo quando o SFU passa para uma camada maior. O transmissor não percebe nada.
- **Reserva no espectador** (regra do transmissor desligada no lab com `hevcMinSide = 0`, para o HEVC sair e quebrar de
  propósito): B vê o `NullVideoDecoder`, deixa de anunciar HEVC (republica o microfone com `alga.decode` sem `h265`),
  A republica em H.264 e **B tem imagem 1,2–1,5 s depois do Assistir** (2 rodadas com HEVC saindo no começo). Nas
  seguintes A já começa em H.264: B não anuncia mais HEVC nesta sessão.

## 2. BUG-03 — "Original" e 60 fps ao vivo [MEDIDO]

A transmite uma janela de 960×540 em 720p30 (HEVC); B assiste numa área de 480×270 (o tamanho de um quadro no palco do
app, não o `<video>` grande do lab), escolhe **Original** e depois A troca para 720p60 ao vivo. 2 rodadas por build.

| | Antes (`HEAD`) | Depois |
|---|---|---|
| Automática (480×270 na tela) | 640×360 a 29 fps (certo: camada do meio) | 640×360 a 29–30 fps |
| **Original** | **640×360 a 29 fps**; camada alta pausada em A (ninguém a pede) | **960×540 a 29 fps** |
| Depois de 720p60 ao vivo, 10 s | 640×360 a 28–30 fps (captura de A já a 49–52 fps) | **960×540 a 46–47 fps** |
| Idem, 25 s | — | 960×540 a 50 fps (camada alta de A a 49 fps) |
| Maior intervalo entre quadros na troca | 56–67 ms | 39–61 ms |
| Referência: começar já em 720p60 | 960×540 a 48 fps | 960×540 a 50–52 fps |

- **Causa 1 (Original):** o `RemoteTrackPublication` do `livekit-client` guarda o tamanho do elemento que uma
  assinatura adaptativa anterior informou (`videoDimensionsAdaptiveStream`) e nunca o limpa. Depois de Original a faixa
  nova já não é adaptativa (`isAdaptiveStream: false`, medido), mas o pedido ao SFU continua sendo "480×270": camada do
  meio. O motor limpa o campo ao pedir a camada alta.
- **Causa 2 (60 fps):** com a camada alta pedida, a troca no lugar ainda deixava a camada alta em 30 fps: encodings com
  `maxFramerate` 60, captura a 47 fps, `qualityLimitationReason: none`, e 25 s depois igual (rodada intermediária).
  O encoder por hardware fica na taxa com que começou. Subir o fps agora republica a transmissão (encoder novo; quem
  assiste segue sozinho), como no rebaixamento de plano.
- **Achado no caminho:** a segunda captura da mesma janela às vezes não dá quadro dentro da sondagem de 1,5 s e o
  `getSettings()` informa o buffer (1280×720); a escada saía para 1280×720 aplicada a quadros de 960×540 (camadas de
  480×270 e 240×135 medidas). A camada de 135 px quebrava o HEVC do espectador. O motor guarda o tamanho real de cada
  captura.

## 3. Entrada com E2EE [MEDIDO]

B está na chamada; A entra (`POST /voice/join` + `media.join`, como o app) e sai, 20 vezes por modo, em blocos de 5
intercalados. Tom contínuo no microfone de A, processamento desligado, portão aberto (PTT). "Primeiro áudio" = do clique
de A até o primeiro áudio de A acima de −40 dBFS decodificado em B (relógios das duas instâncias alinhados, ±1 ms).

| n = 20 por modo | Sem E2EE | Com E2EE (MLS + cifrador) | Δ | Meta |
|---|---|---|---|---|
| `connection.joinMs` (conectado + microfone publicado) | p50 **206** / p95 **243** ms | p50 **205** / p95 **218** ms | −1 / −25 ms | — |
| **Primeiro áudio decifrado em B** | p50 **309** / p95 **355** ms | p50 **309** / p95 **497** ms | 0 / **+142 ms** | p95 +≤ 150 ms ✅ |
| Grupo MLS ativo (`e2ee.state = active`) | — | p50 **39** / p95 **67** ms | — | — |

- O MLS (Add pelo DS → commit de B → Welcome → `E2EE_EPOCH`) termina em ~40 ms, **em paralelo** com a conexão do
  LiveKit (~200 ms): a E2EE não atrasa a entrada. O p95 de 497 ms é uma entrada só (a segunda pior foi 319 ms, abaixo
  do p95 sem E2EE). Com n = 20 o p95 é o máximo: a meta passa por pouco por causa desse caso.
- A partida a frio do worker MLS e o registro do dispositivo acontecem no login (fase 1a) e ficam fora da entrada.
- Avisos esperados em B a cada entrada: "Unexpected SIF frame payload, dropping frame" (2 por entrada): quadros que o
  próprio SFU injeta (silêncio) não batem com o formato esperado com RED; o cifrador os descarta. Nada audível.

## 4. Codec pela sala, sem codec reserva (E2EE) [MEDIDO]

A transmite uma janela de 1280×720 em 720p60 numa chamada E2EE. B decodifica HEVC; C roda com
`--disable-features=PlatformHEVCDecoderSupport` (`RTCRtpReceiver.getCapabilities` sem H.265: C anuncia
`vp8,vp9,h264,av1`; B anuncia também `h265`). Com E2EE o `livekit-client` não publica codec reserva.

| 3 rodadas | Resultado |
|---|---|
| Só B assistindo | A envia **HEVC**, B decodifica (3/3) |
| C entra e assiste | A republica em **H.264**; B e C recebem H.264 (3/3); **C tem imagem 0,9–2,0 s depois de entrar** |
| C sai | A volta para **HEVC** sozinho; B segue com imagem (3/3) |

- Sem a escolha pela sala (o que o spike mediu, 0004 §6.2), C ficaria sem vídeo.
- O transmissor só conta **membros MLS**: o intruso do §5 (sem anúncio, sem folha) não força H.264.

## 5. Cliente sem chaves na sala [MEDIDO]

Uma quarta instância entra na sala do SFU com um token do LiveKit feito direto com a chave da API (o que o operador
do SFU poderia fazer), sem MLS e sem E2EE, e assina a tela de A e o microfone (tom) de B por 12 s.

| | Resultado |
|---|---|
| Vídeo | 591 quadros recebidos (4,4 MB), **0 decodificados, 0 quadros-chave** |
| Áudio | 614 pacotes recebidos, **energia de áudio 0** (nada decodificado como som) |
| `e2ee.mismatch` em A e em B | `["intruder"]` (lido 12 s depois; a carência é de 2 s); `e2ee.members` continuou com 2 |

## 6. CPU [MEDIDO]

Janelas intercaladas sem/com E2EE, mesma sala, instâncias novas para cada parte. Renderer, % de um núcleo (o cifrador
roda num worker do renderer, contado nele).

**Tela:** A transmite uma janela de 1280×720 a 60 fps (HEVC NVENC, 3 camadas, ~48 fps e 2,9 Mbps chegando); B assiste
em Original. 4 rodadas de 30 s por modo.

| | Sem E2EE | Com E2EE | Δ por par (média) | Meta |
|---|---|---|---|---|
| Transmissor | 11,3 / 12,1 / 11,5 / 13,4 (mediana 11,8) | 13,3 / 14,7 / 12,9 / 16,2 (mediana 14,0) | +1,4 a +2,8 (**+2,2**) | +≤ 3 ✅ |
| Espectador | 8,9 / 9,4 / 8,8 / 11,2 (mediana 9,2) | 9,9 / 11,3 / 9,6 / 12,7 (mediana 10,6) | +0,8 a +1,9 (**+1,3**) | +≤ 3 ✅ |
| Processo de GPU (A / B) | 9,8–11,9 / 8,4–10,0 | 9,4–11,6 / 8,0–10,1 | nenhum | — |

**Voz:** A manda um tom contínuo (sem DTX, portão aberto), B recebe. Janelas de 60 s, 10 pares intercalados (4 + 6 em
duas sessões). Com E2EE o RED está **ligado** (no spike estava desligado pelo SDK).

| | Sem E2EE | Com E2EE | Δ | Meta |
|---|---|---|---|---|
| Transmissor (10 pares) | 3,9–6,0 | 4,9–6,7 | **+0,6** de média (−0,4 a +1,2; mediana +0,9) | +≤ 1 ✅ |
| Receptor, janelas com a GPU de B ≤ 0,7 % (5 / 4) | 5,1–5,9 (média 5,4) | 5,8–7,2 (média 6,3) | **+0,9** (+1,0 com o corte em 1,2 %) | +≤ 1 ✅ no limite |
| Receptor, todas | 5,1–9,2 | 5,8–11,4 | −2,0 a +5,8 por par | — |

- Em 9 das 20 janelas o processo de GPU de B subiu de 0,3–0,7 % para 2,9–5 % e o renderer de B foi junto (+2 a +5),
  **nos dois modos** (4 sem E2EE, 5 com): o renderer compondo outra coisa, não o cifrador. Essas janelas ficam fora do
  Δ do receptor; com elas o par varia de −2,0 a +5,8 e não diz nada. O transmissor não teve isso.
- Mesma leitura do spike (+0,5 / +0,6): quase tudo é o custo fixo de cada quadro passar pelo worker, não o AES.


## 7. Voz sob perda: RED de volta com E2EE [MEDIDO]

TTS pt-BR em loop (como `media-network.md` §1), modo Padrão, VAD automático. Perda independente só na subida, RTT
50 ± 30 ms, janelas de 25 s, 2 rodadas por célula. Ocultação = amostras ocultadas fora do conforto do DTX ÷ amostras.

| Configuração | Enviado | 0 % | 5 % | 10 % | Microcortes/min a 10 % |
|---|---|---|---|---|---|
| Sem E2EE, RED (o padrão de hoje) | 49–67 kbps | 2,2 / 0,7 % | 0,5 / 0,9 % | 1,1 / 2,0 % | 19 / 24 |
| **Com E2EE, RED restaurado** | 54–58 kbps | 0,9 / 0,7 % | 0,9 / 1,5 % | **1,2 / 0,7 %** | **17 / 12** |
| Com E2EE, sem RED (o que o SDK fazia) | 30–31 kbps | 0,7 / 0,7 % | 2,2 / 1,9 % | 1,7 / 3,4 % | **58 / 34** |

- **O RED volta mesmo com E2EE:** o envio sobe de ~30 para ~55 kbps (o bloco redundante dentro do quadro cifrado) e
  o assinante recebe `audio/opus` decifrado. Sob perda, com RED a E2EE fica igual ao sem E2EE (5 e 10 % juntos: 1,1 %
  contra 1,1 %; microcortes 12–17 contra 19–24/min) e sem RED fica pior (2,3 % e 34–58/min).
- **Ruído alto nesta rodada:** a 0 % de perda a ocultação ficou em 0,7–2,2 % (no `media-network.md` era 0 %). A
  máquina estava em uso ao mesmo tempo (o app do dono e ~20 processos Electron de outras sessões) e são só 2 × 25 s por
  célula. Diferenças abaixo de ~1 p.p. aqui não são sinal. **PENDENTE:** repetir com a máquina livre e 5 rodadas para
  conferir o critério "≤ baseline + 0,2 p.p." do 0004 §4.6.


## Reproduzir

```bash
node apps/desktop/scripts/media-e2ee.mjs                       # tudo (~45 min): build do lab + pilha própria
node apps/desktop/scripts/media-e2ee.mjs --no-build --phase=bugs --reps=6 --tag=after
node apps/desktop/scripts/media-e2ee.mjs --no-build --phase=cpu --cpu=voice --rounds=6
node apps/desktop/scripts/media-e2ee.mjs --no-build --app=<outro build em node_modules/> --phase=bugs --tag=before
```

Precisa de `ffmpeg`/`ffplay` no PATH, do binário fixado do LiveKit (`node scripts/livekit.mjs`) e de duas IPv4 não
loopback (como `media-net.mjs`).
