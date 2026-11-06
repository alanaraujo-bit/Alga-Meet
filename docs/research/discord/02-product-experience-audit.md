# 02 — Auditoria de experiência de produto e engenharia reversa funcional do Discord

> Agente 02 (Product Experience & Functional Reverse Engineering). Pesquisa somente leitura, feita em 2026-11-05.
> Complementa, sem repetir: `docs/research/discord-benchmark.md` (voz, tela, recursos, preços) e `docs/research/discord-profile-study.md` (perfil, presença, loja de perfil).
> Pergunta-guia: **"Se construíssemos isto hoje, sem o legado do Discord, como a experiência poderia ser melhor?"**

---

## 1. Método e acesso

| Item | Detalhe |
|---|---|
| Caminho de acesso | **Claude in Chrome**, Chrome do dono, sessão do Discord Web já autenticada, numa aba nova criada para a pesquisa e fechada ao fim. Não foi preciso o navegador embutido nem o app desktop. |
| Cliente | Discord Web, idioma pt-BR, tema escuro (`theme-darker`), classe `visual-refresh` ativa (o redesign de 2025), densidade padrão, fonte 16 px, movimento completo. Viewport 1278×1270. |
| Conta | Conta comum **sem Nitro**. Está em 5 servidores. Num deles (comunidade de ~6,4 mil membros) e em outro (servidor de amigos com ~10 canais de voz) tem um cargo que dá acesso parcial às configurações do servidor (perfil, engajamento, expressões, apps). **Não é admin pleno em nenhum.** |
| Técnicas | Navegar, passar o mouse, abrir menus de contexto (fechados com Esc), diálogo de atalhos (Ctrl+/), Quick Switcher (Ctrl+K) sem digitar, abrir o campo de busca sem digitar, ler páginas de configurações sem alterar nada, e JS **somente leitura** para contar itens e ler CSS computado. |
| Nada feito | Nenhuma mensagem, digitação em compositor, reação, entrada em voz/palco, chamada, entrada em servidor, aceite de pedido, mudança de status ou de configuração, compra ou autorização de app. O único estado de UI alterado foi a lista de membros (mostrada e ocultada de novo) e a leitura de canais ao navegar (efeito colateral inevitável: canais abertos ficam marcados como lidos para o dono). |
| Privacidade | Nenhum nome de pessoa, servidor privado, conteúdo de mensagem, avatar ou convite aparece aqui. Servidores aparecem descritos pela estrutura. |
| Diretriz do dono | Tudo aqui foi **observado na sessão**. Documentação oficial não substituiu observação. O que não pôde ser visto está listado como **"Não observado"**, sem descrição inventada. |

**O que não pôde ser observado e por quê**

- **UI dentro de chamada de voz, vídeo, Go Live, palco e Activities.** Exigiria entrar num canal ou ligar, o que é visível para outros. Só os pontos de entrada e os controles fora da chamada foram vistos.
- **Editor de cargos e permissões, AutoMod, registro de auditoria, configuração de Onboarding, triagem de regras e configurações de Comunidade.** A conta não tem essas permissões. O menu de configurações do servidor mostra só as seções que o usuário pode gerir (o que já é um achado, ver PX-17).
- **Diálogo de convite.** Abri-lo gera um link de convite real, então ficou de fora.
- **Conteúdo de DMs e de grupos.** Foram vistos só a lista, os menus e a contagem.

---

## 2. Inventário funcional

Legenda: **T** = Testado (observado na sessão). **N** = Não observado (sem acesso ou proibido pelas regras). Não há itens só de documentação.

| Área | Funcionalidade | Status | PX |
|---|---|---|---|
| Navegação | Layout de 4 colunas: trilho de servidores, barra lateral, conteúdo, painel direito | T | PX-01 |
| Navegação | Quick Switcher (Ctrl+K) com prefixos | T | PX-02 |
| Navegação | Atalhos de teclado (~46 no diálogo Ctrl+/) | T | PX-03 |
| Navegação | Menus de contexto em tudo (servidor, canal, DM, amigo) | T | PX-04 |
| Social | Home: Amigos (Disponível/Todos/Pendente/Adicionar) e "Ativo agora" | T | PX-05 |
| Social | Lista de DMs, com Ignorar separado de Bloquear | T (só UI) | PX-06 |
| Servidores | Categorias, canais de texto e voz, limite visível de vagas na voz | T | PX-07 |
| Servidores | Canal de fórum (Nova postagem, ordenar, lista/galeria) | T | PX-08 |
| Servidores | "Conferir Canais", seguir categoria, sugestões de canal | T | PX-09 |
| Servidores | Mensagens de sistema (boas-vindas com "Acene", impulsos) | T | PX-10 |
| Servidores | Mensagens de usuários ignorados recolhidas | T | PX-11 |
| Membros | Lista de membros agrupada por cargo, com contagem | T | PX-12 |
| Notificações | Caixa de entrada: Não lidas, Menções, Favoritos, Lembretes | T | PX-13 |
| Notificações | Contadores (badges) por servidor e canal, contagem na aba, divisor "NOVAS" | T | PX-14 |
| Busca | Busca com filtros `de:` `em:` `tem:` `menciona:` | T | PX-15 |
| Configurações | Configurações do usuário: ~19 seções em 4 grupos, com busca | T | PX-16 |
| Admin | Configurações do servidor filtradas por permissão | T (parcial) | PX-17 |
| Admin | Engajamento: mensagens de sistema, notificação padrão, canal de ausentes | T | PX-18 |
| Admin | Exigir MFA para moderadores (banner que bloqueia ações) | T | PX-19 |
| Crescimento | Criar servidor com moldes (6 modelos) | T | PX-20 |
| Descoberta | Descobrir servidores e apps (categorias, contagem online/membros) | T | PX-21 |
| Monetização | Nitro (R$ 8,90 / R$ 24,99), Impulsos (níveis 2/7/14), Inventário de presentes | T | PX-22 |
| Monetização | Missões (Quests) e Orbs | T | PX-23 |
| Monetização | Loja (Destaques, Navegar, Loja de Orbs, Lojas do jogo) | T | PX-24 |
| Identidade | Popout da própria conta (vibe/status, Coleção de jogos, Orbs, upsell) | T | PX-25 |
| Acessibilidade | Tamanho do texto, densidade, saturação, contraste, movimento reduzido, TTS | T | PX-26 |
| Voz | Controles do painel do usuário (mic, fone, menus de entrada e saída) | T (fora da chamada) | PX-27 |
| Voz/vídeo | Chamada, Go Live, palco, Activities, soundboard na chamada | N | — |
| Admin | Cargos e permissões, AutoMod, auditoria, Onboarding, triagem de regras | N | — |
| Crescimento | Diálogo de convite, convites personalizados | N | — |
| Tópicos | Painel de threads (só o botão "Tópicos" foi visto no cabeçalho) | N | — |

**Total: 27 funcionalidades observadas, 0 só de documentação, 4 áreas não observadas.**

---

## 3. Funcionalidades em detalhe

Formato: cada item cobre (1) nome e propósito, (2) como funciona, (3) fluxo observado, (4) o que o Discord faz bem, (5) limitações, (6) o que preservar, (7) o que fazer muito melhor, (8) diferenciação, (9) complexidade para nós, (10) evidência.

### PX-01 — Layout de 4 colunas e "visual refresh"
**Testado (observado na sessão)**
1. A estrutura-mãe do app: onde estou, para onde posso ir e quem está aqui.
2. As colunas são um trilho de servidores (72 px = 40 px de ícone + 16 px de margem de cada lado, `--custom-guild-list-width`), uma barra lateral (~302 px), o conteúdo e um painel direito opcional ("Ativo agora" na Home, ~264 px na lista de membros). O painel do usuário (~359×128 px) fica **sobreposto embaixo**, atravessando o trilho e a barra lateral.
3. O trilho tem, nesta ordem: Home, DMs com não lidas como bolhas de avatar, 5 servidores, "+", Descobrir e Baixar app. Há ainda uma faixa verde fixa no topo pedindo para instalar o app desktop.
4. A posição do usuário é sempre legível. A hierarquia servidor > categoria > canal é previsível. Os tokens estão maduros (`--space-*` de 4 a 192 px, `--radius-xs..xxl` de 4/8/12/16/24/32 px, cerca de 5.164 variáveis CSS).
5. São 4 níveis de navegação antes do conteúdo. A barra lateral mistura funções (no topo da Home ficam Amigos, Nitro, Loja e Missões, ou seja, **2 de 4 entradas são comerciais**). A faixa de "baixe o app" ocupa espaço o tempo todo.
6. Preservar o trilho de espaços e um nível de contexto persistente.
7. Melhorar: colapsar a barra lateral, nada de faixas de marketing no chrome do app, e Home focada em pessoas e no que está acontecendo, sem lojas.
8. Diferencial: uma Home "agora" (quem está na voz, o que está rolando) acima das listas.
9. Baixa (layout). Incerteza baixa.
10. `nav[aria-label="Barra lateral dos servidores"]` com 72 px, `Canais privados` com 302 px, `Status do usuário e configurações` com 359×128. O `<html>` tem as classes `visual-refresh density-default font-size-16`.

### PX-02 — Quick Switcher (Ctrl+K)
**Testado (observado na sessão)**
1. Pular para qualquer lugar sem usar o mouse.
2. Abre um modal centralizado com o placeholder "Aonde você gostaria de ir?". Antes de digitar, já mostra seções: "Canais anteriores" e "Menções" (canais com menção, com contador).
3. Ctrl+K abre com 5 resultados prontos. A dica de rodapé ensina os prefixos `@` usuários, `#` texto, `!` voz, `*` servidores e `$` perfis de jogo.
4. Ele é útil **antes da primeira tecla**, porque é ao mesmo tempo histórico e triagem de menções. Os prefixos são ensinados dentro da própria UI.
5. Navega, mas não executa ações (não dá para mutar, mudar status ou abrir configurações). Não busca mensagens.
6. Preservar o estado vazio útil e os prefixos.
7. Melhorar: virar uma **paleta de comandos de verdade**, no estilo do Cmd+K do Linear, com navegação, ações ("entrar na voz X", "mutar", "convidar Y") e busca de mensagens no mesmo lugar.
8. Diferencial alto e coerente com a direção "Linear-like".
9. Média. Precisa de um índice local e de um registro de ações. Incerteza média.
10. Diálogo `aria-label="Quick Switcher"`, cabeçalhos "Canais anteriores" e "Menções", e o texto de dica com os 5 prefixos.

### PX-03 — Atalhos de teclado
**Testado (observado na sessão)**
1. Dar velocidade a usuários avançados.
2. O diálogo Ctrl+/ ("Combos do teclado") tem 5 grupos: Mensagens (10), Navegação (9), Voz e vídeo (6), Chat (16) e Diversos (5, incluindo 2 easter eggs). **São cerca de 46 atalhos.** Em Configurações > Sistema dá para criar "Atalhos do teclado personalizados".
3. Um atalho abre a lista e Esc fecha.
4. Cobertura grande: navegar entre não lidos (Alt+Shift+↑↓), entre menções (Ctrl+Shift+Alt+↑↓), marcar servidor como lido (Shift+Esc), marcar canal como lido (Esc), voltar para a chamada atual (Ctrl+Shift+Alt+V), mic (Ctrl+Shift+M), som (Ctrl+Shift+D). Os easter eggs dão personalidade.
5. **"Focalizar área de texto: QUALQUER TECLA"**: qualquer tecla digitada num canal vai para o compositor e dispara o indicador "digitando". É ótimo para quem escreve, mas é um risco de privacidade. Os acordes de 3 teclas são difíceis de descobrir. "Esc marca como lido" é uma ação com efeito escondida numa tecla de fechar.
6. Preservar mic e som globais, navegação por não lidos e o diálogo de atalhos.
7. Melhorar: atalhos mostrados no hover e na paleta de comandos. Não ligar "marcar lido" ao Esc. Avisar "digitando" só depois de conteúdo real.
8. Diferencial médio.
9. Baixa a média.
10. Ctrl+/ abre o diálogo com as seções "Mensagens; Navegação; Voz e vídeo; Chat; Diversos".

### PX-04 — Menus de contexto
**Testado (observado na sessão)**
1. Ações secundárias onde o objeto está.
2. Contagens (só itens de primeiro nível, sem submenus):

| Alvo | Itens | Separadores | Destaques |
|---|---|---|---|
| Ícone de servidor | 10 | 5 | Marcar como lida, Convidar, Silenciar, Notificação, Ocultar silenciados, Mostrar todos, Privacidade, Perfil por servidor, "Mover para...", Sair |
| Cabeçalho do servidor (membro comum) | 9 | 4 | O 1º item é **"Impulso de servidor"** |
| Cabeçalho do servidor (cargo parcial) | 10–11 | 4 | Aparecem "Config. do servidor" e "Criar evento" |
| Canal de texto | 7 | 3 | Favoritos, **"Fixe o Canal no Topo"**, Copiar link |
| Canal de voz | 8 | 4 | "Convidar para voz", "Abrir chat", **"Ocultar nomes"** |
| Linha de amigo | 9 | 1 | Perfil, Mensagem, Chamada, Nota, Apelido de amigo, Convidar, Desfazer amizade, Ignorar, Bloquear |
| Linha de DM | 14 | 4 | Fixar, Favoritos, Fechar DM, Apps, Silenciar |

3. Clique direito abre o menu e Esc fecha. Shift+F10 também abre.
4. É consistente: "Marcar como lida" está sempre no topo e as ações destrutivas sempre no fim.
5. Menus longos (14 itens na DM). Promoção paga como 1º item no menu do servidor. Duplicação entre o menu do cabeçalho e o do ícone.
6. Preservar a ordem previsível (leitura no topo, destrutivo no fim).
7. Melhorar: no máximo ~8 itens no primeiro nível, com o resto em "Mais". Nada pago no topo.
8. Diferencial baixo, mas soma à qualidade percebida.
9. Baixa.
10. `[role=menu]` com a contagem de `[role=menuitem]` acima.

### PX-05 — Home: Amigos e "Ativo agora"
**Testado (observado na sessão)**
1. Ponto social de partida, fora dos servidores.
2. Tem as abas Disponível, Todos, Pendente (com contador) e o botão destacado "Adicionar amigo". A lista mostra cerca de 6 amigos online, com status e atividade. À direita, o painel "Ativo agora" mostra a atividade de amigos (jogo e tempo decorrido). Há também um aviso contextual ("Procurando contas que você bloqueou ou ignorou? Ir para configurações").
3. Home > Amigos > aba. Cada linha tem 2 ações rápidas (mensagem e menu).
4. "Ativo agora" transforma presença em convite implícito para interagir. É o gancho de retorno mais saudável do produto.
5. Para ver o que acontece **nos servidores** (quem está em qual voz) é preciso abrir servidor por servidor. A atividade é muito centrada em jogos.
6. Preservar presença rica e ambiente.
7. Melhorar: "Agora" unificado, com amigos e salas de voz ativas de todos os espaços e entrada em 1 clique, mais do que só a atividade de jogo.
8. Diferencial alto para "amigos primeiro" (o público do Alga).
9. Média, porque depende de presença agregada no servidor.
10. `[role=tab]` = "Disponível", "Todos", "Pendente 1", "Adicionar amigo". Cabeçalho "Ativo agora".

### PX-06 — DMs: lista e controles de relação
**Testado (observado na sessão, só UI)**
1. Conversas 1:1 e em grupo.
2. A lista teve cerca de 34 linhas, com DMs e grupos ("N membros") misturados. A entrada oficial do Discord aparece com o selo "OFICIAL". As linhas mostram tag de servidor e atividade.
3. O menu da linha tem 14 itens. Os pares de segurança são **"Ignorar"** e **"Bloquear"** (dois níveis). Também há "Adicionar nota" e "Adicionar apelido de amigo", que são metadados privados.
4. O nível "Ignorar" é sutil e reduz conflito: a pessoa some do seu campo de visão sem o peso de um bloqueio. Notas e apelidos privados ajudam a lembrar quem é quem.
5. A lista não tem agrupamento (fixadas/recentes/grupos) nem busca própria, só "Encontre ou comece uma conversa".
6. Preservar Ignorar/Bloquear graduados e notas privadas.
7. Melhorar: seções Fixadas, Grupos e Recentes, e filtro "não lidas".
8. Diferencial médio.
9. Baixa a média.
10. Menu da linha de DM, com 14 itens (ver PX-04).

### PX-07 — Servidores, categorias e canais
**Testado (observado na sessão)**
1. Organizar uma comunidade em lugares.
2. Composições observadas:
   - servidor pequeno: 13 itens, 2 categorias, 5 de texto e 6 de voz;
   - comunidade grande: 32 itens, 7 categorias, 20 de texto, 2 de fórum e 2 de voz (bloqueadas e usadas como **contadores de estatística por bot**, tipo "Membros: N").

   Os canais de voz mostram a ocupação como **"00 / 05"** (atual / limite).
3. Clicar num canal de texto navega. Clicar num canal de voz **entra** nele (por isso não foi feito).
4. O modelo mental de "lugares" persistentes. Emoji no nome vira ícone. A ocupação de voz é visível antes de entrar.
5. A comunidade grande depende de **gambiarras**: canais de voz bloqueados como mostrador de estatística, emojis e separadores Unicode como design, e canal "isca" ("não envie aqui", quem enviar é banido automaticamente) como antispam. É sinal de primitivas faltando: ícone de canal, métricas nativas, armadilha de spam nativa.
6. Preservar categorias recolhíveis e a ocupação visível.
7. Melhorar: ícone e cor nativos por canal, um widget de estatísticas nativo e uma "armadilha antispam" nativa. **Clicar numa sala de voz mostra uma prévia (quem está, qualidade) antes de entrar.**
8. Diferencial alto: entrar na voz por engano é uma dor clássica.
9. Média.
10. `aria-label` dos canais: "(categoria)", "(canal de texto)", "(canal de voz)", "(canal de fórum)", com as contagens acima.

### PX-08 — Fórum
**Testado (observado na sessão)**
1. Conversas assíncronas que duram, organizadas em posts.
2. No topo ficam "Buscar ou criar postagem" e o botão "Nova postagem". "Ordenar e ver" oferece *Ordenar por* (Ativos recentemente, Data de postagem), *Ver como* (Lista, Galeria) e "Redefinir para padrão". Os cards mostram título, autor, prévia, miniatura, reações, respostas e tempo. Há a seção "Postagens mais antigas".
3. Abrir canal > ver cards > (abrir post não foi feito).
4. O campo de busca também cria post, o que reduz posts duplicados. Os cards são escaneáveis e o modo galeria é bom para conteúdo visual.
5. Fica escondido como "mais um canal". A descoberta depende de fixar posts de regras.
6. Preservar a busca que também cria e a ordenação por atividade.
7. Melhorar: resumo ("o que mudou desde sua última visita") e marcar post como resolvido ou útil.
8. Diferencial médio.
9. Alta (threads, tags, indexação).
10. Botões "Nova postagem" e "Ordenar e ver", com o texto do menu acima.

### PX-09 — "Conferir Canais" e lista de canais personalizada
**Testado (observado na sessão)**
1. Deixar o membro escolher o que vê em servidores grandes.
2. A rota `/channels/<id>/channel-browser` mostra "Escolha seus canais". Cada canal tem uma caixa de seleção e "Ativo há X". Cada categoria tem o toggle **"Seguir categoria"**. A barra lateral ganha uma seção "Sugestões" (canais recomendados, que podem ser dispensados) e uma faixa "Este canal não está na sua lista de canais — Adicionar à lista de canais".
3. Barra lateral > Conferir Canais > marcar/desmarcar.
4. Mostra **recência da atividade por canal** para ajudar a decidir. A dica avisa que "canais com menções vão aparecer mesmo se ocultos". É o melhor antídoto do Discord contra a sobrecarga.
5. Fica enterrado e é opcional. Quem mais precisa não sabe que existe.
6. Preservar o "seguir" por canal e por categoria com recência.
7. Melhorar: "Seguir" como padrão para espaços grandes, com o app sugerindo depois de N dias ("você não abre #x há 30 dias — deixar de seguir?").
8. Diferencial alto contra a fadiga de notificações.
9. Média.
10. Rota `channel-browser`, título "Escolha seus canais", 7 caixas e toggles visíveis, rótulo "Seguir categoria".

### PX-10 — Mensagens de sistema e "Acene para dizer olá"
**Testado (observado na sessão)**
1. Transformar eventos (entrada, impulso) em momentos sociais.
2. Uma entrada gera uma mensagem aleatória ("X acabou de aparecer", "Bem-vindo(a)...") com o botão **"Acene para dizer olá!"** (responde com figurinha em 1 clique). Impulsos geram "X acabou de impulsionar o servidor!" e "Servidor atingiu Nível N". O divisor vermelho "NOVAS" marca onde a leitura parou.
3. Passivo, porque aparece no fluxo do chat.
4. Dá uma resposta social **de custo zero** ao recém-chegado. O texto aleatório evita repetição.
5. Em canais movimentados vira ruído. O canal só de impulsos parece um mural de patrocinadores.
6. Preservar o aceno em 1 clique.
7. Melhorar: juntar entradas ("3 pessoas chegaram hoje — acenar para todas") e dar ao recém-chegado um "primeiro passo" concreto.
8. Diferencial médio.
9. Baixa.
10. Botão "Acene para dizer olá!" e o divisor "NOVAS" (ver também PX-18).

### PX-11 — Mensagens de usuários ignorados
**Testado (observado na sessão)**
1. Esconder alguém sem bloquear.
2. Num canal, cerca de 15 linhas seguidas de "1 mensagem ignorada — Mostrar", cada uma sob seu divisor de data.
3. Passivo. "Mostrar" revela a mensagem.
4. Mantém a pessoa em controle (revela só se quiser).
5. **Não agrupa:** um canal pode virar uma parede de placeholders.
6. Preservar o "ocultar com opção de revelar".
7. Melhorar: juntar em "N mensagens ocultas neste período".
8. Diferencial baixo, mas é um polimento visível.
9. Baixa.
10. Texto "1 mensagem ignorada — Mostrar", repetido cerca de 15 vezes num canal.

### PX-12 — Lista de membros por cargo
**Testado (observado na sessão)**
1. Ver quem está aqui e qual papel cada um tem.
2. É agrupada por cargos "exibidos separadamente", com contagem (ex.: "Moderador — 1", um cargo patrocinado — 1, "Bots — 4", "Membro — 232", dos ~6,4 mil, então só online). As linhas exibem placas de nome decorativas, tags de servidor, selos "APP" em bots e atividade.
3. Botão "Mostrar/Ocultar lista de membros" (Ctrl+U), com painel de ~264 px.
4. A hierarquia social fica legível de relance. A lista mostra só quem está online, o que dá escala.
5. Com cosméticos (placas, tags, efeitos) a lista fica **visualmente barulhenta** e perde a legibilidade.
6. Preservar o agrupamento por papel com contagem.
7. Melhorar: limitar a intensidade de cosméticos em listas densas (dar ênfase no popout, não na lista).
8. Diferencial médio (estética Linear: calma).
9. Média (precisa de lista virtualizada).
10. Cabeçalhos "Moderador, 1 membro", "Bots, 4 membros", "Membro, 232 membros".

### PX-13 — Caixa de entrada
**Testado (observado na sessão)**
1. Um lugar único para o que pede sua atenção.
2. Popout de 480 px, com 4 abas: **Não lidas, Menções, Favoritos, Lembretes**. Botões "Marcar tudo como lido" e "Config. de notificação". Cada item tem "Marcar como lida". No topo há um cartão pedindo para ativar notificações do desktop. Ctrl+I abre e Ctrl+Shift+E marca tudo como lido.
3. Botão do cabeçalho > aba > item > pular para o contexto.
4. "Lembretes" (lembrar depois) e "Não lidas" por canal com ação de lote.
5. É um popout, não uma tela. Com 48 itens fica uma rolagem longa. Mistura servidores sem prioridade.
6. Preservar as abas por intenção e o "lembrar depois".
7. Melhorar: inbox como tela (no estilo Linear Inbox), com triagem por teclado (lido, adiar, abrir) e agrupamento por espaço e pessoa.
8. Diferencial alto.
9. Média a alta.
10. Abas `[role=tab]` = "Não lidas, Menções, Favoritos, Lembretes". Largura 480 px.

### PX-14 — Indicadores de não lido e menção
**Testado (observado na sessão)**
1. Mostrar onde há algo novo.
2. Os ícones de servidor têm contador vermelho (3, 68) ou ponto branco. Os canais têm contador (68) e o nome em negrito. Há um marcador de "não lido" na lateral do trilho e o **título da aba "(72) Discord"**. O canal ganha o divisor "NOVAS". Em Configurações > Notificações > Insígnias fica "Ativar indicador de mensagens não lidas".
3. Passivo.
4. Separa claramente o volume (ponto) da relevância (número de menções).
5. Números como "68" geram ansiedade e quase nunca são lidos. "(72)" no título é pressão constante.
6. Preservar a separação entre ponto (novidade) e número (me chamaram).
7. Melhorar: limitar a exibição ("9+"), um modo "foco" que oculta pontos e "pegar o fio" com resumo em vez de contagem.
8. Diferencial médio a alto (bem-estar).
9. Baixa.
10. Título da aba "(72) Discord | Amigos". Rótulos "3 menções" e "68 menções".

### PX-15 — Busca
**Testado (observado na sessão)**
1. Achar o que foi dito.
2. Ao focar o campo "Buscar <servidor>", aparece o popout "Filtros": `de:` usuário, `em:` canal, `tem:` link/anexo/arquivo, `menciona:` usuário, e "Mais filtros — datas, tipo de autor e muito mais".
3. Clique > filtros sugeridos > (digitar não foi feito).
4. Ensina a sintaxe dentro da própria UI, com o mesmo padrão dos prefixos do Ctrl+K.
5. Fica separada do Quick Switcher. São duas buscas com sintaxes diferentes.
6. Preservar os operadores ensinados no momento do uso.
7. Melhorar: **uma** caixa (paleta) que busca lugares, pessoas, mensagens e ações. Filtros como chips.
8. Diferencial alto (junto com PX-02).
9. Alta (indexação full-text de mensagens).
10. Texto do popout listado acima.

### PX-16 — Configurações do usuário
**Testado (observado na sessão)**
1. Controlar conta, privacidade e experiência.
2. Modal de tela cheia com busca ("Buscar") e **4 grupos com cerca de 19 seções**:
   - Conta: Informações, Senha e segurança, Status da conta, Central da Família, Dados e privacidade, Permissões de mensagens, Notificações;
   - Cobrança: Nitro, Impulso de servidor, Assinaturas, Inventário de presentes, Cobrança;
   - Experiência: Voz e vídeo, Aparência, Acessibilidade, Sistema, Idioma e Horário;
   - Jogos e apps: Privacidade nas atividades, Apps conectados;
   - mais Desenvolvedor e Sair.

   Densidade de controles (switches): Voz e vídeo 28, Aparência 20, Notificações 17, Acessibilidade 12, Privacidade nas atividades 10, Permissões de mensagens 9, Dados e privacidade 7.
3. Engrenagem (1 clique) > seção.
4. A reorganização de 2025 é boa: grupos semânticos, busca, "Configurações relacionadas" no pé de cada página (ligações cruzadas) e prévia ao vivo em Acessibilidade. "Status da conta" ("Tudo certo!") dá transparência sobre violações. Há controles finos de privacidade (compartilhar perfil completo com "Amigos e todos os servidores / servidores pequenos / apenas amigos", e atividade em servidores "com 200 membros ou menos").
5. São mais de 100 switches. "Voz e vídeo" sozinho tem 28. A seção **Cobrança vem antes de Experiência**. Notificações misturam desktop, sons, insígnias e 6 tipos de e-mail de marketing. Na web, "Apertar para Falar (limitado)".
6. Preservar a busca, os grupos, as ligações cruzadas e os limiares de privacidade por tamanho de servidor.
7. Melhorar: padrões fortes e menos switches, com "Avançado" recolhido. Experiência antes de Cobrança. Teste de mic integrado no topo da voz.
8. Diferencial médio.
9. Média.
10. Barra lateral lida via DOM. Switches contados por `input[type=checkbox]`.

### PX-17 — Configurações do servidor filtradas por permissão
**Testado (observado na sessão, parcial)**
1. Mostrar só o que você pode administrar.
2. Com um cargo parcial, as configurações do servidor exibem só: Perfil do servidor, Engajamento, Vantagens de Impulso, Emoji, Figurinhas, Painel de efeitos sonoros e Diretório de Apps. Cargos, AutoMod, auditoria e Onboarding **não aparecem** (não ficam desabilitados, somem).
3. Menu do servidor > Config. do servidor.
4. O Perfil do servidor tem **prévia ao vivo** do card de convite/descoberta à direita (nome, ícone, faixa com 11 cores ou imagem, até 5 "Características" como tags, descrição).
5. Esconder o que falta impede o usuário de saber o que existe e quem pode fazer.
6. Preservar a UI filtrada por permissão e a prévia ao vivo.
7. Melhorar: mostrar seções bloqueadas com "peça a um admin" (transparência), em vez de ocultá-las.
8. Diferencial baixo a médio.
9. Média (depende do modelo de permissões).
10. Barra lateral: "Perfil do servidor | Engajamento | Vantagens de Impulso | Expressões: Emoji, Figurinhas, Painel de efeitos sonoros | Apps: Diretório de Apps".

### PX-18 — Engajamento (configurações do servidor)
**Testado (observado na sessão)**
1. Ajustar o comportamento social padrão do servidor.
2. Inclui: mensagem aleatória de boas-vindas; incentivar resposta com figurinha; mensagem em impulsos; "dicas úteis para configuração"; canal de mensagens do sistema; **"Exibir feed de atividade neste servidor"**; notificação padrão ("Todas as mensagens / Apenas @menções"); canal de ausentes e limite de ausência; prévia ao vivo do chat no topo.
3. Config. do servidor > Engajamento.
4. A notificação padrão por servidor (Apenas @menções) é a alavanca mais importante contra ruído, e fica nas mãos do dono.
5. O padrão "Todas as mensagens" em servidores pequenos gera sobrecarga quando o servidor cresce.
6. Preservar a notificação padrão definida pelo servidor.
7. Melhorar: padrão adaptativo (todas até N membros, depois só menções) e avisar o dono quando o tamanho cruzar o limiar.
8. Diferencial médio.
9. Baixa.
10. Rótulos listados acima.

### PX-19 — MFA obrigatório para moderadores
**Testado (observado na sessão)**
1. Proteger servidores contra moderadores com conta comprometida.
2. Um cartão fixo no topo da barra lateral ("Este servidor exige que membros com poderes de moderação tenham Autenticação Multifatorial. Você não pode realizar nenhuma ação de moderação até ativá-lo.") com o botão "Resolver".
3. Passivo, com 1 clique para resolver.
4. É uma política clara, que explica a consequência e traz a ação no lugar.
5. Ocupa espaço permanente da barra lateral.
6. Preservar o "bloqueio explicado, com conserto em 1 clique".
7. Melhorar: o cartão poder ser recolhido para um ponto de aviso.
8. Baixo.
9. Média (MFA).
10. Texto do cartão e botão "Resolver".

### PX-20 — Criar servidor com moldes
**Testado (observado na sessão)**
1. Reduzir a página em branco.
2. Modal "Criar seu servidor" com "Criar o meu" e "Começar de um molde" (Jogos, Amigos, Grupo de estudos, Clube escolar, Comunidade Local, Artistas e Criadores), além de "Já tem um convite? Entrar em um servidor". Ctrl+Shift+N abre direto.
3. "+" no trilho (1 clique).
4. Moldes por intenção e "entrar com convite" no mesmo lugar.
5. O molde só cria canais. Não configura notificação, cargos nem regras.
6. Preservar a intenção como ponto de partida.
7. Melhorar: molde que configura **tudo** (canais, voz, notificação padrão, cargos simples) e cria uma mensagem de convite pronta para WhatsApp (o Brasil compartilha por WhatsApp).
8. Diferencial alto no mercado BR.
9. Baixa a média.
10. Texto do modal listado acima.

### PX-21 — Descobrir (servidores e apps)
**Testado (observado na sessão)**
1. Achar comunidades e apps.
2. Na rota `/discovery/servers` há a busca e as categorias Início, Gamer, Música, Entretenimento, Ciência e Tecnologia, Educação e Centrais de Estudantes. "Servidores em Destaque" mostra cards com faixa, selo de verificado, descrição, **N online** e **N membros** (milhões). Em `/discovery/applications` aparece primeiro uma **Missão patrocinada**, depois "Encontre coisas para fazer juntos" e cerca de 9 prateleiras (Promoted Games, Puzzle, Card, Strategy…). As abas de apps são Destaques, Jogos, Entretenimento, Moderação e ferramentas, e Mais.
3. Ícone de bússola no trilho > aba.
4. A prova social (online/membros) e as prateleiras por intenção ("Chill Together").
5. É dominado por megacomunidades e conteúdo promovido. Nada para "pequeno e perto de mim". Há títulos em inglês dentro da UI em pt-BR.
6. Preservar a prova social e as intenções.
7. Melhorar: descoberta **local e por afinidade** (cidade, faculdade, jogo + região BR) e comunidades pequenas ativas.
8. Diferencial alto no BR, mas depende de massa crítica (P3 no início).
9. Alta (moderação de catálogo).
10. Rótulos das abas e dos cabeçalhos listados acima.

### PX-22 — Nitro, Impulsos e presentes
**Testado (observado na sessão)**
1. Monetização por assinatura individual e por comunidade.
2. Nitro Básico **R$ 8,90/mês** (50 MB, emoji em qualquer lugar, super-reações, insígnia) e Nitro **R$ 24,99/mês** (1 GB, HD, 2 impulsos, perfis), com "Adicionar à Lista de desejos", "Presentear Nitro" e "Cancele a qualquer momento". Impulsos: níveis 1/2/3 com 2/7/14 impulsos. A tabela por nível tem emoji 100/150/250, figurinhas 15/30/60, sons 24/36/48, transmissão 720p60/1080p60, áudio 128/256/384 kbps, envio 10/50/100 MB, assentos no palco 50/300, mais ícone animado, faixa e convite personalizado. A barra lateral do servidor mostra "Objetivo de impulso 4/33 Impulsos". O Inventário de presentes tem resgate de código e uma **insígnia que progride ao presentear** (6 graus, de 1× a 20×).
3. Configurações > Cobrança > seção, ou o 1º item do menu do servidor.
4. Os impulsos transformam pagar em **contribuir para o grupo** (qualidade de voz e tela para todos). Presentear é social. A tabela de níveis é transparente.
5. A meta "4/33" é um objetivo sem fim visível. A insígnia de presentear gamifica gasto. O upsell está em muitas superfícies (Home, popout, menu, Missões "1,2x").
6. Preservar o "pago melhora para o grupo".
7. Melhorar: uma meta de grupo clara e finita ("faltam 3 para áudio 256 kbps"), sem insígnias de gasto e com upsell só no contexto da limitação.
8. Diferencial alto (monetização honesta, alinhada ao track do dono).
9. Média (cobrança + direitos por espaço).
10. Textos e preços em Configurações > Nitro, Impulso de servidor e Inventário de presentes.

### PX-23 — Missões (Quests) e Orbs
**Testado (observado na sessão)**
1. Mídia patrocinada que paga o usuário em moeda virtual.
2. A página `/quest-home` tem as abas "Todas as Missões" e "Missões Resgatadas", e cerca de **16 missões** (estavam visíveis 13 anunciantes distintos). Cada card traz "Promovido por", prazo ("Termina em 05/11"), recompensa ("Reivindique 700 Orbs", item de jogo, token), **"Desbloquear 1,2x"** (multiplicador para Nitro), tarefa (jogar 15 min, assistir a um vídeo de 14 s), "Aceitar missão" e "Jogar agora". O saldo de Orbs aparece no popout e na Loja (200).
3. Home > Missões. Também aparece embaixo da barra lateral ("Receber recompensa") e no topo de Descobrir > Apps.
4. Recompensas tangíveis e tarefas curtas.
5. É publicidade com gamificação e **prazos curtos** (urgência), e o multiplicador empurra para o Nitro.
6. Preservar só a ideia de "recompensa por algo útil".
7. Melhorar: se fizermos algo assim, que seja recompensa por contribuição na comunidade, nunca por ver anúncio.
8. Diferencial: **não fazer** também é posição.
9. Alta (rede de anunciantes). Fora do escopo.
10. Textos dos cards listados acima.

### PX-24 — Loja
**Testado (observado na sessão)**
1. Venda de cosméticos.
2. Abas Destaques, Navegar (menu), Loja de Orbs e Lojas do jogo, mais busca, lista de desejos e saldo de Orbs. Os pacotes trazem desconto ("R$ 72,90 (-37%)") e **contagem regressiva** ("9 DIAS RESTANTES"). Há um botão "Embaralhar!" e itens de R$ 25,90 a R$ 72,90.
3. Home > Loja.
4. Prévia visual forte e coleções temáticas (licenciadas).
5. Escassez artificial (contadores), descontos ancorados e pacotes.
6. Preservar a prévia antes de comprar e a lista de desejos (já estão no estudo de perfil).
7. Melhorar: preço fixo e honesto, sem contador e com prova antes da compra.
8. Já coberto em `discord-profile-study.md`.
9. —
10. Rótulos dos botões "Comprar por R$ …" e o selo "9 DIAS RESTANTES".

### PX-25 — Popout da própria conta
**Testado (observado na sessão)**
1. Acesso rápido a identidade e status.
2. Clicar no avatar do painel abre um card com faixa, avatar e o balão "Qual é a sua vibe atualmente?". Em seguida vêm o cartão de **upsell** "Faça seu perfil bombar — Obter o Nitro / Loja", "Coleção de jogos", "Editar perfil (NOVO)", status "Disponível ›", "Insígnias", "200 Orbs (NOVO)" e "Mudar de conta".
3. 1 clique.
4. Status e troca de conta à mão. A "vibe" como status curto e expressivo.
5. **Upsell acima das funções**, e 2 selos "NOVO" competindo por atenção.
6. Preservar o status rápido e a vibe.
7. Melhorar: o popout serve a identidade, e a monetização fica em outro lugar.
8. Médio.
9. Baixa.
10. Itens listados acima.

### PX-26 — Acessibilidade
**Testado (observado na sessão)**
1. Tornar o app usável para todos.
2. Tem prévia ao vivo no topo. **Tamanho do texto no chat** (12/14/15/16/18/20/24 px), "Sempre sublinhar links", "Estilos de nome exibido", **Densidade** (Compacto/Padrão/Espaçoso), espaço entre grupos (0/4/8 px), **Saturação** (0–100% em passos de 10, com opção de aplicar às cores personalizadas), alto contraste, sincronizar contraste, cores dos cargos, indicadores ligar/desligar, **movimento reduzido** (com "Sincronizar com computador"), duração mínima de notificação, GIF/emoji/figurinha animados (Animar sempre / ao interagir / Nunca), taxa de TTS, descrições de imagens e "entrada de chat padrão".
3. Configurações > Acessibilidade.
4. É abrangente, tem prévia ao vivo e sincroniza com o SO. É a melhor seção do app.
5. Fica escondida no meio de 19 seções e duplica parte de Aparência.
6. Preservar tudo isso como piso.
7. Melhorar: oferecer isso **no onboarding** ("como você prefere ver?") e respeitar `prefers-reduced-motion` desde o primeiro boot.
8. Diferencial médio.
9. Média.
10. Rótulos listados acima. 12 switches e cerca de 17 controles segmentados.

### PX-27 — Controles de voz fora da chamada
**Testado (observado fora da chamada)**
1. Preparar o áudio antes de entrar.
2. O painel tem mic e fone, cada um com uma seta que abre um menu. O menu de entrada traz "Dispositivo de entrada", "Perfil de entrada" (Isolamento de Voz/Estúdio/Personalizado), "Volume de entrada" e "Configurações de voz". Configurações > Voz e vídeo tem cerca de 28 switches, 1 slider, um painel de efeitos sonoros e "Mostrar 18 mais sons" (sons de mutar/desmutar personalizáveis).
3. 1 clique na seta.
4. Trocar de dispositivo sem abrir as configurações. Os perfis de entrada escondem a complexidade (Isolamento de Voz vs Estúdio).
5. Não há **teste de microfone** no menu rápido. A UI dentro da chamada não foi observada.
6. Preservar os perfis de entrada e o menu rápido de dispositivo.
7. Melhorar: medidor de nível e "ouvir a mim mesmo" no menu rápido, e um check pré-voz ("seu mic está ok").
8. Diferencial médio a alto (a qualidade de voz é nosso foco).
9. Média.
10. Menu `[role=menu]` do botão "Opções de entrada".

---

## 4. Crítica de UX/UI por dimensão

### 4.1 Arquitetura de informação
- **Hierarquia clara e profunda:** trilho, servidor, categoria, canal e conteúdo, com painel direito opcional. A maioria dos destinos fica a **1–2 cliques** (configurações 1, criar servidor 1, inbox 1, filtros de busca 1, convidar 2, configurações do servidor 2).
- A Home mistura o social (Amigos), o comercial (Nitro, Loja) e a publicidade (Missões). **Metade das entradas fixas da Home é comercial.**
- Há duplicações: menu do ícone e menu do cabeçalho do servidor; busca e Quick Switcher; Aparência e Acessibilidade.

### 4.2 Interação
- Teclado excelente (~46 atalhos, configuráveis). O Quick Switcher é útil antes da primeira tecla.
- Menus de contexto consistentes (leitura no topo, destrutivo no fim), mas longos (até 14 itens).
- **Riscos de ação implícita:** "qualquer tecla foca o compositor" (dispara "digitando"), "Esc marca como lido" e "clicar na voz entra".
- O feedback vem como prévia ao vivo nas configurações (Acessibilidade, Engajamento, Perfil do servidor), o que é um padrão excelente.

### 4.3 Design visual (medido)
- Fonte proprietária com fallback para Noto Sans. Body com 16 px.
- **Escala tipográfica real em uso:** 16/500/20 (dominante, 39 ocorrências), 12/600/16 (rótulos, 24), 16/600/20 (títulos de linha, 11), 12/400/16, 14/500/18, 20/600/24 (título). Na prática são **4 tamanhos (12/14/16/20)** e 3 pesos (400/500/600).
- Espaço com grade de 4 px e tokens nomeados (xxs=4, xs=8, sm=12, md=16, lg=20, xl=24, xxl=32), mas com valores fora da grade (6, 10, 26, 30).
- Raios de 4/8/12/16/24/32. Cor de marca `hsl(235 86% 65%)` (índigo saturado). O texto muted é um cinza azulado.
- Motion: expandir 100 ms ease-out, recolher 150 ms ease-in, botões 170 ms e mola "subtle" de ~600 ms.
- **O problema não está na base, está na camada de cima:** emojis e Unicode como ícones de canal, placas de nome, tags, banners, selos "NOVO" e faixa verde de download competem entre si. A base é sóbria, mas a superfície é barulhenta.

### 4.4 Experiência emocional
- **Agradável:** "Acene para dizer olá", "Ativo agora", easter eggs, a "vibe" no status e os textos aleatórios de boas-vindas. Tudo isso dá calor humano.
- **Confiável:** "Status da conta — Tudo certo!", MFA explicado, "Ignorar" e "Bloquear" graduados, limiares de privacidade por tamanho de servidor.
- **Desgastante:** contadores grandes, "(72)" no título, upsell no popout e no menu, missões com prazo.

### 4.5 Retenção
| Mecanismo | Saudável? | Por quê |
|---|---|---|
| Presença e "Ativo agora" | Sim | Gera valor real ("meus amigos estão lá") |
| "Compartilhe quando eu ficar disponível" (push para amigos) | Sim, com controle | É opt-in e social |
| Aniversário de amizade (notificação) | Neutro | É afetivo, mas fabrica um motivo |
| Contadores de menção e "(72)" | Parcial | Útil quando é menção, ansiogênico quando é volume |
| Missões com prazo e multiplicador Nitro | **Manipulativo** | Urgência mais publicidade gamificada |
| Loja com "9 DIAS RESTANTES" e "-37%" | **Manipulativo** | Escassez e âncora de preço |
| Insígnia de progressão por presentes | **Manipulativo leve** | Gamifica gasto |
| Meta de impulso "4/33" | Parcial | É social, mas o objetivo é aberto e sem fim |
| 6 tipos de e-mail de marketing ligados por padrão | Parcial | Tem opt-out, mas é ruído |

### 4.6 Usabilidade
- **Excelentes:** Quick Switcher, Conferir Canais, Acessibilidade, prévias ao vivo, o aceno de boas-vindas e a troca rápida de dispositivo de áudio.
- **Complexos demais:** Configurações > Voz e vídeo (28 switches), Notificações (17 switches e 3 níveis: global, servidor, canal), menu de DM com 14 itens.
- **A repensar:** entrar na voz com um clique sem prévia, gambiarras de comunidade (contadores por bot, canal-isca, emoji como ícone) e duas buscas.

---

## 5. Princípios de produto destilados

1. **Lugares persistentes, não chamadas.** A sala de voz existe antes e depois de você e mostra a ocupação. Esse é o coração do produto.
2. **A presença é o motor de retorno.** "Ativo agora" e a atividade fazem o usuário voltar porque há gente, não por causa de notificação.
3. **O teclado é cidadão de primeira classe.** O switcher é útil já vazio, os atalhos são abundantes e a sintaxe é ensinada no momento do uso.
4. **Padrão no grupo, ajuste no indivíduo.** O servidor define a notificação padrão, e o membro segue ou deixa de seguir canais.
5. **Prévia ao vivo antes de confirmar.** Configurações e perfil mostram o resultado enquanto você ajusta.
6. **Segurança em níveis.** Ignorar < Silenciar < Bloquear, MFA explicado com "Resolver", limiares de privacidade por tamanho de servidor.
7. **Gestos sociais de custo zero.** Acenar, reagir e figurinhas de boas-vindas.
8. **O pagamento pode ser coletivo.** Os impulsos melhoram a experiência do grupo, e não só do pagante.

## 6. Pontos de fricção e complexidade

| # | Ponto | Evidência | Por que dói |
|---|---|---|---|
| F1 | Clicar na voz entra direto | Canal de voz sem prévia | Entradas acidentais, que todos veem |
| F2 | Qualquer tecla foca o compositor | Atalho "Focalizar área de texto: QUALQUER TECLA" | Dispara "digitando" sem querer |
| F3 | Esc marca como lido | Atalho "Marcar canal como lido: ESC" | Ação com efeito numa tecla de "fechar" |
| F4 | Duas buscas com sintaxes diferentes | Ctrl+K (`@#!*$`) vs Buscar (`de: em: tem:`) | Carga cognitiva |
| F5 | Contadores grandes e "(72)" no título | Badges 68 e 3 | Ansiedade, que acaba ignorada |
| F6 | Mais de 100 switches nas configurações | 28 em Voz, 20 em Aparência, 17 em Notificações | Paralisia e padrões ruins nunca corrigidos |
| F7 | Comércio no chrome do app | Nitro/Loja/Missões na Home, upsell no popout, Impulso no topo do menu, faixa de download | Ruído e desconfiança |
| F8 | Primitivas faltando em comunidades | Voz bloqueada usada como estatística, canal-isca antispam, emoji como ícone | Donos fazem gambiarras |
| F9 | Placeholders de ignorados sem agrupamento | ~15× "1 mensagem ignorada" | Canal poluído |
| F10 | Admin escondido por permissão | Seções somem em vez de bloquear | O moderador não sabe o que existe |

## 7. Oportunidades com pontuação

Escalas: impacto, valor ao usuário e diferenciação de 1 a 5. Confiança da evidência: baixa/média/alta. Esforço: baixo/médio/alto/indeterminado.

| ID | Oportunidade | Base | Prioridade | Impacto | Valor | Dif. | Confiança | Esforço |
|---|---|---|---|---|---|---|---|---|
| OP-01 | **Prévia da sala de voz antes de entrar** (quem está, entrar com 1 clique explícito) | PX-07, F1 | P0 | 5 | 5 | 4 | alta | médio |
| OP-02 | **Paleta de comandos única** (lugares, pessoas, mensagens e ações, com atalhos visíveis) | PX-02, PX-15, F4 | P1 | 4 | 4 | 5 | alta | alto |
| OP-03 | **Home "Agora"** (amigos e salas ativas de todos os espaços) | PX-05 | P1 | 5 | 5 | 4 | alta | médio |
| OP-04 | **Inbox como tela com triagem por teclado** (lido, adiar, abrir) | PX-13 | P1 | 4 | 4 | 4 | alta | médio |
| OP-05 | **Padrões calmos de notificação** (adaptativo por tamanho, "9+", modo foco) | PX-14, PX-18, F5 | P0 | 4 | 5 | 3 | alta | baixo |
| OP-06 | **Seguir canais como padrão em espaços grandes**, com sugestão de deixar de seguir | PX-09 | P2 | 4 | 4 | 4 | alta | médio |
| OP-07 | **Molde que configura tudo** e convite pronto para WhatsApp | PX-20 | P1 | 4 | 4 | 4 | média | baixo |
| OP-08 | **Primitivas de comunidade nativas** (ícone de canal, contador de membros, armadilha antispam) | PX-07, F8 | P2 | 3 | 4 | 4 | alta | médio |
| OP-09 | **Zero comércio no chrome do app.** Upsell só no ponto da limitação | PX-22, PX-25, F7 | P0 | 4 | 4 | 5 | alta | baixo |
| OP-10 | **Meta de grupo finita** ("faltam 3 para áudio 256 kbps"), sem insígnias de gasto | PX-22 | P1 | 4 | 3 | 4 | alta | médio |
| OP-11 | **Configurações com padrões fortes** (≤ ~8 controles visíveis por seção, "Avançado" recolhido), check de mic pré-voz | PX-16, PX-27, F6 | P1 | 4 | 4 | 3 | alta | médio |
| OP-12 | **Acessibilidade no onboarding** e respeito ao SO desde o boot | PX-26 | P1 | 3 | 4 | 3 | alta | baixo |
| OP-13 | **Sem ações implícitas** ("digitando" só com conteúdo, Esc só fecha) | F2, F3 | P0 | 3 | 4 | 2 | alta | baixo |
| OP-14 | **Recados de boas-vindas agrupados** ("3 chegaram hoje — acenar para todos") | PX-10 | P2 | 3 | 3 | 3 | média | baixo |
| OP-15 | **Cosméticos com intensidade contextual** (calmos em listas, expressivos no popout) | PX-12 | P2 | 3 | 3 | 4 | média | baixo |
| OP-16 | **Admin transparente** (seções bloqueadas visíveis com "peça a um admin") | PX-17, F10 | P3 | 2 | 3 | 2 | média | baixo |
| OP-17 | **Descoberta local BR** (cidade, faculdade, jogo + região) | PX-21 | P3 | 4 | 3 | 4 | média | alto |

**Não copiar:** a marca, o mascote, a fonte proprietária, a paleta e os nomes de produto (Nitro, Orbs, Missões, Impulso), nem as mecânicas de escassez e anúncio gamificado (PX-23, PX-24).

## 8. Limitações

- Uma conta, sem Nitro, sem admin pleno: cargos, permissões, AutoMod, auditoria, Onboarding e triagem de regras **não observados**.
- Nada dentro de chamada (voz, vídeo, Go Live, palco, Activities, soundboard em uso): **não observado** por ser visível a terceiros. Isso continua coberto, por fonte própria, em `discord-benchmark.md`.
- Cliente web: o desktop pode ter diferenças (overlay, PTT pleno, que a web marca como "limitado").
- Fluxos de convite, posts de fórum e threads não foram abertos.
- As contagens são um retrato de uma conta num dia e variam com experimentos A/B (a classe `visual-refresh` indica rollout).
- As contagens de switches por seção usam `input[type=checkbox]` e podem incluir controles ocultos da página.

## 9. Fontes

- Observação direta: Discord Web (`discord.com/channels/@me`, `/discovery/servers`, `/discovery/applications`, `/quest-home`, `/shop`, `/channels/<id>/channel-browser`), Configurações do usuário e Configurações do servidor (acesso parcial), 2026-11-05, via Claude in Chrome na sessão do dono.
- Documentos internos lidos para evitar repetição: `docs/research/discord-benchmark.md` e `docs/research/discord-profile-study.md`.
- Nenhuma documentação oficial foi usada como fonte de afirmação neste documento.
