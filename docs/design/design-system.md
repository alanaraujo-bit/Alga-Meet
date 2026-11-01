# Alga Meet — Design system

> Referência viva das telas. Direção: `docs/research/linear-design-study.md` §17 (régua de qualidade Linear, identidade própria).
> Código: tokens em `apps/desktop/src/renderer/src/styles/tokens.css`, componentes em `apps/desktop/src/renderer/src/ui/`.
> Evidência: screenshots do app real em `docs/screenshots/` (gerados por `apps/desktop/scripts/screenshot.mjs`; versões antigas ficam guardadas).

## 1. Princípios aplicados

1. **O palco manda, o cromo recua.** Rail (nível 0) < lista de canais (nível 1) < conversa/palco (nível 2). A "folha" de trabalho (sidebar + conteúdo) tem canto superior esquerdo arredondado sobre o cromo, com borda de 6% de branco.
2. **Hierarquia por luminância.** Quatro degraus de texto e seis de superfície. Cor saturada só para estado: falando, mudo, ao vivo, erro, menção.
3. **Seleção neutra.** Item ativo = `--state-selected` (branco 7%) + `--text-primary`. Nunca acento em lista.
4. **O acento é a voz.** Bioluminescência (teal-ciano, H≈195) aparece em: foco, menção, ação primária, presença de voz, brilho de quem fala. Texto sobre preenchimento de acento é sempre escuro (`--on-accent`).
5. **Resposta direta é instantânea.** Hover entra em 0 ms e sai em 120 ms; seleção em lista muda no mesmo quadro. Só mudança de contexto anima (≤ 300 ms, ease-out).
6. **Progresso no lugar da ação.** "Enviando…" no próprio balão, "Não enviada · Tentar de novo" na mensagem, banner de reconexão com contagem regressiva, splash que explica a falha. Spinner sem texto é bug.
7. **Estado nunca só por cor.** Presença tem forma (ponto, lua, barra, anel); mudo/ensurdecido têm ícone riscado + tooltip; não lido = peso 590 + ponto de 6 px.
8. **Voz e presença primeiro.** O esqueleto continua familiar para quem vem do Discord (espaços à esquerda, canais, chat), mas o que o produto mostra primeiro é *onde as pessoas estão agora*: "Agora" no topo da Home, frondes vivas no rail e nos canais de voz, painel "Voz conectada" sempre visível, palco de chamada como tela principal do canal de voz.
9. **A UI nunca mente sobre o estado.** Sem conexão de tempo real, presença fica incerta (ponto a 40 %) e o status diz "Reconectando…"; sem mídia, os tiles ficam cinza, sem brilho, e o palco diz que você não está ouvindo ninguém.

## 2. Tokens

### Superfícies (OKLCH H 230, C ≈ 0.006 — "água profunda")

| Token | Hex | Uso |
|---|---|---|
| `--bg-app` | `#080b0c` | janela, title bar, rail |
| `--bg-sidebar` | `#0e1113` | lista de canais/DMs, lista de membros |
| `--bg-content` | `#121517` | conversa, palco de voz |
| `--bg-raised` | `#191c1e` | cards, inputs, composer |
| `--bg-overlay` | `#1f2426` | popover, menu, tooltip |
| `--bg-modal` | `#23272a` | modal (scrim `rgba(0,0,0,.6)`) |

Overlays de estado sobre qualquer nível: `--state-hover` 4%, `--state-selected` 7%, `--state-pressed` 10%.

### Texto

| Token | Hex | Contraste em `bg-modal` | Uso |
|---|---|---|---|
| `--text-primary` | `#f1f4f6` | 13,6:1 | títulos, nomes, item ativo |
| `--text-secondary` | `#c9cfd2` | 9,6:1 | corpo de mensagem, itens com hover |
| `--text-tertiary` | `#98a0a3` | 5,7:1 | metadados, rótulos de seção, placeholders |
| `--text-disabled` | `#636a6e` | — | só desabilitado/decorativo, nunca informação |

### Bordas, acento e semântica

- Bordas translúcidas: `--border-subtle` 6%, `--border-default` 9%, `--border-strong` 14%. Antes de pôr uma linha, tente espaço.
- Acento: `--accent #4ddcdc` (texto/ícone), `--accent-fill #21c9ca` (+ `--on-accent #061415`), `--accent-pressed #38b3b3`, `--accent-tint` 10%.
- Semântica: `--online #4fce74`, `--idle/--warning #fdbe45`, `--dnd/--danger #f75d59`, `--offline #7b8387`.
- **Vermelho só para @menção e erro** (e perigo: sair, desconectar, recusar). Contadores informativos (pedidos, DMs não lidas, Pendentes) usam `Badge` neutro (branco 14 %); `Badge mention` é o vermelho. A linha "Novas" é acento a 45 % com o rótulo "furando" a linha.
- **Ao vivo = acento.** "AO VIVO" é preenchimento `--accent-fill` + texto escuro, com ponto que respira. Transmitir é um sinal de voz, não um alarme.
- **Avatares:** 8 matizes OKLCH (L .50, C .07, H 150–338, pula a faixa 40–110 que vira marrom). Espaços sem ícone usam o mesmo hash como tinta de 12 % (`tintFor`). Em 20 px ou menos, só o disco de cor.
- **Mistura de cor em sRGB.** `color-mix(in oklch, X, transparent)` desloca o matiz no Chromium (o cartão de login ficou marrom na v1). Use `in srgb` ou `rgba()`.

### Tipografia

Inter Variable embarcada (`@fontsource-variable/inter`, eixo `opsz`), `font-feature-settings: 'cv11', 'ss01', 'calt'`, números tabulares (`.tnum`) em horários, contadores e badges.

| Token | Tamanho/linha | Peso | Uso |
|---|---|---|---|
| `--type-badge` | 11/14 | 590 | badges, contadores |
| `--type-meta` | 12/16 | 400–510 | horários, cabeçalhos de seção |
| `--type-ui` | 13/20 | 400–510 | listas, menus, botões, inputs |
| `--type-ui-lg` | 14/20 | 510–590 | nome de canal no header, autores |
| `--type-message` | 15/22 | 400 | corpo de mensagem |
| `--type-title-sm` | 17/24 | 590 | títulos de seção/painel |
| `--type-title` | 20/28 | 590 | título de modal |
| `--type-title-lg` | 24/32 | 590 | login, intro de canal |
| `--type-display` | 32/40 | 590 | onboarding |

Tracking negativo cresce com o tamanho (−0,005em → −0,022em).

### Espaço, raio, alturas, camadas

- Espaço (base 4): `--s-0_5` 2 · `--s-1` 4 · `--s-1_5` 6 · `--s-2` 8 · `--s-3` 12 · `--s-4` 16 · `--s-5` 20 · `--s-6` 24 · `--s-8` 32 …
- Raio concêntrico: `xs 4` (badge, código) · `sm 6` (item de menu) · `md 8` (linha, botão, input) · `lg 12` (card, menu, popover, rail) · `xl 16` (modal) · `full`. Menu 12 = item 6 + padding 6.
- Alturas: 24 compacto · **28 linha de lista** · 32 botão/input · 36 botão primário/input de formulário · 40 controles de chamada.
- Layout: title bar 40 (140 px à direita livres para os botões nativos), rail 64, sidebar 248, membros 240, header 48. Lista de membros some abaixo de 1100 px.
- z-index: `sticky 100 · titlebar 200 · call-overlay 300 · overlay 500 · popover 600 · command-palette 650 · modal-scrim 699 · modal 700 · toast 800 · tooltip 1100 · context-menu 1200`.

### Elevação

Profundidade no escuro = luminância + borda translúcida + anel escuro. `--elev-overlay` (menus, tooltip, popover, toast) e `--elev-modal` (modal, switcher). Cards no nível 3 não têm sombra, só borda.

## 3. Movimento

| Token | Duração | Curva | Uso |
|---|---|---|---|
| `--dur-fast` | 100 ms | out-quad | cor/fundo no hover, press |
| `--dur-hover-out` | 120 ms | out-quad | saída do highlight (entrada é 0 ms) |
| `--dur-base` | 160 ms | out-quad | switch, seta de card |
| `--dur-pop` | 180 ms | out-quart | menu, tooltip, popover (scale .97 → 1 + fade) |
| `--dur-morph` | 220 ms | out-quart | pílula do rail, segmented control |
| `--dur-panel` | 300 ms | sheet `(.32,.72,0,1)` | modal |

- Saída ≈ 0,75× a entrada, curva in-quad.
- **Troca de espaço:** a folha entra 10 px na direção do item do rail escolhido (continuidade espacial), 180 ms, sem animação de saída.
- **Brilho de quem fala:** `useEnvelope(ref, getLevel)` aplica envelope tipo compressor (ataque 60 ms, release 240 ms) direto em `--speak`, num rAF, sem re-render. Não é anel liga/desliga. O tile do palco recebe o envelope e tudo dentro dele herda (`--speak` não é redefinido no avatar): contorno interno de 2 px em `--accent` com `opacity: min(1, speak × 2.5)` e o halo do avatar. O nível remoto do SFU é amplitude linear (fala ≈ 0,03–0,3), então vira dB (−50 dB → 0, −20 dB → 1, `loudness()`) para o brilho de outra pessoa ser tão legível quanto o seu. Com movimento reduzido, o valor salta entre 0 e 1 (estado visível, sem movimento contínuo).
- **Frondes (`Fronds`):** o glifo de 3 barras do logo é a linguagem de "vivo/falando". `getLevel` = barras seguem o envelope (sua sala); `breathing` = respiração lenta para "tem gente aqui agora" (salas onde você não está, cujo nível não conhecemos); sem nada = ícone estático.
- **Entrar/sair da chamada:** tile cresce de 96 % + fade em 180 ms (out-quart), sai em 130 ms; a grade se reorganiza com `layout` em 220 ms (in-out-cubic). Mudo/desmudo é resposta direta: muda no mesmo quadro.
- `prefers-reduced-motion` **e** a opção "Reduzir animações" (classe `html.reduce-motion`, menu de configurações do painel do usuário) zeram durações CSS e mudam o `MotionConfig` para `always`.

## 4. Componentes (`src/renderer/src/ui`)

| Componente | Notas |
|---|---|
| `Button` | `primary` (acento, texto escuro) · `secondary` · `ghost` · `danger`; `sm/md/lg`; `loading` mantém a largura e põe spinner. |
| `IconButton` | Sempre com `label` (vira tooltip + `aria-label`). `disabledReason` mantém o foco e explica por quê (`aria-disabled`). `aria-pressed` para toggles (mudo/ensurdecido). |
| `Icon` | Wrapper do lucide: tamanhos 12–24, traço 1,75 (2 em ≤14 px), `aria-hidden` por padrão. |
| `TextField` | Rótulo, dica, erro (`role=alert`), ícone à esquerda, slot à direita; senha com mostrar/ocultar e aviso de Caps Lock (o aviso não some no blur para não deslocar o botão sob o cursor). |
| `Avatar` | Imagem ou iniciais (matiz estável por id, croma baixo); recorte real sob o ponto de presença (máscara, funciona em qualquer fundo); `glowRef` para o brilho de fala. |
| `PresenceGlyph` | Online = ponto · Ausente = lua · Não perturbe = barra · Offline = anel. |
| `Tooltip` | 450 ms de atraso, instantâneo entre controles vizinhos (janela de 300 ms), aparece no foco por teclado, Esc fecha. |
| `Menu` / `contextMenuHandler` / `MenuButton` | Dados (`MenuEntry[]`), setas/Home/End/typeahead, Enter/Espaço, Esc devolve o foco, separador e rótulo de grupo, item `danger`, `checked`. Um host global (`MenuHost`). |
| `Modal` | Portal, scrim, foco preso (Tab cicla), Esc fecha só o do topo, devolve o foco, `data-autofocus` escolhe o primeiro foco. |
| `Popover` | Conteúdo rico ancorado (status, perfil). Fecha com Esc/clique fora. |
| `toast` / `ToastHost` | `toast.info/success/error(texto, { action })`, pausa no hover. Só para feedback longe do ponto de ação. |
| `Tabs` / `SegmentedControl` | Roving focus com setas; o segmented tem thumb deslizante. |
| `Fronds` | Glifo vivo de 3 barras: `getLevel` (envelope), `breathing` (gente aqui agora) ou estático. |
| `useEnvelope` / `useSpeakingGlow` | Envelope de voz em `--speak` no próprio elemento / no avatar (via `glowRef`). `Avatar glow` desenha o halo herdando `--speak` de um ancestral (tile). |
| `Badge` | Neutro por padrão; `mention` = vermelho. |
| `Switch`, `Kbd`, `Divider` (com rótulo), `Skeleton`, `Spinner`, `EmptyState`, `ScrollArea` | `EmptyState` usa halo bioluminescente atrás do ícone, sem caixa. Scrollbar: só `::-webkit-scrollbar` (thumb fino, sem trilha, sem setas). |

## 5. Padrões de tela

- **Lista densa:** linhas de 28 px (canais) ou 40 px (DMs), sem separadores; não lido = peso 590 + texto primário; menções = badge vermelho.
- **Mensagens:** agrupadas por autor em janelas de 7 min (resposta sempre abre grupo), separador de dia, linha "Novas" presa ao marcador de leitura do momento em que o canal abriu, barra de ações no hover (reações rápidas, responder, editar, excluir), Shift+clique em excluir pula a confirmação.
- **Composer:** Enter envia, Shift+Enter quebra linha, ↑ edita a última mensagem sua, contador aparece faltando 400 caracteres e fica vermelho acima de 4000, rascunho por canal.
- **Vazios:** ícone em quadro de 48 px, título curto, uma frase em `text-tertiary`, no máximo um CTA.
- **Carregamento:** skeleton com o formato do conteúdo (mensagens), nunca spinner solto.
- **Falha:** explicada no lugar (campo, mensagem, chip, splash), sempre com uma saída ("Tentar de novo", "Descartar", "Sair da conta").
- **Conexão caiu:** um chip âmbar de 28 px substitui a busca na title bar ("Sem conexão. Tentando de novo em 3 s…" + "Tentar agora"); nada abaixo se move. Mesma frase no splash, com a causa provável. O composer avisa "Sem conexão. Sua mensagem sai quando voltar."
- **Composer:** sem borda em repouso (só no foco). `@` abre o autocomplete (membros do espaço ou destinatários do DM; ↑↓, Enter/Tab, Esc; vira `<@id>` no envio). Emoji: seletor compacto e pesquisável (≈120 emojis curados, palavras-chave pt-BR sem acento, sem dependência).

### Palco de chamada (`features/voice/CallStage.tsx`)

- **Quem está:** a ocupação vem do servidor (`voiceStates`); nível, mudo e transmissões vêm do motor de mídia quando você está conectado. Ordem = ordem de entrada.
- **Tiles:** 16:9, gap 8, raio 12, `--bg-raised`, **sem borda**. A largura sai de `fitTiles()` (maior 16:9 que cabe; arranjo mais alto que largo só vence com 20 % de vantagem, porque pessoas lado a lado leem melhor numa tela paisagem), mínimo 200, máximo 880. Avatar 96/80/56 conforme o tile. Rótulo no canto inferior esquerdo: pílula `rgba(0,0,0,.5)` 12/510 com o ícone de estado em `--danger` (mic riscado, fone riscado, escudo = silenciado pela moderação). Qualidade ruim/sem sinal aparece no canto superior direito; boa não ocupa espaço.
- **Menu do tile (botão direito):** "Para você" (silenciar só para mim, volume 0–200 % no botão ⋯) e, com permissão (`computePermissions`), "Moderação": silenciar/ensurdecer para todos, mover para outro canal de voz, desconectar.
- **Transmissões:** tile próprio com "AO VIVO" e **Assistir** — nada é baixado antes disso. Assistindo: vídeo `contain` em preto, barra no hover (volume da live se houver áudio, Automática/Original, estatísticas, ampliar, janela flutuante via `requestPictureInPicture`, tela cheia no contêiner via `requestFullscreen`, parar de assistir). Duplo clique = tela cheia. Estatísticas (Ctrl Shift E): resolução, fps, taxa, codec, decodificador e HW/SW, perda, congelamentos. Sair do palco para de assistir tudo.
- **Foco:** a transmissão ocupa o palco e as pessoas viram uma faixa de tiles de 160×90 embaixo.
- **Sua transmissão:** cartão "Você está transmitindo" com a melhor camada realmente enviada (resolução · fps · taxa · encoder HW/SW), "Trocar fonte" e "Parar transmissão". Enquanto você transmite, um chip "Você está transmitindo · Parar" fica na title bar, visível até por cima das configurações.
- **Estados honestos:** conectando = chip âmbar + "Conectando…" no seu tile; reconectando = tiles em cinza a 40 %, `--speak` forçado a 0 e cartão "Reconectando à voz…" explicando que você não está ouvindo ninguém; desconectado = motivo do motor + "Entrar de novo". O dock continua lá para você sair.
- **Prévia (antes de entrar):** quem está na sala, contagem e um botão primário "Entrar em <canal>". Vazio: frondes com halo, "Ninguém aqui ainda / Entre e chame alguém. Quem chegar já te ouve."

### Dock de controles

Flutuante, centralizado, 16 px do fundo, `--bg-overlay` + `--elev-overlay`, raio cheio, padding 6, botões de 40 px com gap 8 e separadores de 1 px: **Microfone** (anel interno segue o seu próprio envelope: você vê que está sendo ouvido) · **Fone** | **Tela** (desligado: abre o seletor; ao vivo: preenchido em acento, menu com "Trocar fonte" e "Parar transmissão") · **Configurações de voz** | **Desconectar** (56 px, `--danger` cheio). Desligado = ícone riscado + `--danger` + tinta vermelha; nunca só cor. Silenciado pela moderação: o botão fica `aria-disabled` e o tooltip diz por quê.

### Seletor de tela

Modal de 800 px: abas Telas / Janelas com miniaturas ao vivo (atualizadas em cadeia a cada 1,5 s, sem empilhar pedidos), a principal pré-selecionada; à direita, prévia grande da fonte escolhida, **Qualidade** limitada a `screen.offered` (só o que o computador sustenta), **O que você vai mostrar** (Jogo ou vídeo = fps / Texto ou código = nitidez, em linguagem simples) e **Compartilhar áudio** (com aviso de que em janela vai o áudio do sistema inteiro). O texto de consentimento está no topo: só o escolhido é transmitido, só para quem clicar em Assistir. Com transmissão ativa, o mesmo seletor vira "Trocar fonte" (sem derrubar quem assiste).

### Presença de voz no cromo

- **Agora (Home):** salas com gente agora em todos os seus espaços e chamadas de DM; sua sala primeiro, depois as com mais amigos. Linha de 44 px: pilha de até 3 avatares de 20 px (com brilho real se for a sua sala), nome, onde ("Estúdio Alga" / "Chamada"), "ao vivo" se alguém transmite. Um clique entra.
- **Rail:** espaço com gente em voz ganha frondes de 12 px no canto (vivas se você está lá, respirando se não); menções têm prioridade no mesmo canto. Home ganha frondes quando há chamada de DM.
- **Sidebar:** canal de voz ocupado troca o alto-falante pelas frondes em acento; ocupantes em linhas de 26 px com avatar de 20 px e o mesmo brilho, "AO VIVO" e ícones de estado. **Um clique num canal de voz entra nele** (hábito do Discord mantido).
- **Painel "Voz conectada":** acima da sua linha no dock: frondes vivas + estado (13/590 acento; âmbar quando não conectado) + ping `tnum` à direita; canal · espaço em 12 terciário; ações Tela e Desconectar; quando ao vivo, uma faixa "Transmitindo · Parar".
- **Chamada de DM:** botão de telefone no header do DM (vira "Entrar na chamada" em acento quando já há alguém); o palco ocupa o topo da conversa (clamp 240–460 px) e o chat continua embaixo. Chamada recebida: cartão no topo da janela (avatar que respira, Recusar / Atender com foco em Atender, Esc recusa, some em 30 s ou quando quem ligou desiste) + notificação do Windows e piscar na barra de tarefas se a janela não está em foco.

### Configurações (`features/settings`)

Sobreposição de janela inteira abaixo da title bar (que continua: arrastar, botões nativos, chip de transmissão). Navegação à esquerda no estilo Linear, agrupada por rótulo (Usuário / Aplicativo); Esc, o ✕ ou Ctrl+, fecham e o foco volta para quem abriu. Cada controle faz algo de verdade; o que não tem backend não aparece (privacidade, recuperação de senha, anexos, fixar, denunciar):
- **Minha conta:** nome, usuário, bio (190), cor do perfil (PATCH /users/@me); trocar senha (POST /auth/password, encerra as outras sessões); sessões com "Encerrar" e "Encerrar todas as outras"; sair da conta.
- **Voz e vídeo:** microfone e saída, teste com medidor ao vivo e "ouvir a mim mesmo", processamento (Padrão / Supressão avançada / Desligado, uma frase honesta cada; aviso se a supressão avançada não carregou), detecção de voz vs aperte para falar, sensibilidade (automática ou manual: a linha do limiar sobre o nível em dB, arrastável), atraso ao soltar o PTT, sons de chamada.
- **Atalhos:** gravar via `window.alga.hotkeys.record`, rótulo do sistema, salvos em `localStorage` (`alga.hotkeys.v1`) e reaplicados no boot.
- **Notificações:** DMs e menções, chamadas, contador na barra de tarefas. **Aparência:** densidade Confortável/Compacta (linhas de 24 px, sem respiro entre grupos), reduzir animações. **Inicialização:** abrir com o Windows, fechar para a bandeja. **Avançado:** versão, procurar atualizações (com estados), abrir pasta de registros.

## 6. Faça / não faça

| Faça | Não faça |
|---|---|
| Use tokens (`var(--…)`) para toda cor, espaço, raio, duração | Hex solto em componente |
| Seleção neutra (`--state-selected`) | Pintar item ativo com acento |
| Bordas brancas translúcidas | Cinza sólido como borda |
| Raio externo = interno + padding | Mesmo raio no contêiner e no filho |
| Feedback no ponto da ação | Toast para algo que já está na tela |
| `IconButton` com `label` | Ícone clicável sem nome acessível |
| Badge neutro para contagem; vermelho só para @menção | Vermelho para "tem coisa nova" |
| Estado degradado visível (cinza, "Reconectando…") | Mostrar pessoas "bem" sem mídia |
| Omitir o controle que não tem backend | Switch decorativo ou rota fingida |
| `useEffect(() => { el.scrollTo(…) })` com chaves | Devolver o resultado de `scrollTo` (no Chromium 156 é uma Promise; o React a trata como cleanup e quebra) |
| Animar só troca de contexto | Animar resposta a clique/tecla |
| Textos pt-BR no `strings.ts` da feature | String solta no JSX de componente compartilhado |

## 7. Telas (versões mais recentes)

| Tela | Screenshot |
|---|---|
| **Voz e presença** | |
| Agora: onde seus amigos estão (Home) | [2026-11-01-home-agora-v3.png](../screenshots/2026-11-01-home-agora-v3.png) |
| Canal de voz antes de entrar (prévia) | [2026-11-01-voice-preview-v3.png](../screenshots/2026-11-01-voice-preview-v3.png) |
| Palco: Bruno falando (brilho real, envelope da voz) | [2026-11-01-voice-stage-v5.png](../screenshots/2026-11-01-voice-stage-v5.png) |
| Palco: você falando (anel do microfone no dock) | [2026-11-01-voice-stage-self-speaking-v3.png](../screenshots/2026-11-01-voice-stage-self-speaking-v3.png) |
| Mudo + ensurdecido | [2026-11-01-voice-self-muted-deafened-v3.png](../screenshots/2026-11-01-voice-self-muted-deafened-v3.png) |
| Menu do tile: para você + moderação | [2026-11-01-voice-tile-moderation-menu-v3.png](../screenshots/2026-11-01-voice-tile-moderation-menu-v3.png) |
| Silenciado pela moderação (visão de quem foi silenciado) | [2026-11-01-voice-server-muted-v3.png](../screenshots/2026-11-01-voice-server-muted-v3.png) |
| Movido por um moderador (VOICE_MOVE) | [2026-11-01-voice-moved-v3.png](../screenshots/2026-11-01-voice-moved-v3.png) |
| Desconectado por um moderador (VOICE_DISCONNECT) | [2026-11-01-voice-disconnected-moderator-v3.png](../screenshots/2026-11-01-voice-disconnected-moderator-v3.png) |
| Reconectando: o palco não finge que está tudo bem | [2026-11-01-voice-reconnecting-v3.png](../screenshots/2026-11-01-voice-reconnecting-v3.png) |
| Seletor de tela (prévia, qualidade, conteúdo, áudio) | [2026-11-01-screen-picker-v3.png](../screenshots/2026-11-01-screen-picker-v3.png) |
| Você transmitindo (chip na title bar + painel) | [2026-11-01-screen-sharing-self-v3.png](../screenshots/2026-11-01-screen-sharing-self-v3.png) |
| Transmissão de outra pessoa: nada baixa até Assistir | [2026-11-01-stream-tile-unwatched-v3.png](../screenshots/2026-11-01-stream-tile-unwatched-v3.png) |
| Assistindo (vídeo real via SFU) | [2026-11-01-stream-watching-v3.png](../screenshots/2026-11-01-stream-watching-v3.png) |
| Estatísticas (Ctrl Shift E) | [2026-11-01-stream-stats-v3.png](../screenshots/2026-11-01-stream-stats-v3.png) |
| Modo foco | [2026-11-01-stream-focus-v3.png](../screenshots/2026-11-01-stream-focus-v3.png) |
| Chamada recebida (DM) | [2026-11-01-call-incoming-v3.png](../screenshots/2026-11-01-call-incoming-v3.png) |
| Chamada no DM (palco no topo da conversa) | [2026-11-01-dm-call-v3.png](../screenshots/2026-11-01-dm-call-v3.png) |
| **Configurações** | |
| Minha conta (perfil, senha, sessões) | [2026-11-01-settings-account-v1.png](../screenshots/2026-11-01-settings-account-v1.png) |
| Voz e vídeo (teste de microfone ao vivo) | [2026-11-01-settings-voice-v3.png](../screenshots/2026-11-01-settings-voice-v3.png) |
| Atalhos globais | [2026-11-01-settings-hotkeys-v1.png](../screenshots/2026-11-01-settings-hotkeys-v1.png) |
| Notificações | [2026-11-01-settings-notifications-v1.png](../screenshots/2026-11-01-settings-notifications-v1.png) |
| Aparência | [2026-11-01-settings-appearance-v1.png](../screenshots/2026-11-01-settings-appearance-v1.png) |
| Densidade compacta aplicada | [2026-11-01-density-compact-v1.png](../screenshots/2026-11-01-density-compact-v1.png) |
| Inicialização | [2026-11-01-settings-startup-v1.png](../screenshots/2026-11-01-settings-startup-v1.png) |
| Avançado (versão, atualizações, registros) | [2026-11-01-settings-advanced-v1.png](../screenshots/2026-11-01-settings-advanced-v1.png) |
| **Conversa** | |
| Login | [2026-11-01-auth-login-v8.png](../screenshots/2026-11-01-auth-login-v8.png) |
| Login: erro + Caps Lock (cartão ancorado no topo) | [2026-11-01-auth-login-error-v7.png](../screenshots/2026-11-01-auth-login-error-v7.png) |
| Cadastro: erros por campo | [2026-11-01-auth-register-errors-v5.png](../screenshots/2026-11-01-auth-register-errors-v5.png) |
| Primeira execução (passo 1 de 2) | [2026-11-01-onboarding-v4.png](../screenshots/2026-11-01-onboarding-v4.png) |
| Primeira execução (criar espaço) | [2026-11-01-onboarding-create-space-v4.png](../screenshots/2026-11-01-onboarding-create-space-v4.png) |
| Amigos: Online | [2026-11-01-friends-online-v3.png](../screenshots/2026-11-01-friends-online-v3.png) |
| Foco por teclado visível | [2026-11-01-focus-visible-tabs-v2.png](../screenshots/2026-11-01-focus-visible-tabs-v2.png) |
| Amigos: Todos | [2026-11-01-friends-all-v3.png](../screenshots/2026-11-01-friends-all-v3.png) |
| Amigos: Pendentes (Aceitar ≠ Recusar) | [2026-11-01-friends-pending-v3.png](../screenshots/2026-11-01-friends-pending-v3.png) |
| Amigos: menu de contexto | [2026-11-01-friends-context-menu-v3.png](../screenshots/2026-11-01-friends-context-menu-v3.png) |
| Adicionar amigo: erro no lugar | [2026-11-01-friends-add-error-v3.png](../screenshots/2026-11-01-friends-add-error-v3.png) |
| Mensagem direta | [2026-11-01-dm-v5.png](../screenshots/2026-11-01-dm-v5.png) |
| Canal | [2026-11-01-chat-channel-v5.png](../screenshots/2026-11-01-chat-channel-v5.png) |
| Barra de ações no hover (3 reações, +reação, responder, mais) | [2026-11-01-chat-hover-toolbar-v5.png](../screenshots/2026-11-01-chat-hover-toolbar-v5.png) |
| Menu de contexto da mensagem (agrupado por rótulo) | [2026-11-01-chat-context-menu-v5.png](../screenshots/2026-11-01-chat-context-menu-v5.png) |
| Respondendo no composer | [2026-11-01-chat-reply-composer-v5.png](../screenshots/2026-11-01-chat-reply-composer-v5.png) |
| Edição inline (Kbd) | [2026-11-01-chat-inline-edit-v5.png](../screenshots/2026-11-01-chat-inline-edit-v5.png) |
| @menção: autocomplete | [2026-11-01-chat-mention-autocomplete-v1.png](../screenshots/2026-11-01-chat-mention-autocomplete-v1.png) |
| Seletor de emoji | [2026-11-01-chat-emoji-picker-v1.png](../screenshots/2026-11-01-chat-emoji-picker-v1.png) |
| Pílula de novas mensagens | [2026-11-01-chat-jump-pill-v2.png](../screenshots/2026-11-01-chat-jump-pill-v2.png) |
| Carregando (rede lenta): skeleton | [2026-11-01-chat-loading-skeleton-v4.png](../screenshots/2026-11-01-chat-loading-skeleton-v4.png) |
| Servidor fora: chip na title bar + envio com falha | [2026-11-01-banner-reconnecting-send-failed-v4.png](../screenshots/2026-11-01-banner-reconnecting-send-failed-v4.png) |
| Reenvio após reconectar | [2026-11-01-chat-send-retried-v4.png](../screenshots/2026-11-01-chat-send-retried-v4.png) |
| Boot sem servidor: splash com causa provável | [2026-11-01-splash-offline-v4.png](../screenshots/2026-11-01-splash-offline-v4.png) |
| Ctrl+K | [2026-11-01-switcher-v4.png](../screenshots/2026-11-01-switcher-v4.png) |
| Ctrl+K com busca | [2026-11-01-switcher-query-v4.png](../screenshots/2026-11-01-switcher-query-v4.png) |
| Status e perfil | [2026-11-01-user-status-v3.png](../screenshots/2026-11-01-user-status-v3.png) |
| Menu do espaço | [2026-11-01-space-menu-v4.png](../screenshots/2026-11-01-space-menu-v4.png) |
| Convite | [2026-11-01-space-invite-v4.png](../screenshots/2026-11-01-space-invite-v4.png) |
| Criar canal (selecionado sobe em luminância) | [2026-11-01-space-create-channel-v3.png](../screenshots/2026-11-01-space-create-channel-v3.png) |
| Entrar com convite: prévia | [2026-11-01-space-join-preview-v3.png](../screenshots/2026-11-01-space-join-preview-v3.png) |
| Tamanho mínimo 960×600 | [2026-11-01-shell-960x600-v3.png](../screenshots/2026-11-01-shell-960x600-v3.png) |
| 1920×1080 a 125% | [2026-11-01-shell-1920x1080@125-v3.png](../screenshots/2026-11-01-shell-1920x1080@125-v3.png) |

Validação: cada tela foi capturada no app Electron real (`--profile=shots`) com dados criados pela API REST real; estados de rede (lento, servidor fora, boot sem servidor) vêm de um proxy TCP no script, não de dados falsos no app. Tamanhos: 1320×840 (padrão), 960×600 (mínimo) e 1920×1080 a 125%.

Voz: duas instâncias reais (`--profile=shots` e `--profile=shots-b`) no mesmo canal pelo LiveKit local, com dispositivos falsos do Chromium. O microfone de B é uma fala pt-BR gerada (SAPI + ffmpeg), então o brilho segue um envelope de voz real; a transmissão de A passa pelo fluxo real do app (seletor → `startScreenShare` → SFU → `watch` em B → decodificação) com a fonte de desktop falsa do Chromium como imagem, para não capturar a tela de ninguém. As miniaturas do seletor mostram um padrão de teste em tela cheia (ffplay) pelo mesmo motivo. Moderação, VOICE_MOVE e VOICE_DISCONNECT são disparados pela API real; "reconectando" é o LiveKit derrubado de verdade e religado.
