# Sala de Cinema: motor (Plano 1) — números do §8

> 2026-11-05. Branch `feat/sala-de-cinema`. Instâncias **reais** do app (build de QA do Electron 45.2.1 / Chromium 156)
> numa máquina só: Windows 11 Pro 10.0.26300, Intel i5-13600KF (20 threads), 31,8 GB, NVIDIA RTX 3070.
> - Script: `apps/desktop/scripts/cinema-lab.mjs` (2–4 janelas, pilha de QA isolada: API + LiveKit locais).
> - Reproduzir: `QA_WORK=<pasta> node apps/desktop/scripts/qa-stack.mjs build && … start`, depois por exemplo
>   `QA_WORK=<pasta> node apps/desktop/scripts/cinema-lab.mjs --instances=4 --e2ee --late --play=560 --netem=loss=1,delay=20,jitter=2,queue=1000 --host-cap=12000`.
> - Resumo de cada rodada: `docs/benchmarks/cinema-engine-<tag>.json` (os logs brutos, quadro a quadro, ficam no `QA_WORK`).
> - O que só dá para medir entre duas casas está em `docs/qa/2026-11-05-cinema-teste-com-o-dono.md`.

## Resumo (§8)

| Critério (§8) | Meta | Medido | |
|---|---|---|---|
| Vídeo nativo | amostras idênticas ao arquivo | teste da Task 6 (`pieces.test.ts`, cópia de vídeo); a ficha diz "Nativo" | passa (teste) |
| Primeiro frame | ≤ 10 s de "Abrir sessão" a todos vendo (1080p 8 Mbps, upload ≥ 20 Mbps) | rede local: Task 15 **2,8 s** (antes da correção do índice 3,8–6,7 s); **Task 16 3,0–5,8 s** (4,7 s no build final: a abertura das conexões extras atrasa uma peça). Rede emulada, 4 janelas, upload 12 Mbps, RTT 40 ms: Task 15 9,1 s (0,1 %) e 23,1 s (1 %); **Task 16 12,1 s (0,1 %) e 9,1 s (1 %)**. 2 janelas, upload 20 Mbps, fila de 300 ms (Task 15): 25,5 s, não re-medido | **passa na rede local**; com perda, dentro das metas da Task 16 (≤ 15 s / ≤ 30 s) |
| Sincronia | p95 ≤ 42 ms após 10 s; nunca > 125 ms por > 1 s | rede local, **todos** os pares (Task 16): p95 **22,1–27,3 ms**, máx. 38,9 ms, nunca > 125 ms (Task 15: 25–33 ms, só Bruno × Ana). Rede emulada, 4 janelas, todos os pares, sem filtro: **Task 16 1 % 22,8–27,2 ms, 0,1 % 24,5–30,3 ms, nunca > 125 ms**; Task 15 (sem quem entrou no meio) 1 % 7,6–18,8 ms, 0,1 % 55,5–300,1 ms com excursões de até 2,4 s por 2,75 s | **passa** (ponto cego: poltrona congelada não gera amostra) |
| Pausa | todos no mesmo frame em ≤ 300 ms | mesmo frame em **8/8** pausas; pior poltrona **12–231 ms** depois do instante agendado (`at`); 285–500 ms depois do clique (inclui os 250 ms de `CINEMA_LEAD_MS`); "mesmo frame" medido pelo `currentTime` depois do seek (o script atual usa o último quadro rVFC) | **passa** |
| Entrar no meio | ≤ 8 s até sincronizado | rede local: Task 15 6 de 7 em 1,2–3,8 s, 1 em 9,85 s (corrigido); **Task 16, 10 entradas em 2 rodadas: 9 em 1,1–3,2 s, 1 em 7,5 s** (o caso "empurra 5 s e depois pula"). Rede emulada (Task 16): 12,9 s (1 %), 11,8 s (0,1 %) | **passa na rede local**; com perda, > 8 s |
| Travamentos | zero com 4 pessoas, upload de quem projeta ≥ 1,5× o bitrate | rede local: **zero**. 4 janelas, upload de quem projeta 12 Mbps (1,5×), RTT 40 ms: Task 15 **343 s parada em 560** (1 %) e **118 s em 300** (0,1 %); **Task 16: zero esperas nos dois** (3 conexões por par, super-seed também para pedidos urgentes, ritmo e pré-carga adaptativa; ver "Vazão sob perda") | **passa** no lab (uma rodada por perfil; a variação entre rodadas é grande) |
| Eco | filme vazando pelo microfone atenuado ≥ 30 dB | **não medido** (precisa de caixa de som e de duas casas) | pendente: teste com o dono |
| RAM | cinema ≤ 1,5 GB por cliente | **354–597 MiB** a mais que a chamada sozinha (pico do app inteiro 1,27–1,53 GiB); Task 16 (3 conexões por par): **368–703 MiB** | **passa** |
| Instalador | ≤ 40 MB a mais | **+48,6 MiB (+51,0 MB)**: 159,4 MiB contra 110,8 MiB da v0.1.8 | **reprova** a meta original; o dono aceitou o crescimento do instalador, até ~150 MB (R34) |

Também verificado: **E2EE** (ofertas/respostas com tag MLS em todas as conexões da malha: 50 de 50 em 3 rodadas, 0 sem tag),
**legenda ASS** (estava quebrada no app construído; corrigida), **as duas rotas do som do filme** tocam (nível
> −60 dBFS), **`canPlay`** certo nos 7 fixtures, **cota do gateway** (pior janela: 130 frames `cinema_*` por 60 s, limite 300;
com 3 conexões por par, Task 16: 119 em quem projeta, 45–60 nos outros; simulado com 8 poltronas: 35 frames de malha
por cliente em 60 s, 167 com status, relógio e índice). **Troca de áudio com perda** continua reprovando (salto de
191,5–975,5 ms; ver "Vazão sob perda").

## Método

- **Pilha:** `scripts/qa-stack.mjs` (API com PGlite em memória e LiveKit locais, contas novas a cada rodada). O build de QA é
  aberto por uma junção em `<repo>/node_modules/.alga-qa-lab`, para o main achar o WASM do MLS (`native/mls/pkg`): sem
  isso a E2EE não sobe no build de QA (descoberto nesta task; o `--e2ee` liga `Space.e2ee` do espaço de teste).
- **Janelas:** 1280×760, `--disable-features=CalculateNativeWinOcclusion` (as janelas sobrepostas continuam
  desenhando), `--mute-audio` (nada sai nas caixas do PC; o grafo WebAudio continua processando, o que permite medir
  o nível). Microfone falso do Chromium na chamada.
- **Filme:** `long-h264-1080p-8mbps-10min.mkv` (gerado nesta task: testsrc2 + ruído, x264, GOP 2 s, **7,9 Mbps** no total,
  AC-3 5.1 640k que o app converte para AAC) remuxado com duas faixas de áudio (para provar a troca), SRT, ASS e a fonte:
  611,6 MiB, 600 s.
- **Sincronia:** cada janela registra **todo** quadro exibido com `requestVideoFrameCallback`
  (`performance.timeOrigin + expectedDisplayTime`, `mediaTime`); o script compara offline. Erro entre duas janelas =
  diferença das medianas de `mediaTime − instante de exibição` em janelas de 250 ms (tira a cadência 24p-em-60 Hz).
  Mesmo PC = mesmo relógio, então não há erro de relógio entre as janelas (o relógio do app contra o servidor local
  tem offset ~0 e RTT ~1 ms: a parte de rede do relógio fica para o teste entre casas).
- **Rede emulada (`--netem`):** a malha P2P do cinema só aprende candidatos remotos reescritos para um proxy UDP por
  candidato (worker com o `Link` de `scripts/netem/udp-impair.mjs`: perda, atraso e jitter por sentido, sem
  reordenar). `--host-cap` limita o **upload somado** de quem projeta (um balde de tokens compartilhado por todos os
  enlaces que saem dela, fila drop-tail de `queue` ms). Sinalização (WebSocket) e a call LiveKit não passam pelo
  proxy. Conferido pelo par de candidatos selecionado (`prflx` no endereço do proxy) e pelos bytes que passaram nele
  (iguais aos dos data channels). Perfil "1 % + 40 ms" = 1 % de perda **em cada sentido** e 20 ms ± 2 de atraso
  **em cada sentido** (RTT +40 ms).
- **Upload de quem projeta:** bytes dos data channels `cinema` (`RTCPeerConnection.getStats`) somados por janela,
  comparados ao tamanho do filme em peças (vídeo + áudio padrão, do índice).
- **RAM:** `app.getAppMetrics()` a cada 10 s (working set por tipo de processo), com uma amostra na chamada antes de
  abrir a sessão (linha de base).
- **Rastro do enxame:** o script registra cada pedido de peça enviado e o primeiro/último pedaço recebido de cada peça
  (lê o cabeçalho de `swarm/protocol.ts`); foi isso que achou a causa do primeiro frame lento.

## Resultados

### Player no Electron

- **Play agendado:** primeiro quadro 3–37 ms depois de `at`; erro contra a posição esperada (somando os 52 ms de
  latência de saída do áudio, R28): **−14,3 a +0,3 ms** em 6 poltronas → dentro de ±1 frame (41,7 ms). Passa. Com 4 janelas e rede emulada (4 instâncias decodificando 1080p na mesma máquina): −1,2 a −59,1 ms; 2 de 6
  poltronas passaram de 1 frame (−42 e −59 ms) no primeiro quadro, e o laço de sincronia as trouxe para < 20 ms em seguida.
- **Pausa no frame exato:** em todas as 8 pausas (2 e 3 janelas) a posição final de cada poltrona é **exatamente** a
  posição calculada pelo servidor (diferença 0 frame); quem passou volta com um seek. Captura:
  `docs/screenshots/2026-11-05-cinema-lab-same-frame.jpg`.
- **`setAudio`: passa na rede local; com perda falha (Task 15).** Rede local: troca em 227–232 ms, **0 seeks**, maior
  salto entre quadros consecutivos 3,6–24,2 ms (a cadência normal 24p em 60 Hz; um frame pulado seria > 41,7 ms), erro
  contra quem projeta ≤ 33 ms durante a troca. Rede emulada (a nova faixa precisa chegar pelo enxame): 4 janelas com
  0,1 % de perda **8 597 ms** e salto de **391,7 ms** (o vídeo parou esperando a faixa); 4 janelas com 1 % **20,6 s**;
  2 janelas, upload 20 Mbps, fila 1 s: **nunca terminou** (timeout `on a1`); 2 janelas com 0,1 % 4,4 s, com 1 % 18,7 s.
  Re-medido depois da Task 16: ver "Vazão sob perda".
- **`canPlay` por fixture** (esta máquina, RTX 3070):

| Fixture | Resultado |
|---|---|
| `h264-ac3-51` | decodifica (AC-3 → AAC) |
| `hevc10-hdr10-eac3-51` | decodifica (HEVC por hardware) |
| `hevc10-truehd-71` | decodifica |
| `av1-opus-51` | decodifica |
| `h264-dts-51` | decodifica (DTS → AAC) |
| `h264-aac-srt-ass` | decodifica |
| `mpeg2-mp2` | **recusado na sonda**, antes da ficha: "Este formato de vídeo ainda não é suportado (só H.264, HEVC, AV1 e VP9)." |

### Primeiro frame

"Antes" = rodada feita antes da correção do índice (abaixo); "depois" = com ela. Cada linha cita o resumo
`docs/benchmarks/cinema-engine-<tag>.json` de onde vem (a correção entrou entre `2x-lan-trace` e `2x-lan-trace-fix`).

| Rodada | Índice | Quem projeta | Amigo | JSON |
|---|---|---|---|---|
| Rede local, 2 e 3 janelas (4 rodadas) | antes | 1,2–1,3 s | 3,8–6,7 s | `2x-lan`, `2x-lan-trace`, `3x-lan-e2ee`, `3x-lan-late` |
| Rede local, 2 janelas | depois | 1,2 s | **2,8 s** | `2x-lan-trace-fix` |
| RTT 40 ms, upload 12 Mbps, fila 300 ms | antes | 1,2 s | 23,8 s | `2x-rtt40` |
| RTT 40 ms + 0,1 % de perda, upload 12 Mbps | antes | 1,0 s | 17,4 s | `2x-rtt40-loss0.1` |
| RTT 40 ms + 1 % de perda, upload 12 Mbps | antes | 1,2 s | 38,5 s | `2x-rtt40-loss1` |
| RTT 40 ms, upload 20 Mbps, fila 300 ms | antes / depois | 1,2 / 1,5 s | 29,5 / **25,5 s** | `2x-rtt40-cap20`, `2x-rtt40-cap20-fix` |
| RTT 40 ms, upload 20 Mbps, fila 1000 ms | depois | 1,1 s | **4,4 s** | `2x-rtt40-cap20-q1000` |
| 4 janelas, RTT 40 ms + 0,1 %, upload 12 Mbps, fila 1 s | depois | 1,2 s | 8,1 e **9,1 s** | `4x-loss0.1-rtt40-cap12` |
| 4 janelas, RTT 40 ms + 1 %, upload 12 Mbps, fila 1 s | depois | 1,5 s | 14,3 e **23,1 s** | `4x-loss1-rtt40-cap12` |

(A versão anterior deste documento dizia "3,4–6,7 s em 5 rodadas": o 3,4 s e a quinta rodada não têm resumo
commitado; ficam fora.)

**Duas causas, achadas pelo rastro do enxame:**
1. **Índice do áudio atrasado (corrigido).** Quem projeta manda o índice em no máximo 3 frames a cada 2 s (cota do
   gateway), em rodízio entre todas as faixas pendentes (vídeo, os dois áudios, as legendas, pôster, miniaturas). O
   áudio padrão ficava para trás: no rastro, o pedido de `a0:0` (init do áudio) só saía 6,2 s depois de sentar, e sem
   ele o MSE não mostra quadro nenhum. Agora o envio é por prioridade: vídeo e áudio padrão primeiro, depois quem mandou
   menos, um frame por faixa por rodada (`flushOrder` em `store.ts`, com teste). Rede local: 6,7 s → **2,8 s**.
2. **Arranque do data channel num upload saturado (não corrigido).** Com upload de 20 Mbps e fila drop-tail de 300 ms,
   a primeira peça de vídeo (3,1 MB) levou **22,8 s** (≈ 1 Mbps), e depois o enlace andou a ~19,5 Mbps. O SCTP do
   Chromium sai do slow start estourando a fila, perde uma rajada e cai em retransmissão por tempo (backoff
   exponencial). Com fila de 1 s o arranque foi rápido (4,4 s), mas a mesma rodada travou 11 s depois por perdas na
   fila. Ou seja: **o data channel não se dá bem com um gargalo saturado**, e o enxame satura o upload de quem projeta
   porque pré-carrega o filme o mais rápido que pode. Recomendação no fim.

### Perda de pacotes e vazão por conexão

Duas janelas, 60 s tocando, upload de quem projeta limitado a 12 Mbps (1,5× o filme):

| Perfil (cada sentido) | Perda medida no proxy | Vazão do amigo | Travou? |
|---|---|---|---|
| 20 ms, sem perda | 0 % | 11,4 Mbps (o teto) | não |
| 20 ms, 0,1 % | 0,10 % | 8,4 Mbps | não |
| 20 ms, **1 %** | 1,07–1,10 % | **2,5 Mbps** | **sim: 44 s parado em 60 s**, a sala esperou 1 vez |

Com 1 % de perda aleatória uma associação SCTP não passa de ~2,5 Mbps a 40 ms de RTT (o controle de congestionamento
reage a cada perda; bate com a fórmula de Mathis, ~2,9 Mbps para MTU ~1200 B). Um filme de 8 Mbps precisa de
**pelo menos 3–4 conexões em paralelo** para esse perfil. 0,1 % já basta para 1080p web.

### Sincronia (rede local)

| Rodada | Pares de quadros (bins de 250 ms) | p50 | p95 | máx. | > 125 ms |
|---|---|---|---|---|---|
| 2 janelas, 90 s (`2x-lan`) | 322 | 8,5 ms | 27,8 ms | 36,5 ms | nunca |
| 3 janelas, 40 s (`3x-lan-late`) | 143 | 8,1 ms | 25,1 ms | 31,9 ms | nunca |
| 3 janelas, E2EE, 170 s (`3x-lan-e2ee`) | 612 | 11,1 ms | 33,3 ms | 52,9 ms | nunca |

Atenção (revisão da Task 15): nas rodadas de 3 janelas o script da Task 15 só comparou **Bruno × Ana** (a terceira
janela, quem entrou no meio, ficou fora de `early.slice(1)`). O script atual compara **todos os pares**, e a Task 16
re-mediu a rede local assim (seção "Vazão sob perda"). Ponto cego do método: uma poltrona congelada não apresenta
quadros (rVFC), então não há amostra de sincronia enquanto ela está parada; o erro acumulado aparece quando ela volta.

Com a rede emulada (2 janelas) o p95 ficou em 19,8–27,5 ms enquanto havia dados; o único trecho > 125 ms (250 ms) foi
na rodada com 1 % de perda, junto de um travamento.

### Pausa

8 pausas: todas as poltronas no **mesmo frame** (diferença 0) e paradas **12–231 ms** depois do instante agendado
(`at`), 285–500 ms depois do clique. O `at` é o clique + ida ao servidor + `CINEMA_LEAD_MS` (250 ms), de propósito: é o
que deixa todos pararem juntos. O pior caso (231 ms) foi uma poltrona que precisou voltar com um seek.

Limite do método da Task 15: o "mesmo frame" comparava o `currentTime` de cada janela **depois** do seek de volta, não
o quadro que estava na tela. O script atual compara o `mediaTime` do **último quadro apresentado** (rVFC) de cada
janela e registra o viés de relógio de cada uma (`Date.now() − (performance.timeOrigin + performance.now())`, em
`M.clockBiasMs`), que limita o erro entre janelas. Re-medido na Task 16 (seção "Vazão sob perda").

### Entrar no meio, e o `LATE_SEEK_S`

Sete entradas no meio (rede local; seis delas com E2EE, saindo e sentando de novo a cada ~20 s):

| Entrada | Primeiro quadro | Sincronizado (≤ 1 frame por 1 s) | Erro logo depois do 1º seek |
|---|---|---|---|
| 1 (sem E2EE) | 0,94 s | 1,18 s | −2,7 ms |
| 2 | 0,83 s | 2,55 s | −39 a −55 ms → empurrão de velocidade |
| 3 | 1,09 s | 2,27 s | −39 a −45 ms → empurrão |
| 4 | 3,34 s | 3,77 s | 0 ms |
| 5 | 0,66 s | 2,48 s | −39 a −45 ms → empurrão |
| 6 | 1,17 s | 1,43 s | −20 ms |
| 7 | 2,74 s | **9,85 s** | o 2º seek caiu fora do buffer → travou → **a sala pausou 7 s para todos** |

- **`LATE_SEEK_S` (0,5 s) não entra em jogo numa entrada no meio:** quem senta começa em 0 s, então o `apply` sempre
  pula (erro de dezenas de segundos). Depois disso o erro é o tempo até chegar a primeira peça (0,5–3,2 s, > 500 ms)
  → o laço de sincronia faz um seek imediato; sobra −20 a −55 ms (a latência do próprio seek, ainda não aprendida),
  que a velocidade corrige em 1–2 s. O caso do review ("100–500 ms fora, empurra 5 s e depois pula") **não apareceu
  em nenhuma das 7 entradas**. **Recomendação: manter `LATE_SEEK_S = 0,5`** (os dados não sustentam mudar); ele só vale
  para um comando atrasado numa poltrona que já está tocando.
- **Corrigido:** a 7ª entrada mostrou que quem acabou de sentar podia mandar `stalled` e pausar a sala para todo mundo
  ("Esperando a Carla", 7 s). Agora, nos primeiros `CINEMA_READY_TIMEOUT_MS` (10 s) depois de sentar numa sala que
  já está tocando, um travamento é informado como "preparando": a sala segue e quem entrou alcança sozinho
  (`arrivingUntil` em `store.ts`, com teste). Depois de 10 s, um travamento de verdade volta a pausar a sala.

### 4 instâncias, rede emulada, filme inteiro

Quatro janelas (Ana projeta; Bruno e Carla sentam no começo; Davi entra no meio, aos 30 s), chamada E2EE, upload de
quem projeta limitado a **12 Mbps (1,5× o filme)**, fila de 1 s, RTT +40 ms. Duas rodadas:

| | 1 % de perda, 560 s (o filme quase inteiro) | 0,1 % de perda, 300 s |
|---|---|---|
| Primeiro frame (Ana / Carla / Bruno) | 1,5 / 14,3 / 23,1 s | 1,2 / 9,1 / 8,1 s |
| Davi entra no meio | primeiro quadro 14,2 s; sem medida de sincronia: a sala estava parada esperando outra poltrona | primeiro quadro 1,7 s; idem (sala parada esperando o Bruno) |
| Sala esperando alguém travado | **10 vezes**, ~35–40 s cada: **343 s parada em 560 s** | **6 vezes**, 15–25 s cada: **118 s parada em 300 s** |
| Eventos `waiting` por amigo | 11–12 | 6–14 (vários < 2 s, que não pausam a sala) |
| Sincronia por par, sem filtro (p95; máx.; maior trecho > 125 ms), Davi fora | Bruno×Ana 13,2 ms, Carla×Ana 18,8 ms, Carla×Bruno 7,6 ms; máx. 1,6–1,9 s; 250 ms | Bruno×Ana **300,1 ms**, Carla×Ana **175,8 ms**, Carla×Bruno 55,5 ms; máx. 2,2–2,4 s; **2,75 s** (travamentos curtos, < 2 s, que não pausam a sala: quem travou fica para trás e volta com um seek) |
| Pausa (3 / 2) | mesmo frame em todas; ≤ 44 ms depois de `at` | mesmo frame em todas; ≤ 31 ms depois de `at` |
| Quem projeta enviou | 591 MiB (**1,05× o filme**, a 9,7 Mbps: o teto de 12 não foi atingido, 0 descartes na fila) | 484 MiB em ~5 min (no teto de 12 Mbps) |
| Cada amigo recebeu | 235–272 MiB (~44 % do filme; ~3,5 Mbps), 12–28 % de amigos | 219–245 MiB (~6 Mbps, abaixo dos 7,9 do filme); os amigos repassaram só ~5,4 Mbps somados |
| Descrições com tag E2EE | 12 de 12 | 12 de 12 |

Correção (revisão da Task 15): a versão anterior desta tabela citava p95 "fora das esperas (±3 s)" de 5,6–13,8 ms e
46–50 ms, mas esse filtro não estava no script nem nos JSONs commitados. Os números acima são os do JSON, por par e
sem filtro. O script atual calcula as duas coisas (`M.sync` sem filtro e `M.syncOutsideWaits` sem as esperas ± 3 s),
para todos os pares, inclusive quem entrou no meio.

Com 1 % de perda **o gargalo não é o upload de quem projeta, é cada conexão** (~2,5 Mbps, ver acima): três
conexões por amigo não chegam aos 7,9 Mbps do filme, então a sala para a cada ~60 s para esperar alguém. Com 0,1 % o
gargalo passa a ser o upload de quem projeta (12 Mbps) somado ao repasse entre amigos: três amigos precisam de
23,7 Mbps, quem projeta dá 12, e os amigos só repassaram ~5,4 Mbps (precisariam de ~11,7). O repasse entre amigos numa
rede com perda não rendeu o suficiente. (A versão anterior dizia "o super-seed funciona, cada peça ~1×": os JSONs da
Task 15 só têm bytes enviados ÷ tamanho do filme, `hostOverFilm` 1,0 e 0,9, o que não prova isso; a métrica certa,
bytes enviados ÷ a união das peças que os amigos receberam, `hostOverUnion`, entrou no script na Task 16.)
**Travamentos: reprova nos dois perfis.** Na rede local (3 janelas, 170 s) houve zero travamentos.

### Enxame: de amigo para amigo e upload de quem projeta

Rede local, 3 janelas: a terceira pessoa recebeu **95–99 % das peças de amigos** (só 1–5 % de quem projeta), e quem
projeta enviou **1,1× o filme** (627,5 MiB para 564,6 MiB de peças de vídeo + áudio padrão; a diferença inclui a
segunda faixa de áudio que o Bruno baixou ao trocar). Captura: `docs/screenshots/2026-11-05-cinema-lab-stats.jpg`.

### RAM

Working set de todos os processos de cada instância (`getAppMetrics`), linha de base = na chamada, antes de abrir a
sessão; pico = durante a sessão (4 janelas, 1 % de perda, 560 s; inclui a call LiveKit e o microfone falso):

| Janela | Linha de base | Pico | Cinema (pico − base) | Renderer no pico |
|---|---|---|---|---|
| Ana (projeta) | 899 MiB | 1 296 MiB | **397 MiB** | 545 MiB |
| Bruno | 1 004 MiB | 1 359 MiB | **354 MiB** | 516 MiB |
| Carla | 1 018 MiB | 1 384 MiB | **366 MiB** | 547 MiB |
| Davi (entrou no meio) | 974 MiB | 1 571 MiB | **597 MiB** | 707 MiB |

O cinema custa **354–597 MiB** por cliente (meta ≤ 1,5 GB: passa com folga). O app inteiro, com a call, chegou a
1,27–1,53 GiB. O renderer cresce com as sessões: a janela que saiu e sentou 6× (rede local) chegou a 679 MiB de
renderer (parte disso é do próprio lab, que cria um `AudioContext` de medição por sessão).

### Instalador

`npm run dist -w apps/desktop` nesta branch: **`AlgaMeet-Setup-0.1.8.exe` = 167 143 969 bytes (159,4 MiB)**. A v0.1.8 da
main (release do GitHub) tem 116 149 715 bytes (110,8 MiB). **Diferença: +48,6 MiB (+51,0 MB) → reprova (meta ≤ 40 MB).**

| O que entrou | Sem compressão | Comprimido (7z LZMA2 -mx7, só a pasta) |
|---|---|---|
| `resources/ffmpeg` (LGPL, DLLs compartilhadas) | 155,6 MB (`avcodec` 91,9 MB, `avfilter` 31,9 MB, `avformat` 19,9 MB, `avdevice` 5,0 MB…) | **39,7 MiB** |
| `app.asar` (código do cinema + JASSUB/libass WASM 4,2 MB) | +4,8 MB | ~2 MiB |

O build LGPL genérico traz todos os codecs e filtros. O cinema usa poucos: demux de MKV/MP4, mux MP4/HLS fMP4,
decoders de áudio (AC-3, E-AC-3, DTS, TrueHD…), encoders `aac`/`libopus`/`flac`, `aformat`/`aresample`, `extract`
de legendas e anexos, e um quadro em WebP (pôster/miniaturas). **Recomendação:** um build LGPL mínimo (só esses
componentes, `--disable-everything` + `--enable-…`) cabe em ~8–15 MB e resolve; alternativa: baixar o ffmpeg na
primeira vez que alguém projeta.

### E2EE

Três rodadas com o espaço em E2EE (3 janelas na rede local; 4 janelas nos dois perfis de rede; o cabeçalho mostra
"Criptografia de ponta a ponta"): **50 descrições (ofertas/respostas) enviadas, todas com tag MLS**, 0 sem tag;
malha montada e peças trafegando normalmente. A
regra das fingerprints e do exporter está em `docs/decisions/0004-e2ee.md`. A falha de E2EE com alguém sentado agora
mostra "Não foi possível proteger a conexão desta sessão" e deixa a poltrona "preparando" (teste de estado; não foi
provocada numa janela real).

### Legenda ASS

**Estava quebrada no app construído:** o worker do JASSUB era copiado com `?url` sem empacotar as dependências
(`import … from 'abslink'` dentro do worker), então ele nunca iniciava e o canvas ficava em 300×150 sem legenda (os
testes unitários não pegam: o JASSUB é simulado). Corrigido com `?worker&url` (o Vite empacota o worker) e uma trava no
`check-package.mjs`, que agora reprova o `npm run dist` se um asset do renderer tiver import "nu". Captura com a
legenda estilizada desenhada: `docs/screenshots/2026-11-05-cinema-lab-ass-bruno.jpg`.

### Rotas do som do filme

O painel S ganhou "Saída do som do filme" (WebAudio ou MediaStream `<audio>`, vale na próxima sessão), para o teste de
eco com o dono comparar as duas. Nível medido por um `AnalyserNode` ao lado da ligação do grafo com a saída (o som não
saiu nas caixas: `--mute-audio`):

| Rota | Onde | Nível |
|---|---|---|
| WebAudio | ganho → `AudioContext.destination` | −10,4 dBFS |
| MediaStream | ganho → `MediaStreamAudioDestinationNode` | −10,3 dBFS |
| MediaStream | o `MediaStream` desse destino (o que o `<audio>` toca), lido de volta | −13,4 dBFS |

As duas tocam (> −60 dBFS). Se o `<audio>` chega no dispositivo não dá para ver sem captura de loopback: fica para o
teste com o dono, junto do eco.

### Cota do gateway

Pior janela de 60 s por janela: 113–130 frames `cinema_*` em quem projeta, 35–48 nos outros (limite: 300).

## Vazão sob perda (Task 16)

> 2026-11-06. Mesmas condições da Task 15 (4 janelas, E2EE, Davi entra aos ~30 s, upload de quem projeta 12 Mbps =
> 1,5× o filme, fila de 1 s, RTT +40 ms; 0,1 % e 1 % de perda em cada sentido). Build final da branch (`4cde089`).
> Resumos finais: `cinema-engine-t16-final-4x-loss0.1.json`, `cinema-engine-t16-final-4x-loss1.json`,
> `cinema-engine-t16-final-3x-lan.json`. Rodadas intermediárias (versões anteriores do motor, citadas abaixo):
> `cinema-engine-t16-4x-loss0.1-rtt40-cap12.json` e `…-loss1-…` (`06c4f5a`), `…-loss0.1-…-552fe3d.json`,
> `cinema-engine-t16-3x-lan-e2ee-late.json` (`552fe3d`).

**O que mudou no motor** (detalhes em `mesh.ts`, `swarm/uploader.ts`, `swarm/scheduler.ts`, `store.ts`):
1. **3 conexões por par** (`CINEMA_LANES`): uma associação SCTP por conexão. A primeira abre na hora; as outras duas
   2 s e 4 s depois que ela abre. Cada uma é autenticada como antes (tag MLS sobre a própria fingerprint e o número da
   conexão). Se uma cai, o par segue nas outras.
2. **Canal de controle ordenado + canal de dados sem ordem** em cada conexão: pedidos, cancelamentos, `have`/`got` e
   `none` vão num canal ordenado (sempre o mesmo por par); os pedaços (que já levam o offset) vão sem ordem, divididos
   entre as conexões (a de menor fila primeiro). Uma perda não segura mais tudo o que vem atrás.
3. **Ritmo do pré-carregamento**: o que não é crítico sai a 1,5× o bitrate por par e cai pela metade enquanto o RTT de
   uma conexão passa de 2× o mínimo dela (com folga de 25 ms); o que é crítico nunca espera.
4. **Pré-carga adaptativa**: abaixo de 1,1× o bitrate (medido só nos segundos em que havia download), a poltrona só
   diz "pronto" com 30 s à frente depois de começar/pular, e 60 s depois de um travamento seu.
5. **Super-seed também para pedidos urgentes** (achado no lab): quem projeta só repete uma peça que outro amigo já tem
   (ou está recebendo) se ela começa a menos de 10 s da posição da sala. Antes, cada amigo puxava a janela crítica
   inteira (30 s) de quem projeta: **1,8×** as peças, fila do upload a 168–300 ms e 98 s de sala parada em 300.
6. Pré-carga que vira crítica sem ter recebido nada é pedida de novo como urgente; quem entra no meio não pausa a sala
   até ficar "pronto" uma vez.
7. Mensagens que chegam por uma conexão antes de ela ser entregue ao enxame são guardadas e repassadas (antes se
   perdiam: uma peça pedida duas vezes, primeiro frame 5,8 s na rede local).
8. Na fila de envio de cada par, o que é urgente sai na ordem do tempo do filme, e um init de um pedaço só passa na
   frente do que está sendo enviado (um init de áudio esperou ~10 s atrás de 6 MB de vídeo: primeiro frame 21 s).

| | Task 15, 1 % (560 s) | **Task 16, 1 % (560 s)** | Task 15, 0,1 % (300 s) | **Task 16, 0,1 % (300 s)** |
|---|---|---|---|---|
| Sala parada depois do primeiro play | 343 s (10 esperas) | **0 s** (nenhuma espera) | 118 s (6 esperas) | **0 s** (nenhuma espera) |
| Primeiro frame (última poltrona) | 23,1 s | **9,1 s** | 9,1 s | **12,1 s** |
| Todas "pronto" (pré-carga de 30 s) | — | 37,0 s | — | 32,0 s |
| Davi entra no meio: 1º quadro / sincronizado | 14,2 s / não medido | **10,2 s / 12,9 s** | 1,7 s / não medido | **5,9 s / 11,8 s** |
| Sincronia, **todos** os pares, sem filtro: p95 (máx.) | 7,6–18,8 ms (sem Davi; máx. 1,9 s) | **22,8–27,2 ms** (máx. 49,9 ms) | 55,5–300,1 ms (sem Davi; máx. 2,4 s) | **24,5–30,3 ms** (máx. 49,7 ms) |
| … maior trecho > 125 ms | 250 ms | **nunca** | 2,75 s | **nunca** |
| Cada amigo recebeu | 235–272 MiB (~44 % do filme) | **565–577 MiB** (o filme inteiro) | 219–245 MiB | 347–353 MiB |
| Quem projeta enviou ÷ união das peças recebidas | (não medido) | **1,04×** (596,7 MiB) | (não medido) | **1,08×** (379,7 MiB) |
| Amigos repassaram (cada) | — | 318–415 MiB | — | 196–242 MiB |
| Fila do upload de quem projeta (o que a voz dele esperaria): p50 / p95 / máx. | — | **20 / 61 / 100 ms** | — | **77 / 249 / 479 ms** (28 % do tempo > 150 ms) |
| Pausa: mesmo quadro (último rVFC), pior poltrona depois de `at` | — | 3/3, ≤ 133 ms | — | 3/3, ≤ 255 ms |
| Troca de áudio (troca / seeks / maior salto) | 20,6 s | 455 ms / 1 / **975,5 ms** | 8 597 ms / — / 391,7 ms | 451 ms / 0 / **191,5 ms** |
| Descrições com tag E2EE | 12/12 | **36/36** (3 conexões × 3 pares × 4) | 12/12 | **36/36** |
| Pior janela de 60 s de frames `cinema_*` (quem projeta / outros) | 113 / 38–48 | 114 / 45–50 | 113 / 39–48 | 115 / 46–50 |
| RAM do cinema (pico − base) | 354–597 MiB | 436–646 MiB | — | 390–703 MiB |
| Perda medida no proxy | 1,07–1,10 % | 1,00 % | 0,10 % | 0,10 % |

Leitura:
- **1 %:** as três conexões por par acabam com o teto de ~2,5 Mbps por associação: cada amigo recebeu o filme
  inteiro, a sala não parou nenhuma vez e o primeiro frame caiu de 23,1 para 9,1 s. Quem projeta mandou cada peça
  ~1× (1,04×) a ~8,5 Mbps dos 12, e a fila do upload ficou baixa (p95 61 ms).
- **0,1 %:** sem esperas e primeiro frame 12,1 s, mas no limite: aqui o gargalo é o upload de quem projeta (12 Mbps
  para três amigos; com 0,1 % cada conexão rende mais, e a pré-carga enche o upload), e a fila dele fica alta boa parte
  do tempo (p50 77 ms, p95 249 ms). Durante o ajuste a mesma configuração deu, com versões anteriores do motor, 98,3 s,
  0,6 s, 37,3 s, 11,4 s e 0 s de sala parada e 8,4–21,0 s de primeiro frame (tabela de iterações em
  `task-16-report.md`): a variação entre rodadas é grande; uma rodada por versão não basta para afirmar estabilidade.
- **Voz de quem projeta:** a chamada LiveKit não passa pelo proxy, então a medida é indireta: o atraso de fila que um
  pacote de voz teria no upload limitado. Com 1 % fica baixo; com 0,1 % (upload saturado) passa de 150 ms em 28 % do
  tempo: o ritmo do pré-carregamento corta pela metade quando o RTT sobe, mas o tráfego crítico e as rajadas de
  pré-carga (cada peça sai inteira na velocidade do enlace) mantêm a fila. **Não protege a voz o bastante** num upload
  saturado com fila longa; ver recomendações.
- **Troca de áudio** (re-medida, R35): continua falhando com perda no critério "nenhum salto > 1 frame" (191,5 e
  975,5 ms), embora a troca leve ~450 ms em vez de 8,6–20,6 s: a faixa nova só existe em quem projeta e as primeiras
  peças dela chegam depois que o vídeo segue.
- **Play agendado** com 4 instâncias decodificando 1080p na mesma máquina: erro do primeiro quadro −44 a −66 ms
  (Task 15: −1 a −59 ms), 1–2 frames, corrigido pelo laço de sincronia em seguida.

### Rede local depois da Task 16 (regressão)

3 janelas, E2EE, 170 s, Carla entra no meio 5 vezes (sai e senta de novo), sem `--netem`. Build final
(`cinema-engine-t16-final-3x-lan.json`) e a rodada anterior, sem a ordem de envio do item 8
(`cinema-engine-t16-3x-lan-e2ee-late.json`, `552fe3d`): **11/11 verificações passam nas duas**.

| | Meta | Task 15 | **Task 16 (final)** | Task 16 (`552fe3d`) |
|---|---|---|---|---|
| Primeiro frame (Abrir sessão → todos vendo) | ≤ 10 s | 2,8 s | **4,7 s** | 3,0 s |
| Sincronia p95, **todos** os pares (máx.) | ≤ 42 ms | 25–33 ms (só Bruno × Ana) | **22,1–24,9 ms** (35,8 ms) | 22,1–27,3 ms (38,9 ms) |
| Nunca > 125 ms por > 1 s | — | sim | **sim** (nunca > 125 ms) | sim |
| Entrar no meio: 1º quadro / sincronizado | ≤ 8 s | 6 de 7 em 1,2–3,8 s; 1 em 9,85 s | **1º quadro 0,6–1,5 s; sincronizado 1,1–1,8 s em 4 de 5, 7,5 s em 1** | 0,9–2,9 s / 1,3–3,2 s (5 de 5) |
| Pausa: mesmo quadro (último rVFC), depois de `at` | ≤ 300 ms | 8/8, 12–231 ms | **3/3, 27–65 ms** | 3/3, 29–259 ms |
| Troca de áudio | 0 seeks, salto ≤ 1 frame | 227–232 ms, salto 3,6–24,2 ms | **349 ms, 0 seeks, salto 3,6 ms** | 241 ms, 0, 3,6 ms |
| Upload de quem projeta | ≤ 1,5× | 1,1× o filme | **0,8× o filme; 0,86× a união das peças** | 0,7×; 0,83× |
| Sala parada | zero | zero | **zero** | zero |
| Descrições com tag E2EE | todas | — | **66/66** | 66/66 |
| Pior janela de 60 s de frames `cinema_*` (quem projeta / outros) | < 300 | 113–114 / 35–48 | 118 / 53–60 | 119 / 54–58 |
| RAM do cinema (pico − base) | ≤ 1,5 GB | 354–597 MiB | 368–602 MiB | — |

**Primeiro frame na rede local: 2,8 s (Task 15) → 3,0–5,8 s (Task 16).** Passa a meta (≤ 10 s), mas piorou, e a causa
é a abertura das conexões extras: nas três rodadas a peça `v:1` (3 MB) estava a caminho quando a segunda conexão
abriu (~2,4 s depois de sentar) e levou 1,8–2,9 s, enquanto as seguintes levaram 10–250 ms cada. Uma parte foi
corrigida (`552fe3d`: o que chegava por uma conexão antes de ela ser entregue ao enxame se perdia; 5,8 → 3,0 s); o
resto (a rodada final deu 4,7 s) não foi isolado. Próximo passo: não dividir uma peça já começada com uma conexão que
acabou de abrir, ou abrir as conexões extras só depois do primeiro frame.

Uma entrada no meio (a 3ª) levou 7,5 s para sincronizar: primeiro quadro em 0,6 s, mas o erro depois do 1º seek ficou em
−431 ms; o laço de sincronia empurrou a velocidade por 5 s (−431 → −215 ms) e então fez o seek (5,9 s), sincronizado
a 7,5 s. É o caso "100–500 ms fora, empurra 5 s e depois pula" do review do `LATE_SEEK_S`, que não tinha aparecido nas 7
entradas da Task 15: apareceu 1 vez em 10 entradas medidas aqui (dentro da meta de 8 s, por pouco).

## O que não foi medido, e por quê

- **Eco com caixa de som** e o efeito das duas rotas no cancelamento de eco: precisa de som real numa sala e de outra
  pessoa ouvindo. Roteiro: `docs/qa/2026-11-05-cinema-teste-com-o-dono.md`.
- **Internet de verdade entre duas casas**, relay (coturn) e taxa de quem precisa dele: o relay não está no ar (este
  PC fica numa sub-rede da casa que não alcança o servidor de casa, 192.168.1.110). A rede emulada cobre perda, atraso e
  teto de upload, não NAT nem a fila real de um roteador.
- **Sessão de 2 h** (meta de travamentos): rodou o filme de 10 min inteiro; 2 h não cabe nesta task.
- **Filme real 1080p/4K do dono** (velocidade do ffmpeg num arquivo de 2 h, HDR numa tela HDR, Dolby Vision).
- **Relógio contra um servidor remoto**: aqui o servidor é local (offset ~0, RTT ~1 ms); o erro de relógio de rede vem
  no teste entre casas.
- **Bluetooth** (compensação de `outputLatency` com latência alta).

## Correções feitas nesta task

1. Quem projeta não perde o arquivo quando o servidor demora a responder o `cinema_hello` (só "não encontrada", fim
   da sessão ou sair da call fecham o arquivo); E2EE que falha com alguém sentado mostra o aviso e não cria malha sem tag.
2. Índice: vídeo e áudio padrão primeiro (primeiro frame 6,7 → 2,8 s na rede local).
3. Quem entra no meio não pausa a sala nos primeiros 10 s.
4. Legenda ASS no app construído (worker do JASSUB empacotado) + trava no `check-package.mjs`.
5. Preferência "Saída do som do filme" no painel S (para o teste de eco).

## Recomendações

1. ~~**Transporte sob gargalo**~~ feito na Task 16 (3 conexões por par, ritmo do pré-carregamento, pré-carga adaptativa,
   super-seed para pedidos urgentes). O que sobra:
   - **voz de quem projeta num upload saturado:** com 0,1 % a fila do upload limitado ficou em p50 77 / p95 249 ms.
     Próximo passo: um teto para o envio somado de quem projeta (a partir da vazão medida, com folga para a voz) em vez
     de só cortar o ritmo do pré-carregamento por par; e espaçar os pedaços de uma peça de pré-carga.
   - **primeiro frame na rede local** 2,8 → 3,0–5,8 s: não dividir uma peça já começada com uma conexão que acabou de
     abrir, ou abrir as conexões extras só depois do primeiro frame.
   - **troca de áudio com perda:** buscar as primeiras peças da faixa nova antes de trocar (hoje o vídeo segue sem elas).
   - **variação entre rodadas:** repetir cada perfil 3× antes do teste entre casas.
2. **ffmpeg mínimo** para o instalador caber nos +40 MB.
3. **`LATE_SEEK_S`:** manter 0,5 s.
4. **Rota do som:** decidir pelo teste de eco com o dono; enquanto isso, WebAudio continua o padrão.
5. ~~Repetir o lab depois de (1)~~ feito (seção "Vazão sob perda").
