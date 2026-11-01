# Motor de mídia (`src/renderer/src/media`)

Voz e transmissão de tela do Alga Meet sobre LiveKit. **A UI importa só de `@/media`** (`index.ts`); nunca de `livekit-client`.

```ts
import { media, useMedia } from '@/media'
```

- `useMedia` — store zustand **somente leitura** para a UI (o motor é o único que escreve). Use seletores: `useMedia((s) => s.self.speaking)`.
- `media` — controlador imperativo (singleton). Todos os métodos são seguros fora de chamada (guardam preferência e aplicam quando entrar).

Decisões e números que as justificam: `docs/decisions/0001-media-engine.md` e `docs/benchmarks/media-baseline.md`.

## Voz

| Método | O que faz |
|---|---|
| `join({ url, token, bitrateKbps?, channelId?, refresh?, publishMic?, streamPresets? })` | Entra no canal (use o `VoiceJoinResponse` do servidor; `streamPresets` = presets do plano). `bitrateKbps` padrão 64. `refresh` devolve `{url, token}` novos para a reentrada automática (tokens expiram). `publishMic:false` = só ouvir. `red:false` desliga a redundância RED da voz (padrão ligado; só para diagnóstico, ver `docs/benchmarks/media-network.md`). Rejeita se não conectar (o estado vira `disconnected` com motivo). |
| `leave()` | Sai, para captura, volta a `idle`. |
| `setContext({ channelName })` | Nome legível do canal para a bandeja e `connection.channelName` (em vez de `ch_…`). Chame antes ou depois do `join`; sobrevive às reentradas automáticas, `leave()` limpa. |
| `setMuted(b)` / `toggleMute()` | Mutar. Desmutar enquanto ensurdecido também desensurdece. |
| `setDeafened(b)` / `toggleDeafen()` | Ensurdecer = silencia todo áudio remoto **e** o microfone; ao sair, restaura o mute anterior. |
| `setProcessing('standard' \| 'advanced' \| 'off')` | **Padrão** (APM do Chromium: eco+ruído+ganho), **Supressão avançada** (RNNoise; mantém cancelamento de eco e ganho), **Desligado** (cru, para microfones bons/música). Troca a quente durante a chamada. Se o RNNoise não carregar, cai para Padrão e avisa (`self.processingActive`). |
| `setInputMode('vad' \| 'ptt')` | Detecção de voz ou push-to-talk. |
| `setSensitivity(db \| null)` | Limiar manual em dBFS (−100…0) ou `null` = automático (piso de ruído + 12 dB). Retenção (hangover) de 300 ms para não cortar finais de palavra; 10 ms de *lookahead* para não cortar o início. |
| `pttDown()` / `pttUp()` / `setPttReleaseDelay(ms)` | PTT manual (o atalho global `pushToTalk` já chama isso). Soltar fecha o mic após 150 ms (padrão; valor atual em `self.pttReleaseMs`). |
| `setVolume(userId, 0..2)` | Volume por pessoa 0–200 %, persistido por `userId` (= identity do LiveKit). |
| `setLocalMute(userId, b)` | Mutar alguém só para você. |
| `refreshDevices()` | Atualiza `devices.inputs/outputs`. Rótulos só aparecem depois da permissão de microfone. |
| `setInputDevice(id \| null)` / `setOutputDevice(id \| null)` | Troca ao vivo; persiste. `null` = padrão do sistema. Desconectou o preferido → cai no padrão com aviso; reconectou → volta sozinho. |
| `startMicTest({ loopback })` / `stopMicTest()` | Medidor (`self.level`) e "ouvir a mim mesmo", dentro ou fora de chamada. O retorno passa pelo mesmo processamento/gate que os outros ouvem. |
| `setSoundsEnabled(b)` | Sons de entrar/sair/mutar/desmutar/ensurdecer/desconectar (sintetizados, sem arquivos). Valor atual em `self.sounds`. Desligar também para um toque em andamento. |
| `ring('incoming' \| 'outgoing' \| null)` | Toque de chamada recebida / tom de chamada enquanto você liga (em loop, sintetizados como os outros sons, respeitam `self.sounds`); `null` para. Um por vez. |

Integrações automáticas (feature-detect, degradam se o bridge não existir): `window.alga.hotkeys.onEvent` (`pushToTalk`, `pushToMute`, `toggleMute`, `toggleDeafen`), `window.alga.power.onResume` e evento `online` (verifica se a chamada está viva e reentra se não estiver), `window.alga.tray` (estado e ações da bandeja).

## Transmissão de tela

| Método | O que faz |
|---|---|
| `getScreenSources()` | Lista telas/janelas (`window.alga.screen.getSources`). `[]` se o bridge não existir. |
| `startScreenShare({ sourceId, audio?, quality?, contentType?, codec? })` | `sourceId` vem do picker; `audio:true` captura o áudio do sistema (loopback **sem o próprio Alga Meet**: `restrictOwnAudio`, ver decisão 0002 — quem assiste não ouve a call de volta) como `screen_share_audio`. `quality`: `720p30`, `720p60`, `1080p30`, `1080p60`, `1440p60`, `2160p30` (os ids de `STREAM_PRESETS`). **Nunca publica acima de `screen.offered`**: um pedido fora dele vira o melhor oferecido abaixo (movimento mantém o fps: 1080p60 → 720p60; detalhe mantém a resolução: → 1080p30), e o pedido fica guardado para voltar quando o plano permitir. `contentType`: `motion` (jogos/vídeo: prioriza fps) ou `detail` (texto/código: prioriza nitidez). |
| `setScreenQuality(q)` | Troca a qualidade **ao vivo** (mesma publicação; quem assiste não sai) ou a da próxima transmissão. **Subir o fps** republica (o encoder por hardware fica na taxa com que começou; quem assiste segue sozinho, rebuffer curto). Mesma regra de limite do `startScreenShare`. |
| `setPlanPresets(list \| null)` | Presets que o plano permite (`Me.plan.streamPresets`). O motor também lê `VoiceJoinResponse.streamPresets` e o atributo `alga.stream_presets` do token, que o servidor reescreve quando o plano muda no meio da chamada; `voice.ts` chama isto no `ENTITLEMENTS_UPDATE` e no `ME_UPDATE`. Com transmissão ativa: acima do novo plano, a transmissão é **rebaixada no lugar** (sem parar) e um aviso diz isso uma vez; se o que ela **declarou** ao publicar passa do plano novo (o servidor confere isso 10 s depois e mutaria), ela é **republicada** em < 1 s, mesma fonte, sem seletor, áudio intacto, e quem assiste segue sozinho (150–512 ms de interrupção). Num upgrade, o limite sai e ela volta ao que você tinha pedido (no lugar). |
| `switchScreenSource(sourceId)` | Troca a fonte sem derrubar a transmissão (quem assiste continua inscrito). |
| `stopScreenShare()` | Para na hora. Também para sozinho se a captura terminar (janela fechada). |
| `setScreenDefaults({ quality?, contentType?, codec? })` | Preferências persistidas. `codec`: `h265` \| `h264` \| `vp8` \| `vp9` \| `av1` (padrão escolhido por medição, ver decisão 0001). |
| `watch(userId, 'auto' \| 'source')` / `unwatch(userId)` | Assistir sob demanda: **nada é baixado** de quem ninguém assiste. `auto` = resolução segue o tamanho do `<video>` (adaptive stream); `source` = camada mais alta sempre. |
| `setStreamQuality(userId, q)` | Troca auto/original (re-inscreve; ~0,3 s de rebuffer). |
| `attachScreen(userId, videoEl)` → `detach()` | Renderiza a live num `<video>` (pode chamar antes do vídeo chegar). |
| `attachOwnScreen(videoEl)` → `detach()` | Prévia da **sua** transmissão (a faixa que sai, antes do encoder). Pode chamar antes de `startScreenShare`; acompanha `switchScreenSource`; o `<video>` fica vazio quando a transmissão para. Muta o elemento. |
| `setStreamVolume(userId, 0..2)` | Volume do áudio da live, separado do volume de voz. |

## Estado (`useMedia`)

- `connection`: `state` (`idle → connecting → connected ⇄ reconnecting → disconnected`), `reason` (texto pt-BR), `joinMs`, `lastReconnectMs`, `reconnects`, `willRetry` (**true** enquanto há recuperação automática pendente — LiveKit reconectando, reentrada agendada ou em andamento; **false** quando desistiu ou o motivo é terminal: mostre "Entrar de novo"), `channelName` (de `setContext`).
- `self`: `muted`, `deafened`, `speaking`, `level` (0..1 suavizado, p/ medidor), `levelDb`, `thresholdDb`, `gateOpen`, `inputMode`, `pttPressed`, `processing`, `processingActive`, `sensitivityDb`, `micAvailable`, `serverMuted` (o moderador tirou a permissão de publicar microfone; independente de `muted`, que é escolha do usuário), `quality` (sua própria conexão, segundo o SFU: `excellent|good|poor|lost|unknown`), `sounds`, `pttReleaseMs` (preferências).
- `participants[userId]`: `name`, `speaking`, `level` (**nível perceptual 0..1 pronto para brilho/medidor, sem conversão**: RMS dos últimos ~43 ms do áudio decodificado aqui, em dBFS, mapeado linearmente −50 dBFS → 0 … −20 dBFS → 1; ataque imediato, soltura ~150 ms; atualizado a cada 50 ms; 0 em silêncio/mutado), `micMuted`, `volume`, `locallyMuted`, `streaming`, `streamHasAudio`, `quality` (`excellent|good|poor|lost|unknown`), `audio` (RTT não; jitter, perda %, nível, ocultação %, jitter buffer).
- `local`: envio do microfone (kbps, pacotes/s — mostra o DTX —, RTT, codec, fmtp).
- `screen`: `active`, `preset` (o que está saindo, ou o que sairia), `contentType`, `codec`, `offered` (o que esta máquina sustenta **e** o plano permite), `locked` (o que a máquina sustentaria mas o plano não inclui: mostre com a dica do Alga Plus; nunca aparece um preset que o hardware não aguenta), `plan` (ids do plano; `null` = desconhecido), `hardwareEncoder`, `stats` (por camada: resolução, fps, kbps, encoder, HW?, `qualityLimitationReason`), `error`.
- `viewers[userId]`: `quality`, `volume`, `stats` (fps, resolução, kbps, decoder, HW?, congelamentos, quadros perdidos, jitter buffer).
- `devices`, `notice` (`{id, text}` — mostre como toast quando `id` mudar), `micTest`.

## E2EE (criptografia de ponta a ponta)

Decisão e modelo de ameaças: `docs/decisions/0004-e2ee.md`; números: `docs/benchmarks/e2ee-media.md`. O MLS roda no main (`window.alga.e2ee`); o motor faz o resto sozinho. A UI **não chama nada**: só lê `useMedia((s) => s.e2ee)`.

- `e2ee.state`:
  - `off` — a chamada **não** é de ponta a ponta (build sem `ALGA_E2EE`, ou o main diz `off`). Mostre "sem criptografia de ponta a ponta", sem ambiguidade.
  - `establishing` — entrando no grupo MLS da chamada (dura ~35–60 ms, em paralelo com o LiveKit). Nada é publicado ainda.
  - `active` — tudo que sai e tudo que toca está cifrado com as chaves da chamada. Mostre o cadeado.
  - `failed` — não deu para cifrar (DS recusou, sem resposta em 10 s, removido do grupo, falha no meio da chamada). **A chamada foi encerrada** (`connection.state = 'disconnected'`, `willRetry: false`, motivo em `connection.reason`): o motor nunca cai para mídia sem criptografia.
- `e2ee.epoch` — época MLS em uso (muda a cada entrada/saída). `e2ee.members` — o grupo MLS (`userId`, `deviceId`, `self`): quem tem as chaves. É essa a lista para "nesta chamada criptografada", nunca uma lista do servidor.
- `e2ee.mismatch: string[]` — identidades que não dá para garantir, depois de 2 s: participante do SFU sem folha MLS (alguém com token do LiveKit e sem chaves), folha MLS sem participante (membro fantasma que o servidor pôs), duas folhas para o mesmo usuário, ou alguém publicando sem criptografia (o motor não toca nada dele). Não vazio = faixa vermelha "Há alguém na chamada que não conseguimos verificar" (0004 §3.8). Se o `userId` está em `members`, é fantasma; se não, é alguém sem chaves.
- **Códigos de verificação:** `window.alga.e2ee.verificationCode(channelId)` (30 dígitos, igual para todos na chamada; muda a cada época) e `verificationCode(channelId, userId)` (45 dígitos, por par). `window.alga.e2ee.status().persistent === false` = identidade só desta execução (os códigos mudam ao reiniciar).
- **Regras do motor:** só publica depois de `active` e de o LiveKit confirmar o cifrador local; a nossa chave nova só entra quando o DS diz que todos têm a época (`onEpoch`); recebe com até 16 épocas por remetente; reconexão do LiveKit e reentrada automática mantêm o grupo (as chaves mais novas são reaplicadas); depois de cada `READY` do gateway, reanuncia a época. Faixas sem criptografia de um participante numa chamada E2EE não são assinadas (o LiveKit as tocaria como estão).
- **RED da voz continua ligado com E2EE** (o SDK desligava; o build reescreve uma expressão do `livekit-client`, ver `electron.vite.config.ts`). **Sem codec reserva com E2EE** (o SDK não publica): o codec da tela é escolhido pela sala, abaixo.

## Codec da tela pela sala

- Cada cliente anuncia o que decodifica (`RTCRtpReceiver.getCapabilities('video')`) **no nome da publicação do microfone** (`alga.decode=h265,h264,…`): o token não deixa o cliente mudar atributos. Quem não publica microfone (só ouvindo, server mute) conta como "não anunciou".
- Quem transmite usa o codec escolhido só se **todos** os outros (com E2EE: todos os membros MLS) o decodificam; senão H.264. Sem E2EE, quem não anunciou é coberto pelo H.264 reserva do SFU; com E2EE conta como "não decodifica". Entrou ou saiu alguém, ou alguém mudou o anúncio: a transmissão é republicada no codec certo em ~0,5 s (quem assiste segue sozinho). Forçado para H.264 sem encoder por hardware: teto do software (1080p30).
- **HEVC nunca sai com uma camada abaixo de 144 px** (o decodificador por hardware não aceita; o Chromium não tem HEVC por software): uma janela pequena (≈640×360) vai em H.264 (QA BUG-02).
- **Falha em tempo de execução:** quem assiste e vê o decodificador desistir (`NullVideoDecoder`, ou bytes chegando sem imagem por 5 s) para de anunciar aquele codec (republica o microfone, um corte curto na própria voz) e quem transmite muda para H.264.
- `screen.codec` continua sendo a escolha (ou o automático); o codec que de fato sai está em `screen.stats`.

## Garantias

- Microfone nunca fica aberto depois de uma queda: em qualquer desconexão não pedida a captura é parada antes de tentar reentrar.
- **Server mute** (moderador tira `microphone` de `canPublishSources`): a captura do mic é fechada e `self.serverMuted` vira `true`. Quando a permissão volta, o mic é republicado sozinho (mutado se o usuário estiver auto-mutado, como no `join`). Entrar já server-mutado não mostra erro de microfone.
- **Plano (D11):** a camada alta nunca passa do preset do plano (lado curto, fps e `maxBitrate` ≤ `STREAM_PRESETS`); mudou o plano no meio, a transmissão é recapada no lugar: nova captura da mesma fonte trocada com `replaceTrack` + todas as codificações (camadas e codec reserva) reescritas. O SFU guarda as camadas declaradas na publicação e o servidor as reconfere 10 s depois da mudança: descendo abaixo do declarado (`aboveContract`), a tela é **republicada** (a nova publicada antes de a antiga sair; a antiga sai quando o primeiro espectador já está na nova, ou em 3 s) e não é mutada. Medido de ponta a ponta em `docs/benchmarks/media-plan.json` (`republish`, `planCycles`).
- **Quem assiste não fica congelado esperando o SFU** (`stall.ts`): se os quadros param enquanto o enlace ainda traz dados (a camada alta caiu no transmissor), o motor pede a camada de baixo na hora e tenta subir de novo depois de 8 s (o intervalo dobra se continuar caindo). Quadro parado (tela sem movimento) e queda de rede não disparam. `media.stallGuard = false` só no laboratório.
- Parar a transmissão libera os encoders: os transceivers da tela (camadas + codec reserva) são parados, não só desativados (ver `docs/benchmarks/media-baseline.md` §4).
- Reconexão do LiveKit com política mais densa que a padrão (0, 0,3, 0,6, 1, 1,5, 2 s…; ~45 s no total) e, se ela desistir, reentrada automática com backoff (1, 2, 5, 10, 20 s), exceto quando o motivo é terminal (removido, sala encerrada, outra sessão).
- Prefs ficam em `localStorage` (`alga.media.prefs.v1`), por perfil.

## Telemetria de qualidade (opt-in)

`startCallTelemetry(() => me.telemetryOptIn === true)` (ligado em `features/voice/voice.ts`) observa o `useMedia` e, no fim de cada sessão de voz (saiu, trocou de sala, desconexão terminal ou reentrada que desistiu; fechar o app é melhor esforço), manda **um** `POST /telemetry/call-quality` com o `CallQualityReport` de `packages/shared/src/telemetry.ts`: duração, entrada, reconexões (LiveKit + reentradas), RTT médio/p95, jitter, perda e ocultação médias (por segundo, sem o ruído de conforto do DTX), codecs, encoder HW, faixa mais usada de fps/resolução da sua transmissão, SO/app/GPU (`cpuVendor` = `unknown`: o renderer não vê a CPU). Nada de nomes, ids ou conteúdo. Sem consentimento não manda nada; 403, 429 e falha de rede são silenciosos; nunca segura a saída. A agregação (`CallSession`) é pura e testada.

## Laboratório

`index.html?url=ws://localhost:7880&token=…#media-lab` (só em build não empacotado) abre o `MediaLab`. `node apps/desktop/scripts/media-lab.mjs` sobe o LiveKit local, abre duas instâncias e mede tudo. `node apps/desktop/scripts/media-lab.mjs --e2ee` (= `media-e2ee.mjs`) sobe API própria (o DS) + LiveKit próprio, entra com contas de verdade e mede E2EE, codec pela sala e as regressões de tela (QA BUG-02/03, com captura real de janela). Campos só do lab no motor: `labNoE2ee`, `hevcMinSide`, `stallGuard`.
