# Estudo de design: Linear como régua de qualidade para o Alga Meet

> Pesquisa de referência. Data da coleta: 2026-11-01. Autor: pesquisa de design (agente).
> Biblioteca visual: `docs/references/linear/` (screenshots) e `docs/references/linear/images/` (imagens oficiais de produto, **apenas referência, nunca embarcar no produto**).

## Legenda de evidência

- **[MEDIDO]**: extraído via Playwright (`getComputedStyle`, tokens CSS em `:root`, histogramas sobre todos os elementos visíveis) ou lido diretamente em screenshot/imagem oficial.
- **[FATO]**: afirmado pela Linear, com URL.
- **[ANÁLISE]**: julgamento de design meu.

## Método e limites

- Chromium headless (Playwright 1.49.1), `colorScheme: 'dark'`, `deviceScaleFactor: 1`, viewports 1440×900 e 1920×1080. Nenhum banner de cookies apareceu (o script procurava "Decline/Reject/Only necessary" e não achou nada).
- Páginas medidas: `/`, `/now/behind-the-latest-design-refresh` (título atual: *A calmer interface for a product in motion*, 12/03/2026), `/now/output-isn-t-design` (17/04/2026), `/features`, `/plan`, `/build`, `/changelog` e, para verificar a origem LCH, `/now/how-we-redesigned-the-linear-ui` (28/03/2024).
- **Não acessei o app logado.** Criar conta está fora do escopo e não é permitido. Duas fontes compensam isso:
  1. O hero da homepage é um **mock do app renderizado em HTML/CSS real**, não uma imagem. Por isso deu para medir sidebar, painel, botões e chips como DOM de verdade.
  2. 49 imagens oficiais de UI (changelog, artigos, páginas de produto).
- Removi imagens que não mostram UI: ícone/logo do app, esboços do logo, ilustrações abstratas do artigo *Output isn't design*, glows decorativos. A regra é não copiar logo, marca ou ilustração proprietária.

---

## 1. Resumo executivo

1. **Hierarquia por luminância, não por cor.** No tema escuro, quase toda a hierarquia vem de 4 níveis de texto e 4 níveis de superfície em cinza quase neutro. O acento (índigo) quase não aparece: anel de foco, seleção de texto, links. **[MEDIDO]**
2. **Densidade alta com ruído baixo.** UI em 12–13px com peso 510, linhas de 28px, raios de 8px, bordas de 5–8% de branco. A refresh de 2026 tirou separadores, ícones e brilho da sidebar. **[MEDIDO] [FATO]**
3. **Cor gerada, não escolhida.** O tema inteiro sai de 3 entradas (base, acento, contraste) em LCH. Elevações são deltas de L/C sobre a base. **[FATO] [MEDIDO]**
4. **Movimento curto e "de saída".** Hover aparece em 0ms e some em 150ms. Mudança de cor leva 100ms com `ease-out-quad`. Menus entram em 180ms. Velocidade percebida é decisão de design. **[MEDIDO]**
5. **Processo acima de output.** A própria Linear diz que design é o ajuste entre forma e contexto, e que gerar telas não é projetar. **[FATO]**

---

## 2. Hierarquia visual

- **[MEDIDO]** Texto em 4 degraus (tokens dark): `--color-text-primary #f7f8f8`, `secondary #d0d6e0`, `tertiary #8a8f98`, `quaternary #62666d`. Contraste sobre `#08090a`: 18,6:1 / 13,6:1 / 6,1:1 / 3,45:1.
- **[MEDIDO]** No changelog, o corpo de leitura (17px) usa `#d0d6e0` (773 ocorrências), não o branco primário. O primário fica para títulos e itens ativos. **[ANÁLISE]** Branco puro em parágrafo longo sobre preto cansa a vista ("halation"). Rebaixar o corpo um degrau deixa o título se destacar sem precisar crescer.
- **[MEDIDO]** No menu do header, item inativo usa `#8a8f98` e item em hover usa `#f7f8f8` com fundo `rgba(255,255,255,.08)`. A interação **sobe de degrau**, não muda de matiz.
- **[FATO]** Princípio da refresh de 2026, em paráfrase: não disputar atenção que não foi conquistada. A sidebar ficou "alguns pontos mais escura" para o conteúdo principal mandar. Tabs ficaram compactas, com ícones e texto menores ([artigo](https://linear.app/now/behind-the-latest-design-refresh)).
- **[MEDIDO]** Na imagem `design-refresh-03` (antes/depois da sidebar), itens inativos passam a ter texto rebaixado e há mais respiro vertical. Só o item ativo fica em `text-primary` sobre fundo sutil.
- **[ANÁLISE]** A regra implícita: **cromo (navegação) recua, conteúdo avança.** No Alga Meet, o "conteúdo" é a conversa ou o palco de voz/vídeo. Lista de servidores e de canais é cromo.

## 3. Densidade de informação

- **[MEDIDO]** Mock do app (hero): sidebar de 232px, padding `8 16 16 8`, linhas de **208×28px**, label 13px/510, ícones de cerca de 16px, cabeçalho de seção 24px de altura em 12px/510 `#62666d`.
- **[MEDIDO]** Histograma tipográfico da homepage: os tamanhos mais frequentes são 14px/400 (93), 12px/510 (55), 13px/400 (48), 15px/400 (42). A UI vive entre 12 e 15px.
- **[FATO]** Em 2024 a Linear ajustou sidebar, tabs, headers e painéis para "reduzir ruído visual, manter alinhamento e aumentar hierarquia e densidade da navegação". Alinhar labels, ícones e botões na vertical e na horizontal foi trabalho explícito ([artigo 2024](https://linear.app/now/how-we-redesigned-the-linear-ui)).
- **[ANÁLISE]** Densidade funciona porque três coisas andam juntas:
  - grade vertical rígida (28px por linha);
  - poucos pesos (400/510/590);
  - quase nenhum separador.

  Sem separadores, o alinhamento faz o papel da borda. Um chat de voz tem o mesmo problema: listas longas de canais e membros.

## 4. Tipografia

**[MEDIDO] Famílias:** `"Inter Variable", "SF Pro Display", -apple-system, …, "Segoe UI", …` para a UI e `"Berkeley Mono", ui-monospace, "SF Mono", Menlo` para código. `-webkit-font-smoothing: antialiased`.
**[FATO]** A partir de 2024 os títulos usam Inter Display, e o resto do texto usa Inter ([artigo 2024](https://linear.app/now/how-we-redesigned-the-linear-ui)).

**[MEDIDO] Pesos (variable font):** `light 300`, `normal 400`, `medium 510`, `semibold 590`, `bold 680`. **[ANÁLISE]** 510 e 590 ficam entre os pesos clássicos. São escolhidos para o texto pequeno em fundo escuro não ficar fino demais nem "gordo" demais. Isso só existe porque a fonte é variável.

**[MEDIDO] Tokens de texto (site):**

| Token | Tamanho | Line-height | Letter-spacing |
|---|---|---|---|
| `text-tiny` | 10px | 1.5 | −0.015em |
| `text-micro` | 12px | 1.4 | 0 |
| `text-mini` | 13px | 1.5 | −0.01em |
| `text-small` | 14px | 21/14 (1.5) | −0.013em |
| `text-regular` | 15px | 1.6 | −0.011em |
| `text-large` | 17px | 1.6 | 0 |
| `title-1…3` | 17 / 20 / 24px | 1.4 / 1.33 / 1.33 | −0.012em |
| `title-4…9` | 32 / 40 / 48 / 56 / 64 / 72px | 1.125 → 1.0 | −0.022em |

**[MEDIDO] Escala do app** (`--font-size-*`, provavelmente compartilhada com o produto): micro 11, mini 12, small 13, regular 15, large 18, title3 20, title2 24, title1 36px.

**[MEDIDO] Amostras reais:**

- H1 do hero: 64px/510, lh 64px (1.0), ls −1.408px (= −0.022em).
- H2 de seção: 48px/510, lh 48px, ls −1.056px.
- H2 de artigo: 24px/590, lh 31.92px, ls −0.288px.
- Corpo de artigo: 17px/400, lh 27.2px.
- Metadado: 13px/400, lh 19.5px, ls −0.13px, `#8a8f98`.
- Título de issue no mock: 20px/590, lh 26.6px, ls −0.24px.
- Código inline: 12px mono, fundo 5% branco, borda 8%, raio 4px, padding `1.2px 6px`.

**[ANÁLISE]**

- O tracking negativo cresce com o tamanho: 0 em 12px, −0.01em em 13–15px, −0.022em em display. É a correção óptica clássica da Inter.
- O line-height cai de 1.6 (leitura) para 1.0 (display).
- No Alga Meet, mensagem de chat é leitura, então pede 1.45–1.6. Rótulo de UI é varredura, então pede 1.2–1.4.

## 5. Ritmo de espaçamento

- **[MEDIDO]** Histograma de `gap` na homepage: 8px (90), 4px (61), 6px (60), 12px (14), 2px (11), 16px (5). No changelog: 6px (306), 8px (28), 32px (10).
- **[MEDIDO]** Paddings recorrentes:
  - `0 32px` (= `--page-inset 32px`);
  - `0 12px` (pílulas do nav);
  - `0 7px` (linhas da sidebar);
  - `14px 24px 14px 16px` (itens do mega menu).
- **[MEDIDO]** Tokens de layout: `--header-height 64px`, `--page-max-width 1024px`, `--page-padding-inline 24px`, `--page-padding-block 64px`, `--homepage-max-width calc(1344px + 2×16px)`.
- **[ANÁLISE]** A base é 4px, com meios-passos de 2 e 6 para controles densos. O valor 7px nas linhas da sidebar é correção óptica: com ícone de 16px, centraliza o glifo em relação ao raio de 8px. Em 1920px o conteúdo não estica (máx. 1376px). Só as margens crescem (veja `homepage-viewport-1920.png`).

## 6. Sistema de cor (LCH)

**Verificação da afirmação "temas gerados em LCH":**

- **[FATO]** Em 2024 a Linear reconstruiu a geração de temas **em LCH em vez de HSL**. O motivo é uniformidade perceptual: cores de mesma lightness parecem igualmente claras. Antes eram **98 variáveis por tema**. Agora são **3 entradas: cor base, cor de acento e contraste**. O contraste permite gerar temas de altíssimo contraste para acessibilidade. As elevações (fundo, painéis, diálogos, modais) também saem do LCH. A neutralidade melhorou ao **limitar quanto do matiz do cromo (azul) entra nos cálculos** ([how-we-redesigned-the-linear-ui](https://linear.app/now/how-we-redesigned-the-linear-ui)). A imagem `redesign-2024-11-lch-vs-hsl.avif` ilustra a diferença.
- **[FATO]** Em 2026 a refresh mudou os temas padrão de um cinza frio e azulado para um **cinza mais quente e menos saturado**, sem deixar "enlameado". Foi construída uma ferramenta interna que ajusta **hue, chroma e lightness de cada token**. A "receita" foi exportada em JSON direto para o Figma ([behind-the-latest-design-refresh](https://linear.app/now/behind-the-latest-design-refresh)). Esse artigo **não usa a sigla "LCH" no texto**. A confirmação está na imagem dele, no item abaixo.
- **[MEDIDO]** A imagem do Theme Editor nesse artigo (`design-refresh-06-…theme-editor….avif`) mostra:
  - `Base Color LCH(4.66% 1.41 265.732)` e `Accent Color LCH(47.918% 59.303 288.421)`;
  - `Contrast 27`;
  - temas derivados `Elevated L+3 C+1` e `Menu L+5 C+1`;
  - tokens `bgBase #0e1012`, `bgBaseHover L+1.5 C+1 → #141517`, `bgSub L−2 C−2 → #060708`.
- **[MEDIDO]** O CSS de produção usa `color-mix(in lch, …)`:
  - `--color-selection-bg: color-mix(in lch, #5e6ad2, black 10%)`;
  - `--color-selection-dim: color-mix(in lch, #5e6ad2, transparent 80%)`.

**[MEDIDO] Tokens dark do site:**

| Grupo | Valores |
|---|---|
| Superfícies `bg-level-0…3` | `#08090a` `#0f1011` `#141516` `#191a1b` (OKLCH L 0.139 / 0.172 / 0.195 / 0.217, C ≈ 0.003) |
| Fundos auxiliares | `secondary #1c1c1f`, `tertiary #232326`, `quaternary #28282c`, `panel #0f1011`, `marketing #010102`, `translucent #ffffff0d` |
| Bordas | `primary #23252a`, `secondary #34343a`, `tertiary #3e3e44`, `translucent #ffffff0d` (5%), `translucent-strong #ffffff14` (8%) |
| Linhas | `line-primary #37393a` … `line-quaternary #141515` |
| Marca/acento | `brand-bg #5e6ad2` (OKLCH H 275°), `accent #7170ff`, `accent-hover / link #828fff`, `accent-tint #18182f`, `focus-ring #5e69d1` |
| Cores de produto | `plan #68cc58`, `build #d4b144`, `security #7a7fad` |

**[ANÁLISE]**

- Os passos entre superfícies são de cerca de 0.02–0.03 em L (OKLCH) com croma quase zero. É isso que dá o ar "neutro e caro".
- Na prática a cor saturada aparece em **ícones de status** (amarelo "In Progress", verde, laranja), não em superfícies.
- O acento é raro de propósito, por isso funciona como sinal.

## 7. Profundidade, contraste, superfícies e bordas

- **[MEDIDO]** A borda mais usada na homepage é `1px rgba(255,255,255,.08)` (66 ocorrências). Depois vêm `.12` (11) e `.05` (3). Bordas são **translúcidas e brancas**, então se adaptam a qualquer superfície embaixo.
- **[MEDIDO]** Pilha de superfícies do mock:
  - página `#08090a`;
  - moldura do app `#090a0b`, raio 12px, padding 8px;
  - painel principal com fundo `rgba(255,255,255,.01)`, borda `1px rgba(255,255,255,.05)`, raio 8px e anel externo `0 0 0 2px rgba(0,0,0,.2)`;
  - painel flutuante do agente com `#161718`, borda `.12`, raio 12px, sombra `0 2px 32px rgba(0,0,0,.25)`.
- **[MEDIDO]** Sombras dark (tokens): `low 0 2px 4px #0000001a`, `medium 0 4px 24px #0003`, `high 0 7px 32px #00000059`. Há também a `shadow-stack-low`, com 5 camadas de 0–8px e opacidade de 0 a 8%.
- **[MEDIDO]** Mega menu do header:
  - fundo `rgba(8,9,10,.9)` com `backdrop-filter: blur(32px)`;
  - borda `1px rgba(255,255,255,.08)`, raio **14px**;
  - sombra `0 8px 32px #08090a`;
  - grupo interno com fundo `.05`, `inset 0 0 0 1px rgba(255,255,255,.05)` e raio **6px**.
- **[FATO]** Segundo princípio da refresh, em paráfrase: estrutura deve ser sentida, não vista. Separadores tinham proliferado. Foram arredondados, tiveram o contraste suavizado e vários foram removidos ([2026](https://linear.app/now/behind-the-latest-design-refresh)). Compare em `design-refresh-05-…avif`: o "depois" troca botões com contorno por texto com ícone e remove a borda das pílulas.
- **[ANÁLISE]**
  - No escuro, sombra quase não aparece. Profundidade vem de **luminância + borda translúcida + anel escuro externo** (o anel separa o objeto do fundo quando os dois são quase pretos).
  - Os raios são concêntricos: raio externo = raio interno + padding (14 = 6 + 8). É por isso que menus aninhados parecem "certos".

## 8. Navegação e sidebar

- **[FATO]** O cromo global é um **"L invertido"** (sidebar + header) que controla a vista principal. O app roda em Electron e precisa funcionar como nativo em macOS/Windows e no navegador, então voltar/avançar, histórico e tabs são removíveis ([2024](https://linear.app/now/how-we-redesigned-the-linear-ui); imagens `redesign-2024-04-inverted-l…`, `redesign-2024-09-…macos-windows-and-in-a-browser`).
- **[MEDIDO]** Sidebar do mock:
  - ordem: workspace → busca e novo → itens pessoais (Pulse, Inbox, My issues, Reviews) → seção "Workspace" → "Favorites";
  - cabeçalhos de seção colapsáveis (▾) em 12px/510 `#62666d`, que é o degrau mais baixo;
  - item ativo com fundo `rgba(255,255,255,.04)`, **sem cor de acento**, raio 8px;
  - hover medido de cerca de `.02`.
- **[MEDIDO]** Pílulas do nav do site: raio 9999px, padding `0 12px`, `color, background 100ms cubic-bezier(.25,.46,.45,.94)`.
- **[ANÁLISE]**
  - A seleção neutra é a decisão mais copiável. Em lista densa, pintar o ativo com acento gera um "farol" que compete com o conteúdo.
  - Para o Alga Meet, o L invertido vira **rail de servidores + lista de canais + header da conversa**. O rail é o nível mais escuro e a lista de canais fica um degrau acima.

## 9. Menus de contexto, popovers, modais e tooltips

- **[MEDIDO]** Pilha de z-index (tokens):

  | Camada | z-index |
  |---|---|
  | `header` | 100 |
  | `overlay` | 500 |
  | `popover` | 600 |
  | `command-menu` | 650 |
  | `dialog-overlay` | 699 |
  | `dialog` | 700 |
  | `toasts` | 800 |
  | `tooltip` | 1100 |
  | `context-menu` | 1200 |

  **[ANÁLISE]** Menu de contexto fica acima de tooltip, porque pode ser aberto de dentro de qualquer camada. O command menu é uma camada própria, ou seja, é um cidadão de primeira classe.
- **[MEDIDO]** Abertura do mega menu: `animation: scaleIn 180ms ease`. Ao trocar de menu, `width, height` transicionam em 220ms `ease`, então o painel se **morfa** em vez de fechar e reabrir. Itens: `background, color 120ms ease-out-quad`. Descrição: `color 250ms ease`. Veja `homepage-nav-product-menu-open-1440.png` e `-hover-1440.png`.
- **[MEDIDO]** Nas imagens oficiais `build-open-in-context-menu.png` e `build-delegate-to-agent-menu.png`, os menus têm:
  - itens de cerca de 28px com ícone de 16px à esquerda;
  - grupos separados por rótulo (`Open in`) em vez de linha;
  - item ativo com fundo sutil e check à direita;
  - campo de busca no topo (`Delegate to…`), ou seja, o menu também é um filtro.
- **[ANÁLISE]** Não observei modais nem tooltips do app de forma direta (exigem login). Pelos tokens, o modal usa a sombra `high` e uma camada `dialog-overlay` própria.

## 10. Seleção, hover e foco

- **[MEDIDO]** Foco: `outline: 1px solid #5e69d1; outline-offset: 2px` (`--focus-ring-width 1px`, `--focus-ring-offset 2px`). Só aparece com teclado (`:focus-visible`). Depois de um clique de mouse ele não apareceu, e depois de focar com teclado apareceu.
- **[MEDIDO]** Hover: sobe um degrau de texto (`#8a8f98` → `#f7f8f8`) e aplica um fundo translúcido branco (`.08` no nav, cerca de `.02` em linhas da sidebar). Seleção persistente: `.04`. Seleção de texto: acento misturado em LCH.
- **[MEDIDO]** `--speed-highlightFadeIn: 0s` e `--speed-highlightFadeOut: .15s`.
- **[ANÁLISE]**
  - O highlight **entra instantâneo e sai suave**. Ao varrer uma lista com mouse ou setas, o item sob o cursor responde no mesmo frame, e o rastro dos anteriores desaparece sem piscar.
  - O anel de 1px é elegante, mas fino para WCAG 2.2 (*focus appearance*). No Alga Meet use 2px.

## 11. Feedback e microinterações

- **[MEDIDO]** Animações ativas na homepage:
  - `dotIn 420ms ease-out-quad` (438 pontos de um grid que entra em cascata);
  - `agentLabelSweep 2s linear` (um brilho que varre o rótulo de um agente "trabalhando");
  - `grid-dot-* 2.8s steps(1)`.
- **[MEDIDO]** Nas imagens, chips "Working…" (`build-pull-requests-list.png`) e o texto "Thinking…" no painel do agente do mock (`homepage-hero-app-mock-1440.png`) mostram que **o progresso é comunicado por texto e brilho no próprio rótulo, não por spinner**.
- **[MEDIDO]** Botões de ícone do mock: 28×28px, raio 9999px, fundo `.02`, `inset 0 0 0 1px rgba(255,255,255,.05)`, `background, color 160ms ease-out-quad`.
- **[ANÁLISE]** O feedback fica onde o olho já está (no rótulo, no item, no chip). Não aparece em toast ou overlay longe do ponto de ação.

## 12. Transições e easing

**[MEDIDO] Tokens:** `--speed-quickTransition .1s`, `--speed-regularTransition .25s`. A família completa de curvas Penner está em variáveis (`--ease-out-quad`, `--ease-out-cubic`, `--ease-out-quart`, `--ease-out-quint`, `--ease-out-expo`, `--ease-in-out-*`, `--ease-in-*`).

**[MEDIDO] Transições mais frequentes (homepage, 1440px):**

| Ocorrências | Propriedade | Duração | Curva |
|---|---|---|---|
| 187 | color | 100ms | `cubic-bezier(.25,.46,.45,.94)` (ease-out-quad) |
| 34 | color | 100ms | ease |
| 22 | filter, transform | 160ms | ease-out-quad |
| 20 | color | 160ms | ease-out-quad |
| 19 | background | 400ms | ease-out |
| 10 | transform | 700ms | `cubic-bezier(.32,.72,0,1)` |
| 8 | transform | 150ms | ease |
| 6 | filter | 200ms | `cubic-bezier(.165,.84,.44,1)` (ease-out-quart) |

No changelog também aparecem `transform 120ms ease` (38) e `color, text-decoration-color, background 250ms ease` (36).

**[ANÁLISE]**

- Na prática há três bandas:
  - **100–160ms** para estados (hover, cor, press);
  - **180–250ms** para objetos que aparecem ou mudam de forma (menus, alturas);
  - **400–700ms** só para coreografia de marketing.
- A curva `(.32,.72,0,1)` é do tipo "sheet": desacelera longo, como painéis de iOS.
- Quase tudo é *ease-out*: o objeto responde já e desacelera no destino. Isso soa rápido.

## 13. Velocidade percebida

- **[MEDIDO]** As linhas do mock do app têm `transition: all 0s`. Mudança de seleção em lista é **instantânea**. Só cromo e controles isolados ganham transição.
- **[MEDIDO]** Highlight com fade-in 0s e fade-out 150ms (seção 10). Menus em 180ms, abaixo do limiar em que a animação começa a "esperar" pelo usuário.
- **[FATO]** O artigo de 2026 diz que o que faz software parecer bom é, em boa parte, o que não se vê, como os problemas de performance que nunca atrasam o usuário ([2026](https://linear.app/now/behind-the-latest-design-refresh)).
- **[ANÁLISE]** A regra prática:
  - **nunca animar a resposta a uma ação direta** (clique, tecla);
  - **animar só a transição de contexto** (abrir, fechar, mover);
  - em lista, a resposta é sempre instantânea.

## 14. Estados vazios, de carregamento e de erro

- **[MEDIDO]** Carregamento observado: rótulos com brilho em loop (`agentLabelSweep`), chips "Working…", texto "Thinking…". A `features-mobile-inbox-iphone.png` e a `changelog-06-…inbox….avif` mostram listas cujas últimas linhas **somem em gradiente**, indicando continuação sem barra de rolagem explícita.
- **[MEDIDO]** O próprio mock do hero tem um comentário fictício em que um usuário reclama de "spinner para sempre". **[ANÁLISE]** É um sinal de valor da casa: estados indefinidos são tratados como defeito.
- **[ANÁLISE]** Não pude observar estados vazios e de erro do app logado. Recomendo uma coleta dedicada com conta de teste criada pelo próprio usuário. Pelo padrão visual, o esperado é texto curto em `text-tertiary`, um único CTA e nenhuma ilustração pesada.

## 15. Consistência entre telas

- **[MEDIDO]** As 7 páginas medidas por histograma compartilham exatamente o mesmo `body` (`bg #08090a`, `color #f7f8f8`, Inter Variable 16/24), a mesma pílula de nav (100ms ease-out-quad) e o mesmo anel de foco. A diferença entre homepage, artigo e changelog é só de **escala tipográfica** (UI 12–15px contra leitura em 17px).
- **[MEDIDO]** As imagens oficiais seguem o mesmo enquadramento: recorte da UI escura sobre fundo escuro, vinheta e *fade* nas bordas. Não há moldura de dispositivo, exceto no mobile.
- **[FATO]** As duas refreshes foram feitas atrás de feature flag, com toggle no dev toolbar para comparar o antes e o depois na hora ([2024](https://linear.app/now/how-we-redesigned-the-linear-ui), [2026](https://linear.app/now/behind-the-latest-design-refresh)).
- **[ANÁLISE]** Consistência aqui não é regra de guia de estilo. **É consequência de gerar tudo a partir de poucos tokens.**

## 16. Lição de processo: *Output isn't design*

- **[FATO]** Karri Saarinen (17/04/2026), apoiado em Christopher Alexander, define design como a busca do **ajuste entre forma e contexto**. Contexto inclui necessidades, restrições técnicas, hábitos e casos de borda. Ferramentas que geram interface rápido produzem formas plausíveis que "desmontam quando você usa de verdade" ([artigo](https://linear.app/now/output-isn-t-design)).
- **[ANÁLISE]** Para o Alga Meet, "contexto" é concreto:
  - 5 pessoas numa call às 23h;
  - um streamer compartilhando tela a 60fps;
  - alguém em notebook com tela 1366×768 e escala de 125% no Windows;
  - fone desconectando no meio da fala.

  Cada tela deve ser validada contra esses cenários, não contra um mock bonito.

---

## 17. Princípios para o Alga Meet

1. **O palco manda, o cromo recua.** Rail de servidores < lista de canais < conversa ou palco de voz. Cada nível de cromo fica pelo menos 1 degrau de superfície e 1 degrau de texto abaixo do conteúdo.
2. **Hierarquia por luminância antes de cor.** Quatro degraus de texto e seis de superfície resolvem 90% da hierarquia. Cor saturada é reservada a **estado** (falando, mudo, ao vivo, erro).
3. **Seleção neutra em listas.** Canal ou DM ativo usa fundo branco translúcido de 7% e texto primário, nunca acento. O acento é para presença de voz, que é o "sinal" do produto.
4. **Bordas translúcidas, poucas e suaves.** Borda é branco a 6–9%, nunca cinza sólido, e só onde o alinhamento não resolve. Antes de adicionar uma linha, tente espaço.
5. **Profundidade no escuro = luminância + borda + anel.** Cada elevação sobe cerca de 0.03 em L (OKLCH). Popover e modal ganham borda translúcida, highlight interno no topo e sombra grande e difusa.
6. **Raios concêntricos.** Raio externo = raio interno + padding (ex.: menu 12px, item 6px, padding 6px). Elementos aninhados nunca têm o mesmo raio que o contêiner.
7. **Resposta direta é instantânea.** Clique, tecla e seleção em lista mudam no mesmo frame. Transição só para mudança de contexto (abrir, fechar, mover). Hover entra em 0ms e sai em 120ms.
8. **Movimento curto, ease-out.** Estados 80–160ms, objetos 180–240ms, painéis 280–320ms. Nada da UI de trabalho passa de 320ms. Respeitar `prefers-reduced-motion` e a opção "Efeitos de animação" do Windows.
9. **Movimento guiado por áudio é a assinatura do Alga.** O indicador de fala segue o **envelope da voz** (ataque de cerca de 60ms, release de cerca de 240ms), como um compressor. Não é um anel liga/desliga. Linear e Discord não têm isso.
10. **Progresso no lugar da ação.** Conectando, reconectando, enviando e processando aparecem no próprio item (rótulo com brilho, texto "Conectando…"), nunca em spinner solto nem em overlay que bloqueia. Spinner indefinido sem texto é bug.
11. **Estado nunca só por cor.** Mudo e ensurdecido usam ícone com barra, cor e tooltip. Ao vivo usa ponto, cor e rótulo. Teste com simulação de daltonismo.
12. **Foco visível e forte.** Anel de 2px com acento e offset de 2px, só com `:focus-visible`. Tudo navegável por teclado, e a command palette (Ctrl+K) é camada própria.
13. **Pilha de camadas declarada.** Tokens de z-index fixos (seção 17.6). Menu de contexto acima de tudo, toasts abaixo de tooltips, overlay de call em camada própria.
14. **Windows primeiro de verdade.** Validar em 100%, 125% e 150% de escala. Degraus de superfície de pelo menos 0.025 L, porque painéis IPS/VA baratos esmagam pretos. Tamanho mínimo de texto: 12px. Blur só em overlays pequenos, nunca sobre vídeo ou compartilhamento de tela (custo de GPU durante o encode).
15. **Tema gerado, não desenhado à mão.** Os tokens saem de 3 entradas (base, acento, contraste) em OKLCH, com deltas de L/C por elevação. Isso torna alto contraste e temas customizados baratos.

### 17.1 Identidade: acento "Bioluminescência"

- **Direção:** teal-ciano luminoso, **OKLCH H ≈ 195°**.
  - texto e ícone de acento: `oklch(0.82 0.12 195)` ≈ `#4ddcdc`;
  - preenchimento: `oklch(0.76 0.125 195)` ≈ `#21c9ca`, **com texto escuro** `#061415` (9,18:1);
  - pressionado: `oklch(0.70 0.105 195)` ≈ `#38b3b3`.
- **Distância dos concorrentes [MEDIDO]:** o índigo da Linear `#5e6ad2` tem H 275°, o acento `#7170ff` tem H 279° e o blurple do Discord `#5865f2` tem H 274°. Nosso acento fica a cerca de 80° deles. Também evita o verde-água do Element (`#0dbd8b`, H 166°), cerca de 30° de distância.
- **Por quê [ANÁLISE]:**
  - "Alga" remete a mar escuro e bioluminescência, isto é, luz viva no escuro. Isso casa com um tema dark-first.
  - Num app de voz, **o acento é a voz**: o brilho de quem fala é a cor da marca.
  - O preenchimento claro com texto escuro inverte a convenção "branco sobre índigo" dos dois concorrentes e fica reconhecível em um frame.
  - Matiz frio-ciano não briga com o vermelho de mudo/sair nem com o âmbar de alerta.
- **Personalidade:** *presença calma*. Menos lúdico que o Discord (sem mascote, sem saturação gamer). Mais humano que a Linear: neutros levemente "de água profunda" (H 230°, C 0.006, contra C ≈ 0.003 na Linear) e movimento que respira com a voz.
- **Status:** online `oklch(0.76 0.17 150)` ≈ `#4fce74` (sempre ponto + forma). Aviso `oklch(0.84 0.15 80)` ≈ `#fdbe45`. Perigo/mudo/sair `oklch(0.68 0.19 25)` ≈ `#f75d59`. Falando = acento (glow, não anel duro).
- **Tipografia:** Inter Variable 4.x (OFL, embarcada para renderizar igual em todo Windows), com eixo `opsz` para títulos e `tnum` para timers e contadores. Mono: JetBrains Mono ou Geist Mono (OFL). **Não usar Berkeley Mono** (licença comercial, e é a mono da Linear).

### 17.2 Escala tipográfica (px)

| Token | Tamanho / line-height | Peso | Tracking | Uso |
|---|---|---|---|---|
| `type-badge` | 11 / 14 | 590 | +0.01em | contadores, badges (nunca texto corrido) |
| `type-meta` | 12 / 16 | 400–510 | 0 | timestamps, cabeçalho de seção da sidebar |
| `type-ui` | 13 / 20 | 400–510 | −0.005em | itens de lista, menus, botões, inputs |
| `type-ui-lg` | 14 / 20 | 510 | −0.01em | nome de canal no header, botões primários |
| `type-message` | 15 / 22 | 400 | −0.011em | corpo de mensagem (leitura) |
| `type-title-sm` | 17 / 24 | 590 | −0.012em | títulos de seção e de painel |
| `type-title` | 20 / 28 | 590 | −0.012em | título de tela e de modal |
| `type-title-lg` | 24 / 32 | 590 | −0.015em | onboarding, título de servidor |
| `type-display` | 32 / 40 | 590 | −0.022em | empty states grandes, splash |
| `type-display-xl` | 48 / 52 | 590 | −0.022em | só marketing/splash |

Pesos disponíveis: 400, 510, 590, 680.

### 17.3 Espaçamento, raios e alturas

- **Espaço (px):** `0, 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64`. A base é 4. Os valores 2 e 6 são só para controles densos.
- **Raios (px):** `xs 4` (badge, código, checkbox), `sm 6` (item de menu), `md 8` (linha da sidebar, botão, input), `lg 12` (card, popover, menu, tile de vídeo), `xl 16` (modal, painel), `full 9999` (pílulas, avatares, controles de call).
- **Alturas de controle:** 24 (ícone compacto), **28 (linha padrão de lista)**, 32 (botão e input), 36 (botão primário), **40 (controles de call: mudo, câmera, tela, sair)**.

### 17.4 Movimento

| Token | Duração | Curva | Uso |
|---|---|---|---|
| `motion-instant` | 0ms | n/a | seleção, hover-in, resposta a tecla |
| `motion-fast` | 100ms | `cubic-bezier(.25,.46,.45,.94)` (out-quad) | cor e fundo no hover, press |
| `motion-hover-out` | 120ms | out-quad | saída do highlight |
| `motion-base` | 160ms | out-quad | toggles, botões de ícone, transform pequeno |
| `motion-pop` | 180ms | `cubic-bezier(.165,.84,.44,1)` (out-quart) | popover, menu de contexto, tooltip (scale .97 → 1 + fade) |
| `motion-morph` | 220ms | `cubic-bezier(.645,.045,.355,1)` (in-out-cubic) | redimensionar painel/menu, reordenar tiles de vídeo |
| `motion-panel` | 300ms | `cubic-bezier(.32,.72,0,1)` (sheet) | drawer de membros, painel lateral, modal |
| `motion-exit` | 0.75× a entrada | `cubic-bezier(.55,.085,.68,.53)` (in-quad) | toda saída é mais curta que a entrada |
| `voice-attack / voice-release` | 60ms / 240ms | linear sobre o envelope RMS | glow de quem está falando |

### 17.5 Superfícies (dark-first, verificadas)

Validei os valores abaixo com um script de conversão OKLCH → sRGB e asserts de contraste WCAG. Todos passaram.

| Nível | Token | OKLCH | Hex | Uso |
|---|---|---|---|---|
| 0 | `bg-app` | 0.145 0.006 230 | `#080b0c` | janela, rail de servidores |
| 1 | `bg-sidebar` | 0.175 0.006 230 | `#0e1113` | lista de canais/DMs |
| 2 | `bg-content` | 0.195 0.006 230 | `#121517` | conversa, palco de voz |
| 3 | `bg-raised` | 0.225 0.007 230 | `#191c1e` | cards, inputs, tile de vídeo sem câmera |
| 4 | `bg-overlay` | 0.255 0.008 230 | `#1f2426` | popover, menu de contexto, tooltip |
| 5 | `bg-modal` | 0.27 0.008 230 | `#23272a` | modal (+ scrim `rgba(0,0,0,.6)`) |

Overlays de estado sobre qualquer nível: hover `rgba(255,255,255,.04)`, selecionado `.07`, pressionado `.10`.

Texto:

| Token | OKLCH | Hex | Contraste em `bg-content` | Contraste em `bg-modal` |
|---|---|---|---|---|
| `text-primary` | 0.965 | `#f1f4f6` | 16,6:1 | 13,6:1 |
| `text-secondary` | 0.85 | `#c9cfd2` | 11,7:1 | 9,6:1 |
| `text-tertiary` | 0.70 | `#98a0a3` | 6,9:1 | 5,7:1 |
| `text-disabled` | 0.52 | `#636a6e` | 3,3:1 | n/a |

`text-disabled` serve só para desabilitado ou decorativo. O degrau mais baixo da Linear (`#62666d`, 3,45:1) é usado em rótulos de seção. **Nós não vamos usá-lo para informação.** O acento mede 11,0:1 em `bg-content` e 9,0:1 em `bg-modal`.

### 17.6 Bordas, sombras, contraste e camadas

- **Bordas:** `border-subtle rgba(255,255,255,.06)` (divisória, card em `bg-content`), `border-default .09` (input, popover), `border-strong .14` (hover de input, separador que precisa aparecer). `border-focus` = anel de 2px com acento e offset de 2px.
- **Sombras:**
  - `elev-overlay`: `0 0 0 1px rgba(0,0,0,.35), 0 8px 24px rgba(0,0,0,.40), inset 0 1px 0 rgba(255,255,255,.04)`;
  - `elev-modal`: `0 0 0 1px rgba(0,0,0,.4), 0 16px 48px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.05)`.
  - Cards no nível 3 não têm sombra, só borda.
- **Regras de contraste:**
  - texto de informação ≥ 4,5:1 em **qualquer** superfície onde aparece (a matriz acima já cobre o pior caso, `bg-modal`);
  - ícones e indicadores de estado ≥ 3:1;
  - texto sobre o acento é sempre escuro (`on-accent #061415`);
  - um tema de alto contraste é gerado pelo parâmetro `contrast`, não mantido à mão.
- **z-index:** `base 0`, `sticky 100`, `call-overlay 300`, `overlay 500`, `popover 600`, `command-palette 650`, `modal-scrim 699`, `modal 700`, `toast 800`, `tooltip 1100`, `context-menu 1200`.

---

## Apêndice: inventário de referências

**Screenshots** (`docs/references/linear/`):

- Homepage:
  - `homepage-viewport-1440.png`, `homepage-full-1440.png`
  - `homepage-viewport-1920.png`, `homepage-full-1920.png`
  - `homepage-header-nav-1440.png`
  - `homepage-hero-app-mock-1440.png` (mock do app em DOM, rolado)
  - `homepage-nav-product-menu-open-1440.png`, `homepage-nav-product-menu-hover-1440.png`
- Artigos:
  - `design-refresh-viewport-1440.png`, `design-refresh-full-1440.png`
  - `output-isnt-design-viewport-1440.png`, `output-isnt-design-full-1440.png`
  - `redesign-2024-viewport-1440.png`, `redesign-2024-full-1440.png`
- Produto:
  - `features-viewport-1440.png`, `features-full-1440.png`
  - `plan-viewport-1440.png`, `plan-full-1440.png`
  - `build-viewport-1440.png`, `build-full-1440.png`
- Changelog:
  - `changelog-viewport-1440.png`
  - `changelog-full-1440.png` (primeiros 7000px)

**Imagens oficiais** (`docs/references/linear/images/`, originais, só referência):

- `design-refresh-01…06` (blueprints de header, sidebar e tabs antes/depois, bordas antes/depois, Theme Editor LCH);
- `redesign-2024-03…12` (nova UI, L invertido, explorações, before/concept/after, multiplataforma, alinhamentos da sidebar, LCH vs HSL, contraste 30 vs 100);
- `changelog-01…14` (diffs, uso de IA, settings, callout, inbox, drafting, code review, initiatives, iOS, agent panel);
- `plan-*` (board, timeline, initiatives, dependências, project overview);
- `build-*` (thread de atividade, propriedades, menu de delegar, lista de PRs, menu "Open in", settings, gráfico de ciclo);
- `features-*` (product intelligence, inbox mobile, card de intake).

Os scripts de captura ficaram fora do repositório, no scratchpad da sessão (`capture.js`, `capture2.js`, `capture3.js`, `tokens.js`).
