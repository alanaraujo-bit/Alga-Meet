# Referência de site: heyparker.ai

> Estudo feito em 2026-11-01 para o site do Alga Meet (`apps/site`). O dono pediu "um site tão bom quanto o heyparker.ai, só que na nossa pegada".
> **Aprendemos o ofício, não copiamos nada.** Nenhum código, ilustração, texto, fonte ou marca deles entra no nosso site.
> Capturas, vídeos e o JSON de inspeção ficam só nesta máquina, em `docs/references/heyparker/` (fora do git: `.gitignore`).

## Método

- **Ferramenta:** Playwright 1.64 (Chromium headless) com `docs/references/heyparker/_study.mjs`, `_sticky.mjs` e `_sheet.mjs` (locais, fora do git).
- **Telas:** 1440×900, 768×1024 e 390×844 (móvel com toque).
- **Rolagem:** lenta, 12 % da altura da tela a cada 140 ms (roda do mouse no desktop, `scrollBy` no toque), com um quadro a cada meia tela.
- **Saída:**
  - vídeo da rolagem por tela (`heyparker-scroll-{desktop,tablet,mobile}.webm`);
  - 57 + 55 + 57 quadros;
  - 7 quadros dos primeiros 4,5 s;
  - um quadro com `prefers-reduced-motion: reduce`;
  - folhas de contato.
- **Inspeção:**
  - estilos computados: fontes, transições e animações de todos os elementos;
  - `@keyframes`;
  - recursos da rede;
  - elementos `position: sticky` com a altura do pai;
  - LCP e CLS por `PerformanceObserver`;
  - assinaturas de bibliotecas no bundle baixado.
- **Cookies:** não apareceu banner nas três telas, então não houve nada a recusar.
- **Limites:**
  - O bundle do Framer é minificado e carrega módulos por URL montada em tempo de execução. Por isso a análise da pilha mistura o DOM (classes, atributos) com assinaturas no código.
  - LCP e CLS vieram de uma rolagem automática numa rede rápida, sem limitar a CPU. Servem para comparar, não como nota de Lighthouse.

## 1. A pilha por trás do movimento

| O quê | Evidência | Leitura |
|---|---|---|
| **Framer** (site montado no editor) | `<!-- Made in Framer -->`, `generator: Framer`, `data-framer-appear-id` (2 elementos) | O runtime do Framer embute o Framer Motion: animações de aparecer, molas (`stiffness`/`damping` no bundle) e transformações ligadas à rolagem (`scrollYProgress`). |
| **Lenis** (rolagem suave) | `<html class="lenis lenis-autoToggle">` | O componente de rolagem suave do Framer usa Lenis. A roda do mouse vira inércia. |
| **Seções presas com `position: sticky`** | 12 elementos sticky no desktop: palco de 900 px (100 vh) dentro de pais de **2.700 a 7.200 px** (3 a 8 telas) | Toda a narrativa é "pinada" com CSS puro. O progresso da rolagem dentro do pai move as camadas. Não há GSAP nem ScrollTrigger. |
| **Sequências de imagens** | **214 PNGs** carregados numa rolagem completa (10 SVGs), 3,7 MB de imagens | O zoom no computador e os gestos do personagem são quadros PNG trocados pela rolagem. São pesados, mas exatos. |
| **Vídeos em loop** | 3 `<video>` MP4 `autoplay muted loop` com `poster` | O personagem "vivo" (relaxando, pensando) é vídeo curto, não animação vetorial. |
| **Efeito de máquina de escrever** | `@keyframes blink { 0–49 % opacity 1; 50–100 % 0 }`, `1s steps(1) infinite` | Cursor "_" piscando no fim dos títulos. As letras entram por JS. |
| **Transições de interface** | `opacity .2s ease-out` (6 elementos) e `background, box-shadow .2s cubic-bezier(.16,1,.3,1)` no botão | Interface rápida (200 ms) com curva expo-out. O resto é ligado à rolagem, não ao tempo. |
| **Sem WebGL, Rive ou Lottie** | 0 `canvas`, nada de `@rive-app`/`lottie` | O "uau" vem de ilustração, sequência de imagens e pinagem, não de 3D. |

## 2. Seção por seção (desktop 1440×900; altura total 26.458 px ≈ 29 telas)

1. **Abertura (0–4,5 s, sem rolar).**
   - **Layout:** um Macintosh antigo, centralizado sobre um creme quente.
   - **Animação:**
     - o título é digitado letra a letra na tela branca do computador, com o cursor "_" piscando;
     - a navegação desce já com o texto começando (~600 ms);
     - "Scroll down ↓" aparece por último (~3 s).
   - **Por que funciona:**
     - o site se apresenta como um produto que conversa;
     - a pessoa lê no ritmo em que o texto nasce;
     - só depois de entender a frase ela recebe o convite para rolar.
2. **Zoom para dentro da tela (pinado ~5 telas).**
   - A rolagem aproxima a câmera até a tela do computador ocupar a viewport: "Meet Parker." e o rosto do personagem.
   - O rosto vira uma bolha amarela, que vira o fundo roxo da próxima cena.
   - Transição de cena **sem corte**: um objeto vira o próximo cenário.
3. **O problema (roxo).**
   - Frases curtas em **etiquetas de papel** levemente tortas, com uma palavra em vermelho.
   - À direita, uma frase com um **trecho que gira** dentro de uma caixa tracejada ("eles vêm de [ler threads demais]"), como um caça-níquel de motivos.
   - Ícones de redes sociais passam como **rolos de caça-níquel** dentro de pílulas. O personagem pensa no meio.
   - A câmera se aproxima dele (sequência de PNG) até o ombro e o monitor.
4. **"Parker tells you what ads to make_" (branco → creme).** O título é digitado conforme a seção entra. A cor do fundo muda por faixa.
5. **"Let me show you how_" + 3 passos.**
   - Três setas coloridas se desenham (traço animado) e apontam para baixo.
   - Os passos são **abas de pasta que se empilham** (sticky com `top: 120px`, cada uma 3 telas): Research → Chat → Grow.
   - Cada aba traz uma tela do produto à direita e uma lista curta à esquerda.
   - A aba anterior fica visível em cima, como um fichário.
6. **"Parker works in the background…" (roxo).** O personagem relaxa (vídeo em loop) diante de um monitor onde notificações do produto aparecem.
7. **Transição em pixels.** A cena se **desfaz em blocos de pixel** brancos e verdes até virar a próxima, verde-escura. É o corte mais memorável da página.
8. **Labirinto (verde-escuro).**
   - "Creative strategy used to be a maze_".
   - Um seletor "The old way / The new way" troca o desenho.
   - O caminho se desenha pelo labirinto, o personagem atravessa e um troféu sobe do chão.
9. **"What makes Parker different?" (creme, pinado ~8 telas).**
   - O cérebro do personagem é aberto, com etiquetas de conhecimento.
   - A cada passo, um **semicírculo de cor** cresce atrás (rosa → amarelo → verde → roxo) e um lobo do cérebro acende na mesma cor.
   - Um bilhete amarelo no canto troca o texto: "First…", "Second…", "Third…", "Finally…".
10. **Faixa corrida** "Built by people who actually make ads ✸" (amarelo sobre preto).
11. **Preços.** Três cartões de papel com sombra dura deslocada, uma tabela "What's included" e um cartão "Agency or Enterprise?".
12. **Depoimentos.** Grade de cartões brancos com aspas, que corre na horizontal.
13. **Fechamento.**
    - "Ready to make better ads?" com o personagem.
    - **Figurinhas** ("OK!", "OMG!", "%", "#") explodem em volta.
    - Botão grande "Hire Parker Today".
    - O rodapé tem newsletter e um **wordmark gigante** cortado na base.

## 3. Tipografia, cor e ritmo

- **Tipos:**
  - **serifa** (Source Serif Pro) nos títulos: H1 114/114, H2 64/64 e 40/48, tracking **−4 %** (−4,56 px no H1);
  - **sans** (Radio Canada) no texto: 16/24, 20/26, 22/28,6;
  - Inter Display 14/600 em alguns rótulos.
- **Contraste de voz:** o título fala como gente (serifa, frase curta, minúscula, com "_"). O texto explica como produto (sans, 16–22 px).
- **Cor por cena:** creme `#fcf5e3`-ish, roxo médio, verde-escuro, amarelo e vermelho de acento.
  - Cada capítulo tem um fundo, e a troca de fundo marca o capítulo.
  - O preto do traço é sempre o mesmo, o que dá unidade à ilustração.
- **Ritmo do texto:**
  - títulos de 4 a 8 palavras;
  - 1 a 3 linhas de apoio;
  - listas de uma palavra por linha ("TikTok. Reddit. Competitors.");
  - quase nenhum parágrafo. A rolagem é o parágrafo.
- **Navegação:** pílula branca centralizada com contorno e **sombra dura deslocada** (estilo neo-brutalista).
  - No topo, mostra os links.
  - Ao rolar, encolhe para logo + "Hire Parker Today".
  - No celular: logo, menu e CTA.

## 4. Interação e tempo

- **O tempo da página é a rolagem.** Quase tudo é ligado ao scroll (pinagem + progresso). Animação por tempo só na abertura, no cursor, nos vídeos e no trecho que gira.
- **Durações:** UI em 200 ms com expo-out `cubic-bezier(.16,1,.3,1)`. Cursor de 1 s em `steps(1)`.
- **Pinagem longa:** 3 a 8 telas por capítulo. Quem rola rápido vê a cena "andar". Quem rola devagar vê cada quadro.
- **Lenis** suaviza a roda do mouse. Isso esconde o salto entre quadros das sequências PNG.

## 5. Desempenho e celular (medido)

| Tela | Altura | LCP observado | CLS | Transferido |
|---|---|---|---|---|
| 1440×900 | 26.458 px | 3,3 s | **0,13** | 4,3 MB (3,7 MB de imagem) |
| 768×1024 | 28.885 px | (mídia preguiçosa redefine o LCP durante a rolagem) | **0,21** | — |
| 390×844 | 24.735 px | (idem) | **0,26** | — |

- **Pontos fortes:**
  - pinagem em CSS (barata);
  - 18 de 29 imagens com `loading=lazy`;
  - pôster nos vídeos.
- **Pontos fracos:**
  - CLS acima de 0,1 nas três telas (ruim pelo critério do Google);
  - 214 PNGs (sem AVIF/WebP);
  - só 5 imagens com `srcset`;
  - 4,3 MB numa rolagem;
  - fontes do Google com dezenas de subconjuntos.
  - Num celular fraco, isso pesa.
- **Celular:**
  - **mesma história, mesma pinagem**, com a composição empilhada (texto em cima, ilustração embaixo);
  - nav compacta (logo, menu, CTA);
  - ilustrações recortadas pelo centro;
  - não há um "modo leve" para aparelhos fracos.
- **Movimento reduzido:** os vídeos não tocam (3/3 pausados) e alguns elementos de "aparecer" ficam em `opacity: 0` até entrar na tela (11 ocultos no carregamento).
  - A narrativa por rolagem continua igual. Não há alternativa estática.

## 6. Por que o site encanta

1. **Um personagem e um mundo.** Tudo é desenhado no mesmo traço, então cada cena parece do mesmo filme.
2. **Transições que viram o próximo cenário** (rosto → bolha → fundo; cena → pixels → labirinto). Em vez de cortar, o site transforma.
3. **A rolagem conta a história.** O usuário controla a velocidade, e pinar muitas telas cria a sensação de "capítulo".
4. **Texto curto, com humor e voz humana.** O "_" no fim do título dá a sensação de alguém digitando para você.
5. **Uma ideia por tela.** Nunca há duas mensagens competindo.

## 7. O que vamos adotar, adaptar e evitar

### Adotar
- **Uma ideia por tela** e título curto (4–8 palavras) com texto de apoio de 1–3 linhas.
- **Capítulos marcados por luz, não por cor chapada:** cada seção tem a sua "temperatura" de índigo. Fundo quase preto, luz que muda de lugar.
- **Rolagem que conta:** frase que acende palavra por palavra, janela do app que "endireita" quando você chega perto, barras que crescem enquanto você desce.
- **Lenis** para rolagem suave (só com mouse/trackpad e só em aparelho que aguenta).
- **Movimento de UI rápido** (100–200 ms, expo/quart-out), como o nosso app.

### Adaptar
- **Personagem → as pessoas do grupo.** A nossa "alma" é a voz e a presença: avatares numa sala de voz com o anel índigo que acompanha a fala, a mesma linguagem do app (`design-system.md` §3). O produto é o personagem.
- **Máquina de escrever → frase que acende com a rolagem.** O mesmo efeito de "alguém falando com você", mais calmo e com o texto inteiro no HTML desde o início (SEO e leitor de tela).
- **Pinagem longa → só onde paga, e curta.** Uma sequência de 1–2 telas por capítulo no nível A. No celular e no nível B, a mesma história em fluxo normal, sem prender a rolagem.
- **Abas de pasta empilhadas → cartões de comparação honestos** (720p30 × 1080p30 num comparador arrastável).
- **Transição em pixels → a resolução como transição.** O comparador mostra 720p contra 1080p com o mesmo recorte do nosso app. É uma ideia nossa, que só existe porque o produto transmite tela.
- **Figurinhas no fim → horizonte "Hora Azul"** que sobe no fechamento (a coleção do Plus como luz, não como enfeite).

### Evitar
- **Ilustração cartunesca e paleta creme/roxo/verde:** não é a nossa marca (D10b: quase preto, índigo raro).
- **214 PNGs e 4 MB por visita:** o nosso público inclui celular fraco e 4G.
  - Usamos imagens AVIF/WebP com `srcset`, o LCP pré-carregado e o resto preguiçoso.
  - A animação é feita em CSS/transform, não em quadros de imagem.
- **CLS acima de 0,05:** toda imagem leva `width`/`height`, a fonte é uma só, pré-carregada e com `swap`, e nada entra empurrando o layout.
- **Esconder conteúdo atrás de JS:** sem JS, ou com movimento reduzido, a página inteira aparece estática e completa.
- **A mesma experiência pesada para todos:** os três níveis são A (completo), B (só CSS) e C (estático). A detecção usa memória, núcleos, economia de dados, tipo de rede, movimento reduzido e uma medição real de quadros.
- **Copiar qualquer coisa deles:** código, ilustração, texto, fonte, cores, nome ou layout literal.
