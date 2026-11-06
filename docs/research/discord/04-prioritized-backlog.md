# 04 — Backlog priorizado

> Coordenador, 2026-11-05. Consolida [01](01-voice-of-customer.md), [02](02-product-experience-audit.md) e [03](03-competitive-opportunities.md). Cada item aponta para a evidência de origem.
> **Este backlog é recomendação de pesquisa.** Nada aqui foi implementado nem entrou no roadmap.

## Como ler

- **Prioridade:**
  - **P0** fundamental: condição para viabilidade, confiabilidade ou competitividade básica.
  - **P1** alto impacto.
  - **P2** diferenciação.
  - **P3** exploração futura.
- **Notas de 1 a 5:**
  - **Imp.** impacto esperado.
  - **Freq.** recorrência na amostra de avaliações (≥20% → 5 · 10–20% → 4 · 5–10% → 3 · 2–5% → 2 · <2% → 1). "—" = só observação de produto, sem medida de frequência.
  - **Val.** valor para o usuário.
  - **Dif.** potencial de diferenciação.
- **Conf.** confiança das evidências: baixa, média ou alta.
- **Esforço:** estimativa nossa (baixo, médio, alto ou indeterminado), não medida.
- **Horizonte:**
  - **R** = rápido: semanas, mexe em pouca coisa.
  - **E** = estrutural: meses, ou exige decisão, infraestrutura ou parecer.
- **Hoje:** estado no Alga Meet, conferido no código (03 §1).

As notas são avaliação qualitativa estruturada, não precisão estatística.

---

## P0 — Fundamental

| ID | Item | Imp. | Freq. | Val. | Dif. | Conf. | Esforço | Hor. | Hoje | Evidência |
|---|---|---|---|---|---|---|---|---|---|---|
| BL-01 | **Parecer jurídico e pacote de conformidade do ECA Digital para vídeo ao vivo**: idade aferida para tela e câmera, padrões protetivos, denúncia dentro da chamada, governança demonstrável | 5 | 2 | 5 | 5 | alta (fato regulatório) | alto | E | Parcial (idade mínima 16, T&S, LGPD) | 03 §2, CO-01, VOC-09, VOC-10 |
| BL-02 | **Mensagem que sempre chega**: estado enviando/enviado/falhou, reenvio, retomada de conexão, testes de regressão do caminho crítico | 5 | 5 | 5 | 3 | alta | médio | E | Não auditado nesta pesquisa | VOC-01 |
| BL-03 | **Voz resiliente com o jogo aberto**: tela sem derrubar o mic (teste automatizado), indicador claro de mudo ou desconectado, reconexão silenciosa | 5 | 5 | 5 | 4 | alta | alto | E | Parcial (núcleo de voz forte; o cenário do mic não foi verificado aqui) | VOC-02, PX-27, CO-02 |
| BL-04 | **Entrar pelo convite em segundos**: o convite já cria a conta, sem telefone, antiabuso invisível, erro honesto e sem loop | 5 | 5 | 5 | 4 | alta | médio | E | Parcial (e-mail, senha e nascimento; sem captcha visual) | VOC-03, PX-20, CO-03 |
| BL-05 | **Prévia da sala de voz antes de entrar**: quem está e qualidade, com "Entrar" explícito | 5 | — | 5 | 4 | alta | baixo | R | Falta (`Sidebar.tsx:209` entra direto) | OP-01, F1, CO-02 |
| BL-06 | **Sem ações implícitas**: "digitando" só com conteúdo, Esc só fecha | 3 | — | 4 | 2 | alta | baixo | R | A verificar no nosso app | OP-13, F2, F3 |
| BL-07 | **Notificação calma por padrão**: padrão adaptativo por tamanho de espaço, "9+", sem contagem no título da janela | 4 | 2 | 5 | 3 | alta | baixo | R | Falta | OP-05, F5, PX-14, PX-18, VOC-11 |
| BL-08 | **Zero comércio no chrome do app**: upsell só no ponto da limitação, sem contadores de escassez nem preço ancorado | 4 | 4 | 4 | 5 | alta | baixo (decisão) | R | A verificar na loja (trabalho do pacote C ainda não commitado) | OP-09, F7, VOC-08, CO-04 |

**Por que esses são P0:**
- **BL-02, BL-03 e BL-04** são as três maiores queixas das duas faixas de estrelas: confiabilidade 44,7%, voz 21,7% e entrada 24% das 1–2★ (01 §3).
- **BL-01** decide se o principal diferencial no Brasil pode existir.
- **BL-05 a BL-08** custam pouco e removem atritos que o Discord tem e nós já começamos a copiar. BL-05 é o caso concreto: hoje também entramos direto na voz.

## P1 — Alto impacto

| ID | Item | Imp. | Freq. | Val. | Dif. | Conf. | Esforço | Hor. | Hoje | Evidência |
|---|---|---|---|---|---|---|---|---|---|---|
| BL-09 | **Home "Agora"**: amigos e salas ativas de todos os espaços, com entrada explícita | 5 | — | 5 | 4 | alta | médio | E | Parcial ("Ativo agora" na aba Amigos, 0.1.4) | OP-03, PX-05, CO-10 |
| BL-10 | **Paleta única**: lugares, pessoas, ações **e mensagens**, com atalhos visíveis | 4 | 1 | 4 | 5 | alta | alto | E | Parcial (switcher com ações; sem busca de mensagens) | OP-02, F4, PX-02, PX-15, CO-09 |
| BL-11 | **Inbox como tela**: menções, não lidas, lembretes, com triagem por teclado | 4 | 2 | 4 | 4 | alta | médio | E | Falta | OP-04, PX-13 |
| BL-12 | **Confiança operacional**: motivo da punição com a regra e a mensagem, apelação humana com prazo, recuperação de conta em camadas, alerta de login novo | 4 | 3 | 5 | 4 | média | médio | E | Parcial (denúncia, apelação e staff existem) | VOC-04, VOC-05, PX-19, CO-08 |
| BL-13 | **Orçamento de desempenho público**: memória ociosa, CPU em call, impacto no FPS, medido a cada release | 4 | 4 | 4 | 4 | alta | médio | E | Parcial (benchmark interno propõe ≤ 1/3 do Discord) | VOC-07, CO-06 |
| BL-14 | **Estabilidade de interface**: densidade compacta ou confortável, mudanças grandes atrás de opção | 4 | 4 | 4 | 4 | alta | médio | E | Parcial (direção Linear) | VOC-06, PX-01, CO-05 |
| BL-15 | **Molde de espaço que configura tudo**: canais, voz, notificação padrão e cargos simples, mais mensagem de convite pronta para WhatsApp | 4 | — | 4 | 4 | média | baixo | R | A verificar (`features/onboarding`) | OP-07, PX-20 |
| BL-16 | **Meta de grupo finita na Casa** ("faltam N para…"), sem insígnia de gasto | 4 | 2 | 3 | 4 | alta | médio | R | A verificar (Casa existe) | OP-10, PX-22 |
| BL-17 | **Configurações com padrões fortes**: ≤ ~8 controles visíveis por seção, "Avançado" recolhido, checagem de mic antes da voz | 4 | — | 4 | 3 | alta | médio | E | A verificar | OP-11, PX-16, PX-27 |
| BL-18 | **Acessibilidade no onboarding** e respeito ao SO desde o boot | 3 | 1 | 4 | 3 | alta | baixo | R | Parcial (auditoria de acessibilidade feita) | OP-12, PX-26 |
| BL-19 | **Segurança visível fora do vídeo**: DMs de desconhecidos fechadas para 16–17 anos, denúncia sem exigência de assinatura, explicação em linguagem simples | 5 | 2 | 4 | 4 | média | médio | E | Parcial (`docs/legal/review-notes.md` L10: DM aberta por padrão) | VOC-10 |
| BL-20 | **Notificações confiáveis no Windows**: chamadas de amigos priorizadas, DND real, "por que não fui notificado?" | 4 | 2 | 4 | 3 | média | médio | E | Parcial | VOC-11 |

## P2 — Diferenciação

| ID | Item | Imp. | Freq. | Val. | Dif. | Conf. | Esforço | Hor. | Hoje | Evidência |
|---|---|---|---|---|---|---|---|---|---|---|
| BL-21 | **Seguir canais por padrão** em espaços grandes, com sugestão de deixar de seguir | 4 | — | 4 | 4 | alta | médio | E | Falta | OP-06, PX-09, CO-14 |
| BL-22 | **Primitivas nativas de comunidade**: ícone e cor de canal, contador de membros, armadilha antispam | 3 | — | 4 | 4 | alta | médio | E | Falta | OP-08, F8, CO-13 |
| BL-23 | **Mensagens de voz** com fila e velocidade 1,5×/2× | 3 | 1 | 4 | 4 | média | médio | E | Falta | VOC-13, CO-11 |
| BL-24 | **Boas-vindas agrupadas** ("3 chegaram hoje — acenar para todos") | 3 | — | 3 | 3 | média | baixo | R | A verificar | OP-14, PX-10 |
| BL-25 | **Cosméticos com intensidade contextual**: calmos em listas, expressivos no popout | 3 | 2 | 3 | 4 | média | baixo | R | A verificar | OP-15, PX-12 |
| BL-26 | **Política curta de privacidade e IA** ("não treinamos IA com suas mensagens", "não guardamos documento") | 4 | 2 | 4 | 4 | baixa–média | baixo | R | Parcial (Política em rascunho) | VOC-14 |
| BL-27 | **Várias contas** previstas no modelo de dados | 3 | 1 | 3 | 3 | média | médio | E | Falta | VOC-12, CO-12 |

## P3 — Exploração futura

| ID | Item | Por que P3 | Evidência |
|---|---|---|---|
| BL-28 | Admin transparente (seções bloqueadas visíveis, com "peça a um admin") | Impacto baixo; a auditoria não viu o editor de cargos | OP-16, PX-17, F10 |
| BL-29 | Descoberta local no Brasil (cidade, faculdade, jogo + região) | Depende de massa crítica e de moderação de catálogo | OP-17, PX-21 |
| BL-30 | Ganhar cosméticos sem anúncio (presente de amigo, conquistas) | Valor incerto; risco de virar "comércio" | VOC-15, PX-23 |

---

## Rápidos × estruturais

**Rápidos (R), em ordem sugerida:**
1. **BL-05** prévia da sala.
2. **BL-07** notificação calma.
3. **BL-06** sem ações implícitas.
4. **BL-08** auditoria anticomércio da nossa loja.
5. **BL-15** molde que configura tudo e convite para WhatsApp.
6. **BL-16** meta finita da Casa.
7. **BL-18** acessibilidade no onboarding.
8. **BL-24** e **BL-25** boas-vindas agrupadas e cosméticos com intensidade contextual.
9. **BL-26** política curta de privacidade e IA.

Juntos, mudam a sensação do app sem infraestrutura nova.

**Estruturais (E):**
- **Antes de divulgar transmissão:** BL-01.
- **Base para o grupo migrar:** BL-02, BL-03, BL-04 e BL-13.
- **Velocidade e calma:** BL-09, BL-10 (exige índice de mensagens) e BL-11.
- **Confiança:** BL-12 e BL-19.

## Dependências e riscos

| Item | Depende de | Risco |
|---|---|---|
| BL-01 | Advogado; decisão sobre E2EE em transmissões de espaço | Prometer "dá pra transmitir" antes do parecer convida a mesma medida da ANPD |
| BL-04 | Antiabuso invisível (sinais de risco) e verificação de idade compatível com BL-01 | Cadastro fácil demais atrai abuso; o ECA Digital exige aferição de idade |
| BL-10 | Índice full-text de mensagens; com E2EE, busca **só local** | Busca no servidor é incompatível com E2EE nas DMs |
| BL-09 | Presença agregada por espaço no servidor | Privacidade: respeitar invisível e bloqueios (já feito na 0.1.4) |
| BL-12 | Operação humana de suporte | Custo recorrente |
| BL-16 | Decisão de preço da Casa | Meta mal calibrada vira pressão de compra |

## Fora do backlog (não recomendado)

- **Não implementar:** Quests e Orbs (anúncio gamificado), escassez artificial na loja, insígnia por gasto, "visto/lido" em servidores. Ver 03 §5.
- **Não copiar:** marca, mascote, fonte, paleta e nomes de produto do Discord (02 §7).
