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
7. **Estado nunca só por cor.** Presença tem forma (ponto, lua, barra, anel); mudo/ensurdecido têm ícone riscado + tooltip; não lido = peso 590 + cor primária.

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
- **Brilho de quem fala:** `useSpeakingGlow(ref, getLevel)` aplica envelope tipo compressor (ataque 60 ms, release 240 ms) direto em `--speak`, sem re-render. Não é anel liga/desliga.
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
| `Switch`, `Kbd`, `Badge`, `Divider` (com rótulo), `Skeleton`, `Spinner`, `EmptyState`, `ScrollArea` | — |

## 5. Padrões de tela

- **Lista densa:** linhas de 28 px (canais) ou 40 px (DMs), sem separadores; não lido = peso 590 + texto primário; menções = badge vermelho.
- **Mensagens:** agrupadas por autor em janelas de 7 min (resposta sempre abre grupo), separador de dia, linha "Novas" presa ao marcador de leitura do momento em que o canal abriu, barra de ações no hover (reações rápidas, responder, editar, excluir), Shift+clique em excluir pula a confirmação.
- **Composer:** Enter envia, Shift+Enter quebra linha, ↑ edita a última mensagem sua, contador aparece faltando 400 caracteres e fica vermelho acima de 4000, rascunho por canal.
- **Vazios:** ícone em quadro de 48 px, título curto, uma frase em `text-tertiary`, no máximo um CTA.
- **Carregamento:** skeleton com o formato do conteúdo (mensagens), nunca spinner solto.
- **Falha:** explicada no lugar (campo, mensagem, banner, splash), sempre com uma saída ("Tentar de novo", "Descartar", "Sair da conta").

## 6. Faça / não faça

| Faça | Não faça |
|---|---|
| Use tokens (`var(--…)`) para toda cor, espaço, raio, duração | Hex solto em componente |
| Seleção neutra (`--state-selected`) | Pintar item ativo com acento |
| Bordas brancas translúcidas | Cinza sólido como borda |
| Raio externo = interno + padding | Mesmo raio no contêiner e no filho |
| Feedback no ponto da ação | Toast para algo que já está na tela |
| `IconButton` com `label` | Ícone clicável sem nome acessível |
| Animar só troca de contexto | Animar resposta a clique/tecla |
| Textos pt-BR no `strings.ts` da feature | String solta no JSX de componente compartilhado |

## 7. Telas (versões mais recentes)

| Tela | Screenshot |
|---|---|
| Login | [2026-11-01-auth-login-v6.png](../screenshots/2026-11-01-auth-login-v6.png) |
| Login: erro + aviso de Caps Lock | [2026-11-01-auth-login-error-v5.png](../screenshots/2026-11-01-auth-login-error-v5.png) |
| Cadastro: erros por campo | [2026-11-01-auth-register-errors-v3.png](../screenshots/2026-11-01-auth-register-errors-v3.png) |
| Primeira execução (passo 1 de 2) | [2026-11-01-onboarding-v3.png](../screenshots/2026-11-01-onboarding-v3.png) |
| Primeira execução (passo 2: criar espaço) | [2026-11-01-onboarding-create-space-v3.png](../screenshots/2026-11-01-onboarding-create-space-v3.png) |
| Amigos: Online | [2026-11-01-friends-online-v2.png](../screenshots/2026-11-01-friends-online-v2.png) |
| Foco por teclado visível | [2026-11-01-focus-visible-tabs-v1.png](../screenshots/2026-11-01-focus-visible-tabs-v1.png) |
| Amigos: Todos | [2026-11-01-friends-all-v2.png](../screenshots/2026-11-01-friends-all-v2.png) |
| Amigos: Pendentes | [2026-11-01-friends-pending-v2.png](../screenshots/2026-11-01-friends-pending-v2.png) |
| Amigos: menu de contexto | [2026-11-01-friends-context-menu-v2.png](../screenshots/2026-11-01-friends-context-menu-v2.png) |
| Adicionar amigo: erro no lugar | [2026-11-01-friends-add-error-v2.png](../screenshots/2026-11-01-friends-add-error-v2.png) |
| Mensagem direta | [2026-11-01-dm-v4.png](../screenshots/2026-11-01-dm-v4.png) |
| Canal: agrupamento, linha "Novas", menção, resposta, código, reações, digitando | [2026-11-01-chat-channel-v4.png](../screenshots/2026-11-01-chat-channel-v4.png) |
| Barra de ações no hover | [2026-11-01-chat-hover-toolbar-v4.png](../screenshots/2026-11-01-chat-hover-toolbar-v4.png) |
| Menu de contexto da mensagem | [2026-11-01-chat-context-menu-v4.png](../screenshots/2026-11-01-chat-context-menu-v4.png) |
| Respondendo no composer | [2026-11-01-chat-reply-composer-v4.png](../screenshots/2026-11-01-chat-reply-composer-v4.png) |
| Edição inline (↑ no composer vazio) | [2026-11-01-chat-inline-edit-v4.png](../screenshots/2026-11-01-chat-inline-edit-v4.png) |
| Pílula de novas mensagens | [2026-11-01-chat-jump-pill-v1.png](../screenshots/2026-11-01-chat-jump-pill-v1.png) |
| Carregando (rede lenta): skeleton | [2026-11-01-chat-loading-skeleton-v2.png](../screenshots/2026-11-01-chat-loading-skeleton-v2.png) |
| Servidor fora: banner com contagem + envio com falha | [2026-11-01-banner-reconnecting-send-failed-v2.png](../screenshots/2026-11-01-banner-reconnecting-send-failed-v2.png) |
| Reenvio após reconectar | [2026-11-01-chat-send-retried-v2.png](../screenshots/2026-11-01-chat-send-retried-v2.png) |
| Boot sem servidor: splash explica e oferece saída | [2026-11-01-splash-offline-v2.png](../screenshots/2026-11-01-splash-offline-v2.png) |
| Ctrl+K (vazio: o que precisa de você) | [2026-11-01-switcher-v3.png](../screenshots/2026-11-01-switcher-v3.png) |
| Ctrl+K com busca | [2026-11-01-switcher-query-v3.png](../screenshots/2026-11-01-switcher-query-v3.png) |
| Status e perfil | [2026-11-01-user-status-v2.png](../screenshots/2026-11-01-user-status-v2.png) |
| Menu do espaço | [2026-11-01-space-menu-v3.png](../screenshots/2026-11-01-space-menu-v3.png) |
| Convite (link + validade) | [2026-11-01-space-invite-v3.png](../screenshots/2026-11-01-space-invite-v3.png) |
| Criar canal | [2026-11-01-space-create-channel-v2.png](../screenshots/2026-11-01-space-create-channel-v2.png) |
| Entrar com convite: prévia | [2026-11-01-space-join-preview-v2.png](../screenshots/2026-11-01-space-join-preview-v2.png) |
| Canal de voz (slot do palco) | [2026-11-01-voice-stage-v2.png](../screenshots/2026-11-01-voice-stage-v2.png) |
| Tamanho mínimo 960×600 | [2026-11-01-shell-960x600-v2.png](../screenshots/2026-11-01-shell-960x600-v2.png) |
| 1920×1080 a 125% | [2026-11-01-shell-1920x1080@125-v2.png](../screenshots/2026-11-01-shell-1920x1080@125-v2.png) |

Validação: cada tela foi capturada no app Electron real (`--profile=shots`) com dados criados pela API REST real; estados de rede (lento, servidor fora, boot sem servidor) vêm de um proxy TCP no script, não de dados falsos no app. Tamanhos: 1320×840 (padrão), 960×600 (mínimo) e 1920×1080 a 125%.
