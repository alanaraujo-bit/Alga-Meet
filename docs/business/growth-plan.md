# Plano de crescimento — Alga Meet (oferta, Coleção 01, retenção)

- **Data:** 2026-11-01. **Status:** proposta para decisão.
- **Relação com outros docs:** complementa `docs/business/monetization.md` (preços-base, economia unitária, pagamentos, checklist jurídico). Este plano só altera o que estiver marcado **Muda**.
- **Base:** `docs/infra/cost-model.md`, `docs/research/discord-benchmark.md`, `docs/legal/termos-de-uso.md`, `docs/legal/review-notes.md`, `docs/legal/politica-de-privacidade.md`, `docs/design/design-system.md`, `docs/ARCHITECTURE.md` (D10b, D11, D12), `packages/shared/src/billing.ts`, `apps/server/src/billing/catalog.ts`.
- **Tags:** [FATO] fonte primária (empresa, lei, órgão público) · [RELATO] imprensa, terceiros ou dado autodeclarado · [CÁLCULO] derivado · [HIPÓTESE] premissa nossa · [NÃO VERIFICADO].
- **Fontes:** na §6 como [Rn], todas acessadas em 2026-11-01. Câmbio: US$ 1 = R$ 5,50.

## 0. Decisões pedidas ao dono

| # | Decisão | Recomendação |
|---|---|---|
| 1 | Tese e guardrails (§1) | Adotar como compromisso público, escrito na loja e nos Termos. |
| 2 | Alga Plus v2 (§2.2) | **Manter R$ 14,90/mês · R$ 149/ano.** A "Coleção Plus" fixa vira um guarda-roupa que cresce 1 item por mês. Entram aura, ícones do app, banner animado, insígnia de tempo e 2 convites de 7 dias por mês. O anual ganha 1 item permanente à escolha. |
| 3 | Casa, a compra do grupo (§2.3). **Muda** `monetization.md` §2.3 | Lançar na fase 2, só com perks de custo ≈ 0: **R$ 19,90 por 30 dias**, pago em vaquinha via Pix por quem quiser. O "Cinema" (1080p60 no espaço) só entra depois do pacote de banda da Latitude. |
| 4 | Loja (§2.4) | Catálogo permanente e coleções em ondas. Conjuntos que descontam o que você já tem. Presente para amigo, lista de desejos e provador no perfil e na chamada. Escada de R$ 5,90 a R$ 16,90. |
| 5 | Coleção 01 "Hora Azul" (§3) | 28 itens em 9 lugares, 5 deles heróis. **Onda 1** no lançamento pago: 18 itens, nos lugares que já existem e nos ícones. **Onda 2** de 6 a 8 semanas depois: auras, sons, reações e molduras. |
| 6 | Catálogo v1 "oceano" (§3.6) | Aposentar antes da primeira cobrança real. Nada foi vendido em produção, e a identidade teal saiu com a D10b. |
| 7 | Retenção (§4) | Eventos recorrentes ("Noite de jogo"), "Agora" com teto de avisos, resumo da semana e "Semanas juntos" sem punição. E-mail de reengajamento só com consentimento e motivo social concreto. |
| 8 | Métricas (§4.5) | Atividade diária guardada no servidor por 90 dias; depois disso, só agregados. **Antes de ligar:** atualizar a Política de Privacidade e fazer o teste de legítimo interesse (LIA). |
| 9 | Pré-requisitos já abertos | Cotação da Latitude, teste do Mercado Pago em sandbox, botão de reembolso (P1), recibo por e-mail (P2) e URL pré-assinada para anexos. **Nada da §5 vai para produção paga sem eles.** |

---

## 1. Por que as pessoas vão pagar

### 1.1 A tese em 5 linhas

1. **Identidade na frente dos amigos.** O que você usa aparece onde seus amigos olham: no tile da chamada, enquanto você fala, na lista de membros e no perfil. O público é o seu grupo, não estranhos.
2. **Status discreto.** Dá para ver que alguém apoia o Alga Meet (aura Frondes, "Plus há 6 meses"), mas nada grita.
3. **Presente.** Dar um item ou um mês de Plus a um amigo pelo Pix, em 20 segundos: no aniversário, na zoeira ou depois da vitória.
4. **Quem transmite paga o que custa.** 1440p60 e 4K para quem faz a noite de cinema ou mostra o jogo, sem tirar nada de quem assiste.
5. **Apoiar a casa do grupo.** A Casa é a vaquinha do grupo para deixar o espaço de vocês bonito.

### 1.2 O que a pesquisa sustenta

**Discord**
- **Shop** [FATO R4]:
  - Aberto a todos, com preço de membro para o Nitro.
  - Conjuntos com desconto em 2 itens da mesma coleção.
  - Botão de presente ao lado de "Comprar", com a lista de desejos do amigo na janela de presente.
  - Não dá para presentear um item que o amigo já tem.
- **Nitro:** estimativa de ~7,3 milhões de assinantes e ~US$ 280 milhões em 2025 [RELATO R5, estimativa de terceiros]. Não achamos pesquisa sobre o motivo da compra. Fontes fracas apontam customização e o "status" do emoji fora do próprio servidor [RELATO R20].
- **Orbs/Quests:** rejeitados como "caçar anúncio" [RELATO, benchmark §5]. Promoções do tipo "presenteie Nitro e ganhe uma decoração" existem [FATO R4].

**Jogos e cosméticos**
- **Riot (League of Legends):** skins da Ahri a ~US$ 250 e ~US$ 500.
  - Os jogadores protestaram banindo a campeã: a taxa de ban subiu de ~9% para mais de 14% [RELATO R3].
  - O diretor disse que o item era para quem gasta ~US$ 200/mês [RELATO R3].
  - **Lição:** teto de preço extremo e escassez queimam confiança, mesmo quando vendem.
- **Valorant:** um conjunto premium sai por ~7.100 VP (~US$ 82), contra 1.775 VP por skin. O conjunto só compensa para quem quer quase todas as peças [RELATO R8].
  - **Lição:** coleções e conjuntos funcionam. Nós damos ao conjunto um preço justo para quem já tem parte dele (§2.4).
- **Epic (Fortnite):** pagou US$ 245 milhões em reembolsos por dark patterns em compras, além de US$ 275 milhões por privacidade infantil (COPPA) [FATO R2].
- **ECA Digital (Lei 15.211/2025):**
  - Sancionada em 17/09/2025, em vigor desde mar/2026 [RELATO R1].
  - Proíbe caixas de recompensa (loot boxes) em jogos para menores ou de acesso provável por eles (art. 20; definição no art. 2º, IV) [RELATO R1].
  - O Overwatch tirou as loot boxes pagas no Brasil [RELATO R1].
  - O MJ pediu à ANPD que monitore jogos com caixas de recompensa [FATO R1, nota técnica].
- **Roblox:** criadores ganharam US$ 1,503 bilhão em 2025, contra US$ 922,8 milhões em 2024, com venda de itens de avatar entre as fontes [FATO R7]. É a economia de autoexpressão do público jovem.

**Outras plataformas**
- **Telegram Premium:** passou de mais de 12 milhões (Durov) para ~15 milhões de assinantes em mai/2025 [RELATO R6]. Os presentes colecionáveis são transferíveis e negociáveis como NFT [RELATO R6].
  - **Lição:** presente gera receita num mensageiro. Os nossos não serão revendáveis.
- **Steam:** a mediana de vendas na 1ª semana é **0,15×** as wishlists no lançamento; acima de US$ 10, cai para 0,10× [RELATO R9]. A lista de desejos é um sinal forte de intenção.
- **Twitch:** sub presenteado é vendido em lote e anunciado no chat. O presente é um ato social diante do grupo [RELATO R10].
- **Spotify:**
  - No Brasil, Individual R$ 23,90 e Universitário R$ 12,90 desde set/2025 [RELATO R11].
  - O Wrapped 2025 teve 200 milhões de usuários em ~24 h e 500 milhões de compartilhamentos [RELATO R12]. **Lição:** a retrospectiva vira ritual compartilhável.

**Brasil**
- 82,8% dos brasileiros jogam (PGB 2025) [RELATO R14].
- 77% dos gamers gastam até R$ 250/mês, e 71% consideram pagar dinheiro real por moeda de jogo [RELATO R14, Serasa/Gamers Club, jul/2025].
- Games são 41% dos gift cards vendidos, e 79% compraram ao menos um gift card no último ano [RELATO R13, BHN].
- O Pix já passa de metade das transações [RELATO R15]. O Pix Automático existe desde 16/06/2025 [RELATO R15].
- Preço "quebrado" (terminado em ,90) aumentou a intenção de compra num estudo da PUC-Rio [RELATO R16, TCC].

**Retenção**
- Mediana de apps "Social & Communication" (EUA, 3º tri/2025): D1 31,9%, D7 12,3%, D30 5,9% [RELATO R17, MWM].
- Régua da a16z para apps sociais: "ok" 50/35/20, "bom" 60/40/25, "ótimo" 70/50/30 [RELATO R17, 2023].
- **Duolingo:** quem chega a 7 dias de ofensiva tem 2,4× mais chance de voltar no dia seguinte [FATO autodeclarado R18].
- **Snapchat:**
  - A recuperação paga de ofensiva é citada no processo da Pensilvânia contra a Snap [RELATO R19].
  - 86% dos adolescentes mantêm ofensivas, e 25% já pagaram ~€ 0,99 para recuperar uma [RELATO R19, Bits of Freedom, amostra de ~300].

### 1.3 Guardrails (inegociáveis)

1. **Nada aleatório pago.** Sem caixa, sorteio, item surpresa ou "baú". O que você vê é o que você compra.
2. **Sem falsa escassez nem pressa.** Nenhum item sai da loja por prazo. Sem contagem regressiva, "só hoje", "restam X" ou "de R$ 19,90 por R$ 12,90" com preço que nunca existiu.
3. **Sem pagar para ouvir melhor (D12).** Cosmético e Casa nunca mexem em voz, latência ou prioridade de mídia. A transmissão premium continua pessoal (D11).
4. **Sem mirar adolescentes:**
   - 16–17 anos não compram (o checkout já recusa, P3).
   - Não veem chamada para comprar nem convite de upgrade.
   - Não recebem e-mail de reengajamento.
   - Só recebem presente de amigo, com "Abrir/Recusar".
   - Ofensiva e resumo nunca mandam aviso.
5. **Preço honesto:** total em reais antes de pagar, "pagamento único" ou "renova sozinho" escrito, link dos Termos e recibo por e-mail.
6. **7 dias de arrependimento, de verdade:** botão "Pedir reembolso" no app para cada item, presente, Casa e 1ª cobrança do Plus (Termos 9.5).
7. **Sem moeda virtual, crédito pré-pago, revenda ou ranking de quem gastou mais.**
8. **Quem vê manda no que vê.** Cada pessoa pode desligar, só para si, auras, sons de entrada, reações e animações de perfil dos outros.

### 1.4 Por que isso também maximiza a receita no longo prazo

- **O grupo é a unidade.** Uma cobrança que pareça golpe em um amigo vira história no grupo, e o grupo sai junto. O efeito de rede funciona nos dois sentidos [HIPÓTESE].
- **Reembolso e disputa custam mais que a venda.** Num item de R$ 5,90, um chargeback ou uma disputa MED do Pix (não contestável [FATO, monetization §6]) leva o item e a taxa. A Epic pagou US$ 245 milhões por isso [FATO R2].
- **Catálogo permanente vende por anos.** Cada usuário novo vê o item no amigo e pode comprar. A escassez concentra a receita no dia do lançamento e treina o usuário a esperar a próxima pressão [HIPÓTESE].
- **Risco regulatório zero onde mais dói:** ECA Digital, ANPD e Procon. Somos "rede social de acesso provável por adolescentes" (review-notes D4).
- **Posicionamento:** "sem anúncios, sem Quests, sem truque" é o motivo para trocar de app (benchmark §5). Quebrar isso custa aquisição.

---

## 2. Arquitetura da oferta

### 2.1 Escada de preço (BRL, preço quebrado em ,90, Pix primeiro)

| Preço | Onde |
|---|---|
| R$ 5,90 | placa simples, som de entrada, ícone do app |
| R$ 6,90 | item de entrada com animação leve |
| R$ 7,90 | tema de perfil, placa herói |
| R$ 9,90 | decoração padrão, aura simples, pacote de reações, moldura simples |
| R$ 12,90 | decoração, efeito ou aura premium |
| R$ 16,90 | o efeito herói (um só na coleção) |
| R$ 22,90–47,90 | conjuntos (§3.5) |
| R$ 14,90 | Plus mensal; presente de 1 mês de Plus |
| R$ 19,90 | Casa por 30 dias |
| R$ 149 | Plus anual; presente de 12 meses de Plus |

A Coleção 01 inteira custa **R$ 240,50** (25 itens vendáveis). Há um teto natural: menos que uma única skin Immortalized da Riot [CÁLCULO; R3].

### 2.2 Alga Plus v2: R$ 14,90/mês · R$ 149/ano

| Benefício | Onde aparece todo dia | Custo por assinante/mês | Fase |
|---|---|---|---|
| Transmissão em 1080p60, 1440p60 e 4K30 | seletor de tela, palco | R$ 0,48 no pacote · R$ 3,87 a preço de lista [CÁLCULO, monetization §4.1] | já existe |
| Anexos de até 100 MB | chat | R$ 1,80 hoje · R$ 0,20 com URL pré-assinada | já existe |
| **Guarda-roupa Plus:** aura Frondes, ícones Noite e Porcelana e **1 item novo por mês**. Vale enquanto assinar, e nenhum item sai dele | ao falar, no ícone do app, no perfil | ≈ 0 (renderizado no cliente) | 1 |
| **Insígnia de tempo:** 1, 3, 6, 12 e 24 meses, contando meses **somados**, não seguidos. Quem volta não recomeça do zero | perfil, hover na lista | ≈ 0 | 1 |
| **Banner de perfil animado** (o estático é grátis) | perfil | ≈ 0: ≤ 4 MB no bucket a US$ 0,015/GB-mês, egress grátis [FATO, cost-model §6.2] | 1 |
| **Cor do app:** 3 acentos validados (Lavanda H 300, Ardósia H 255, Grafite). Temas de acessibilidade continuam grátis | toda a UI | 0 | 1 |
| Atendimento com prioridade | e-mail | tempo da equipe | 1 |
| **Anual:** 1 item permanente da Coleção 01 à escolha, até R$ 12,90 | — | ≈ R$ 1,07/mês de receita que deixa de entrar [CÁLCULO: 12,90 ÷ 12] | 1 |
| Avatar por espaço (o apelido por espaço é grátis) | palco e lista do espaço | ≈ 0 | 2 |
| **2 convites Plus de 7 dias por mês** para amigos de 18+ anos, 1 por amigo a cada 12 meses | DM | R$ 0,07 no pacote · R$ 0,54 a preço de lista [CÁLCULO: 0,6 convite usado × 23% do mês × custo do stream] | 2 |
| Laboratório: acesso antecipado opcional | Configurações | 0 | 2 |
| Emojis próprios do espaço usáveis em qualquer espaço | chat | ≈ 0 | 3 (depende de emojis próprios existirem) |

**Conferência de preço:**
- **Custo total por assinante:** **R$ 0,75 no pacote · R$ 4,61 a preço de lista** [CÁLCULO]. A receita líquida é R$ 12,11 [monetization §4.2].
- **Fica em R$ 14,90 porque:**
  - está abaixo do Nitro (~R$ 24,99 [RELATO]) e do Spotify Individual (R$ 23,90 [RELATO R11]);
  - o break-even de 2,25% (1k CCU) e 1,39% (10k CCU) não muda;
  - a v2 só soma perks de custo ≈ 0.
- **Reajuste:** só depois de 6 meses de dados, com 30 dias de aviso (review-notes D16).
- **Pix no Plus:**
  - "Plus anual no Pix" (pagamento único, 12 meses, sem renovação) e o presente de Plus usam o caminho de pedido que já existe.
  - Pix Automático para o mensal: o blog do Mercado Pago o promove [RELATO R15, página com 403], mas a doc de assinaturas (`/preapproval`) só mostra cartão [FATO R15]. Suporte pela API: [NÃO VERIFICADO]. O pacote A confere.
- **Mantido de `monetization.md`:** sem desconto de membro na loja e sem crédito mensal (§2.5).

### 2.3 Casa: a compra do grupo

**O que é:** o espaço do grupo "acende". Qualquer membro de 18+ anos contribui com o valor que quiser, e cada contribuição soma dias. Não há renovação automática nem níveis.

**Contribuições:**

| Contribuição | Dias |
|---|---|
| R$ 5 | +7 |
| R$ 10 | +15 |
| R$ 19,90 | +30 |
| R$ 199 | +365 |

- **Pagamento:** Pix (0,99%) ou cartão.
- **Mural da Casa:** lista em ordem alfabética, só com quem escolheu aparecer. **Sem valores, sem ranking.**
- **Avisos:** 1 mensagem no espaço 5 dias antes do fim ("A Casa fica acesa até 12/12. Quem quiser pode renovar.") e 1 no fim. É informação, sem cronômetro nem repetição.
- **Quando acaba:** banner e ícone voltam ao estático. Nada é apagado.
- **Reembolso em 7 dias:** remove os dias daquela contribuição. Se a Casa ficar sem dias, ela acaba.
- **Nunca cobra por função de comunidade.** Canais, cargos, moderação, voz e convites continuam grátis.

**Perks da fase 2, custo ≈ 0:**
- Banner e ícone animados do espaço. O ícone anima só no hover do rail; com movimento reduzido fica estático.
- Tom do espaço: tinta do banner e do cabeçalho em 1 de 6 tons da paleta (§3.2). Nunca mexe no índigo de "você está aqui".
- Convite personalizado `algameet.com/c/<nome>`.
- Capa nos eventos (§4.1) e no "Agora" do espaço.
- Retrospectiva mensal da Casa, num cartão compartilhável.
- Selo discreto "Casa" no cabeçalho.
- Fase 3: 150 emojis próprios (em vez de 30), quando o recurso de emoji existir.

**Casa Cinema (fase 3, só com o pacote de banda da Latitude):**
- O que dá: 1080p60 para quem transmite nos canais da Casa, até **60 horas de transmissão por mês**.
- Depois do teto: cai para 1080p30, com aviso honesto no tile (o mesmo mecanismo de `routeStreamNotice`).
- 1440p60 e 4K continuam só no Plus pessoal.

**Risco de custo do Cinema** [CÁLCULO, cost-model §2.3; monetization §4.1]:
- A diferença entre 1080p60 e 1080p30 é de 3,24 Mbps por espectador. No teto, com 5 espectadores: 60 h × 5 × 3,24 Mbps × 0,45 GB = **437 GB/mês por Casa**.
- Custo: **R$ 3,01 no pacote** (US$ 1,25/TB) e **R$ 24,06 a preço de lista** (US$ 10/TB). Com 10 espectadores: R$ 6,02 e R$ 48,12.
- A receita líquida da Casa é **R$ 18,11** por 30 dias [CÁLCULO: 19,90 × (1 − 0,99% Pix − 6% Simples − 2% reembolso)].
- **Conclusão:** o Cinema fecha no pacote, com margem ≥ R$ 12, e quebra a preço de lista. O custo cresce com quem assiste e não paga, o mesmo risco de `monetization.md` §2.3.
- **Por isso:** teto de horas, nada acima de 1080p60 e alarme de egress por Casa acima de 500 GB/mês.

**Diferença para o Discord:** o boost compra bitrate de voz e Go Live em níveis de 2, 7 e 14 boosts [FATO, benchmark §4]. Aqui, a voz nunca entra (D12) e não há "faltam 3".

### 2.4 Loja de cosméticos

**Catálogo e conjuntos**
- **Catálogo permanente.** Coleção nova a cada 6–8 semanas. "Novo" é um rótulo estático por 14 dias, só dentro da loja. Nada pisca fora dela.
- **Conjuntos:** cerca de 25% de desconto (§3.5). Quem já tem parte do conjunto paga só a fração que falta ("Completar o conjunto"; regra na §3.5). O Discord só vende o conjunto a quem não comprou nenhuma das peças [FATO R4]; o nosso é mais justo.

**Presente para amigo** (item ou Plus de 1 ou 12 meses, sem renovação)
- **Fluxo:** escolher o amigo → o item → mensagem de até 140 caracteres → entregar agora ou numa data → Pix.
- **Quem pode receber:** só amigos de 72 h ou mais (antifraude e antialiciamento). Não dá para presentear um item que o amigo já tem [igual ao Discord, R4].
- **Abrir o presente:** o destinatário abre (uma fita que se desfaz em 1,2 s; estática com movimento reduzido), usa ou **recusa**. Recusar estorna o valor para quem deu.
- **Arrependimento:** o direito de 7 dias é de quem pagou. Se for exercido, o item sai do destinatário, com aviso.
- **Anunciar:** "Contar no espaço" é escolha do destinatário, numa mensagem de sistema discreta. Nunca é automático.
- **Antifraude:** cartão até R$ 100/dia em presentes; Pix até R$ 300/dia [HIPÓTESE].
- **16–17 anos:** recebem só de amigos, sempre com "Abrir/Recusar", e não recebem convite Plus.
- **Aniversário:** **não usamos a data de nascimento para lembrar aniversários.** A Política a limita à aferição de idade (§10, art. 13 do ECA Digital). Um aniversário "para amigos" seria um campo opcional à parte, na fase 3.

**Lista de desejos**
- Até 20 itens, visível só para amigos. É o padrão para 18+; para 16–17 vem desligada.
- Aparece na janela de presente. **Nunca dispara aviso** do tipo "seu amigo quer X".

**Provador**
- **No perfil:** já existe (a prévia fixa da loja).
- **Na chamada:** "Provar na chamada" mostra o item por 5 minutos para quem está na sala, com a etiqueta "provando" no popover. A partir dela, um amigo pode "Presentear".
  - Limites: 1 item por vez e 10 provas por dia. A prova acaba sozinha, sem contagem na tela.
  - Não existe para 16–17 anos (eles provam só no perfil).

**Checkout honesto** (Decreto 7.962, art. 4º)
- Antes de pagar: total, "pagamento único" e "Você pode pedir reembolso em até 7 dias", com link dos Termos.
- Depois de pagar: recibo por e-mail.
- Texto de posse: "fica na sua conta", **nunca "para sempre"** (P4, D10).

### 2.5 O que rejeitamos, e por quê

| Ideia | Por que não |
|---|---|
| Moeda virtual ou "crédito mensal" do Plus | Esconde o preço, contradiz o princípio 4 de monetization e cria saldo pré-pago (questão regulatória [HIPÓTESE]). Fica no lugar o "item do mês" do guarda-roupa. |
| Desconto de membro na loja | Faz o Plus parecer obrigatório para comprar (a dinâmica do Nitro). Mantém `monetization.md` §3. |
| Item por tempo limitado, "volta em 2027" | Falsa escassez (§1.3). |
| Níveis de Casa ("faltam 3") | Pressão de grupo. |
| Revenda, troca ou NFT de presentes | Especulação, lavagem e menores [modelo Telegram, R6]. |
| "Presenteie e ganhe um item" | Troca o motivo do presente pelo prêmio de quem dá [FATO R4: o Discord faz]. |
| Item com função (limite, prioridade) | Cosmético é só aparência (monetization §3). |
| Recuperação paga de ofensiva | Citada em processo contra a Snap [RELATO R19]. |

---

## 3. Coleção 01: "Hora Azul"

### 3.1 Direção de arte

**Conceito:** a hora azul é o quarto de hora depois do pôr do sol, quando o céu fica índigo e as janelas acendem. É a hora em que o grupo entra na call.

**Materiais:**
- **vidro:** refração, filete especular;
- **luz:** fios, poeira;
- **seda:** fita, brilho que corre;
- **porcelana:** claro, liso;
- **grafite e nanquim:** o traço feito à mão.

**Linguagem:**
- **Um gesto, depois repouso.** Toda animação dispara uma vez e para num último quadro bonito.
- Luz sempre do alto à esquerda (11 h), como o brilho de topo da UI (design-system §1, "prazer nos detalhes").
- Filetes de 0,5–1 px e gradientes em degraus OKLCH.
- **Proibido:** neon, bloom, glow difuso, partículas contínuas, desenho cartunesco.

**Régua:** cada item é aprovado pelo dono lado a lado com a UI ("parece caro?").

### 3.2 Paleta da coleção

Os valores aproximados são validados nos testes de contraste (pacote B).

| Token | Hex | OKLCH (aprox.) | Uso |
|---|---|---|---|
| `ha-ink` | `#0f0f1a` | .17 .02 279 | céu noturno, base |
| `ha-deep` | `#24255a` | .30 .10 279 | índigo profundo |
| `ha-indigo` | `#6163d0` | = `--accent-fill` | corpo |
| `ha-indigo-light` | `#8b8ef7` | = `--accent` | filete, anel |
| `ha-lilac` | `#b9b2f9` | .80 .09 290 | brilho secundário |
| `ha-porcelain` | `#f7f8f8` | = `--text-primary` | especular, estrelas |
| `ha-silver` | `#c9ccd6` | .84 .01 270 | metal, aro |
| `ha-graphite` | `#2a2b30` | .27 .005 282 | traço, fundo claro invertido |
| `ha-ember` | `#e8a898` | .79 .07 30 | linha do horizonte, **≤ 8% da área** |

**Cores proibidas em cosméticos** (lidas como estado):
- `--online` `#61c28e`, `--idle` `#e6b463`, `--danger` `#e66e68` / `#c04444`, `--live` `#e86885` / `#be395e`;
- teal e ciano (H 180–230). O `tokens.test.ts` já barra o teal.

### 3.3 Regras técnicas (valem para todos os itens)

1. **Lugares e tamanhos:**
   - Decorações ocupam 140% do avatar e usam geometria simplificada em 40 px ou menos (regra atual).
   - **Nunca ocupam o quadrante inferior direito**, onde fica o ponto de presença.
   - Nada aparece no chat.
   - No palco, a decoração é estática. Só a aura se mexe, e só quando a pessoa fala.
2. **Contraste:** texto sobre tema ou placa ≥ 7:1 (primário) e ≥ 4,5:1 (secundário).
3. **Movimento reduzido** (`prefers-reduced-motion` ou `html.reduce-motion`): mostra direto o último quadro. Auras saltam entre 0 e 1, como o anel padrão.
4. **Orçamento de GPU.** Máquina de referência [HIPÓTESE]: notebook Intel i5 de 8ª geração com UHD 620, tela 1080p a 60 Hz.

   | Nível | Regra |
   |---|---|
   | **G0** | Estático: 0 por quadro. |
   | **G1** | Animação única em CSS: só `transform`/`opacity`, ≤ 3 camadas (≤ 8 numa abertura de perfil), ≤ 2,4 s. Sem `filter`, `blur` ou `backdrop-filter` animados. |
   | **G2** | Canvas único: ≤ 24 partículas, ≤ 0,5 ms de main thread por quadro, ≤ 2 s. Depois desenha o quadro final e libera o canvas. |
   | **GV** | Contínuo, dirigido pela voz (auras): usa o rAF do `useEnvelope` (nenhum rAF novo), ≤ 2 camadas extras por tile (Ondas: 4), ≤ 0,1 ms por tile por quadro. |

   - **Fallback automático** para o anel padrão: com mais de 9 tiles visíveis, enquanto **você** codifica uma transmissão, com economia de energia do Windows ligada, ou com tempo de quadro p95 acima de 20 ms por 2 s.
   - **Teto global em chamada:** ≤ 1 ms por quadro somando todos os cosméticos.
5. **Ativos:**
   - Visuais: CSS, SVG e Canvas no código, como os renderizadores de hoje (sem baixar imagem).
   - Sons: Opus mono 48 kHz, ≤ 16 KB, empacotados no app.
   - Ícones: ICO em vários tamanhos.
   - Cliente antigo ignora SKU desconhecido (`look.ts`, já testado).
6. **Sons de entrada:**
   - **Substituem** o som padrão de entrada; não somam.
   - ≤ 1,2 s, ≤ −24 LUFS integrado, pico real ≤ −3 dBTP.
   - Tocam só para quem já está no canal quando você entra.
   - No máximo 1 vez a cada 10 minutos por canal. Não tocam em canal com mais de 15 pessoas.
   - O admin do espaço pode desligar por canal. Cada ouvinte pode silenciar todos ou só os de uma pessoa.
   - Nunca entram no áudio de uma transmissão: o pacote B verifica a exclusão do processo na captura loopback [NÃO VERIFICADO].
7. **Controles de quem vê:** em Aparência, chaves independentes para "Auras dos outros", "Sons de entrada", "Reações na chamada" e "Animações de perfil". São locais e funcionam offline.

### 3.4 Itens

★ = herói. Preço em BRL; "Plus" = incluído no guarda-roupa Plus (não vendido). Onda 1 = HA-01 a HA-15 e HA-26 a HA-28; Onda 2 = HA-16 a HA-25.

#### Decorações de avatar (`avatarDecoration`)

**HA-01 · `deco_ha_halo_vidro` · Halo de vidro** ★ — R$ 12,90 · G1
- **Conceito:** um anel aberto de vidro (270°, livre entre 3 h e 6 h).
- **Visual:**
  - Aro de 3 px em gradiente: `ha-porcelain` 55% → `ha-silver` 20% → `ha-indigo-light` 45% embaixo à esquerda.
  - Filete interno de 1 px em `ha-indigo-light` 30%.
  - Reflexo especular: arco de 18° às 11 h, em `ha-porcelain` 70% (gradiente SVG, sem blur).
- **Movimento:** ao abrir o perfil ou no hover, o reflexo corre de 9 h a 12 h. Rotação de 90° em 900 ms, out-quart, uma vez.
- **Reduzido:** reflexo parado às 11 h. Em 40 px ou menos: arco sólido de 2 px, sem reflexo.
- **Por quê:** o item mais legível em 32 px na lista e no tile. Parece caro sem gritar.

**HA-02 · `deco_ha_orbita` · Órbita** — R$ 9,90 · G1
- **Visual:**
  - Duas órbitas elípticas de 1 px, inclinadas ±18°: uma em `ha-lilac` 50%, outra em `ha-indigo-light` 40%.
  - Elas passam atrás do topo do avatar, por máscara.
  - Uma conta de 4 px em `ha-porcelain`.
- **Movimento:** a conta percorre 70° da órbita em 1,2 s ao abrir ou no hover. Repouso às 10 h.
- **Reduzido:** conta parada.
- **Por quê:** quem gosta de espaço e ciência; a leitura é geométrica.

**HA-03 · `deco_ha_constelacao` · Constelação** — R$ 9,90 · G1
- **Visual:** 7 estrelas de 2–3 px (`ha-porcelain` e `ha-lilac`) no arco superior esquerdo, ligadas por filetes de 0,5 px a 25%.
- **Movimento:** acendem em sequência, 60 ms cada (420 ms), e piscam uma vez (opacidade 0,6 → 1 → 0,8).
- **Reduzido:** todas no repouso.
- **Por quê:** "o seu signo" sem ser literal; rende assunto na call.

**HA-04 · `deco_ha_fita_seda` · Fita de seda** — R$ 12,90 · G1
- **Visual:** fita de 6 px em gradiente `ha-deep` → `ha-indigo` → `ha-lilac`, das 7 h à 1 h, com uma torção às 10 h.
- **Movimento:** uma faixa de brilho (`ha-porcelain` 25%) corre a fita uma vez em 1,1 s (máscara + `translate`).
- **Reduzido:** sem brilho.
- **Por quê:** o item "tecido", elegante, o que mais se parece com moda.

**HA-05 · `deco_ha_traco_grafite` · Traço de grafite** — R$ 6,90 · G0
- **Visual:** traço de lápis com largura variável de 1,5–3 px, de `#8a8f98` a `ha-silver`, num arco aberto de 300° com uma sobra de traço às 2 h. É um path SVG com largura variável, sem `feTurbulence`.
- **Movimento:** estático.
- **Por quê:** o preço de entrada; para minimalistas. Ninguém fica de fora da coleção por R$ 12,90.

#### Efeitos de perfil (`profileEffect`)

**HA-06 · `effect_ha_hora_azul` · Hora azul** ★ — R$ 16,90 · G1, 3 camadas, ≤ 0,3 ms/quadro
- **Visual:**
  - Camada A (crepúsculo): `ha-deep` no topo, linha de horizonte de 1 px em `ha-ember` a 78% da altura, `ha-ember` 30% na base.
  - Camada B (noite): `ha-ink` → `ha-deep`.
  - 12 estrelas de 1–2 px em `ha-porcelain`.
- **Movimento:** ao abrir o cartão de perfil:
  - A dá lugar a B em 1,6 s, out-quad.
  - O horizonte desce 6 px e cai para 20%.
  - As estrelas acendem em sequência, 40 ms cada, por 600 ms.
  - Total de 2,2 s. O último quadro é a noite com o horizonte fraco.
- **Reduzido:** último quadro direto.
- **Por quê:** é a assinatura da coleção, a cena do céu às 18h. O item que as pessoas abrem o perfil do amigo para ver.

**HA-07 · `effect_ha_poeira_luz` · Poeira de luz** — R$ 12,90 · G2
- **Visual:** 24 partículas de 1,5–3 px (`ha-porcelain` 80% e `ha-lilac` 60%).
- **Movimento:**
  - Sobem da base com deriva senoidal por 1,8 s e assentam em 35%.
  - O Canvas 2D respeita o DPR.
  - As posições vêm de uma semente pelo id do usuário: a poeira de cada pessoa é única e sempre a mesma.
- **Reduzido:** desenha o estado assentado uma vez.
- **Por quê:** substitui a antiga "Bioluminescência" na nova linguagem.

**HA-08 · `effect_ha_cortina_vidro` · Cortina de vidro** — R$ 12,90 · G1, 8 camadas
- **Visual:** 7 lâminas verticais de vidro (`ha-porcelain` 6%, com filete de topo a 12%) cobrem o banner.
- **Movimento:** as lâminas giram em `rotateY` até 80°, cada uma com 50 ms de atraso e 700 ms de duração (total 1,0 s), e somem.
- **Reduzido:** sem lâminas.
- **Por quê:** a "revelação" do perfil, uma estreia.

#### Placas de nome (`nameplate`)

**HA-09 · `nameplate_ha_crepusculo` · Crepúsculo** ★ — R$ 7,90 · G1
- **Visual:**
  - Gradiente da esquerda para a direita: `ha-deep` 70% → `ha-indigo` 35% → transparente aos 85%.
  - Linha de 1 px em `ha-ember` 60% na borda de baixo, de 0 a 40% da largura.
  - O nome fica em `--text-primary`, com contraste ≥ 7:1.
- **Movimento:** no hover, uma faixa de luz (`ha-porcelain` 10%, 24 px) atravessa em 700 ms, uma vez por hover.
- **Reduzido:** sem faixa.
- **Por quê:** a lista de membros é a superfície mais vista do app, e o item é barato.

**HA-10 · `nameplate_ha_vidro_fosco` · Vidro fosco** — R$ 5,90 · G0
- **Visual:** `ha-porcelain` 5% com grão estático (padrão SVG inline de 64 px) e filete de topo a 10%. Sem `backdrop-filter`.
- **Por quê:** discreto e barato, combina com tudo.

**HA-11 · `nameplate_ha_fio_luz` · Fio de luz** — R$ 6,90 · G1
- **Visual:** placa transparente com uma linha de 1 px embaixo, em `ha-indigo-light` 50%.
- **Movimento:** no hover, um segmento de 16 px em `ha-porcelain` 80% percorre a linha em 900 ms.
- **Reduzido:** linha parada.
- **Por quê:** o mais "Linear" de todos.

**HA-12 · `nameplate_ha_nanquim` · Nanquim** — R$ 5,90 · G0
- **Visual:** mancha de tinta radial em `ha-deep` 60% à esquerda, com borda macia até transparente aos 70%.
- **Por quê:** feito à mão, para quem desenha.

#### Temas de perfil (`profileTheme`)

**HA-13 · `theme_ha_noite_indigo` · Noite índigo** — R$ 7,90 · G0
- **Visual:** cartão em `ha-ink` → `ha-deep` na vertical, com filete de topo no banner. Texto primário ≥ 12:1.
- **Por quê:** a base que combina com qualquer item da coleção.

**HA-14 · `theme_ha_porcelana` · Porcelana** — R$ 9,90 · G0
- **Visual:**
  - Cartão **claro** num app escuro: `#f4f4f6` → `#e9e9ee`.
  - Texto `#1b1b1d` (≥ 7:1) e `#4a4c55` (≥ 4,5:1); links em `ha-indigo`.
  - Borda `rgba(0,0,0,.08)` e anel escuro externo para assentar na UI.
- **Por quê:** o maior contraste de identidade da loja. Quem usa é notado.

**HA-15 · `theme_ha_nevoa_lavanda` · Névoa lavanda** — R$ 7,90 · G0
- **Visual:** dois gradientes radiais sobre `ha-ink`: `ha-lilac` 18% no alto à esquerda e `ha-indigo` 22% embaixo à direita.
- **Por quê:** suave e romântico; a alternativa à Noite.

#### Auras de voz (`voiceAura`, lugar novo; como o seu "falando" aparece para os outros)

Regra comum: a aura **substitui** o anel padrão de 2 px e preserva a função de mostrar quem fala:
- traço ≥ 2 px, contraste ≥ 3:1 sobre o tile;
- o mesmo envelope (ataque de 60 ms, release de 240 ms);
- em silêncio, nada aparece;
- na faixa de 40 px, só o anel interno.

**HA-16 · `aura_ha_respiro` · Respiro** ★ — R$ 12,90 · GV, 2 camadas
- **Visual e movimento:**
  - Anel interno de 2 px em `ha-indigo-light`, com opacidade `min(1, speak × 2,2)`.
  - Anel externo de 1 px em `ha-lilac`, a +5 px, com opacidade `speak × 1,2` e escala `1 + 0,05 × speak`.
- **Reduzido:** os dois anéis saltam entre 0 e 1.
- **Por quê:** aparece toda vez que você fala. É a vitrine nº 1 do app.

**HA-17 · `aura_ha_prisma` · Prisma** — R$ 12,90 · GV, 1 camada
- **Visual:** anel de 2 px em gradiente cônico `ha-indigo` → `ha-lilac` → `ha-porcelain` 70% → `ha-indigo`.
- **Movimento:** o ângulo acumula proporcional à energia da fala (`+= 90°/s × speak`) e congela no silêncio.
- **Reduzido:** sem rotação.
- **Por quê:** a voz "gira o prisma"; quem fala muito brilha mais.

**HA-18 · `aura_ha_ondas` · Ondas** — R$ 9,90 · GV, 4 camadas
- **Movimento:**
  - Gatilho: o envelope cruza 0,35 subindo (no máximo 1 a cada 180 ms).
  - Cada gatilho emite um anel de 1 px em `ha-indigo-light` 60%, que escala de 1 a 1,25 e some em 600 ms.
  - Pool de 3. Desliga sozinho com mais de 9 tiles.
- **Reduzido:** anel padrão.
- **Por quê:** lê o ritmo da sua fala.

**HA-19 · `aura_ha_frondes` · Frondes** — Plus · GV
- **Visual:** anel padrão e um glifo de frondes de 12 px na pílula do nome, em branco → `#9a9df9` (marca).
- **Movimento:** as barras seguem o envelope em `scaleY`.
- **Reduzido:** barras paradas.
- **Por quê:** o sinal discreto de quem apoia.

#### Sons de entrada (`entranceSound`, lugar novo; regras na §3.3.6)

**HA-20 · `sound_ha_toque_vidro` · Toque de vidro** — R$ 5,90
- **Som:** duas notas de sino de vidro, Mi5 (659 Hz) → Si5 (988 Hz), ataque de 5 ms, 700 ms com a cauda.
- **Por quê:** educado, "cheguei" sem interromper.

**HA-21 · `sound_ha_corda` · Corda** — R$ 6,90
- **Som:** violão de nylon num arpejo de Dó7M (4 notas a 70 ms), 900 ms. Um aceno à bossa nova.
- **Origem:** gravação ou síntese própria, sem sample de terceiros.
- **Por quê:** brasilidade com bom gosto.

**HA-22 · `sound_ha_sopro` · Sopro** — R$ 5,90
- **Som:** ar filtrado subindo em 250 ms, depois um sino suave (Lá5); 600 ms no total.
- **Por quê:** o mais discreto dos três.

#### Reações na chamada (`callReactions`, lugar novo; depende da base grátis com 6 emojis, pacote D)

**HA-23 · `reactions_ha_hora_azul` · Reações Hora Azul** — R$ 9,90 · G1 por reação
- **Conteúdo:** 8 reações em SVG de 64 px — coração de vidro, risada (3 bolhas), palmas (2 faíscas), "Boa!" (Inter Display 590), olhos, fogo frio (chama índigo, sem cor quente), estrela, chorei de rir.
- **Movimento:** cada uma sobe 40 px a partir do tile de quem reagiu, com escala de 0,9 a 1 e fade, em 1,2 s.
- **Limites:** 1 a cada 1,5 s por pessoa e no máximo 6 na tela (≤ 0,3 ms/quadro).
- **Reduzido:** selo estático no tile por 1,5 s.
- **Por quê:** a reação é vista pela sala inteira, ao vivo.

#### Molduras de transmissão (`streamFrame`, lugar novo; aparece para quem assiste)

Regra comum:
- A moldura fica **fora** da área do vídeo (`contain`) e nunca cobre pixel de conteúdo.
- O selo AO VIVO não muda: é estado.
- Some em tela cheia e na janela flutuante (PiP).
- A moldura é um elemento irmão do `<video>`, para não tirar o vídeo da camada de overlay de hardware.

**HA-24 · `frame_ha_cinema` · Moldura Cinema** ★ — R$ 12,90 · G1, 2 camadas
- **Visual:** borda de 2 px em `ha-indigo` 70% e 4 cantoneiras em L de 12 px em `ha-porcelain` 60%.
- **Movimento:** quando o primeiro quadro chega para o espectador, um segmento de luz dá uma volta na moldura em 1,2 s.
- **Reduzido:** estática.
- **Por quê:** quem faz a noite de cinema quer que pareça estreia. Combina com o Plus 1440p60.

**HA-25 · `frame_ha_vidro` · Moldura de vidro** — R$ 9,90 · G0
- **Visual:**
  - Chanfro de 3 px: 1 px externo em `ha-porcelain` 18% e 2 px internos de `ha-silver` 10% até transparente.
  - Topo aceso a 25%.
- **Por quê:** acabamento para quem transmite todo dia.

#### Ícones do app (`appIcon`, lugar novo; só você vê, sincronizado entre dispositivos)

Aplicação: janela, barra de tarefas e bandeja, via `BrowserWindow.setIcon` e o ícone da bandeja. O atalho do instalador não muda; é uma limitação conhecida.

**HA-26 · `icon_ha_noite` · Noite** — Plus · G0
- **Visual:** frondes em `ha-porcelain` sobre quadrado arredondado `ha-ink`.

**HA-27 · `icon_ha_porcelana` · Porcelana** — Plus · G0
- **Visual:** frondes em `ha-graphite` sobre porcelana.

**HA-28 · `icon_ha_crepusculo` · Crepúsculo** — R$ 5,90 · G0
- **Visual:** frondes em gradiente `ha-ember` (topo) → `ha-indigo-light` (base), sobre `ha-ink`.
- **Por quê:** é o seu app, todo dia.

### 3.5 Conjuntos e ondas

| Conjunto | Itens | Soma | Preço | Desconto |
|---|---|---|---|---|
| **Hora Azul** (os 5 heróis) | HA-01, 06, 09, 16, 24 | R$ 63,50 | **R$ 47,90** | −25% |
| **Vidro** | HA-01, 08, 10, 20, 25 | R$ 47,50 | **R$ 35,90** | −24% |
| **Kit de chamada** | HA-16, 21, 23 | R$ 29,70 | **R$ 22,90** | −23% |
| **Kit de quem transmite** | HA-17, 23, 24 | R$ 35,70 | **R$ 26,90** | −25% |

- **Quem já tem parte do conjunto:** preço do conjunto × (valor dos itens que faltam ÷ soma do conjunto), arredondado para baixo em ,90.
  - Exemplo: com o Halo de vidro, o conjunto Hora Azul sai por 47,90 × 50,60 ÷ 63,50 = 38,17 → **R$ 37,90**.
- Conjuntos com itens da onda 2 só abrem quando a onda 2 chega.
- **Ondas:** a onda 1 tem 18 itens (lugares existentes e ícones); a onda 2, 10 itens (lugares novos). Nenhum item sai da loja. A Coleção 02 vem na fase 3.

### 3.6 Catálogo v1 "oceano"

Os itens `deco_folha_de_alga`, `deco_coral`, `theme_noite_paulistana`, `effect_bioluminescencia`, `nameplate_cardume`, `theme_plus_mare` e `nameplate_plus_correnteza` são da identidade teal que a D10b aposentou.

**Recomendação:** inativar em `CATALOG_VERSION = 2`, sem apagar (`orders` referencia os SKUs). O pacote A confirma que não há pedido `paid` fora do sandbox. Se houver, o item fica na conta de quem comprou e só sai da vitrine.

---

## 4. Retenção (grátis e pago)

### 4.1 Loops, em ordem de impacto

| # | Loop | Gatilho → ação → recompensa | Métrica |
|---|---|---|---|
| 1 | **Convite → 1ª chamada** | link no WhatsApp → entra direto no espaço de quem convidou → ouve o amigo em < 2 min | ativação |
| 2 | **"Agora"** | amigo entra na voz → aviso com teto (§4.3) → 1 clique → conversa | D1, D7 |
| 3 | **Noite de jogo** (eventos recorrentes) | evento semanal → lembrete 15 min antes → "Começou · 3 na sala · Entrar" | grupos ativos/semana, D30 |
| 4 | **Resumo da semana + Semanas juntos** | segunda-feira → "6 h com a galera, 3 noites" → compartilhar | D30, convites |
| 5 | **Vitrine social** | ver a aura ou a moldura do amigo → "Ver item" ou "Provar" → comprar ou presentear | conversão, presentes |
| 6 | **Volta com motivo** | inativo há 7+ dias e a Casa marcou evento → 1 e-mail (com consentimento) → volta | reativação |

**Eventos ("Noite de jogo"):** o recurso não existe; o pacote D constrói.
- **Campos:** título, data e hora (America/Sao_Paulo), canal de voz, recorrência semanal opcional, capa (Casa) e RSVP Vou/Talvez/Não.
- **Onde aparece:** cartão no espaço e no "Agora" da Home ("Hoje 21h · Sexta do jogo · 4 vão").
- **Modelos:** "Sexta do jogo", "Cinema de domingo" (transmissão) e "Estudo".
- **Quem cria:** permissão "Criar eventos", ligada para todos no modelo "Grupo de amigos".

**Resumo da semana:** segunda às 10h, calculado no servidor a partir das sessões de voz que os webhooks do LiveKit já informam (D7).
- **Mostra:** suas horas em voz, noites (dias com 30 min ou mais), canal mais usado, horas de transmissão assistida, eventos que você foi e as 3 pessoas com quem mais esteve.
- **As 3 pessoas:** só quem não desligou "Aparecer no resumo dos outros".
- **Nunca:** conteúdo ou contagem de mensagens, quem falou mais, ranking entre amigos.
- **Compartilhar:** o cartão é gerado no próprio app, e você escolhe se e onde compartilha [modelo do Wrapped, R12].
- **16–17 anos:** veem no app, sem aviso.

**Semanas juntos** (ofensiva do grupo, não individual):
- **O que conta:** semanas seguidas em que o espaço teve ao menos 1 chamada com 3+ membros por 30 min ou mais.
- **Onde aparece:** só no hover do cabeçalho do espaço e no resumo.
- **Proteções:**
  - 1 semana de pausa automática a cada 4.
  - **Nenhum aviso, nunca "vai perder", nunca recuperação paga.**
  - O admin desliga.
- **Por quê:** fica o valor que o Duolingo mede [R18], sem a ansiedade que motivou o processo contra a Snap [R19].

**Vitrine social:**
- O popover de perfil mostra "Halo de vidro · Coleção Hora Azul · Ver na loja", e "Provar" para adultos.
- Na loja: "2 amigos usam", contando quem usa agora (equipar já é público).
- **Nunca** "X pessoas compraram hoje".

### 4.2 Onboarding: do primeiro abrir à primeira chamada em < 2 min

| Passo | Pelo convite | Orgânico | Alvo |
|---|---|---|---|
| 1 | Cadastro: e-mail, senha, data de nascimento, nome | igual | 40 s |
| 2 | O convite (deep link `algameet://`, `features/app/deepLinks.ts`) abre a prévia de voz do espaço | "Criar a casa do seu grupo": nome + modelo "Grupo de amigos" (#geral, Sala 1, Sala 2) | 15 s |
| 3 | Teste de microfone dentro da prévia (barra de nível + 1 chave) | "Chamar amigos": copiar link ou "Enviar no WhatsApp" (abre `wa.me` com texto pronto; quem envia é o usuário) | 20 s |
| 4 | "Entrar em Sala 1": ouve o amigo | "Entrar e esperar": "Quem chegar já te ouve", com aviso quando alguém chegar | 5 s |

- Se a confirmação de e-mail bloqueia algo antes da primeira chamada, ela passa para depois (prazo de 7 dias). Os limites anti-abuso continuam.
- **Medida:** p50 de até 2 min, do primeiro abrir à entrada em voz com um amigo (caminho do convite).

### 4.3 Avisos e e-mails: tetos duros

| Canal | Quando | Teto |
|---|---|---|
| Aviso "entrou na voz" (Windows) | Amigo entra em espaço ou DM onde você esteve em chamada nos últimos 21 dias, ou que você marcou "Avisar" | 1 por espaço a cada 3 h · 4 por dia · nada entre 01h e 09h, em chamada, em "Não perturbe" ou com jogo em tela cheia |
| Lembrete de evento | RSVP "Vou" ou "Talvez" | 1 aviso 15 min antes. E-mail 2 h antes só se você pedir naquele evento |
| E-mail de atividade | Inativo há 7+ dias **e** há motivo concreto (evento marcado, amigo chamou) | Só com consentimento (caixa desmarcada, registrado em `consent_records`) · 1 a cada 7 dias · 4 em 60 dias, depois para até você voltar · nunca para 16–17 · descadastro em 1 clique |
| Loja e promoções | — | **Nunca há aviso de loja.** |

### 4.4 Métricas

Alvos do beta [HIPÓTESE]:

| Métrica | Definição | Alvo |
|---|---|---|
| **Grupos ativos na semana** (estrela-guia) | Espaços ou grupos de DM com 3+ membros diferentes juntos em voz (2+ ao mesmo tempo) por 30 min ou mais na semana | +10%/mês |
| Ativação | % de cadastros com 3 min ou mais em voz com outra pessoa nas primeiras 24 h | ≥ 60% pelo convite · ≥ 25% orgânico |
| Tempo até a 1ª chamada | p50, do primeiro abrir à voz com outra pessoa | ≤ 2 min (convite) |
| D1 / D7 / D30 | Ativo = sessão autenticada usada no dia N (BRT) | 45% / 30% / 20%. Referências: mediana social de 32/12/6 e "ok" da a16z de 50/35/20 [R17] |
| Eventos por grupo ativo | Eventos com 2+ presentes por mês | ≥ 2 |
| Conversão Plus | Assinantes ativos ÷ MAU | ≥ 2,5% (break-even de 2,25% no pacote) |
| Pagantes únicos | Pagantes no mês ÷ MAU | ≥ 4% |
| ARPPU | Receita líquida do mês ÷ pagantes únicos | R$ 13–16 |
| Taxa de presente | Pedidos-presente ÷ pedidos de cosmético | 15–25% |
| Reembolso | Reembolsos ÷ pedidos pagos, por produto | ≤ 3% (alarme acima de 5%) |
| Churn do Plus | Mensal | ≤ 6% |
| Casa | Casas ativas ÷ grupos ativos na semana | ≥ 3% |
| Provador → compra | Compra do item em até 24 h depois de provar | ≥ 8% |
| **Guarda-corpos** | Usuários que desligam avisos no mês ≤ 10%. Som de entrada silenciado por mais de 20% dos ouvintes → redesenhar. Cada reclamação de "pressão" vira revisão | — |

### 4.5 Medir sem rastrear

- **Sem SDK de terceiros, sem pixel, sem relatório enviado pelo app.** A Política §3 continua verdadeira para o cliente. Tudo sai do que o servidor já vê.
- **Dados novos** (pacote D):
  1. `activity_days (user_id, day, flags)`: abriu, mandou mensagem, 3 min ou mais em voz, voz com outra pessoa. Fica **90 dias**.
     - Toda noite vira `metric_cohorts` e `metric_daily`, sem ids. Células com menos de 10 pessoas ficam escondidas.
  2. `voice_sessions (escopo, canal, usuário, entrou, saiu)`, a partir dos webhooks do LiveKit (D7). A tabela bruta fica 35 dias.
     - Vira `voice_weekly (usuário, semana, espaço, minutos, noites)`, guardada 12 semanas, para o resumo.
     - Quem esteve com quem é calculado uma vez por semana. O bruto é apagado.
  3. Funil da loja em contadores do Prometheus (`metrics.ts`): loja aberta, prova iniciada, checkout criado por tipo de produto. Rótulos fixos, sem usuário.
  4. As tabelas de cobrança (já existem).
- **Opt-out:** "Não usar minha atividade nas métricas do produto". Tira o usuário dos agregados; fica só o que a lei exige.
- **O que a Política precisa divulgar antes de ligar** (com advogado; registrar em `review-notes.md`):
  - (a) registros de atividade para métricas agregadas: o que, 90 dias, legítimo interesse com LIA, opt-out;
  - (b) resumo da semana e "Semanas juntos": minutos e copresença em voz, prazos, as duas chaves;
  - (c) presentes: quem deu, quem recebeu e a mensagem, visíveis aos dois, guardados com o pedido pelo prazo fiscal;
  - (d) lista de desejos visível a amigos;
  - (e) eventos e RSVP;
  - (f) e-mail de atividade por consentimento (a §7 da Política diz hoje que não usamos consentimento como base legal);
  - (g) o provador transmitido à sala;
  - (h) o Mural da Casa (opcional).
  - Também ajustar a frase "nenhum relatório de uso é enviado" para não sugerir que não há métrica nenhuma no servidor.

---

## 5. Roadmap e plano de construção

### 5.1 Fases

| Fase | Quando | Entrega |
|---|---|---|
| **0 · Pré-requisitos** | Antes de qualquer cobrança | Cotação da Latitude · MP em sandbox com usuários de teste (monetization §8) · reembolso self-service (P1) · recibo por e-mail (P2) · URL pré-assinada para anexos · Política e Termos atualizados (§4.5, presentes, Casa) |
| **1 · Lançamento pago** | Semanas 1–6 | Plus v2 (sem convites e sem avatar por espaço) · catálogo v2 + onda 1 (18 itens) · presentes (itens e Plus, via Pix) · lista de desejos · conjuntos · provador no perfil · Plus anual no Pix · onboarding < 2 min · convite pelo WhatsApp · "Agora" com tetos · eventos + lembretes · métricas (§4.5) |
| **2 · Grupo e chamada** | Semanas 7–12 | Lugares novos (aura, som, reações, moldura) + onda 2 (10 itens) · reações grátis na chamada · provador na chamada · Casa (perks ≈ 0) · convites Plus · avatar por espaço · resumo semanal · Semanas juntos · e-mail com consentimento |
| **3 · Escala** | Depois do pacote da Latitude e de 3 meses de dados | Casa Cinema · emojis próprios (e o perk Plus) · Coleção 02 · aniversário opcional · Pix Automático no Plus mensal (se o MP suportar) |

### 5.2 Pacotes de trabalho (agentes especializados)

**Ordem:** A começa primeiro. B e D andam em paralelo desde o dia 1 (B com catálogo simulado). C entra quando as rotas de A estiverem no contrato.

**Arquivos quentes:** `CallStage.tsx` e `voice.ts` têm um dono por fase. B **exporta** componentes de `features/billing` e só monta pontos de encaixe no palco. D é dono da prévia de voz.

#### (A) Servidor: catálogo, direitos, presentes, conjuntos, coleções, lista de desejos, Casa, Mercado Pago

**Escopo:**
- `packages/shared/src/billing.ts`:
  - Novos `CosmeticType`/slots: `voice_aura`→`voiceAura`, `entrance_sound`→`entranceSound`, `call_reactions`→`callReactions`, `stream_frame`→`streamFrame`, `app_icon`→`appIcon`. O `appIcon` vai só em `Me`, nunca em `PublicUser`.
  - Tipos `Gift`, `Bundle`, `Collection`, `Wishlist`, `SpaceUpgrade`, `TryOn`; `PutCosmeticsBody`.
- `packages/shared/src/api.ts` e `gateway.ts`: `GIFT_RECEIVED`, `GIFT_UPDATE`, `SPACE_UPGRADE_UPDATE`, prova via `USER_UPDATE`.
- `apps/server/src/billing/{catalog,billing,mercadopago,provider}.ts`, `apps/server/src/routes/billing.ts`.
- `apps/server/src/db/schema.ts` + migrações: `gifts`, `bundles`, `bundle_items`, `collections`, `wishlists`, `space_upgrades`, `space_upgrade_contributions`.
- `apps/server/src/email-templates.ts`: recibo e presente. Mais os testes.

**Entregas:**
- `CATALOG_VERSION = 2` com Hora Azul, coleções e conjuntos; v1 inativado.
- Pedido-presente com aceite e recusa.
- Lista de desejos.
- Casa: produto, contribuições, medidor de dias e direitos por espaço, no job de expiração que já existe.
- Plus como presente e Plus anual no Pix: período sem renovação.
- Convites Plus; insígnia de tempo (meses somados); rota de prova.
- Reembolso self-service pela API do MP (`/v1/payments/{id}/refunds`, verificar em sandbox).
- Conferir o Pix Automático no `/preapproval`.

**Aceite:**
- Nenhum direito sem webhook verificado e re-busca no MP (regra atual), com testes para presente, conjunto e Casa.
- **Presente:**
  - Recusa quem não é amigo ou é amigo há menos de 72 h. Recusa item que o destinatário já tem.
  - 16–17 só recebem com aceite.
  - Recusa do destinatário → estorno → nenhum direito.
  - Arrependimento de quem pagou revoga do destinatário, com evento.
- **Conjunto:** preço = preço do conjunto × (valor dos itens que faltam ÷ soma), arredondado para baixo em ,90 (§3.5). Testado com 0, 1 e todos possuídos. Concessão atômica.
- **Casa:**
  - Contribuições somam dias; reembolso tira dias.
  - No fim, os direitos caem no mesmo job.
  - Nenhuma renovação automática. Só 18+ contribui.
- O bloqueio de 16–17 vale também para presente, Casa e convite Plus.
- Idempotência, eventos fora de ordem e recusa do sandbox em produção continuam cobertos.
- Limites de presente (cartão R$ 100/dia, Pix R$ 300/dia).

#### (B) Motor de cosméticos e ativos da Coleção 01

**Escopo:**
- `apps/desktop/src/renderer/src/features/billing/**`: `look.ts`, `Cosmetics.tsx`, `cosmetics.module.css`, novos `render/<lugar>` e `hora-azul/`.
- Pontos de encaixe: `features/voice/CallStage.tsx` + `stage.module.css` (aura, moldura, camada de reações) e `features/shell/MemberList.tsx` (placa).
- Tocador do som de entrada no evento de entrada em voz.
- `apps/desktop/src/main/**`: `BrowserWindow.setIcon` e bandeja.
- `apps/desktop/build/brand/**`: ICOs.
- `apps/desktop/src/renderer/src/styles/tokens.test.ts`.

**Entregas:** os 28 renderizadores (§3.4), os 3 sons, os 3 ícones, as chaves de "quem vê" (§3.3.7) e o fallback automático de GPU.

**Aceite:**
- Capturas de cada item em 32, 40, 56, 80 e 96 px, com e sem movimento reduzido, em `docs/screenshots/` (`ALGA_SHOTS_TAG=hora-azul`).
- **Desempenho:** trace na máquina de referência com 12 tiles, 4 auras falando e 1 transmissão assistida. Cosméticos ≤ 1 ms/quadro p95. Fallback testado nos 4 gatilhos.
- **Testes:**
  - o último keyframe de cada animação é o repouso;
  - contraste ≥ 7:1 e ≥ 4,5:1 em temas e placas;
  - nenhuma cor proibida em `features/billing/render/**`;
  - decorações deixam o quadrante inferior direito vazio;
  - a moldura nunca cruza o retângulo do vídeo e some em tela cheia e PiP;
  - SKU desconhecido nos lugares novos é ignorado.
- **Sons:** script confere ≤ 1,2 s, ≤ −24 LUFS e ≤ −3 dBTP. Silenciar por pessoa, chave global, intervalo de 10 min e teto de 15 pessoas testados. Exclusão da captura de transmissão verificada.
- Aprovação visual do dono por item.

#### (C) Loja, Plus e presentes (UX)

**Escopo:**
- `features/billing/{Shop.tsx,Plan.tsx,store.ts,strings.ts}` + novos `Gift.tsx`, `Wishlist.tsx`, `TryOn.tsx`, `Receipts.tsx`.
- `features/spaceSettings/**` (página da Casa).
- `features/shell/people.tsx` (popover: "Ver na loja", "Presentear").
- Encaixe da etiqueta "provando" em `features/voice/**`.

**Entregas:** loja com coleções, conjuntos e "completar"; fluxo de presente; caixa de presentes; lista de desejos; provador na chamada; página do Plus v2 (guarda-roupa, insígnia, convites); Casa (contribuir, mural, perks); reembolso e recibos.

**Aceite:**
- Resumo antes de pagar (total, único ou recorrente, renovação, 7 dias, link dos Termos) em **todo** checkout, incluindo presente e Casa.
- "Pedir reembolso" funciona em até 7 dias, com confirmação na hora.
- Revisão por checklist confirma **zero**:
  - cronômetro ou "só hoje";
  - "de/por" falso;
  - caixa pré-marcada;
  - confirmshaming;
  - badge vermelho na loja;
  - aviso de loja.
- Presente de ponta a ponta no sandbox, incluindo recusa → estorno.
- Provador na chamada:
  - os outros veem a etiqueta "provando";
  - acaba sozinho em 5 min;
  - 1 por vez;
  - ausente para 16–17.
- 16–17: sem botões de compra ("Compras a partir de 18 anos"), sem CTA de upgrade (o "Ver planos" some do chip de qualidade), lista de desejos desligada.
- Teclado e leitor de tela em todos os fluxos.
- Texto "fica na sua conta", nunca "para sempre".

#### (D) Retenção: eventos, avisos, resumo, onboarding, métricas

**Escopo:**
- **Servidor:**
  - novos `apps/server/src/events/**` (eventos, RSVP, job de lembretes) e `apps/server/src/activity/**` (`activity_days`, `voice_sessions`, agregados, resumo);
  - rotas em `apps/server/src/routes/` (novo `events.ts`);
  - gravação de sessões em `apps/server/src/voice.ts`;
  - `email-templates.ts`; `packages/shared/src/{api,gateway}.ts`.
- **Desktop:** `features/onboarding/**`, `features/spaces/**` (eventos), `features/app/notifications.ts` (tetos), `features/shell/**` (Agora, Home), `features/voice/**` (prévia com teste de microfone, base grátis de reações), `features/settings/**` (chaves de privacidade e de avisos).
- **Docs:** rascunho do diff de `docs/legal/politica-de-privacidade.md` para o dono e o advogado.

**Aceite:**
- **Onboarding:** teste com 5 pessoas reais, não agentes, registrado em `docs/qa/`. p50 ≤ 2 min do primeiro abrir à voz com um amigo.
- **Tetos de aviso (§4.3):** com testes unitários.
- **Lembrete de evento:** exatamente uma vez (job idempotente), BRT, recorrência semanal.
- **Resumo:** só a partir de agregados. As duas chaves de opt-out são respeitadas e não há conteúdo de mensagem.
- **Semanas juntos:** nenhum caminho de código dispara aviso; pausa automática.
- **Dados:** expurgo de 90 e 35 dias; células com menos de 10 escondidas; opt-out fora dos agregados; rótulos do Prometheus fixos.
- **E-mail:** só com registro de consentimento, com os tetos da §4.3 e descadastro em 1 clique.
- **Painel** com as métricas da §4.4 (staff ou Grafana).

### 5.3 Modelo de receita atualizado [HIPÓTESE]

**Premissas:**
- Plus líquido de R$ 12,11 por pagante (monetization §4.2).
- Cosmético líquido = 0,89 × bruto [CÁLCULO: 70% Pix a 0,99% + 30% cartão a 4,98% + Simples 6% + reembolso 3%].
- Casa líquida de R$ 18,11 por mês.
- Espaços ativos ≈ MAU ÷ 12.
- 40% dos compradores de cosmético já são assinantes Plus. Cada Casa traz 1 pagante novo.

| Cenário | Plus (% MAU) | Compradores de cosmético/mês (% MAU) × ticket | Casa (% dos espaços) |
|---|---|---|---|
| Conservador | 1,5% | 0,5% × R$ 10 | 1% |
| Base | 3% | 1,2% × R$ 13 | 3% |
| Otimista | 5% | 3% × R$ 17 | 6% |

**Receita líquida por mês** [CÁLCULO]:

| 20k MAU (1k CCU) | Plus | Cosmético | Casa | **Total** | vs infra no pacote (R$ 5.445) | vs infra a preço de lista (R$ 13.750) | Pagantes / MAU | ARPPU | ARPU |
|---|---|---|---|---|---|---|---|---|---|
| Conservador | 3.633 | 890 | 302 | **4.825** | −620 | −8.925 | 1,9% | R$ 12,80 | R$ 0,24 |
| Base | 7.266 | 2.777 | 906 | **10.949** | **+5.504** | −2.801 | 4,0% | R$ 13,79 | R$ 0,55 |
| Otimista | 12.110 | 9.078 | 1.811 | **22.999** | +17.554 | +9.249 | 7,3% | R$ 15,75 | R$ 1,15 |

| 200k MAU (10k CCU) | **Total** | vs infra no pacote (R$ 33.660) | vs infra a preço de lista (R$ 131.560) |
|---|---|---|---|
| Conservador | **48.250** | +14.590 | −83.310 |
| Base | **109.490** | **+75.830** | −22.070 |
| Otimista | **229.990** | +196.330 | +98.430 |

**Leitura:**
- O Plus segue sendo a alavanca: **cada 1 ponto percentual de Plus vale R$ 2.422/mês a 20k MAU**.
- O cosmético base (R$ 0,14 por MAU) é ~5× a hipótese antiga de `monetization.md` §3 (R$ 0,03). A diferença vem da vitrine na chamada, dos presentes, dos conjuntos e de duas ondas. Se o real for R$ 0,03, o cenário base ainda fecha **+R$ 3,3 mil** no pacote.
- **A preço de lista, só o cenário otimista fecha, nas duas escalas. A cotação da Latitude continua sendo a condição nº 1.**
- Fora da conta: folha, suporte e tributos sobre serviço importado (monetization §4.2).

### 5.4 Riscos e respostas

| Risco | Resposta |
|---|---|
| Itens "bonitos, mas ninguém compra" | Aprovação do dono por item; provador; matar e reembolsar o que passar de 5% de reembolso |
| Som de entrada irritante | Substitui (não soma), intervalo de 10 min, chaves para quem ouve, guarda-corpo de 20% |
| Fraude com cartão roubado em presentes | Amizade de 72 h ou mais, tetos diários, Pix primeiro, 3DS |
| Aliciamento por presente a adolescente | Só de amigos, "Abrir/Recusar", "Denunciar" no presente, nenhum convite Plus |
| Custo do Cinema | Só com pacote, teto de 60 h, nada acima de 1080p60, alarme a 500 GB |
| Jurídico | Titularidade da licença no presente, natureza da Casa (serviço ao espaço; quem é o consumidor), LIA das métricas, e-mail por consentimento. Registrar como itens novos em `docs/legal/review-notes.md` |
| Percepção de "estão me medindo" | Divulgar antes, opt-out generoso, nada de terceiros |
| Conflito de arquivos entre agentes | Dono por fase para `CallStage.tsx` e `voice.ts`; B exporta componentes; coordenar em `docs/MAESTRO.md` |

---

## 6. Fontes (acessadas em 2026-11-01)

- **R1 — ECA Digital e loot boxes:**
  - https://www.tecmundo.com.br/voxel/502437-loot-boxes-serao-proibidas-no-brasil-apos-sancao-de-lula-entenda-impacto-da-lei-felca-nos-games.htm
  - https://www.poder360.com.br/poder-governo/eca-digital-entra-em-vigor-nesta-3a-feira-entenda-o-que-muda/
  - https://www.gov.br/mj/pt-br/assuntos/noticias-1/mjsp-pede-a-anpd-que-monitore-jogos-eletronicos-com-caixas-de-recompensa-que-nao-implementaram-verificacao-de-idade/NotaTcnican55.pdf
  - https://www.conjur.com.br/2025-out-22/impactos-do-eca-digital-no-segmento-de-jogos-eletronicos/
  - https://canaltech.com.br/games/overwatch-remove-loot-boxes-pagas-no-brasil-lei-felca-pode-ser-o-motivo/
- **R2 — FTC × Epic:**
  - https://www.ftc.gov/node/80648
  - https://www.pbs.org/newshour/amp/nation/fortnite-maker-epic-games-to-settle-ftc-case-pay-520-million-in-penalties-and-refunds
- **R3 — Riot e as skins da Ahri:**
  - https://www.gamesradar.com/games/league-of-legends/league-of-legends-players-protest-dollar500-skin-with-a-forced-boycott-perma-banning-ahri-to-stop-anyone-using-her-new-cosmetic
  - https://www.pcgamesn.com/league-of-legends/ahri-ban
  - https://pcgamer.com/games/moba/according-to-the-games-director-the-dollar500-league-of-legends-ahri-skin-wasnt-meant-for-the-average-fan-but-instead-players-who-are-willing-to-spend-dollar200-a-month-on-their-hobbies
- **R4 — Discord Shop (presentes, lista de desejos, conjuntos):**
  - https://support.discord.com/hc/articles/17162747936663
  - https://support.discord.com/hc/en-us/articles/36288192746903-Wishlist-FAQ
  - https://discord.com/blog/gift-nitro-and-earn-a-flavorful-splash-for-your-avatar
- **R5 — Estimativa do Nitro:** https://resourcera.com/data/social/discord-revenue/
- **R6 — Telegram Premium e presentes:**
  - https://ppc.land/telegram-premium-hits-10m-subscribers-adds-star-giveaways/
  - https://voxbooster.com/blog/telegram-statistics-2026
- **R7 — Roblox 10-K FY2025:** https://www.sec.gov/Archives/edgar/data/1315098/000131509826000024/rblx-20251231.htm
- **R8 — Conjuntos do Valorant:**
  - https://beebom.com/valorant-skins-bundles-tiers-prices/amp
  - https://siege.gg/news/valorant-champions-2025-bundle-release-date-weapon-skins-price-and-more
- **R9 — Wishlists do Steam:**
  - https://newsletter.gamediscover.co/p/the-state-of-steam-wishlist-conversions
  - https://automaton-media.com/en/news/steam-wishlist-to-sales-study-shows-how-genre-release-timing-and-reviews-affect-success-nsfw-games-show-unusually-high-conversion-rate/
- **R10 — Subs da Twitch:**
  - https://streamhatchet.com/blog/twitch-subscribers-overview-tiered-subs-gift-subs-and-prime-subs
  - https://blog.eklipse.gg/streaming-tips/how-much-is-a-gifted-sub-on-twitch-pricing-breakdown.html
- **R11 — Preços do Spotify no Brasil:**
  - https://tecnoblog.net/noticias/spotify-premium-fica-mais-caro-no-brasil-veja-os-novos-precos/
  - https://macmagazine.com.br/post/2025/08/04/spotify-anuncia-reajuste-de-precos-no-brasil-em-portugal-e-outros-paises/
- **R12 — Spotify Wrapped:**
  - https://www.musicbusinessworldwide.com/spotify-wrapped-campaign-hit-200m-engaged-users-in-24-hours-a-19-yoy-increase
  - https://www.ibtimes.com/record-breaking-spotify-wrapped-2025-sees-200m-engage-500m-shares-day-3792059
- **R13 — Gift cards e presentes no Brasil:**
  - https://mercadoeconsumo.com.br/25/11/2025/noticias-varejo/gift-card-se-torna-opcao-de-presente-e-amplia-presenca-em-redes-de-varejo/
  - https://www.infomoney.com.br/consumo/parece-impopular-mas-nao-e-como-o-brasileiro-usa-bastante-o-vale-presente/
  - https://mundodomarketing.com.br/como-os-brasileiros-se-relacionam-com-os-games
- **R14 — Gastos dos gamers e PGB 2025:**
  - https://www.serasa.com.br/imprensa/gamers-brasileiros-gastam-ate-250-por-mes-com-jogos-digitais/
  - https://www.dgabc.com.br/Noticia/4253729/77-dos-brasileiros-gastam-ate-rs250-por-mes-em-jogos-digitais
  - https://www.portaldotransito.com.br/noticias/como-os-habitos-dos-gamers-brasileiros-estao-mudando-estudo-2025/
- **R15 — Pix e Pix Automático:**
  - https://www.band.com.br/band-vale/noticias/como-o-pix-mudou-a-forma-como-o-brasileiro-paga-por-games-e-streaming-202607202039
  - https://www.mercadopago.com.br/blog/pix-automatico-vender-pacotes-assinaturas (HTTP 403 ao buscador)
  - https://www.letsmoney.com.br/noticias/pagbrasil-pix-automatico-um-ano-recorrencia/
  - https://www.mercadopago.com.br/developers/pt/docs/subscriptions/integration-configuration/subscription-no-associated-plan/authorized-payments
- **R16 — Preço psicológico (TCC da PUC-Rio):** https://www.maxwell.vrac.puc-rio.br/46444/46444.PDF
- **R17 — Retenção:**
  - https://mwm.ai/glossary/n-day-retention
  - https://a16z.com/do-you-have-lightning-in-a-bottle-how-to-benchmark-your-social-app/
  - https://www.pushwoosh.com/blog/increase-user-retention-rate
- **R18 — Ofensivas do Duolingo:**
  - https://blog.duolingo.com/improving-the-streak
  - https://making.duolingo.com/how-streaks-keep-duolingo-learners-committed-to-their-language-goals
- **R19 — Ofensivas do Snapchat:**
  - https://thenextweb.com/news/pennsylvania-snap-lawsuit-snapchat-age-rating-addictive-design
  - https://www.bitsoffreedom.nl/en/2026/03/10/the-influence-of-snapchats-gamification-features-on-young-people/
  - https://edri.org/our-work/new-study-reveals-how-young-people-are-influenced-by-gamification-features-on-snapchat/
- **R20 — Motivos do Nitro (fontes fracas, só como indício):**
  - https://www.talkandroid.com/514959-how-discord-uses-nitro-to-fuel-loyalty/
  - https://tech4gamers.com/discord-nitro-do-gamers-actually-need-the-subscription/

**Lacunas:** não há dado público sobre os itens mais vendidos do Discord Shop, a fatia de subs presenteados na Twitch nem a taxa de compra de skins na PGB 2025. Os números de conversão e ticket da §5.3 são [HIPÓTESE] até o beta medir (§4.4).
