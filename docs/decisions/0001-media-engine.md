# 0001 — Motor de mídia: voz e transmissão de tela

- Status: **aceita** (2026-11-01; revisada no mesmo dia: memória, janelas com HEVC, server mute, rede degradada)
- Escopo: `apps/desktop/src/renderer/src/media/**`, `apps/desktop/src/main/chromium-flags.ts`
- Evidência: `docs/benchmarks/media-baseline.md` (+ `media-baseline.json`, `media-memory.json`), gerada por `apps/desktop/scripts/media-lab.mjs`; rede degradada em `docs/benchmarks/media-network.md` (`apps/desktop/scripts/media-net.mjs` + `scripts/netem/udp-impair.mjs`)

## Contexto

Voz e tela são os dois pilares do produto. A barra é o Discord (`docs/research/discord-benchmark.md`). O Discord dá 720p30 de graça e 1080p60 só no Nitro. A voz dele é Opus com Krisp e o ocioso usa ~808 MB. Este documento registra como o cliente usa o LiveKit (D2) e por quê, com os números medidos nesta máquina (i5-13600KF + RTX 3070, Electron 45 / Chromium 156).

## Decisões

### 1. Um motor, uma porta de entrada

A UI usa apenas `media` (controlador) e `useMedia` (store zustand somente leitura), importados de `@/media`. Ninguém fora de `media/` importa `livekit-client`. Assim dá para trocar o SDK, testar a lógica pura e medir tudo pelo mesmo caminho que o app usa (o `MediaLab` e o script chamam a API pública). Contrato documentado em `media/README.md`.

### 2. Voz: Opus mono, 64 kbps por canal, DTX + RED + FEC

- **Bitrate por canal** vindo do servidor (`VoiceJoinResponse.bitrateKbps`). Padrão de **64 kbps**, que já é generoso para fala mono. O Discord limita servidores sem boost a 96 kbps.
- **DTX** ligado: em silêncio cai para 4,8 pacotes/s e 0,1 kbps [MEDIDO]. Num canal com 10 pessoas e uma falando, quase não se gasta banda.
- **RED** ligado (cada pacote leva o quadro anterior). **FEC in-band** (`useinbandfec=1`) ligado. Os dois ficam negociados no SDP [MEDIDO]. **Mantidos depois de medir sob perda** (proxy UDP local, `media-network.md` §2): a 10 % de perda a ocultação é 0,4–1,0 % com RED+FEC, 0,7–1,2 % só com RED, 6,0 % só com FEC e 6,3 % sem nada; a 5 %, 0,1–0,7 % contra 3,0 % sem proteção. O RED dobra a banda da fala (38 → 76 kbps); o FEC não muda a banda nem o jitter buffer de forma mensurável. Com RTT de 50 a 300 ms ± 30 ms e até 10 % de perda, a ocultação fica ≤ 0,5 % (§1). `join({ red: false })` só para diagnóstico.
- **Mono:** a resposta do SFU não tem `stereo=1`, então o encoder é mono [MEDIDO]. O áudio de tela é a exceção: estéreo, sem DTX, `musicHighQualityStereo`.
- `adaptiveStream` (resolução segue o `<video>`, pausa o que está oculto) e `dynacast` (o publicador para camadas que ninguém consome) ligados.
- **Latência medida A→B pelo SFU local:** 46 ms (Desligado), 53 ms (Padrão) e 62 ms (RNNoise), com p95 ≤ 65 ms. Entrada no canal em 132 ms (mediana).

### 3. Processamento de entrada em três modos, trocáveis a quente

| Modo | Constraints `getUserMedia` | Grafo próprio (AudioContext 48 kHz sem saída) | Latência medida |
|---|---|---|---|
| **Padrão** | eco + ruído + ganho (APM do Chromium) | gate VAD/PTT | 53,0 ms |
| **Supressão avançada** | eco + ganho; **sem** o NS do Chromium (dois supressores em série deixam a voz "aguada") | RNNoise (`@sapphi-red/web-noise-suppressor`, SIMD) → gate | 62,1 ms (+9 ms) |
| **Desligado** | nada | gate | 46,3 ms |

- O grafo entra como `TrackProcessor` do LiveKit. Trocar de modo reinicia a faixa com as novas constraints e insere ou remove o nó RNNoise sem republicar.
- Em fala real (TTS), **11/11 inícios de frase chegaram em todos os modos**, sem atraso que indique corte de onset [MEDIDO]. Se a voz soa "robótica" com RNNoise continua **PENDENTE** (exige teste de escuta).
- **O RNNoise precisa de WebAssembly. A CSP atual (`script-src 'self'`) bloqueia.** O motor detecta antes (compila o `.wasm` no thread principal) e cai para o Padrão com aviso, mantendo o mic vivo [MEDIDO]. **Mudança pedida:** adicionar `'wasm-unsafe-eval'` a `script-src` em `src/renderer/index.html` e no `FALLBACK_CSP` de `src/main/security.ts`. Isso só libera compilar WASM. `eval` de JS continua proibido.

### 4. Detecção de voz e push-to-talk

- **Gate em AudioWorklet** com análise em quadros de 10 ms (`vad.ts`, lógica pura testada):
  - Limiar automático = piso de ruído + 12 dB, limitado a [−62, −30] dBFS.
  - O piso cai na hora e sobe 3 dB/s. As pausas entre palavras o puxam de volta, então a fala não eleva o próprio limiar, e um ambiente mais ruidoso é aprendido em segundos.
  - Histerese de 4 dB.
  - **Retenção (hangover) de 300 ms** para não cortar finais de palavra.
  - **Lookahead de 10 ms**: o áudio atrasa 10 ms para o gate já estar aberto quando chega a primeira consoante. Isso está incluído nas latências acima.
  - Ataque de 5 ms e soltura de 40 ms, sem cliques.
- Sensibilidade manual em dB (−100…0) sobrescreve o automático. O gate fechado não muta a faixa: manda silêncio, que vira DTX. Assim o ícone de "mutado" dos outros não pisca.
- **PTT** via `window.alga.hotkeys.onEvent` (`pushToTalk`, `pushToMute`, `toggleMute`, `toggleDeafen`), com **150 ms de atraso na soltura** (configurável). **Ensurdecer** = volume 0 em todo áudio remoto + mic mutado; ao sair, restaura o mute anterior.

### 5. Codec de tela: HEVC por hardware quando existir, senão H.264

Medido com captura real a 1080p60:

| Codec | Resultado | Veredito |
|---|---|---|
| **H.265/HEVC** | NVENC via Media Foundation (`powerEfficient: true`). 49 fps (teto da fonte ~52), 9,4 Mbps, sem limitação, CPU 3,4 % da máquina, encode no processo de GPU (renderer 1,1 %). Em 4K30 sustenta 30 fps sem limitação. | **Primário quando houver encoder HW** |
| H.264 | Sempre **OpenH264 (software)**, inclusive com `PlatformH264CbpEncoding`. 48 fps a 1080p com renderer em 2,0 %. Em 4K30 fica limitado por CPU e cai para 1440p. Decodificado por HW em todo lugar. | **Reserva** (backup codec) e padrão sem HW |
| VP8 | libvpx, 48 fps, mas com **o dobro de CPU** do OpenH264 (6,9 %) e decodificação em software. | Rejeitado |
| VP9 / AV1 (SVC) | Encoders de software (libvpx/libaom) não seguram 1080p: presos em 360p/720p a 0–4 fps. A RTX 3070 não tem encoder AV1. | Rejeitados por ora. **PENDENTE:** AV1 por hardware (RTX 40 / Arc / RDNA3) |

- **Automático** (`pickCodec`): `mediaCapabilities.encodingInfo({type:'webrtc'}).powerEfficient` de H.265 → `h265`; senão `h264`. Nesta máquina o probe bateu com o encoder realmente usado. Escolha manual continua possível (`setScreenDefaults({ codec })`).
- Com HEVC, o LiveKit publica **H.264 como backup codec**. Exercitado com um espectador sem decodificação HEVC (`--disable-features=PlatformHEVCDecoderSupport`): recebe o H.264 em 5 de 5 transmissões seguidas, de janelas e da tela [MEDIDO, `media-baseline.md` §4.4]. Com **só duas camadas** de simulcast o SFU não entregava nada a esse espectador (inclusive no preset 720p30 antigo); por isso a escada sempre tem 3 camadas (abaixo).
- **Janela menor que o preset** (o caso comum: jogo ou app em janela): o `getDisplayMedia` com `max` maior que a janela entrega quadros no tamanho real dentro de um buffer do tamanho pedido, e `getSettings()` informa o tamanho pedido. O LiveKit calculava as camadas por esse tamanho falso (camadas com largura ímpar, ex. 853×480) e o **NVENC HEVC não iniciava**: o WebRTC trocava o envio para **VP8 em silêncio**, o SFU descartava ("could not find codec") e todo mundo via só o backup H.264 de uma camada [MEDIDO]. Agora o motor lê o primeiro quadro real e, se for menor, captura de novo no tamanho real (par); custa ~170 ms no início (441 ms contra 270 ms da tela). Resultado: HEVC por hardware em janelas 1280×720, 1440×810, 1600×900 e na tela [MEDIDO]. **Ainda falha** quando o tamanho real gera camada de largura ímpar (ex. janela 1366×705 → 1364×704 → camada 341×176): cai no backup H.264, que continua entregando vídeo. **PENDENTE:** recorte para múltiplos de 8 sem cópia.
- Custo do HEVC: +~165 MB privados no processo de GPU (264–268 MB contra 98–103 MB com H.264; 3 sessões NVENC, uma por camada de simulcast) [MEDIDO].
- **Simulcast** em toda transmissão: 360p15 (0,4 Mbps) + 720p30 (1,7 Mbps) + camada alta. Quem tem pouca banda ou janela pequena não derruba a qualidade de quem assiste em tela cheia. Quando a fonte é menor que o preset e a escada não cabe (camada acima de 80 % do lado curto da fonte), as camadas viram **¼ e ½ da fonte** (ex. janela 720p: 180p15 + 360p30 + 720p), com bitrate proporcional à área (`simulcastFor`, testada).

### 6. Presets e o que oferecer

| Preset | Resolução / fps | Teto de bitrate |
|---|---|---|
| 720p30 | 1280×720 @30 | 2,5 Mbps |
| 1080p30 | 1920×1080 @30 | 4,5 Mbps |
| **1080p60** (padrão) | 1920×1080 @60 | 8 Mbps |
| 1440p60 | 2560×1440 @60 | 14 Mbps |
| 4K30 | 3840×2160 @30 | 18 Mbps |

`availablePresets` (puro, testado) oferece só o que a máquina sustenta:
- Teto de taxa de pixels de 1440p60 com encoder HW e de 1080p30 sem.
- Nunca acima da resolução da fonte (sem upscaling): **nesta máquina, com monitor 1080p, aparecem 720p30/1080p30/1080p60**.
- Some o preset que falhou mais vezes do que segurou ≥ 90 % do fps alvo, com ≥ 2 sessões registradas (`recordSustain` ao parar cada transmissão).

O teto de software (1080p30) é conservador de propósito: o OpenH264 segurou 1080p a 48 fps com ~0,4 núcleo no renderer *desta* CPU, mas precisa caber ao lado de um jogo numa CPU modesta. **PENDENTE:** calibrar em máquinas fracas.

### 7. Tipo de conteúdo

- `motion` (jogos/vídeo): `contentHint='motion'` + `degradationPreference='maintain-framerate'`.
- `detail` (texto/código): `'detail'` + `'maintain-resolution'`. Medido: com conteúdo em movimento o modo detalhe mantém 1080p mas cai para ~15 fps, a troca certa para ler código e a errada para jogo. Por isso o padrão é `motion`.

### 8. Viewer sob demanda

- `autoSubscribe: false`. A voz é inscrita explicitamente. A tela só quando alguém chama `watch()`, então **nada de vídeo é baixado de quem ninguém assiste**.
- "Automática" = `adaptiveStream` (camada pelo tamanho do `<video>` em pixels de tela). "Original" = re-inscreve aquela faixa sem adaptive stream e pede a camada alta. O LiveKit fixa adaptive stream por faixa na inscrição, por isso a troca custa um rebuffer curto.
- Áudio da live tem volume próprio (0–200 %), separado da voz. O áudio do sistema é capturado com `restrictOwnAudio: true` (decisão 0002), para quem assiste não ouvir a call de volta.

### 9. Resiliência

- **Política de reconexão mais densa** que a padrão do LiveKit: `[0, 300, 600, 1000, 1500, 2000, 2500, 3000, …, 7000]` ms, ~45 s no total. Depois de reiniciar o SFU (3,1 s fora), a recuperação após o SFU voltar caiu de **mediana 6,0 s para 3,4 s** [MEDIDO, 6 amostras cada].
- Se o LiveKit desistir: a captura é parada **antes** de qualquer nova tentativa (nunca fica mic aberto). Depois há reentrada com backoff de 1, 2, 5, 10 e 20 s, usando `refresh()` para token novo, exceto em motivos terminais (removido, sala encerrada, sessão duplicada).
- Em `power.onResume` e no evento `online`, o motor verifica se o transporte ainda recebe bytes (par ICE nomeado, 4 s). Se não recebe, reentra.

### 10. Parar a transmissão libera os encoders

O `unpublishTrack` do LiveKit só deixa os transceivers **inativos**. O Chromium mantém os *send streams* e todos os encoders deles (3 camadas + backup) até a conexão fechar. Era o "crescimento de memória" medido: **+19,5 MB por transmissão no caminho padrão, +38,8 MB com H.264, +76 MB com VP8 e +165 MB com VP9** no renderer [MEDIDO, 20/20/6/6 ciclos]. Agora `stopScreenShare` **para** os transceivers da transmissão e renegocia. O Chromium reaproveita as m-lines paradas na próxima transmissão, e numa m-line reaproveitada o SFU (1.13.11) responde a ordem padrão de codecs quando está regredindo alguém para o backup: a transmissão seguinte saía em VP8 e ninguém recebia [MEDIDO]. Por isso cada m-line liberada é ocupada na hora por um transceiver inerte (`inactive`, sem faixa e sem encoder) e as transmissões seguintes ganham m-lines novas. Números depois da correção em `media-baseline.md` §4.

### 11. Server mute

O moderador muta pelo SFU (`updateParticipant` tira `microphone` de `canPublishSources`); o SFU despublica o microfone e o LiveKit para a faixa. O motor reage a `ParticipantPermissionsChanged`: fecha a captura (`self.serverMuted = true`) e, quando a permissão volta, **republica sozinho** (mutado se o usuário estiver auto-mutado, como no `join`). Entrar já server-mutado não tenta publicar (antes: aviso falso "Microfone indisponível"). Antes da correção o participante ficava mudo até reentrar [MEDIDO, `media-baseline.md` §4.5].

### 12. Flags do Chromium

**Nenhuma.** O que precisamos já vem ligado no Chromium 156: HEVC HW encode, decodificação D3D11 e captura de tela a ~52 fps. `PlatformH264CbpEncoding` foi medida e não mudou nada (H.264 continua OpenH264). As flags do harness (oclusão/backgrounding) ficam só no script do lab. `chromium-flags.ts` registra o que foi avaliado.

## Consequências

- O 1080p60 grátis (diferencial nº 1 do benchmark) é viável nesta classe de máquina com ~0,7 núcleo de CPU total no transmissor. Em máquinas sem HEVC HW, cai para H.264 por software, e o teto oferecido desce para 1080p30.
- Com ~200 MB ociosos e ~370 MB em chamada, a meta "≤ 1/3 do Discord ocioso" (≤ 300 MB) está cumprida no ocioso.
- Depende de mudar a CSP para a Supressão avançada funcionar em produção.
- Dívidas medidas que ficam:
  - Janelas cujo tamanho real gera camada ímpar ainda caem no backup H.264 (§5).
  - Com a subida limitada a 3 Mbit/s, a troca de camada da tela congelou o espectador por 3,7–4,5 s; sob RTT 150 ms + 2 % de perda o 1080p60 caiu para 360p15 no espectador (`media-network.md` §3, n=1).
  - Sair e entrar na mesma sala sem pausa às vezes volta com o microfone sem DTX (`media-network.md` §2).
  - 1440p60 e 60 fps reais sem fonte adequada aqui.
  - Rede real (NAT/TURN/Wi-Fi) e máquinas independentes; perda, atraso e quedas já medidos com proxy local (`media-network.md`).

## Alternativas rejeitadas

- **`createLocalScreenTracks` / `setScreenShareEnabled` do LiveKit:** chamamos `getDisplayMedia` nós mesmos e publicamos a faixa. Assim controlamos `max` de resolução/fps, `restrictOwnAudio` e a troca de fonte sem republicar (`replaceTrack`).
- **NS do Chromium + RNNoise juntos:** dois supressores em série cortam demais.
- **Mutar a faixa no gate do VAD:** causaria sinalização de mute a cada pausa e corte do onset. O gate manda silêncio e o DTX cuida da banda.
