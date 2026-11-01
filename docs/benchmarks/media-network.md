# Rede degradada (voz + tela) — 2026-11-01

O Windows não tem `tc`/`netem`. Para medir perda, atraso, jitter, limite de banda e quedas, todo o tráfego de mídia das duas instâncias do lab passa por um **proxy UDP em espaço de usuário** que aplica essas falhas por cliente e por sentido.

> **Limite deste método.** Um proxy local em loopback **aproxima, mas não substitui** redes reais: não há NAT, TURN, filas de roteador doméstico, Wi-Fi, perda correlacionada com tráfego cruzado, reordenação nem variação de rota. Os dois clientes e o SFU estão na mesma máquina e no mesmo relógio. Os números abaixo valem para comparar configurações entre si (RED ligado ou desligado, presets), não como previsão de MOS em campo. **PENDENTE:** confirmar em redes reais (4G, Wi-Fi congestionado, outro continente) e com máquinas separadas.

- Reproduzir: `node apps/desktop/scripts/media-net.mjs` (fases `--phase=voice,protection,screen`, janela de medição `--seconds=25`).
- Dados brutos: [`media-network.json`](media-network.json). Proxy: [`scripts/netem/udp-impair.mjs`](../../scripts/netem/udp-impair.mjs) (`--selftest` valida o modelo).

## Resumo [MEDIDO]

| Cenário | Resultado |
|---|---|
| Voz, RTT 50/150/300 ms ± 30 ms, perda 0–10 % (padrões RED+FEC+DTX) | ocultação ≤ 0,5 % das amostras; jitter buffer 82–137 ms |
| Voz, perda 20 % | ocultação 0,9–1,4 % (19–38 microcortes/min) |
| Voz a 10 % de perda: RED+FEC / só RED / só FEC / nada | 0,4–1,0 % / 0,7–1,2 % / 6,0 % / 6,3 % de ocultação |
| Tela 1080p30 / 1080p60, rede limpa | 29 fps / 50 fps em 1920×1080, 0 congelamentos |
| Tela, RTT 150 ± 30 ms + 2 % perda | espectador cai para 720p30 (1080p30) ou 360p15 (1080p60); 4 congelamentos, ~1 s |
| Tela, subida de 3 Mbit/s | 20–23 fps, maioria 720p, 1 congelamento de 3,7–4,5 s (antes) |
| Tela, subida cai para 3 Mbit/s no ar, espectador em Original | só o SFU: congelamento > 2 s em 7/12 rodadas (até 4,6 s); **com o stall guard: 0/12, pior 1,2 s** (§3.1) |
| Tela, queda de 3 s | vídeo de volta em 0,4–1,6 s após a rede voltar (Original); 3,2 s em Automática |

**Padrões:** voz continua **RED + FEC in-band + DTX** (RED corta a ocultação 5–9×; FEC soma um pouco a 10 % sem custo de banda ou latência mensurável). Na tela, o congelamento longo na troca de camada com uplink baixo foi corrigido no cliente (stall guard, §3.1).

## Montagem [MEDIDO]

```
cliente A/B ──UDP──▶ IP_LAN:7892 (proxy) ──[sobe]──▶ socket por cliente (IP_LL) ──▶ SFU IP_LL:7892
cliente A/B ◀─UDP─── IP_LAN:7892 (proxy) ◀─[desce]── socket por cliente (IP_LL) ◀── SFU
```

- **Por que dois IPs locais e não loopback:** no Windows um socket preso a um IP só entrega UDP para o mesmo IP (de 127.0.0.1 para o IP da LAN, ou do IP da LAN para 127.0.0.2, não chega: medido), o *mux* UDP do pion nunca usa loopback e o Chromium ignorou um candidato link-local como destino. Então o proxy escuta no IP da LAN (192.168.1.116 nesta máquina), onde os clientes têm candidato *host*, e o SFU fica preso ao IP link-local do adaptador Tailscale (169.254.83.107, não roteável para fora); os sockets do proxy por cliente são presos a esse IP. A porta UDP 7892 fica aberta na LAN só durante a rodada.
- **SFU do lab** (LiveKit 1.13.11, config própria, porta 7890; nunca o SFU de dev em :7880): `use_ice_lite: true`, UDP num só porto (`udp_port: 7892`, `ips.includes` só o IP link-local), `node_ip` = IP do proxy (o candidato anunciado é o proxy), `tcp_port: 0` e sem TURN, ou seja, **sem fallback TCP**. Com ICE-lite o SFU só responde às verificações (para o endereço que observou, o socket do proxy), então a mídia não tem como contornar o proxy. O script aborta se o par ICE nomeado não for `udp <proxy>:7892`; nas rodadas, A e B: `udp 192.168.1.116:7892 host` (local `prflx`).
- **Proxy** (Node `dgram`): um socket de saída por endereço de cliente (cada cliente mantém um 5-tupla próprio no SFU), e para cada cliente um enlace de subida e um de descida com: perda independente ou em rajadas (Gilbert-Elliott), atraso + jitter uniforme **sem reordenar**, limite de banda (token bucket com fila *drop-tail* de 300 ms) e queda total. A sinalização (WebSocket) não passa pelo proxy.
- **Precisão do proxy:** timers do Node no Windows andam em degraus de 15,6 ms, o que seria jitter por si só; o proxy libera os pacotes dos últimos 20 ms com um laço `setImmediate`. Autoteste com sockets reais, 40 ms de RTT configurado: p50 **40,20 ms**, p99 **40,49 ms**, máx 41,2 ms (n=200). Modelo de perda: 10 % independente → 10,11 %, rajada média 1,11 (geométrica esperada 1,11); 5 % com rajada média 4 → 5,11 %, rajada 3,94 (n=200 000). [MEDIDO, `--selftest`]

## 1. Voz sob perda, RTT e jitter [MEDIDO]

**Método.** A fala (TTS pt-BR em loop, 8 frases com pausas de 900 ms; modo Padrão, VAD automático, Opus 64 kbps com DTX + RED + FEC, os padrões do produto) e B escuta. Cada enlace de cliente leva metade do RTT em cada sentido, com ±15 ms de jitter uniforme por sentido (A→SFU→B = RTT ± 30 ms). A perda é aplicada **só na subida** (a voz de A ao SFU); o SFU repassa RED/FEC intactos, então perda na descida é protegida do mesmo jeito. Para cada condição: 6 s de adaptação e janela de 25 s. Fontes em B (`inbound-rtp` da faixa de A): perda RTP, **ocultação** = (`concealedSamples` − `silentConcealedSamples`) / `totalSamplesReceived` (amostras inventadas pelo NetEq, sem contar o ruído de conforto do DTX), eventos de ocultação por minuto, atraso médio do jitter buffer (`jitterBufferDelay`/`jitterBufferEmittedCount`). RTT = `remote-inbound-rtp` do envio de A.

| RTT alvo | perda alvo | perda RTP medida | ocultação | eventos/min | jitter buffer | RTT medido |
|---|---|---|---|---|---|---|
| 50 ms | 0 % | 0 % | **0 %** | 0 | 89 ms | 51 ms |
| 50 ms | 2 % | 2,2 % | **0,1 %** | 2,4 | 90 ms | 64 ms |
| 50 ms | 5 % | 4,6 % | **0 %** | 0 | 89 ms | 48 ms |
| 50 ms | 10 % | 8,5 % | **0,2 %** | 4,8 | 82 ms | 53 ms |
| 50 ms | 20 % | 19,6 % | **1,4 %** | 38,4 | 68 ms | 74 ms |
| 150 ms | 0 % | 0 % | 0 % | 0 | 129 ms | 152 ms |
| 150 ms | 2 % | 2,6 % | 0,1 % | 2,4 | 120 ms | 159 ms |
| 150 ms | 5 % | 5,6 % | 0,2 % | 4,8 | 113 ms | 149 ms |
| 150 ms | 10 % | 10,4 % | 0,5 % | 12 | 93 ms | 148 ms |
| 150 ms | 20 % | 19,8 % | 1,1 % | 28,8 | 69 ms | 164 ms |
| 300 ms | 0 % | 0 % | 0 % | 0 | 137 ms | 287 ms |
| 300 ms | 2 % | 2,0 % | 0,1 % | 2,4 | 113 ms | 305 ms |
| 300 ms | 5 % | 4,9 % | 0 % | 2,4 | 99 ms | 323 ms |
| 300 ms | 10 % | 11,0 % | 0,3 % | 9,6 | 86 ms | 303 ms |
| 300 ms | 20 % | 19,6 % | 0,9 % | 19,2 | 68 ms | 313 ms |

- Com os padrões atuais, **até 10 % de perda independente a ocultação fica em ≤ 0,5 %** das amostras em qualquer RTT; a 20 % fica em 0,9–1,4 % (19–38 microcortes por minuto). O bitrate enviado não muda com a perda (73–78 kbps, RED incluído): a proteção já está paga.
- O jitter buffer fica em 68–137 ms. Ele **diminui** quando a perda sobe (o NetEq preenche com ocultação/redundância em vez de esperar) e cresce com o RTT mesmo com o mesmo jitter (89 → 129 → 137 ms de 50 para 300 ms sem perda), o que soma à latência boca→ouvido (`media-baseline.md` §1.1).
- O RTT medido segue o configurado (48–74 ms para 50, 148–164 para 150, 287–323 para 300); a diferença é o jitter de ±30 ms.

## 2. RED e FEC: o que cada um compra [MEDIDO]

**Método.** Mesma montagem da seção 1, RTT 50 ms sem jitter (para isolar a perda), perda só na subida. Para cada configuração A sai e entra de novo (renegocia): **RED** desligado pela API (`join({ red: false })`; tirar o RED do SDP não serve, o SFU descarta o Opus puro numa faixa publicada como RED: B ficou sem áudio), **FEC** in-band desligado reescrevendo a resposta do SFU para `useinbandfec=0` (só no lab, `setLabSdp`). Cada configuração foi conferida antes de medir (codec de envio, `useinbandfec`, áudio chegando em B). Janela de 25 s por célula.

Rodada completa (1 repetição, 4 configurações):

| Configuração | 5 % independente | 10 % independente | 5 % em rajadas (média 3) |
|---|---|---|---|
| **RED + FEC (padrão)** | **0,4 %** (9,6/min) | **0,7 %** (16,8/min) | **0,6 %** (7,2/min) |
| só RED | 0,5 % (14,4/min) | 1,2 % (31,2/min) | 0,6 % (12/min) |
| só FEC¹ | 2,3 % (96/min) | 6,0 % (199/min) | 2,1 % (38/min) |
| nenhum | 3,0 % (91/min) | 6,3 % (182/min) | 3,1 % (29/min) |

Ocultação (eventos de ocultação por minuto). ¹ Nesta célula o SFU respondeu o microfone com `stereo=1` e sem `usedtx` (ver abaixo); as outras três com DTX.

Repetição só do par que decide (2 rodadas cada, DTX conferido):

| Configuração | 0 % | 5 % | 10 % | jitter buffer (todas as células) |
|---|---|---|---|---|
| RED + FEC | 0 % / 0 % | 0,1 % / 0,7 % | 0,4 % / 1,0 % | 35–54 ms |
| só RED | 0 % / 0 % | 0,2 % / 0,2 % | 0,7 % / 1,1 % | 32–55 ms |

- **Custo do RED:** dobra a banda da voz, 38 → 76 kbps com fala contínua (o quadro anterior vai junto em cada pacote); com DTX, o silêncio continua quase de graça. Num canal de 10 pessoas com uma falando, é ~76 kbps de subida e ~76 kbps de descida por ouvinte.
- **RED é o que importa:** com RED a ocultação cai de 3,0 → 0,4–0,5 % a 5 % de perda e de 6,3 → 0,7–1,2 % a 10 % (5–9× menos), e os microcortes de ~90–180/min para 10–30/min. O FEC in-band sozinho quase não ajuda (2,3 % contra 3,0 % a 5 %; 6,0 % contra 6,3 % a 10 %).
- **FEC em cima do RED:** igual a 5 % e um pouco melhor a 10 % (0,4–1,0 % contra 0,7–1,2 % em 3 rodadas). Não custa latência mensurável: o jitter buffer variou 32–81 ms entre entradas, sem relação com o FEC (na 1ª rodada RED+FEC deu 64–81 ms e só RED 30–41 ms; na repetição os dois ficaram em 32–55 ms). Também não custa banda: 73–76 kbps enviados com ou sem FEC (o Opus divide o mesmo alvo). [HIPÓTESE] É a proteção que sobra para um assinante que o SFU atende sem RED.
- **Decisão: os padrões ficam RED + FEC + DTX** (decisão 0001 §2). `join({ red: false })` existe para diagnóstico.
- **Achado:** às vezes o SFU responde o microfone como `stereo=1` sem `usedtx` (DTX desligado: 50 pacotes/s no silêncio). Ver §2.1.

### 2.1 Microfone sem DTX ao (re)entrar [MEDIDO]

`node apps/desktop/scripts/media-net.mjs --phase=rejoin --reps=N [--settle=ms]`: A (microfone em silêncio, RED ligado) sai e entra na mesma sala, N vezes sem pausa e N vezes com 1,5 s; depois de 2,5–4 s, pacotes/s enviados pelo microfone e recebidos por B, e as linhas fmtp do Opus na resposta do SFU.

- **Não é a pausa:** 3 de 24 entradas voltaram sem DTX, as 3 **com** 1,5 s de pausa (0/12 sem pausa nessa rodada; a rodada da §2 tinha visto o contrário). É intermitente, ~1 em 8–16 entradas.
- **O que acontece:** na resposta do SFU, a seção do microfone vem igual às seções de reserva sem faixa (`minptime=10;stereo=1;useinbandfec=1`, o `stereo=1` é o que a nossa oferta põe em todo áudio). O SFU não associou a m-line à faixa publicada (que pediu DTX e mono). O `sender.getParameters().codecs` mostra o mesmo fmtp, então o cliente consegue ver.
- **Correção no cliente (`ensureDtx`, depois da entrada, sem atrasá-la):** se o Opus negociado não tem `usedtx=1`, derruba e publica um microfone novo (o caminho do *server unmute*). Republicar a **mesma** faixa foi medido e rejeitado: o microfone ficou mudo (0 pacotes/s, B não ouvia nada). Com o microfone novo: 64 entradas, 5 respostas ruins em 4 entradas; 2 corrigidas na hora, e 2 entradas receberam uma segunda resposta ruim logo em seguida (o motor tenta até 2 vezes, a segunda após 1 s) e ficaram sem DTX, **sempre com áudio chegando em B** (50–51 pacotes/s).
- **Veredito:** a causa está no SFU (LiveKit 1.13.11, associação da m-line na resposta), não na pausa nem no nosso pedido. O cliente reduz o efeito (≈ 1 em 32 entradas fica sem DTX, contra ≈ 1 em 8) e nunca deixa o microfone mudo. **PENDENTE (servidor/infra):** reproduzir com um LiveKit mais novo e com `--settle` maior; se persistir, reportar ao LiveKit com o par oferta/resposta (`rejoin.runs[].answerFmtp` no JSON).

## 3. Transmissão de tela sob rede degradada [MEDIDO]

**Método.** A transmite uma **janela** 1920×1080 (ffplay `testsrc2`@60, mantida atrás das outras janelas; a captura de janela não depende de estar visível) com o codec automático (`h265` nesta máquina) e simulcast 360p15 + 720p30 + topo. B assiste em **Original** (camada alta pedida, como em tela cheia). Cada condição: 8–10 s de adaptação e 20 s de medição; B amostra `inbound-rtp` a cada 200 ms (quadros decodificados, resolução, bytes, `freezeCount`/`totalFreezesDuration`); A informa a camada alta enviada e `qualityLimitationReason`. As condições valem para os dois clientes e os dois sentidos. **Queda:** 100 % de perda nos dois sentidos por 3 s (RTT 50); recuperação = do fim da queda até B decodificar ≥ 80 % do fps de antes por 1 s seguido.

| Preset | Condição | fps em B | resolução em B (% do tempo) | kbps em B | congelamentos (tempo) | camada alta enviada por A |
|---|---|---|---|---|---|---|
| 1080p30 | limpa (RTT ~0) | **29,3** | 1920×1080 (100 %) | 3 633 | 0 | 1920×1080@30 |
| 1080p30 | RTT 150 ± 30 ms + 2 % perda | 29,3 | 1280×720 (100 %) | 2 173 | 4 (0,8 s) | 1920×1080@30 |
| 1080p30 | subida de A limitada a 3 Mbit/s (RTT 50) | 23,0 | 720p 75 %, 1080p 25 % | 1 273 | 1 (**4,5 s**) | cai para 720p (limitação `bandwidth`) |
| 1080p60 | limpa (RTT ~0) | **50,5** | 1920×1080 (100 %) | 7 668 | 0 | 1920×1080@45–54 |
| 1080p60 | RTT 150 ± 30 ms + 2 % perda | 15,0 | 640×360 (100 %) | 650 | 4 (1,0 s) | 1920×1080@46–55 |
| 1080p60 | subida de A limitada a 3 Mbit/s (RTT 50) | 20,3 | 720p 48 %, 360p 31 %, 1080p 20 % | 1 276 | 1 (**3,7 s**) | 1080p@0–33 → 720p (`bandwidth`) |

| Preset | Queda de 3 s | fps antes | volta a ≥ 80 % em | depois (fps, resolução) |
|---|---|---|---|---|
| 1080p30 | 100 % nos dois sentidos | 28,9 | **1,6 s** | 29,4 fps, 1920×1080 |
| 1080p60 | 100 % nos dois sentidos | 29,9¹ | **0,4 s** | 46 fps, 1080p 93 % |

¹ A queda de 1080p60 veio logo depois da condição de 3 Mbit/s: o estimador ainda estava em ~30 fps. Com B em Automática (camada pelo tamanho do `<video>`, 720p aqui) a recuperação foi 3,2 s nos dois presets (`screenAuto` no JSON).

- **Rede boa:** o pipeline entrega o preset (1080p30 a 29 fps; 1080p60 a 50 fps, o mesmo teto da fonte de ~52 fps de `media-baseline.md` §2).
- **RTT alto + 2 % de perda:** o transmissor continua mandando 1080p, mas o estimador de banda do espectador baixa a camada: 720p30 no preset 1080p30 e **360p15 no 1080p60** (n=1 por célula; a diferença entre os presets pode ser variação do estimador, **PENDENTE** repetir). O simulcast faz o que deve: o espectador degrada sozinho, sem derrubar o transmissor.
- **Subida limitada a 3 Mbit/s:** o transmissor desce para 720p (`qualityLimitationReason: bandwidth`), mas a troca de camada no espectador custou **um congelamento de 3,7–4,5 s** (antes do stall guard; ver §3.1, que mede e corrige isso). O padrão do produto (1080p60, 8 Mbit/s) não cabe num uplink doméstico de 3 Mbit/s.
- **Queda de 3 s:** o vídeo volta em 0,4–1,6 s depois que a rede volta (1 congelamento, o da própria queda); com Automática, 3,2 s.

### 3.1 O congelamento na troca de camada e o stall guard [MEDIDO]

**Causa (linha do tempo de B a cada 200 ms + camada alta de A, `uplink` no JSON).** A subida de A cai de ilimitada para 3 Mbit/s com a transmissão no ar. Em ~0,6 s o WebRTC de A desliga a camada alta (1080p a 0 fps, `qualityLimitationReason: bandwidth`). B, em Original, estava inscrito nela: o SFU para de lhe mandar quadros, mas só troca B para a camada de 720p (que A continua mandando) quando o rastreador de camadas de tela dele dá a alta como parada. Exemplo (1080p60, rep 1): último quadro em t = 1,0 s, camada alta a 0 fps em t = 1,6 s, B parado até t = 5,7 s, quando chega o primeiro quadro de 720p. Não é rampa inicial, nem bitrate inicial, nem `degradationPreference`: é o tempo de detecção do SFU, e o mesmo acontece toda vez que a camada alta, depois de voltar, cai de novo.

**Correção (cliente, `media/stall.ts` + `tickStalls`, decisão 0001 §13).** Quem assiste vê quadros pararem enquanto o enlace ainda traz dados (contador do par ICE andando): pede a camada de baixo na hora (`setVideoQuality`), o SFU troca e pede um quadro-chave. Depois de 8 s tenta a camada alta de novo; se ela cair outra vez, a espera dobra (até 60 s). Queda total (nada chega) e imagem parada (< 8 fps) não disparam.

**Método.** `node apps/desktop/scripts/media-net.mjs --phase=uplink --reps=N`: janela 1920×1080@60, codec automático (HEVC), B em Original; 6 s de rede limpa, a subida de A cai para 3 Mbit/s (RTT 50, fila de 300 ms) e B é medido por 30 s. A mesma rodada alterna o guard desligado (`media.stallGuard = false`, comportamento anterior) e ligado. Maior intervalo sem quadro novo em B (amostras de 200 ms) e o tempo total de congelamento do Chromium (`totalFreezesDuration`).

| Preset | Quem troca a camada | n | maior congelamento (mediana) | pior caso | rodadas com congelamento > 2 s | congelamento total na janela (mediana) | fps em B (mediana) | maior congelamento por rodada (ms) |
|---|---|---|---|---|---|---|---|---|
| 1080p30 | só o SFU (antes) | 6 | 1,8 s | 4,5 s | 3/6 | 3,4 s | 25,8 | [0,0,0,3641,4244,4452] |
| 1080p30 | **stall guard** | 6 | 0,8 s | 1,2 s | 0/6 | 1,5 s | 27,3 | [0,810,610,809,807,1213] |
| 1080p60 | só o SFU (antes) | 6 | 2,9 s | 4,6 s | 4/6 | 3,7 s | 25,4 | [0,4641,3032,2853,1820,3840] |
| 1080p60 | **stall guard** | 6 | 0,8 s | 1,2 s | 0/6 | 2,0 s | 26,8 | [0,1010,810,811,605,1210] |

- **O congelamento longo some:** só com o SFU, 7 de 12 rodadas tiveram um congelamento de 2,9–4,6 s; com o guard, 0 de 12, e o pior foi 1,2 s (perceber + troca + quadro-chave; mediana 0,8 s). O congelamento total na janela de 30 s também caiu (mediana 3,4 → 1,5 s em 1080p30, 3,7 → 2,0 s em 1080p60).
- **O custo:** o guard volta a tentar a camada alta depois da espera (o SFU também faz isso sozinho quando ela reaparece); se ela cai de novo, há outro congelamento curto (0,4–1,2 s) até a espera dobrar. Em rodadas onde a camada alta nunca parou, o SFU sozinho não congelou nada e o guard pode somar um desses. **PENDENTE:** o transmissor desligar a camada alta por um tempo quando ela oscila (precisa conviver com o dynacast do LiveKit, que reativa camadas pedidas).
- **Do lado do servidor** o mesmo tempo de detecção vale para todos os espectadores; um rastreador de camadas de tela mais curto na configuração do LiveKit reduziria o congelamento também para quem não tem o guard (clientes antigos). Fica como sugestão para a infra.

## 4. Viabilidade dos presets, 720p60 incluído [MEDIDO]

`--phase=presets`: janela 1920×1080@60 atrás das outras, rede limpa, B em Original, 10 s de rampa e 15 s de medição; registro de sustentação zerado e o *probe* refeito para o codec testado (mede o encoder, não o portão). CPU = máquina inteira (20 threads), instância A.

| Codec (encoder) | Preset pedido | Publicado | Camada alta enviada | B decodifica | Limitação | CPU de A |
|---|---|---|---|---|---|---|
| HEVC (NVENC) | 720p30 | 720p30 | 1280×720 @29, 2,0 Mbps | 29 fps | nenhuma | 1,9 % |
| HEVC (NVENC) | **720p60** | 720p60 | 1280×720 @**51**, 2,9 Mbps | 50 fps | nenhuma | 2,8 % |
| HEVC (NVENC) | 1080p30 | 1080p30 | 1920×1080 @29, 5,0 Mbps | 29 fps | nenhuma | 2,4 % |
| HEVC (NVENC) | 1080p60 | 1080p60 | 1920×1080 @52, 7,7 Mbps | 53 fps | nenhuma | 3,6 % |
| H.264 (OpenH264, software) | 720p30 | 720p30 | 1280×720 @29, 2,0 Mbps | 29 fps | nenhuma | 1,6 % |
| H.264 (OpenH264, software) | **720p60** | 720p60 | 1280×720 @**51**, 2,9 Mbps | 52 fps | nenhuma | 2,7 % |
| H.264 (OpenH264, software) | 1080p30 | 1080p30 | 1920×1080 @29, 5,1 Mbps | 29 fps | nenhuma | 2,5 % |
| H.264 (OpenH264, software) | 1080p60 | **720p60** (portão: software não oferece 1080p60) | 1280×720 @52, 3,0 Mbps | 51 fps | nenhuma | 2,6 % |

- **720p60 é viável nos dois encoders**: 51 fps (o teto da captura de janela, ~52 fps), sem limitação de CPU nem de banda, ~2,8 % da máquina. Fica dentro do teto de software (taxa de pixels abaixo de 1080p30), então aparece também em máquinas sem encoder de hardware.
- **O registro de sustentação escondia presets bons.** Ele marcava "falhou" quando o fps mediano ficava abaixo de 90 % do alvo; a captura de janela no Windows não passa de ~52 fps e uma tela parada manda poucos quadros, então o perfil do laboratório tinha 1080p60 com 30 "falhas" (e 720p60 com 2) com o encoder a 3 % de CPU, e os dois sumiam do seletor depois de duas transmissões calmas. Agora conta como falha só a sessão em que a camada alta passou a maior parte do tempo limitada por CPU (`qualityLimitationReason: 'cpu'`), e o registro ganhou outra chave (`encoderSustain`), descartando o antigo.

## 5. O que este proxy não mostra (PENDENTE)

- NAT, TURN/TCP, Wi-Fi, filas de roteador com tráfego cruzado, reordenação, perda correlacionada com congestionamento, mudança de rota.
- Máquinas e relógios separados; a CPU é compartilhada pelos dois clientes, o SFU e o proxy.
- Repetições: cada célula de tela e a 1ª rodada de RED/FEC têm n=1 janela de 25 s (20 s para tela); a variação entre rodadas visível na §2 (jitter buffer 32–81 ms) é o tamanho do ruído.
- Recuperação de queda mais longa que 3 s (a reconexão do LiveKit e a reentrada estão em `media-baseline.md` §1.5).
