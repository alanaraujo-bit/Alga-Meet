# Staging + SFU em casa: primeira mídia real — 2026-11-01

Primeira chamada de verdade pelo caminho de produção: **app desktop → API de staging no Railway → SFU LiveKit no servidor de casa** (`wss://example-sfu.duckdns.org`, IPv4 público `203.0.113.10`). Duas instâncias reais do app neste PC (perfis `stg-a` / `stg-b`), contas de teste criadas na staging, amizade, espaço, canal de voz "Geral". Nada é mock: áudio passa por Opus/RTP/SFU, a tela é captura real de uma janela, encoder e decoder por hardware.

> **O que isto NÃO prova.** Os dois clientes estão **na mesma rede local do SFU**. A mídia sai do PC, vai ao roteador e volta para o servidor pelo NAT loopback (hairpin) do roteador Huawei. **Nada passou pela internet**: RTT de 1 ms, zero perda e jitter de rede nulo são da LAN, não de uma rede real. O upload da casa (220 Mbit/s), rotas de outras operadoras, clientes atrás de CGNAT, 4G/5G, Wi-Fi ruim e TURN **não foram exercitados** e continuam **PENDENTE** (§8). Isto prova que o caminho funciona de ponta a ponta (DNS, TLS, token, webhook, ICE no IP público, UDP 7882 e TCP 7881) e mede o custo do próprio app e do SFU. **Próximo passo: um amigo fora de casa entra na chamada** (§8).

- Reproduzir: `STG_WORK=<pasta fora do repo> node apps/desktop/scripts/stg-media.mjs [--phase=setup,ui,voice,share,tcp,cleanup] [--voice-min=10] [--share-sec=180] [--tcp-sec=60]`.
- Credenciais geradas e dados brutos ficam só em `STG_WORK` (`secrets.json`, `results.json`; o script recusa uma pasta dentro do repo). Não há JSON versionado: os números estão aqui.
- Contas de teste excluídas no fim (`DELETE /users/@me` com senha → `purgeAfter` 2026-11-08, carência de 7 dias); o espaço de teste foi apagado antes.

## Ambiente [MEDIDO]

| Item | Valor |
|---|---|
| Cliente (as duas instâncias) | Windows 11 Pro 10.0.26300, i5-13600KF, RTX 3070, Ethernet `192.168.1.116`; Electron 45.2.1 / Chromium 156.0.8078.75 |
| Build do app | `npx electron-vite build --outDir apps/desktop/node_modules/.alga-stg` (nunca `apps/desktop/out`), do código de `18d0057` **com 150 arquivos não commitados de trabalho paralelo** (UI). O motor de mídia é o de `1e845ff` (segue a flag de E2EE por chamada) |
| API | `https://api-staging-b3ea.up.railway.app`, `/ready` = banco `ok`, livekit `ok` |
| SFU | LiveKit 1.13.11 em Docker no servidor de casa (Xeon E5-2650 v2, 16 threads, 15 GB), UDP mux 7882, TCP 7881, Caddy na 443 |
| Caminho | PC → roteador (NAT loopback) → `203.0.113.10:7882` → servidor. Mesmo prédio, mesmo roteador |
| Plano das contas | grátis: `streamPresets` = `720p30`, `720p60`, `1080p30` (resposta do `POST /voice/join`) |

**E2EE.** A staging roda uma API **anterior ao `133002d`**: `POST /spaces` não devolve `e2ee` e `POST /voice/join` não devolve `e2ee` (ambos `undefined`). Com isso o cliente novo (`callMode(server ?? capable)`) trataria a chamada como E2EE num build de dev, em que o E2EE vem ligado. Rodei as duas instâncias com **`ALGA_E2EE=0`**, que é o comportamento do app empacotado (`apps/desktop/src/main/mls/e2ee.ts`: ligado em dev, no empacotado só com `ALGA_E2EE=1`). O main reporta `off`, o motor entra sem criptografia (`useMedia.e2ee.state = 'off'`), o que é o certo para um canal de espaço com `Space.e2ee = false`. **E2EE na staging não foi testado** (§8).

## Resumo [MEDIDO]

| Métrica | Resultado |
|---|---|
| Par ICE escolhido | **UDP**, local `srflx 203.0.113.10:<efêmera>` → remoto `host 203.0.113.10:7882` (hairpin), nas duas instâncias, na UI real e na fase de voz |
| RTT (par ICE, `currentRoundTripTime`) | mediana **1 ms**, máx. 2 ms (n=240, 10 min) |
| Entrada no canal (motor, `connection.joinMs`) | 1ª do processo 218–376 ms; seguintes mediana **154 ms**, p95 163 ms (n=8) |
| Entrada incluindo `POST /voice/join` no Railway | seguintes mediana **319 ms**, p95 327 ms (n=8) |
| Entrada pela UI real (clique em "Geral" → "Voz conectada") | 1.951 ms (B, 1ª do processo, sala vazia) e 1.419 ms (A) |
| Webhook do LiveKit → staging → gateway de B | `VOICE_STATE_UPDATE` chega 435–574 ms depois de o motor dizer "conectado"; envio do webhook mediana 153 ms, p95 400 ms, 0 falhas (n=76) |
| Latência de áudio A→B (bipes, modo Padrão) | mediana **46,7 ms**, p95 50,3 ms, 0 perdidos de 799 em 10 min; mediana por minuto 46,6–46,9 ms |
| Perda / ocultação, 10 min de voz | **0** pacotes perdidos de 20.834 (A→B) e 2.862 (B→A); 0 % de ocultação; 0 reconexões |
| Jitter (`inbound-rtp.jitter`) / jitter buffer | 10 ms / **35 ms** — iguais aos da linha de base local (o "jitter" é do padrão de bipes com DTX, não da rede) |
| Tela 1080p30 (preset), janela 1280×720, 190 s | **29 fps** (27–30), 1280×720, 4,9 Mbit/s, HEVC NVENC → D3D11 por hardware, **0 congelamentos**, 0 perda, 0 quadros descartados |
| Tela 720p60, mesma janela, 190 s | **49 fps** (44–54), 1280×720, 2,8 Mbit/s, 0 congelamentos; a captura entrega 48 fps (teto da captura de janela, igual à linha de base) |
| Primeiro quadro depois de "Assistir" | 923 ms (1080p30) e 868 ms (720p60) |
| ICE só TCP (cliente sem UDP) | **TCP 7881** (`tcptype passive`), entrada 323/497 ms, latência mediana **52,3 ms** (+5,6 ms), 0 perda, 60 s |
| SFU (contêiner LiveKit), CPU de **um** núcleo | ocioso 0,2–0,3 %; voz 1,2–2,5 %; tela 1080p30 12,6–16,1 %; 720p60 6,4–12,2 % |
| SFU, memória | 51–77 MiB (de 15,5 GiB) |

## 1. Caminho de rede (ICE) [MEDIDO]

**Método.** Um script de inicialização do harness (não é código do produto) guarda cada `RTCPeerConnection` da página. A cada 5 s o harness lê `getStats()` de cada uma: `transport.selectedCandidatePairId` → `candidate-pair` (`currentRoundTripTime`, `totalRoundTripTime / responsesReceived`) → `local-candidate` / `remote-candidate` (tipo, protocolo, endereço, porta).

- **Fase UI (app real) e fase de voz:** sempre `remote host udp 203.0.113.10:7882` e `local srflx udp 203.0.113.10:<porta efêmera>`. O STUN do LiveKit devolve ao cliente o próprio IP público, e o roteador faz o hairpin. Na fase de tela o harness gravou só o RTT do par (0–4 ms), não os candidatos.
  - O SFU só anunciou o candidato `udp 203.0.113.10:7882 host` (o `use_external_ip` funciona: nada de `172.x` nem de IP da LAN).
  - No log do LiveKit, cada entrada troca o par de `prflx` para `srflx` no mesmo endereço ("ice reconnected or switched pair"): é a promoção normal do candidato peer-reflexive, não uma queda.
- **Uma única `RTCPeerConnection` por instância**, com `outbound-rtp` e `inbound-rtp` juntas: o `livekit-client` 2.23 com o LiveKit 1.13 usa uma conexão só para publicar e assinar.
- **RTT de 0–2 ms (mediana 1 ms)** em 240 amostras de 10 min: é o hairpin dentro do roteador, não um RTT de internet.

## 2. Entrada no canal [MEDIDO]

**Método.** `joinMs` = `connection.joinMs` do motor (de `media.join()` até "conectado", com o microfone publicado). "Com API" = `performance.now()` em volta de `lab.joinChannel()`, que faz o mesmo que o app: `POST /voice/join` no Railway + `media.join()`. Entradas espaçadas de 6,5 s (limite de 10/min por usuário). A UI real foi medida do clique no canal "Geral" até o texto "Voz conectada".

| Entrada | Motor (`joinMs`) | Com `POST /voice/join` |
|---|---|---|
| 1ª do processo, B (sala vazia) | 376 ms | 631 ms |
| 1ª do processo, A | 218 ms | 453 ms |
| Seguintes de A (n=8) | mediana **154 ms**, p95 163 ms | mediana **319 ms**, p95 327 ms |
| UI real, clique → "Voz conectada" | — | B 1.951 ms (1ª do processo), A 1.419 ms |

- O `POST /voice/join` no Railway soma ~165 ms (ida e volta até a região da API).
- Linha de base com SFU local (`media-baseline.md`, outro build): seguintes 132 ms. A diferença de ~22 ms provavelmente é TLS/`wss://` pelo Caddy e o hairpin (não isolado).
- O tempo da UI começa com o espaço já aberto e inclui o `POST /voice/join`, a conexão e a renderização do estado. É o primeiro uso do motor naquele processo (AudioContext, worklets).

## 3. Webhook do LiveKit → staging [MEDIDO]

**Método.** Uma sessão de gateway da **conta de B** (`wss://api-staging…/gateway`, `identify` com o token de B, a mesma que o app de B recebe) grava todo `VOICE_*`. Os estados de voz só nascem de webhooks do LiveKit (`apps/server/src/voice.ts`), então um `VOICE_STATE_UPDATE` prova que o webhook saiu de casa, chegou ao Railway, passou na assinatura e virou evento.

- **UI real:** `VOICE_STATE_UPDATE` de B e de A no canal Geral, depois `VOICE_STATE_REMOVE` dos dois ao fechar o app. O de A chegou **1.054 ms depois do clique**.
- **Fase de voz:** `VOICE_STATE_UPDATE` de B 574 ms e de A 435 ms depois de o motor dizer "conectado" (1.208 / 890 ms depois do início do `joinChannel`). Na fase: 10 `VOICE_STATE_UPDATE` e 8 `VOICE_STATE_REMOVE` (8 entradas e saídas de A).
- **No SFU** (`docker logs`, janela de ~25 min): 76 webhooks `sent webhook` para `https://api-staging-b3ea.up.railway.app/api/v1/livekit/webhook` (`room_started` 4, `participant_joined` 17, `participant_left` 16, `track_published` 18, `track_unpublished` 18, `room_finished` 3). `sendDuration` mediana **153 ms**, p95 400 ms, máx. 542 ms. **0 erros de webhook** no log.

## 4. Voz, 10 minutos [MEDIDO]

**Método** (o mesmo de `media-lab.mjs`, `media-baseline.md` §1.1):
- O microfone de A é o falso do Chromium (`--use-fake-device-for-media-stream --use-file-for-fake-audio-capture=beeps.wav`): *bursts* de 40 ms de 1 kHz a cada 750 ms sobre silêncio digital. B tem um microfone falso em silêncio.
- Em A, um `OnsetProbe` lê a faixa **crua** do microfone; em B, outro lê a faixa de A **já decodificada** (depois do jitter buffer). Onset = primeira amostra acima de −30 dBFS após ≥ 250 ms de silêncio, em `performance.timeOrigin + performance.now()`.
- Relógios: mesma máquina; deslocamento entre os renderers medido (25 idas e voltas, melhor 0,9 ms): **0,1 ms**, descontado. Cada onset de A é pareado com o primeiro de B nos 400 ms seguintes.
- Processamento **Padrão** (APM do Chromium, o padrão do app), detecção de voz automática, Opus `usedtx=1;useinbandfec=1`, RED ligado.
- A cada 5 s: `useMedia` das duas instâncias (`participants[A].audio`, `local`, `quality`, `reconnects`), `getStats` do par ICE e os contadores cumulativos de `inbound-rtp` de B (perda, ocultação, jitter buffer).

| Métrica | Valor |
|---|---|
| Duração | 601 s, A e B "conectado" em todas as 120 amostras, 0 reconexões |
| Latência A→B | n=799, **mediana 46,7 ms**, p95 50,3 ms, mín. 41,2, máx. 52,7; **0 perdidos** |
| Mediana por minuto | 46,7 · 46,8 · 46,9 · 46,8 · 46,6 · 46,8 · 46,7 · 46,6 · 46,6 · 46,7 ms (sem deriva) |
| Perda | A→B 0 de 20.834 pacotes; B→A 0 de 2.862 (DTX no silêncio); pior janela de 5 s: 0 % |
| Ocultação | 0 % (e 0 % fora do ruído de conforto do DTX); 0 eventos; 0 NACK; FEC não precisou atuar |
| Jitter `inbound-rtp` | 10 ms (9–11) — o mesmo valor da linha de base local; vem da cadência dos bipes com DTX, não da rede |
| Jitter buffer | **35 ms** (34,7–35,2) |
| Envio do microfone de A | 49 kbit/s em média (teto 64), 28–38 pacotes/s |
| Qualidade (SFU) | `excellent` para A e B o tempo todo |
| Reprodução em B | `baseLatency` 10 ms, `outputLatency` 42 ms (estimativa do Chromium com saída falsa) |

- Linha de base com SFU local (`media-baseline.md`, outro build): Desligado 46,3 ms, Padrão 53,0 ms. O caminho real pela staging **não acrescenta latência mensurável**: o RTT é 1 ms e o resto é o pipeline do cliente (captura, gate, Opus 20 ms, jitter buffer 35 ms). A diferença para o 53,0 local é de build, não de rede.
- **Não inclui** a latência do hardware de áudio (ADC/DAC; ver `media-baseline.md` §1.1). Boca→ouvido real = valor acima + entrada + `outputLatency` do dispositivo.

## 5. Transmissão de tela real [MEDIDO]

**Método.**
- **Quem transmite (A) roda sem `--use-fake-device-for-media-stream`**: esse switch troca qualquer captura pela tela sintética do Chromium. Para nunca abrir o microfone real do dono, o `getUserMedia` de A responde com uma faixa WebAudio muda, e A entra só ouvindo (`publishMic: false`). O `desktopCapturer` do main lista só a janela de teste, então nenhuma captura contém a tela do dono.
- **Fonte:** janela `ffplay` `testsrc2` 1280×720 a 60 fps, sem borda, sempre no topo, inteira dentro da tela 1920×1080.
- `media.startScreenShare({ sourceId, quality })` com `1080p30` e depois `720p60` (os dois que o plano grátis oferece; `screen.offered` = `720p30, 720p60, 1080p30`). Tipo de conteúdo `motion` (padrão). Codec escolhido pela sala: **H.265** (os dois decodificam).
- B (microfone falso mudo) assiste em **Original** (`media.watch(A, 'source')`).
- A cada 5 s, por 190 s em cada preset: `useMedia.viewers[A].stats` em B, `useMedia.screen.stats` em A e `getStats` do par ICE. Totais pelos contadores de `inbound-rtp` (vídeo) no início e no fim. Ritmo de quadros por `requestVideoFrameCallback` no `<video>` de B (10 s). Fps da captura antes do encoder por `MediaStreamTrackProcessor` (3 s).

| | 1080p30 | 720p60 |
|---|---|---|
| Fps recebidos em B | mediana **29**, 27–30 (n=36) | mediana **49**, 44–54 (n=36) |
| Fps da captura (antes do encoder) | 30 | 48 |
| Resolução recebida | 1280×720 o tempo todo | 1280×720 o tempo todo |
| Bitrate recebido | 4,9 Mbit/s (4,7–5,4) | 2,8 Mbit/s (2,7–3,0) |
| Camadas enviadas (simulcast) | f 1280×720@29 4,9 Mbit/s · h 640×360@29 0,4 · q 320×180@15 0,1 | f 1280×720@47 3,0 Mbit/s · h 640×360@30 0,4 · q 320×180@16 0,1 |
| Encoder | NVIDIA HEVC MFT por hardware, `qualityLimitationReason = none` | idem |
| Decoder em B | `ExternalDecoder (D3D11VideoDecoder)`, por hardware; 0,3 ms por quadro | idem; 0,4 ms por quadro |
| Quadros decodificados / descartados | 5.559 / **0** | 9.230 / **0** |
| Congelamentos / pausas | **0** / 0 | **0** / 0 |
| Perda / NACK / PLI | 0 de 109.865 pacotes / 0 / 0 (1 quadro-chave) | 0 de 71.997 / 0 / 0 (3 quadros-chave) |
| Intervalo entre quadros (10 s) | média 34,2 ms, p95 39, máx. 39,1 ms | média 20,7 ms, p95 38,9, p99 55,6, máx. 61,1 ms |
| Jitter buffer | 10 ms | 9 ms |
| Primeiro quadro depois de "Assistir" | 923 ms | 868 ms |

- **1080p30 não chegou a 1080 linhas**: a janela tem 1280×720 e o motor não amplia a fonte. O preset funcionou como teto (30 fps, sem limitação). **1080 linhas reais: PENDENTE** (precisa de fonte em tela cheia, o que capturaria a tela do dono).
- **720p60 fica em ~49 fps** porque a própria captura de janela entrega 48 fps nesta máquina; é o mesmo teto da linha de base local (`media-baseline.md`: 1080p60 com 49 fps enviados / 50 recebidos). O SFU e a rede não cortaram nada: 0 perda, 0 descarte, `qualityLimitationReason = none`.
- A entrada de A como transmissor (sem microfone): `joinMs` 491 ms, 744 ms com a API.

## 6. Fallback por TCP 7881 [MEDIDO]

O app não tem opção para forçar TCP (o motor não expõe `rtcConfig`). O harness emula, nas **duas** instâncias, um cliente numa rede que bloqueia UDP:
1. `webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp')` no main: o Chromium não junta nenhum candidato UDP.
2. Um script de inicialização descarta os candidatos UDP que o SFU manda (SDP e *trickle*).

**Primeira tentativa, só com o passo 2: não forçou TCP.** O LiveKit faz ICE completo: ele mesmo mandou verificações para o candidato UDP `host` do cliente (`192.168.1.116`), e o ICE escolheu o par `host udp 192.168.1.116` → `prflx udp :7882`. Esse par vai **direto pela LAN**, sem hairpin. Por isso entrou o passo 1.

**Com os dois passos:**

| Métrica | Valor |
|---|---|
| Par escolhido | local `prflx tcp active 203.0.113.10:<efêmera>` → remoto **`host tcp passive 203.0.113.10:7881`**, A e B; 5 e 7 candidatos UDP do SFU descartados |
| Entrada (`joinMs`) | B 497 ms, A 323 ms (com API: 755 / 568 ms); n=1 cada |
| Latência A→B, 60 s | n=79, mediana **52,3 ms**, p95 56,2 ms, 0 perdidos (+5,6 ms sobre UDP) |
| Perda / ocultação / jitter buffer | 0 de 2.114 pacotes / 0 % / 35 ms |
| RTT do par | 0–1 ms |

- **O que fica de fora:** no modo normal o `getStats` listou só candidatos locais UDP (`host`, `srflx`), nenhum TCP. Numa rede que **descarta** UDP sem que o Chromium saiba (firewall de empresa), não está provado que o cliente chega ao 7881 sem ajuda. O TURN/TLS na 443 existe para esse caso e **não foi testado** (§8).
- Bloquear UDP de verdade neste PC exigiria mexer no firewall do Windows (configuração de segurança): não foi feito.

## 7. Lado do SFU (servidor de casa, só leitura) [MEDIDO]

**Método.** `ssh … 'docker stats --no-stream'` (CPU % do Docker = % de **um** núcleo; o servidor tem 16 threads) em momentos fixos de cada fase, e `docker logs --since 60m alga-sfu-livekit-1 | tail -200` no fim. Nenhum contêiner foi reiniciado nem alterado.

| Momento | CPU LiveKit | Memória LiveKit | CPU Caddy |
|---|---|---|---|
| Antes da chamada | 0,34 % | 57 MiB | 0,00 % |
| Voz (2 pessoas), t = 5 / 300 / 590 s | 2,02 / 2,48 / 1,17 % | 76 / 59 / 51 MiB | 0,08–0,10 % |
| Tela 1080p30 + voz, t = 30 / 165 s | 12,6 / 16,1 % | 65 / 72 MiB | 0,06–0,11 % |
| Tela 720p60 + voz, t = 30 / 165 s | 12,2 / 6,4 % | 76 / 77 MiB | 0,05–0,21 % |
| Voz por TCP 7881, t = 5 / 30 / 50 s | 2,82 / 2,15 / 2,97 % | 68 MiB | 0,02–0,08 % |
| Depois | 0,24 % | 74 MiB | 0,00 % |

- Tráfego do contêiner durante a tela 1080p30 (entre t = 30 s e 165 s): ~5,9 Mbit/s de entrada e ~5,2 Mbit/s de saída. É uma publicação (3 camadas, 5,4 Mbit/s) e um espectador (4,9 Mbit/s). Na voz: ~80 kbit/s em cada sentido.
- **Projeção grosseira, não medida:** ~16 % de um núcleo por espectador de tela 1080p30 sugere folga larga na CPU. Com 16 threads, o limite real é o upload da casa (`infra/home-sfu/README.md` §8), que este teste **não usou** (o hairpin não sai para a internet).
- **Log do LiveKit:** sem erros. Avisos: 2× "error reading data channel" e 1× "error writing to websocket: close sent", ambos no instante em que um participante saía (normais no fechamento). E 1× **"UDP receive buffer is too small"** (`current: 425984`, sugerido 5.000.000), emitido quando o contêiner subiu (12:57:33 UTC).
  - Hoje o host tem `net.core.rmem_max` = `wmem_max` = 5.000.000 (lido por SSH).
  - O contêiner é anterior a isso. **Inferência, não medida:** o socket UDP aberto antes da mudança continua com o buffer antigo até o contêiner ser recriado. Para voz não importa; para tela com vários espectadores, sim. O dono deve recriar o contêiner (`bash install.sh` no servidor).

## 8. O que continua PENDENTE

| Pendência | Por que este teste não cobre | Como fechar |
|---|---|---|
| **WAN real (de fora de casa)** | Os dois clientes e o SFU estão na mesma LAN; a mídia faz hairpin no roteador | **Próximo passo:** um amigo, em outra casa e outra operadora, entra na chamada pelo instalador de staging. Medir RTT, jitter, perda, latência e tela com o mesmo método. Um cliente via roteador do celular (4G/5G) cobre o caso móvel |
| Outras operadoras, rotas e horários de pico | Nenhum pacote saiu para a internet | Idem, em horários diferentes (noite = pico) |
| Cliente atrás de CGNAT | O cliente aqui tem IP público próprio (srflx = IP da casa) | Amigo numa operadora com CGNAT (comum em 4G e em fibras pequenas) |
| Upload da casa como gargalo | Hairpin não usa o upload | Tela 1080p30/720p60 para 2–4 espectadores de fora, observando `qualityLimitationReason`, camada recebida e o roteador |
| TURN (UDP 3478 e TLS 443) | Nenhum par usou relay | Cliente numa rede que só libera HTTPS (rede de empresa/escola) ou forçando `iceTransportPolicy: 'relay'` num harness |
| Rede que descarta UDP sem avisar | A emulação desligou o UDP no Chromium (§6) | Mesma rede restrita acima |
| Tela com 1080 linhas reais | Fonte de 1280×720 para não capturar a tela do dono | Fonte em tela cheia numa máquina de teste |
| Mais de 2 pessoas / vários espectadores | Só A e B | 3–8 clientes (`lk load-test` do README do kit + clientes reais) |
| E2EE na staging | API de staging anterior ao `133002d`; clientes com `ALGA_E2EE=0` | Publicar a API atual na staging e repetir com E2EE ligado (DM ou espaço com `e2ee: true`) |
| Latência de hardware de áudio | Microfone e saída falsos | Cabo de loopback físico (`media-baseline.md` §1.1) |
| Wi-Fi do cliente | Cliente por cabo | Repetir com o PC no Wi-Fi |

## 9. Achados para o dono

1. **A staging roda uma API antiga** (sem `Space.e2ee` e sem `VoiceJoinResponse.e2ee`, ou seja, anterior ao `133002d`). Um build de dev do app novo, com E2EE ligado, trataria todo canal de espaço como E2EE contra ela. Republicar: `railway up --service api --environment staging --detach`.
2. **Recriar o contêiner do LiveKit** para ele pegar os buffers UDP de 5 MB (§7). Não fiz: o servidor não é meu para alterar.
3. **O caminho de produção funciona de ponta a ponta:** cadastro, amizade, convite, login pela UI, `POST /voice/join`, `wss://` pelo Caddy, ICE no IP público (UDP 7882 e TCP 7881), webhook de volta para o Railway e `VOICE_STATE_*` no gateway. Com o caminho limpo, voz e tela ficam no mesmo patamar da linha de base com SFU local.
