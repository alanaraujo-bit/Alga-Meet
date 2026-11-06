# Estudo de mascotes de ferramentas de IA para devs

> 2026-11-05. Pesquisa para orientar o mascote do Alga Meet.
> Escopo: OpenCode, OpenClaw (ex-Clawdbot/Moltbot), Claude Code (Clawd), OpenAI Codex (pets) e o "Grokbot", mais alguns mascotes de contraste.
> Método: imagens vistas de fato (navegador, arquivos oficiais, sprites baixados da CDN oficial), código-fonte público (GitHub) e o binário do Claude Code instalado nesta máquina (só leitura de strings). As imagens de referência ficaram em `docs/private/research/mascots/` (pasta ignorada pelo git, só para estudo: são arte de outras marcas). A lista está no fim.

## Resumo em 7 linhas

1. Nenhum desses mascotes é uma "imagem bonita". Cada um é uma **especificação pequena**: um grid, 2 a 5 cores chapadas, poucas formas e um rosto de dois elementos. Dá para desenhar de memória.
2. Eles nascem da **matéria do próprio produto**: o Clawd é feito de caracteres de bloco do terminal, o OpenCode é um wordmark de blocos, o rosto do pet do Codex é o prompt `>_`.
3. Eles são **sistemas de estados** ligados a eventos reais (pensando, esperando você, pronto, falhou), com animação de poucos quadros. Não são ilustrações paradas.
4. A personalidade vem do **comportamento e do texto** (olhar para os lados, espirrar, piscar, frases do spinner, lore), não de detalhe de desenho.
5. A regra oficial da OpenAI para pets do Codex proíbe exatamente o que as nossas duas tentativas tinham: brilho, halo, aura difusa, fumaça solta, partículas, realismo, cenário.
6. "Grokbot" não existe como mascote. O mais provável é confusão com **Clawdbot** (o antigo nome do OpenClaw, cujo mascote era o Clawd). Ver a seção 5.
7. Para o Alga Meet: pixel art em grid fixo (personagem em 16×16 dentro de uma tela de 24×24), 3 a 4 cores, corpo escuro, olhos índigo como única fonte de "luz", aura feita de pixels duros (contorno), rosto que vira medidor de voz quando a pessoa fala. Um conjunto fechado de estados. Avatares gerados por partes a partir da mesma base.

---

## 1. OpenCode (sst/opencode, hoje anomalyco/opencode)

**Achado principal: o OpenCode não tem mascote oficial.** Procurei no README, no site, no repositório e no código da TUI. O que funciona como "personagem" é o próprio **wordmark em blocos**, que aparece grande na tela inicial do terminal. Existem mascotes feitos pela comunidade (o plugin "Mustachi" e o `@mingxy/opencode-mascot`), o que mostra que o público quer um personagem ali, mas eles não são oficiais.

### 1.1 Construção visual
- **Meio:** pixel/blocos. No site e nos ícones é SVG feito só de retângulos; na TUI são caracteres `█ ▀ ▄`.
- **Grid:** módulo de 6 px. Cada letra tem 4×5 módulos (24×30 px), o miolo de cada letra tem 2×2 módulos, o `p` desce 1 módulo e o `d` sobe 1. O wordmark inteiro tem 39×7 módulos (viewBox 234×42).
- **Cores (tema escuro):** "open" em `#B7B1B1`, "code" em `#F1ECEC`, e o miolo das letras preenchido com uma "sombra" `#4B4646`. Tema claro: `#656363`, `#211E1E`, `#CFCECD`. São três tons, nenhum gradiente.
- **O truque:** o miolo de cada letra é meio preenchido com um tom de sombra (só a metade de baixo). Isso dá profundidade e faz cada letra parecer uma "janelinha" ou um copo cheio. No código da TUI, o tom de sombra é calculado assim: `tint(theme.background.base, fg, 0.25)`, ou seja, 25% do caminho entre o fundo e a cor da letra. Funciona em qualquer tema.
- **Ícone do app:** só o "o": um quadrado branco vazado com o miolo meio cinza. É simples o bastante para desenhar de memória.

### 1.2 Silhueta e escala
O ícone (só o "o") lê bem em 16 a 32 px porque é um anel quadrado de alto contraste. O wordmark tem três tamanhos na TUI, escolhidos pelo tamanho do terminal (`packages/tui/src/component/logo.tsx`):
- terminal largo: as duas metades lado a lado;
- largura abaixo de 44 colunas: "open" em cima de "code";
- largura abaixo de 22 colunas: só o mini logo `go`;
- altura abaixo de 12 linhas: o logo some.

### 1.3 Personalidade
Austera, "nativa de terminal", confiante. A personalidade vem do capricho e da contenção, não de um rosto.

### 1.4 Como vive no produto
- Tela inicial da TUI: wordmark em blocos centralizado (`packages/tui/src/logo.ts`).
- Banners de entrada e saída no histórico do terminal usam o mini logo `go` (`mini/splash.ts`).
- "Pensando": um spinner braille `⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏` e um "scanner" estilo Knight Rider: um bloco aceso que vai e volta com rastro que esmaece (`ui/spinner.ts`, modo `bidirectional`, com `trailLength` e `enableFading`). Aparece na barra de baixo como `■■■■····`.
- Site, cabeçalho, card social (`social-share.png`) e ícones do app desktop usam o mesmo sistema de blocos.

### 1.5 Relação com a marca
Logo, tipografia e "mascote" são a mesma coisa: um único sistema de pixels.

### 1.6 Por que agrada
Não achei reação da comunidade específica sobre o logo. A sensação de "mascote" vem da presença constante e do acabamento do wordmark em blocos. Também pode ser que o dono esteja lembrando de um mascote de comunidade. Vale mostrar a ele a imagem do wordmark para confirmar.

**Lição:** um sinal de pixel bem construído, desenhado no material nativo do produto e com um tom de sombra, já cria afeto.

Fontes: [opencode.ai](https://opencode.ai), [README](https://github.com/anomalyco/opencode), `packages/tui/src/logo.ts`, `component/logo.tsx`, `ui/spinner.ts`, `component/spinner-frames.ts` (no mesmo repositório), [Mustachi (comunidade)](https://www.pkgstats.com/pkg:plugin-gentleman), [opencode-mascot (comunidade)](https://www.pkgstats.com/pkg:@mingxy/opencode-mascot).

---

## 2. OpenClaw (ex-Clawdbot, ex-Moltbot): o lagosta espacial Clawd, depois Molty

**O que é:** uma lagosta espacial. O projeto começou como **Clawdbot** (com o mascote **Clawd**). Depois de um pedido da Anthropic em janeiro de 2026 virou **Moltbot**, e o mascote passou a se chamar **Molty**, que usa os pronomes they/them. Em 30/01/2026 virou **OpenClaw**. A troca de nome foi contada como "muda de casca" (molting): "New shell, same lobster."

### 2.1 Construção visual: o mesmo bicho em quatro registros
1. **Mascote vetorial oficial** (`openclaw.ai/brand/openclaw-mascot.svg`, que é o mesmo arquivo do favicon): **1,3 KB**, viewBox 120×120. São 3 formas preenchidas (corpo redondo com duas perninhas retas, duas garras como luvas laterais), 2 antenas (traços de 3 px com ponta redonda) e 4 círculos (2 olhos `#181A1F` com 2 brilhos `#DDE2E9`). Há um único gradiente, `#ff4d4d` → `#991b1b`. Não tem boca. Dá para desenhar de memória em 10 segundos.
   - O banner do README usa a mesma figura com **pupilas ciano** sobre o vermelho e um leve brilho em volta, no fundo escuro estrelado. A descrição dentro do SVG atual diz que o brilho dos olhos trocou de verde para cinza claro (o texto da descrição está em português).
2. **Pixel lobster** (`docs/assets/pixel-lobster.svg`): **grid 16×16, 5 cores**: contorno `#3a0a0d`, corpo `#ff4f40`, garras `#ff775f`, pupila `#081016`, brilho do olho `#f5fbff`. Os olhos têm 2 pixels cada (brilho em cima, pupila embaixo). É usado no cabeçalho do site de docs.
3. **Avatar da organização no GitHub**: uma lagosta no estilo "mascote de time esportivo", com contorno grosso, sorriso de canto e sobrancelha franzida. É o registro "com atitude". Uma linha de sobrancelha inclinada já dá ameaça e confiança.
4. **Emoji 🦞**: o mascote em forma de texto, que dá para digitar em qualquer lugar (CLI, GitHub, Discord, docs).

### 2.2 Silhueta e escala
O favicon de 32 px lê bem: bolota vermelha, duas garras laterais e antenas. O pixel lobster de 16×16 foi feito para escala pequena.

### 2.3 Personalidade
A personalidade está mais nas **palavras e na lore** do que no desenho: "EXFOLIATE! EXFOLIATE!" (paródia do "EXTERMINATE!" dos Daleks), "The claw is the law", "Claw abiding citizens", a muda de casca. A página oficial de lore conta que o próprio bot gerou mais de 20 ícones com IA ("cursed lobsters"), incluindo um com **rosto de homem num corpo de lagosta**, que virou meme. O mascote final é um vetor de 3 formas.

### 2.4 Como vive no produto
- **CLI:** um banner em todo comando, `🦞 OpenClaw 2026.x (sha)` com uma frase que muda (ex.: "Gateway online—please keep hands, feet, and appendages inside the shell at all times."). Existe uma "paleta lagosta" para toda a saída do terminal: `accent #FF5A2D`, `accentBright #FF7A3D`, `accentDim #D14A22`, `info #FF8A5B`, `success #2FBF71`, `warn #FFB020`, `error #E23D2D`, `muted #8B7F77` (`src/terminal/palette.ts`).
- **Site:** o mascote pequeno (72 px) no centro do hero, com **garras em ASCII** gigantes atrás (arte com `.:-=+x#@`) na cor da marca.
- **README:** banner com o mascote, o nome e "EXFOLIATE! EXFOLIATE!".
- **GitHub:** a descrição termina com "The lobster way. 🦞", e os tópicos incluem `crustacean` e `molty`.
- **Alerta:** o banner em todo comando cansa. Um post da comunidade se queixa de que a piada "fica irritante" com a repetição e ensina a desligar com `OPENCLAW_HIDE_BANNER=1`.

### 2.5 Relação com a marca
O mascote **é** o nome (Claw, garra). O ícone, o favicon e o mascote são a mesma figura.

### 2.6 Por que agrada
A lore, as piadas, o meme das tentativas malditas e um emoji que vira identidade da comunidade.

**Lição:** a figura pode ser trivial se a voz for forte. Mas a repetição sem variação vira ruído.

Fontes: [README](https://github.com/openclaw/openclaw), [openclaw.ai](https://openclaw.ai), [Lore oficial](https://docs.openclaw.ai/start/lore), [docs da CLI (paleta)](https://huggingface.co/Darochin/openskynet/blob/main/docs/cli/index.md), [post sobre o banner](https://manifest.build/blog/shut-up-openclaw/), [DEV: a troca de nomes](https://dev.to/jordanolsen/openclaw-rebrand-clawdbot-to-moltbot-to-openclaw-explained-522m).

---

## 3. Claude Code: Clawd (escrito "Claw'd")

**O que é:** uma criaturinha laranja, larga e chata, de pixel, com duas fendas no lugar dos olhos, dois tocos de braço e quatro perninhas. Lembra um caranguejo. Aparece na tela de boas-vindas do Claude Code. O nome junta "Claw" (garra) e "Claude".

### 3.1 Construção visual (confirmada no código)
Existem duas versões oficiais do mesmo desenho:

1. **No terminal: caracteres de bloco em quadrantes.** São Unicode `▐ ▛ █ ▜ ▌ ▝ ▘ ▗ ▖ ▟ ▙ ▀ ▄ ▂`, num espaço de **9 colunas × 3 linhas** de célula. Cada célula tem 2×2 subpixels, então o grid real é de cerca de 18×6. Um exemplo da era v2 é ` ▐▛███▜▌` / `▝▜█████▛▘` / `  ▘▘ ▝▝`.
   - **Os olhos são espaço negativo.** O caractere `▛` é um bloco cheio sem o quadrante de baixo à direita, e esse buraco deixa o fundo aparecer. O olho é o fundo, não um desenho.
   - **Cores** (tokens do tema, no binário): `clawd_body: rgb(215,119,87)` = **`#D77757`** e `clawd_background: rgb(0,0,0)`. Sem cor verdadeira, cai para `ansi:redBright` e `ansi:black`. Há uma versão alternativa para o Apple Terminal.
2. **Pixel art em SVG** (cena "Clawd stirs a steaming pot", usada num painel do app): **grid de 8 px**, `shape-rendering="crispEdges"`. O corpo tem **13×8 células**, os braços têm 2×2 células, as pernas 1×2 células (2 pares) e os olhos são **fendas verticais de 1×2 células** em `#141414`. O personagem usa **2 cores**. O resto da cena (panela, fogo, vapor) usa cores próprias, também chapadas.

É simples o bastante para desenhar de memória: um retângulo, duas fendas, quatro pernas e dois tocos.

### 3.2 Poses e animação (lidas no código)
- **Poses:** `default`, `arms-up`, `look-left`, `look-right`.
- **Olhos:** `open`, `left`, `right`, `closed` (pálpebra `▂`) e `wink`. Mudar só os olhos já cria olhar, piscada e piscadela.
- **Braços:** `down`, `up`, `one-up`. **Pés:** `both`, `left`, `right`.
- **Giro de 360°** feito só de caracteres, em 14 ângulos: `right-12, right-30, right-55, right-75, edge, back-105, back-125, back-150, back, left-75, left-55, left-30, left-12`.
- **Animações de entrada:** uma é sorteada **uma vez a cada versão nova** (`lastClawdEntranceVersion`): `skip, jump, look, spin, peekaboo, drop, waddle, peek, wink, boop, tap, sneeze, turn, coin-hop`. Atualizar o app vira uma pequena surpresa.
- O componente aceita `pose`, `bounceOffset` (pulo de 1 linha), `x` (andar), `poof`, `shadow`, `isPlaying` e `onClick`. Dá para clicar nele ("boop").
- **Spinner do "pensando":** `· ✢ ✳ ✶ ✻ ✽`, a faísca/asterisco da marca Claude crescendo, junto com verbos bobos que mudam: "Lollygagging…", "Moonwalking…", "Marinating…", "Noodling…". O logo anima; o mascote vive.

### 3.3 Silhueta e escala
Ocupa 9 caracteres por 3 linhas (cerca de 16 a 20 px de altura num terminal comum) e é inconfundível. O retângulo largo com pernas é uma silhueta única. **O Clawd não é o ícone do app:** o ícone do Claude Code é a marca laranja da Claude.

### 3.4 Personalidade
Curioso (olha para os lados), brincalhão (espirra, se esconde, pula moeda) e "levemente desequilibrado" (Stark Insider). Tudo isso com duas fendas e timing. Não tem boca.

### 3.5 Como vive no produto e na comunidade
- **Produto:** banner de boas-vindas (ao lado da versão, do modelo e da pasta), animação de entrada a cada versão, cena de cozinhar em painel do app, spinner com verbos.
- **Comunidade:** statusline em que o Clawd **engorda conforme o contexto enche** ("Hungry", "Slightly Chubby", "Full") e quica enquanto o Claude responde (Classmethod); PixelClaw (um Clawd que mora no Dock do Mac); Petdex (Clawd no formato de pet do Codex); VibesCC e a skill `clawd-modifier` (trocam cor e arte); pelúcia feita por fã, com loja no Etsy aberta por demanda (Reddit, maio de 2026); pedidos no GitHub por mais animações e por trocar o mascote. Também existe um token cripto "$CLAWD", sem relação oficial.

### 3.6 Relação com a marca
É separado do logo (a faísca), mas usa o laranja da marca (`#D77757`, quase o terracota da Claude) e o trocadilho com o nome. A faísca anima no spinner; o Clawd é o "habitante".

### 3.7 Por que agrada
"Clawd turns the terminal from a task space into a relationship space." e "It's like someone put a lava lamp in a server room." (Stark Insider). É comparado ao Clippy sem a bagagem corporativa e ao Tamagotchi, só que é um ajudante, não um bichinho que precisa de cuidado.

Fontes: binário local do Claude Code (strings: `clawd_body`, `CLAWD_POSES`, lista de entradas, frames do spinner), [Classmethod: statusline do Clawd](https://dev.classmethod.jp/en/articles/love-clawd-claude-code/), [Stark Insider](https://www.starkinsider.com/2025/10/clawd-ai-retro-mascot-command-line.html), [DotAI: guia do Claw'd](https://dot-ai.myuuu.co.jp/times/articles/85), [PixelClaw](https://www.producthunt.com/posts/pixelclaw), [pelúcia (Reddit, snapshot)](https://reddit.sentinel-team.org/posts/1timg1q/snapshots/2026-05-21T06%3A24%3A58.145735Z), [clawd-modifier](https://www.skills.sh/openclaw/skills/clawd-modifier), [pedido para trocar o mascote](https://github.com/anthropics/claude-code/issues/43834).

---

## 4. OpenAI Codex: o pet "Codex" (e os outros 7)

**O que é:** no app do Codex (desde maio de 2026) e na TUI, um **pet** flutua sobre a tela e mostra o estado do agente. O pet padrão, chamado "Codex" ("The original Codex companion"), é um **robozinho azul com cabeça de nuvem e um visor escuro onde o rosto é o prompt `>_`**, que também aparece no peito. A cabeça em nuvem com `>_` é a mesma figura do logo que a CLI desenha em braille na tela de boas-vindas.

### 4.1 Construção visual
- **Meio:** visual de pixel art ("chunky"), mas tecnicamente é ilustração com sombreamento suave. O primeiro quadro tem mais de 8 mil cores únicas, porque o pipeline usa geração de imagem (a skill `hatch-pet` usa `$imagegen`). Cores dominantes: corpo `#537EF1`, realce `#76A3F9`, visor `#223170` e glifos ciano.
- **Formato:** spritesheet de **1536×1872 = 8 colunas × 9 linhas de células de 192×208 px** (`codex-rs/tui/src/pets/catalog.rs`).
- **O rosto é tipografia do produto.** `>_` é o normal, `_<` quando anda para a esquerda, `^^` feliz, `UU` olhos fechados, `||` ou `''` esperando, `><` ou `xx` falhou. No estado "trabalhando" ele segura um laptop minúsculo.

### 4.2 Estados e animação (do código)
| Estado | Quadros | ms por quadro |
|---|---|---|
| idle | 6 | 1680, 660, 660, 840, 840, 1920 (lento: respira e pisca) |
| running-right / running-left | 8 | 120 |
| waving | 4 | 140 |
| jumping | 5 | 140 |
| failed | 8 | 140 |
| waiting (precisa de você) | 6 | 150 (o último fica 260) |
| running (trabalhando) | 6 | 120 (o último fica 220) |
| review (pronto para revisar) | 6 | 150 (o último fica 280) |

O balão de status mostra Running, Needs input, Ready e Blocked. O pet aparece com `/pet`, pelo menu de comandos ou nas configurações. Na TUI ele é desenhado por protocolo de imagem (sixel/kitty).

### 4.3 Os 8 pets oficiais (mesma gramática)
Codex (nuvem `>_`), Dewey ("a tidy duck", parece uma gota), Fireball, Rocky (pedra), Seedy (broto), Stacky (pilha de três blocos com rostos), **BSOD** ("A tiny blue-screen gremlin", um monitor com rosto de tela azul) e **Null Signal** ("Quiet signal from the void", um aparelho preto escrito NULL, o mais sombrio). Todos são personagens de corpo inteiro, compactos, de cabeça grande e rosto simples, e quase todos têm uma "tela" ou plaquinha no lugar do rosto. As piadas são da cultura dev (BSOD, null, stack).

### 4.4 Regras oficiais da OpenAI para pets (skill `hatch-pet`)
São as mais relevantes deste estudo, porque descrevem por escrito o que é um mascote:
- "compact whole-body silhouette readable inside a 192x208 cell"; "consistent face, proportions, material, palette, and props across all rows"; "details large enough to read at pet size".
- Evitar: "glow, halo, aura, or soft transparent effects"; "separated smoke clouds"; "detached stars, loose sparkles"; "speed lines"; "speech bubbles"; "scenery". Os guias derivados acrescentam: "too many props, tiny labels, complex backgrounds, or realistic detail".
- Idle: "subtle breathing, a tiny blink, a slight head or body bob". Prefira mudar pose, expressão e silhueta em vez de pôr efeitos.

### 4.5 Comunidade
Uma galeria de terceiros já lista mais de 3 mil pets feitos por usuários. A maioria foge da gramática (3D, realista, anime) e perde a coerência. É o retrato do que acontece sem restrições. Reações à novidade: "We let AI write code, and it gives us emotional support pets", "proof that AI companies know programmers are lonely at 2 a.m.", e também céticos.

### 4.6 Relação com a marca
O rosto e a cabeça **são** o logo (nuvem com `>_`). Os outros pets mantêm a gramática de "tela no rosto".

Fontes: `codex-rs/tui/src/pets/catalog.rs`, `pets/model.rs` e `pets/asset_pack.rs` (CDN `persistent.oaistatic.com/codex/pets/v1`), `tui/src/onboarding/welcome.rs` e o snapshot do logo em [openai/codex](https://github.com/openai/codex); [SKILL.md do hatch-pet](https://github.com/openai/skills/blob/main/skills/.curated/hatch-pet/SKILL.md); [Hongkiat](https://www.hongkiat.com/blog/codex-pets-custom-hatch-guide/); [Penchan](https://penchan.co/en/ai/coding/codex-pets/); [Design Compass](https://designcompass.org/en/2026/05-1tp-3tea/04/openai-codex-pets/); [Engadget](https://engadget.com/2162796/openai-introduces-ai-generated-pets-for-its-codex-app); [BestHub (reações)](https://www.besthub.dev/articles/exploring-codex-s-new-pet-and-goal-commands-features-developer-reactions-and-competitive-context-4d4f9a6fe09c).

---

## 5. "Grokbot": o que provavelmente é

- **Não existe mascote oficial chamado Grokbot.** O agente de terminal da xAI (hoje SpaceXAI) chama-se **Grok Build** (binário `grok`, 2026). Ele **não tem mascote**: a tela de boas-vindas mostra o logo em braille (`assets/logo/logo05.txt`, `logo07.txt`) e o "pensando" é um spinner com "Responding…".
- Os **"companions" do Grok** (Ani, uma personagem de anime, e Rudi, um panda-vermelho, entre outros) são avatares 3D de conversa. Não são mascotes de produto, e o tom de alguns é inadequado para nós. "Grokster ($GRK)" é um token cripto não oficial. "@grok" é a conta-bot do X que as pessoas marcam nas conversas.
- **Hipótese mais provável:** confusão de nome com **Clawdbot**, o nome original do OpenClaw, cujo mascote era o **Clawd**. "Clawdbot" e "Grokbot" soam parecido, e a lista do dono já inclui o OpenClaw e o Claude Code (cujo mascote também se chama Clawd). Segunda hipótese: os companions do Grok.
- **Recomendação:** mostrar ao dono as imagens `openclaw-readme-banner-dark.png` e `claude-code-clawd-classmethod-intro.png` e perguntar qual era.

Fontes: [README do Grok Build](https://github.com/xai-org/grok-build), [Grok na Wikipédia](https://en.wikipedia.org/wiki/Grok_(chatbot)), [nota sobre o Grokster](https://www.barchart.com/story/news/31675269/grokster-grk-the-first-ai-claimed-mascot-token-launches-on-base-chain).

---

## 6. Outros mascotes que acrescentam um princípio

- **GitHub Octocat:** o [Octodex](https://octodex.github.com/) tem **163 variações** (Spidertocat, Mummytocat, Luchadortocat…). A silhueta base fica fixa e as fantasias são infinitas. É o modelo de "base + variações".
- **Go Gopher (Renée French):** o [gopherize.me](https://gopherize.me/) deixa cada pessoa montar **o próprio gopher como avatar**, a partir de um kit de partes. É o precedente direto para avatares de quem não tem foto. A licença é CC BY ([README do gopher](https://go.dev/doc/gopher/README)), o que alimenta a comunidade.
- **Duolingo Duo (contraste fora do mundo dev):** [todas as ilustrações saem de 3 formas](https://blog.duolingo.com/shape-language-duolingos-art-style/): retângulo arredondado, círculo e triângulo arredondado. "Pointy shapes are off-brand." Nos olhos, ["make sure they're geometric… No ovals!"](https://design.duolingo.com/illustration/characters). O próprio diretor de arte diz que o Duo "is basically a chicken nugget with a face". A [mudança de 2019 para formas geométricas](https://www.designweek.co.uk/issues/2-6-january-2019/duolingo-owl-receives-makeover-as-app-becomes-more-gamified) foi feita para facilitar animar e combinar. A personalidade "desequilibrada" do Duo nas redes vem do comportamento, não do desenho.
- *Conhecimento geral, não verificado nesta pesquisa:* o **Bun** usa o logo como mascote (um pãozinho com rosto); o **Wumpus**, do Discord, vive nos estados vazios ("ninguém online"); o **Gemini CLI** não tem personagem, só um wordmark ASCII com gradiente, e a Stark Insider observa que ele "conta piadas nerds" mas não tem nada parecido com o Clawd.

---

## 7. Tabela comparativa

| Mascote | Meio | Grid / cores | Onde aparece no produto | Animação |
|---|---|---|---|---|
| OpenCode (wordmark) | Pixel/blocos (SVG de retângulos; `█▀▄` na TUI) | Módulo 6 px, letra 4×5; 3 tons (`#B7B1B1`, `#F1ECEC`, sombra `#4B4646`) | Tela inicial da TUI, banners de entrada e saída, ícone do app, site | Logo parado; scanner "Knight Rider" com rastro e spinner braille no "pensando" |
| OpenClaw (Clawd/Molty) | Vetor plano de 3 formas + pixel 16×16 + emoji 🦞 + avatar com contorno grosso | Vetor: 1 gradiente vermelho + olhos escuros; pixel: 5 cores | Banner da CLI em todo comando, paleta lagosta na saída, hero do site, docs, README, comunidade | Quase nenhuma; a vida está nas frases que mudam e na lore |
| Claude Code (Clawd) | Caracteres de bloco em quadrantes no terminal; pixel art SVG em grid de 8 px no app | 9×3 células (cerca de 18×6 subpixels); 2 cores (`#D77757` + fundo/olho `#141414`) | Boas-vindas, entrada a cada versão, painel do app; spinner da marca com verbos | Poses, olhar, piscar, piscadela, giro de 14 ângulos, 14 entradas, pulo de 1 linha, clique |
| Codex (pet "Codex") | Sprite com visual de pixel art, sombreado suave (pipeline com geração de imagem) | Célula 192×208, atlas 8×9; azul `#537EF1` + visor `#223170` + glifos ciano | Overlay flutuante de status no app; TUI via sixel; tela de boas-vindas com o logo em braille | 9 estados ligados ao status (idle, running, waiting, review, failed…), 4 a 8 quadros, 120 a 150 ms; idle lento |
| Grok Build | Logo em braille (sem mascote) | Monocromático | Boas-vindas | Spinner "Responding…" |
| Octocat | Vetor plano | Base fixa, cores livres | Erros 404, docs, merch | Variações estáticas (163 no Octodex) |
| Duo | Vetor geométrico (3 formas) | Verde + poucas cores | App inteiro, notificações, redes sociais | Rig de animação; muitas expressões |

---

## 8. Princípios: o que faz um mascote (e não uma ilustração)

1. **É construído, não pintado. A especificação cabe numa tela.**
   *Evidência:* o mascote do OpenClaw tem 1,3 KB (3 formas e 4 círculos); o Clawd tem 2 cores e algumas dezenas de retângulos de 8 px; o OpenCode é um grid de módulos de 6 px. Uma ilustração depende do acaso do pincel. Um mascote se redesenha igual em qualquer lugar, à mão ou em código.

2. **Nasce da matéria do produto: o grid é o do próprio meio.**
   *Evidência:* o Clawd é feito de caracteres de quadrante (a célula do terminal); o OpenCode usa `▀▄█` e retângulos; o OpenClaw tem uma versão 16×16 e uma em ASCII no site. O mascote parece pertencer à tela, e não colado em cima dela.

3. **De 2 a 5 cores chapadas. Luz é cor, não efeito.**
   *Evidência:* Clawd 2 cores; pixel lobster 5; OpenCode 3 tons; o vetor do OpenClaw tem um único gradiente. A OpenAI proíbe por escrito "glow, halo, aura, or soft transparent effects" nos pets.

4. **Rosto mínimo: dois olhos e quase nunca boca. A expressão vem de mudar um elemento.**
   *Evidência:* o Clawd tem fendas que olham para a esquerda e a direita, fecham (`▂`) e piscam; o OpenClaw tem dois pontos; o Duo exige olhos geométricos ("No ovals!"). Nenhum dos três mascotes de dev tem boca.

5. **O rosto fala a língua do produto.**
   *Evidência:* o rosto do pet do Codex é `>_` e muda para `^^`, `xx`, `||`; o Clawd é a "Claw" de Claude; o OpenClaw é a garra do nome e o emoji 🦞; o ícone do OpenCode é a letra "o" como janelinha. O mascote parece inevitável para aquele produto.

6. **Silhueta legível de 16 a 32 px e em uma cor só.**
   *Evidência:* o favicon de 32 px do OpenClaw; o Clawd em 9 caracteres; a regra de "clear silhouettes… readable inside a 192x208 cell" do Codex; o OpenCode com três tamanhos responsivos. Se precisa de detalhe para ser reconhecido, não é mascote.

7. **É um sistema de estados ligado a eventos reais, não uma imagem.**
   *Evidência:* os 9 estados do Codex mapeados a Running, Needs input, Ready e Blocked; as poses, olhos, braços e pés do Clawd; as entradas a cada versão; os spinners do Claude Code e do OpenCode. O mascote informa algo.

8. **Movimento pequeno, por quadros e com timing.**
   *Evidência:* o idle do Codex tem 6 quadros, com 1,7 a 1,9 s nos extremos (respira e pisca); a ação usa 120 a 150 ms por quadro; o Clawd pula 1 linha e anda alguns caracteres. Nada de partículas, rastros ou fumaça.

9. **Mora em lugares funcionais, não no marketing.**
   *Evidência:* boas-vindas (Clawd, OpenCode), status flutuante (Codex), "pensando" (spinners), banner da CLI (OpenClaw), estados vazios (Wumpus). O mascote acompanha o uso real do app.

10. **A personalidade vem do comportamento e das palavras. E dose a frequência.**
    *Evidência:* "Lollygagging…", "EXFOLIATE!", espirro e "boop" do Clawd, lore da muda de casca. Mas o banner do OpenClaw em todo comando irrita a ponto de ganhar uma variável para desligar. O Clawd só faz a entrada uma vez por versão.

11. **Base fixa, variações infinitas.**
    *Evidência:* 163 Octocats; 8 pets do Codex com a mesma gramática; o Clawd cozinhando; recolorações da comunidade (VibesCC); avatares montados por partes no gopherize.me.

12. **Simples o bastante para a comunidade refazer.**
    *Evidência:* pelúcia e crochê do Clawd, PixelClaw, statusline em que ele engorda, Petdex, mais de 3 mil pets do Codex. **Se só uma IA consegue desenhar o personagem, ele não é um mascote.**

---

## 9. Por que as duas tentativas falharam

### Tentativa 1: criaturas marinhas 3D fofas, com olhos grandes e brilho
- **Fere o princípio 1:** é render, não construção. Não há uma especificação que se redesenhe igual; cada geração sai diferente.
- **Fere o 3:** volume 3D, subsurface, brilho e gradientes de luz. É o oposto de 2 a 5 cores chapadas.
- **Fere o 2:** não há grid nem relação com a matéria do app (UI escura e minimalista, estilo Linear).
- **Fere o 6:** a 24 px, olhos com reflexo e texturas viram borrão.
- **Fere o 5:** "alga e mar" ilustra o *nome* do app, não a *experiência* (voz, jogo, tela). Não tem nada da linguagem do produto no rosto.
- E é fofo e infantil, que o dono já tinha recusado.

### Tentativa 2: figuras dark-fantasy cinematográficas, encapuzadas, com olhos brilhando e fumaça
O nosso próprio prompt (`docs/brand/mascote/prompts-gemini.md`) pedia "painterly 3D finish", "volumetric haze", "smoke", "aura… strongest at the edges", "micro-detail", "splash art of a premium video game". **Cada um desses itens está na lista do que a OpenAI manda evitar em pets** (glow, halo, aura, fumaça solta, partículas, realismo, cenário).
- **Fere o 1 e o 11:** splash art é uma cena única, não um personagem reproduzível. Não dá para fazer 9 estados coerentes, nem variações, nem desenhar à mão.
- **Fere o 4:** rosto escondido por capuz ou máscara, com "a expressão pela postura". Sem dois elementos de rosto que mudam, não há como piscar, olhar ou reagir. O resultado é pose, não personagem.
- **Fere o 6:** a 24 px, uma figura escura sobre fundo escuro vira uma mancha com dois pontinhos.
- **Fere o 7 e o 8:** não há estados nem animação barata possível. Fumaça e partículas exigiriam vídeo.
- **O erro de raiz:** pedimos ao gerador uma **imagem final**. Um mascote é uma **especificação** (grid, paleta, partes, estados) da qual as imagens derivam. O próprio OpenClaw passou por isso: mais de 20 "cursed lobsters" gerados por IA, e o mascote que ficou é um vetor de 3 formas.

O desejo do dono (escuro, frio, com "aura", que um jovem gamer queira no perfil) é válido. Ele só precisa ser feito com os meios de mascote: **aura = contorno de pixels duros na cor de destaque; mistério = olhos como única luz; atitude = um corte de pálpebra inclinado**, e não fumaça e névoa.

---

## 10. Implicações para o Alga Meet

### 10.1 Meio e grid
- **Pixel art de grid fixo, criada como SVG de retângulos** (como o `pixel-lobster.svg` e o Clawd cozinhando), com `shape-rendering="crispEdges"`. Escala só por múltiplos inteiros.
- **Personagem dentro de 16×16, numa tela de 24×24.** A margem de 4 px garante que ele cabe no recorte circular do avatar. Exportar em 24, 48, 96 e 192 px. Para cenas grandes (boas-vindas, vazio), usar a mesma figura ampliada 4× ou 8×, nunca uma versão "mais detalhada".
- **Versão de 1 cor** para o tray e para usos minúsculos (a silhueta tem de funcionar sozinha).
- O ícone do app **continua sendo o logo** (as duas folhas). O mascote mora dentro do app, como o Clawd, que não é o ícone do Claude Code.

### 10.2 Paleta (máximo 4 cores, chapadas)
| Papel | Cor sugerida | Motivo |
|---|---|---|
| Corpo | grafite frio, perto de `#1E1E26` | Escuro, mas separa do fundo `#0B0B0C` |
| Contorno ou "aura" | índigo `#8B8EF7` (ou `#6163D0` em contorno fino) | A aura vira 1 px de borda dura, não brilho |
| Olhos | índigo claro ou branco frio `#F7F8F8` | A única "luz" do personagem: mistério e foco |
| Detalhe (opcional) | 1 tom intermediário | Sombra de miolo, no estilo do OpenCode |

Proibido: gradiente de luz, brilho difuso, partículas soltas, fumaça, reflexo nos olhos, rosa de bochecha, cores pastel.

### 10.3 Regras de construção
1. Um bloco de corpo com cantos de 1 px (silhueta compacta e larga, como o Clawd). Sem membros finos que somem em escala pequena.
2. **A marca no personagem:** as duas folhas finas do logo, inclinadas uma para a outra, como crista ou "orelhas" no topo da cabeça (como as antenas do OpenClaw). Isso liga o mascote ao logo (princípio 5) e dá uma silhueta única a 16 px.
3. **O rosto são dois olhos de 1×2 ou 2×1 px, sem boca.** A atitude vem de um pixel de pálpebra inclinada (o registro "com atitude" do avatar do OpenClaw), não de sorriso.
4. **O rosto fala a língua do Alga Meet (voz):** quando a pessoa fala, os olhos viram **duas barras de medidor de voz** que sobem e descem, como o `>_` do Codex.
5. Toda pose nova muda no máximo 2 elementos: olhos, crista, base ou 1 px de deslocamento.
6. **Testes obrigatórios:** desenhar de memória; silhueta de 1 cor a 16 px; recorte circular a 24 px; ver sobre `#0B0B0C` e sobre `#16161A`; o desenho mestre tem de caber num SVG de menos de 3 KB.
7. Gerador de imagem só para explorar silhuetas. O desenho mestre é feito pixel a pixel (Aseprite ou SVG) e documentado.

### 10.4 Estados e animações que o produto precisa
Os estados ficam ligados a eventos reais. As cadências seguem o Codex e o Clawd.

| Estado | Quando | Animação |
|---|---|---|
| idle | presença normal | 4 a 6 quadros, 600 a 1800 ms; piscada (olho vira `▂`) e respiração de 1 px |
| falando | voz ativa | olhos viram barras de nível, 4 quadros a 120 ms, ligados ao volume real |
| ouvindo | outra pessoa fala | olhar vira para o lado (look-left e look-right) |
| mudo | microfone desligado | olhos fechados em linha; crista abaixada |
| ensurdecido | áudio desligado | olhos fechados + 1 px de "tampa" |
| conectando / carregando | entrar na sala, reconectar | scanner: olhos varrem da esquerda para a direita (como o scanner do OpenCode), 120 ms |
| compartilhando tela | transmissão ativa | olhos viram um retângulo pequeno ("tela") |
| jogando | presença de jogo | olhos estreitos e focados, a crista inclina |
| sucesso | entrou na call, conquista | pulo de 1 a 2 px, olhos `^^`, 5 quadros a 140 ms |
| erro / desconectado | falha de rede | olhos `xx`, crista caída, 8 quadros a 140 ms |
| vazio | sala sem ninguém, lista vazia | dormindo: olhos `▂`, respiração lenta; o "z" fica *encostado* no corpo, nunca solto |
| novidade | primeira abertura depois de atualizar | 1 entrada sorteada entre 6 e 10 (pular, espiar, girar, espirrar…), **uma vez por versão**, como o Clawd |

Onde usar: login e boas-vindas, estados vazios, conectando e reconectando, erro de rede, notas de versão, conquistas. **Não** usar em todo clique nem repetir a mesma piada sempre (lição do banner do OpenClaw).

### 10.5 Avatares para quem não tem foto
Modelo Octocat + gopherize.me, com a base fixa:
- **Partes:** cor do corpo (6 a 8 tons escuros) × cor da "aura" e dos olhos (os acentos que o app já tem) × forma da crista de folhas (3 ou 4) × forma dos olhos (fenda, ponto, visor, barra) × 1 acessório (headset, boné, capuz curto, máscara de 1 linha). Ex.: 8 × 6 × 4 × 4 × 6 = **4.608 combinações**.
- **Padrão determinístico:** o avatar é gerado a partir do ID da pessoa (cada um nasce com um único), e ela pode ajustar depois, como no gopherize.me.
- **Nunca infantil:** sem boca, sem bochecha, sem olhos redondos com reflexo; silhuetas angulares, corpo escuro, um único acento. Os pets **BSOD** e **Null Signal** do Codex mostram que dá para ser sombrio dentro da gramática de mascote.
- Os acessórios podem, no futuro, conversar com os cosméticos do app, sempre como valor e sem dark patterns.

### 10.6 Voz
Frases curtas e secas, nada de fofura: no conectando, "Afinando o éter…"; no vazio, "Silêncio por aqui." Variar o texto como o spinner do Claude Code, mas com a frequência sob controle.

---

## 11. Imagens de referência salvas (só estudo local)

Pasta: `D:\PROJETOS\Alga Meet\docs\private\research\mascots\` (ignorada pelo git pela regra `docs/private/`).

| Arquivo | O que é |
|---|---|
| `openclaw-readme-banner-dark.png` | Banner oficial do README (mascote vetorial + "EXFOLIATE!") |
| `openclaw-hero-dark.png` | Mascote + wordmark, versão hero |
| `openclaw-site-mascot.svg` / `openclaw-favicon.svg` | SVG oficial do mascote (1,3 KB, mesmo arquivo do favicon) |
| `openclaw-favicon-32.png`, `openclaw-apple-touch-icon.png` | Teste de escala (32 px e 180 px) |
| `openclaw-pixel-lobster.svg` | Pixel lobster 16×16, 5 cores (docs) |
| `openclaw-pixel-lobster-16px-render.png` | Render ampliado do pixel lobster |
| `openclaw-site-hero-ascii-claws.png` | Hero do site: mascote pequeno + garras em ASCII |
| `openclaw-github-org-avatar.png` | Avatar da org no GitHub (registro "com atitude") |
| `opencode-logo-ornate-dark.svg` | Wordmark em blocos (grid de 6 px, 3 tons) |
| `opencode-social-share.png` | Card social com o wordmark e o tom de sombra |
| `opencode-apple-touch-icon-v3.png`, `opencode-favicon-96x96-v3.png` | Ícone (o "o" vazado com sombra) |
| `claude-code-clawd-classmethod-intro.png` | Banner real de boas-vindas do Claude Code v2.1 com o Clawd |
| `claude-code-clawd-statusline-bounce.gif` | Clawd de statusline feito pela comunidade (quica e engorda) |
| `claude-code-clawd-cooking-8px-grid-render.png` | Render da pixel art oficial "Clawd stirs a steaming pot" (grid de 8 px, 2 cores no personagem) |
| `claude-code-clawd-sprite-starkinsider.png` | Versão estilizada publicada pela Stark Insider (cores não oficiais) |
| `codex-pet-codex-spritesheet.webp` | Spritesheet oficial do pet Codex (CDN da OpenAI), 8×9 células |
| `codex-pet-codex-spritesheet-all-states.png` | O mesmo, em fundo escuro, para ver os 9 estados |
| `codex-pets-8-builtin-idle-frame0.png` | Os 8 pets oficiais lado a lado (primeiro quadro do idle) |
| `codex-pets-default-penchan.png`, `codex-pets-hongkiat.jpg`, `codex-pets-designcompass.jpg` | O pet Codex flutuando sobre o app |
| `codex-pets-gallery-penchan.png` | Galeria de pets da comunidade (deriva para 3D e realismo) |
| `grok-build-tui-screenshot.png` | TUI do Grok Build (sem mascote) |
