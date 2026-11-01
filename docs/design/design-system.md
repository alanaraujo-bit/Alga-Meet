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
- **Apelidos:** dentro de um espaço o nome que aparece é o apelido (`displayName(st, id, spaceId)`): mensagens, resposta, menção (`Markdown spaceId`), digitando, lista de membros, autocomplete, notificação.

### Anexos (`features/chat/Attachments.tsx`, `tray.ts`, `Lightbox.tsx`)

- **Entrada:** clipe à esquerda do composer (`IconButton`, com `disabledReason` sem `ATTACH_FILES`), arrastar para a conversa (alvo de soltar: borda interna de 2 px em acento, "Solte para enviar em #canal", limites numa frase; sem permissão o alvo fica neutro e diz por quê) e colar imagem (só quando o clipboard não traz texto; o arquivo vira `imagem-colada-<data>.png`).
- **Bandeja:** cartões de 120 px acima do campo (miniatura real de imagem/vídeo, ícone por tipo nos outros), nome, tamanho, ✕ que devolve o foco ao composer. Problemas aparecem **antes** do envio, no próprio cartão (contorno `--danger` + motivo): vazio, maior que 25 MB (`DEFAULT_MAX_ATTACHMENT_BYTES`), passou de 10 (`MAX_ATTACHMENTS`). Esses não vão. Enter envia só com arquivos.
- **Envio:** o otimista de sempre (nonce) com as prévias locais (`blob:`) no lugar e o tamanho da imagem já lido (`createImageBitmap`), então nada pula quando o servidor responde. Multipart por XHR (`upload()` em `lib/api.ts`) com progresso: "Enviando 2 arquivos · 45%" + barra de 2 px em acento, mídia a 55 %. Falha = "Não enviada." + motivo do servidor quando há (413, 429) + Tentar de novo (reenvia os mesmos arquivos) / Descartar (libera as URLs).
- **Exibição:** `contentType` manda (imagem/vídeo/áudio inline, `application/octet-stream` = cartão de download). Imagem única cabe em 420×320 sem ampliar, com `aspect-ratio` de `width/height` (sem deslocamento). Grade de 420 px, gutter de 2 px, raio 8 só por fora: `gridRows()` = 1 · 2 · 1+2 · 2×2 · e depois fileiras de 3 com o resto (1 ou 2) numa fileira mais larga em cima; altura 240/180/132 por 1/2/3 células, `object-fit: cover`. Vídeo 480 px 16:9 com controles nativos (`preload=metadata`), áudio num cartão com o player, arquivo = cartão de 400 px (ícone por extensão, nome, tamanho, baixar). Mensagem só com anexos não tem linha de texto; a prévia (resposta, notificação, excluir) diz "Imagem", "3 imagens" ou "2 anexos".
- **URL assinada vencida (~1 h):** o primeiro erro de carga de um arquivo rebusca a página que termina na mensagem (`refreshMessage`, uma por canal por vez) e remonta o elemento; um segundo erro em menos de 1 min mostra "Não foi possível carregar · Tentar de novo" no mesmo tamanho. Salvar faz `fetch` → blob → "Salvar como" do sistema, e um 403 ali também renova a URL uma vez. Validado com um interceptador que responde 403 na primeira carga de cada arquivo: 11 recusas, 9 imagens na tela depois da renovação.
- **Visualizador:** abaixo da title bar (como as configurações), fundo `rgba(4,6,7,.94)`; barra com nome, "2 de 5 · 1920×1080 · 39 KB", tamanho real/ajustar (`+`/`−` ou clique na imagem), abrir no navegador, salvar, fechar (Esc). Setas na tela e no teclado. Foco preso, volta para a miniatura.

### Configurações do espaço (`features/spaceSettings`)

Mesmo quadro das configurações do usuário (`settings/Frame.tsx`: `SettingsFrame`, `Group`, `Row`), aberto por "Configurações do espaço" no menu do espaço. As seções saem das permissões reais (`visibleSections(actorFor(...))`, recalculadas a cada `ROLE_UPSERT`/`MEMBER_UPDATE`: perdeu a permissão, a seção some):
- **Visão geral** (`MANAGE_SPACE`): ícone (mesmo recorte do avatar, máscara de canto 22 %), nome, e "Excluir espaço" só para o dono, confirmando com o nome digitado.
- **Cargos** (`MANAGE_ROLES`): do mais alto para o mais baixo, @everyone por último; ponto de cor, nome na cor, contagem, "Seu cargo mais alto", subir/descer (o cargo toma a posição do vizinho; o servidor reordena). Editor: ← volta (Esc também), nome, 9 cores + "sem cor", permissões em 4 grupos (Geral, Membros, Texto, Voz) com uma frase cada; cada chave salva na hora. **A regra do servidor está espelhada** (`permissions.ts`, testada): fora o dono, só se edita cargo abaixo do seu mais alto (@everyone é editável por qualquer gestor, só permissões) e só se concede o que se tem. O que não dá fica desabilitado com o motivo: cadeado com tooltip na lista, aviso no topo do editor ("Você só pode editar cargos abaixo do seu cargo mais alto (Moderação)"), e a dica da permissão diz "Você não tem esta permissão…".
- **Membros:** busca, linhas de 48 px (apelido na cor do cargo, nome real e @usuário em terciário, coroa do dono), chips de cargo com ✕ e "+" (menu com marcação) para atribuir; ⋯ = mudar apelido, expulsar, banir com motivo. O menu só lista o que suas permissões permitem; se a pessoa está no seu nível ou acima, as ações aparecem desabilitadas e o motivo vem uma vez no topo do menu.
- **Banimentos** (`BAN_MEMBERS`): quem, motivo, data, "Revogar banimento". **Convites** (`CREATE_INVITES`): prazo (1 h … 30 dias, nunca com aviso) e usos (sem limite, 1 … 100); embaixo, **Convites ativos** de `GET /spaces/:id/invites` (com `MANAGE_SPACE`, todos; sem, só os seus, e a descrição diz qual). Linha de 48 px: avatar de quem criou, link em mono, "Criado por … · 3 de 10 usos · expira 2 de nov., 14:00", Copiar ("Copiado" no próprio botão) e lixeira. O convite recém-gerado ganha borda de 2 px em acento e o Copiar primário. Revogar confirma num modal ("…para de funcionar na hora. Quem já entrou por ele continua no espaço."); 404 conta como feito. Sem permissão para revogar, a lixeira fica `aria-disabled` com o motivo. A lista se atualiza a cada 20 s e no foco da janela (usos mudam e não há evento de convite no gateway).

### Conta: foto, e-mail, senha

- **Foto do perfil / ícone do espaço (`settings/ImagePicker.tsx`):** prévia de 80 px, "Enviar/Trocar imagem", "Remover" e a regra numa linha. PNG/JPEG/WebP/GIF até 8 MB (`checkAvatar`, antes de qualquer envio). Recorte quadrado de 280 px: arrastar, roda do mouse, controle de zoom 1–4×, setas (Shift = passo maior) e +/−; o que o círculo não mostra fica escurecido. Sai num canvas como WebP de no máximo 1024 px (EXIF e o que ficou fora não saem da máquina). GIF pula o recorte para manter a animação. Ninguém mais manda URL externa de avatar: só `PUT /users/@me/avatar`, `PUT /spaces/:id/icon` ou `null`.
- **E-mail não confirmado:** uma faixa calma no topo da Home ("Confirme seu e-mail · Para convidar pessoas e criar mais espaços"), nunca modal, nunca vermelho; em Minha conta, a linha do e-mail diz o que fica bloqueado. Os 403 do servidor (convite, segundo espaço, DM com quem não é amigo) viram a frase do servidor + "Confirmar e-mail" no lugar do erro (`needsVerification`, `toastError`). O diálogo aceita o código ou o link inteiro (`parseEmailToken`: `?token=` ou o código puro), "Reenviar e-mail" com contagem ("Reenviar em 52 s"; 5 min depois de um 429) e fecha sozinho se a confirmação chegar por outro lado (`ME_UPDATE`).
- **Senha:** mínimo `MIN_PASSWORD_LENGTH` (10). Força em 4 barras sob o campo (`passwordStrength`: comprimento pesa mais, variedade ajuda, repetição/nome/e-mail derrubam) e a frase no hint; o servidor ainda recusa senha comum, repetida ou com seu usuário, e essa frase aparece no campo como veio. "Esqueci minha senha" no rótulo da senha → e-mail → (sempre 204) "Se houver uma conta com…, o link vale 1 hora" → colar link ou código + nova senha → volta ao login com "Senha trocada". Login por e-mail só depois de confirmar; o erro sugere entrar pelo nome de usuário. "Sair de todas as outras sessões" (`DELETE /auth/sessions`) aparece sempre, desabilitado quando só há este dispositivo; trocar a senha recarrega a lista.

### Links algameet:// (`features/app/deepLinks.ts`)

`window.alga.deepLinks` no boot do `App` (com ou sem sessão; sem a ponte, nada acontece): primeiro `onLink`, depois `takePending()` uma vez. Token e código são segredos: só vão para a API, nunca aparecem na tela nem no log.
- **verify-email:** confirma direto (`POST /auth/verify-email`, não precisa de sessão) e diz o resultado num toast ("E-mail confirmado. Tudo liberado.", "Entre para continuar." sem sessão, ou o erro com o caminho para pedir outro). A faixa "Confirme seu e-mail" some sozinha (`ME_UPDATE`).
- **password-reset:** sem sessão, a tela de nova senha abre com o token em uso e **sem o campo do código** ("Link do e-mail aberto. Agora é só escolher a senha nova."); se o servidor recusar, o campo volta com o erro. Com sessão, um toast explica que trocar a senha encerra todas as sessões e oferece "Sair e trocar".
- **invite:** com sessão, abre a prévia de "Entrar em um espaço". Sem sessão, o link espera: login e cadastro dizem "Você abriu um convite. Entre ou crie sua conta e ele abre em seguida." e a prévia abre quando o shell existe.

### Assinatura (`features/billing/Plan.tsx`, `store.ts`)

Configurações › Usuário › **Assinatura**. O Grátis é bom de verdade e a tela o trata assim: nada de modal, contador, selo piscando ou "oferta por tempo limitado".
- **Aviso do provedor** no topo quando `catalog.provider.sandbox` ("SANDBOX" em âmbar + "a página de pagamento é simulada e nada é cobrado") ou quando pagamentos estão desligados (`provider: null`: botões desabilitados, "seu plano e seus itens continuam valendo"). Linhas sandbox do histórico levam o chip "TESTE".
- **Seu plano:** cartão `--bg-raised` raio 12. Grátis: "Sem prazo e sem cartão…". Plus: "Mensal · renova em 1 de dez. de 2026 · R$ 14,90" + "Cancelar renovação" (ghost) e um fio de 1 px em acento a 30 % no topo (estado, não enfeite). Renovação cancelada: até quando vale e que nada comprado se perde. `past_due` em âmbar.
- **Grátis e Alga Plus:** tabela de 3 colunas montada do catálogo (`plans`, presets, teto de anexo, coleção Plus), "· seu plano" no cabeçalho da coluna atual, voz "Igual para todos" nas duas. O "+" das qualidades extras é o único acento.
- **Assinar:** Mensal/Anual (segmented), preço 24/32 `tnum`, "Equivale a R$ 12,42 por mês" no anual, botão primário grande e "O pagamento abre no seu navegador". **Antes do clique**, no mesmo cartão: renova sozinho, cancele quando quiser, "Você pode pedir reembolso em até 7 dias".
- **Checkout:** `POST /billing/checkout` → `openExternal(url)` → **"Aguardando a confirmação do pagamento…"** (spinner com texto, "Abrir a página de novo", "Não vou pagar agora"). O app **nunca** marca nada como pago: só o `ENTITLEMENTS_UPDATE` (webhook verificado no servidor) muda o estado. Recusado ou abandonado aparece ao voltar para a janela (foco → `GET /billing/me`): "O pagamento não foi concluído. Nada foi cobrado."
- **Momento de confirmação:** quando o `ENTITLEMENTS_UPDATE` traz o SKU esperado com a página aberta, uma faixa de luz atravessa o cartão uma vez (1,1 s, out-quart, só `transform`) e a linha vira "Pagamento confirmado. Obrigado por apoiar o Alga Meet." em `--success`; "Cancelar renovação" fica escondido nesse momento. Com movimento reduzido a faixa não roda (o último quadro fica fora do cartão) e a linha fica. Página fechada: um toast com "Ver".
- **Cancelar renovação:** modal honesto ("Nada muda até 1 de dez.… Depois, sua conta volta ao Grátis (transmissão até 1080p30, anexos até 25 MB). O que você comprou na loja continua na sua conta."), foco em "Manter o Plus", confirmação em `danger`.
- **Histórico de compras:** assinaturas e pedidos juntos, do mais novo; disco de 28 px (✓ em `--success` para pago/ativa, relógio para pendente, traço para o resto), nome, data · estado por tipo (pedido recusado = "Pagamento não concluído"), valor `tnum` à direita.
- **Voz e vídeo › Qualidade da transmissão:** um chip de 26 px por preset de `STREAM_PRESETS`: ✓ preenchido para os de `Me.plan.streamPresets`, cadeado com contorno para os outros; uma linha ("1080p60, 1440p60 e 4K vêm com o Alga Plus. O resto, incluindo 1080p30, é grátis.") e "Ver planos" em ghost. Quem limita é o seletor de tela (voz); aqui é informação.

### Personalização e cosméticos (`features/billing/Shop.tsx`, `Cosmetics.tsx`, `look.ts`)

- **Loja:** prateleiras por tipo à esquerda (tiles de 128 px ou mais: amostra de 64 px em `--bg-raised`, nome, preço ou estado) e **prévia fixa** à direita (`sticky`, 288 px): o seu cartão de perfil com o item escolhido sobre o que você já usa; embaixo tipo, nome, descrição e a ação. Seleção do tile é neutra (`--state-selected` + borda forte), nunca acento. Estados: preço, "Em uso", "Na sua conta", "Coleção Plus" (leva ao plano), "Alga Plus" (incluído no seu).
- **Texto de posse** segue os termos (licença ligada à conta, não propriedade): "Comprou uma vez, fica na sua conta, sem renovação". Nunca "para sempre". Antes de comprar: "Pagamento único, sem renovação: fica na sua conta. Você pode pedir reembolso em até 7 dias."
- **Sem rota de equipar:** o visual é derivado (`lookFrom`, testado): um item por lugar; o comprado ganha do emprestado pelo plano e, entre comprados, o mais recente. A tela avisa quando você tem dois do mesmo tipo.
- **Só o seu é conhecido:** a API não expõe cosméticos de outras pessoas (`PublicUser` não tem o campo), então `useLook(userId)` devolve vazio para os outros. Os lugares já estão prontos: lista de membros (discreto), popover de perfil (clique no membro) e o seu painel.
- **Renderizadores (CSS/SVG, sem imagem),** cada um com a própria paleta, sempre contida:
  - *Folha de alga:* cinco folhas de kelp em gradiente verde-mar com nervura clara, abraçando o lado esquerdo e o topo do avatar, pontas soltas; fio fino de anel.
  - *Coral:* recife de coral-chifre (galhos com pontas de pólipo claras) crescendo de uma base curva no canto inferior esquerdo, brilho estático de 2 px.
  - Decorações ocupam 140 % do avatar e **nunca** o quadrante inferior direito (ponto de presença).
  - *Noite paulistana:* céu índigo, névoas magenta e âmbar baixas, prédios com janelas de luz de sódio; o cartão inteiro ganha tinta índigo.
  - *Maré (Plus):* gradiente verde-água com duas linhas de onda a 9–14 %.
  - *Bioluminescência:* 16 pontos de luz sobem ao abrir o perfil e assentam como plâncton a 55 %.
  - *Cardume:* placa azul-marinho com quatro peixinhos na cauda da placa, nunca sobre o nome.
  - *Correnteza (Plus):* placa verde-água com uma faixa de luz que cruza uma vez.
- **Movimento:** só ao abrir o perfil (uma vez) ou enquanto a linha da lista está sob o mouse (`data-cosmetic-hover`); só `transform`/`opacity`; nada contínuo, nada no chat. O último quadro de cada animação é o repouso, então o movimento reduzido (que colapsa as animações) mostra o item completo e parado.

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

Sobreposição de janela inteira abaixo da title bar (que continua: arrastar, botões nativos, chip de transmissão). Navegação à esquerda no estilo Linear, agrupada por rótulo (Usuário / Aplicativo); Esc, o ✕ ou Ctrl+, fecham e o foco volta para quem abriu. Cada controle faz algo de verdade; o que não tem backend não aparece (privacidade, fixar, denunciar):
- **Assinatura** e **Personalização:** ver as seções acima.
- **Minha conta:** foto (recorte + upload), nome, usuário, bio (190), cor do perfil (PATCH /users/@me); e-mail e se está confirmado; trocar senha com força (POST /auth/password, encerra as outras sessões); sessões com "Encerrar" e "Sair de todas as outras sessões"; sair da conta.
- **Voz e vídeo:** qualidade de transmissão do plano (ver Assinatura), microfone e saída, teste com medidor ao vivo e "ouvir a mim mesmo", processamento (Padrão / Supressão avançada / Desligado, uma frase honesta cada; aviso se a supressão avançada não carregou), detecção de voz vs aperte para falar, sensibilidade (automática ou manual: a linha do limiar sobre o nível em dB, arrastável), atraso ao soltar o PTT, sons de chamada.
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
| Esperar o `ENTITLEMENTS_UPDATE` para mostrar algo como pago | Marcar como pago ao abrir o checkout ou ao voltar do navegador |
| Renovação e reembolso em 7 dias ditos antes do clique | Letra miúda depois do pagamento, "para sempre", contagem regressiva |
| Cosmético que se move uma vez, ao abrir, com repouso = movimento reduzido | Animação contínua em lista, no chat ou fora da tela |

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
| Minha conta (foto enviada, perfil, e-mail) | [2026-11-01-settings-account-v3.png](../screenshots/2026-11-01-settings-account-v3.png) |
| Recorte da foto (zoom + arrasto, círculo) | [2026-11-01-settings-avatar-crop-v2.png](../screenshots/2026-11-01-settings-avatar-crop-v2.png) |
| Senha: força fraca + sair das outras sessões | [2026-11-01-settings-account-security-v2.png](../screenshots/2026-11-01-settings-account-security-v2.png) |
| Senha: força forte | [2026-11-01-settings-password-strong-v2.png](../screenshots/2026-11-01-settings-password-strong-v2.png) |
| Voz e vídeo (teste de microfone ao vivo) | [2026-11-01-settings-voice-v3.png](../screenshots/2026-11-01-settings-voice-v3.png) |
| Atalhos globais | [2026-11-01-settings-hotkeys-v3.png](../screenshots/2026-11-01-settings-hotkeys-v3.png) |
| Notificações | [2026-11-01-settings-notifications-v3.png](../screenshots/2026-11-01-settings-notifications-v3.png) |
| Aparência | [2026-11-01-settings-appearance-v3.png](../screenshots/2026-11-01-settings-appearance-v3.png) |
| Densidade compacta aplicada | [2026-11-01-density-compact-v3.png](../screenshots/2026-11-01-density-compact-v3.png) |
| Inicialização | [2026-11-01-settings-startup-v3.png](../screenshots/2026-11-01-settings-startup-v3.png) |
| Avançado (versão, atualizações, registros) | [2026-11-01-settings-advanced-v3.png](../screenshots/2026-11-01-settings-advanced-v3.png) |
| **Anexos** | |
| Conversa com vídeo, áudio e arquivos | [2026-11-01-chat-attachments-v3.png](../screenshots/2026-11-01-chat-attachments-v3.png) |
| Grade de 5 (2 + 3) e de 3 (1 + 2) | [2026-11-01-chat-attachments-grid-v3.png](../screenshots/2026-11-01-chat-attachments-grid-v3.png) |
| Visualizador (ajustado) | [2026-11-01-chat-lightbox-v2.png](../screenshots/2026-11-01-chat-lightbox-v2.png) |
| Visualizador (tamanho real) | [2026-11-01-chat-lightbox-actual-v2.png](../screenshots/2026-11-01-chat-lightbox-actual-v2.png) |
| Bandeja: 4 arquivos + 1 grande demais (recusado antes do envio) | [2026-11-01-chat-attach-tray-v2.png](../screenshots/2026-11-01-chat-attach-tray-v2.png) |
| Enviado | [2026-11-01-chat-attachments-sent-v2.png](../screenshots/2026-11-01-chat-attachments-sent-v2.png) |
| Arrastar para a conversa | [2026-11-01-chat-drop-zone-v2.png](../screenshots/2026-11-01-chat-drop-zone-v2.png) |
| Enviando (progresso real, link lento) | [2026-11-01-chat-upload-progress-v1.png](../screenshots/2026-11-01-chat-upload-progress-v1.png) |
| Link caiu no meio do envio | [2026-11-01-chat-upload-failed-v1.png](../screenshots/2026-11-01-chat-upload-failed-v1.png) |
| Reenviado | [2026-11-01-chat-upload-retried-v1.png](../screenshots/2026-11-01-chat-upload-retried-v1.png) |
| Apelido + cor de cargo nas mensagens | [2026-11-01-chat-nicknames-v2.png](../screenshots/2026-11-01-chat-nicknames-v2.png) |
| **Configurações do espaço** | |
| Visão geral (ícone enviado) | [2026-11-01-space-settings-overview-v4.png](../screenshots/2026-11-01-space-settings-overview-v4.png) |
| Recorte do ícone | [2026-11-01-space-settings-icon-crop-v4.png](../screenshots/2026-11-01-space-settings-icon-crop-v4.png) |
| Ícone no rail | [2026-11-01-space-icon-rail-v2.png](../screenshots/2026-11-01-space-icon-rail-v2.png) |
| Cargos (dono) | [2026-11-01-space-settings-roles-v4.png](../screenshots/2026-11-01-space-settings-roles-v4.png) |
| Cargos reordenados | [2026-11-01-space-settings-roles-reordered-v3.png](../screenshots/2026-11-01-space-settings-roles-reordered-v3.png) |
| Editor de cargo | [2026-11-01-space-settings-role-editor-v4.png](../screenshots/2026-11-01-space-settings-role-editor-v4.png) |
| Cargos vistos pela Moderação (acima dela: cadeado) | [2026-11-01-space-settings-roles-limited-v2.png](../screenshots/2026-11-01-space-settings-roles-limited-v2.png) |
| Cargo acima do seu: tudo desabilitado, com o motivo | [2026-11-01-space-settings-role-locked-v2.png](../screenshots/2026-11-01-space-settings-role-locked-v2.png) |
| Membros | [2026-11-01-space-settings-members-v3.png](../screenshots/2026-11-01-space-settings-members-v3.png) |
| Ações do membro | [2026-11-01-space-settings-member-menu-v3.png](../screenshots/2026-11-01-space-settings-member-menu-v3.png) |
| Ações bloqueadas pela hierarquia | [2026-11-01-space-settings-members-limited-v2.png](../screenshots/2026-11-01-space-settings-members-limited-v2.png) |
| Banir com motivo | [2026-11-01-space-settings-ban-v3.png](../screenshots/2026-11-01-space-settings-ban-v3.png) |
| Banimentos | [2026-11-01-space-settings-bans-v2.png](../screenshots/2026-11-01-space-settings-bans-v2.png) |
| **E-mail e senha** | |
| Faixa "Confirme seu e-mail" na Home | [2026-11-01-home-verify-strip-v1.png](../screenshots/2026-11-01-home-verify-strip-v1.png) |
| Convite sem e-mail confirmado: frase + "Confirmar e-mail" | [2026-11-01-space-invite-unverified-v1.png](../screenshots/2026-11-01-space-invite-unverified-v1.png) |
| Diálogo: código inválido | [2026-11-01-verify-email-dialog-v1.png](../screenshots/2026-11-01-verify-email-dialog-v1.png) |
| Diálogo: reenviado, contagem, link colado | [2026-11-01-verify-email-resent-v1.png](../screenshots/2026-11-01-verify-email-resent-v1.png) |
| Confirmado: o mesmo convite funciona | [2026-11-01-space-invite-verified-v1.png](../screenshots/2026-11-01-space-invite-verified-v1.png) |
| Esqueci minha senha | [2026-11-01-auth-forgot-v1.png](../screenshots/2026-11-01-auth-forgot-v1.png) |
| Nova senha recusada pelo servidor (repetição) | [2026-11-01-auth-reset-weak-v1.png](../screenshots/2026-11-01-auth-reset-weak-v1.png) |
| Senha trocada, de volta ao login | [2026-11-01-auth-reset-done-v1.png](../screenshots/2026-11-01-auth-reset-done-v1.png) |
| **Links, convites, plano e loja** | |
| Deep link de confirmação de e-mail (segunda instância) | [2026-11-01-deeplink-verify-email-v5.png](../screenshots/2026-11-01-deeplink-verify-email-v5.png) |
| Deep link de convite com sessão: prévia | [2026-11-01-deeplink-invite-signed-in-v2.png](../screenshots/2026-11-01-deeplink-invite-signed-in-v2.png) |
| Deep link de convite sem sessão: aviso no login | [2026-11-01-deeplink-invite-signed-out-v2.png](../screenshots/2026-11-01-deeplink-invite-signed-out-v2.png) |
| … e a prévia depois de entrar | [2026-11-01-deeplink-invite-after-login-v2.png](../screenshots/2026-11-01-deeplink-invite-after-login-v2.png) |
| Deep link de nova senha (token em uso, nunca exibido) | [2026-11-01-deeplink-reset-password-v2.png](../screenshots/2026-11-01-deeplink-reset-password-v2.png) |
| Convites ativos | [2026-11-01-space-settings-invites-list-v2.png](../screenshots/2026-11-01-space-settings-invites-list-v2.png) |
| Convite recém-gerado (borda + Copiado) | [2026-11-01-space-settings-invites-created-v2.png](../screenshots/2026-11-01-space-settings-invites-created-v2.png) |
| Revogar convite | [2026-11-01-space-settings-invite-revoke-v2.png](../screenshots/2026-11-01-space-settings-invite-revoke-v2.png) |
| Convite revogado | [2026-11-01-space-settings-invite-revoked-v2.png](../screenshots/2026-11-01-space-settings-invite-revoked-v2.png) |
| Assinatura: Grátis + comparação (sandbox) | [2026-11-01-billing-plan-free-v5.png](../screenshots/2026-11-01-billing-plan-free-v5.png) |
| Assinar (anual): renovação e reembolso antes do clique | [2026-11-01-billing-subscribe-yearly-v5.png](../screenshots/2026-11-01-billing-subscribe-yearly-v5.png) |
| Aguardando a confirmação do pagamento | [2026-11-01-billing-checkout-waiting-v5.png](../screenshots/2026-11-01-billing-checkout-waiting-v5.png) |
| Pagamento confirmado (ENTITLEMENTS_UPDATE) | [2026-11-01-billing-plan-arrived-v5.png](../screenshots/2026-11-01-billing-plan-arrived-v5.png) |
| Plus ativo | [2026-11-01-billing-plan-plus-v5.png](../screenshots/2026-11-01-billing-plan-plus-v5.png) |
| Histórico de compras | [2026-11-01-billing-history-v5.png](../screenshots/2026-11-01-billing-history-v5.png) |
| Cancelar renovação | [2026-11-01-billing-cancel-confirm-v5.png](../screenshots/2026-11-01-billing-cancel-confirm-v5.png) |
| Renovação cancelada | [2026-11-01-billing-plan-canceled-v5.png](../screenshots/2026-11-01-billing-plan-canceled-v5.png) |
| Voz e vídeo: qualidades do plano (Grátis) | [2026-11-01-settings-voice-plan-free-v5.png](../screenshots/2026-11-01-settings-voice-plan-free-v5.png) |
| Voz e vídeo: qualidades do plano (Plus) | [2026-11-01-settings-voice-plan-plus-v5.png](../screenshots/2026-11-01-settings-voice-plan-plus-v5.png) |
| Loja: prévia da decoração Folha de alga | [2026-11-01-shop-preview-decoration-v5.png](../screenshots/2026-11-01-shop-preview-decoration-v5.png) |
| Loja: tema Noite paulistana | [2026-11-01-shop-preview-theme-v5.png](../screenshots/2026-11-01-shop-preview-theme-v5.png) |
| Loja: efeito Bioluminescência | [2026-11-01-shop-preview-effect-v5.png](../screenshots/2026-11-01-shop-preview-effect-v5.png) |
| Loja: placa Cardume | [2026-11-01-shop-preview-nameplate-v5.png](../screenshots/2026-11-01-shop-preview-nameplate-v5.png) |
| Loja: item só da Coleção Plus | [2026-11-01-shop-plus-only-v5.png](../screenshots/2026-11-01-shop-plus-only-v5.png) |
| Compra aguardando | [2026-11-01-shop-checkout-waiting-v5.png](../screenshots/2026-11-01-shop-checkout-waiting-v5.png) |
| Comprado: Coral em uso | [2026-11-01-shop-purchased-v5.png](../screenshots/2026-11-01-shop-purchased-v5.png) |
| Compra recusada | [2026-11-01-shop-checkout-declined-v5.png](../screenshots/2026-11-01-shop-checkout-declined-v5.png) |
| Loja com a Coleção Plus em uso | [2026-11-01-shop-plus-collection-v5.png](../screenshots/2026-11-01-shop-plus-collection-v5.png) |
| Lista de membros com cosméticos (discreto) | [2026-11-01-members-cosmetics-v5.png](../screenshots/2026-11-01-members-cosmetics-v5.png) |
| Popover de perfil com cosméticos | [2026-11-01-profile-popover-cosmetics-v5.png](../screenshots/2026-11-01-profile-popover-cosmetics-v5.png) |
| Popover de perfil sem cosméticos | [2026-11-01-profile-popover-plain-v5.png](../screenshots/2026-11-01-profile-popover-plain-v5.png) |
| Seu painel: cartão de perfil + status | [2026-11-01-user-panel-profile-v5.png](../screenshots/2026-11-01-user-panel-profile-v5.png) |
| **Conversa** | |
| Login ("Esqueci minha senha" no rótulo) | [2026-11-01-auth-login-v9.png](../screenshots/2026-11-01-auth-login-v9.png) |
| Login: erro + Caps Lock (cartão ancorado no topo) | [2026-11-01-auth-login-error-v8.png](../screenshots/2026-11-01-auth-login-error-v8.png) |
| Cadastro: erros por campo | [2026-11-01-auth-register-errors-v6.png](../screenshots/2026-11-01-auth-register-errors-v6.png) |
| Primeira execução (passo 1 de 2) | [2026-11-01-onboarding-v5.png](../screenshots/2026-11-01-onboarding-v5.png) |
| Primeira execução (criar espaço) | [2026-11-01-onboarding-create-space-v5.png](../screenshots/2026-11-01-onboarding-create-space-v5.png) |
| Amigos: Online | [2026-11-01-friends-online-v3.png](../screenshots/2026-11-01-friends-online-v3.png) |
| Foco por teclado visível | [2026-11-01-focus-visible-tabs-v2.png](../screenshots/2026-11-01-focus-visible-tabs-v2.png) |
| Amigos: Todos | [2026-11-01-friends-all-v3.png](../screenshots/2026-11-01-friends-all-v3.png) |
| Amigos: Pendentes (Aceitar ≠ Recusar) | [2026-11-01-friends-pending-v3.png](../screenshots/2026-11-01-friends-pending-v3.png) |
| Amigos: menu de contexto | [2026-11-01-friends-context-menu-v3.png](../screenshots/2026-11-01-friends-context-menu-v3.png) |
| Adicionar amigo: erro no lugar | [2026-11-01-friends-add-error-v3.png](../screenshots/2026-11-01-friends-add-error-v3.png) |
| Mensagem direta | [2026-11-01-dm-v6.png](../screenshots/2026-11-01-dm-v6.png) |
| Canal | [2026-11-01-chat-channel-v6.png](../screenshots/2026-11-01-chat-channel-v6.png) |
| Barra de ações no hover (3 reações, +reação, responder, mais) | [2026-11-01-chat-hover-toolbar-v6.png](../screenshots/2026-11-01-chat-hover-toolbar-v6.png) |
| Menu de contexto da mensagem (agrupado por rótulo) | [2026-11-01-chat-context-menu-v6.png](../screenshots/2026-11-01-chat-context-menu-v6.png) |
| Respondendo no composer | [2026-11-01-chat-reply-composer-v6.png](../screenshots/2026-11-01-chat-reply-composer-v6.png) |
| Edição inline (Kbd) | [2026-11-01-chat-inline-edit-v6.png](../screenshots/2026-11-01-chat-inline-edit-v6.png) |
| @menção: autocomplete | [2026-11-01-chat-mention-autocomplete-v2.png](../screenshots/2026-11-01-chat-mention-autocomplete-v2.png) |
| Seletor de emoji | [2026-11-01-chat-emoji-picker-v2.png](../screenshots/2026-11-01-chat-emoji-picker-v2.png) |
| Pílula de novas mensagens | [2026-11-01-chat-jump-pill-v3.png](../screenshots/2026-11-01-chat-jump-pill-v3.png) |
| Carregando (rede lenta): skeleton | [2026-11-01-chat-loading-skeleton-v4.png](../screenshots/2026-11-01-chat-loading-skeleton-v4.png) |
| Servidor fora: chip na title bar + envio com falha | [2026-11-01-banner-reconnecting-send-failed-v4.png](../screenshots/2026-11-01-banner-reconnecting-send-failed-v4.png) |
| Reenvio após reconectar | [2026-11-01-chat-send-retried-v4.png](../screenshots/2026-11-01-chat-send-retried-v4.png) |
| Boot sem servidor: splash com causa provável | [2026-11-01-splash-offline-v4.png](../screenshots/2026-11-01-splash-offline-v4.png) |
| Ctrl+K: seções (Precisa de você, Conversas, Canais, Pessoas, Espaços) | [2026-11-01-switcher-v5.png](../screenshots/2026-11-01-switcher-v5.png) |
| Ctrl+K com busca: agrupado por tipo, trecho que casou em 590 | [2026-11-01-switcher-query-v5.png](../screenshots/2026-11-01-switcher-query-v5.png) |
| Status e perfil | [2026-11-01-user-status-v4.png](../screenshots/2026-11-01-user-status-v4.png) |
| Menu do espaço (com "Configurações do espaço") | [2026-11-01-space-menu-v8.png](../screenshots/2026-11-01-space-menu-v8.png) |
| Convite | [2026-11-01-space-invite-v4.png](../screenshots/2026-11-01-space-invite-v4.png) |
| Criar canal (selecionado sobe em luminância) | [2026-11-01-space-create-channel-v3.png](../screenshots/2026-11-01-space-create-channel-v3.png) |
| Entrar com convite: prévia | [2026-11-01-space-join-preview-v3.png](../screenshots/2026-11-01-space-join-preview-v3.png) |
| Tamanho mínimo 960×600 | [2026-11-01-shell-960x600-v3.png](../screenshots/2026-11-01-shell-960x600-v3.png) |
| 1920×1080 a 125% | [2026-11-01-shell-1920x1080@125-v3.png](../screenshots/2026-11-01-shell-1920x1080@125-v3.png) |

Onda 3 (anexos, configurações do espaço, conta): API própria na porta 4100 (`ALGA_API_URL`, banco PGlite, uploads e caixa de e-mail em diretório temporário; `ALGA_OUTBOX_DIR` lê os tokens de confirmação e de redefinição), mídia sintética gerada com ffmpeg (gradientes, fractal, padrões de teste, vídeo e áudio de teste; nenhum arquivo pessoal), progresso e queda de upload por um proxy TCP com taxa limitada que depois é derrubado, URL vencida por um interceptador que responde 403 na primeira carga.

Onda 4 (links, convites, plano, loja; `--only=billing,invites`): API própria na porta 4100 com `BILLING_PROVIDER=sandbox`. O checkout é o fluxo real: o `shell.openExternal` do main é trocado por um gravador (o handler IPC do app ainda valida a URL), o script abre a URL como o navegador abriria, o provedor sandbox confirma pelo mesmo caminho de um webhook verificado e o `ENTITLEMENTS_UPDATE` chega ao app; "recusado" é a mesma página com `outcome=decline`. Uma pessoa nova (Íris) a cada execução, porque o histórico de compras não se apaga. Deep links: segunda instância do Electron no mesmo perfil com `algameet://…` (o main repassa para a instância aberta) e partida a frio com o link no argv, com tokens tirados da caixa de e-mail da API de teste.

Validação: cada tela foi capturada no app Electron real (`--profile=shots`) com dados criados pela API REST real; estados de rede (lento, servidor fora, boot sem servidor) vêm de um proxy TCP no script, não de dados falsos no app. Tamanhos: 1320×840 (padrão), 960×600 (mínimo) e 1920×1080 a 125%.

Voz: duas instâncias reais (`--profile=shots` e `--profile=shots-b`) no mesmo canal pelo LiveKit local, com dispositivos falsos do Chromium. O microfone de B é uma fala pt-BR gerada (SAPI + ffmpeg), então o brilho segue um envelope de voz real; a transmissão de A passa pelo fluxo real do app (seletor → `startScreenShare` → SFU → `watch` em B → decodificação) com a fonte de desktop falsa do Chromium como imagem, para não capturar a tela de ninguém. As miniaturas do seletor mostram um padrão de teste em tela cheia (ffplay) pelo mesmo motivo. Moderação, VOICE_MOVE e VOICE_DISCONNECT são disparados pela API real; "reconectando" é o LiveKit derrubado de verdade e religado.
