# Monetização — Alga Meet (proposta para decisão)

- **Data:** 2026-11-01. **Status:** proposta; preços e conversão validados no beta.
- **Base:** `docs/infra/cost-model.md` (custos), `docs/research/discord-benchmark.md` (concorrência), `docs/ARCHITECTURE.md` D11/D12.
- **Tags:** [FATO] fonte primária · [RELATO] fonte secundária · [CÁLCULO] derivado · [HIPÓTESE] premissa nossa, ajuste e recalcule · [NÃO VERIFICADO].
- **Câmbio:** US$ 1 = R$ 5,50 (P7 do cost-model).

## 0. Decisões pedidas ao dono

| # | Decisão | Recomendação |
|---|---|---|
| 1 | Planos | **Grátis** + **Alga Plus** (individual). Sem plano de comunidade no lançamento (§2.3). **Substituído:** a Casa (compra do grupo, `growth-plan.md` §2.3) foi adotada. |
| 2 | Preço do Plus | **R$ 14,90/mês** ou **R$ 149/ano** (2 meses de desconto). Global depois: US$ 4,99/mês ou US$ 49,90/ano. |
| 3 | Cosméticos | Loja enxuta, **R$ 5,90–12,90 por item**, posse permanente. O Plus inclui uma coleção enquanto dura. |
| 4 | Provedor no Brasil | **Mercado Pago**: cartão recorrente para o Plus e Pix + cartão para cosméticos. Stripe ou Paddle só na fase global (§5). |
| 5 | Pré-requisito de custo | Cotação escrita do **pacote de banda da Latitude em SP**, ou o plano híbrido. A preço de lista, o modelo não fecha (§4). |
| 6 | Jurídico/contábil | Contratar contador (Simples Anexo III/V, NFS-e, imposto sobre serviço importado) e advogado (termos, reembolso, menores) antes de cobrar (§6). |

---

## 1. Princípios (o que nunca muda)

1. **Voz igual para todos (D12).** Opus 64 kbps + DTX + RED/FEC por padrão; admins sobem até 128 kbps sem pagar. Voz nunca vira benefício pago.
2. **Social completo e grátis:** DMs, grupos, chamadas, espaços, cargos, moderação, histórico, convites, presença.
3. **Transmissão grátis boa (D11):** 720p30, 720p60 e **1080p30**. O Discord grátis para em 720p30 [FATO, benchmark §2].
4. **Sem anúncios, Quests, moeda virtual nem venda de dados.** O benchmark mostra a rejeição a Orbs/Quests [RELATO, benchmark §5]. Isso vira compromisso público.
5. **Só se paga pelo que custa caro ou pelo que é vaidade:** banda de stream premium, storage de anexos grandes e cosméticos. Nada que tire função do grátis.
6. **Pagamento validado só no servidor.** O cliente nunca marca nada como pago (§7).

## 2. Planos

### 2.1 Grátis (para sempre)

| Item | Limite |
|---|---|
| Voz | Igual ao Plus (D12) |
| Transmissão de tela | 720p30, 720p60, 1080p30 |
| Anexos | 25 MB por arquivo (`MAX_ATTACHMENT_BYTES`) |
| Perfil | Avatar (inclusive animado), cor de destaque, bio |
| Espaços, cargos, DMs, convites | Sem paywall |

### 2.2 Alga Plus — R$ 14,90/mês · R$ 149/ano

| Benefício | Por que existe | Custo real por assinante |
|---|---|---|
| Transmissão **1080p60, 1440p60 e 4K30** | É o que custa banda (D11) | R$ 0,48/mês no pacote, R$ 3,87 a preço de lista (§4.1) |
| Anexos de até **100 MB** | Pedido comum de quem compartilha clipes | ≈ R$ 1,80/mês hoje, porque o download passa pela API (US$ 0,05/GB no Railway). Cai para ≈ R$ 0,20 com redirect para URL pré-assinada do bucket. **Fazer antes do lançamento.** [HIPÓTESE: 2 GB extras enviados e 3 downloads por mês] |
| **Coleção Plus** (tema "Maré" e placa "Correnteza") enquanto assinar | Visibilidade discreta de quem apoia | ≈ 0 |

**Por que R$ 14,90:**
- Fica abaixo do Nitro (≈ R$ 24,99 [RELATO]) e entrega o que o Nitro Basic (R$ 8,90–12,49 [RELATO]) não tem: stream acima de 1080p30.
- Cobre a infra inteira (inclusive o grátis) a partir de **~2,3% de conversão a 1k CCU** e **~1,4% a 10k CCU**, com banda em pacote (§4.2).
- R$ 9,90 exigiria 3,4% de conversão a 1k CCU. R$ 19,90 reduz a conversão num mercado sensível a preço [HIPÓTESE].

**Anual R$ 149:** antecipa caixa e reduz churn. A taxa de cartão é percentual, então não piora.

**US$ 4,99:** preço regional típico; R$ 14,90 equivale a ~US$ 2,71. Só vale quando houver provedor em USD (§5).

### 2.3 Plano de comunidade ("impulso de espaço"): não lançar agora

> **Substituído (2026-11-01):** o lead adotou a **Casa** (`docs/business/growth-plan.md` §2.3): vaquinha do grupo, só
> perks de custo ≈ 0, sem renovação nem níveis. O Cinema (stream premium para o espaço) segue desligado até o pacote
> de banda. Implementada no servidor (`apps/server/src/billing/casa.ts`). O texto abaixo fica como histórico.

Motivos:
1. Os benefícios de comunidade do Discord são bitrate de voz e stream para o servidor inteiro. A voz já é grátis aqui (D12). Liberar stream premium para todos de um espaço faz o custo crescer com os **não pagantes** do espaço, não com quem paga. Isso dá um custo imprevisível.
2. "Pague para destravar sua comunidade" contradiz o princípio 4.
3. Engenharia: direito por espaço, vários pagantes por espaço, transferência e expiração. É trabalho sem demanda comprovada.

**Reavaliar no beta.** Se ≥ 20% dos assinantes Plus pedirem uma forma de apoiar o próprio espaço [HIPÓTESE de gatilho], lançar o "Apoio ao espaço" só com perks de custo quase zero: banner, ícone animado, link de convite personalizado e mais slots de emoji.

## 3. Cosméticos

Princípios:
- **Premium e contidos.** Animação só ao abrir o perfil ou ao passar o mouse, respeitando `prefers-reduced-motion`. Nada que pisque no chat.
- **Preço em reais, posse permanente.** Sem moeda virtual, caixa de sorte, item aleatório nem contagem regressiva ("sai da loja em 24 h").
- **Nunca dão função.** Não aumentam limite, não dão prioridade, não mexem na voz.
- **Venda avulsa e/ou inclusão no Plus.** Itens avulsos ficam para sempre. A Coleção Plus vale enquanto assinar. Não há desconto de membro (evita a dinâmica do Nitro).
- **Reembolso em 7 dias** (CDC art. 49, §6).

Catálogo inicial (`apps/server/src/billing/catalog.ts`, versão 1; **aposentado no catálogo v2**, que traz a Coleção 01
"Hora Azul" de `growth-plan.md` §3; quem tiver um item v1 continua com ele):

| SKU | Tipo | Preço |
|---|---|---|
| `deco_folha_de_alga`, `deco_coral` | Decoração de avatar | R$ 9,90 · US$ 2,99 |
| `theme_noite_paulistana` | Tema de perfil | R$ 7,90 · US$ 2,49 |
| `effect_bioluminescencia` | Efeito de perfil | R$ 12,90 · US$ 3,49 |
| `nameplate_cardume` | Placa de nome | R$ 5,90 · US$ 1,99 |
| `theme_plus_mare`, `nameplate_plus_correnteza` | Coleção Plus | Incluídos no Plus (não vendidos) |

Receita esperada: pequena e complementar. [HIPÓTESE] 1% do MAU compra 1 item por trimestre, a R$ 9 em média, o que dá ≈ R$ 0,03 por MAU por mês. A 1k CCU são ≈ R$ 600/mês.

Pix a 0,99% é o meio certo para o cosmético. O boleto (R$ 3,49 fixo) come 59% de um item de R$ 5,90 e fica fora.

## 4. Economia unitária

### 4.1 Custo do perk de stream (o único perk caro)

D11 mudou o grátis de 720p30 (base do cost-model) para 1080p30/720p60. A referência do Δ agora é 1080p30: 5,40 Mbps de egress por viewer [CÁLCULO, cost-model §2.3].

| Preset | Egress por viewer | Δ vs 1080p30 | Perfil pesado (20 h × 5 viewers/mês) | Pacote US$ 1,25/TB | Lista US$ 10/TB |
|---|---|---|---|---|---|
| 1080p60 | 8,64 Mbps | +3,24 | 146 GB | R$ 1,00 | R$ 8,02 |
| 1440p60 | 12,96 Mbps | +7,56 | 340 GB | R$ 2,34 | R$ 18,71 |
| 4K30 | 17,28 Mbps [HIPÓTESE: topo 16 Mbps] | +11,88 | 535 GB | R$ 3,68 | **R$ 29,40** |

Mix de streams [HIPÓTESE, ajustado de "mix B"]: 85% grátis (45% efetivamente 720p30 por conteúdo estático ou miniatura, 15% 720p60 a 3,24 Mbps [HIPÓTESE], 40% 1080p30) e 15% premium (8% 1080p60, 5% 1440p60, 2% 4K30).
- Egress médio por viewer: **4,76 Mbps** [CÁLCULO].
- A 1k CCU são **1,44 Gbps de pico e ≈ 213 TB/mês**, +32% sobre os 161 TB do mix B [CÁLCULO].
- O Δ premium dá 42,2 TB/mês a 1k CCU. Com 600 pagantes, são **70 GB por pagante por mês**: **R$ 0,48** no pacote e **R$ 3,87** a preço de lista [CÁLCULO].

Leitura:
- O perk custa de 3% a 26% do preço.
- O streamer 4K pesado a preço de lista fica no vermelho (R$ 29,40). Alavancas: `adaptiveStream` (viewer só recebe 4K em tela cheia), teto de 16 Mbps e AV1/VP9 onde houver hardware.

### 4.2 Assinante × infraestrutura total (cenários do cost-model)

Premissas [HIPÓTESE]:
- Conversão de **3%** do MAU; 60% mensal e 40% anual. A receita bruta média é R$ 13,91 por pagante.
- Deduções: cartão Mercado Pago 4,98% (repasse na hora), Simples Anexo III 6% e reembolso/chargeback 2%. A **receita líquida é R$ 12,11 por pagante**. No Anexo V (15,5%) cai para R$ 10,78.

Infra com o mix D11 [CÁLCULO; mesma estrutura do cost-model §5.3 e §6.3, mais Railway]:
- **1k CCU**: 2× m4.metal.small + 173,5 TB acima do incluído. Pacote US$ 990/mês; lista US$ 2.500/mês.
- **10k CCU**: 5× f4.metal.medium, porque 14,4 Gbps passa do limite de 4 nós + 2.035 TB. Pacote US$ 6.120/mês; lista US$ 23.920/mês.
- **Híbrido a 10k CCU**: voz em SP + streams em ~20 OVH RISE-S. US$ 6.575/mês, com voz a preço de lista.

| Cenário | MAU | Pagantes (3%) | Infra/mês | Infra por pagante | Receita líquida por pagante | Margem de contribuição/mês | Conversão de break-even |
|---|---|---|---|---|---|---|---|
| 1k CCU, pacote | 20k | 600 | R$ 5.445 | R$ 9,08 | R$ 12,11 | **+R$ 1.821** | **2,25%** |
| 1k CCU, lista | 20k | 600 | R$ 13.750 | R$ 22,92 | R$ 12,11 | −R$ 6.484 | 5,68% |
| 10k CCU, pacote | 200k | 6.000 | R$ 33.660 | R$ 5,61 | R$ 12,11 | **+R$ 39.000** | **1,39%** |
| 10k CCU, lista | 200k | 6.000 | R$ 131.560 | R$ 21,93 | R$ 12,11 | −R$ 58.900 | 5,43% |
| 10k CCU, híbrido | 200k | 6.000 | R$ 36.163 | R$ 6,03 | R$ 12,11 | +R$ 36.497 | 1,49% |

**Manchete:** com banda em pacote (ou o híbrido), o Plus a R$ 14,90 paga toda a infra, incluindo o grátis, a partir de ~2,3% de conversão a 1k CCU e ~1,4% a 10k CCU. A preço de lista seriam necessários ~5,5%, um número que não se deve contar como certo. **A cotação da Latitude é condição para lançar o grátis de 1080p30.**

Fora da conta: folha, suporte, NFS-e/contador e **tributos sobre serviço importado** (pagar Latitude/Railway em US$ pode somar IRRF, CIDE, PIS/COFINS-importação e IOF) [NÃO VERIFICADO; perguntar ao contador]. LiveKit Cloud/AWS seguem inviáveis: o Δ premium sozinho custaria R$ 38,7 por pagante.

### 4.3 O que medir no beta

Toda conversão acima é [HIPÓTESE] até aqui:
1. **Funil:** abriu o catálogo → `POST /billing/checkout` → pago (webhook), separado por meio de pagamento. Mede abandono no checkout.
2. **Conversão** do MAU para Plus (alvo ≥ 2,5%), mix mensal/anual e churn mensal (alvo ≤ 6% [HIPÓTESE]).
3. **Uso real do perk:** % de assinantes que transmitem acima de 1080p30; horas × viewers por preset (`track_published` do LiveKit já passa pelo servidor) e camada recebida pelos viewers (`adaptiveStream`).
4. **Egress por pagante e por usuário grátis** (GB/mês) contra os 70 GB do §4.1. Recalibrar §4.
5. **Reembolsos:** taxa de reembolso, uso do direito de arrependimento, chargebacks e disputas MED do Pix.
6. **Cosméticos:** taxa de compra por MAU e ticket médio.
7. **Percepção:** pesquisa curta com usuários grátis ("algo parece pago que deveria ser grátis?"). Meta: o grátis não parecer castrado.

Instrumentação ainda não existe (sem métricas de produto no servidor). É o próximo passo antes do beta pago.

## 5. Pagamentos: Mercado Pago × Stripe

Fontes acessadas em 2026-11-01:
- mercadopago.com.br/ferramentas-para-vender/cobrar
- mercadopago.com.br/developers (assinaturas, webhooks)
- stripe.com/br/pricing
- docs.stripe.com/payments/pix
- docs.stripe.com/payments/boleto
- docs.stripe.com/payouts

| | Mercado Pago | Stripe Brasil |
|---|---|---|
| Cartão | 4,98% (na hora), 4,49% (14 dias), 3,98% (30 dias) [FATO] | 3,99% + R$ 0,39; +2% cartão internacional [FATO] |
| Pix | 0,99% [FATO] | 1,19%, só por convite [FATO] |
| Boleto | R$ 3,49 [FATO] | R$ 3,45; em assinatura cada boleto é pago à mão [FATO] |
| Assinatura | "preapproval": cobrança automática no cartão, até 4 retentativas em 10 dias [FATO]. O overview cita Pix, mas **Pix Automático não foi confirmado** [NÃO VERIFICADO] | Billing +0,7% [FATO]. **Pix Automático indisponível para empresas no Brasil** [FATO] |
| Antifraude | 3DS em transação de risco (Checkout Pro), API de contestação [FATO]. A proteção ao vendedor provavelmente não cobre bens digitais [RELATO] | Radar desde R$ 0,25/transação; disputa R$ 55 + R$ 55 para contestar [FATO] |
| Repasse | Prazo escolhido pelo vendedor; saque por Pix [RELATO] | Diário automático; cartão D+30, Pix/boleto D+2 [FATO] |
| R$ 15 no cartão | R$ 0,75 (na hora) / R$ 0,60 (30 dias) | R$ 1,10 (com Billing) |
| R$ 5,90 em cosmético | Pix R$ 0,06 · cartão R$ 0,29 | cartão R$ 0,63 (10,6%) |

**Recomendação: Mercado Pago na fase Brasil.**
- É mais barato no ticket pequeno e tem Pix a 0,99% no cosmético.
- A carteira e o saldo MP são conhecidos do público.
- Nenhum dos dois tem Pix Automático confirmado para empresa brasileira. A assinatura começa no cartão.
- **Próximo passo barato:** "Plus anual no Pix" como pagamento único de R$ 149 que concede 12 meses sem renovação. O motor já suporta assinatura com `cancelAtPeriodEnd`; falta só o produto e o caminho na preferência.

**Fase global:** Stripe (precisa de entidade, USD) ou um *merchant of record* como a Paddle, que cuida de IVA/GST lá fora [NÃO VERIFICADO: taxas da Paddle não pesquisadas].

**Sem taxa de loja:** a distribuição é direta (instalador NSIS + updater, `docs/decisions/0003`), então não há corte de 30% de loja de apps. Se um dia o app entrar na Microsoft Store, rever.

## 6. Checklist jurídico/tributário (Brasil)

> **Isto não é aconselhamento jurídico nem contábil.** É a lista do que levar a um advogado e a um contador. Itens com ⚖️ precisam de advogado; com 🧾, de contador.

- [ ] ⚖️ **CDC art. 49 (arrependimento em 7 dias)** em compra fora do estabelecimento. Doutrina recente aplica a bens digitais [RELATO]; não achamos decisão do STJ específica [NÃO VERIFICADO].
  - Proposta: reembolso integral em 7 dias da 1ª cobrança do Plus e de cada cosmético, sem perguntas.
  - **Falta no produto:** botão de reembolso self-service. Hoje é manual: estorno no painel MP → webhook → o servidor revoga sozinho.
- [ ] ⚖️ **Decreto 7.962/2013** [FATO]:
  - Razão social, CNPJ e endereços físico e eletrônico visíveis (art. 2).
  - Resumo do contrato antes de pagar, com confirmação imediata.
  - Atendimento eletrônico que trate **cancelamento** (art. 4, V).
  - Meio claro de arrependimento, com aviso à operadora do cartão (art. 5).
- [ ] ⚖️ **Cancelamento tão fácil quanto assinar.** Já existe no app (`POST /billing/subscription/cancel`, vale até o fim do período). Há leis estaduais (ex.: RJ, dez/2025 [RELATO]) e PLs federais em tramitação [RELATO].
- [ ] ⚖️ **Renovação automática:** informar preço, periodicidade e renovação antes de pagar. Mandar e-mail antes da renovação anual (recomendado; não implementado).
- [ ] ⚖️ **Menores de idade:** compra por menor de 16 anos (absolutamente incapaz) ou de 16–18. Definir "18+ ou responsável" nos termos.
- [ ] ⚖️ **Termos de uso, política de reembolso e aviso de privacidade** atualizados com Mercado Pago como provedor.
- [ ] ⚖️ **LGPD:**
  - Base legal: execução de contrato (cobrança) e obrigação legal (registros fiscais).
  - Mercado Pago como operador/controlador no aviso de privacidade.
  - **Não guardamos dado de cartão.** Guardamos só ids do provedor, valor, status e o SHA-256 do payload.
  - Exclusão de conta deve **anonimizar**, não apagar, os registros de pagamento: a FK é `restrict` de propósito.
- [ ] 🧾 **NFS-e por cobrança.** Padrão Nacional obrigatório para municípios desde jan/2026 e, pela CGSN 191/2026, emissor nacional para ME/EPP do Simples a partir de 01/11/2026 [RELATO]. Automatizar a emissão via API (fornecedor a escolher). Conferir a regra do município.
- [ ] 🧾 **ISS e enquadramento:**
  - Assinatura de software cai provavelmente no item 1.05 da LC 116 (licenciamento de programa) [FATO sobre o texto da lei]; alíquota municipal de 2–5%.
  - Cosmético: confirmar se é o mesmo item ou o 1.09 (conteúdo).
  - Confirmar que não há ICMS sobre "bem digital".
- [ ] 🧾 **Simples Nacional:** Anexo III (6% inicial) se o Fator R ≥ 28%; senão Anexo V (15,5%) [RELATO]. Muda a margem em R$ 1,33 por pagante (§4.2). Planejar o pró-labore.
- [ ] 🧾 **Reforma tributária:** CBS 0,9% + IBS 0,1% em 2026 como teste (fora do Simples) [RELATO]. Rever preço para 2027.
- [ ] 🧾 **Serviço importado** (Latitude, Railway, Resend em US$): IRRF, CIDE, PIS/COFINS-importação e IOF podem incidir [NÃO VERIFICADO]. Impacta direto o §4.
- [ ] 🧾 **Chargeback e MED do Pix:** provisão contábil. A disputa MED não é contestável [FATO, doc Stripe sobre Pix; vale para o arranjo Pix].

## 7. Motor de direitos (implementado em `apps/server/src/billing/`)

- **Catálogo versionado** (`catalog.ts`, `CATALOG_VERSION = 2`), espelhado na tabela `products` a cada subida.
- **Tabelas:**
  - `subscriptions`: pending → active/past_due → canceled/expired, com `cancel_at_period_end`.
  - `orders`: pending → paid → refunded; pending → canceled/expired.
  - `entitlements`: derivada; só `recompute` escreve.
  - `billing_events`: append-only, com chave única (provedor, id do evento) e hash do payload.
  - `users.plan`: cache lido junto com a sessão.
- **Nada é concedido por chamada do cliente.** O checkout cria um registro pendente; só o webhook verificado aplica estado. No Mercado Pago o estado é **sempre buscado de novo na API**, e o corpo da notificação não é confiável.
  - O evento é idempotente.
  - Eventos fora de ordem mais velhos que o último aplicado são ignorados.
  - Valor pago abaixo do preço não concede.
  - Reembolso/chargeback revoga e é terminal.
- **Expiração:** um job (1 min) expira assinaturas vencidas e checkouts abandonados (24 h).
  - Assinatura com renovação automática ou `past_due` tem **3 dias de carência** após o fim do período.
  - Cancelada: perde os perks exatamente no fim do período.
  - O job emite `ENTITLEMENTS_UPDATE` e `ME_UPDATE`.
- **Imposição:**
  - O token LiveKit leva o atributo `alga.stream_presets`, que o cliente não pode alterar.
  - `VoiceJoinResponse.streamPresets` informa os presets ao cliente.
  - O servidor **muta no SFU** a transmissão publicada acima do plano (lado curto/bitrate das camadas no `track_published`).
  - O teto de anexo por plano vale no upload (413).
- **Sandbox:** só existe em dev/test. A config recusa `BILLING_PROVIDER=sandbox` em produção, sem válvula de escape. O construtor também recusa. O recompute ignora linhas sandbox em produção. As respostas trazem `sandbox: true`.

## 8. Mercado Pago: o que NÃO foi verificado

O adaptador (`mercadopago.ts`) foi escrito pela documentação pública e testado contra uma **API simulada**. Nunca rodou contra a API real, porque não há credenciais. Antes de cobrar, rodar em sandbox do MP com usuários de teste:

1. Os caminhos `POST /checkout/preferences`, `GET /v1/payments/{id}`, `POST /v1/payments/{id}/refunds` e `GET /authorized_payments/{id}` são padrão, mas não foram confirmados nesta sessão. `POST/PUT/GET /preapproval` e o formato do `x-signature` foram confirmados na doc.
2. Grafia do status de cancelamento: enviamos `cancelled` e aceitamos `cancelled`/`canceled` na leitura. A doc usa as duas.
3. Se `payer_email` precisa ser o e-mail da conta MP de quem paga, no fluxo `status: pending`.
4. Se as cobranças recorrentes carregam o `external_reference` da preapproval. Isso afeta o mapeamento estorno → revogação pelo tópico `payment`.
5. O `next_payment_date` logo após `authorized`: a 1ª cobrança sai ~1 h depois [FATO]. Concedemos já no `authorized`. Se a 1ª cobrança falhar, o usuário fica no máximo ~3 dias de carência.
6. Se a retentativa da notificação mantém o mesmo `id`. Não é crítico: o estado é re-buscado.
7. Pix em assinatura e Pix Automático. Busca na doc do MP (2026-11-01): nenhuma menção a Pix Automático no
   `/preapproval`; o Plus no Pix é pagamento único (`plus_*_once`).
10. Reembolso: `POST /v1/payments/{id}/refunds` com corpo vazio = total e `X-Render-In-Process-Refunds: true` (Pix em
    contingência responde 201 `in_process` em vez de 400) estão na doc (2026-11-01); falta rodar em sandbox, junto com
    a preferência só com Pix dos presentes (`payment_methods.excluded_payment_types`; "Dinheiro em conta" não pode ser
    excluído) e o `payment.id` do `authorized_payment` como id da 1ª cobrança.
8. Se `back_url` precisa ser https. Exigimos https por segurança.
9. Tópicos a assinar no painel: `payment`, `subscription_preapproval` e `subscription_authorized_payment`, com URL `https://<api>/api/v1/billing/webhooks/mercadopago`.
