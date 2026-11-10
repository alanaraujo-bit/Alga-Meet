# Alga Meet — Design system

> Referência viva das telas. Direção visual: **B · Índigo suave** (a linguagem visual da Linear aplicada ao nosso produto; régua medida em `docs/research/linear-design-study.md`).
> Código: tokens em `apps/desktop/src/renderer/src/styles/tokens.css` (contraste verificado em `tokens.test.ts`), componentes em `apps/desktop/src/renderer/src/ui/`, ícones em `ui/icons.tsx`.
> Evidência: screenshots do app real em `docs/screenshots/` (gerados por `apps/desktop/scripts/screenshot.mjs`; a passada desta direção usa `ALGA_SHOTS_TAG=v2-indigo`) e comparações lado a lado com a Linear em `docs/design/compare/`.

## Direção B — por quê

O dono rejeitou o visual "Bioluminescência": o teal/ciano soava **artificial, robótico, "tech" demais**, e o app não lembrava a Linear em nada, "nem os ícones, nem nada". Ele escolheu a direção **B · Índigo suave** e deixou o critério de aceite em uma frase:

> *"Eu quero algo gostoso, algo sexy, algo que as pessoas tenham prazer de ver e de utilizar. Lembre-se disso sempre."*

Daí as decisões desta direção:

- **Quase nenhuma cor.** Superfícies quase pretas e neutras, hierarquia por luminância. O índigo suave aparece em poucos lugares, e por isso significa algo: onde você está, a ação principal, o foco, a voz.
- **A qualidade da Linear, não a marca dela.** Mesma família de valores medidos (texto 13 px, tracking negativo, bordas brancas translúcidas, menus de vidro, 100 ms ease-out), nenhum logo, ilustração ou ativo proprietário.
- **Calma é o luxo.** Quem fala ganha um anel índigo de 2 px que acompanha a voz. Sem brilho, sem neon, sem luz ambiente.
- **Prazer nos detalhes, não em efeitos.** Brilho de topo no botão primário, borda acesa no topo dos cartões e menus, hover que entra em 0 ms e sai em 120 ms, foco nítido, alinhamento exato. Gradiente só onde se paga: botão primário, cartão de upgrade, marca.

## 1. Princípios aplicados

1. **O palco manda, o cromo recua (L invertido).** Title bar, rail e lista de canais são um plano escuro só (`#0b0b0c`). A conversa e o palco são um painel um degrau acima (`#0f1011`), encaixado nesse plano com raio de 12 px, filete branco a 5 % e anel escuro externo. Configurações usam o mesmo painel.
2. **Hierarquia por luminância.** Quatro degraus de texto e seis de superfície. Cor saturada só para estado (ao vivo, mudo, erro, menção) e sempre dessaturada.
3. **"Você está aqui" é índigo; o resto é neutro.** O item atual da sidebar, da navegação de configurações e do rail ganha a tinta índigo (`--state-current`, `#1d1d2c` sobre o cromo) e o glifo **sólido** em `--accent`. Hover, pressionado e destaque de menu ficam neutros (branco 4–8 %).
4. **O índigo é a voz e a ação.** Ele aparece em: foco, item atual, ação primária, menção, quem está falando, presença de voz no cromo. Texto sobre o preenchimento índigo é branco (5,0:1).
5. **Resposta direta é instantânea.** Hover entra em 0 ms e sai em 120 ms; seleção em lista muda no mesmo quadro. Só mudança de contexto anima (≤ 300 ms, ease-out).
6. **Progresso no lugar da ação.** "Enviando…" no próprio balão, "Não enviada · Tentar de novo" na mensagem, banner de reconexão com contagem regressiva, splash que explica a falha. Spinner sem texto é bug.
7. **Estado nunca só por cor.** Presença tem forma (ponto, lua, barra, anel); mudo/ensurdecido têm ícone riscado + tooltip; toggle ligado tem glifo sólido; não lido = peso 590 + ponto de 6 px.
8. **Voz e presença primeiro.** O esqueleto continua familiar para quem vem do Discord (espaços à esquerda, canais, chat), mas o que o produto mostra primeiro é *onde as pessoas estão agora*: "Agora" no topo da Home, frondes vivas no rail e nos canais de voz, "3 em Sala de foco" no header do chat, "Em voz" abrindo a lista de membros, painel "Voz conectada" sempre visível, palco de chamada como tela principal do canal de voz.
9. **A UI nunca mente sobre o estado.** Sem conexão de tempo real, presença fica incerta (ponto a 40 %) e o status diz "Reconectando…"; sem mídia, os tiles ficam cinza, sem anel, e o palco diz que você não está ouvindo ninguém.

## 2. Tokens

Todo valor sai de `tokens.css`. Cores neutras são passos de luminância OKLCH com croma quase zero (H ≈ 282, C ≤ 0,004), como a Linear gera os temas dela em LCH; o acento é uma rampa única em H 279. `tokens.test.ts` falha se qualquer par desenhado cair abaixo de AA ou se o teal antigo voltar ao renderer.

### Superfícies

| Token | Hex | OKLCH L | Uso |
|---|---|---|---|
| `--bg-app` | `#0b0b0c` | .150 | title bar, rail (o cromo) |
| `--bg-sidebar` | `#0b0b0c` | .150 | lista de canais/DMs: o mesmo plano do cromo |
| `--bg-content` | `#0f1011` | .172 | painel: conversa, palco, lista de membros, configurações |
| `--bg-raised` | `#161718` | .203 | cards, composer, tile sem câmera |
| `--bg-overlay` | `#1b1b1d` | .222 | tooltip, toast, dock da chamada (sólido) |
| `--bg-glass` | `rgba(27,27,30,.9)` + `--glass-blur` (`blur(20px) saturate(1.6)`) | — | menus, popovers, toasts, barra de ações da mensagem |
| `--bg-modal` | `#171719` | .205 | modal (scrim `rgba(0,0,0,.56)`) |

Overlays de estado sobre qualquer nível: `--state-hover` 4 %, `--state-selected` 6 %, `--state-pressed` 8 % (branco). `--state-current` = `rgba(150,152,255,.13)` (→ `#1d1d2c` no cromo), `--state-current-hover` .17.

### Texto

| Token | Hex | Pior contraste medido | Uso |
|---|---|---|---|
| `--text-primary` | `#f7f8f8` | 14,4:1 (vidro sobre mídia cinza); 17,9:1 no painel | títulos, nomes, item atual |
| `--text-secondary` | `#d0d6e0` | 10,5:1 (vidro sobre mídia cinza); 13,0:1 no painel | corpo de mensagem, hover |
| `--text-tertiary` | `#8a8f98` | 4,7:1 (vidro sobre mídia cinza); 5,9:1 no painel | itens inativos, metadados, rótulos, placeholders |
| `--text-disabled` | `#62666d` | — | só desabilitado/decorativo, nunca informação |

### Bordas, acento e semântica

- **Bordas translúcidas:** `--border-subtle` 5 %, `--border-default` 8 % (≈ `#1f2023` no cromo), `--border-strong` 12 %. Antes de pôr uma linha, tente espaço.
- **Acento índigo suave (H 279):** `--accent #8b8ef7` (texto, ícone, foco, anel de fala; 6,6:1 no painel) · `--accent-hover #a2a8fc` (link em hover) · `--accent-fill #6163d0` (preenchimento, branco 5,0:1) · `--accent-fill-hover #6466d4` · `--accent-pressed #5a5bc1` · `--on-accent #fff` · `--accent-tint` 10 % · `--accent-tint-strong` 18 % · `--accent-sheen` (branco 10 % → 0 em 55 %, o brilho de topo dos preenchimentos) · `--selection-bg` `rgba(110,114,232,.38)`.
  - O mock aprovado tinha o botão em `#6e72e8`; com texto branco ele dá 4,0:1, então o preenchimento desceu para `#6163d0` (5,0:1) e o `#8b8ef7` ficou para texto, ícone e anel.
- **Semântica (dessaturada, rara):** `--online/--success #61c28e` · `--idle/--warning #e6b463` · `--danger/--dnd #e66e68` (texto) com `--danger-fill #c04444` (branco 5,1:1) · `--live #e86885` com `--live-fill #be395e` (branco 5,3:1): "ao vivo" é uma rosa, separada do vermelho de perigo · `--offline #777a80`.
- **Vermelho só para @menção, erro e perigo** (sair, desconectar, recusar). Contadores informativos usam `Badge` neutro (branco 10 %); `Badge mention` é `--danger-fill`. A linha "Novas" é índigo a 42 % com o rótulo "furando" a linha.
- **Ao vivo = rosa, pequeno.** Selo "AO VIVO" em `--live-fill` + texto branco, com ponto que respira. Um selo, nunca um alarme.
- **Avatares de iniciais:** disco `#26272b`-like com um sussurro do matiz da pessoa (`oklch(.29 .02 H)`, tinta `oklch(.86 .03 H)`), matizes 140 · 235 · 255 · 275 · 295 · 315 · 340 · 15 (sem teal/ciano, sem a faixa 40–110 que vira barro). Espaços sem ícone usam o mesmo hash como tinta de 8 % (`tintFor`). Em 20 px ou menos, só o disco.
- **Cores de perfil** (`ACCENTS`, Minha conta): OKLCH L .50 C .085, índigo primeiro, grafite por último, iniciais brancas ≥ 5,8:1 (`#595e93 #3b6692 #6f568a #834f72 #8d4e4f #86572d #486f40 #62636a`).
- **Cores de cargo** (`ROLE_COLORS`, `spaceSettings/strings.ts`): 8 tons OKLCH L .83 C .045 nos matizes 245 · 300 · 330 · 0 · 30 · 60 · 90 · 120 (`#b0cbe3 #cbc1e1 #d9bdd5 #e1bcc6 #e3bdb6 #dec1ab #d3c7a7 #c3ccac`): o nome lê como branco tingido. Ficam de fora H 140–215 (verde de online) e 270–290 (o índigo), então um nome colorido nunca lê como estado ou menção.
- **Mistura de cor em sRGB.** `color-mix(in oklch, X, transparent)` desloca o matiz no Chromium. Use `in srgb` ou `rgba()`.

### Tipografia

Inter Variable embarcada (`@fontsource-variable/inter/opsz.css`): o pacote traz o eixo **`opsz` 14–32** além do `wght`. Títulos fixam o eixo na ponta display (`font-variation-settings: var(--opsz-display)` = `'opsz' 32`), que é a Inter Display que a Linear usa nos títulos; o texto corrido fica no `font-optical-sizing: auto`. Recursos: `'calt', 'cv01', 'ss03'` (a de duas barrigas, 1 reto, aspas redondas). Números tabulares (`.tnum` ou `font-variant-numeric`) em horários, contadores, badges, reações, preços e estatísticas.

| Token | Tamanho/linha | Peso | Tracking | Uso |
|---|---|---|---|---|
| `--type-badge` | 11/14 | 590 | 0 | badges, contadores |
| `--type-meta` | 12/16 | 400–510 | 0 | horários, rótulos de seção, tooltips |
| `--type-ui` | 13/20 | 400–510 | −0,008em | listas, menus, botões, inputs (linha da sidebar 13/510) |
| `--type-ui-lg` | 14/20 | 510–590 | −0,011em | nome do canal no header, autores |
| `--type-message` | 15/22 | 400 | −0,011em | corpo de mensagem (Aparência: 14–17) |
| `--type-title-sm` | 17/24 | 590 | −0,016em | títulos de seção/painel (display) |
| `--type-title` | 20/28 | 590 | −0,016em | título de modal e de configurações (display) |
| `--type-title-lg` | 24/32 | 590 | −0,015em | login, intro de canal (display) |
| `--type-display` | 32/40 | 590 | −0,022em | onboarding (display) |

Pesos: 400, 510, 590, 680. O tracking negativo cresce com o tamanho, como a Linear mede (0 em 12 px, −0,01em em 13–15 px, −0,022em em display).

### Espaço, raio, alturas, camadas

- Espaço (base 4): `--s-0_5` 2 · `--s-1` 4 · `--s-1_5` 6 · `--s-2` 8 · `--s-3` 12 · `--s-4` 16 · `--s-5` 20 · `--s-6` 24 · `--s-8` 32 …
- Raio concêntrico: `xs 4` (badge, código) · `sm 6` (linha da sidebar, item de menu, botão 28–32) · `md 8` (input, botão 36) · `lg 12` (card, popover, painel, tile) · `xl 16` (modal) · `full` (pílulas, avatares, controles da chamada). Menu 10 = item 6 + padding 4.
- Alturas: 24 compacto · **28 linha de lista** · 32 botão/input · 36 botão primário/input de formulário · 40 controles de chamada.
- Layout: title bar 40 (140 px à direita livres para os botões nativos), rail 64, sidebar 248, membros 240, header 48, painel com 8 px de respiro à direita e embaixo. Lista de membros some abaixo de 1100 px.
- z-index: `sticky 100 · titlebar 200 · call-overlay 300 · overlay 500 · popover 600 · command-palette 650 · modal-scrim 699 · modal 700 · toast 800 · tooltip 1100 · context-menu 1200`.

### Elevação

Profundidade no escuro = luminância + filete translúcido + anel escuro externo + uma sombra larga e suave + borda acesa no topo (`inset 0 1px 0 rgba(255,255,255,.05)`).

- `--elev-low`: `0 1px 2px rgba(0,0,0,.3)` (botões preenchidos, thumb do segmented).
- `--elev-overlay`: anel `0 0 0 1px rgba(0,0,0,.45)`, `0 4px 12px` a 22 %, `0 16px 40px` a 38 %, topo aceso. Menus, popovers, tooltip, toast, dock.
- `--elev-modal`: anel a 50 %, `0 8px 20px` a 25 %, `0 32px 80px` a 50 %, topo aceso. Modal, switcher.
- **Vidro** (`--bg-glass` + `--glass-blur`) só em sobreposição pequena: menus, popovers, toasts, barra de ações da mensagem. Nunca em tela cheia nem no dock que fica sobre vídeo (custo de GPU durante o encode): o dock é sólido a 96 %.

## 2b. Ícones

**Decisão: Phosphor (`@phosphor-icons/react`), um sistema só, sempre pelo wrapper `ui/Icon`.** O Lucide saiu.

- **Por quê.** Comparamos os dois a 16 px sobre `#0f1011`, em 100 % e 125 % (Lucide 1,75 e 1,5 absoluto; Phosphor regular, bold, fill, duotone). O Lucide é o ícone padrão de meio mundo (shadcn), e é isso que o dono leu como "genérico". O Phosphor tem geometria mais redonda e macia, o **bold** desenha 1,5 px a 16 px (o peso dos ícones da Linear) e, principalmente, tem **pesos de verdade**: `fill` para o estado sólido de "você está aqui / está ligado" e `duotone` para arte de estado vazio. O Lucide não tem variante preenchida.
- **Vocabulário.** `ui/icons.tsx` reexporta os glifos com os nomes do app (`Mic`, `Search`, `Settings`, `PhoneOff`…), então nenhuma feature importa o Phosphor direto; trocar um glifo é uma linha. Faltavam fones e monitor riscados: `slashed()` desenha o glifo base com o traço de risco do próprio Phosphor (48,48 → 208,224) recortado por máscara, nos mesmos pesos.
- **Peso por tamanho** (`Icon`): bold até 18 px (≈ 1,1–1,7 px de traço), regular a partir de 20 px (1,25–1,5 px). Tamanhos no grid de 2: 12 · 14 · 16 · 18 · 20 · 24.
- **Estados.** `filled`: item atual da sidebar (`#`, alto-falante, Amigos), da navegação de configurações e o Home do rail, sempre em `--accent`; `IconButton` com `aria-pressed` desenha o glifo sólido automaticamente (mudo, ensurdecido, membros). `duotone`: ícone do `EmptyState`.
- **Cor.** Ícone em repouso = `--text-tertiary`; hover sobe para `--text-primary`; atual = `--accent`. Nunca colorir ícone para decorar.

## 3. Movimento

| Token | Duração | Curva | Uso |
|---|---|---|---|
| `--dur-fast` | 100 ms | out-quad `(.25,.46,.45,.94)` | cor/fundo no hover, press, tooltip |
| `--dur-hover-out` | 120 ms | out-quad | saída do highlight (entrada é 0 ms) |
| `--dur-base` | 160 ms | out-quad | switch, escala do press nos controles da chamada |
| `--dur-pop` | 180 ms | out-quart `(.165,.84,.44,1)` | menu e popover (scale .97 + 2 px para cima → 1, com fade) |
| `--dur-morph` | 220 ms | out-quart | pílula do rail, segmented control |
| `--dur-panel` | 300 ms | sheet `(.32,.72,0,1)` | modal |

- Saída ≈ 0,75× a entrada, curva in-quad.
- **Press com corpo, sem demora:** controles da chamada escalam para .96 no `:active` (160 ms out-quart); botões preenchidos perdem o brilho de topo e ganham sombra interna. A cor responde no mesmo quadro.
- **Troca de espaço:** a folha entra 10 px na direção do item do rail escolhido (continuidade espacial), 180 ms, sem animação de saída.
- **Quem fala: um anel calmo no rosto, e a luz da sala.** `useEnvelope(ref, getLevel)` aplica envelope tipo compressor (ataque 60 ms, release 240 ms) direto em `--speak`, num rAF, sem re-render. O rosto ganha um anel `--accent` de 2 px com `opacity: min(1, speak × 2,2)` e uma borda macia de 2 px a no máximo 16 % (encolhe com `--halo-k` onde os avatares ficam juntos). **Só o rosto** tem anel (onda 9: o filete do tile saiu). O nome sobe de `--text-secondary` para `--text-primary` misturado pelo próprio `--speak` (`color-mix`), sem re-render. Com movimento reduzido, o valor salta entre 0 e 1.
- **A luz da sala (onda 9).** Uma única poça de luz larga e muito suave (1040×680, `radial-gradient` em `oklch(.62 .08 H / .12)` → `.05` → transparente) no matiz **de quem fala**, sob o rosto. Ela lê o `--speak` das cadeiras 10× por segundo (sem React): uma voz nova precisa durar 300 ms para a luz ir até ela (nada de pisca-pisca entre duas pessoas), o movimento leva 900 ms in-out-cubic, a cor muda junto (`@property --lh`), e depois de 900 ms de silêncio ela some em 700 ms. Só `transform`/`opacity` numa camada própria. Sem brilho, sem neon, desligada em reconexão e em alto contraste.
- **Ponto de voz (`VoiceDot`) = "tem gente em voz aqui".** Substitui as frondes como sinal de status (a marca v2 nunca é status; o logo fica na title bar, no login e no splash). Ponto de 6 px em `--accent`; na sua sala, um anel de 1,5 px, 3 px fora do ponto, com a opacidade seguindo a voz mais alta (`roomLevelNow`). Fora da sua sala o ponto fica parado (nada respira).
- **Entrar numa sala tem coreografia (onda 9).** Logo depois de entrar, os rostos chegam um depois do outro (`scale .94 → 1` + fade, 220 ms out-quart, 30 ms entre eles), no mesmo instante do som de entrada do motor (dó–sol); o dock sobe 12 px com fade (260 ms, 90 ms de atraso); a luz da sala acende quando a primeira voz aparece. Quem chega depois entra sozinho; sair é mais curto (130 ms). Nada é posicionado antes de o palco ser medido, então nenhum rosto desliza de uma coluna provisória. **Mudo:** o traço do disco de mudo se desenha em 120 ms (`stroke-dashoffset`), junto com o som de mudo.
- `prefers-reduced-motion` **e** a opção "Reduzir animações" (classe `html.reduce-motion`) zeram durações CSS e mudam o `MotionConfig` para `always`.

## 4. Componentes (`src/renderer/src/ui`)

| Componente | Notas |
|---|---|
| `Button` | `primary` (índigo `--accent-fill` + `--accent-sheen`, borda acesa no topo, anel escuro, texto branco 510) · `secondary` (branco 4 % + filete 8 %, topo aceso) · `secondary-danger` · `ghost` · `danger` (`--danger-fill` + brilho, texto branco); `sm/md/lg` (raio 6/6/8); `loading` mantém a largura e põe spinner. `secondary-danger` = superfície secundária com texto `--danger`: ação destrutiva em repouso. O fill `danger` fica no modal de confirmação e em Desconectar. |
| `IconButton` | Sempre com `label` (vira tooltip + `aria-label`). `disabledReason` mantém o foco e explica por quê (`aria-disabled`). `aria-pressed` para toggles: o glifo fica sólido. |
| `Icon` | Wrapper do Phosphor (§2b): peso por tamanho, `filled`, `duotone`, `aria-hidden` por padrão. |
| `TextField` | Fundo branco 2,5 % + filete 8 % (funciona em qualquer superfície); foco = borda índigo a 75 % + halo de 3 px a 16 %. Rótulo, dica, erro (`role=alert`), ícone à esquerda, slot à direita; senha com mostrar/ocultar. Caps Lock é um glifo âmbar de 14 px no slot da direita, com tooltip e lido pelo leitor de tela (`aria-describedby`), nunca uma linha a mais sob o campo. |
| `Avatar` | Imagem ou iniciais (disco quase neutro com o matiz da pessoa); filete interno de 4 %; recorte real sob o ponto de presença; `glowRef` para o anel de fala. Tamanhos de 16 a 128 (88, 112 e 128 são do palco). |
| `usePersonHue` / `personHue` | **A cor vem das pessoas.** Matiz da cor de perfil (`accentColor`) ou o matiz dominante do avatar (amostra de 16×16 em OKLab, ponderada pelo croma, cinzas ignorados), senão o hash de sempre. O medido entra em `hueFor`, então o banner do cartão de perfil já sai na cor da pessoa; no palco ele pinta o chão sob o rosto (6 %) e o chip do nome. A interface continua cinza e índigo. |
| `PresenceGlyph` | Online = ponto · Ausente = lua · Não perturbe = barra · Offline = anel. |
| `Tooltip` | Sólido (`--bg-overlay`), 12/510 em `--text-secondary`, entra em 100 ms. 450 ms de atraso, instantâneo entre controles vizinhos (janela de 300 ms), aparece no foco por teclado, Esc fecha. |
| `Menu` / `contextMenuHandler` / `MenuButton` | Vidro, raio 10, padding 4, itens de 28 px raio 6, destaque neutro (branco 7 %), ✓ em `--text-secondary`, grupos por rótulo (como o "Open in" da Linear). Setas/Home/End/typeahead, Enter/Espaço, Esc devolve o foco, separador, item `danger`, `checked`. Um host global (`MenuHost`). Aberto por um gatilho com mais de 200 px, tem no mínimo a largura dele. |
| `Modal` | Portal, scrim 56 %, raio 16, `--elev-modal`, foco preso (Tab cicla), Esc fecha só o do topo, devolve o foco, `data-autofocus` escolhe o primeiro foco. |
| `Popover` | Vidro. Conteúdo rico ancorado (status, perfil). Fecha com Esc/clique fora. |
| `toast` / `ToastHost` | Vidro. `toast.info/success/error(texto, { action })`, pausa no hover. Só para feedback longe do ponto de ação. Canto inferior direito; com o dock da chamada na tela, a pilha sobe acima dele (`--toast-bottom`). |
| `Tabs` / `SegmentedControl` | Tabs = pílulas como as da Linear (raio cheio, filete em repouso, a escolhida sobe de luminância). Segmented = trilho escurecido com thumb deslizante (branco 8 %, filete, topo aceso). Roving focus com setas. |
| `VoiceDot` | Ponto de 6 px em `--accent` = gente em voz aqui; com `getLevel`, o anel de 1,5 px segue a sala. Substituiu `Fronds` (onda 9). |
| `useEnvelope` / `useSpeakingGlow` | Envelope de voz em `--speak` no próprio elemento / no avatar (via `glowRef`). `Avatar glow` desenha o anel herdando `--speak` de um ancestral (tile). |
| `Badge` | Neutro por padrão (branco 10 %, texto secundário); `mention` = `--danger-fill`. |
| `Switch`, `Kbd`, `Divider` (com rótulo), `Skeleton`, `Spinner`, `EmptyState`, `ScrollArea` | Switch ligado = índigo com brilho de topo e thumb branco. `EmptyState`: ícone duotone num quadro de 48 px (gradiente branco 5 → 2 %, filete, topo aceso). Scrollbar: só `::-webkit-scrollbar` (thumb de 10 %, 16 % no hover, sem trilha, sem setas). |

## 5. Padrões de tela

- **Lista densa:** linhas de 28 px (canais) ou 40 px (DMs), sem separadores; não lido = peso 590 + texto primário; menções = badge vermelho.
- **Resposta:** uma linha 12/510 acima da mensagem ("↩ Carlinha · Só achei que…") e uma haste reta de 2 px (`rgba(255,255,255,.14)`) na coluna do avatar, descendo até ele. Sem o conector curvo: a conversa ganha um ritmo vertical próprio, e o clique na linha leva à original. No composer: "Respondendo a **Bruno Costa** · citação".
- **Autor:** nome e foto abrem o mesmo cartão de perfil da lista de membros (Mensagem, Ligar, amizade, ⋯).
- **Mensagens:** agrupadas por autor em janelas de 7 min (resposta sempre abre grupo), separador de dia, linha "Novas" presa ao marcador de leitura do momento em que o canal abriu, barra de ações no hover (reações rápidas, responder, editar, excluir), Shift+clique em excluir pula a confirmação.
- **Composer:** Enter envia, Shift+Enter quebra linha, ↑ edita a última mensagem sua, contador aparece faltando 400 caracteres e fica vermelho acima de 4000, rascunho por canal.
- **Vazios:** ícone em quadro de 48 px, título curto, uma frase em `text-tertiary`, no máximo um CTA.
- **Carregamento:** skeleton com o formato do conteúdo (mensagens), nunca spinner solto.
- **Falha:** explicada no lugar (campo, mensagem, chip, splash), sempre com uma saída ("Tentar de novo", "Descartar", "Sair da conta").
- **Conexão caiu:** um chip âmbar de 28 px substitui a busca na title bar ("Sem conexão. Tentando de novo em 3 s…" + "Tentar agora"); nada abaixo se move. Mesma frase no splash, com a causa provável. O composer avisa "Sem conexão. Sua mensagem sai quando voltar."
- **Composer:** filete de 5 % e topo aceso em repouso; no foco o filete sobe para 12 % e ganha uma sombra suave (como o "Leave a comment…" da Linear). `@` abre o autocomplete (membros do espaço ou destinatários do DM; ↑↓, Enter/Tab, Esc; vira `<@id>` no envio). Emoji: seletor compacto e pesquisável (≈120 emojis curados, palavras-chave pt-BR sem acento, sem dependência).
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
- **Banimentos** (`BAN_MEMBERS`): quem, motivo, data, "Revogar banimento". **Convites** (`CREATE_INVITES`): prazo (1 h … 30 dias, nunca com aviso) e usos (sem limite, 1 … 100); embaixo, **Convites ativos** de `GET /spaces/:id/invites` (com `MANAGE_SPACE`, todos; sem, só os seus, e a descrição diz qual). Linha de 48 px: avatar de quem criou, link em mono, "Criado por … · 3 de 10 usos · expira 2 de nov., 14:00", Copiar ("Copiado" no próprio botão) e lixeira. O convite recém-gerado ganha borda de 2 px em acento e o Copiar primário. Revogar confirma num modal ("…para de funcionar na hora. Quem já entrou por ele continua no espaço."); 404 conta como feito. Sem permissão para revogar, a lixeira fica `aria-disabled` com o motivo. A lista é ao vivo: `INVITE_CREATE` entra no topo e `INVITE_DELETE` tira a linha (revogado aqui, em outro aparelho ou junto com quem criou), sem polling. O servidor não anuncia uso nem expiração: o convite some no instante em que expira (timer até o próximo `expiresAt`) ou quando esgota, e o foco da janela rebusca as contagens de uso.

### Conta: foto, e-mail, senha

- **Foto do perfil / ícone do espaço (`settings/ImagePicker.tsx`):** prévia de 80 px, "Enviar/Trocar imagem", "Remover" e a regra numa linha. PNG/JPEG/WebP/GIF até 8 MB (`checkAvatar`, antes de qualquer envio). Recorte quadrado de 280 px: arrastar, roda do mouse, controle de zoom 1–4×, setas (Shift = passo maior) e +/−; o que o círculo não mostra fica escurecido. Sai num canvas como WebP de no máximo 1024 px (EXIF e o que ficou fora não saem da máquina). GIF pula o recorte para manter a animação. Ninguém mais manda URL externa de avatar: só `PUT /users/@me/avatar`, `PUT /spaces/:id/icon` ou `null`.
- **E-mail não confirmado:** uma faixa calma no topo da Home ("Confirme seu e-mail · Para convidar pessoas e criar mais espaços"), nunca modal, nunca vermelho; em Minha conta, a linha do e-mail diz o que fica bloqueado. Os 403 do servidor (convite, segundo espaço, DM com quem não é amigo) viram a frase do servidor + "Confirmar e-mail" no lugar do erro (`needsVerification`, `toastError`). O diálogo aceita o código ou o link inteiro (`parseEmailToken`: `?token=` ou o código puro), "Reenviar e-mail" com contagem ("Reenviar em 52 s"; 5 min depois de um 429) e fecha sozinho se a confirmação chegar por outro lado (`ME_UPDATE`).
- **Senha:** mínimo `MIN_PASSWORD_LENGTH` (10). Força em 4 barras sob o campo (`passwordStrength`: comprimento pesa mais, variedade ajuda, repetição/nome/e-mail derrubam) e a frase no hint; o servidor ainda recusa senha comum, repetida ou com seu usuário, e essa frase aparece no campo como veio. "Esqueci minha senha" no rótulo da senha → e-mail → (sempre 204) "Se houver uma conta com…, o link vale 1 hora" → colar link ou código + nova senha → volta ao login com "Senha trocada". Login por e-mail só depois de confirmar; o erro sugere entrar pelo nome de usuário. "Sair de todas as outras sessões" (`DELETE /auth/sessions`) aparece sempre, desabilitado quando só há este dispositivo; trocar a senha recarrega a lista.

### Confiança e segurança (`features/trust`)

Política em `docs/trust-safety/README.md`, promessas em `docs/legal`. Tom: dizer o que acontece e o que a pessoa pode fazer, nunca ameaçar. Vermelho só em erro de campo e na confirmação de excluir; o resto é neutro, com o acento em links e ação primária.
- **Cadastro:** data de nascimento num campo só, `DD/MM/AAAA` digitado como números (as barras entram sozinhas, `maskBirth`), sem valor inicial nem seletor de ano que empurre uma idade; a dica lê a data por extenso ("23 de abril de 2005 · Só para conferir a idade. Ninguém vê.") para pegar dia e mês trocados. Mesma regra do servidor (`parseBirth`, testada): data real, de 1900 até hoje no calendário de Brasília. **Caixa desmarcada** "Li e aceito os Termos de Uso e as Diretrizes da Comunidade, e li a Política de Privacidade." (a Política é lida, não consentida), links de `GET /legal` abrindo no navegador; manda `termsVersion`. **Abaixo de 16:** nada é enviado, o formulário some e um cartão calmo explica por quê ("Ainda não dá para criar sua conta… Nada do que você digitou foi enviado nem guardado."), sem "tentar de novo" e sem pista de qual data passaria.
- **Antes de entrar, uma vez** (`AccountGate`, no lugar do shell, mesmo cartão do login, sem a busca na title bar): `needsTermsAcceptance` → "Os Termos mudaram" com os três textos em linhas ("abre no navegador"), a caixa desmarcada e "Não concorda? Você pode sair ou excluir sua conta."; depois `ageBracket: 'unknown'` → "Qual é a sua data de nascimento?", a data por extenso e "a data não pode ser mudada depois". A mesma confirmação para qualquer idade (nada que sugira mentir). Abaixo de 16 o servidor suspende na hora e o app vai direto para a tela de conta restrita, com o recurso aberto.
- **16 e 17 anos:** Configurações › Privacidade abre com "Proteções da sua conta" (DM só entre amigos, nos dois sentidos; compras desativadas; somem aos 18). Em Assinatura e na Loja, o botão de compra vira um cartão "Compras pedem 18 anos" com o motivo; a prévia continua. Nunca um erro genérico do checkout.
- **Denunciar** (`openReport`, um diálogo para o app inteiro): no cartão de perfil da lista de membros (botão discreto embaixo), no menu do membro (botão direito), no menu de Amigos e no menu do espaço (quem não é dono). O alvo aparece no topo (avatar e nome, ou espaço e membros, ou a mensagem citada). Passo 1, motivo em linguagem simples, rádios nativos (setas funcionam): "Urgente" primeiro (sexualização de menores, ameaça, autolesão, imagem íntima), "Outros motivos" e "Mais motivos" recolhido; a frase de cada motivo aparece no escolhido. Passo 2, detalhes opcionais (1000) e "A pessoa denunciada nunca fica sabendo quem denunciou." Menores: cartão âmbar "Prioridade máxima" (fila primeiro, anexos fora do ar e guardados como prova para a Polícia Federal, a conta de quem denuncia identificada só para a equipe como a lei pede, não salvar nem encaminhar). Autolesão e ameaça: "Se alguém corre risco agora" com 190, 192 e CVV 188. Passo 3, "Denúncia recebida" e a oferta de bloquear a pessoa ali mesmo. Repetir a própria denúncia aberta diz que ela continua em análise. 10 por hora: a frase diz isso e lembra o 190.
- **Conta restrita** (`RestrictedScreen`, login 403 com `restriction` ou gateway 4010): "Sua conta está suspensa" (até quando, "depois disso, ela volta sozinha") ou "foi encerrada" ("não tem data para terminar"), a regra pela categoria (CSAM chega como a genérica e fica assim), e o recurso com o token de 1 hora do login: prazo, campo de 10 a 2000 caracteres, "Recurso enviado". Recurso aberto, negado ou prazo vencido viram uma nota no mesmo lugar; token vencido pede para entrar de novo. Idade abaixo do mínimo explica a exclusão em 30 dias e como a equipe confere a idade. Fechado pelo gateway (4010) com a sessão aberta: o login abre com "A equipe do Alga Meet aplicou uma medida na sua conta. Entre de novo para ver o motivo e como contestar."
- **Configurações › Privacidade:** "Ações na minha conta" (`GET /users/@me/actions`: ícone por tipo, regra, data, "Contestar até…", chip do recurso; contestar abre um modal com o mesmo formulário, pela sessão), os três textos legais, "Baixar uma cópia dos seus dados" (1 por dia; com o e-mail não confirmado o botão vira "Confirmar e-mail"; o pedido fica como "Pedido em… o link chega no seu e-mail" e o 429 mostra a frase do servidor) e "Excluir conta…".
- **Relatório de qualidade de chamada** (Privacidade, entre os textos legais e a cópia dos dados): "Enviar relatório de qualidade de chamada" com `Switch`, **desligado por padrão** (`PATCH /users/@me {telemetryOptIn}`), a dica diz o estado ("Desligado: nada é enviado."). Embaixo, num cartão `--bg-raised`, "O que vai" e "O que nunca vai" lado a lado e a retenção de 30 dias com a base legal, **com as palavras da Política de Privacidade** (`docs/legal/politica-de-privacidade.md`), não um resumo.
- **Cópia dos dados:** o estado vem de `GET /users/@me/exports` (o mais recente): "Preparando sua cópia, pedida em…" com spinner (a página pergunta de novo a cada 15 s só enquanto prepara, e no foco), "Pronta. Fica disponível até…" + **Baixar…** primário, "expirou" ou "não deu" com o pedido de novo. Baixar abre um modal que pede a senha de novo ("quem pegar uma sessão aberta sua não leva seus dados", link de 10 minutos, `EXPORT_DOWNLOAD_TTL_MINUTES`): `POST /users/@me/exports/:id/download {password}` → `openExternal(downloadUrl)`. Senha errada fica no campo; 404/409 recarregam o estado. Depois: "Download aberto no navegador."
- **Excluir conta:** modal com a data do fim dos 7 dias na descrição, "Suas mensagens" (padrão "Manter como “Usuário removido”", ou apagar), cada espaço seu com o destino ("passa para o membro com o cargo mais alto" / "é excluído com tudo o que tem dentro"), o que some e o que fica, a assinatura que para de renovar, a senha; foco inicial em "Manter minha conta". Confirmado: o login abre com "Sua conta será excluída em 8 de novembro de 2026. Mudou de ideia? Entre até lá e a exclusão é cancelada." Entrar nesse prazo mostra o toast "Exclusão cancelada".

### Painel da equipe (`features/staff`)

Só para a equipe: `Me` não diz quem é staff, então o shell pergunta uma vez por sessão (`GET /admin/reports?limit=1`: 200 = equipe; o 403 dos outros acontece antes do log de auditoria do servidor). Para a equipe, um escudo no fim do rail abre o painel (chunk à parte: ninguém mais baixa o código). Janela inteira abaixo da title bar, como as configurações, no estilo triagem do Linear:
- **Fila à esquerda** (nível sidebar, 320–380 px): Denúncias · Recursos · Quarentena (contagem neutra), filtro por estado (Abertas/Resolvidas/Arquivadas; Abertos/Revertidos/Mantidos). Linha de 2 níveis: motivo + idade `tnum`, tipo do alvo + resumo. Ordem do servidor (prioridade, depois a mais antiga). **Abuso infantil primeiro e com cuidado:** chip âmbar "Prioridade máxima" (nunca vermelho), a linha não mostra trecho do texto, o detalhe abre com um aviso calmo e o texto da mensagem fica oculto até "Mostrar o texto da mensagem". Anexos só como metadados (nome, tipo, tamanho, dimensões; o URL do snapshot é descartado, `readTarget`, testado) e **não há "ver evidência"**: a API não tem um caminho seguro para ver o arquivo em quarentena.
- **Detalhe à direita:** o alvo como estava (mensagem citada, perfil ou espaço com o dono), "O que a pessoa contou", quem denunciou com a confiabilidade ("2 denúncias arquivadas antes" em âmbar), e **Decisão**: Arquivar · Sem medida · Remover conteúdo · Avisar · Suspender · Banir, todos secundários com a tecla (`A N C V S B`); o que o servidor recusaria fica desabilitado com o motivo numa linha ("Para um perfil, use avisar, suspender ou banir."). Anexo da mensagem: "Pôr em quarentena" ou o chip "Em quarentena" + "Liberar". Recurso: a medida contestada, o texto da pessoa, "Manter a decisão" (`M`) / "Reverter a decisão" (`R`). Quarentena: tipo, SHA-256, prova guardada, origem (automática ou quem), protocolo da autoridade, "Liberar" (`L`).
- **Toda decisão confirma:** modal com o que acontece com quem ("A pessoa sai de todas as sessões e da voz agora…"), suspensão com 1/3/7/30 dias e a data de volta, nota opcional para a equipe, Ctrl Enter confirma, e no rodapé "Fica no log de auditoria com o seu nome, a hora e a nota". Liberar não tem nota e o primeiro foco é Cancelar (Enter sozinho nunca libera prova). Feito: a linha sai da fila aberta, a próxima toma o lugar e o topo do detalhe diz "Conta suspensa: Caio Torres · registrado no log de auditoria às 06:53". Itens decididos mostram quem, quando, a nota e "Registrado no log de auditoria".
- **Teclado primeiro:** ↑↓ ou J/K, 1 2 3 trocam a fila, letras abrem a decisão, Esc fecha (modal primeiro); legenda no pé da fila. Nada faz polling: cada chamada de admin fica no log de auditoria, então a fila carrega ao abrir, depois de cada ação e no botão Atualizar.

### Sala de cinema: tela cheia, chat e cadeado (`features/cinema/room`)

- **Tela cheia leva tudo junto.** Só o elemento em tela cheia é desenhado, então menus, dicas, popovers, diálogos e avisos são montados nele (`ui/portal.ts`, `usePortalTarget`) e seguem a entrada e a saída da tela cheia.
- **Chat ao vivo** (`ChatLayer.tsx`, `chat.ts`): canto inferior esquerdo, acima de duas linhas de legenda (o fundo fica a 214 px da base; sobe 56 px quando os controles aparecem), largura `min(380px, 36vw)`. Cada linha é uma pílula `rgba(10,10,12,.64)` com filete de 6 %, sem blur (backdrop-filter sobre filme custa GPU em todo quadro): avatar de 20 px, nome em 590 na cor da pessoa (`oklch(.84 .09 H)`), texto 13/20. Entra subindo 10 px com escala .96 em 280 ms; some com fade de 320 ms. Fechado: até 4 linhas, cada uma por 8 s, e um único timer acorda a camada na próxima saída. Aberto (Enter ou o botão de balão nos controles): as 8 mais recentes e um campo-pílula de 38 px com foco índigo, "Enter envia · Esc fecha"; vazio fecha. Uma linha, até 200 caracteres, 4 seguidas e depois uma a cada 2 s (o app segue o mesmo balde do servidor e avisa "Calma, espere um instante…" sem perder o texto). ⋯ › "Mostrar o chat sobre o filme" esconde.
- **Cadeado** (`lock.ts`, `LockLayer.tsx`): segurar Espaço 3 s trava, segurar de novo destrava; o selo também pode ser segurado com o mouse, e ⋯ › "Travar a tela" trava direto. Espaço tocado continua sendo tocar/pausar, agora **ao soltar** (pausar no aperto pausaria a sala inteira antes de virar cadeado). Depois de 350 ms segurando aparece o selo no centro da tela com um anel que enche até os 3 s (rAF, então enche mesmo com movimento reduzido: é informação). Travada: uma camada invisível engole cliques, roda e menu de contexto; toda tecla para ali (atalhos do app inclusive), menos Esc, que só sai da tela cheia; os controles não sobem. Mexer o mouse ou tocar uma tecla mostra o selo "Tela travada · Segure Espaço por 3 s para destravar, ou segure aqui" por 2,6 s. O filme, as vozes e o chat seguem. Sair da sala destrava.

### Feedback (`features/feedback`, "Conta pro Eco")

Onde a pessoa conta um bug, um travamento, uma ideia ou um elogio. Como funciona e o que vai junto: `docs/feedback.md`.
- **Discreto por decisão do dono:** nada no rail. Abre por Ctrl K › "Enviar feedback", pelo menu do usuário (acima de Sair) e por Configurações › Avançado.
- **Cartão, não modal:** 400 px, `--bg-modal` + `--elev-modal`, raio 16, sobre o painel do usuário (`anchor.ts` mede a altura do dock, que cresce com o painel de voz), `aria-modal="false"`, sem scrim. O app continua usável por trás (reproduzir o bug, ir até a tela certa). Esc com o foco nele ou × fecham; o rascunho (tipo e texto) fica em `localStorage`, por conta.
- **Cor por tipo** (`--fb-tone`, registrada com `@property` para trocar em 450 ms): Bug `--danger` · Travou `--warning` · Ideia `--accent` · Elogio `--success`. Pinta a poça de luz atrás do Eco (um `radial-gradient` a 24 % → 8 % → 0, respirando em 5,2 s), o contorno do Eco, o anel de foco do campo e o ponto de cada pílula. Único lugar do app em que as cores semânticas não significam estado: aqui elas são a categoria do envio.
- **O Eco reage** (`useMood`): pulinho ao abrir · ao escolher o tipo, `listening` (Bug), `error` (Travou), `success` (Ideia, Elogio) por 1,1 s · `listening` enquanto digita (volta 900 ms depois) · `streaming` por 1 s quando o print entra · `connecting` enviando · `error` na falha e por 700 ms no envio vazio (o campo balança 300 ms) · `success` no enviado.
- **Movimento:** cartão `y 12, scale .96 → 0, 1` em 260 ms out-quart (saída 140 ms); Eco 80 ms depois, com mola; miniatura do print cai com mola (420 ms); no enviado o Eco vai ao centro (`scale 1.25`) e seis folhas do logo abrem em leque e somem em 900 ms (em volta do Eco, nunca no desenho dele). Mais vivo que o resto do app de propósito; só `transform`, `opacity` e cor, e com "Reduzir animações" nada se move e as folhas não existem.
- **"Vai junto"** sempre à vista: uma linha (`v0.1.15 · Windows 11 · log recente do app`) e "ver", que abre versão, sistema, onde a pessoa estava (em palavras, sem nomes), a chave do log e o log exato num `<pre>`. O botão Enviar fica preso ao pé do cartão; o resto rola.
- **Falha:** a frase no lugar, o botão vira "Tentar de novo", texto e print ficam. **Enviado:** "Recebido. Valeu, {primeiro nome}!", a linha do envio com a etiqueta "Recebido", fecha sozinho em 4 s se o ponteiro não estiver nele. **Seus envios:** mesma linha, mais nova primeiro.
- **Depois de um travamento** (`CrashOffer`): `role="status"` no mesmo canto, Eco `error` de 56 px, "Travei da última vez. Quer me contar o que aconteceu?", Contar / Agora não. Uma vez por travamento, só em momento calmo (`isQuiet` das Novidades), nunca junto das boas-vindas.

### Links algameet:// (`features/app/deepLinks.ts`)

`window.alga.deepLinks` no boot do `App` (com ou sem sessão; sem a ponte, nada acontece): primeiro `onLink`, depois `takePending()` uma vez. Token e código são segredos: só vão para a API, nunca aparecem na tela nem no log.
- **verify-email:** confirma direto (`POST /auth/verify-email`, não precisa de sessão) e diz o resultado num toast ("E-mail confirmado. Tudo liberado.", "Entre para continuar." sem sessão, ou o erro com o caminho para pedir outro). A faixa "Confirme seu e-mail" some sozinha (`ME_UPDATE`).
- **password-reset:** sem sessão, a tela de nova senha abre com o token em uso e **sem o campo do código** ("Link do e-mail aberto. Agora é só escolher a senha nova."); se o servidor recusar, o campo volta com o erro. Com sessão, um toast explica que trocar a senha encerra todas as sessões e oferece "Sair e trocar".
- **invite:** com sessão, abre a prévia de "Entrar em um espaço". Sem sessão, o link espera: login e cadastro dizem "Você abriu um convite. Entre ou crie sua conta e ele abre em seguida." e a prévia abre quando o shell existe.

### Assinatura (`features/billing/Plan.tsx`, `store.ts`)

Configurações › Usuário › **Assinatura**. O Grátis é bom de verdade e a tela o trata assim: nada de modal, contador, selo piscando ou "oferta por tempo limitado".
- **Aviso do provedor** no topo quando `catalog.provider.sandbox` ("SANDBOX" em âmbar + "a página de pagamento é simulada e nada é cobrado") ou quando pagamentos estão desligados (`provider: null`: botões desabilitados, "seu plano e seus itens continuam valendo"). Linhas sandbox do histórico levam o chip "TESTE".
- **Seu plano:** cartão `--bg-raised` raio 12. Grátis: "Sem prazo e sem cartão…". Plus: "Mensal · renova em 1 de dez. de 2026 · R$ 14,90" + "Cancelar renovação" (ghost) e uma luz índigo vinda de cima com filete índigo a 16 % e topo aceso (estado, não enfeite). Renovação cancelada: até quando vale e que nada comprado se perde. `past_due` em âmbar.
- **Grátis e Alga Plus:** tabela de 3 colunas montada do catálogo (`plans`, presets, teto de anexo, coleção Plus), "· seu plano" no cabeçalho da coluna atual, voz "Igual para todos" nas duas. O "+" das qualidades extras é o único acento.
- **Assinar:** Mensal/Anual (segmented), preço 24/32 `tnum`, "Equivale a R$ 12,42 por mês" no anual, botão primário grande e "O pagamento abre no seu navegador". **Antes do clique**, no mesmo cartão: renova sozinho, cancele quando quiser, "Você pode pedir reembolso em até 7 dias".
- **Checkout:** `POST /billing/checkout` → `openExternal(url)` → **"Aguardando a confirmação do pagamento…"** (spinner com texto, "Abrir a página de novo", "Não vou pagar agora"). O app **nunca** marca nada como pago: só o `ENTITLEMENTS_UPDATE` (webhook verificado no servidor) muda o estado. Recusado ou abandonado aparece ao voltar para a janela (foco → `GET /billing/me`): "O pagamento não foi concluído. Nada foi cobrado."
- **Momento de confirmação:** quando o `ENTITLEMENTS_UPDATE` traz o SKU esperado com a página aberta, uma faixa de luz índigo suave atravessa o cartão uma vez (1,1 s, out-quart, só `transform`) e a linha vira "Pagamento confirmado. Obrigado por apoiar o Alga Meet." em `--success`; "Cancelar renovação" fica escondido nesse momento. Com movimento reduzido a faixa não roda (o último quadro fica fora do cartão) e a linha fica. Página fechada: um toast com "Ver".
- **Cancelar renovação:** modal honesto ("Nada muda até 1 de dez.… Depois, sua conta volta ao Grátis (transmissão até 1080p30, anexos até 25 MB). O que você comprou na loja continua na sua conta."), foco em "Manter o Plus", confirmação em `danger`.
- **Retomar renovação:** com a renovação cancelada e o período ainda pago, o cartão diz até quando vale e, antes do clique, "Se retomar, ele renova em 1 de dez. de 2026 por R$ 14,90"; o botão secundário "Retomar renovação" (`POST /billing/subscription/resume`) volta a linha para "Mensal · renova em…" e devolve "Cancelar renovação". Sem modal: nada é cobrado na hora e o preço já está escrito.
- **Histórico de compras:** assinaturas e pedidos juntos, do mais novo; disco de 28 px (✓ em `--success` para pago/ativa, relógio para pendente, traço para o resto), nome, data · estado por tipo (pedido recusado = "Pagamento não concluído"), valor `tnum` à direita.
- **Voz e vídeo › Qualidade da transmissão:** um chip de 26 px por preset de `STREAM_PRESETS`: ✓ preenchido para os de `Me.plan.streamPresets`, cadeado com contorno para os outros; uma linha ("1080p60, 1440p60 e 4K vêm com o Alga Plus. O resto, incluindo 1080p30, é grátis.") e "Ver planos" em ghost. Quem limita é o seletor de tela (voz); aqui é informação.

### Personalização e cosméticos (`features/billing/Shop.tsx`, `Cosmetics.tsx`, `look.ts`)

- **Loja:** a exceção ao quadro de 1040: até 1240 px, crescendo para a direita (a navegação não pula). Prateleiras por tipo à esquerda em `repeat(auto-fill, minmax(152px, 1fr))` (amostra de 96 px em `--bg-raised` com avatar de 56, nome, preço ou estado) e **prévia fixa** à direita (`sticky`, 320 px): o seu cartão de perfil (avatar 80) com o item escolhido sobre o que você já usa e, para decoração e placa, também a linha da lista (32) e o palco (96); temas e efeitos dizem que só aparecem no cartão. Placa = só gradiente, raio 6, padding 2 8, sem contorno. Em 40 px ou menos as decorações usam geometria simplificada (kelp com 3 folhas largas, coral com galhos grossos e pólipos grandes, sem brilho); embaixo tipo, nome, descrição e a ação. Seleção do tile é neutra (`--state-selected` + borda forte), nunca acento. Estados: preço, "Em uso", "Na sua conta", "Coleção Plus" (leva ao plano), "Alga Plus" (incluído no seu).
- **Texto de posse** segue os termos (licença ligada à conta, não propriedade): "Comprou uma vez, fica na sua conta, sem renovação". Nunca "para sempre". Antes de comprar: "Pagamento único, sem renovação: fica na sua conta. Você pode pedir reembolso em até 7 dias."
- **Equipar é do servidor** (`PUT /users/@me/cosmetics`, um item por lugar de `COSMETIC_SLOTS`): no detalhe da loja, "Usar no perfil" (primário) para o que está na sua conta ou vem com o Plus, "Tirar do perfil" (secundário) para o que está em uso; se outro item ocupa o lugar, a linha diz "Usar troca Coral no seu perfil". O chip do tile vira "Em uso" e a prévia já mostra. Logo depois de uma compra confirmada, a linha de confirmação vem com "Usar no perfil" ao lado (nada é equipado sozinho). Erro no lugar (10/min, item que saiu da conta).
- **O dos outros também aparece, ao vivo:** `useLook(id)` lê `PublicUser.cosmetics` do store (`lookOf`, testado: SKU desconhecido ou no lugar errado é ignorado), que `USER_UPDATE`/`ME_UPDATE` atualizam. Lista de membros (decoração e placa, discretas, movimento só no hover), popover de perfil (o cartão completo) e, no palco, só a decoração no avatar do tile (nunca na faixa de 40 px, nunca com movimento: o brilho da voz manda). A lista de membros usa o perfil de `users` (o `Member.user` não recebe `USER_UPDATE`). Autores no chat ainda não (o chat está com o agente de desempenho).
- **Renderizadores (CSS/SVG, sem imagem),** cada um com a própria paleta, sempre contida:
  - *Folha de alga:* cinco folhas de kelp em gradiente verde-mar com nervura clara, abraçando o lado esquerdo e o topo do avatar, pontas soltas; fio fino de anel.
  - *Coral:* recife de coral-chifre (galhos com pontas de pólipo claras) crescendo de uma base curva no canto inferior esquerdo, brilho estático de 2 px. Na Direção B os tons ficaram empoeirados (`#b5776d`, `#cf968c`, pontas `#e9c3ba`); a folha de alga virou sálvia (`#2f5a50 → #56877b → #abcdbf`).
  - Decorações ocupam 140 % do avatar e **nunca** o quadrante inferior direito (ponto de presença).
  - *Noite paulistana:* céu índigo, névoas magenta e âmbar baixas, prédios com janelas de luz de sódio; o cartão inteiro ganha tinta índigo.
  - *Maré (Plus):* mar noturno índigo (`#2e3175 → #1d1f4c → #111229`, luz `rgba(162,168,252,.22)`) com duas linhas de onda lavanda a 10–16 %.
  - *Bioluminescência* (nome do SKU mantido): 16 pontos de luz índigo-pálido (`#dcdeff`, halo índigo a 50 %) sobem ao abrir o perfil e assentam a 55 %.
  - *Cardume:* placa azul-marinho com quatro peixinhos na cauda da placa, nunca sobre o nome.
  - *Correnteza (Plus):* placa índigo (24 % → 6 %) com uma faixa de luz lavanda que cruza uma vez. O *Cardume* virou azul-índigo com peixes `rgba(214,218,255,.55)`.
- **Movimento:** só ao abrir o perfil (uma vez) ou enquanto a linha da lista está sob o mouse (`data-cosmetic-hover`); só `transform`/`opacity`; nada contínuo, nada no chat. O último quadro de cada animação é o repouso, então o movimento reduzido (que colapsa as animações) mostra o item completo e parado.

### Palco de chamada (`features/voice/CallStage.tsx`)

- **Quem está:** a ocupação vem do servidor (`voiceStates`); nível, mudo e transmissões vêm do motor de mídia quando você está conectado. Ordem = ordem de entrada.
- **Só voz = palco nu (onda 9, crítica r3 #1).** Sem câmera e sem transmissão, ninguém ganha caixa: os rostos ficam direto sobre `--bg-content`. Avatar de **112 px** (128 num palco grande com até 3 pessoas, 88 num palco baixo ou acima de 8 pessoas, 64 onde os maiores não cabem); gap 48 (40 abaixo de 112). Até 4 pessoas ficam lado a lado; mais que isso, linhas equilibradas de ≈ √(1,5 n) (5 = 3+2, 7 = 4+3, 9 = 3·3·3, 12 = 4·4·4), sempre centralizadas, com o centro óptico a 45 % da altura (`voiceLayout`, testado de 1 a 12). Embaixo do rosto, a 8 px, o **chip do nome** 14/510 (22 px, fundo `oklch(.29 .028 H / .55)` no matiz da pessoa, `--text-secondary` que vira primário enquanto ela fala). Sob o rosto, o **chão** no matiz dela a 6 % (11 % falando). **Mudo e ensurdecido:** disco de 22 px em `--bg-overlay` com o glifo de 14 px em `--danger`, a 45° no canto inferior direito do rosto; o volume da pessoa (⋯) aparece a 45° no canto superior direito, no hover. Qualidade ruim/sem sinal: ícone de 12 px dentro do chip.
- **Caixas só para imagem.** Quem transmite (e ninguém assiste em grande) vira um **cartão ao vivo** 16:9 (até 520 px, ≈ metade do palco), acima dos rostos: o dela tem o rosto de 64 sobre uma lavagem do matiz dela, AO VIVO e **Assistir**; o seu mostra a prévia do que sai do seu computador (`attachOwnScreen`), com "Você está transmitindo · 1280×720 · 30 fps · por hardware", **Trocar fonte** e **Parar transmissão** numa faixa escura embaixo. Uma pessoa, um lugar: quem transmite não aparece também como rosto.
- **Menu do tile (botão direito):** o mesmo menu de pessoa da lista de membros (`personEntries`): Mensagem, Ligar; "Para você" (silenciar só para mim, volume 0–200 % no botão ⋯ do tile); "Moderação" com permissão (`voiceModEntries`: silenciar/ensurdecer para todos, mover, desconectar; "Gerenciar em Membros"); amizade conforme o estado; Copiar nome de usuário; Denunciar (vermelho, por último).
- **Nada é baixado antes de Assistir.** Na faixa, o selo AO VIVO é o próprio botão.
- **Assistir toma o palco**, com qualquer número de pessoas: a transmissão vira o maior 16:9 que cabe acima de uma faixa de pessoas (`featuredWidth`: `min(largura, (altura − faixa − 8) × 16/9)` dentro da área, que já desconta o padding e o dock). A faixa tem as outras transmissões em 160×90 (120×68 num palco baixo) e as pessoas como rostos nus de 40 px com o nome em 11 px, sem caixa. Outras transmissões que você assiste ficam na faixa (clique = trocar qual está no palco, `focus`). Vídeo `contain` em preto, barra no hover (volume da live se houver áudio, Automática/Original, estatísticas, janela flutuante via `requestPictureInPicture`, tela cheia no contêiner via `requestFullscreen`, parar de assistir). Duplo clique = tela cheia. Estatísticas (Ctrl Shift E): resolução, fps, taxa, codec, decodificador e HW/SW, perda, congelamentos, em pt-BR (`4,1 Mb/s`, `0,0 %`). Sair do palco mantém só uma transmissão (no mini-player) e para as outras.
- **Mini-player** (montado no `Shell`, não mais dentro do cartão de chamada recebida): saiu do palco da sua chamada (outro canal, DM, Home) com uma transmissão assistida: ela continua num quadro de 320×180 (raio 12, `--elev-overlay`, `--z-call-overlay`) no canto inferior direito, acima do compositor. Arrastar move 1:1; ao soltar, encaixa no canto mais próximo (220 ms out-quart; sem animação com movimento reduzido). No hover: **Voltar para a chamada** e **Parar de assistir**; duplo clique volta. Pílula "AO VIVO · apelido" no canto inferior esquerdo. É a mesma inscrição (nada novo é baixado); sair do palco mantém só a transmissão em foco (ou a primeira) e para as outras.
- **Sua transmissão, no seu tile:** "Você está transmitindo", a melhor camada realmente enviada (resolução · fps · taxa · HW/SW), "Trocar fonte" e "Parar transmissão" (`Button secondary sm` com o ícone `Square`: parar não destrói nada, o vermelho é do Desconectar). Se o plano muda no meio, a frase do motor ("Seu plano não inclui 1080p 60 fps: a transmissão continua, em 720p 60 fps.") aparece **no tile**, 12/510 em `--warning`, por 8 s, e nada para; fora do palco ela continua um toast (`routeStreamNotice`). Com o palco à vista, o estado "ao vivo" fica em dois lugares só: o botão Tela preenchido no dock e o seu tile. O chip "Você está transmitindo · Parar" da title bar aparece fora do palco (outro canal, Home) ou com as configurações por cima dele.
- **Estados honestos:** conectando = "Conectando…" sob os rostos; reconectando = tiles em cinza a 40 %, `--speak` forçado a 0 e um chip de 32 px no topo do palco ("Reconectando à voz…" em âmbar + "Você não está ouvindo ninguém agora."), sem cobrir ninguém; desconectado = cartão com o motivo do motor + "Entrar de novo". O dock continua lá para você sair.
- **Header do palco:** o nome e o tema do canal e, à direita, o estado da criptografia (ver *Criptografia de ponta a ponta*). O status da conexão mora num lugar só, o painel "Voz conectada", e a contagem só na prévia.
- **Prévia (antes de entrar):** quem está na sala (rostos de 64 com o chão no matiz de cada um), contagem e um botão primário "Entrar em <canal>". Vazio: uma cadeira vazia (círculo de 88 com filete), "Ninguém aqui ainda / Entre e chame alguém. Quem chegar já te ouve."

### Criptografia de ponta a ponta (`features/voice/E2ee.tsx`, fase 1b)

O motor faz a criptografia e falha fechado sozinho; a UI só diz o que é verdade (`useMedia.e2ee`, decisão 0004 §3.8–3.9).

- **O cadeado é um fato, não um selo:** nunca índigo. Ativa → `Lock` + "Criptografia de ponta a ponta" (12/510 `--text-secondary`, glifo terciário) no header do palco ou no topo do palco de DM, e um cadeado de 12 px ao lado de "Voz conectada". Clicar abre a verificação. Entrando no grupo → "Protegendo a chamada…" com spinner. Desligada → só numa sala de espaço, quieta: `LockOpen` + "Sem criptografia de ponta a ponta" em terciário, com o porquê no tooltip. Falhou → o motor encerra a chamada; o cartão do palco diz "Não foi possível proteger a chamada" e o motivo.
- **Verificar a criptografia** (modal de 480): a instrução primeiro ("Leiam o código em voz alta…"), o **código da chamada** (30 dígitos em 6 grupos de 5, mono 19 px, `user-select: all`, "Época N"), "Igual para todos. Muda sempre que alguém entra ou sai."; **Por pessoa**: cada membro do grupo MLS com "Ver código" (45 dígitos, 9 × 5, KDF lenta no main, pedida só ao abrir); aviso âmbar se a identidade do aparelho não é persistente; e, embaixo, o que a E2EE cobre e o que não cobre.
- **Faixa vermelha** (`e2ee.mismatch` não vazio, depois de 2 s): a única coisa alta do palco, sob o header: "Há alguém na chamada que não conseguimos verificar: <nomes>." + o que isso significa + "Ver detalhes" e **Sair da chamada** (`danger`). O chip do header e o cadeado do painel viram escudo vermelho.
- **DM é sempre E2EE neste cliente**, diga o servidor o que disser (`directCall.ts`, testado): uma oferta sem E2EE para DM ou grupo é recusada **antes** de conectar (também nas reentradas automáticas do motor, via `refresh`), e uma chamada direta que entra em "conectado" sem E2EE é deixada na hora. O modal "Chamada sem criptografia recusada" explica que nada foi enviado. (A checagem é só na entrada em "conectado": o `leave()` do motor zera a E2EE antes de a conexão sair de "conectado".)

### Ir para (Ctrl K) (`features/switcher`)

- **Nasce da busca da title bar (onda 9):** o painel ocupa o lugar do campo (`data-switcher-anchor`) e cresce de 420 para 600 px em 180 ms out-quart (raio 6 → 16), a lista chega 70 ms depois; ao fechar, volta para dentro do campo. Enquanto está aberto, o campo da title bar some (é o mesmo objeto). Sem o campo (chip de conexão no lugar), abre centrado como antes.
- **Trecho que casou** em 590 `--text-primary`; o resto em `--text-secondary`. A linha secundária e as palavras-chave só contam como palavra digitada inteira.
- **Executa ações:** Entrar em <sala>, Silenciar/Ativar microfone, Desativar/Ativar áudio, Compartilhar tela/Parar transmissão, Sair da chamada, Ligar para <amigo>, Abrir configurações (`Ctrl ,`), Configurações de voz e vídeo, com o atalho global da pessoa em `Kbd` quando existe. Numa chamada, as ações da chamada abrem a lista; fora dela, aparecem ao digitar ou com `>`.

### Login (`features/auth`)

Sem cartão (crítica r3 #8): uma coluna de 340 px com o centro perto de 42 % da janela, a marca a 40 px, título 28/590 em `opsz` 32 com −0,02em, subtítulo 14 terciário, e uma luz índigo única no topo (`radial-gradient(900px 520px at 50% -12%, rgba(139,142,247,.12), transparent 70%)`). Erro do formulário = linha 12/510 em `--danger` sob os campos, sem caixa; Caps Lock dentro do campo. Os portões de termos e de conta restrita usam a mesma coluna.

### Dock de controles

Flutuante, centralizado, 16 px do fundo, sobe 12 px ao entrar (coreografia), `--bg-overlay` + `--elev-overlay`, raio cheio, padding 6, botões de 40 px com gap 8 e separadores de 1 px: **Microfone** (anel interno segue o seu próprio envelope: você vê que está sendo ouvido) · **Fone** | **Tela** (desligado: abre o seletor; ao vivo: preenchido em acento, menu com "Trocar fonte" e "Parar transmissão", sem vermelho) · **Configurações de voz** | **Desconectar** (56 px, `--danger` cheio). Desligado = ícone riscado + `--danger` + tinta vermelha; nunca só cor. Silenciado pela moderação: o botão fica `aria-disabled` e o tooltip diz por quê.

### Seletor de tela

Modal de 836 px em duas colunas. À esquerda (464 px): abas Telas / Janelas e a prévia grande da fonte escolhida (464×261, raio 8), com miniaturas ao vivo atualizadas em cadeia a cada 1,5 s, sem empilhar pedidos. Com uma fonte só não há grade: a prévia é a escolha. Com várias, grade de 3 colunas (≈148×83, 16:9) acima da prévia; passou de duas linhas, a terceira aparece pela metade e a grade rola. A principal vem pré-selecionada; trocar de aba escolhe a primeira fonte dela (transmitindo uma janela, o seletor abre em Janelas). À direita (300 px): **Qualidade** em dois controles segmentados, resolução e quadros por segundo, tirados de `screen.offered` + `screen.locked` (`qualityAxes`, testado). Trocar a resolução mantém o fps quando dá; senão vai para o par oferecido mais próximo. Um fps que não existe naquela resolução não aparece (1440p só 60, 4K só 30). Depois vêm **O que você vai mostrar** (Jogo ou vídeo / Texto ou código) e **Compartilhar áudio** (em janela, avisa que vai o áudio do sistema inteiro). O texto de consentimento fica no topo: só o escolhido é transmitido, só para quem clicar em Assistir.
- **Fora do plano:** o segmento continua visível, em `--text-disabled`, `aria-disabled`, com cadeado de 12 px, lido como "1440p, Alga Plus" e pulado pelas setas. Embaixo, uma linha só: "1080p 60 fps vem com o Alga Plus. **Ver o Alga Plus**" (link em acento que fecha o seletor e abre Configurações › Assinatura). Nada de modal, selo ou contador, e nunca um preset que o hardware não aguentaria.
- **Com transmissão ativa:** o mesmo seletor troca a fonte e/ou a qualidade sem derrubar quem assiste ("Trocar fonte" / "Aplicar"; dica: "Muda na hora, sem interromper quem assiste."). Assinou o Plus no meio: o par liberado fica selecionável ali mesmo.

### Presença de voz no cromo

- **Agora (Home):** salas com gente agora em todos os seus espaços e chamadas de DM; sua sala primeiro, depois as com mais amigos. Linha de 44 px: pilha de até 3 avatares de 20 px (com o anel de fala real se for a sua sala), nome, onde ("Estúdio Alga" / "Chamada"), "ao vivo" se alguém transmite. Um clique entra.
- **Rail (onda 9, crítica r3 #5):** tiles de 40 px, raio 12, **sem borda**; espaço sem ícone = monograma 13/590 sobre `linear-gradient(160deg, oklch(.33 .05 H), oklch(.24 .035 H))` no matiz do espaço. Atual = `--state-current` + anel interno de 1 px `rgba(139,142,247,.35)`, **sem barra à esquerda**. Não lido = ponto de 6 px em `--text-primary` dentro do tile, no canto superior esquerdo. Voz = o ponto de 6 px no canto inferior direito, com anel da cor do rail; menção = badge de 16 px no canto superior direito. Home ganha o ponto quando há chamada de DM.
- **Header do chat (voz dentro do chat):** num canal de texto, quando um canal de voz do espaço tem gente, o header mostra a pilha de avatares de 20 px (com o anel de fala real se é a sua sala) e "3 em Sala de foco" (sem ponto: os rostos já dizem), com "Entrar" (ghost sm) ou "Abrir" se você já está lá. A sala em que você está ganha; senão, a mais cheia (`VoiceHere`).
- **Lista de membros:** abre com **Em voz · N** (cada linha com o nome do canal embaixo), depois Online e Offline. Sem coroa: "Dono do espaço" é um chip no cartão de perfil. Presença efetiva: quem tem `voiceState` nunca aparece como Offline (`presenceOf`).
- **Cartão de perfil (300 px):** banner, avatar de 80, nome 17/590, @usuário em terciário, cargos em chips de 20 px com ponto de 6 na cor do cargo, a linha "Em Sala de foco" (branco 4 % com filete, o ponto de voz, "Entrar") se a pessoa está em voz, e o rodapé: **Mensagem** (primário, flex 1), Ligar (abre o DM e chama), Adicionar amigo / Aceitar / pedido enviado conforme o estado, e ⋯ com o resto (amizade, bloquear, copiar nome de usuário, Denunciar por último em vermelho). Bloqueado: só "Desbloquear". O seu: "Editar perfil". Abre pela lista de membros e pelo autor no chat.
- **Sidebar:** canal de voz ocupado ganha o alto-falante sólido e, à direita, "● 2" (o ponto de voz e a contagem em terciário); o ícone do canal atual é o glifo bold em `--text-primary` sobre `--state-current`, nunca um carimbo índigo; ocupantes em linhas de 26 px com avatar de 20 px e o mesmo anel de fala, "AO VIVO" e ícones de estado. **Um clique num canal de voz entra nele** (hábito do Discord mantido).
- **Painel "Voz conectada" (o único lugar do status):** acima da sua linha no dock: o ponto de voz (anel vivo) + estado (13/510 `--text-primary`; ponto e texto âmbar quando não conectado; o rótulo nunca trunca, `flex-shrink: 0`) + qualidade em 3 barras de 12 px à direita (a nota do SFU, senão o ping), com os números no tooltip ("34 ms · perda 0,0 %"; abaixo de 5 ms, "< 5 ms"); canal · espaço em 12 terciário; ações Tela e Desconectar.
- **Chamada de DM:** botão de telefone no header do DM (vira "Entrar na chamada" em acento quando já há alguém); o palco ocupa o topo da conversa (clamp 240–460 px) e o chat continua embaixo. Com a chamada em curso, a abertura da conversa troca "Ligar" por "Em chamada". Chamada recebida: cartão de 360 px no canto superior direito, logo abaixo do header (`--elev-overlay`, `--z-call-overlay`), sem cobrir nenhum título (avatar que respira, nome, e embaixo Recusar em `secondary-danger` / Atender com foco em Atender, Esc recusa, some em 30 s ou quando quem ligou desiste) + notificação do Windows e piscar na barra de tarefas se a janela não está em foco. **Som:** toque sintetizado na mesma voz dos outros sons (seno + triângulo uma oitava acima): mi–sol♯–si leve, duas vezes, a cada 3,2 s; para ao atender, recusar, expirar ou quando quem ligou desiste. Quem liga ouve um tom de chamada baixo (lá–dó♯ em crescendo, a cada 3 s, volume 0,07) até alguém entrar, você sair ou 30 s. Os dois obedecem "Sons de chamada".

### Configurações (`features/settings`)

Sobreposição de janela inteira abaixo da title bar (que continua: arrastar, botões nativos, chip de transmissão). Quadro centrado em telas largas: navegação 232 + conteúdo 808 = 1040 px (`minmax(232px, calc(50% - 288px))`); a Personalização usa 1240 e cresce para a direita, sem mover a navegação. Navegação à esquerda no estilo Linear, agrupada por rótulo (Usuário / Aplicativo); Esc, o ✕ ou Ctrl+, fecham e o foco volta para quem abriu. Cada controle faz algo de verdade; o que não tem backend não aparece (fixar):
- **Assinatura** e **Personalização:** ver as seções acima. **Privacidade:** ver Confiança e segurança.
- **Minha conta:** foto (recorte + upload), nome, usuário, bio (190), cor do perfil (PATCH /users/@me); e-mail e se está confirmado; trocar senha com força (POST /auth/password, encerra as outras sessões); sessões distinguíveis (app e versão · sistema, "Conectado desde … · último uso …", chip neutro "Este dispositivo") com "Encerrar" e "Sair de todas as outras sessões"; sair da conta (os dois em `secondary-danger`, o vermelho cheio só na confirmação).
- **Voz e vídeo:** qualidade de transmissão do plano (ver Assinatura), microfone e saída (`MenuButton` + `Menu`, ✓ no atual, "Padrão do sistema · <aparelho>"), teste com medidor ao vivo e "ouvir a mim mesmo", processamento (Padrão / Supressão avançada / Desligado, uma frase honesta cada; aviso se a supressão avançada não carregou), detecção de voz vs aperte para falar, sensibilidade (automática ou manual: a linha do limiar sobre o nível em dB, arrastável), atraso ao soltar o PTT, sons de chamada.
- **Atalhos:** gravar via `window.alga.hotkeys.record`, rótulo do sistema, salvos em `localStorage` (`alga.hotkeys.v1`) e reaplicados no boot.
- **Notificações:** DMs e menções, chamadas, contador na barra de tarefas. **Aparência:** Tamanho do texto 14/15/16/17 (`html[data-text-size]` → `--msg-size`/`--msg-line` → `--type-message`); densidade Confortável/Compacta (linhas de 20 px, sem respiro; "Avatares nas mensagens" desligado vira linha estilo IRC); reduzir animações. Zoom da interface depende de `webContents.setZoomFactor` no preload (pedido em aberto): CSS `zoom` desalinharia menus e popovers. **Inicialização:** abrir com o Windows, fechar para a bandeja. **Avançado:** versão, procurar atualizações (com estados), abrir pasta de registros.

## 5b. Identidade além do matiz (rodada 3)

*Histórico da rodada 3, revisto pela Direção B.* A crítica r2 (§4) mostrou que, num print do chat, o esqueleto ainda é o do Discord e que o próprio brilho de fala, no pico, vira o anel do Discord em outra cor. Escolhemos três movimentos que mudam a sensação sem mexer no esqueleto que o migrante conhece (espaços à esquerda, canais, chat, palco), mais os cantos separados do rail que a crítica pediu como correção:

1. ~~**Luz, não anel.**~~ *Substituído na Direção B:* o dono pediu calma em vez de efeito; quem fala ganha um anel índigo de 2 px que segue o envelope (§3), sem luz interna e sem a sala que respira. O envelope continua sendo a nossa assinatura. Texto original: O brilho de quem fala é luz embaixo d'água (luz interna + halo que cresce, contorno nunca acima de 70 %) e **a sala respira**: uma luz baixa no fundo do palco sobe com a voz mais alta. Por quê: é o ponto mais citado como "cópia" no palco, e o envelope de voz já é a nossa assinatura (§3); estendê-lo do tile para a sala dá ao palco um tempo próprio que nenhum concorrente tem, a custo de duas camadas de `opacity`.
2. **Voz dentro do chat.** O header de um canal de texto diz onde o espaço está falando agora ("3 em Sala de foco", rostos com o anel real, Entrar) e a lista de membros abre com "Em voz". Por quê: o chat é 80 % do tempo; "voz e presença primeiro" tem de aparecer na tela mais vista, não só no palco. Para o migrante, é informação a mais no mesmo lugar, não um lugar novo.
3. **Ritmo vertical na resposta.** A resposta é uma linha 12/510 com uma haste reta na coluna do avatar, sem o conector curvo. Por quê: é o detalhe que mais denuncia "Discord" num print do chat; a haste reta conversa com as barras da marca e mantém a função (clicar leva à original).

Também da rodada: uma marca só (as frondes, Marca v1), presente do ícone do Windows ao glifo que se move com a voz. Ficaram para depois, por custo de migração ou de implementação: a folha que nasce do espaço escolhido no lugar da pílula branca do rail e a bandeja que respira enquanto você está em voz (precisa do processo principal).

## 6. Faça / não faça

| Faça | Não faça |
|---|---|
| Use tokens (`var(--…)`) para toda cor, espaço, raio, duração | Hex solto em componente |
| Hover/pressionado/destaque de menu neutros; "você está aqui" com `--state-current` + glifo sólido | Preencher item ativo com o índigo cheio, ou tingir hover |
| Bordas brancas translúcidas | Cinza sólido como borda |
| Raio externo = interno + padding | Mesmo raio no contêiner e no filho |
| Feedback no ponto da ação | Toast para algo que já está na tela |
| Uma pessoa, um tile (o "ao vivo" é um selo no tile) | Segundo tile repetindo o avatar de quem transmite |
| Status da chamada só no painel "Voz conectada" | Repetir "Voz conectada"/ping no header |
| Vermelho cheio só em Desconectar e na confirmação | Fill vermelho em Parar transmissão, Sair da conta, Excluir em repouso |
| Cor de cargo da paleta `ROLE_COLORS` | Cargo saturado, verde de online, âmbar de aviso ou o índigo do acento |
| `IconButton` com `label` | Ícone clicável sem nome acessível |
| Badge neutro para contagem; vermelho só para @menção | Vermelho para "tem coisa nova" |
| Estado degradado visível (cinza, "Reconectando…") | Mostrar pessoas "bem" sem mídia |
| Omitir o controle que não tem backend | Switch decorativo ou rota fingida |
| `useEffect(() => { el.scrollTo(…) })` com chaves | Devolver o resultado de `scrollTo` (no Chromium 156 é uma Promise; o React a trata como cleanup e quebra) |
| Animar só troca de contexto | Animar resposta a clique/tecla |
| Textos pt-BR no `strings.ts` da feature | String solta no JSX de componente compartilhado |
| Esperar o `ENTITLEMENTS_UPDATE` para mostrar algo como pago | Marcar como pago ao abrir o checkout ou ao voltar do navegador |
| Renovação e reembolso em 7 dias ditos antes do clique | Letra miúda depois do pagamento, "para sempre", contagem regressiva |
| **Direção B:** índigo em poucos lugares (atual, primário, foco, voz, menção) | Índigo em fundo de área, título, borda decorativa ou ícone de enfeite |
| **Direção B:** ícones pelo `ui/Icon` (Phosphor via `ui/icons.tsx`), sólido só para atual/ligado | Importar `@phosphor-icons/react` (ou outro pacote) direto numa feature; ícone sólido decorativo |
| **Direção B:** anel de fala de 2 px que segue o envelope | Brilho, halo largo, `drop-shadow` colorido, luz ambiente, neon |
| **Direção B:** gradiente só no primário (brilho de topo), no cartão de upgrade e na marca | Gradiente em fundo de tela, em texto ou em cartão comum |
| **Direção B:** vidro (`--bg-glass`) só em menu, popover, toast e barra de ações | Blur em tela cheia ou sobre vídeo/compartilhamento |
| **Direção B:** texto branco sobre preenchimento índigo, vermelho ou rosa (≥ 4,5:1, `tokens.test.ts`) | Texto escuro sobre o acento (era a regra do teal) ou cor nova sem par no teste |
| Cosmético que se move uma vez, ao abrir, com repouso = movimento reduzido | Animação contínua em lista, no chat ou fora da tela |

## 6b. Acessibilidade: teclado, leitor de tela, alto contraste

Verificado no app real por `apps/desktop/scripts/a11y-audit.mjs` (regras no DOM + jornadas só de teclado + forced colors + movimento reduzido). Relatório e pendências: `docs/accessibility/2026-11-01-audit.md`.

- **Todo controle tem nome.** `IconButton` sempre com `label`; ícone é `aria-hidden`. `aria-label` só vale em elemento com papel: num `div`/`span` sem `role` o leitor ignora (a lista de membros é `role="complementary"` "Membros").
- **Sem `tabindex` positivo.** A ordem de Tab é a do DOM.
- **Foco visível.** Anel `:focus-visible` de 2 px em `--accent` (índigo), offset 2 px. Campos mostram o foco na caixa (borda índigo + halo de 3 px). Quem tira o outline (input dentro de uma caixa) mostra o foco na caixa (`:focus-within`). Em alto contraste o outline volta em `Highlight`. Exceção aceita: a busca do "Ir para" (único controle do diálogo, sempre focada; o cursor é o indicador).
- **Lista = uma parada de Tab + setas.** Rail e lista de canais/conversas: ↑ ↓ Home End movem (`arrowFocus` + `data-arrow-nav`, `ui/floating.ts`); um gatilho de menu dentro dessas listas abre com Enter/Espaço e ↓ continua andando. Histórico: uma parada (a mensagem itinerante), ↑ ↓ PageUp PageDown Home End andam entre mensagens, Tab percorre os controles da mensagem focada e depois sai da lista. Rádios (fontes do seletor de tela, segmented, abas): uma parada, setas escolhem.
- **Menu de contexto pelo teclado.** Shift+F10 e a tecla Menu abrem o mesmo menu do clique direito (também numa mensagem focada), com o 1º item ativo. Todo menu tem nome (`label`, senão o `aria-label` do gatilho). Painel flutuante só recebe foco depois de posicionado: com `visibility: hidden` o `focus()` falha em silêncio (era o caso de `Menu` e `Popover`).
- **Diálogo:** `role="dialog"` + `aria-modal="true"` + nome; Esc fecha só o de cima; o foco volta ao gatilho. Gatilho que muda de estado durante o diálogo continua sendo o mesmo elemento (Compartilhar tela → Parar transmissão: `MenuButton off`). Popover fechado por uma escolha (emoji, status) devolve o foco ao gatilho.
- **O foco nunca cai no `<body>`.** Edição inline encerrada → composer. Sair da chamada → composer ou canal atual (ou o botão Entrar do palco). Escolher um canal (Enter ou clique) → composer, mesmo se ele já está aberto.
- **Região viva existe antes do texto.** Uma `role="status"` criada já com o texto costuma não ser lida (NVDA/Narrador). Toasts: região `aria-live="polite"` permanente, erro = `role="alert"`; "digitando" e "nova mensagem" idem; quem entra e sai da chamada em que você está: `VoiceAnnouncer` (uma `role="status"` fixa no shell). O histórico (`role="log"`) fica `aria-live="off"`: linhas montam ao rolar.
- **Toast pausa no hover e no foco** (WCAG 2.2.1).
- **Contraste** sobre o fundo composto real: texto ≥ 4,5:1, ≥ 3:1 a partir de 24 px (ou 18,66 px em negrito). `--text-disabled` só em desabilitado. Placeholder global = `--text-tertiary` (o cinza padrão do Chromium dá 2,9:1 no overlay).
- **Movimento reduzido** (SO ou "Reduzir animações"): `--speak` só 0/1 (o anel de quem fala aparece e some, sem animar), nenhuma animação em execução (`document.getAnimations()`).
- **Alto contraste (`forced-colors`).** Fundos viram Canvas e sombras somem, então estado desenhado como tinta ou anel ganha cor de sistema (`base.css`): página atual, selecionado, pressionado, rádio escolhido e item ativo de menu = `Highlight`/`HighlightText` com `!important` (sem ele a regra do componente, mais específica, devolve a tinta quase branca sobre Canvas); switch ganha borda e trilho; menus, diálogos, tooltips e toasts ganham borda `CanvasText`; tile ganha borda e a fala vira contorno `Highlight` com opacidade `--speak`. Cor nova de estado = conferir no passe forced do script.

## 7. Telas (versões mais recentes)

### Onda 9 · v3 (2026-11-01)

App real, API e LiveKit próprios (portas 4610/7990), perfis `shots`, `shots-b` e `shots-c`, pessoas extras (até 12 numa sala) como participantes LiveKit num Chromium headless com tokens reais do `/voice/join`. Conteúdo de demonstração gerado (`demoMedia`, `sceneHtml` em `scripts/screenshot.mjs`): avatares abstratos na paleta, sem fotos nem rostos; a tela compartilhada é um editor procedural (o próprio `layout.ts`) em tela cheia por cima enquanto é capturada. Crítica: [critique-2026-11-01-r4.md](critique-2026-11-01-r4.md).

| Tela | Screenshot | Antes / lado a lado |
|---|---|---|
| Palco, 1 pessoa | [voice-stage-1-v3](../screenshots/2026-11-01-voice-stage-1-v3-v8.png) | |
| Palco, 2 pessoas: Bruno falando, a luz da sala no matiz dele | [voice-stage-2-v3](../screenshots/2026-11-01-voice-stage-2-v3-v8.png) | [antes × depois](compare/2026-11-01-voice-stage-v3.png) |
| Palco, 3 · 5 · 8 · 12 pessoas | [3](../screenshots/2026-11-01-voice-stage-3-v3-v3.png) · [5](../screenshots/2026-11-01-voice-stage-5-v3-v3.png) · [8](../screenshots/2026-11-01-voice-stage-8-v3-v3.png) · [12](../screenshots/2026-11-01-voice-stage-12-v3-v3.png) | |
| Palco, 12 em 1920×1080 · 5 em 960×600 | [1920](../screenshots/2026-11-01-voice-stage-12-1920x1080-v3-v3.png) · [960](../screenshots/2026-11-01-voice-stage-5-960x600-v3-v3.png) | |
| Coreografia de entrada (quadro do meio) | [voice-join-choreography-v3](../screenshots/2026-11-01-voice-join-choreography-v3-v3.png) | |
| Mudo: disco a 45° com o traço desenhado | [voice-self-muted-v3](../screenshots/2026-11-01-voice-self-muted-v3-v8.png) | |
| Cartão ao vivo (de outra pessoa) · o seu, com a prévia | [unwatched](../screenshots/2026-11-01-stream-card-unwatched-v3-v3.png) · [self](../screenshots/2026-11-01-screen-sharing-self-v3-v3.png) | |
| Assistindo: o editor procedural toma o palco, rostos nus na faixa | [stream-watching-v3](../screenshots/2026-11-01-stream-watching-v3-v3.png) | [antes × depois](compare/2026-11-01-stream-watching-v3.png) |
| Seletor de tela (miniatura = a cena gerada) | [screen-picker-v3](../screenshots/2026-11-01-screen-picker-v3-v3.png) | |
| E2EE: chamada de DM com o cadeado · sala com E2EE | [dm-call-e2ee](../screenshots/2026-11-01-dm-call-e2ee-v3-v4.png) · [voice-stage-e2ee](../screenshots/2026-11-01-voice-stage-e2ee-v3-v2.png) | |
| E2EE: verificar (código da chamada + por pessoa) | [e2ee-verify-sheet-v3](../screenshots/2026-11-01-e2ee-verify-sheet-v3-v4.png) | |
| E2EE: faixa vermelha (alguém sem chaves na sala) | [e2ee-mismatch-v3](../screenshots/2026-11-01-e2ee-mismatch-v3-v2.png) | |
| E2EE: DM oferecida sem criptografia, recusada | [dm-call-unsafe-refused-v3](../screenshots/2026-11-01-dm-call-unsafe-refused-v3-v2.png) | |
| Ctrl K crescendo da title bar (quadro do meio) · aberto · busca com ações · numa chamada | [grow](../screenshots/2026-11-01-switcher-grow-v3-v2.png) · [open](../screenshots/2026-11-01-switcher-open-v3-v2.png) · [query](../screenshots/2026-11-01-switcher-query-actions-v3-v2.png) · [in call](../screenshots/2026-11-01-switcher-in-call-v3-v8.png) | [antes × depois](compare/2026-11-01-switcher-v3.png) |
| Chat: ponto de voz só no rail e no canal, sem coroa, menção sem barra | [chat-channel-v3](../screenshots/2026-11-01-chat-channel-v3-v2.png) | [antes × depois](compare/2026-11-01-chat-channel-v3.png) · [× Linear](compare/2026-11-01-chat-channel-v3-linear.png) |
| Home "Agora" | [home-agora-v3](../screenshots/2026-11-01-home-agora-v3-v2.png) | |
| Cartão de perfil: banner na cor da pessoa · chip "Dono do espaço" | [person hue](../screenshots/2026-11-01-profile-person-hue-v3-v2.png) · [owner](../screenshots/2026-11-01-profile-owner-chip-v3-v2.png) | |
| Login · erro com Caps Lock no campo · 1920×1080 | [login](../screenshots/2026-11-01-auth-login-v3-v2.png) · [erro](../screenshots/2026-11-01-auth-login-error-v3-v2.png) · [1920](../screenshots/2026-11-01-auth-login-1920x1080-v3-v2.png) | [antes × depois](compare/2026-11-01-auth-login-v3.png) |

Como reproduzir: uma API e um LiveKit seus em portas livres (dados num diretório temporário; o LiveKit com `port_range` próprio), depois `ALGA_API_URL=… LIVEKIT_HTTP=… ALGA_OUTBOX_DIR=<dir>/outbox ALGA_SHOTS_OUT=<repo>/node_modules/.alga-shots-v3 ALGA_SHOTS_TAG=v3 V3_STACK=<seu script start/stop-api> node scripts/screenshot.mjs --only=v3` (`V3_PARTS=auth,chat,switcher,stage,crowd,stream,e2ee,unsafe` para uma parte). O build tem de ficar dois níveis abaixo do repositório (`node_modules/.alga-*`) para o main achar `native/mls/pkg`. Durante a parte `stream`, a cena cobre a tela principal por cerca de 20 s.

### Direção B · Índigo suave (2026-11-01)

Capturas do app real (API e LiveKit próprios, perfis `shots*`), com a comparação lado a lado com a captura mais próxima da Linear quando há uma. Evidência das decisões: [ícones Lucide × Phosphor](compare/2026-11-01-icons-lucide-vs-phosphor.png), [marca v2 (todos os tamanhos)](compare/2026-11-01-brand-v2-preview.png).

| Tela | Screenshot | Lado a lado com a Linear |
|---|---|---|
| Shell + chat: L invertido, item atual índigo com glifo sólido, nomes de cargo quase brancos | [2026-11-01-chat-channel-v2-indigo-v4.png](../screenshots/2026-11-01-chat-channel-v2-indigo-v4.png) | [2026-11-01-chat-channel.png](compare/2026-11-01-chat-channel.png) |
| Home: "Agora", Amigos com abas em pílula | [2026-11-01-home-agora-v2-indigo-v2.png](../screenshots/2026-11-01-home-agora-v2-indigo-v2.png) | [2026-11-01-home-agora.png](compare/2026-11-01-home-agora.png) |
| Menu de contexto de vidro, grupos por rótulo | [2026-11-01-chat-context-menu-v2-indigo-v2.png](../screenshots/2026-11-01-chat-context-menu-v2-indigo-v2.png) | [2026-11-01-chat-context-menu.png](compare/2026-11-01-chat-context-menu.png) |
| Menu de membro | [2026-11-01-member-menu-v2-indigo-v2.png](../screenshots/2026-11-01-member-menu-v2-indigo-v2.png) | [2026-11-01-member-menu.png](compare/2026-11-01-member-menu.png) |
| Status do usuário (popover) | [2026-11-01-user-status-v2-indigo-v1.png](../screenshots/2026-11-01-user-status-v2-indigo-v1.png) | [2026-11-01-user-status.png](compare/2026-11-01-user-status.png) |
| Ir para (Ctrl K) | [2026-11-01-switcher-query-v2-indigo-v2.png](../screenshots/2026-11-01-switcher-query-v2-indigo-v2.png) | [2026-11-01-switcher-query.png](compare/2026-11-01-switcher-query.png) |
| Cartão de perfil | [2026-11-01-profile-popover-others-v2-indigo-v3.png](../screenshots/2026-11-01-profile-popover-others-v2-indigo-v3.png) | [2026-11-01-profile-popover-others.png](compare/2026-11-01-profile-popover-others.png) |
| Palco: Bruno falando, anel índigo de 2 px que segue a voz | [2026-11-01-voice-stage-v2-indigo-v3.png](../screenshots/2026-11-01-voice-stage-v2-indigo-v3.png) | [2026-11-01-voice-stage.png](compare/2026-11-01-voice-stage.png) |
| Palco: você falando (anel no próprio microfone) | [2026-11-01-voice-stage-self-speaking-v2-indigo-v3.png](../screenshots/2026-11-01-voice-stage-self-speaking-v2-indigo-v3.png) | [2026-11-01-voice-stage-self-speaking.png](compare/2026-11-01-voice-stage-self-speaking.png) |
| Seletor de tela | [2026-11-01-screen-picker-v2-indigo-v2.png](../screenshots/2026-11-01-screen-picker-v2-indigo-v2.png) | [2026-11-01-screen-picker.png](compare/2026-11-01-screen-picker.png) |
| Transmissão assistida, selo AO VIVO rosa | [2026-11-01-stream-watching-v2-indigo-v2.png](../screenshots/2026-11-01-stream-watching-v2-indigo-v2.png) | [2026-11-01-stream-watching.png](compare/2026-11-01-stream-watching.png) |
| Configurações › Aparência (linhas em cartão) | [2026-11-01-settings-appearance-v2-indigo-v2.png](../screenshots/2026-11-01-settings-appearance-v2-indigo-v2.png) | [2026-11-01-settings-appearance.png](compare/2026-11-01-settings-appearance.png) |
| Configurações › Voz e vídeo | [2026-11-01-settings-voice-devices-v2-indigo-v2.png](../screenshots/2026-11-01-settings-voice-devices-v2-indigo-v2.png) | [2026-11-01-settings-voice-devices.png](compare/2026-11-01-settings-voice-devices.png) |
| Assinatura (Grátis), cartão de upgrade com o único gradiente | [2026-11-01-billing-plan-free-v2-indigo-v1.png](../screenshots/2026-11-01-billing-plan-free-v2-indigo-v1.png) | [2026-11-01-billing-plan-free.png](compare/2026-11-01-billing-plan-free.png) |
| Personalização (cosméticos re-tunados) | [2026-11-01-shop-v2-indigo-v2.png](../screenshots/2026-11-01-shop-v2-indigo-v2.png) | [2026-11-01-shop.png](compare/2026-11-01-shop.png) |
| Configurações do espaço › cargo | [2026-11-01-space-settings-role-editor-v2-indigo-v4.png](../screenshots/2026-11-01-space-settings-role-editor-v2-indigo-v4.png) | [2026-11-01-space-settings-role-editor.png](compare/2026-11-01-space-settings-role-editor.png) |
| Login | [2026-11-01-auth-login-v2-indigo-v2.png](../screenshots/2026-11-01-auth-login-v2-indigo-v2.png) | [2026-11-01-auth-login.png](compare/2026-11-01-auth-login.png) |
| Onboarding | [2026-11-01-onboarding-v2-indigo-v2.png](../screenshots/2026-11-01-onboarding-v2-indigo-v2.png) | [2026-11-01-onboarding.png](compare/2026-11-01-onboarding.png) |
| Termos mudaram (gate) | [2026-11-01-gate-terms-v2-indigo-v2.png](../screenshots/2026-11-01-gate-terms-v2-indigo-v2.png) | [2026-11-01-gate-terms.png](compare/2026-11-01-gate-terms.png) |
| Conta restrita | [2026-11-01-restricted-underage-v2-indigo-v2.png](../screenshots/2026-11-01-restricted-underage-v2-indigo-v2.png) | — |
| Denúncia: motivo | [2026-11-01-report-reason-v2-indigo-v1.png](../screenshots/2026-11-01-report-reason-v2-indigo-v1.png) | [2026-11-01-report-reason.png](compare/2026-11-01-report-reason.png) |
| Painel da equipe: fila | [2026-11-01-staff-queue-csam-v2-indigo-v2.png](../screenshots/2026-11-01-staff-queue-csam-v2-indigo-v2.png) | [2026-11-01-staff-queue-csam.png](compare/2026-11-01-staff-queue-csam.png) |
| Painel da equipe: suspender | [2026-11-01-staff-decision-suspend-v2-indigo-v2.png](../screenshots/2026-11-01-staff-decision-suspend-v2-indigo-v2.png) | [2026-11-01-staff-decision-suspend.png](compare/2026-11-01-staff-decision-suspend.png) |
| 960×600: shell | [2026-11-01-shell-960x600-v2-indigo-v2.png](../screenshots/2026-11-01-shell-960x600-v2-indigo-v2.png) | [2026-11-01-shell-960x600.png](compare/2026-11-01-shell-960x600.png) |
| 960×600: palco | [2026-11-01-voice-stage-960x600-v2-indigo-v3.png](../screenshots/2026-11-01-voice-stage-960x600-v2-indigo-v3.png) | [2026-11-01-voice-stage-960x600.png](compare/2026-11-01-voice-stage-960x600.png) |
| 960×600: configurações | [2026-11-01-settings-960x600-v2-indigo-v2.png](../screenshots/2026-11-01-settings-960x600-v2-indigo-v2.png) | [2026-11-01-settings-960x600.png](compare/2026-11-01-settings-960x600.png) |
| 1920×1080 @125 %: shell | [2026-11-01-shell-1920x1080@125-v2-indigo-v2.png](../screenshots/2026-11-01-shell-1920x1080@125-v2-indigo-v2.png) | [2026-11-01-shell-1920x1080@125.png](compare/2026-11-01-shell-1920x1080@125.png) |
| 1920×1080 @125 %: palco | [2026-11-01-voice-stage-1920x1080@125-v2-indigo-v2.png](../screenshots/2026-11-01-voice-stage-1920x1080@125-v2-indigo-v2.png) | [2026-11-01-voice-stage-1920x1080@125.png](compare/2026-11-01-voice-stage-1920x1080@125.png) |
| 1920×1080 @125 %: configurações | [2026-11-01-settings-1920x1080@125-v2-indigo-v2.png](../screenshots/2026-11-01-settings-1920x1080@125-v2-indigo-v2.png) | [2026-11-01-settings-1920x1080@125.png](compare/2026-11-01-settings-1920x1080@125.png) |
| 1920×1080 @125 %: home | [2026-11-01-home-1920x1080@125-v2-indigo-v2.png](../screenshots/2026-11-01-home-1920x1080@125-v2-indigo-v2.png) | [2026-11-01-home-1920x1080@125.png](compare/2026-11-01-home-1920x1080@125.png) |

Como reproduzir: `QA_WORK=<dir> QA_API_PORT=4460 QA_LK_PORT=7960 node scripts/qa-stack.mjs start`, depois `ALGA_API_URL=http://127.0.0.1:4460 LIVEKIT_HTTP=http://127.0.0.1:7960 ALGA_OUTBOX_DIR=<dir>/outbox ALGA_SHOTS_OUT=<dir>/app ALGA_SHOTS_TAG=v2-indigo node scripts/screenshot.mjs --only=r3` (e `home,chat`, `trust`, `auth,spacesettings`, `W6_PARTS=staff,settings --only=wave6`). Os lados a lados são `ffmpeg hstack` na mesma altura (900 px), nosso à esquerda. As rodadas abaixo são o histórico da direção anterior (teal).

### Rodada 3 (crítica r2)

| Tela | Screenshot |
|---|---|
| Home com "Agora"; rail com menção em cima e frondes embaixo | [2026-11-01-home-agora-v5.png](../screenshots/2026-11-01-home-agora-v5.png) |
| Chat: voz no header, "Em voz" na lista, resposta com haste reta | [2026-11-01-chat-channel-v8.png](../screenshots/2026-11-01-chat-channel-v8.png) |
| Menu de pessoa (lista de membros): alcançar, moderação, amizade, denunciar | [2026-11-01-member-menu-v2.png](../screenshots/2026-11-01-member-menu-v2.png) |
| Cartão de perfil: em voz + Entrar, cargos, Mensagem / Ligar / ⋯ | [2026-11-01-profile-popover-others-v3.png](../screenshots/2026-11-01-profile-popover-others-v3.png) |
| Cartão de perfil com pedido de amizade pendente | [2026-11-01-profile-popover-pending-v2.png](../screenshots/2026-11-01-profile-popover-pending-v2.png) |
| O autor no chat abre o mesmo cartão | [2026-11-01-chat-author-popover-v2.png](../screenshots/2026-11-01-chat-author-popover-v2.png) |
| Prévia do canal de voz (header só com o nome) | [2026-11-01-voice-preview-v7.png](../screenshots/2026-11-01-voice-preview-v7.png) |
| Palco: luz de quem fala, sala que respira, status só no painel | [2026-11-01-voice-stage-v7.png](../screenshots/2026-11-01-voice-stage-v7.png) |
| Qualidade da conexão: 3 barras, números no tooltip | [2026-11-01-voice-panel-link-v2.png](../screenshots/2026-11-01-voice-panel-link-v2.png) |
| Toast acima do dock em 1320×840 (uma regra só) | [2026-11-01-voice-toast-above-dock-v2.png](../screenshots/2026-11-01-voice-toast-above-dock-v2.png) |
| Menu do tile: o mesmo menu de pessoa | [2026-11-01-voice-tile-moderation-menu-v5.png](../screenshots/2026-11-01-voice-tile-moderation-menu-v5.png) |
| Seletor de tela: prévia grande, qualidade em dois controles | [2026-11-01-screen-picker-v5.png](../screenshots/2026-11-01-screen-picker-v5.png) |
| Você transmitindo: o seu tile carrega a transmissão | [2026-11-01-screen-sharing-self-v5.png](../screenshots/2026-11-01-screen-sharing-self-v5.png) |
| Transmitindo fora do palco: o chip da title bar | [2026-11-01-screen-sharing-offstage-v2.png](../screenshots/2026-11-01-screen-sharing-offstage-v2.png) |
| Transmissão de outra pessoa: AO VIVO + Assistir no tile dela | [2026-11-01-stream-tile-unwatched-v5.png](../screenshots/2026-11-01-stream-tile-unwatched-v5.png) |
| Assistindo: a transmissão toma o palco, pessoas na faixa | [2026-11-01-stream-watching-v5.png](../screenshots/2026-11-01-stream-watching-v5.png) |
| Assistindo em 960×600 (faixa de 120×68) | [2026-11-01-stream-watching-960x600-v2.png](../screenshots/2026-11-01-stream-watching-960x600-v2.png) |
| Estatísticas em pt-BR | [2026-11-01-stream-stats-v5.png](../screenshots/2026-11-01-stream-stats-v5.png) |
| Reconectando: chip no topo, tiles em cinza | [2026-11-01-voice-reconnecting-v5.png](../screenshots/2026-11-01-voice-reconnecting-v5.png) |
| Chamada recebida: cartão no canto, abaixo do header | [2026-11-01-call-incoming-v5.png](../screenshots/2026-11-01-call-incoming-v5.png) |
| Chamada de DM: abertura diz "Em chamada" | [2026-11-01-dm-call-v5.png](../screenshots/2026-11-01-dm-call-v5.png) |
| Palco em 960×600 | [2026-11-01-voice-stage-960x600-v2.png](../screenshots/2026-11-01-voice-stage-960x600-v2.png) |
| Palco em 1920×1080 a 125 % | [2026-11-01-voice-stage-1920x1080@125-v1.png](../screenshots/2026-11-01-voice-stage-1920x1080@125-v1.png) |
| Chat em 960×600 | [2026-11-01-shell-960x600-v4.png](../screenshots/2026-11-01-shell-960x600-v4.png) |
| Home em 960×600 | [2026-11-01-home-960x600-v1.png](../screenshots/2026-11-01-home-960x600-v1.png) |
| Home em 1920×1080 a 125 % | [2026-11-01-home-1920x1080@125-v1.png](../screenshots/2026-11-01-home-1920x1080@125-v1.png) |
| Chat em 1920×1080 a 125 % | [2026-11-01-shell-1920x1080@125-v4.png](../screenshots/2026-11-01-shell-1920x1080@125-v4.png) |
| Aparência: tamanho do texto | [2026-11-01-settings-appearance-v4.png](../screenshots/2026-11-01-settings-appearance-v4.png) |
| Configurações em 960×600 | [2026-11-01-settings-960x600-v1.png](../screenshots/2026-11-01-settings-960x600-v1.png) |
| Configurações em 1920×1080 (quadro centrado) | [2026-11-01-settings-1920x1080-v1.png](../screenshots/2026-11-01-settings-1920x1080-v1.png) |
| Configurações em 1920×1080 a 125 % | [2026-11-01-settings-1920x1080@125-v1.png](../screenshots/2026-11-01-settings-1920x1080@125-v1.png) |
| Dispositivos no menu do app | [2026-11-01-settings-voice-devices-v1.png](../screenshots/2026-11-01-settings-voice-devices-v1.png) |
| Sessões distinguíveis, sair em secundário | [2026-11-01-settings-account-security-v3.png](../screenshots/2026-11-01-settings-account-security-v3.png) |
| Loja: grade de 152, prévia em 3 tamanhos | [2026-11-01-shop-v1.png](../screenshots/2026-11-01-shop-v1.png) |
| Loja em 1920×1080 | [2026-11-01-shop-1920x1080-v2.png](../screenshots/2026-11-01-shop-1920x1080-v2.png) |
| Compacta sem avatares (IRC) | [2026-11-01-density-compact-v4.png](../screenshots/2026-11-01-density-compact-v4.png) |
| Menu do espaço na largura do header | [2026-11-01-space-menu-v9.png](../screenshots/2026-11-01-space-menu-v9.png) |
| Visão geral do espaço: Excluir em repouso sem fill | [2026-11-01-space-settings-overview-v5.png](../screenshots/2026-11-01-space-settings-overview-v5.png) |
| Cargo com a paleta fora das cores de estado | [2026-11-01-space-settings-role-editor-v5.png](../screenshots/2026-11-01-space-settings-role-editor-v5.png) |

| Tela | Screenshot |
|---|---|
| **Voz e presença** | |
| Agora: onde seus amigos estão (Home) | [2026-11-01-home-agora-v5.png](../screenshots/2026-11-01-home-agora-v5.png) |
| Canal de voz antes de entrar (prévia, apelidos do espaço) | [2026-11-01-voice-preview-v7.png](../screenshots/2026-11-01-voice-preview-v7.png) |
| Palco com 3 / 5 / 7 pessoas (linhas equilibradas, apelidos) | [3](../screenshots/2026-11-01-voice-stage-3-v2.png) · [5](../screenshots/2026-11-01-voice-stage-5-v2.png) · [7](../screenshots/2026-11-01-voice-stage-7-v2.png) |
| Transmissão assistida em destaque, sala embaixo | [2026-11-01-stream-featured-v2.png](../screenshots/2026-11-01-stream-featured-v2.png) |
| Mini-player fora do palco (hover) e encaixado em outro canto | [2026-11-01-stream-mini-player-v2.png](../screenshots/2026-11-01-stream-mini-player-v2.png) · [2026-11-01-stream-mini-player-snapped-v2.png](../screenshots/2026-11-01-stream-mini-player-snapped-v2.png) |
| Seletor no Grátis: 1080p60 fora do plano, dica do Alga Plus | [2026-11-01-screen-picker-plan-locked-v1.png](../screenshots/2026-11-01-screen-picker-plan-locked-v1.png) |
| Seletor ao vivo depois do upgrade (qualidade aplicada sem parar) | [2026-11-01-screen-picker-live-plus-v1.png](../screenshots/2026-11-01-screen-picker-live-plus-v1.png) |
| Plano caiu no meio da transmissão: recapada, um aviso | [2026-11-01-screen-sharing-recapped-v2.png](../screenshots/2026-11-01-screen-sharing-recapped-v2.png) |
| Palco: Bruno falando (brilho real, envelope da voz) | [2026-11-01-voice-stage-v7.png](../screenshots/2026-11-01-voice-stage-v7.png) |
| Palco: você falando (anel do microfone no dock) | [2026-11-01-voice-stage-self-speaking-v5.png](../screenshots/2026-11-01-voice-stage-self-speaking-v5.png) |
| Mudo + ensurdecido | [2026-11-01-voice-self-muted-deafened-v3.png](../screenshots/2026-11-01-voice-self-muted-deafened-v3.png) |
| Menu do tile: para você + moderação | [2026-11-01-voice-tile-moderation-menu-v5.png](../screenshots/2026-11-01-voice-tile-moderation-menu-v5.png) |
| Silenciado pela moderação (visão de quem foi silenciado) | [2026-11-01-voice-server-muted-v3.png](../screenshots/2026-11-01-voice-server-muted-v3.png) |
| Movido por um moderador (VOICE_MOVE) | [2026-11-01-voice-moved-v3.png](../screenshots/2026-11-01-voice-moved-v3.png) |
| Desconectado por um moderador (VOICE_DISCONNECT) | [2026-11-01-voice-disconnected-moderator-v3.png](../screenshots/2026-11-01-voice-disconnected-moderator-v3.png) |
| Reconectando: o palco não finge que está tudo bem | [2026-11-01-voice-reconnecting-v5.png](../screenshots/2026-11-01-voice-reconnecting-v5.png) |
| Seletor de tela (prévia, qualidade, conteúdo, áudio) | [2026-11-01-screen-picker-v5.png](../screenshots/2026-11-01-screen-picker-v5.png) |
| Você transmitindo (chip na title bar + painel) | [2026-11-01-screen-sharing-self-v5.png](../screenshots/2026-11-01-screen-sharing-self-v5.png) |
| Transmissão de outra pessoa: nada baixa até Assistir | [2026-11-01-stream-tile-unwatched-v5.png](../screenshots/2026-11-01-stream-tile-unwatched-v5.png) |
| Assistindo (vídeo real via SFU) | [2026-11-01-stream-watching-v5.png](../screenshots/2026-11-01-stream-watching-v5.png) |
| Estatísticas (Ctrl Shift E) | [2026-11-01-stream-stats-v5.png](../screenshots/2026-11-01-stream-stats-v5.png) |
| Modo foco | [2026-11-01-stream-focus-v3.png](../screenshots/2026-11-01-stream-focus-v3.png) |
| Chamada recebida (DM) | [2026-11-01-call-incoming-v5.png](../screenshots/2026-11-01-call-incoming-v5.png) |
| Chamada no DM (palco no topo da conversa) | [2026-11-01-dm-call-v5.png](../screenshots/2026-11-01-dm-call-v5.png) |
| **Configurações** | |
| Minha conta (foto enviada, perfil, e-mail) | [2026-11-01-settings-account-v3.png](../screenshots/2026-11-01-settings-account-v3.png) |
| Recorte da foto (zoom + arrasto, círculo) | [2026-11-01-settings-avatar-crop-v2.png](../screenshots/2026-11-01-settings-avatar-crop-v2.png) |
| Senha: força fraca + sair das outras sessões | [2026-11-01-settings-account-security-v3.png](../screenshots/2026-11-01-settings-account-security-v3.png) |
| Senha: força forte | [2026-11-01-settings-password-strong-v2.png](../screenshots/2026-11-01-settings-password-strong-v2.png) |
| Voz e vídeo (teste de microfone ao vivo) | [2026-11-01-settings-voice-v3.png](../screenshots/2026-11-01-settings-voice-v3.png) |
| Atalhos globais | [2026-11-01-settings-hotkeys-v3.png](../screenshots/2026-11-01-settings-hotkeys-v3.png) |
| Notificações | [2026-11-01-settings-notifications-v3.png](../screenshots/2026-11-01-settings-notifications-v3.png) |
| Aparência | [2026-11-01-settings-appearance-v4.png](../screenshots/2026-11-01-settings-appearance-v4.png) |
| Densidade compacta aplicada | [2026-11-01-density-compact-v4.png](../screenshots/2026-11-01-density-compact-v4.png) |
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
| Visão geral (ícone enviado) | [2026-11-01-space-settings-overview-v5.png](../screenshots/2026-11-01-space-settings-overview-v5.png) |
| Recorte do ícone | [2026-11-01-space-settings-icon-crop-v4.png](../screenshots/2026-11-01-space-settings-icon-crop-v4.png) |
| Ícone no rail | [2026-11-01-space-icon-rail-v2.png](../screenshots/2026-11-01-space-icon-rail-v2.png) |
| Cargos (dono) | [2026-11-01-space-settings-roles-v4.png](../screenshots/2026-11-01-space-settings-roles-v4.png) |
| Cargos reordenados | [2026-11-01-space-settings-roles-reordered-v3.png](../screenshots/2026-11-01-space-settings-roles-reordered-v3.png) |
| Editor de cargo | [2026-11-01-space-settings-role-editor-v5.png](../screenshots/2026-11-01-space-settings-role-editor-v5.png) |
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
| **Onda 6: equipar, ao vivo, equipe** | |
| Loja: item na sua conta, "Usar no perfil" | [2026-11-01-shop-equip-owned-v1.png](../screenshots/2026-11-01-shop-equip-owned-v1.png) |
| Loja: em uso, "Tirar do perfil" | [2026-11-01-shop-equipped-v1.png](../screenshots/2026-11-01-shop-equipped-v1.png) |
| Cosméticos de outra pessoa na lista de membros (USER_UPDATE) | [2026-11-01-members-cosmetics-others-v1.png](../screenshots/2026-11-01-members-cosmetics-others-v1.png) |
| Popover de perfil de outra pessoa com cosméticos | [2026-11-01-profile-popover-others-v3.png](../screenshots/2026-11-01-profile-popover-others-v3.png) |
| Placa tirada em outro aparelho: some sem recarregar | [2026-11-01-members-cosmetics-live-unequipped-v1.png](../screenshots/2026-11-01-members-cosmetics-live-unequipped-v1.png) |
| Palco: decoração discreta no tile | [2026-11-01-voice-tile-cosmetics-v1.png](../screenshots/2026-11-01-voice-tile-cosmetics-v1.png) |
| 960×600 em chamada: toast acima do dock | [2026-11-01-voice-toast-above-dock-960x600-v1.png](../screenshots/2026-11-01-voice-toast-above-dock-960x600-v1.png) |
| Mini-player montado no shell (Home) | [2026-11-01-stream-mini-player-shell-v1.png](../screenshots/2026-11-01-stream-mini-player-shell-v1.png) |
| Convite criado em outro aparelho aparece na hora | [2026-11-01-space-settings-invites-live-created-v3.png](../screenshots/2026-11-01-space-settings-invites-live-created-v3.png) |
| … e some quando revogado | [2026-11-01-space-settings-invites-live-revoked-v3.png](../screenshots/2026-11-01-space-settings-invites-live-revoked-v3.png) |
| Renovação cancelada: retomar, com data e preço | [2026-11-01-billing-plan-canceled-resume-v2.png](../screenshots/2026-11-01-billing-plan-canceled-resume-v2.png) |
| Renovação retomada | [2026-11-01-billing-plan-resumed-v2.png](../screenshots/2026-11-01-billing-plan-resumed-v2.png) |
| Relatório de qualidade de chamada (desligado por padrão) | [2026-11-01-settings-privacy-telemetry-off-v2.png](../screenshots/2026-11-01-settings-privacy-telemetry-off-v2.png) |
| … ligado | [2026-11-01-settings-privacy-telemetry-on-v2.png](../screenshots/2026-11-01-settings-privacy-telemetry-on-v2.png) |
| Cópia dos dados pronta | [2026-11-01-settings-privacy-export-ready-v2.png](../screenshots/2026-11-01-settings-privacy-export-ready-v2.png) |
| Baixar pede a senha de novo | [2026-11-01-settings-privacy-export-download-v2.png](../screenshots/2026-11-01-settings-privacy-export-download-v2.png) |
| Senha incorreta | [2026-11-01-settings-privacy-export-wrong-password-v2.png](../screenshots/2026-11-01-settings-privacy-export-wrong-password-v2.png) |
| Download aberto (link de 10 min) | [2026-11-01-settings-privacy-export-opened-v2.png](../screenshots/2026-11-01-settings-privacy-export-opened-v2.png) |
| Equipe: fila com abuso infantil primeiro (texto oculto, anexos só metadados) | [2026-11-01-staff-queue-csam-v4.png](../screenshots/2026-11-01-staff-queue-csam-v4.png) |
| Equipe: denúncia de mensagem | [2026-11-01-staff-report-message-v4.png](../screenshots/2026-11-01-staff-report-message-v4.png) |
| Equipe: suspender (prazo, nota, log de auditoria) | [2026-11-01-staff-decision-suspend-v4.png](../screenshots/2026-11-01-staff-decision-suspend-v4.png) |
| Equipe: feito, registrado, próximo item | [2026-11-01-staff-decision-done-v4.png](../screenshots/2026-11-01-staff-decision-done-v4.png) |
| Equipe: arquivar | [2026-11-01-staff-decision-dismiss-v4.png](../screenshots/2026-11-01-staff-decision-dismiss-v4.png) |
| Equipe: recursos | [2026-11-01-staff-appeals-v3.png](../screenshots/2026-11-01-staff-appeals-v3.png) |
| Equipe: reverter decisão | [2026-11-01-staff-appeal-revert-v3.png](../screenshots/2026-11-01-staff-appeal-revert-v3.png) |
| Equipe: quarentena (sem visualização) | [2026-11-01-staff-quarantine-v3.png](../screenshots/2026-11-01-staff-quarantine-v3.png) |
| Equipe: liberar (foco em Cancelar) | [2026-11-01-staff-quarantine-release-v3.png](../screenshots/2026-11-01-staff-quarantine-release-v3.png) |
| Equipe: resolvidas, com quem decidiu e a nota | [2026-11-01-staff-reports-resolved-v3.png](../screenshots/2026-11-01-staff-reports-resolved-v3.png) |
| Equipe: 960×600 | [2026-11-01-staff-queue-960x600-v3.png](../screenshots/2026-11-01-staff-queue-960x600-v3.png) |
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
| Canal | [2026-11-01-chat-channel-v8.png](../screenshots/2026-11-01-chat-channel-v8.png) |
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
| Menu do espaço (com "Configurações do espaço") | [2026-11-01-space-menu-v9.png](../screenshots/2026-11-01-space-menu-v9.png) |
| Convite | [2026-11-01-space-invite-v4.png](../screenshots/2026-11-01-space-invite-v4.png) |
| Criar canal (selecionado sobe em luminância) | [2026-11-01-space-create-channel-v3.png](../screenshots/2026-11-01-space-create-channel-v3.png) |
| Entrar com convite: prévia | [2026-11-01-space-join-preview-v3.png](../screenshots/2026-11-01-space-join-preview-v3.png) |
| Tamanho mínimo 960×600 | [2026-11-01-shell-960x600-v4.png](../screenshots/2026-11-01-shell-960x600-v4.png) |
| 1920×1080 a 125% | [2026-11-01-shell-1920x1080@125-v4.png](../screenshots/2026-11-01-shell-1920x1080@125-v4.png) |
| **Confiança e segurança** | |
| Cadastro: campos obrigatórios, caixa desmarcada | [2026-11-01-auth-register-required-v3.png](../screenshots/2026-11-01-auth-register-required-v3.png) |
| Cadastro: data por extenso + Termos aceitos | [2026-11-01-auth-register-birth-terms-v3.png](../screenshots/2026-11-01-auth-register-birth-terms-v3.png) |
| Cadastro abaixo de 16 anos (nada enviado) | [2026-11-01-auth-register-too-young-v3.png](../screenshots/2026-11-01-auth-register-too-young-v3.png) |
| Os Termos mudaram (antes de entrar) | [2026-11-01-gate-terms-v3.png](../screenshots/2026-11-01-gate-terms-v3.png) |
| Aceite sem a caixa marcada | [2026-11-01-gate-terms-unchecked-v3.png](../screenshots/2026-11-01-gate-terms-unchecked-v3.png) |
| Não concorda: excluir a conta dali mesmo | [2026-11-01-gate-terms-delete-v3.png](../screenshots/2026-11-01-gate-terms-delete-v3.png) |
| Data de nascimento (conta antiga, uma vez) | [2026-11-01-gate-birth-date-v3.png](../screenshots/2026-11-01-gate-birth-date-v3.png) |
| Data lida por extenso antes de confirmar | [2026-11-01-gate-birth-date-filled-v3.png](../screenshots/2026-11-01-gate-birth-date-filled-v3.png) |
| Declarou menos de 16: suspensa, com recurso | [2026-11-01-restricted-underage-v3.png](../screenshots/2026-11-01-restricted-underage-v3.png) |
| 16–17 anos: proteções em Privacidade | [2026-11-01-settings-privacy-teen-v3.png](../screenshots/2026-11-01-settings-privacy-teen-v3.png) |
| 16–17 anos: Assinatura sem checkout | [2026-11-01-billing-plan-teen-v3.png](../screenshots/2026-11-01-billing-plan-teen-v3.png) |
| 16–17 anos: Loja sem checkout, prévia mantida | [2026-11-01-shop-teen-v3.png](../screenshots/2026-11-01-shop-teen-v3.png) |
| Cartão de perfil com Denunciar | [2026-11-01-profile-popover-report-v3.png](../screenshots/2026-11-01-profile-popover-report-v3.png) |
| Menu do membro: Denunciar perfil | [2026-11-01-member-menu-report-v2.png](../screenshots/2026-11-01-member-menu-report-v2.png) |
| Menu do espaço: Denunciar espaço | [2026-11-01-space-menu-report-v2.png](../screenshots/2026-11-01-space-menu-report-v2.png) |
| Denúncia: motivos (Urgente primeiro) | [2026-11-01-report-reason-v3.png](../screenshots/2026-11-01-report-reason-v3.png) |
| Motivo escolhido mostra o que conta | [2026-11-01-report-reason-picked-v3.png](../screenshots/2026-11-01-report-reason-picked-v3.png) |
| Detalhes + anonimato para o denunciado | [2026-11-01-report-details-v3.png](../screenshots/2026-11-01-report-details-v3.png) |
| Menores: prioridade máxima explicada | [2026-11-01-report-reason-csam-v2.png](../screenshots/2026-11-01-report-reason-csam-v2.png) |
| Menores: o que acontece, antes de enviar | [2026-11-01-report-details-csam-v2.png](../screenshots/2026-11-01-report-details-csam-v2.png) |
| Autolesão: 190, 192, CVV 188 | [2026-11-01-report-details-life-v2.png](../screenshots/2026-11-01-report-details-life-v2.png) |
| Denúncia recebida + Bloquear | [2026-11-01-report-done-v3.png](../screenshots/2026-11-01-report-done-v3.png) |
| 10 denúncias por hora | [2026-11-01-report-rate-limited-v2.png](../screenshots/2026-11-01-report-rate-limited-v2.png) |
| Privacidade: ações na conta, textos, dados, excluir | [2026-11-01-settings-privacy-v2.png](../screenshots/2026-11-01-settings-privacy-v2.png) |
| Contestar um aviso (sessão) | [2026-11-01-settings-privacy-appeal-v2.png](../screenshots/2026-11-01-settings-privacy-appeal-v2.png) |
| Recurso em análise | [2026-11-01-settings-privacy-appealed-v2.png](../screenshots/2026-11-01-settings-privacy-appealed-v2.png) |
| Cópia dos dados pedida | [2026-11-01-settings-privacy-export-v2.png](../screenshots/2026-11-01-settings-privacy-export-v2.png) |
| Excluir conta: 7 dias, mensagens, espaços | [2026-11-01-settings-delete-account-v2.png](../screenshots/2026-11-01-settings-delete-account-v2.png) |
| Excluir conta: senha incorreta | [2026-11-01-settings-delete-wrong-password-v2.png](../screenshots/2026-11-01-settings-delete-wrong-password-v2.png) |
| Login depois de excluir: data e como desfazer | [2026-11-01-auth-login-deletion-scheduled-v2.png](../screenshots/2026-11-01-auth-login-deletion-scheduled-v2.png) |
| Entrou na carência: exclusão cancelada | [2026-11-01-deletion-canceled-v2.png](../screenshots/2026-11-01-deletion-canceled-v2.png) |
| Suspensa com a sessão aberta (4010): login explica | [2026-11-01-auth-login-restricted-notice-v2.png](../screenshots/2026-11-01-auth-login-restricted-notice-v2.png) |
| Conta suspensa: regra, até quando, recurso | [2026-11-01-restricted-suspended-v2.png](../screenshots/2026-11-01-restricted-suspended-v2.png) |
| Recurso enviado | [2026-11-01-restricted-appeal-sent-v2.png](../screenshots/2026-11-01-restricted-appeal-sent-v2.png) |
| Conta encerrada, recurso em análise | [2026-11-01-restricted-banned-appeal-open-v2.png](../screenshots/2026-11-01-restricted-banned-appeal-open-v2.png) |
| Decisão de abuso infantil: só a regra genérica | [2026-11-01-restricted-banned-generic-v1.png](../screenshots/2026-11-01-restricted-banned-generic-v1.png) |

Onda 3 (anexos, configurações do espaço, conta): API própria na porta 4100 (`ALGA_API_URL`, banco PGlite, uploads e caixa de e-mail em diretório temporário; `ALGA_OUTBOX_DIR` lê os tokens de confirmação e de redefinição), mídia sintética gerada com ffmpeg (gradientes, fractal, padrões de teste, vídeo e áudio de teste; nenhum arquivo pessoal), progresso e queda de upload por um proxy TCP com taxa limitada que depois é derrubado, URL vencida por um interceptador que responde 403 na primeira carga.

Onda 4 (links, convites, plano, loja; `--only=billing,invites`): API própria na porta 4100 com `BILLING_PROVIDER=sandbox`. O checkout é o fluxo real: o `shell.openExternal` do main é trocado por um gravador (o handler IPC do app ainda valida a URL), o script abre a URL como o navegador abriria, o provedor sandbox confirma pelo mesmo caminho de um webhook verificado e o `ENTITLEMENTS_UPDATE` chega ao app; "recusado" é a mesma página com `outcome=decline`. Uma pessoa nova (Íris) a cada execução, porque o histórico de compras não se apaga. Deep links: segunda instância do Electron no mesmo perfil com `algameet://…` (o main repassa para a instância aberta) e partida a frio com o link no argv, com tokens tirados da caixa de e-mail da API de teste.

Confiança e segurança (`--only=trust`, perfil `shots-t`): API própria em outra porta, com PGlite, caixa de e-mail e uploads em diretório temporário e LiveKit desligado de propósito. A moderadora de teste ganha o papel só por `apps/server/scripts/grant-staff.ts`, com a API parada; aviso, suspensão, banimento, retirada e o recurso de quem está banido passam pela API real (`/admin/users/:id/actions`, `POST /appeals` com o token do login). As contas "antigas" (sem data de nascimento e sem aceite) são criadas sem esses campos, o que a API de desenvolvimento ainda aceita.

Validação: cada tela foi capturada no app Electron real (`--profile=shots`) com dados criados pela API REST real; estados de rede (lento, servidor fora, boot sem servidor) vêm de um proxy TCP no script, não de dados falsos no app. Tamanhos: 1320×840 (padrão), 960×600 (mínimo) e 1920×1080 a 125%.

Voz: duas instâncias reais (`--profile=shots` e `--profile=shots-b`) no mesmo canal pelo LiveKit local, com dispositivos falsos do Chromium. O microfone de B é uma fala pt-BR gerada (SAPI + ffmpeg), então o brilho segue um envelope de voz real; a transmissão de A passa pelo fluxo real do app (seletor → `startScreenShare` → SFU → `watch` em B → decodificação) com a fonte de desktop falsa do Chromium como imagem, para não capturar a tela de ninguém. As miniaturas do seletor mostram um padrão de teste em tela cheia (ffplay) pelo mesmo motivo. Moderação, VOICE_MOVE e VOICE_DISCONNECT são disparados pela API real; "reconectando" é o LiveKit derrubado de verdade e religado.

Onda 6 (`--only=wave6`, perfis `shots-w`/`shots-w2`/`shots-w3`; `W6_PARTS=cosmetics,voice,settings,staff` refaz só uma parte): API própria na porta 4170 com PGlite, uploads e caixa de e-mail num diretório temporário, `BILLING_PROVIDER=sandbox` e um LiveKit próprio na 7980 (`LIVEKIT_HTTP`). Cosméticos comprados pelo checkout sandbox real e equipados pela tela; o "ao vivo" do outro lado é a segunda instância recebendo `USER_UPDATE` (e um desequipar feito pela API, como outro aparelho). Convites criados e revogados pela API com a página aberta: 26–34 ms até aparecer, 17–24 ms até sumir. O download da exportação é o fluxo real até o `openExternal` (gravado no main); o script baixa o link: 200, `application/zip`, começa com `PK`. A conta da equipe ganha o papel por `apps/server/scripts/grant-staff.ts` com a API parada; denúncias (inclusive a de abuso infantil, que põe o anexo em quarentena sozinha), aviso e recurso são criados pela API real, e as decisões nas capturas são feitas pelo teclado no painel.
