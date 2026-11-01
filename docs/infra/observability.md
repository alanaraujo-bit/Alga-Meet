# Observabilidade — métricas, logs, SLOs e alertas

> **Nada aqui foi implantado.** O servidor já expõe tudo (`apps/server`, testado nas duas suítes); Prometheus,
> Grafana e as regras de alerta são arquivos em `infra/monitoring/` prontos para a VM do SFU. Subir custa só a CPU/RAM
> que a VM já paga (§5), mas precisa da aprovação do dono, como o resto de `docs/infra/deploy.md`.

## 1. O que o servidor expõe

| Rota | Para quê | Acesso |
|---|---|---|
| `GET /health` (e `/api/v1/health`) | **Liveness**: o processo responde. `{ ok: true, version }`. É o healthcheck do Railway e do Dockerfile (não mudou). | público, sem rate limit |
| `GET /ready` (e `/api/v1/ready`) | **Readiness**: `select 1` no banco e `GET /` no LiveKit (`LIVEKIT_URL`), 2 s de prazo cada. 200 `{ ok: true, checks: { database: 'ok', livekit: 'ok' } }`, senão 503 com o que falhou. | público, sem rate limit |
| `GET /metrics` | Prometheus, formato texto 0.0.4, escrito à mão em `src/metrics.ts` (sem dependência nova). | `Authorization: Bearer <METRICS_TOKEN>`. **Em produção sem `METRICS_TOKEN` a rota não existe (404).** Em dev/test sem token fica aberta. |

Não use `/ready` como healthcheck do Railway: um LiveKit fora do ar travaria o deploy da API, e o chat continua
funcionando sem voz. `/ready` é para o monitoramento (alerta) e para quem opera.

`METRICS_TOKEN`: ≥ 32 caracteres aleatórios (`node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`),
o mesmo valor nas variáveis do Railway e em `infra/monitoring/metrics_token` na VM. A comparação é em tempo constante.

### 1.1 Métricas

Todas com prefixo `alga_` (as de processo seguem os nomes padrão). Rótulos só com valores de conjuntos fechados
(template da rota, enums), nunca dado de usuário; cada métrica tem um teto de 2000 séries como proteção.

| Métrica | Tipo | Rótulos | Fonte |
|---|---|---|---|
| `alga_http_requests_total` | counter | `method`, `route` (template, ex. `/api/v1/channels/:id/messages`; `unmatched` para 404 sem rota), `status_class` (`2xx`…`5xx`) | hook `onResponse` |
| `alga_http_request_duration_seconds` | histogram | idem | idem |
| `alga_rate_limited_total` | counter | `route` (`gateway` = socket fechado com 4008) | `@fastify/rate-limit` + gateway |
| `alga_gateway_connections` / `alga_gateway_users_online` | gauge | — | `Hub`, na hora da coleta |
| `alga_gateway_dispatches_total` / `alga_gateway_frames_sent_total` | counter | `type` (evento) | `Hub.dispatch`: eventos com destinatário online / frames escritos (= fan-out) |
| `alga_gateway_ready_seconds` | histogram | — | frame `identify` → READY enviado |
| `alga_gateway_disconnects_total` | counter | `code` (1000/1001/1005/1006/1011/40xx, senão `other`) | `close` do socket |
| `alga_voice_rooms` / `alga_voice_participants` | gauge | — | estado de voz (webhooks do LiveKit) |
| `alga_voice_tokens_issued_total` | counter | `kind` (`space` / `private`) | `POST /voice/join` |
| `alga_voice_joins_total` | counter | `result` (`joined` / `channel_full` / `access_lost` / `no_channel`) | `participant_joined` |
| `alga_livekit_webhook_duration_seconds` | histogram | `event` | webhook do LiveKit |
| `alga_livekit_webhook_failures_total` | counter | `reason` (`signature` / `handler`) | idem |
| `alga_db_query_duration_seconds` / `alga_db_query_errors_total` | histogram / counter | `driver` (`postgres` / `pglite`), `op` (`select`, `insert`, `update`, `delete`, `with`, `begin`, `commit`, `rollback`, `other`) | `query` do driver embrulhado em `src/db/index.ts` (pool `connect` no pg; instância + transação no PGlite) |
| `alga_email_sent_total` / `alga_email_failures_total` | counter | `kind` (`verify_email`, `password_reset`, …) | `Mailer.send` |
| `alga_billing_webhooks_total` | counter | `provider` (`sandbox` / `mercadopago` / `other`), `outcome` (`applied` / `duplicate` / `rejected` / `unknown_provider` / `error`) | `POST /billing/webhooks/:provider` |
| `alga_call_*` | ver §1.3 | | telemetria de chamada (opt-in) |
| `alga_build_info{version}` | gauge (=1) | `version` | config |
| `process_start_time_seconds`, `process_cpu_seconds_total`, `process_resident_memory_bytes`, `nodejs_heap_used_bytes`, `nodejs_heap_total_bytes`, `nodejs_external_memory_bytes` | gauge | — | `process.*` na coleta |
| `nodejs_eventloop_lag_seconds` | gauge | `stat` (`mean` / `p50` / `p99` / `max`) | `monitorEventLoopDelay` (20 ms), zerado a cada coleta: vale a janela desde a anterior |

Estado em memória (conexões, voz, contadores) é por processo, como o resto do servidor (uma instância; ver README).
Um restart zera os counters: use sempre `rate()`/`increase()`, que tratam o reset.

### 1.2 Logs estruturados

Pino (JSON, uma linha por evento). O Fastify não escreve mais as duas linhas padrão por requisição; o servidor
escreve **uma** linha `request completed` com campos fixos:

| Campo | O quê |
|---|---|
| `reqId` | id da requisição do Fastify (`req-1`, …), em toda linha logada durante a requisição |
| `uid` | só em requisições autenticadas (e no gateway após o `identify`): `HMAC-SHA256(FILES_SECRET, "log-uid:" + userId)`, 16 hex. Estável enquanto o `FILES_SECRET` for o mesmo, então a equipe acha as linhas de um usuário calculando o hash do id dele; o id em si não vai nas linhas de requisição |
| `route` | template da rota (nunca a URL crua: códigos de convite e assinaturas não aparecem) |
| `method`, `statusCode`, `durationMs` | — |

`/health`, `/ready`, `/metrics` e `POST /telemetry/call-quality` logam em `debug` (fora do log de produção, que é
`info`): sondas não poluem e nenhuma linha de log liga um `uid` ao horário de um relatório de qualidade. Erros 500
continuam como `unhandled error` com `safeErr` (sem parâmetros SQL). Nunca entram no log: corpos, `authorization`,
cookies, parâmetros SQL, `detail` do Postgres.

### 1.3 Telemetria de qualidade de chamada (opt-in)

- **Consentimento**: `Me.telemetryOptIn`, **desligado por padrão**, ligado só pelo usuário (`PATCH /users/@me
  { telemetryOptIn: true }`); `users.telemetry_opt_in_at` guarda quando (prova do consentimento, LGPD art. 8º §2) e é
  apagado ao desligar. Sem opt-in, `POST /telemetry/call-quality` responde 403 antes de ler o corpo.
- **O que vem** (`CallQualityReport`, `packages/shared/src/telemetry.ts`, um por sessão de voz, schema estrito: campo
  desconhecido = 400): duração, tempo de entrada, reconexões (e se uma desistiu), RTT médio/p95, jitter, perda e
  ocultação de áudio (%), codec de áudio e de vídeo (enum), encoder de hardware sim/não, faixa de fps e de resolução
  da transmissão (enum), SO + versão (número), versão do app (semver), classe do fabricante de CPU/GPU (enum).
- **O que não vem nem é guardado**: conteúdo de mensagem ou de stream, nome/id de sala, canal ou espaço, IP, texto
  livre (toda string é enum ou número de versão), horário (só o **dia** UTC), id do usuário. O id da linha é UUID v4
  aleatório (um v7 carregaria o horário).
- **Pseudônimo**: `user_hash = HMAC-SHA256(sal, userId)` com um sal aleatório que vive só na memória e é trocado a
  cada dia UTC (e a cada restart). Dá para contar relatórios por pessoa no mesmo dia; depois da troca nem nós
  conseguimos ligar o hash à conta ou a outro dia.
- **Retenção**: `call_quality_reports` 30 dias (`Telemetry.sweep`, de hora em hora). Exclusão de conta não precisa
  apagar nada: as linhas não são ligáveis à conta depois da troca do sal (no máximo 24 h).
- **Limite**: 20 relatórios/h por usuário.
- **Métricas**: `alga_call_quality_reports_total{os}`, histogramas `alga_call_join_seconds`, `alga_call_rtt_seconds`,
  `alga_call_rtt_p95_seconds`, `alga_call_jitter_seconds`, `alga_call_packet_loss_percent`,
  `alga_call_concealment_percent`, `alga_call_reconnects`, `alga_call_session_seconds`, e os counters
  `alga_call_reconnect_failures_total`, `alga_call_streams_total{fps,resolution}`,
  `alga_call_video_encoder_total{codec,hw}`.
- ⚠️ **Bloqueio jurídico antes do desktop enviar**: a Política de Privacidade publicada
  (`docs/legal/politica-de-privacidade.md`, §1 e §4) diz "não há telemetria nem analytics no app". Ela precisa ganhar
  esta finalidade (diagnóstico de qualidade, base legal consentimento, 30 dias, sem conteúdo) antes de o toggle
  aparecer para usuários. O servidor só aceita relatórios de quem ligou o opt-in.

## 2. SLOs propostos

Janela de 28 dias. Valores de partida para o beta; revisar com 1–2 meses de dados.

| SLO | Objetivo | Medida (PromQL) |
|---|---|---|
| **Disponibilidade da API** | 99,5 % das requisições sem 5xx (orçamento ≈ 3 h 22 min / 28 d) | `1 - alga:api_error_ratio:rate…` (5xx ÷ total, sem `/metrics`, `/health`, `/ready`). `up{job="alga-api"} == 0` conta como indisponível no relatório mensal |
| **READY do gateway** | p95 ≤ 1 s (identify → READY) | `histogram_quantile(0.95, sum by (le) (rate(alga_gateway_ready_seconds_bucket[28d])))` |
| **Sucesso de entrada em voz** | ≥ 95 % | `alga:voice_join_success:ratio30m` = `participant_joined` aceitos ÷ tokens emitidos. Aproximação conservadora: quem pega token e desiste conta como falha. Complemento com telemetria: p95 de `alga_call_join_seconds` ≤ 3 s |
| **Sucesso de reconexão** | ≥ 99 % | `alga:call_reconnect_success:ratio1h` = reconexões bem-sucedidas ÷ (bem-sucedidas + desistências), da telemetria opt-in (amostra enviesada para quem consentiu; só vale com volume) |

## 3. Painéis do Grafana a montar

Fonte: o Prometheus da §5. Um dashboard por linha, nesta ordem de prioridade:

1. **Visão geral / SLOs**: disponibilidade 28 d e orçamento restante; READY p95; sucesso de entrada em voz; sucesso
   de reconexão; `up` da API, LiveKit e VM; versão em produção (`alga_build_info`).
2. **API**: req/s por `status_class` (empilhado); taxa de 5xx; p50/p95/p99 por rota (top 10 por volume:
   `topk(10, sum by (route) (rate(alga_http_requests_total[5m])))`); recusas por rate limit por rota.
3. **Gateway**: conexões e usuários online; READY p50/p95 (heatmap de `alga_gateway_ready_seconds_bucket`); frames/s
   por tipo de evento (fan-out) e eventos/s; desconexões por código (4002 heartbeat, 4004 sessão, 4008 limite, 4010
   conta restrita, 1006 rede).
4. **Voz**: salas e participantes; tokens/s × entradas/s; resultados de `participant_joined`; latência e falhas
   do webhook do LiveKit; métricas do próprio LiveKit (`job="livekit"`).
5. **Qualidade de chamada** (telemetria): heatmaps de RTT p95, jitter, perda e ocultação; distribuição de
   reconexões; tempo de entrada p50/p95; participação de codecs e encoder de hardware
   (`alga_call_video_encoder_total`); fps/resolução das transmissões; relatórios por SO.
6. **Banco e processo**: p95 de consulta por `op`; erros/s; RSS, heap, memória externa; lag do event loop p99/max;
   CPU (`rate(process_cpu_seconds_total[5m])`).
7. **Negócio e e-mail**: webhooks de pagamento por `outcome`; e-mails enviados/falhos por `kind`.
8. **VM do SFU** (node_exporter): CPU, saída de rede em Mbit/s (é o que a banda cobra), disco, memória.

## 4. Alertas

`infra/monitoring/alerts.yaml` (regras do Prometheus, comentários com o porquê de cada limiar). `page` = agir já;
`ticket` = olhar no mesmo dia útil.

| Alerta | Severidade | Dispara quando |
|---|---|---|
| `AlgaApiDown` | page | sem coleta da API por 2 min |
| `AlgaApiErrorBudgetFastBurn` / `SlowBurn` | page / ticket | queima 14,4× (1 h e 5 min) / 6× (6 h e 30 min) do orçamento de 0,5 % |
| `AlgaApiLatencyHigh` | ticket | p95 dos GETs > 500 ms por 10 min (downloads e exportações fora) |
| `AlgaRateLimitSpike` | ticket | > 30 recusas/min numa rota por 10 min |
| `AlgaGatewayReadySlow` | ticket | READY p95 > 1 s por 15 min |
| `AlgaGatewayMassDisconnect` | page | conexões caem pela metade em 10 min (> 20 antes) e não voltam em 5 min |
| `AlgaDbSlow` / `AlgaDbErrors` | ticket / page | p95 > 100 ms por 10 min / > 1 erro/s por 5 min |
| `AlgaEventLoopLag` / `AlgaMemoryHigh` | ticket | lag p99 > 100 ms por 10 min / RSS > 1,5 GB por 15 min |
| `AlgaLivekitDown` | page | sem coleta do LiveKit por 2 min |
| `AlgaVoiceJoinSuccessLow` | page | < 90 % dos tokens viram entrada em 30 min (com > 20 tokens) |
| `AlgaLivekitWebhookFailing` | page | > 5 webhooks do LiveKit recusados/com erro em 15 min |
| `AlgaReconnectSuccessLow` / `AlgaCallRttHigh` / `AlgaCallPacketLossHigh` | ticket | telemetria: reconexão < 95 %, RTT p95 > 200 ms ou perda > 5 % para um quarto das sessões, com volume mínimo |
| `AlgaBillingWebhooksFailing` | page | > 3 webhooks de pagamento recusados/com erro em 30 min |
| `AlgaEmailFailing` | ticket | > 5 e-mails falhos em 30 min |
| `SfuCpuHigh` / `SfuEgressHigh` / `SfuDiskAlmostFull` | page / ticket / ticket | CPU > 85 % por 10 min / saída > 800 Mbit/s por 15 min / disco < 10 % |

As expressões não passaram pelo `promtool` (não instalado nesta máquina): rode
`docker run --rm -v "$PWD:/w" --entrypoint promtool prom/prometheus:v3.5.0 check rules /w/alerts.yaml` antes de subir.
Para receber os alertas, o mais barato é o **Grafana Alerting** lendo o mesmo Prometheus (e-mail pelo Resend via SMTP
ou Telegram), sem Alertmanager; se preferir o Alertmanager, acrescente o serviço e um bloco `alerting:` no
`prometheus.yml`.

## 5. Rodar Prometheus + Grafana barato, ao lado do SFU

A VM do SFU em São Paulo (deploy.md §4) já existe e tem folga de CPU fora dos horários de pico; Prometheus + Grafana
+ node_exporter custam ~0,1 vCPU e < 600 MB de RAM (limites de memória no compose). Nada é exposto: tudo escuta em
`127.0.0.1` e o Grafana é acessado por túnel SSH.

```sh
# Na VM, em /opt/monitoring (copiar infra/monitoring/*):
#   prometheus.yml  alerts.yaml  docker-compose.yaml  metrics_token (chmod 600, o METRICS_TOKEN da API)
sed -i 's/api.<DOMAIN>/api.algameet.com.br/' prometheus.yml
mkdir -p prometheus_data grafana_data && chown 65534:65534 prometheus_data && chown 472:472 grafana_data
docker compose up -d
# No seu computador:
ssh -L 3000:127.0.0.1:3000 root@<ip-da-vm>   # http://localhost:3000 (admin/admin na 1ª vez: troque)
```

`infra/monitoring/docker-compose.yaml` (resumo):

```yaml
services:
  prometheus:   # prom/prometheus:v3.5.0, network_mode: host, --web.listen-address=127.0.0.1:9090,
                # retenção 30 d / 5 GB, mem_limit 384m
  grafana:      # grafana/grafana-oss:12.1.0, GF_SERVER_HTTP_ADDR=127.0.0.1, sem telemetria do Grafana, mem_limit 192m
  node-exporter: # prom/node-exporter:v1.9.1, 127.0.0.1:9100, mem_limit 64m
```

- **Alvos** (`prometheus.yml`): a API no Railway por HTTPS com o bearer token; o LiveKit em `127.0.0.1:6789`
  (acrescentar `prometheus_port: 6789` ao `livekit.prod.yaml` e **manter 6789 fechada no firewall da VM**: o LiveKit
  escuta em todas as interfaces); o node_exporter.
- A raspagem da API sai de São Paulo para US East a cada 30 s: ~10–30 KB por coleta, < 3 GB/mês de egress do Railway
  (≈ US$ 0,15).
- **Alternativa sem VM**: Grafana Cloud Free (10 k séries, 14 dias) com `remote_write` de um Prometheus em modo agente;
  as métricas do `alga_*` cabem folgadas (algumas centenas de séries).
- Backup: não precisa; o histórico de métricas é descartável. Os dashboards ficam em `grafana_data` (exporte o JSON
  dos que valerem a pena para o repositório).

## 6. O que fica para depois

- Tracing distribuído (OpenTelemetry) e correlação log ↔ métrica por `reqId` num agregador de logs (Railway guarda
  os logs; um Loki ao lado do Prometheus é o próximo passo barato).
- Sondagem externa (blackbox exporter ou um uptime checker grátis) de `/ready` a partir de fora da VM.
- Métricas do cliente além da qualidade de chamada (crashes, tempo de abertura) — dependem da mesma revisão da
  Política de Privacidade.
- Com mais de uma instância da API: os gauges e counters são por processo (cada réplica é um alvo; somar no PromQL).
