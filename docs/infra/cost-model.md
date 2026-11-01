# Modelo de custos de infraestrutura — Alga Meet

- **Escopo:** mídia (LiveKit SFU + TURN), API/WebSocket (Fastify) + PostgreSQL, distribuição do app Electron.
- **Data de acesso das fontes:** 2026-11-01 (todas as URLs da seção 10).
- **Status:** rascunho para decisão. Os preços mudam; reconfirme as linhas marcadas "verificar" antes de assinar contrato.

## Convenção de tags

| Tag | Significado |
|---|---|
| **[FATO]** | Número tirado de fonte com URL (seção 10). "fonte secundária" = site de terceiros, não do fornecedor. |
| **[CÁLCULO]** | Derivado de FATO/HIPÓTESE. A fórmula vem junto. |
| **[HIPÓTESE]** | Premissa nossa. Ajuste e recalcule. |

Unidades: 1 GB = 10⁹ bytes, 1 TB = 10¹² bytes (exceto GCP, que cobra em GiB). Formato numérico pt-BR: ponto separa milhar, vírgula separa decimal.

---

## 0. Resumo executivo

1. **O vídeo (screen share) é ~77% do egress, e a voz só ~23%** [CÁLCULO, seção 3.3: 837 / 1.091 Mbps]. O custo depende de quanto vídeo o free tier pode transmitir.
2. **Mix recomendado ("freemium": free = 720p30, premium = 1080p60/1440p60):** 1.000 CCU de mídia gera **1,09 Gbps de pico** e **≈161 TB/mês** [CÁLCULO].
3. **Provedores com preço por GB ficam inviáveis com streaming gratuito.** A 1k CCU custam: LiveKit Cloud ≈ US$ 23,6 mil/mês, AWS sa-east-1 ≈ US$ 24 mil, GCP América do Sul ≈ US$ 22,9 mil [CÁLCULO]. Self-host em bare metal em São Paulo custa **US$ 0,75–1,8 mil** [CÁLCULO].
4. **Setup recomendado a 1k CCU:** LiveKit OSS em 2× Latitude.sh São Paulo + Railway (API/PG). Custo: **≈ US$ 0,93 mil/mês** com pacote de banda, ou **≈ US$ 1,98 mil/mês** a preço de lista [CÁLCULO, seção 7]. Por MAU: US$ 0,046–0,099/mês. Isso assume 5% CCU/MAU [HIPÓTESE].
5. **Hetzner, OVH e Contabo não têm região no Brasil.** Hetzner EU fica a ~200 ms de RTT de São Paulo; US-East fica a ~111 ms [FATO]. Para voz de gamer brasileiro, o SFU deve ficar em São Paulo.
6. **Railway não expõe UDP público.** Confirmado: a documentação descreve só TCP Proxy [FATO]. O SFU/TURN não roda lá. O Railway serve para API/WS/Postgres até ~10k CCU.

---

## 1. Premissas globais

| # | Premissa | Valor | Tag |
|---|---|---|---|
| P1 | Definição de **CCU** | Usuários conectados **ao SFU** (em sala de voz/vídeo) ao mesmo tempo, no pico. Usuários só "online" no gateway WS são contados à parte (P6). | [HIPÓTESE] |
| P2 | Razão média/pico de concorrência | 0,45. Produto concentrado em um fuso (BRT), pico noturno. | [HIPÓTESE] |
| P3 | Horas-pico-equivalentes por mês | 730 h × 0,45 = **328,5 h** | [CÁLCULO] |
| P4 | Conversão 1 Mbps sustentado por 1 h | 1 Mbps × 3.600 s ÷ 8 = **0,45 GB** | [CÁLCULO] |
| P5 | CCU de mídia ÷ MAU | 5% (1k CCU ≈ 20k MAU) | [HIPÓTESE] |
| P6 | Online no gateway WS ÷ CCU de mídia | 2,5× | [HIPÓTESE] |
| P7 | Câmbio | US$ 1 = R$ 5,50; € 1 = US$ 1,15 | [HIPÓTESE] |
| P8 | Falantes ativos simultâneos por sala | A = 2 (gamers com microfone aberto + gate de ruído). Conservador. | [HIPÓTESE] |
| P9 | Overhead de vídeo (cabeçalhos + retransmissão RTX/NACK) | ×1,08 sobre o bitrate do encoder | [HIPÓTESE] |
| P10 | Utilização do teto de bitrate de vídeo | 100% (jogo em movimento). Uma área de trabalho estática usa muito menos, então o modelo é conservador. | [HIPÓTESE] |
| P11 | Ingress (upload para o SFU) | Grátis na Hetzner [FATO, docs Hetzner Cloud billing FAQ], na Latitude ("∞ in") [FATO] e na Vultr (ingresso grátis) [FATO, blog Vultr]. Fora do modelo. | — |

---

## 2. Bitrates por stream

### 2.1 Overhead por pacote RTP

| Camada | Bytes | Tag |
|---|---|---|
| IPv4 | 20 | [FATO de protocolo, RFC 791] |
| UDP | 8 | [FATO de protocolo, RFC 768] |
| RTP | 12 | [FATO de protocolo, RFC 3550] |
| SRTP auth tag (HMAC-SHA1-80) | 10 | [FATO de protocolo, RFC 3711] |
| Header extensions (audio-level, transport-cc, mid, padding) | ~12 | [HIPÓTESE] |
| **Total** | **62 bytes/pacote** | [CÁLCULO] |

Com IPv6 somam-se +20 bytes/pacote (≈ +8 kbps em voz a 50 pps) [CÁLCULO: 20 × 8 × 50].

### 2.2 Voz — Opus, frames de 20 ms (50 pacotes/s)

Fórmulas [CÁLCULO]:
- Overhead = 62 B × 8 × 50 pps = **24,8 kbps**.
- Fio sem RED = R + 24,8.
- **RED** (RFC 2198, distância 1) repete o frame anterior e soma 5 bytes de cabeçalho RED por pacote. Fio com RED = R + 24,8 + (R + 2,0).
- **FEC in-band do Opus** (LBRR, RFC 6716/7587) é gerado *dentro* do bitrate-alvo. Custo de banda extra: **0** [CÁLCULO: o encoder divide o mesmo orçamento]. O custo é qualidade sob perda, não banda.
- **DTX** (silêncio): ~1 pacote a cada 400 ms ≈ 2,5 pps × (62 + 3) B × 8 = **1,3 kbps** por track calada [HIPÓTESE sobre a cadência; CÁLCULO do valor].

| Opus (payload) | Fio sem RED | Fio com RED | Uso sugerido | Tag |
|---|---|---|---|---|
| 32 kbps | 56,8 kbps | 90,8 kbps | Fallback em rede ruim | [CÁLCULO] |
| **64 kbps** | 88,8 kbps | **154,8 kbps** | **Padrão do modelo** (paridade "Discord padrão") | [CÁLCULO] |
| 96 kbps | 120,8 kbps | 218,8 kbps | Perk premium. Recomenda-se **desligar RED** e usar só FEC in-band. | [CÁLCULO] |

Referência: os presets do `livekit-client` são `speech` 24k, `music` 48k, `musicStereo` 64k, `musicHighQuality` 96k e `musicHighQualityStereo` 128k [FATO, options.ts]. O RED ligado por padrão no SDK é [HIPÓTESE]; confirme `red` em `TrackPublishOptions` e meça com `getStats()`.

### 2.3 Screen share com simulcast

Base: `ScreenSharePresets` do livekit-client. `h720fps30` = 2,0 Mbps, `h1080fps15` = 2,5 Mbps, `h1080fps30` = 5,0 Mbps, `original` = 7,0 Mbps @30 [FATO, options.ts]. O SDK não tem preset de 60 fps nem de 1440p para tela. Esses valores são HIPÓTESE.

| Qualidade (camada topo) | Bitrate topo | Camadas simulcast (upload) | Upload no fio (×1,08) | **Egress por viewer** (×1,08) | GB/h por viewer | Tag |
|---|---|---|---|---|---|---|
| 720p30 | 2,0 Mbps [FATO] | 720p30 + 360p15 (0,4 [FATO `h360fps15`]) | 2,59 Mbps | **2,16 Mbps** | 0,97 | [CÁLCULO] |
| 1080p30 | 5,0 Mbps [FATO] | + 720p30 + 360p15 | 7,99 Mbps | **5,40 Mbps** | 2,43 | [CÁLCULO] |
| 1080p60 | 8,0 Mbps [HIPÓTESE: ~1,6× 1080p30] | + 720p30 + 360p15 | 11,23 Mbps | **8,64 Mbps** | 3,89 | [CÁLCULO] |
| 1440p60 | 12,0 Mbps [HIPÓTESE: 1,78× pixels de 1080p60, ~15% de ganho de eficiência] | + 720p30 + 360p15 | 15,55 Mbps | **12,96 Mbps** | 5,83 | [CÁLCULO] |

Notas:
- O egress é calculado na camada topo: o viewer assiste em tela grande [HIPÓTESE]. `adaptiveStream` (pausa e reduz camada quando o elemento está oculto ou pequeno) reduz isso. É uma alavanca de custo direta.
- Com VP9/AV1, o mesmo bitrate dá qualidade maior. Também dá para baixar o bitrate em ~30–40% com a mesma qualidade [HIPÓTESE]. O encode AV1 em hardware só existe em GPUs recentes, então o H.264 continua sendo a base.
- **Upload do streamer:** 1080p60 exige ~11,2 Mbps estáveis e 1440p60 exige ~15,6 Mbps [CÁLCULO]. Isso é um risco de UX em conexões residenciais assimétricas. Para 1440p60, considere 2 camadas (sem 720p) ou sem simulcast.

---

## 3. Matemática de banda no SFU

### 3.1 Fórmula

O SFU não transcodifica. Ele encaminha cada track para cada assinante.

```
Egress_sala = Σ_assinantes Σ_tracks_assinadas bitrate_fio(track)
Voz (sala de N, A ativos):  (N−1) × [A × B_ativo + (N−A) × B_dtx]
Vídeo (1 stream, V viewers): V × bitrate_topo_fio
GB/h = Mbps × 0,45     TB/mês = GB/h × horas_de_uso ÷ 1000
```

B_ativo = 154,8 kbps (Opus 64 + RED). B_dtx = 1,3 kbps [CÁLCULO, seção 2.2].

### 3.2 Cenários pequenos (a)–(c)

| Cenário | Egress SFU | GB/h | Horas/mês [HIPÓTESE] | Egress/mês | Pior caso | Tag |
|---|---|---|---|---|---|---|
| (a) 5 amigos, só voz | 4 × (2×154,8 + 3×1,3) = **1,25 Mbps** | 0,56 | 90 h (3 h/dia) | **50,8 GB** | 3,1 Mbps (todos falando) | [CÁLCULO] |
| (b) Sala de voz com 10 | 9 × (2×154,8 + 8×1,3) = **2,88 Mbps** | 1,30 | 90 h | **116,6 GB** | 13,9 Mbps (10 falando) | [CÁLCULO] |
| (c) 1 streamer 1080p60 + 5 viewers (e voz entre os 6) | vídeo 5 × 8,64 = 43,2 + voz 1,57 = **44,8 Mbps** | 20,15 | 60 h (2 h/dia) | **1.209 GB ≈ 1,2 TB** | — | [CÁLCULO] |

No cenário (c), o upload do streamer para o SFU é 11,23 Mbps (ingress, grátis) [CÁLCULO]. **Um único stream 1080p60 para 5 pessoas gasta 15× mais banda que uma sala de voz com 10.**

### 3.3 Mix para 1k / 10k / 100k CCU

Composição por bloco de 1.000 CCU [HIPÓTESE]:
- **70% em salas só de voz com 5 pessoas** (140 salas).
- **30% em salas com screen share:** 6 pessoas = 1 streamer + 5 viewers, todos também em voz (50 salas, 50 streams).
- O egress escala linearmente com o número de salas, porque cada sala fica em 1 nó.

Mix de qualidade dos 50 streams [HIPÓTESE]:

| Mix | 720p30 | 1080p30 | 1080p60 | 1440p60 | Egress médio por viewer | Tag |
|---|---|---|---|---|---|---|
| **A — tudo liberado** | 20% | 30% | 35% | 15% | 7,02 Mbps | [CÁLCULO] |
| **B — freemium (recomendado)**: free = 720p30, ~15% dos streams premium | 85% | — | 10% | 5% | **3,35 Mbps** | [CÁLCULO] |
| **C — só 720p30** | 100% | — | — | — | 2,16 Mbps | [CÁLCULO] |

**Resultado no mix B (base do restante do documento)** [CÁLCULO; voz = 140 × 1,254 + 50 × 1,574 Mbps; vídeo = 50 × 5 × 3,348 Mbps; TB/mês = GB/h de pico × 328,5 h ÷ 1000]:

| CCU | Voz (pico) | Vídeo (pico) | **Egress de pico** | GB/h no pico | **TB/mês** | Pacotes/s de saída |
|---|---|---|---|---|---|---|
| (d) 1.000 | 254 Mbps | 837 Mbps | **1,09 Gbps** | 491 | **161,3** | 171 mil |
| (e) 10.000 | 2,54 Gbps | 8,37 Gbps | **10,9 Gbps** | 4.911 | **1.613** | 1,71 milhão |
| (f) 100.000 | 25,4 Gbps | 83,7 Gbps | **109,1 Gbps** | 49.107 | **16.132 (≈16 PB)** | 17,1 milhões |

Sensibilidade [CÁLCULO]:

| CCU | Mix A (liberado) | Mix B (freemium) | Mix C (só 720p) |
|---|---|---|---|
| 1.000 | 2,01 Gbps / 297 TB | 1,09 Gbps / 161 TB | 0,79 Gbps / 117 TB |
| 10.000 | 20,1 Gbps / 2.970 TB | 10,9 Gbps / 1.613 TB | 7,9 Gbps / 1.174 TB |
| 100.000 | 201 Gbps / 29.702 TB | 109 Gbps / 16.132 TB | 79 Gbps / 11.741 TB |

**Liberar 1080p60/1440p60 para todos multiplica o egress por 1,84** [CÁLCULO: 297 ÷ 161,3]. Um produto só de voz a 1k CCU gera 254 Mbps de pico e ~37,6 TB/mês [CÁLCULO: 254,3 × 0,45 × 328,5 ÷ 1000].

---

## 4. Dimensionamento de CPU (benchmark oficial do LiveKit)

Benchmark publicado em GCP `c2-standard-16` (16 vCPU, compute-optimized) [FATO]:

| Cenário | Pubs/Subs | Saída | Pacotes/s de saída | CPU | pps por vCPU a 100% [CÁLCULO: pps ÷ (16 × CPU)] |
|---|---|---|---|---|---|
| Só áudio | 10 / 3.000 | 23 MBps | 959.156 | 80% | 74,9 mil |
| Reunião grande (720p simulcast) | 150 / 150 | 93 MBps | 762.749 | 85% | 56,1 mil |
| Livestream (720p) | 1 / 3.000 | 531 MBps (~4,25 Gbps) | 560.962 | 92% | 38,1 mil |

Para o LiveKit, o custo de CPU vem da **taxa de pacotes**, não dos bytes. Regra de planejamento: **38,1 mil pps/vCPU (pior caso) × 60% de alvo ≈ 22,9 mil pps por thread** [CÁLCULO]. Isso assume que 1 thread moderna (Zen 4) vale ≥ 1 vCPU c2 (Cascade Lake) [HIPÓTESE conservadora]. Valide com `lk load-test` no hardware alvo antes de comprar.

No mix B, cada CCU gera ≈ 171 pps de saída [CÁLCULO: 171,4 mil ÷ 1.000]:

| Nó | Threads | Capacidade (pps @60%) | Porta | CCU/nó (limite) | Tag |
|---|---|---|---|---|---|
| Latitude `m4.metal.small` (EPYC 4244P 6c) | 12 | 274 mil | 2×10 Gbps | **~1.600** (CPU) | [CÁLCULO] |
| Latitude `f4.metal.medium` (EPYC 4564P 16c) | 32 | 732 mil | 2×10 Gbps | **~4.270** (CPU) | [CÁLCULO] |
| Hetzner AX42 (Ryzen 7 PRO 8700GE 8c) | 16 | 366 mil | 1 Gbps | **~640** (porta, a 70% de 1 Gbps [HIPÓTESE]) | [CÁLCULO] |
| Hetzner CCX33 (8 vCPU dedicadas) | 8 | 183 mil | não publicada | ~1.070 (CPU) | [CÁLCULO] |

**Limite do LiveKit OSS:** cada sala vive inteira em **um nó**. Para salas de 5–25 pessoas isso não é problema. Um "palco" com milhares de viewers bate no teto de um nó (~3.000 subs no benchmark) [FATO/CÁLCULO]. Multi-região no OSS não tem malha entre regiões. A API escolhe a região ao emitir o token, e uma sala não atravessa regiões.

TURN embutido (TURN/TLS na 443) roda no mesmo nó. O relay não duplica o egress da internet, porque cliente → TURN → SFU é local [HIPÓTESE sobre a topologia]. A fração de clientes em TURN é estimada em 5–10% [HIPÓTESE] e soma CPU de TLS.

---

## 5. Preços por provedor

### 5.1 Tabela de fatos

| Provedor / item | Preço | Tráfego incluído | Excedente | BR? | Tag |
|---|---|---|---|---|---|
| **Hetzner dedicado AX** (DE/FI) | AX41 €59; AX42 a partir de €79 (+€49 setup); AX102 a partir de €159 (+€129); AX162 a partir de €319 (+€304) | Porta 1 Gbps, **"unlimited traffic"** | Uplink 10G: 20 TB incluídos, depois **€1/TB** | Não | [FATO] |
| **Hetzner Cloud CCX** (dedicated vCPU) | CCX13 €43,49 / CCX23 €86,49 / CCX33 €138,99 / CCX43 €276,49 (NBG/HEL). Em ASH/HIL, CCX33 custa €141,49. | EU: 20–60 TB. **US: 1–8 TB** (CCX33: 30 TB EU / 3 TB US) | **€1,00/TB** em EU e US; €7,40/TB em Singapura | Não (locais: NBG1, HEL1, HIL1, ASH1, SIN1) | [FATO] |
| Hetzner Cloud compartilhado (CX/CPX) | a partir de €5,99/€6,49 | — | — | Não. A página marca o plano como "Currently not available". | [FATO] |
| **OVHcloud Rise** | RISE-1 a partir de US$ 64; RISE-S US$ 77; RISE-2 US$ 72–125 (setup = 1 mensalidade) | **1 Gbps garantido, ilimitado** em EU/US/CA; APAC com limite de 25 TB | — | **Não** (regiões: Europa, EUA, Canadá, APAC). Modelos marcados "Soon available". | [FATO] |
| **Vultr** | Página de preços bloqueada (403). Preço da VM em São Paulo **não verificado**. | 2 TB grátis em pool por conta + quota do plano | **US$ 0,01/GB** (doc atualizada em 26-out-2026). A doc não cita exceção regional. | **Sim** (São Paulo) | [FATO] para o excedente. Fonte secundária cita **US$ 0,08/GB para América do Sul** (não confirmado). |
| **Latitude.sh** bare metal | `m4.metal.small` US$ 296/mês; `f4.metal.small` US$ 398; `m4.metal.medium` US$ 456; `f4.metal.medium` US$ 555 | **20 TB de saída por servidor**, em pool por projeto + país; entrada ilimitada | **US$ 0,01/GB** em todas as regiões. **Pacotes de 10 TB a partir de US$ 0,00125/GB** (o changelog cita US$ 0,00064). | Sim (São Paulo). A página não mapeia plano por local. **Verificar disponibilidade.** | [FATO]; preço do pacote = **verificar** |
| **AWS** sa-east-1 | — | 100 GB/mês grátis | **US$ 0,15/GB** nos primeiros 10 TB (corte de 40% em 2020). Faixas acima de 10 TB não confirmadas. | Sim | [FATO] (blog AWS 2020 + fonte secundária) |
| AWS us-east-1 | — | — | 0,09 / 0,085 / 0,07 / 0,05 US$/GB (10 / 40 / 100 / >150 TB) | — | [FATO, fonte secundária] |
| **GCP** Premium, origem América do Sul | — | — | US$ 0,19 / 0,18 / 0,15 por GiB (0–1 / 1–10 / >10 TiB), vigente desde fev/2024 | Sim | [FATO] (anúncio oficial 2024; página atual não carregou) |
| **LiveKit Cloud** | Build US$ 0; Ship US$ 50; Scale US$ 500; Enterprise sob consulta | Minutos WebRTC: 5 mil / 150 mil / 1,5 M. Downstream: 50 GB / 250 GB / 3 TB. Concorrência: 100 / 1.000 / 5.000. | Minuto: — / US$ 0,0005 / US$ 0,0004. **GB: US$ 0,12 / 0,12 / 0,10** | Sim: região "sa" (Brasil), **1 local, sem redundância na região**. Region pinning só no plano Scale ou acima. | [FATO] |
| **Magalu Cloud** | Preço público **não encontrado** | — | — | Sim (cobra em reais; reportagens citam data center em Fortaleza, e o Nic.br cita "região SE") | [FATO] sobre existência/BRL; preço = **cotar** |
| **Contabo** | — | 32 TB de saída, entrada ilimitada | — | **Não** (9 regiões / 12 locais, nenhum no BR segundo as fontes) | [FATO, fontes secundárias] |

### 5.2 Latência a partir de São Paulo (RTT médio)

| Destino | RTT | Tag |
|---|---|---|
| Buenos Aires | 29 ms | [FATO] |
| Santiago | 47 ms | [FATO] |
| Miami | 108 ms | [FATO] |
| Nova York / Washington (≈ Ashburn, Vint Hill) | 110 / 111 ms | [FATO] |
| Dallas | 141 ms | [FATO] |
| Amsterdã | 185 ms | [FATO] |
| Frankfurt / Nuremberg / Helsinque | 200 / 202 / 200 ms | [FATO] |
| Dentro do Brasil (ex.: Fortaleza/Recife ↔ SP) | 40–60 ms | [HIPÓTESE] |

Orçamento boca-ouvido entre dois brasileiros [CÁLCULO; componentes = HIPÓTESE]:
- **SFU em SP:** rede 2 × 5–25 ms + jitter buffer 20–60 ms + captura/codec/render ~40 ms ≈ **70–150 ms**.
- **SFU em Ashburn:** rede 2 × ~55 ms + 60–100 ms ≈ **170–210 ms**.
- **SFU em Frankfurt:** rede 2 × ~100 ms + 60–100 ms ≈ **260–300 ms**.

A ITU-T G.114 recomenda ≤ 150 ms de atraso em um sentido (referência normativa, não acessada nesta sessão) [HIPÓTESE]. **Conclusão: a voz precisa de SFU em SP.** Para viewers de screen share, +110 ms é tolerável [HIPÓTESE].

### 5.3 Custo mensal de mídia por cenário (mix B)

Fórmulas [CÁLCULO]:
- Nós = ⌈carga ÷ capacidade do nó⌉ + HA.
- Banda = (TB/mês − incluído) × preço.
- Minutos LiveKit = CCU × 0,45 × 60 × 730.

**(d) 1.000 CCU: 161,3 TB/mês, 1,09 Gbps de pico, 171 mil pps**

| Opção | Conta | **US$/mês** | Latência BR | Tag |
|---|---|---|---|---|
| **Latitude SP (recomendado)**: 2× m4.metal.small (1 + 1 HA) | 592 + (161,3 − 40) TB → pacote: 13 × 10 TB × US$ 12,5 = 162,5. Lista: 121,3 × 10 = 1.213. | **755 (pacote) / 1.805 (lista)** | ótima | [CÁLCULO] |
| Vultr SP | VMs ≈ 300–500 [HIPÓTESE] + (161,3 − ~17 TB incl. [HIPÓTESE]) × 10 | ≈ 1.750–1.950. Se o preço regional for US$ 0,08/GB: ≈ 11.900. | ótima | [CÁLCULO] |
| Hetzner Cloud ASH: 3× CCX33 | €424,47 + (161,3 − 9) × €1 = €576,8 | **≈ 663** | +110 ms RTT | [CÁLCULO] |
| OVH Rise US/CA: 3× RISE-S (limite de porta) | 3 × 77 + setup único de 231 | **231** | +110 ms RTT (local US = HIPÓTESE) | [CÁLCULO] |
| Hetzner dedicado EU: 3× AX42 | €237 + setup único de €147 | ≈ 273 | **+200 ms RTT: inviável para BR** | [CÁLCULO] |
| LiveKit Cloud Scale | 500 + (19,71 M − 1,5 M) min × 0,0004 = 7.284 + (161,3 − 3) TB × US$ 100 = 15.830 | **23.614** | ótima | [CÁLCULO] |
| AWS sa-east-1 | 161.300 GB × 0,15 (teto; faixas >10 TB não verificadas) + EC2 | **≈ 24.200 + EC2** | ótima | [CÁLCULO] |
| AWS us-east-1 | 10 TB × 90 + 40 × 85 + 100 × 70 + 11,3 × 50 | ≈ 11.865 + EC2 | +110 ms | [CÁLCULO] |
| GCP Premium, América do Sul | 146,7 TiB nas faixas 0,19 / 0,18 / 0,15 | **≈ 22.850** + VMs | ótima | [CÁLCULO] |

**(e) 10.000 CCU: 1.613 TB/mês, 10,9 Gbps, 1,71 M pps**

| Opção | Conta | **US$/mês** | Tag |
|---|---|---|---|
| **Latitude SP**: 4× f4.metal.medium (3 + 1 HA) | 2.220 + (1.613,2 − 80) TB → pacote: 154 × 12,5 = 1.925. Lista: 15.332. | **4.145 (pacote) / 17.552 (lista)** | [CÁLCULO] |
| **Plano B híbrido**: voz em SP (5× m4.small) + streams em OVH US (14× RISE-S, 1 Gbps ilimitado) | voz: 1.480 + (376 − 100) TB → pacote 28 × 12,5 = 350 / lista 2.760. Streams: 14 × 77 = 1.078. | **2.900 (pacote) / 5.320 (lista)** | [CÁLCULO] |
| Hetzner Cloud ASH: 11× CCX33 | €1.556 + (1.613 − 33) × €1 ≈ €3.136 | ≈ 3.607 (+110 ms) | [CÁLCULO] |
| LiveKit Cloud (passa de 5 mil conexões → Enterprise; extrapolação de lista) | 500 + 195,6 M min × 0,0004 + 1.610 TB × 100 | **≈ 239.760** | [CÁLCULO] |
| AWS sa-east-1 (teto) | 1.613.200 GB × 0,15 | ≈ 242.000 | [CÁLCULO] |
| GCP América do Sul | 1.467 TiB nas faixas | ≈ 225.700 | [CÁLCULO] |

**(f) 100.000 CCU: ≈16 PB/mês, 109 Gbps, 17,1 M pps**

| Opção | Conta | **US$/mês** | Tag |
|---|---|---|---|
| Latitude SP: 27× f4.metal.medium (24 + 3 HA), ~4,5 Gbps/nó | 14.985 + (16.132 − 540) TB → pacote: 1.560 × 12,5 = 19.500. Lista: 155.916. | **34.485 (pacote) / 170.900 (lista)** | [CÁLCULO] |
| Colocation em SP + ASN próprio + IX.br + trânsito IP com commit | Requer cotação | **cotar** (meta: < US$ 30 mil) | [HIPÓTESE] |
| LiveKit Cloud / AWS / GCP | ≈ 16 PB × US$ 0,10–0,15/GB | **≈ US$ 1,6–2,4 milhões** | [CÁLCULO] |

Nesta escala, nenhum provedor por GB fecha a conta. O caminho é peering (IX.br) + trânsito negociado ou contrato enterprise de banda [HIPÓTESE].

---

## 6. API + Postgres no Railway

### 6.1 Verificação: "Railway não expõe UDP"

- A doc oficial de **TCP Proxy** expõe serviços não-HTTP como "raw TCP". O Railway gera domínio e porta aleatória. A doc **não menciona UDP** [FATO].
- Um thread na Central Station diz que UDP exigiria "an entirely separate proxy". O Railway só tem proxies TCP [FATO, fonte comunitária].
- **Conclusão: confirmado.** O SFU precisa de UDP (faixa de portas RTP ou porta UDP única) e o TURN precisa de 443/TLS + UDP 3478. Nenhum dos dois roda no Railway. Mesmo um TURN/TCP via TCP Proxy cairia em porta aleatória e pagaria **US$ 0,05/GB** de egress [FATO], 5× a lista da Latitude.
- As regiões do Railway não aparecem na página de preços. Não há América do Sul (US West/East, EU West, SE Asia) [HIPÓTESE — verificar]. RTT de ~110 ms para REST/WS de chat é aceitável [HIPÓTESE].

### 6.2 Preços do Railway [FATO]

- **Planos:** Hobby US$ 5 (inclui US$ 5 de uso); Pro US$ 20 por workspace (inclui US$ 20; até 1.000 vCPU / 1 TB RAM por serviço; 42 réplicas).
- **Uso:** CPU US$ 20/vCPU-mês; RAM US$ 10/GB-mês; volume US$ 0,15/GB-mês; egress US$ 0,05/GB.
- **Object storage:** US$ 0,015/GB-mês, **egress grátis**.
- O Railway cobra por segundo o uso medido.

### 6.3 Estimativa por fase

Os dimensionamentos (vCPU médio / GB RAM) são [HIPÓTESE]. Custo = vCPU × 20 + GB × 10 + vol × 0,15 + egress × 0,05 [CÁLCULO].

| Fase | Online WS (P6) | API | Gateway WS | Postgres (vCPU/GB/vol) | Redis | Egress | **US$/mês** |
|---|---|---|---|---|---|---|---|
| Dev | ~5 | 0,1 / 0,25 | (junto à API) | 0,1 / 0,25 / 1 GB | — | 2 GB | **≈ 9** (Hobby) |
| Beta amigos | ~50 | 0,2 / 0,5 | (junto à API) | 0,2 / 0,5 / 5 GB | 0,05 / 0,1 | 10 GB | **≈ 21** (Hobby) |
| 1k CCU | 2,5 mil | 2× (0,5 / 1) | 2× (0,5 / 1) | 1 / 4 / 50 GB | 0,25 / 0,5 | 300 GB | **≈ 173** (Pro) |
| 10k CCU | 25 mil | 4× (1 / 2) | 4× (1 / 2) | 4 / 16 / 300 GB | 1 / 2 | 3 TB | **≈ 795** (Pro) |
| 100k CCU | 250 mil | 20× (1 / 2) | 20× (1,5 / 3) | 16 / 64 / 2 TB (+ réplica) | 4 / 16 | 30 TB | **≈ 6.260** (Pro) |

Recomendações para o Railway:
- **100k:** a RAM a US$ 10/GB-mês domina. Um Postgres em container único sem HA gerenciada é risco de dado. Migre a API para bare metal (os mesmos fornecedores do SFU) e o PG para um serviço gerenciado com HA/PITR. Meta: ≈ US$ 1,5–2,5 mil [HIPÓTESE].
- **Atualizações do Electron:** use object storage com egress grátis (Railway buckets) ou GitHub Releases, se o repositório for público. Um repositório privado exige token no cliente, o que é inadequado. Estimativa: ~100 MB de instalador × 20k MAU × 1 atualização/mês ≈ 2 TB/mês com custo de egress ~US$ 0 [HIPÓTESE / CÁLCULO]. Use atualizações diferenciais (blockmap) do electron-updater.

---

## 7. Recomendação faseada

| Fase | Escala | Mídia (SFU + TURN) | API/PG | **Custo/mês** | Por que |
|---|---|---|---|---|---|
| **0. Dev** | devs | `livekit-server --dev` local. Para testes remotos: LiveKit Cloud **Build** (US$ 0; 5 mil min, 50 GB, 100 conexões) [FATO]. Um stream 1080p60 para 2 viewers gasta os 50 GB em ~6,4 h [CÁLCULO: 50 ÷ (8,64 × 2 × 0,45)]. | Railway Hobby | **≈ US$ 9** | Zero ops |
| **1. Beta amigos** | ≤ 50 testers, ≤ 20 CCU (~3,2 TB/mês [CÁLCULO: 20 × 161,3 GB]) | 1 VM **Vultr São Paulo** (2–4 vCPU) [preço = HIPÓTESE ~US$ 40–80]. Alternativa: Hetzner ASH CCX13 €43,99 + ~2,2 TB × €1 (+110 ms). | Railway Hobby | **≈ US$ 65–100** | No LiveKit Cloud Ship, o mesmo uso custaria ≈ US$ 529 [CÁLCULO: 50 + 244 mil min × 0,0005 + 2.976 GB × 0,12] |
| **2. 1k CCU** | ~20k MAU | **2× Latitude.sh `m4.metal.small` em SP** (1 + 1 HA, Redis do LiveKit no nó B), com pacote de banda | Railway Pro | **≈ US$ 930 (pacote) / 1.980 (lista)** [CÁLCULO: 755 + 173 / 1.805 + 173] | Latência BR + menor US$/TB com SP |
| **3. 10k CCU** | ~200k MAU | **4× Latitude `f4.metal.medium` em SP** + pacotes. Se o preço do pacote não se confirmar, use o **Plano B híbrido** (voz SP + streams em OVH US ilimitado; exige 2 rooms LiveKit por canal). Comece a cotar trânsito/IX.br. | Railway Pro (≈ US$ 795) | **≈ US$ 4,9 mil (pacote) / 18,3 mil (lista) / 3,7–6,1 mil (híbrido)** [CÁLCULO] | Preço por TB passa a ser a única variável que importa |
| **4. 100k CCU** | ~2M MAU | Colocation SP + ASN + IX.br + trânsito, ou contrato enterprise Latitude. ~24–27 nós de 16c. Segunda região (Nordeste ou Miami) para redundância. | Sair do Railway: bare metal + PG gerenciado | **≈ US$ 37–41 mil (pacote) / 172–177 mil (lista)** [CÁLCULO: 34.485 + 2–6,3 mil] | Banda negociada é obrigatória |

**Custo do setup recomendado por 1k CCU/mês:** ≈ **US$ 0,93 mil** com pacote de banda, ou ≈ **US$ 1,98 mil** a preço de lista, na fase de 1k. Em escala: ≈ US$ 0,49 mil (10k, pacote) e ≈ US$ 0,41 mil (100k, pacote) [CÁLCULO].

---

## 8. Free vs pago, custo por usuário e break-even

### 8.1 Custo incremental do perk premium

Premissa: o premium faz stream 20 h/mês para 5 viewers [HIPÓTESE].

| Perk | Δ egress por viewer vs 720p30 | Δ GB/mês por assinante | Latitude pacote (US$ 1,25/TB) | Latitude lista (US$ 10/TB) | Hetzner ASH (€1/TB) | LiveKit Cloud (US$ 0,10/GB) | AWS sa-east-1 (US$ 0,15/GB) |
|---|---|---|---|---|---|---|---|
| 1080p60 | +6,48 Mbps | 6,48 × 0,45 × 5 × 20 = **292 GB** | US$ 0,36 | US$ 2,92 | ~US$ 0,34 | **US$ 29** | **US$ 44** |
| 1440p60 | +10,80 Mbps | **486 GB** | US$ 0,61 | US$ 4,86 | ~US$ 0,56 | **US$ 49** | **US$ 73** |

Tag: [CÁLCULO]. Com self-host em SP, o perk custa centavos a poucos dólares. Com cloud por GB, **um único assinante premium custa mais que qualquer assinatura plausível no Brasil**.

### 8.2 O que o freemium faz com o custo total

- No mix A (tudo liberado), o egress é **+84%** acima do mix B. Na Latitude a preço de lista, isso dá ≈ +US$ 1,36 mil/mês a 1k CCU [CÁLCULO: (297 − 161,3) TB × 10].
- **O free tier continua sendo o grosso do custo.** No mix B, ≈105 dos 161 TB vêm de voz (37,6 TB) + streams 720p30 free (67,9 TB) [CÁLCULO: 50 × 0,85 × 5 × 2,16 Mbps × 0,45 × 328,5 ÷ 1000].
- Alavancas sem tirar features:
  - limite de viewers por stream free (ex.: 10);
  - `adaptiveStream` + pausa quando a janela está oculta;
  - timeout de stream sem viewers ou sem input;
  - 720p30 a 1,5 Mbps (`h720fps15`) quando o conteúdo é estático;
  - VP9/AV1 onde houver hardware.

### 8.3 Custo por usuário ativo e break-even

Premissas [HIPÓTESE]: conversão premium = 4% do MAU; receita líquida = 75% do preço bruto (gateway + impostos); P5 e P7 da seção 1.

Fórmula do preço bruto de break-even, **só infraestrutura** [CÁLCULO]:
`P = custo_US$ × 5,50 ÷ (0,75 × 0,04 × MAU)`

| Escala (MAU) | Setup | Custo/mês | **US$/MAU** | US$/CCU de pico | **Preço de break-even (R$/mês)** |
|---|---|---|---|---|---|
| 1k (20k) | Latitude, pacote | US$ 927 | 0,046 | 0,93 | **R$ 8,50** |
| 1k (20k) | Latitude, lista | US$ 1.978 | 0,099 | 1,98 | **R$ 18,13** |
| 1k (20k) | LiveKit Cloud | US$ 23.787 | 1,19 | 23,8 | **R$ 218 — inviável** |
| 10k (200k) | Latitude, pacote | US$ 4.940 | 0,025 | 0,49 | **R$ 4,53** |
| 10k (200k) | Latitude, lista | US$ 18.347 | 0,092 | 1,83 | **R$ 16,82** |
| 10k (200k) | Híbrido, lista | US$ 6.115 | 0,031 | 0,61 | **R$ 5,61** |
| 100k (2M) | Latitude, pacote | US$ 40.745 | 0,020 | 0,41 | **R$ 3,73** |
| 100k (2M) | Latitude, lista | US$ 177.161 | 0,089 | 1,77 | **R$ 16,24** |

Leitura:
- Com banda em SP a **≤ US$ 1,25/TB**, uma assinatura de **R$ 10–15** cobre a infra com folga a partir de 1k CCU.
- A preço de lista (US$ 10/TB), o break-even fica em ~R$ 16–18. A conta fecha, mas apertada, e ainda não inclui folha, suporte, fraude e chargeback.
- **Mesmo um produto só de voz no LiveKit Cloud custa ≈ US$ 11,2 mil/mês a 1k CCU** [CÁLCULO: 500 + 7.284 de minutos + (37,6 − 3) TB × 100]. A cobrança por minuto sozinha (US$ 17,5 por usuário médio concorrente por mês) inviabiliza um free tier generoso [CÁLCULO: 43.800 min × 0,0004].

---

## 9. Riscos críticos e itens a verificar

1. **[ALTO] Banda por GB (LiveKit Cloud, AWS, GCP) inviabiliza o modelo free** com screen share: ≥ US$ 22 mil/mês a 1k CCU e ≥ US$ 225 mil a 10k [CÁLCULO]. Use o LiveKit Cloud só em dev, ou como failover pontual com teto de gasto.
2. **[ALTO] O preço do pacote de banda da Latitude não está confirmado** (US$ 0,00125 vs 0,00064/GB; a página de rede por país não carregou). A diferença lista/pacote é 4,3× no custo total a 10k CCU. **Peça cotação escrita para SP antes da fase 2.** Confirme também a disponibilidade de `m4.metal.small`/`f4.metal.medium` em SP.
3. **[MÉDIO] Preço regional da Vultr em SP é ambíguo:** US$ 0,01/GB na doc oficial vs US$ 0,08/GB numa fonte secundária. A diferença é 8×. Confirme no console antes do beta.
4. **[MÉDIO] Não há Hetzner/OVH/Contabo no Brasil.** Com SFU fora de SP, a voz fica em ~170–300 ms boca-ouvido, acima da recomendação G.114. Isso é perda competitiva direta contra o Discord, que tem região no Brasil [HIPÓTESE].
5. **[MÉDIO] LiveKit OSS = 1 sala por nó, sem malha multi-região.** O roteamento por região fica na nossa API. O Plano B híbrido exige 2 rooms por canal (complexidade no cliente). Salas "palco" grandes batem no teto de um nó.
6. **[MÉDIO] LiveKit Cloud tem 1 local no Brasil, sem redundância na região. Region pinning exige o plano Scale** [FATO]. Não serve como "BR garantido" barato.
7. **[BAIXO] Upload do streamer:** 1080p60 com simulcast precisa de ~11,2 Mbps e 1440p60 de ~15,6 Mbps [CÁLCULO]. Ofereça perfis de 2 camadas e detecte a banda antes do go-live.
8. **[BAIXO] Abuso do free tier:** streams 24/7 para bots consomem banda linearmente. Limites de viewers, tempo e idle são obrigatórios desde o beta.
9. **[BAIXO] Hetzner:** os preços atuais de CCX/AX são os da página nesta data [FATO]. Os planos compartilhados aparecem como "Currently not available", o que é risco de disponibilidade. A Hetzner não publica a capacidade de porta dos Cloud servers.
10. **[BAIXO] Os indicadores por MAU dependem de P5 (CCU/MAU = 5%) e P8 (A = 2).** Instrumente desde o beta: CCU, falantes ativos, % de salas com stream, viewers/stream e camada recebida. Recalibre este modelo com dados reais.
11. **[BAIXO] OVH Rise está marcado "Soon available"** e a página não detalha cidades nos EUA. O Plano B depende de disponibilidade real.

---

## 10. Fontes (acessadas em 2026-11-01)

- LiveKit Cloud — preços: https://livekit.com/pricing
- LiveKit — benchmark SFU: https://docs.livekit.io/home/self-hosting/benchmark/
- livekit-client — presets de vídeo/tela/áudio: https://github.com/livekit/client-sdk-js/blob/main/src/room/track/options.ts
- LiveKit — region pinning / regiões: https://docs.livekit.io/deploy/admin/regions/region-pinning.md · https://docs.livekit.io/deploy/admin/regions/endpoints.md
- Hetzner — tráfego (dedicado/cloud): https://docs.hetzner.com/robot/general/traffic/
- Hetzner — Cloud billing FAQ (entrada grátis): https://docs.hetzner.com/cloud/billing/faq/
- Hetzner — Cloud (visão geral): https://www.hetzner.com/cloud
- Hetzner — CCX General Purpose: https://www.hetzner.com/cloud/general-purpose/
- Hetzner — dedicados AX: https://www.hetzner.com/dedicated-rootserver/matrix-ax/
- OVHcloud — Rise: https://eco.ovhcloud.com/en/rise/
- Vultr — excedente de banda: https://docs.vultr.com/support/platform/billing/what-is-the-bandwidth-overage-rate
- Vultr — anúncio de pool de 2 TB e ingresso grátis: https://blogs.vultr.com/vultr-announces-reduced-bandwidth-pricing-2-tb-of-free-monthly-egress-free-ingress-and-global-pooling
- Vultr — preço regional (fonte secundária, não confirmada): https://onedollarvps.pages.dev/pricing/vultr-pricing
- Latitude.sh — preços: https://www.latitude.sh/pricing · banda: https://www.latitude.sh/docs/usage/bandwidth · changelog: https://latitude.sh/changelog/bandwidth-overage-is-now-usd0-01-per-gb
- AWS — redução de DTO em São Paulo (2020): https://aws.amazon.com/blogs/aws/aws-data-transfer-out-dto-40-price-reduction-in-south-america-sao-paulo-region
- AWS — faixas us-east-1 (fonte secundária): https://costgoat.com/pricing/aws-data-transfer
- GCP — mudança de preço de egress Premium (2024): https://cloud.google.com/vpc/pricing-announce
- Railway — preços: https://railway.com/pricing · TCP Proxy: https://docs.railway.com/reference/tcp-proxy · UDP (comunidade): https://station.railway.com/questions/tcp-udp-ports-327c4e6e
- Latência a partir de SP: https://wondernetwork.com/pings/Sao%20Paulo
- Magalu Cloud (lançamento, preços em R$, DC em Fortaleza): https://www.opovo.com.br/noticias/economia/2023/12/13/com-data-center-em-fortaleza-magazine-luiza-lanca-servico-de-nuvem.html · https://www.infomoney.com.br/?p=2321932
- Contabo — locais/tráfego: https://contabo.com/en/offshore-vps/ · https://onedollarvps-com.pages.dev/pricing/contabo-pricing
