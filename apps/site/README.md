# apps/site — site do Alga Meet

Página única de apresentação e download (pt-BR). Direção visual "Índigo suave" (`docs/design/design-system.md`), marca Encosto v2 (`apps/desktop/build/brand/web/`, copiada para `src/assets/brand/`).

**v2 (2026-11-01): "Mergulho na Hora Azul".** A página é um filme de rolagem. Ela começa logo abaixo da superfície, desce até o escuro onde o grupo conversa e volta à superfície no fim. Roteiro dos momentos: `docs/site/storyboard-v2.md`. Referência de ofício: `docs/research/site-reference-heyparker.md`. A seção §7 "Evitar" desse estudo foi revogada no v2.

## Rodar

```bash
npm run dev -w apps/site          # http://localhost:3100 (porta fixa)
npm run build -w apps/site        # gera apps/site/dist (estático)
npx astro preview --port 3102     # (dentro de apps/site) serve o build para medir
```

| Script | O que faz |
|---|---|
| `node apps/site/scripts/moments.mjs <nome> <seletor> [--at=0,0.5,1] [--widths=1440,390] [--tier=a] [--url=…]` | Tira quadros de um capítulo em pontos da rolagem e grava um vídeo curto de rolagem. Saída em `docs/site/v2/` (os `.webm` ficam fora do git). Usa GPU de verdade (ANGLE/D3D11) e mede o fps. |
| `node apps/site/scripts/fps.mjs [url] [--width=1440]` | Mede o fps do nível A em cada momento, com CPU normal e 4× mais lenta (CDP). |
| `node apps/site/scripts/tier-media.mjs [url] [--only=hero,room,leve,final]` | Grava os vídeos do nível B e os quadros do nível C **a partir do próprio WebGL do nível A**. Gera `public/media/*.mp4` (H.264) e `src/assets/media/*.png`. |
| `node apps/site/scripts/game-stills.mjs [url] [t]` | Exporta do WebGL o mesmo quadro do jogo da lente em 1080p e 720p (`src/assets/game/`), para os níveis B e C. |
| `npm run lighthouse -w apps/site -- [url] [--tier=…]` | Lighthouse (celular Moto G Power + desktop) contra o build, com GPU. Grava o resumo em `docs/site/lighthouse/`. |
| `npm run shots`, `npm run shoot`, `npm run og` | Scripts do v1: capturas reais do app, capturas por seção, imagem de compartilhamento. |

Os scripts de captura precisam do dev server ou do preview no ar.

## Os momentos (nível A)

| # | Momento | O "uau" | Técnica |
|---|---|---|---|
| 1 | **Abertura · Hora Azul** | Luz azul atravessando a água, com raios, cáusticas e plâncton com profundidade de campo. As duas frondes do Encosto crescem, e a índigo se inclina até encostar na branca. O título nasce da luz, letra por letra. O cursor deixa anéis na água. | Canvas WebGL fixo atrás da página toda (`src/scripts/world/`, OGL). A água é renderizada a 0,5× e composta com pontilhado. As frondes usam a máscara exata do SVG, com relevo, curvatura e frente de crescimento. |
| 2 | **O app sobe da luz e se abre** | A janela real sobe deitada de uma poça de luz e endireita. Depois vira uma pilha isométrica explodida, com rótulos voltados para a câmera, e se fecha com um "clique" que corre pela água. | CSS 3D sobre o WebGL. As camadas recortam a **mesma** imagem, então nada é baixado a mais. Duas variáveis CSS (`--lift`, `--ex`) movem tudo. |
| 3 | **A sala** | Uma gota acende um chão líquido. Cada fala dos cinco amigos vira ondas de luz que viajam e se cruzam (na risada, todas ao mesmo tempo). A rolagem é a linha do tempo. "Ouvir a sala" toca vozes **sintetizadas no navegador**. | `src/scripts/room/`. O shader lê o envelope de fala atrasado pela distância (`t − r/c`). O som usa formantes de vogal com Web Audio, sem gravação e sem voz de IA. A conversa vem de `src/data/conversation.ts`. |
| 4 | **Sua tela, nítida** | Um jogo que **nós geramos** (planador num canal da hora azul, HUD com o grupo). Fora da lente ele aparece em 720p e dentro em 1080p, com borda refrativa. | `src/scripts/lens/`. A cena é renderizada em 1920×1080 e reduzida exatamente a 1280×720. Ela anda a 30 fps (as duas transmissões são de 30 fps), e a lente anda a 60. |
| 5 | **Leve como uma alga** | A esfera densa (808 MB, 6 processos) afunda e levanta sedimento. A bolha de vidro (230 MB), com o Encosto dentro, sobe e balança. A área de cada uma é proporcional à memória. | Ambas são desenhadas no shader da água global. Os rótulos em HTML acompanham as esferas. |
| 6 | **Fechamento** | A câmera atravessa a superfície. O horizonte da hora azul nasce, as frondes se encontram sobre ele e surge "Chama o pessoal.". O clique no download solta um anel de luz. | O mesmo shader (`uSurface`, `uHorizon`). As frondes ficam presas ao espaço reservado no HTML. |
| — | **Entre capítulos** | A água muda de profundidade e de luz por capítulo, então não há corte seco. Títulos nascem da luz e os botões são magnéticos. | `initMoods`, `initLightTitles` e `initMagnetic` em `src/scripts/motion-a.ts`. |

## Níveis (cada aparelho com o que aguenta)

A decisão roda no `<head>`, antes da primeira pintura (`Base.astro`). Depois da pintura, uma prova de quadros e de CPU pode rebaixar o A para B. `?tier=a|b|c` força um nível.

| Nível | Quando | O que vê |
|---|---|---|
| **A** espetáculo | Padrão; passou na prova | Tudo acima, em tempo real. DPR ≤ 1,75 (≤ 1,5 na sala). Cada WebGL pausa fora da tela e com a aba escondida, e faz `dispose` no `pagehide`. A sala e o jogo só nascem perto do capítulo. |
| **B** filme | `deviceMemory ≤ 2`, 4 GB com ≤ 4 núcleos, rede 3g ou falhou na prova | Os mesmos momentos em **vídeo gravado do próprio WebGL** (`public/media`, H.264, **1,2 MB no total**). Os vídeos entram só perto da tela e pausam fora dela. A lente usa as duas fotos do jogo com recorte em CSS. Sem capítulos presos. |
| **C** quadro | `prefers-reduced-motion`, economia de dados, 2g | **Quadros parados** dos mesmos momentos (AVIF/WebP). Nada se move. A lente segue o ponteiro sem animar, a conversa aparece como transcrição e o gráfico de memória fica honesto. |

Sem JS, a página fica completa e estática. O texto é sempre HTML real: título, legendas, transcrição, números e rótulos.

## Stack

- **Astro 7** (estático, CSS inline): o caminho crítico tem um módulo de 1,8 KB gz.
- **OGL 1.0.11**: WebGL mínimo, com 15 KB gz no núcleo. Os shaders são todos nossos e não há textura baixada (a água, a sala e o jogo são procedurais).
- **GSAP 3.15 + ScrollTrigger** cuidam dos capítulos presos com `position: sticky` e `scrub`.
- **Lenis 1.3** só entra com mouse ou trackpad.
- **Carga:** o nível A baixa ~64 KB gz de movimento depois da primeira pintura. O jogo da lente (6 KB gz) e o áudio só carregam quando são usados.
- **Inter Variable** num arquivo só, com `swap` e fallback métrico.

## Medições (2026-11-01, build + `astro preview`, RTX 3070)

**Lighthouse 13.6** (celular = Moto G Power emulado, 4G lento, CPU 4×), com GPU:

| Nível | Forma | Desempenho | LCP | TBT | CLS | Peso | A11y · BP · SEO |
|---|---|---|---|---|---|---|---|
| auto (A) | celular | **93** | **0,9 s** | 320 ms | **0** | 208 KiB | 100 · 100 · 100 |
| auto (A) | desktop | **100** | 0,3 s | 60 ms | **0** | 231 KiB | 100 · 100 · 100 |
| B | celular | **93** | 2,2 s | 280 ms | **0** | 361 KiB | 100 · 100 · 100 |
| B | desktop | 99 | 0,6 s | 90 ms | **0** | 310 KiB | 100 · 100 · 100 |
| C | celular | **99** | 2,1 s | 0 ms | **0** | 225 KiB | 100 · 100 · 100 |
| C | desktop | 100 | 0,5 s | 10 ms | **0** | 174 KiB | 100 · 100 · 100 |

- Os números variam ±5 entre rodadas nesta máquina, que também roda o app e o servidor.
- No nível A, o LCP é o título.
- Nos níveis B e C do celular, o LCP é a foto das frondes, que fica abaixo do título e carrega depois dele.

**fps do nível A** (`scripts/fps.mjs`, rolando cada capítulo por 3 s):

| Tela | CPU | Abertura | Explodida | Sala | Lente | Leveza | Superfície |
|---|---|---|---|---|---|---|---|
| 1440×900 | 1× | 59 | 60 | 60 | 60 | 60 | 60 |
| 1440×900 | 4× | 54 | 60 | 60 | 60 | 60 | 60 |
| 390×844 @2× | 1× | 60 | 60 | 60 | 60 | 60 | 60 |
| 390×844 @2× | 4× | 60 | 60 | 60 | 60 | 60 | 60 |

Capturas de cada momento em 1440 e 390 nos três níveis: `docs/site/v2/*.jpg`.

## Download

O botão "Baixar para Windows" aponta para o instalador da release pública mais recente:

```
https://github.com/alanaraujo-bit/Alga-Meet/releases/latest/download/AlgaMeet-Setup.exe
```

- O link fica em `src/data/links.ts`; `PUBLIC_DOWNLOAD_URL` no build sobrepõe.
- Ao lado do botão vai o aviso honesto: "Windows 10/11 · beta fechado · ainda sem assinatura digital (o Windows pode avisar 'editor desconhecido')".
- O "ver novidades" leva à página de releases.
- Se o link ficar vazio, o botão volta a abrir o aviso de beta fechado (`InviteDialog.astro`), que mostra o pedido de convite se `PUBLIC_INVITE_URL` estiver definido.

## O que ainda depende do dono

- **Assinatura digital do instalador.** Sem ela, o SmartScreen avisa. O texto ao lado do botão já diz isso.
- **Domínio.** Hospedagem já no Vercel (ver "Publicar"); falta o domínio próprio. Ao ligar o domínio, troque `PUBLIC_SITE_URL` e publique de novo.
- **Áudio de verdade (opcional).** As vozes da sala são sintetizadas. Se quiser vozes ou trilha reais, mande os arquivos com direito de uso; o roteiro é `src/data/conversation.ts`.
- **Jogo com direito de uso (opcional).** A lente usa um jogo gerado por nós. Uma gravação real com licença trocaria só a fonte da textura.
- **Plus v2 e Casa.** Preço e benefícios aparecem como "em validação" e "em breve"; falta aprovar o texto.
- **Números** (`src/data/facts.ts`): a voz de 46 ms foi medida em rede local. Quando houver a medição pela internet (SFU em São Paulo), troque o número e a nota.
- **Regravar mídias** se a cena mudar: `tier-media.mjs` e `game-stills.mjs` refazem os vídeos e as fotos dos níveis B e C a partir do WebGL atual.

## Publicar (Vercel)

No ar em https://alga-meet.vercel.app (projeto `alga-meet`, time `aionixdev`). Publicação estática, sem build no Vercel (evita instalar o monorepo lá):

```bash
PUBLIC_SITE_URL=https://alga-meet.vercel.app npm run build -w apps/site
cd apps/site && rm -rf .vercel/output && mkdir -p .vercel/output && cp -r dist .vercel/output/static && echo '{"version":3,"routes":[{"handle":"filesystem"},{"src":"^/i/[0-9A-Za-z]{1,32}/?$","dest":"/i/index.html"}]}' > .vercel/output/config.json
vercel deploy --prebuilt --prod --yes
```

**Convites (`/i/<código>`):** a rota acima manda todo link de convite para `src/pages/i/index.astro`, que lê o código do caminho, mostra quem chamou e para qual espaço (prévia pública `GET /invites/:code` da API em `PUBLIC_API_URL`, padrão: staging) e oferece "Abrir no Alga Meet" (`algameet://invite/<código>`) e o download. A API precisa aceitar a origem do site em `CORS_ORIGINS` (`https://alga-meet.vercel.app`); sem isso a página continua funcionando, só que sem o nome de quem chamou. Em `astro preview` não há a rota: use `/i/?c=<código>`.
