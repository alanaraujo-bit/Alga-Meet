# Discord: voz do cliente (avaliações públicas)

> Agente 01 da pesquisa competitiva. Coleta e análise feitas em 2026-11-05.
> Escopo: o que usuários dizem do Discord nas lojas de apps. Pergunta central: **o que faz alguém gostar do Discord e, mesmo assim, desejar uma alternativa melhor?**
>
> **Como ler este documento**
> - **[FATO]**: dado observado na fonte (contagem, data, texto da avaliação).
> - **[OPINIÃO]**: o que o usuário afirma. Não foi verificado como verdade técnica.
> - **[HIPÓTESE]**: inferência nossa, com o motivo.
> - **[RECOMENDAÇÃO]**: o que sugerimos ao Alga Meet.
>
> Todas as porcentagens valem **só para a nossa amostra**, que foi estratificada por estrelas de propósito. Elas não representam a base de usuários do Discord.
>
> **Ponteiros de evidência:** `pt:L205` = linha 205 de `docs/private/research/discord/play-ptbr.jsonl`. `en:` = `play-enus.jsonl`. `ap:` = `appstore.jsonl`. A pasta é git-ignored (o repositório é público) e não guarda nomes nem avatares. Fonte pública de todas as linhas `pt:`/`en:`: https://play.google.com/store/apps/details?id=com.discord

---

## Resumo em 10 linhas

1. **[FATO]** Analisamos **1.699 avaliações**: 1.169 do Google Play em pt-BR, 480 do Play em inglês (EUA) e 50 da App Store Brasil.
2. **[FATO]** Nas avaliações de 1–2★ em pt-BR, **44,7%** citam confiabilidade básica: travamento, bugs, mensagem que não envia ou piora após atualização.
3. **[FATO]** O retrato **de agora** (1–2★ de 14/out a 04/nov/2026) é outro. O maior problema é **entrar no app**: 22% citam o loop do "confirme que você é humano" no cadastro e 17% citam login, verificação ou recuperação.
4. **[FATO]** As chamadas de voz são, ao mesmo tempo, a **maior reclamação técnica** (21,7% das 1–2★ pt-BR) e o **maior motivo de amor** ("call com os amigos enquanto jogo").
5. **[FATO]** Em 32,8% das 3★ pt-BR o texto abre com elogio e depois vem um "mas/porém". É o perfil "gosto, mas…".
6. **[FATO]** Há temas novos de 2026, específicos do Brasil: retirada do compartilhamento de tela e da câmera (usuários culpam lei/governo; a causa não foi verificada aqui), banimentos em massa por "estar no servidor errado", e verificação de idade por IA ou documento.
7. **[OPINIÃO]** Quem dá 1★ raramente odeia o *conceito*. Odeia a *execução*: atualização que quebra o que funcionava, paywall (Nitro) em coisas básicas e suporte que responde com robô.
8. **[HIPÓTESE]** O que prende o usuário é a rede: os amigos e servidores estão lá. Ninguém elogia o app em si. Qualquer alternativa precisa **trazer o grupo inteiro** e não pode exigir que cada pessoa troque sozinha.
9. **[RECOMENDAÇÃO]** P0 para o Alga Meet: confiabilidade de mensagem e de voz, e cadastro sem atrito. São condições para existir, não diferenciais.
10. **[RECOMENDAÇÃO]** Os maiores diferenciais possíveis: tier grátis generoso (sem paywall em arquivo e qualidade), moderação com apelação humana, cliente leve e mudanças de UI que respeitem o hábito.

---

## 1. Método e amostra

### 1.1 Fontes e números reais

| Fonte | Idioma / país | Estrato | 1★ | 2★ | 3★ | 4★ | 5★ | Total | Período das avaliações |
|---|---|---|---|---|---|---|---|---|---|
| Google Play | pt_BR / BR | Mais recentes | 200 | 150 | 150 | 100 | 100 | 700 | 2026-07-25 a 2026-11-04 |
| Google Play | pt_BR / BR | Mais relevantes | 150 | 100 | 100 | 60 | 60 | 470 | 2018-12-20 a 2026-09-17 |
| **Play pt-BR (únicas)** | | | **350** | **249** | **250** | **160** | **160** | **1.169** | 2018-12-20 a 2026-11-04 |
| Google Play | en / US | Mais recentes | 80 | 60 | 60 | 40 | 40 | 280 | 2026-10-28 a 2026-11-04 |
| Google Play | en / US | Mais relevantes | 60 | 40 | 40 | 30 | 30 | 200 | 2018-10-20 a 2026-09-19 |
| **Play en-US (únicas)** | | | **140** | **100** | **100** | **70** | **70** | **480** | 2018-10-20 a 2026-11-04 |
| App Store (RSS público) | BR | Mais recentes, página 1 | 15 | 3 | 5 | 3 | 24 | **50** | 2026-09-09 a 2026-11-03 |
| Comunidade de feedback do Discord | — | — | — | — | — | — | — | **0 (sem acesso, ver §2)** | — |

O estrato pt-BR somou 1.170 coletas: houve 1 avaliação duplicada entre "recentes" e "relevantes".

**Contexto da loja [FATO]** (página do Play em 2026-11-05, filtro "Telefone"): 6,73 mi de avaliações no histograma. 5★ = 5.540.720, 4★ = 407.630, 3★ = 180.912, 2★ = 90.920, 1★ = 505.315. A distribuição é **polarizada**: há 5,6× mais 1★ que 2★. Na App Store BR: 4,80 de média com 287.863 notas (API pública `itunes.apple.com/lookup?id=985746746`, que confirma o id do app Discord).

### 1.2 Como coletamos

- Abrimos o diálogo "Ver todas as avaliações" no navegador embutido, sem login. O diálogo oferece três filtros: dispositivo (Telefone), ordem (Mais relevantes / Mais recentes) e nota (1–5). Ou seja, **o filtro por estrela existe**.
- O diálogo carrega as avaliações pela chamada pública `batchexecute` (RPC `UsvDTd`). Rolar o diálogo trazia ~20 avaliações por vez, o que tornava inviável chegar a 1.600. Por isso, repetimos **a mesma chamada** fora do navegador, com os mesmos filtros de ordem e nota. Conferimos que o primeiro card visível no diálogo (1★, 17/set/2026, 538 "útil") é idêntico à linha `pt:L201`.
- Campos guardados: estrelas, data, texto completo, contagem "útil", se o desenvolvedor respondeu (e quando), versão do app e as tags de qualidade do próprio Play quando existem. **Não guardamos** nome, avatar, id do usuário nem id da avaliação (só um hash curto para deduplicar).
- Critério de seleção: prioridade para 1–2★ (mais volume), 3★ (críticas construtivas) e 4–5★ (motivos de gostar). Em cada nota coletamos os dois estratos, "recentes" (o estado atual) e "relevantes" (o que a comunidade mais validou com "útil").

### 1.3 Como codificamos

- **Leitura manual:** lemos 404 avaliações (trechos de 230–300 caracteres): as 160 mais "úteis" de pt-BR por estrela, 155 recentes pt-BR sorteadas por estrela e 89 en-US. Dessa leitura saiu o livro de códigos.
- **Codificação multi-rótulo por dicionário** (pt + en, expressões regulares): 29 temas de problema, 9 de valor percebido e 4 sinais ("elogio + mas", "antes era melhor", "cita alternativa", "inutilizável"). O script está no scratchpad da sessão. O resultado por linha está em `docs/private/research/discord/coded.jsonl`.
- **Validação:** para 17 temas sorteamos 8 casos cada e conferimos à mão.
  - A maioria acertou 7 ou 8 de 8.
  - Exceções: `nitro_paywall` acertou 5/8 (pega menções neutras, como "comprei Nitro"). `age_id_verification` acertou 4/8 como *reclamação de verificação*, porque metade **pede mais** controle de idade. `child_safety` acertou 6/8.
  - "Comunidades/servidores" é **menção**, não elogio. Por isso só usamos esse tema como "valor" em 4–5★.
- **Saturação:** em ordem aleatória, 90% dos temas de problema já tinham ≥3 ocorrências na avaliação nº 223 (pt) e nº 208 (en). Todos os temas que chegam a 3 ocorrências chegaram até a nº 586 (pt, 27 de 29 temas) e a nº 362 (en, 24 de 29).
  - Na leitura manual, a ordem "relevantes" parou de trazer temas novos por volta da 120ª avaliação.
  - **Mas o estrato "recentes" revelou temas que não apareciam nos "relevantes"**: loop de captcha, retirada de tela e câmera no Brasil, banimento por IA. Portanto, a saturação depende do estrato. Ela foi atingida dentro de cada estrato, não no conjunto.

---

## 2. Limitações

| # | Limitação | Efeito no resultado |
|---|---|---|
| L1 | A amostra é **estratificada por estrela**, não proporcional. Na loja, ~82% das notas são 5★. Na amostra são 14%. | As % valem só dentro da amostra e de cada faixa de estrela. Não extrapolar. |
| L2 | "Mais relevantes" favorece textos antigos e longos (2019–2024). "Mais recentes" cobre poucas semanas, porque o volume é alto: as 200 recentes de 1★ pt-BR cobrem só de 14/out a 04/nov/2026. | **Buraco de 2025 a meados de 2026**: só 13 avaliações de 1–3★ pt-BR nesse período. Não dá para medir tendência nesse intervalo. |
| L3 | As avaliações recentes são curtas (287 pt-BR com menos de 60 caracteres) e muitas parecem de crianças e adolescentes (Roblox, Free Fire). | Pesam mais em cadastro e login. Têm pouco detalhe técnico. |
| L4 | O Play é **mobile**. O Alga Meet começa no **desktop Windows**. | As queixas de bateria, gestos Android e áudio do celular só se transferem como princípio, não como requisito literal. |
| L5 | Codificação por dicionário. | O recall é imperfeito: 287 avaliações pt-BR e 145 en-US não caíram em nenhum tema de problema (muitas são só elogio). A precisão foi validada por amostra, não por completo. |
| L6 | O filtro `hl=pt_BR` traz algumas avaliações em inglês e espanhol (ex.: `pt:L908`, `pt:L942`). | Pouco efeito. Foram mantidas. |
| L7 | App Store: o RSS público só devolveu a página 1 do Brasil. As páginas 2–10 do BR e todas as dos EUA vieram vazias (testamos 4 variações de URL). | Só 50 avaliações iOS. Nenhum número iOS deve ser lido como tendência. |
| L8 | A comunidade de feedback do Discord (`support.discord.com/hc/en-us/community/topics/360000029731`) e posts antigos dela **redirecionam para a home da Central de Ajuda**. A API `api/v2/community/topics.json` devolve 0 tópicos. | **Sem dados de votos de pedidos de recurso.** Esta seção não foi examinada. |
| L9 | Não amostramos espanhol (`hl=es`) por limite de tempo. | Sem visão LATAM fora do Brasil. |
| L10 | Guardamos só *se* o desenvolvedor respondeu, não o texto da resposta. As 2 respostas vistas no navegador eram modelos genéricos ("reinstale, limpe o cache, acesse dis.gd/contact"). | O teor das respostas é observação qualitativa (n=2). |
| L11 | Em 24% das avaliações pt-BR a versão do app vem vazia. | A análise por versão ficou fraca. Usamos a data. |

---

## 3. Frequência dos temas (na amostra)

### 3.1 Problemas: Play pt-BR (N=1.169; 1–2★ n=599; 3★ n=250; 4–5★ n=320)

| Tema | Total | 1–2★ | 3★ | 4–5★ |
|---|---|---|---|---|
| Bugs (genérico) | 267 (22,8%) | 168 (28,0%) | 62 (24,8%) | 37 (11,6%) |
| Chamadas / áudio / microfone | 248 (21,2%) | 130 (21,7%) | 61 (24,4%) | 57 (17,8%) |
| Travamento / crash / "não abre" | 151 (12,9%) | 98 (16,4%) | 36 (14,4%) | 17 (5,3%) |
| "Piorou depois da atualização" | 144 (12,3%) | 105 (17,5%) | 30 (12,0%) | 9 (2,8%) |
| Login / verificação / recuperação | 117 (10,0%) | 81 (13,5%) | 19 (7,6%) | 17 (5,3%) |
| Desempenho / bateria / peso | 110 (9,4%) | 62 (10,4%) | 21 (8,4%) | 27 (8,4%) |
| Cadastro / captcha | 104 (8,9%) | 87 (14,5%) | 11 (4,4%) | 6 (1,9%) |
| UI / redesign / navegação | 100 (8,6%) | 65 (10,9%) | 19 (7,6%) | 16 (5,0%) |
| Compartilhar tela / vídeo / câmera | 98 (8,4%) | 42 (7,0%) | 26 (10,4%) | 30 (9,4%) |
| Nitro / pagar (menção) | 89 (7,6%) | 40 (6,7%) | 20 (8,0%) | 29 (9,1%) |
| Enviar mensagem / mídia falha | 81 (6,9%) | 51 (8,5%) | 16 (6,4%) | 14 (4,4%) |
| Anúncios / Quests / Orbs | 65 (5,6%) | 28 (4,7%) | 19 (7,6%) | 18 (5,6%) |
| Perfil / cosméticos | 58 (5,0%) | 23 (3,8%) | 13 (5,2%) | 22 (6,9%) |
| Paridade mobile × desktop | 56 (4,8%) | 23 (3,8%) | 15 (6,0%) | 18 (5,6%) |
| Suporte que não resolve | 47 (4,0%) | 38 (6,3%) | 4 (1,6%) | 5 (1,6%) |
| Privacidade / IA / dados | 41 (3,5%) | 26 (4,3%) | 8 (3,2%) | 7 (2,2%) |
| Notificações | 31 (2,7%) | 17 (2,8%) | 4 (1,6%) | 10 (3,1%) |
| Banimento / suspensão | 30 (2,6%) | 21 (3,5%) | 6 (2,4%) | 3 (0,9%) |
| Tela / câmera retiradas no Brasil | 29 (2,5%) | 11 (1,8%) | 12 (4,8%) | 6 (1,9%) |
| Segurança infantil / abuso | 27 (2,3%) | 11 (1,8%) | 10 (4,0%) | 6 (1,9%) |
| Verificação de idade / documento | 24 (2,1%) | 9 (1,5%) | 10 (4,0%) | 5 (1,6%) |
| Várias contas | 22 (1,9%) | 8 (1,3%) | 6 (2,4%) | 8 (2,5%) |
| Mensagens de voz ("áudios") | 21 (1,8%) | 11 (1,8%) | 7 (2,8%) | 3 (0,9%) |
| Call cai em segundo plano / ao abrir jogo | 21 (1,8%) | 16 (2,7%) | 3 (1,2%) | 2 (0,6%) |
| Conta hackeada / golpe | 16 (1,4%) | 10 (1,7%) | 3 (1,2%) | 3 (0,9%) |
| Limite de tamanho de arquivo | 12 (1,0%) | 4 (0,7%) | 6 (2,4%) | 2 (0,6%) |
| Busca / descoberta | 10 (0,9%) | 7 (1,2%) | 1 (0,4%) | 2 (0,6%) |
| Acessibilidade | 2 (0,2%) | 1 | 0 | 1 |

**Agrupamentos [FATO]** (1–2★ pt-BR, n=599):
- **Confiabilidade** (bugs, crash, mensagem, atualização): 268 (44,7%).
- **Acesso** (cadastro ou login): 144 (24,0%).
- **Confiança** (ban, suporte, hack): 57 (9,5%).

### 3.2 Problemas: Play en-US (N=480; 1–2★ n=240; 3★ n=100; 4–5★ n=140), destaques

| Tema | Total | 1–2★ | 3★ | 4–5★ |
|---|---|---|---|---|
| Chamadas / áudio | 69 (14,4%) | 26 (10,8%) | 15 (15,0%) | 28 (20,0%) |
| Nitro / pagar | 62 (12,9%) | 36 (15,0%) | 18 (18,0%) | 8 (5,7%) |
| Login / verificação | 51 (10,6%) | 37 (15,4%) | 8 (8,0%) | 6 (4,3%) |
| Bugs (genérico) | 50 (10,4%) | 30 (12,5%) | 13 (13,0%) | 7 (5,0%) |
| UI / redesign | 41 (8,5%) | 30 (12,5%) | 6 (6,0%) | 5 (3,6%) |
| Travamento / crash | 39 (8,1%) | 28 (11,7%) | 7 (7,0%) | 4 (2,9%) |
| Perfil / cosméticos | 39 (8,1%) | 16 (6,7%) | 12 (12,0%) | 11 (7,9%) |
| Notificações | 30 (6,2%) | 17 (7,1%) | 5 (5,0%) | 8 (5,7%) |
| Cadastro / captcha | 15 (3,1%) | 13 (5,4%) | 1 | 1 |
| Privacidade / IA / dados | 16 (3,3%) | 11 (4,6%) | 2 | 3 |

**[FATO]** Diferenças em relação ao Brasil:
- Em inglês, **monetização** (15% das 1–2★) e **notificações** (6,2%) pesam mais.
- Em pt-BR pesam mais **chamadas**, **cadastro/captcha** e **mensagens de voz**. "Áudios" no estilo WhatsApp aparecem 21 vezes em pt e 2 em en.
- A retirada de tela e câmera aparece só no Brasil.

### 3.3 Retrato atual × histórico (1–2★)

| Estrato | n | Os 5 temas mais citados |
|---|---|---|
| pt-BR **recentes** (jul–nov/2026) | 350 | cadastro/captcha 77 (22%) · login/verificação 59 (17%) · bugs 47 (13%) · chamadas 31 (9%) · suporte 21 (6%) |
| pt-BR **relevantes** (2019–2026) | 250 | bugs 121 (48%) · "piorou após atualização" 100 (40%) · chamadas 100 (40%) · crash 84 (34%) · UI/redesign 57 (23%) |
| en-US **recentes** (out–nov/2026) | 140 | login/verificação 25 (18%) · tela/vídeo 11 · Nitro 11 · cadastro 10 · bugs 10 |
| en-US **relevantes** (2024–2026) | 100 | Nitro 25 · UI/redesign 24 · crash 20 · bugs 20 · chamadas 19 |

**[HIPÓTESE]** As avaliações "relevantes" mostram a **dor acumulada de quem já usa** (regressões e voz). As "recentes" mostram a **dor de quem está chegando** (porta de entrada). Um concorrente precisa vencer as duas.

### 3.4 Linha do tempo (pt-BR, 1–3★; n por período: ≤2021=72, 2022=94, 2023=79, 2024=73, 2026 S2=518)

| Tema | ≤2021 | 2022 | 2023 | 2024 | 2026 S2 |
|---|---|---|---|---|---|
| "Piorou após atualização" | 12% | **62%** | 43% | 33% | 2% |
| UI / redesign | 4% | 26% | **33%** | 26% | 3% |
| Crash / travamento | 39% | 40% | 34% | 25% | 4% |
| Chamadas / áudio | **62%** | 32% | 38% | 45% | 14% |
| Mensagem / mídia não envia | 7% | 18% | 23% | 18% | 2% |
| Mensagens de voz | 0% | 0% | 13% | 7% | 1% |
| Cadastro / captcha | 0% | 3% | 1% | 1% | **18%** |
| Tela / câmera retiradas no BR | 0% | 0% | 1% | 3% | 4% |

**[FATO]** As ondas que aparecem nos textos:
- **ago/2022**: novo app mobile ("design por slide", emojis gigantes, transmissão que fecha). Exemplos: `pt:L574`, `pt:L501`, `pt:L515`.
- **dez/2023**: redesign mobile. DMs mudaram de lugar, interface "poluída", imagens não enviam. Exemplos: `pt:L205` (2.484 "útil"), `pt:L327`, `pt:L330`.
- **set/2024**: microfone para ao compartilhar tela (`pt:L234`, `pt:L765`, `pt:L272`).
- **2025–2026** (en-US): UI "quadrada" e cores (`en:L204`, `en:L329`, `pt:L908`), troca do fornecedor de GIF (`pt:L753`).
- **ago–nov/2026** (BR): loop de captcha, retirada de tela e câmera, banimentos.

**Persistentes:** queda e mudez em chamadas e travamento atravessam todos os períodos com amostra suficiente.

**Cuidado:** a queda de % em 2026 S2 reflete em grande parte L3 (textos curtos). Não significa que o problema sumiu.

---

## 4. Itens VOC

### 4.1 Tabela-resumo

Frequência = % na amostra (pt-BR 1–2★ salvo indicação). Notas de 1 a 5. Esforço = **estimativa nossa** para o Alga Meet.

| ID | Problema / oportunidade | Freq. na amostra | Impacto | Freq. | Valor | Difer. | Confiança | Esforço (estim.) | Prioridade |
|---|---|---|---|---|---|---|---|---|---|
| VOC-01 | Confiabilidade: mensagem, mídia e app que não quebram a cada update | 44,7% (268/599) | 5 | 5 | 5 | 3 | alta | alto | **P0** |
| VOC-02 | Chamadas que não caem nem emudecem, inclusive com jogo ou outro app aberto | 21,7% (130/599) | 5 | 5 | 5 | 4 | alta | alto | **P0** |
| VOC-03 | Cadastro e login sem loop, captcha quebrado ou SMS que não chega | 24,0% (144/599); 39% das recentes | 5 | 4 | 5 | 3 | alta | médio | **P0** |
| VOC-04 | Recuperação de conta e suporte humano de verdade | 9,5% (57/599, grupo confiança) | 4 | 3 | 5 | 4 | média | médio | **P1** |
| VOC-05 | Moderação justa: sem ban coletivo ou por IA sem apelação | 3,5% ban; 18 casos de "ban por servidor" | 5 | 2 | 4 | 5 | média | médio | **P1** |
| VOC-06 | Mudanças de UI que respeitam o hábito, com opção de layout e densidade | 10,9% (65/599) | 4 | 4 | 4 | 4 | alta | médio | **P1** |
| VOC-07 | Cliente leve (memória, bateria, máquinas fracas) | 10,4% (62/599) | 4 | 3 | 4 | 4 | alta | alto | **P1** |
| VOC-08 | Tier grátis generoso; paywall fora do básico; sem "dark pattern" de presente | pt 6,7% · en **15,0%** (36/240) | 4 | 3 | 5 | 5 | alta | baixo (decisão) | **P1** |
| VOC-09 | Ver filme e jogar junto: tela e câmera disponíveis no Brasil | 2,5% pt total; concentrado em ago–nov/2026 | 4 | 2 | 5 | 5 | média | indeterminado (jurídico) | **P2** |
| VOC-10 | Segurança infantil visível, com verificação de idade de baixo atrito | 2,3% + 2,1% | 5 | 2 | 4 | 4 | média | alto | **P1** |
| VOC-11 | Notificações confiáveis, com "não perturbe" que funciona | pt 2,7% · en 6,2% | 4 | 2 | 4 | 3 | média | médio | **P1** |
| VOC-12 | Paridade entre dispositivos e várias contas | 4,8% + 1,9% | 3 | 2 | 3 | 3 | média | médio | **P2** |
| VOC-13 | Mensagens de voz no estilo WhatsApp (BR) | 1,8% (21 pt × 2 en) | 3 | 2 | 4 | 4 | média | médio | **P2** |
| VOC-14 | Privacidade e IA: transparência sobre dados, documentos e treino | en 4,6% (11/240) | 4 | 2 | 4 | 4 | baixa–média | baixo–médio | **P2** |
| VOC-15 | Quests, Orbs e anúncios: economia de recompensa (não copiar) | 5,6% total, sentimento misto | 2 | 2 | 2 | 3 | média | — | **P3** |

### 4.2 Detalhe por item

#### VOC-01 · Confiabilidade básica: "atualizou e quebrou"
1. **Descrição [FATO]:** o app trava, fecha sozinho ou deixa mensagens "enviando" para sempre. Imagens e vídeos não sobem, e cada versão traz bugs novos.
2. **Queixa ou pedido [OPINIÃO]:**
   - "Parem de atualizar."
   - "Tenho medo de atualizar" (`pt:L529`, 2★, 541 "útil").
   - Precisam fechar e reabrir o app para a mensagem sair (`pt:L867`, `en:L143`, `en:L381` 4★ com 5.412 "útil").
3. **Por que dói:** a mensagem é o contrato mínimo de um app de chat. Falhar nela gera desconfiança: "será que meu amigo recebeu?".
4. **Frequência:** 268/599 (44,7%) das 1–2★ pt-BR. 66/240 (27,5%) das 1–2★ en-US. "Piorou após atualização" sozinho: 105/599 (17,5%).
5. **Severidade:** alta. "Inutilizável" aparece em 57/599 (9,5%).
6. **Perfil:** usuário antigo ("uso desde 2018/2019"), mobile, Android intermediário.
7. **Solução [RECOMENDAÇÃO]:** fila de envio com estado explícito (enviando → enviado → falhou + reenviar); retomada automática da conexão; testes de regressão do caminho crítico (enviar texto, imagem e áudio; entrar na call); canal beta opcional e *rollback* rápido.
8. **Valor competitivo:** não diferencia no marketing, mas a falha **mata a retenção**. É a pré-condição para alguém migrar o grupo.
9. **Prioridade:** P0.
10. **Evidências:** `pt:L205` (1★, 2024-01-04, 2.484 "útil"), `pt:L204`, `pt:L534` (2★, 1.133 "útil"), `pt:L574`, `pt:L332`, `en:L114` (1★, 2026-07-22, 5.526 "útil"), `en:L143`, `en:L381`.

#### VOC-02 · Chamadas de voz: queda, mudez e briga com o jogo
1. **Descrição [FATO]:** reclamações recorrentes:
   - a call fica muda e só volta saindo e entrando de novo;
   - a call cai ao abrir um jogo ou ir para outro app;
   - o áudio vai para o modo "ligação" (viva-voz e Bluetooth viram qualidade de chamada) e o som do jogo fica abafado;
   - o microfone para ao compartilhar a tela.
2. **Queixa ou pedido:** "preciso escolher entre ficar na call ou jogar" (`pt:L402`). Chamadas caem com 3 celulares Motorola diferentes (`pt:L361`). O áudio é reduzido a qualidade de chamada sem como mudar (`en:L326`).
3. **Por que dói:** o uso principal citado é **call com amigos enquanto jogam**. Se a voz falha, o motivo de existir do app some.
4. **Frequência:** chamadas/áudio em 130/599 (21,7%) das 1–2★ pt e 61/250 (24,4%) das 3★. Subtemas: call cai em segundo plano ou ao abrir jogo (21 pt), rota de áudio e volume do jogo (16 pt + 4 en), microfone morre ao compartilhar tela (9 pt, 2021–2024).
5. **Severidade:** alta. Em 4★ com milhares de "útil" (`pt:L966` 3.279, `pt:L956` 2.144), o único defeito citado é a voz.
6. **Perfil:** jogador mobile (Free Fire, Roblox), celular Android intermediário. Também quem usa Bluetooth.
7. **Solução [RECOMENDAÇÃO]:** no desktop Windows, o equivalente é não brigar com o jogo. Isso significa:
   - processo de voz resiliente;
   - nenhum "ducking" agressivo imposto;
   - escolha explícita de dispositivo, com troca a quente;
   - indicador claro de "você está mudo ou desconectado";
   - reconexão silenciosa;
   - compartilhar tela **sem** derrubar o microfone (teste automatizado).
8. **Valor competitivo:** alto. Voz estável com o jogo aberto é a promessa central do produto.
9. **Prioridade:** P0.
10. **Evidências:** `pt:L272` (1★, 1.245 "útil"), `pt:L208`, `pt:L229`, `pt:L211`, `pt:L966`, `pt:L956`, `pt:L361`, `pt:L651`, `pt:L61` (2026), `en:L86` (4.141 "útil"), `en:L87` (2.758), `en:L326`.

#### VOC-03 · Porta de entrada: cadastro, captcha, SMS e login
1. **Descrição [FATO]:** no cadastro, depois do "confirme que você é humano", o app volta ao e-mail em loop. Há relatos de 10, 20 e até 130 tentativas (`pt:L182`). O código por SMS não chega. O app pede telefone a quem não tem chip. O login volta para a tela inicial.
2. **Queixa ou pedido:** entrar com a conta Google (`pt:L6`, `pt:L102`); não depender do número de telefone (`pt:L88`, `pt:L154`).
3. **Por que dói:** é o **primeiro minuto** do produto. Quem não entra não chega a ver nenhuma qualidade.
4. **Frequência:**
   - Acesso total: 144/599 (24,0%) das 1–2★ pt; 48/240 (20,0%) en.
   - **Nas 1–2★ recentes pt (n=350): cadastro/captcha 77 (22%), login 59 (17%).**
   - Loop de captcha: 50 pt, 9 en, 1 iOS. Telefone/SMS: 25 pt, 17 en.
5. **Severidade:** alta para aquisição. Muitos dão 1★ sem nunca ter usado o app.
6. **Perfil:** novo usuário, frequentemente criança ou adolescente vindo de Roblox ou Free Fire. Também quem reinstalou ou trocou de celular.
7. **Solução [RECOMENDAÇÃO]:** cadastro por convite de amigo com link mágico por e-mail ou login social (Google); antiabuso **invisível** (sinais de risco) em vez de desafio visual; nunca exigir telefone para o uso básico; mensagem de erro honesta, sem loop.
8. **Valor competitivo:** alto em aquisição. "Entrei em 20 segundos pelo convite do meu amigo" é um argumento de migração em grupo.
9. **Prioridade:** P0.
10. **Evidências:** `pt:L15`, `pt:L152`, `pt:L182`, `pt:L86`, `pt:L6`, `pt:L88`, `pt:L486`, `pt:L202`, `en:L113`, `en:L224`, `en:L37`, `ap:L19`.

#### VOC-04 · Recuperar a conta e falar com um humano
1. **Descrição [FATO]:** quem perde o 2FA ao trocar de celular, é hackeado ou não recebe o e-mail de redefinição fica sem saída. O suporte responde com mensagem automática ou bot.
2. **Queixa ou pedido:** "o suporte só manda mensagem automática" (`pt:L359`). Ticket fechado sem resolver (`en:L111`). Pedidos explícitos de segurança contra invasão (`pt:L194`).
3. **Por que dói:** a conta carrega anos de amizades e servidores. Perdê-la é perder a rede social.
4. **Frequência:** suporte que não resolve em 38/599 (6,3%); conta hackeada em 16 pt; 2FA ou recuperação em 15 pt. Grupo confiança: 57/599 (9,5%). **[FATO]** O Discord respondeu 269 de 350 avaliações 1★ pt (77%), mas as respostas observadas eram modelos.
5. **Severidade:** muito alta por pessoa, frequência média.
6. **Perfil:** usuários de longa data. Também quem pagou Nitro ("perdi o benefício", `pt:L1`).
7. **Solução [RECOMENDAÇÃO]:** recuperação em camadas (códigos de backup lembrados de forma ativa, contato de confiança, verificação por amigos do servidor); alerta de login novo com "não fui eu"; suporte humano com prazo para casos de conta.
8. **Valor competitivo:** alto e barato de comunicar ("aqui você fala com gente").
9. **Prioridade:** P1.
10. **Evidências:** `pt:L359`, `pt:L380`, `pt:L383`, `pt:L194`, `pt:L566` (2★, 2021), `pt:L1`, `en:L111`, `ap:L15`. Contraexemplo positivo: `pt:L1105` (5★, recuperou a conta em 1 semana).

#### VOC-05 · Banimento coletivo e moderação automática sem apelação
1. **Descrição [FATO]:** contas são banidas por terem entrado num servidor que depois foi banido ("ban por associação"). A "IA de segurança" suspende e revoga dezenas de vezes (`pt:L358`: 82 revogações num dia). Um usuário relata suspensão no primeiro dia (`en:L7`). A apelação é respondida por bot.
2. **Queixa ou pedido:** punir o infrator, não quem estava no servidor (`pt:L449`, `pt:L460`). Um usuário pede que ninguém compre nada no app, porque a conta pode ser limitada por erro de outros (`pt:L335`).
3. **Por que dói:** é punição sentida como injusta e sem defesa. Gera raiva pública e destrói o investimento (Nitro, histórico).
4. **Frequência:** ban/suspensão em 21/599 (3,5%) das 1–2★ pt. "Ban por servidor" em 15 pt e 3 en. Moderação por IA em 5 pt e 2 en, **todos em 2026**.
5. **Severidade:** muito alta por pessoa, frequência baixa. **Não** merece P0 só pela ênfase.
6. **Perfil:** quem entra em servidores públicos grandes, frequentemente jovem.
7. **Solução [RECOMENDAÇÃO]:** ações proporcionais e individuais; explicar qual regra foi violada e em qual mensagem; apelação com revisão humana e prazo; não punir só por pertencer a um servidor.
8. **Valor competitivo:** alto como mensagem de confiança. Precisa conviver com as obrigações de segurança do VOC-10.
9. **Prioridade:** P1.
10. **Evidências:** `pt:L449`, `pt:L460`, `pt:L168`, `pt:L358`, `pt:L65`, `pt:L290`, `pt:L335`, `en:L7`, `en:L253`.

#### VOC-06 · Redesigns impostos e navegação
1. **Descrição [FATO]:** grandes mudanças de layout (2022, dez/2023, 2025–2026) mudaram as DMs de lugar e encheram a tela de botões. Os gestos de voltar do Android abrem painéis laterais. Em 2026 vieram formas "quadradas" e cores mais claras.
2. **Queixa ou pedido:** opção de voltar ao layout anterior (`pt:L84`, `pt:L908`, `en:L100`). "Mais botões não deixam melhor" (`en:L222`, 631 "útil"). Uma reclamação de contraste ruim para fotossensíveis (`en:L106`).
3. **Por que dói:** quebra a memória muscular de anos. O usuário sente que a empresa "inova" no visual e não conserta os bugs.
4. **Frequência:** UI/redesign em 65/599 (10,9%) das 1–2★ pt e 30/240 (12,5%) das en. Pico de 26–33% das 1–3★ pt em 2022–2024. Pedido explícito de "versão antiga ou opção": 11 pt e 2 en.
5. **Severidade:** média–alta. Aparece junto com regressões.
6. **Perfil:** usuário antigo e intenso.
7. **Solução [RECOMENDAÇÃO]:** evolução incremental com prévia opcional; densidade compacta ou confortável; mudanças grandes atrás de opção por um período; não mexer em gestos do sistema. Isso combina com a direção "Linear-like": densa, rápida e estável.
8. **Valor competitivo:** alto. "Interface limpa que não muda de lugar" é tangível na demo.
9. **Prioridade:** P1.
10. **Evidências:** `pt:L205`, `pt:L327`, `pt:L330`, `pt:L213`, `pt:L210` e `pt:L117` (gestos), `pt:L84`, `pt:L908`, `en:L114`, `en:L222`, `en:L204`, `en:L106`.

#### VOC-07 · Peso, bateria e aparelhos simples
1. **Descrição [FATO]:** reclamações de que o app esquenta e gasta bateria "como um jogo pesado" (`pt:L956`), engasga ao digitar, fica mais pesado a cada versão e usa muita memória (`en:L82`). No PC, um relato de 80% de uso de GPU (`pt:L498`).
2. **Queixa ou pedido:** ser leve "igual o WhatsApp" (`pt:L267`). Versão lite (`pt:L1115`). Celulares como o J5 (`pt:L507`).
3. **Por que dói:** no Brasil há muitos aparelhos modestos. O usuário joga e usa o Discord **ao mesmo tempo**, então o recurso gasto pelo app é tirado do jogo.
4. **Frequência:** 62/599 (10,4%) das 1–2★ pt e 27/320 (8,4%) das 4–5★ (aparece até em quem gosta). Pedido explícito de "leve/lite": 13 pt.
5. **Severidade:** média–alta.
6. **Perfil:** gamer com hardware intermediário ou de entrada.
7. **Solução [RECOMENDAÇÃO]:** orçamento de desempenho público (memória ociosa, CPU em call, impacto no FPS), medido a cada release. O benchmark interno já propõe ≤ 1/3 da memória do Discord.
8. **Valor competitivo:** alto e demonstrável ("mede aí").
9. **Prioridade:** P1.
10. **Evidências:** `pt:L267`, `pt:L955`, `pt:L1115`, `pt:L507`, `pt:L802`, `pt:L956`, `pt:L498`, `en:L82`.

#### VOC-08 · Paywall: "tudo é Nitro"
1. **Descrição [FATO]:** o limite de 10 MB para arquivos ("dez megabytes", `en:L84`), gravações curtas e qualidade de transmissão ficam atrás do Nitro. A personalização de perfil é paga. O botão de presentear Nitro fica ao lado de botões de uso frequente.
2. **Queixa ou pedido:** "está virando um comércio" (`pt:L708`). "Tudo é nitro" (`pt:L972`). O botão de presente em lugar de clique acidental (`en:L21`, `en:L100`, `en:L204`; 13 menções a "gift" em en).
3. **Por que dói:** o usuário sente que o produto grátis está sendo piorado de propósito para forçar a assinatura. Isso corrói a boa vontade, mesmo de quem paga.
4. **Frequência:** Nitro/pagar em 36/240 (15,0%) das 1–2★ en e 40/599 (6,7%) das pt. Limite de arquivo: 11 pt e 9 en. "Caro/forçado": 9 pt e 8 en.
5. **Severidade:** média. O motivo é forte, mas raramente é o único.
6. **Perfil:** adolescentes sem cartão ("não tenho dinheiro pra pagar o nitro", `pt:L1070`). Em en, usuários antigos.
7. **Solução [RECOMENDAÇÃO]:** grátis = comunicação completa (arquivos razoáveis, voz boa, tela ok). O pago fica na expressão e no excesso (cosméticos, limites altos), em linha com a memória "valor, sem dark patterns". Nenhum CTA de compra perto de ações de rotina.
8. **Valor competitivo:** muito alto. É o diferencial mais fácil de explicar a um amigo.
9. **Prioridade:** P1 (é decisão de produto, não de engenharia).
10. **Evidências:** `en:L84` (3.321 "útil"), `en:L180`, `en:L239`, `en:L21`, `pt:L580`, `pt:L972`, `pt:L708`, `pt:L1151`, `pt:L864`.

#### VOC-09 · Ver filme e jogar juntos: tela e câmera retiradas no Brasil (2026)
1. **Descrição [FATO]:** entre ago e nov/2026, usuários no Brasil relatam a remoção do Go Live (compartilhamento de tela) e da câmera e chamada de vídeo. **[OPINIÃO]** Eles atribuem a mudança a lei ou governo. **A causa real não foi verificada nesta pesquisa.**
2. **Queixa ou pedido:** "voltem a transmissão". Usuários perderam o hábito de **assistir filmes e séries com amigos em call** (`pt:L346`, `pt:L357`). Um usuário sugere liberar a câmera com verificação de documento (`pt:L927`).
3. **Por que dói:** remove um ritual social. Muitos tiram estrelas mesmo gostando do app ("tirou o compartilhamento de tela, perdeu duas estrelas", `pt:L712`).
4. **Frequência:** 29 pt (2,5% do total), todos concentrados no estrato recente, mais 2–3 iOS BR. Baixa no total, mas **nova e crescente** no período observado.
5. **Severidade:** alta para quem usava.
6. **Perfil:** grupos de amigos, inclusive adultos.
7. **Solução [RECOMENDAÇÃO]:** **depende de parecer jurídico** (classificação etária e obrigações de plataforma no Brasil). Se a restrição valer para menores, uma via possível é liberar para contas adultas verificadas com baixo atrito (VOC-10). **Não prometer** antes da análise legal.
8. **Valor competitivo:** potencialmente muito alto no Brasil ("aqui dá pra ver filme com a galera").
9. **Prioridade:** P2 até haver parecer. Pode subir para P1.
10. **Evidências:** `pt:L346`, `pt:L357`, `pt:L340`, `pt:L123`, `pt:L124`, `pt:L689`, `pt:L712`, `pt:L739`, `pt:L748`, `pt:L865`, `pt:L914`, `ap:L31`.

#### VOC-10 · Segurança infantil e verificação de idade sem atrito
1. **Descrição [FATO]:** dois lados aparecem.
   - **Pedem mais proteção:** relatos de aliciamento, gore e abuso; pedidos para proibir menores ou separar ambientes (`pt:L112`, `pt:L488`, `pt:L493`, `pt:L472`, `pt:L910`).
   - **Rejeitam o método de verificação:** "não vou tirar foto do documento" (`pt:L684`); a verificação por IA é quase impossível (`pt:L615`); em en, citam o vazamento de dados e prometem trocar de app (`en:L91`).
2. **Queixa ou pedido:** segurança real sem expor documentos.
3. **Por que dói:** os pais não confiam na plataforma. Os adultos se sentem vigiados. Os dois saem.
4. **Frequência:** segurança infantil em 27 pt (2,3%); verificação de idade em 24 pt (2,1%), sendo ~metade pedidos de *mais* controle; 7 en, todos 1–2★.
5. **Severidade:** muito alta (risco legal e reputacional), frequência baixa na amostra.
6. **Perfil:** responsáveis, meninas adolescentes (`pt:L706`), adultos preocupados com privacidade.
7. **Solução [RECOMENDAÇÃO]:**
   - Padrão seguro para menores: DMs de desconhecidos fechadas, filtros.
   - Verificação de idade só quando a lei exigir, com o método menos invasivo e sem reter documento.
   - Explicar isso em linguagem simples.
   - Ferramentas de denúncia que funcionam. Hoje a denúncia exige assinatura e falha (`pt:L365`).
8. **Valor competitivo:** alto, sobretudo com pais e comunidades. Também reduz o risco regulatório.
9. **Prioridade:** P1 (conformidade pode tornar alguns pontos P0; ver agente jurídico).
10. **Evidências:** `pt:L112`, `pt:L488`, `pt:L493`, `pt:L624`, `pt:L706`, `pt:L910`, `pt:L365`, `pt:L684`, `pt:L615`, `pt:L732`, `pt:L927`, `en:L91`.

#### VOC-11 · Notificações que chegam (e "não perturbe" que funciona)
1. **Descrição [FATO]:** chamadas e mensagens não notificam, ou param de notificar em certos chats. O "não perturbe" não silencia (`en:L397`).
2. **Queixa ou pedido:** saber de chamadas recebidas (`en:L330`). Receber notificações de grupos (`pt:L857`).
3. **Por que dói:** perde-se a call do grupo, e o app parece "morto" para quem usa pouco.
4. **Frequência:** pt 31 (2,7%); en 30 (6,2%), 17 delas em 1–2★.
5. **Severidade:** média–alta.
6. **Perfil:** usuário casual (não fica com o app aberto).
7. **Solução [RECOMENDAÇÃO]:** no Windows, notificações nativas confiáveis, prioridade para chamadas de amigos, DND real e um "por que não fui notificado?" de diagnóstico.
8. **Valor competitivo:** médio (paridade bem-feita).
9. **Prioridade:** P1.
10. **Evidências:** `en:L127`, `en:L330`, `en:L397`, `pt:L857`, `pt:L792`, `pt:L266`.

#### VOC-12 · Paridade entre dispositivos e várias contas
1. **Descrição [FATO]:** recursos chegam primeiro ou só no desktop (banner, descoberta de servidores, quests que exigem jogar no PC). Não há troca rápida de conta no mobile.
2. **Queixa ou pedido:** "favorecendo quem usa computador" (`pt:L758`, 590 "útil"). Trocar de conta como no Instagram (`pt:L854`). Pesquisar servidores no celular (`pt:L992`, 950 "útil").
3. **Por que dói:** quem só tem celular se sente cidadão de segunda classe.
4. **Frequência:** paridade em 56 pt (4,8%); várias contas em 11 pt (7 delas em 4–5★, um pedido de quem gosta); quests só no desktop em 12 pt e 4 en.
5. **Severidade:** média.
6. **Perfil:** usuário só-mobile; quem tem conta pessoal e de comunidade.
7. **Solução [RECOMENDAÇÃO]:** desenhar o modelo de dados para várias contas desde já. Mobile pode vir depois, mas sem rebaixar quem só tem celular.
8. **Valor competitivo:** médio.
9. **Prioridade:** P2.
10. **Evidências:** `pt:L758`, `pt:L992`, `pt:L854`, `pt:L786`, `pt:L935`, `pt:L1114`, `en:L301` (1.261 "útil"), `en:L315`.

#### VOC-13 · Mensagens de voz no estilo WhatsApp (Brasil)
1. **Descrição [FATO]:** a gravação de áudio trava "gravando para sempre". Vários áudios saem com o mesmo conteúdo. O áudio não toca em sequência e pausa ao sair do app.
2. **Queixa ou pedido:** ouvir vários áudios seguidos (`pt:L760`), gravar sem travar (`pt:L810`, 846 "útil").
3. **Por que dói:** no Brasil, áudio é a forma natural de conversar. O usuário compara com o WhatsApp.
4. **Frequência:** 21 pt (1,8%) contra 2 en. Concentrado em 2023–2024.
5. **Severidade:** média.
6. **Perfil:** brasileiro que usa o app também como mensageiro.
7. **Solução [RECOMENDAÇÃO]:** áudio rápido com fila de reprodução, velocidade 1,5×/2× e retomada. É um diferencial cultural barato.
8. **Valor competitivo:** médio–alto no Brasil.
9. **Prioridade:** P2.
10. **Evidências:** `pt:L810`, `pt:L755`, `pt:L598`, `pt:L563`, `pt:L760`, `pt:L131`.

#### VOC-14 · Privacidade, IA e dados
1. **Descrição [FATO]:** em en, rejeição a "políticas invasivas de IA e ID" e à ideia de que mensagens ficariam buscáveis na web (`en:L66`; **[OPINIÃO]** não verificado). Também: medo de que a IA use a arte postada (`en:L220`) e citação a vazamento de dados (`en:L91`). Em pt-BR, "IA" aparece mais como reclamação do captcha e da moderação.
2. **Queixa ou pedido:** não usar conteúdo para treino; não exigir documento.
3. **Por que dói:** é a quebra de confiança que leva a procurar alternativas. É o único tema em que "find alternatives" aparece de forma explícita.
4. **Frequência:** en 11/240 (4,6%) das 1–2★. A contagem pt (41) mistura temas e tem **confiança baixa**.
5. **Severidade:** alta para o segmento sensível.
6. **Perfil:** adulto, criador de conteúdo, público en.
7. **Solução [RECOMENDAÇÃO]:** política curta e legível ("não treinamos IA com suas mensagens", "não guardamos documento"), cumprida e auditável.
8. **Valor competitivo:** alto para formadores de opinião.
9. **Prioridade:** P2.
10. **Evidências:** `en:L66`, `en:L220`, `en:L91`.

#### VOC-15 · Quests, Orbs e anúncios
1. **Descrição [FATO]:** o sentimento é misto. Há quem goste de ganhar cosméticos de graça com missões (`pt:L1131` 5★, 2.471 "útil"; `pt:L1114` 5★, 2.463). Há reclamações de missões só no PC, de redução de Orbs e de anúncio de 4 minutos por 200 Orbs (`pt:L686`). E há a percepção de que "o Discord só se importa com cosméticos" (`pt:L150`).
2. **Queixa ou pedido:** mais missões no mobile e recompensas maiores. Isso é um pedido de **mais** economia de anúncios, não menos.
3. **Por que dói:** frustração com regras que mudam.
4. **Frequência:** 65 pt (5,6%), espalhados em todas as faixas de estrela.
5. **Severidade:** baixa.
6. **Perfil:** adolescente sem renda que quer cosméticos.
7. **Solução [RECOMENDAÇÃO]:** **não copiar** o modelo de anúncios. Vale estudar formas de ganhar cosméticos sem anúncio (presente de amigo, conquistas), no espírito do track de monetização.
8. **Valor competitivo:** baixo. Risco de virar "comércio" (VOC-08).
9. **Prioridade:** P3.
10. **Evidências:** `pt:L686`, `pt:L1131`, `pt:L1114`, `pt:L751`, `pt:L673`, `pt:L150`, `en:L153`.

---

## 5. O que as pessoas amam e o que seria arriscado perder

Base: 4–5★ (pt n=320; en n=140), mais menções positivas dentro de críticas.

| Valor percebido | pt 4–5★ | en 4–5★ | Evidência típica |
|---|---|---|---|
| **Servidores e comunidades** (canais por assunto, entrar por link, achar gente do mesmo gosto) | 60 (18,8%) | 32 (22,9%) | `pt:L1151` ("genial e revolucionário"), `pt:L1001`, `en:L452`, `en:L454` |
| **Call com amigos enquanto joga** | 44 (13,8%) | 14 (10,0%) | `pt:L1101`, `pt:L1037` (PS5), `pt:L991`, `en:L396` (volume por pessoa, soundboard) |
| **Fácil de usar** (depois de acostumar) | 35 (10,9%) | 11 (7,9%) | `pt:L1147` (um dia para aprender), `pt:L915` ("difícil no começo, depois acostuma") |
| **Bots, cargos, organização** | 19 (5,9%) | 10 (7,1%) | `pt:L959` ("bots são indispensáveis"), `pt:L1137` |
| **Fiz amigos e conheci gente** | 18 (5,6%) | 2 | `pt:L1001`, `pt:L1114`, `en:L396` |
| **Ver filme e jogo juntos** (compartilhar tela) | 17 (5,3%) | 3 | `pt:L1167`, `pt:L1150`, `pt:L346` (sente falta) |
| **Grátis no essencial** | 12 (3,8%) | 3 | `pt:L1166` ("todas as funções básicas são gratuitas"), `pt:L761` |
| **Sem número de telefone; PC, celular e console** | 6–10 | 6–11 | `pt:L977` (534 "útil": login sem telefone), `en:L456` (6.042 "útil"), `en:L469` |
| **"Insubstituível"** | 10 | — | `pt:L914`, `pt:L685` |

**Arriscado perder [RECOMENDAÇÃO]:**
1. **O modelo servidor → canais → cargos**, com convite por link. É o que os usuários chamam de genial. Um concorrente não deve "simplificar" isso para uma lista de grupos.
2. **Comunicação completa de graça** (voz, texto, servidores). O elogio "tudo de graça" convive com a queixa "tudo é Nitro". A linha entre os dois é exatamente o tier grátis.
3. **Identidade sem telefone e presença em vários dispositivos.** Quem não tem WhatsApp ou chip usa o Discord por isso (`pt:L1107`, `en:L456`).
4. **Controles finos de voz** (volume por pessoa, mutar outros, soundboard) e **bots**.
5. **Compartilhar tela para assistir junto.** O Brasil está mostrando o custo de perder isso.

---

## 6. A pergunta central

**O que faz alguém gostar do Discord e, mesmo assim, desejar uma alternativa melhor?**

**[FATO]** O padrão dominante nas críticas é "gosto, mas…":
- 32,8% das 3★ pt-BR (82/250) abrem com elogio e viram com "mas/porém".
- Também 13,7% das 1–2★ (82/599).
- Em pt-BR, 105 das 1–2★ (17,5%) dizem que o app **piorou** após atualizações; não dizem que sempre foi ruim.
- Elogios como "melhor app de chamadas que conheço" aparecem **dentro** de avaliações 2★ (`pt:L568`).

**[HIPÓTESE, com base na leitura]** A resposta tem três camadas:

1. **Elas amam o lugar, não o app.** O valor está nos amigos, nos servidores e no ritual de jogar conversando. As avaliações quase nunca elogiam o cliente em si ("leve", "rápido", "bonito"); elogiam o que ele **permite**. A fidelidade é à rede. Por isso pouca gente cita alternativas (28 pt, 2,4%). Quando cita, é WhatsApp como comparação de leveza ou de áudio, não como substituto.
2. **Elas sentem que a empresa olha para outro lado.** As três irritações que se repetem desenham a mesma história: "a empresa cuida do que dá dinheiro, não do que eu uso".
   - Atualizações que mudam o visual e quebram o básico (VOC-01, VOC-06).
   - Pressão para pagar no que antes era grátis (VOC-08).
   - Robôs no lugar de gente: suporte, moderação e captcha (VOC-03, VOC-04, VOC-05).
   - Um exemplo: o app "só se importa com cosmetics de nitro enquanto cai aos pedaços" (`pt:L150`).
3. **A troca custa caro porque é coletiva.** Ninguém migra sozinho. O desejo de alternativa existe, mas fica latente até alguém oferecer um caminho em que **o grupo inteiro** entra em segundos.

**[RECOMENDAÇÃO] O que isso significa para o Alga Meet**
- **Prometer o básico que funciona**, não mais recursos. Mensagem e voz que não falham, cadastro em segundos, cliente leve. É o que falta no Discord segundo os próprios fãs.
- **Ganhar pela confiança:** grátis generoso no essencial, gente de verdade no suporte e na apelação, mudanças de UI previsíveis, privacidade explícita.
- **Facilitar a migração do grupo:** convite com link que já cria a conta, estrutura de servidor familiar e, onde possível, importar a estrutura de canais.
- **Não perder o que é amado:** servidores, cargos, bots, call enquanto joga, tela para assistir junto.

---

## 7. Pedidos atraentes, mas de baixo valor (ou arriscados)

| Pedido | Freq. | Por que é baixo valor ou arriscado |
|---|---|---|
| "Visto/lido" igual ao WhatsApp | 3 pt + 1 en | Em servidores, gera pressão social e ruído. No máximo, opcional em DM. |
| Apagar a conversa inteira | 4 pt + 1 en | Útil, mas raro. Resolve-se como uma ação simples de DM, sem destaque. |
| Tradução embutida | 5 pt | Atraente, mas custa (IA e privacidade) para um público pequeno. P3. |
| Nitro grátis por 30 dias | ~3 pt (2021–2022) | É pedido de preço, não de produto. Melhor resolvido com tier grátis generoso (VOC-08). |
| Ranking ou nível de conta tipo PSN | 1 (`pt:L991`, muito "útil") | Uma avaliação enfática; não é tendência. Gamificação pode virar ruído. |
| Mais Orbs, missões e anúncios recompensados | parte dos 65 de VOC-15 | Pede **mais** economia de anúncio, o que contraria a direção premium e sem dark patterns. |
| "Tirar a verificação de idade de vez" | parte dos 24 de VOC-10 | Pode ser legalmente inviável. O valor real está em fazer a verificação **com menos atrito e sem reter dados**. |
| Espaço em nome de canal e outros detalhes de UI | 1–2 | Baixo impacto. Só como polimento. |

---

## 8. Fontes

- Google Play, Discord (`com.discord`), pt_BR/BR e en/US: https://play.google.com/store/apps/details?id=com.discord&hl=pt_BR (acesso em 2026-11-05, sem login; diálogo "Ver todas as avaliações" e sua chamada pública `batchexecute`).
- App Store, metadados: https://itunes.apple.com/lookup?id=985746746&country=br (confirma o id do app Discord).
- App Store, RSS de avaliações BR, página 1: https://itunes.apple.com/br/rss/customerreviews/page=1/id=985746746/sortby=mostrecent/json (páginas 2–10 e /us/ vazias em 2026-11-05).
- Comunidade de feedback do Discord: https://support.discord.com/hc/en-us/community/topics/360000029731-Feedback (redireciona para a home da Central de Ajuda; `api/v2/community/topics.json` = 0 tópicos). **Não examinada.**
- Dados brutos (git-ignored): `docs/private/research/discord/play-ptbr.jsonl`, `play-enus.jsonl`, `appstore.jsonl`, `coded.jsonl`.
- Contexto interno (não repetido aqui): `docs/research/discord-benchmark.md`, `docs/research/discord-profile-study.md`.
