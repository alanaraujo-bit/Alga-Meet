# build/ — ícones, arte do instalador e marca v2 (Encosto)

Tudo aqui é gerado a partir dos SVGs em `brand/` por `scripts/brand.mjs`, que usa o Chromium do próprio Electron para rasterizar, sem dependências extras:

```sh
cd apps/desktop
npx electron scripts/brand.mjs                 # regenera todos os arquivos abaixo
npx electron scripts/brand.mjs --preview x.png # + folha de revisão (todos os tamanhos, 1:1 e 8x, barra escura e clara)
```

Os arquivos gerados são versionados, então `npm run dist` nunca precisa rodar esse passo.

| Arquivo | Uso |
|---|---|
| `icon.ico` | Ícone do app, do instalador e do desinstalador. 16, 20, 24 e 32 px são os mestres desenhados à mão (`mark-16/20/24/32.svg`), não reduções; 40, 48, 64, 128 e 256 vêm de `icon.svg` com `mark.svg`. Entradas DIB de 32 bits abaixo de 256 px e PNG em 256 px. |
| `runtime/icon.png` | 256 px. Ícone das notificações e da janela em dev. Vai para `resources/assets` (`extraResources`). |
| `runtime/tray-{idle,connected,muted}[@1.25x\|@1.5x\|@2x\|@2.5x].png` | Bandeja em 16/20/24/32/40 px (40 = `mark-20` em 2x). O Electron escolhe a escala do DPI atual automaticamente. |
| `runtime/tray-breathe-{1,2}[@…].png` | Quadros da respiração em voz (`src/main/tray.ts` toca `connected`, 1, 2, 1 a cada 250 ms): o ponto verde encolhe para 85 % e 70 %. A marca fica parada. |
| `installer-sidebar.bmp` | 164×314, 24 bits. Lateral das páginas de boas-vindas e conclusão (instalar e desinstalar). |
| `installer-header.bmp` | 150×57, 24 bits. Cabeçalho das páginas internas do instalador. |
| `installer.nsh` | Hooks NSIS: modo por usuário forçado, página de boas-vindas, pergunta sobre dados pessoais na desinstalação. Salvo em UTF-8 **com BOM**. |

## Marca v2: Encosto (Direção B · Índigo suave)

Substitui as três barras (as "frondes"), que liam como o ícone universal de áudio e viravam sinal de status. Conceito escolhido pelo dono em 01/11/2026 (`docs/design/brand/concepts/`, conceito A), refinado aqui. Folha: `docs/design/brand/brand-v2.png`.

**A ideia.** Uma alga, duas frondes. A alta, branca, é você; a menor, índigo, se encosta nela. O vão entre as duas é a corrente. "Alga" está no desenho, e o "Meet" aparece sem ícone de pessoa: duas presenças juntas.

**O que mudou desde o conceito A** (riscos anotados: ler como chama ou como folha "eco"; frágil em 16 px):

- Pontas arredondadas, não agulhas: some a língua de chama.
- Base estreita e barriga no meio da altura. Chama é larga embaixo.
- A índigo afinou (de 59 para cerca de 44 na grade 256) e tem ponta própria, a 72 % da altura: deixa de ser a "base azul" de uma chama branca.
- As duas balançam juntas num S, com vão constante. Sem nervura, sem cabo, sem inclinação de 45° e sem verde: não é a folha "eco".
- 16, 20, 24 e 32 px desenhados pixel a pixel.

**Teste de leitura.** Na folha `brand-v2.png`: barra de tarefas e bandeja, escura e clara, em 100/125/150 %, ao lado de ícones genéricos (navegador, chat, jogo, nuvem, rede, som) desenhados para o teste.

- Primeira versão, só reduzida: "semente partida" ou "pílula de duas cores" em 16 px; "pena" ou "duas folhas" em 30–36 px.
- Com o vão em pixel limpo e o passo do balanço: "duas lâminas, uma branca e uma índigo, encostadas". Não leu como chama, folha, barras de áudio nem pausa. O ponto de estado da bandeja não encosta no glifo.
- Continua sendo o ícone mais delicado da barra em 16 px (glifo de 10 × 14 px). Ainda vale o teste com 5 pessoas pedido no README dos conceitos.

**Construção.**

| Arquivo | O que é |
|---|---|
| `mark.svg` | Mestre vetorial, grade 256, sem fundo, para fundo escuro. Caixa do glifo 75–180 × 24–232. Fronde alta `#f7f8f8`, fronde que se encosta `#8b8ef7`. Use de 24 px para cima. |
| `mark-mono.svg` | Uma cor (`currentColor`): impressão, carimbo, alto contraste. O vão carrega a ideia. |
| `icon.svg` | Ícone do app de 40 px para cima: o quadrado quase preto (`#202128 → #0b0b0d`, raio 56/256, 8/256 de respiro, luz radial índigo a 16 %, filete branco a 9 %) com `mark.svg` em 78 % (`<!--MARK-->`). |
| `mark-16/20/24/32.svg` | Mestres de pixel, com o quadrado inteiro (gradiente `#22232a → #0f1013`, sem luz nem filete). Cada pixel é um `rect` com opacidade, e o mapa ASCII está no comentário de cada arquivo. Edite pixels; nunca reduza o vetor. |
| `lockup.svg`, `lockup-light.svg` | Assinatura horizontal, escuro e claro. Inter Display 560 em curvas (SIL OFL). A marca tem 1,6× a altura da maiúscula, o topo 30 % acima dela e a base na descendente do "g"; vão de 0,48 maiúscula. |
| `tray.svg` | Bandeja: o mestre do tamanho, um anel transparente recortado no canto (raio 44/256) e o ponto de estado (raio 32/256 em (224, 224)). |
| `web/` | SVGs para o site, com viewBox justo e sem placeholders: `mark`, `mark-light`, `mark-mono`, `icon`, `lockup`, `lockup-light`, `lockup-mono`. |

Mestres de pixel (o glifo, sem contar o quadrado):

| Tamanho | Onde | Fronde branca · vão · índigo | Passo do balanço |
|---|---|---|---|
| 16 | bandeja 100 % | 4 px + borda macia · 1 px · 3 px + borda | o vão desce 1 px para a esquerda na linha 10 |
| 20 | bandeja 125 %; 40 px em 2x | 5 · 1 · 3–4 | linha 12 |
| 24 | barra de tarefas 100 %, bandeja 150 % | 5 · 1 · 4 | linha 14 |
| 32 | bandeja 200 %; a barra a 125 % usa ele reduzido a 30 | 6 · 2 · 5 | linha 18 |

**Respiro.** Em volta do glifo, a largura da fronde branca (52/256 da caixa, cerca de 1/4 da altura do glifo). Na assinatura, uma altura de maiúscula.

**Tamanhos mínimos.** Glifo: 16 px, só com os mestres de pixel; o vetor, a partir de 24 px. Assinatura: 96 px de largura. Impressão: 6 mm (glifo) e 25 mm (assinatura).

**Cores.**

- Fundo escuro: branco `#f7f8f8` (`--text-primary`) e índigo `#8b8ef7` (`--accent`).
- Fundo claro: tinta `#0b0b0c` (`--bg-app`) e índigo `#6163d0` (`--accent-fill`, 5,0:1 no branco).
- Uma cor: `currentColor`. Em fundo de meio-tom ou foto, use uma cor.

**Não faça.**

- Não troque as cores: a fronde alta é sempre a clara.
- Não gire, não incline, não estique, não contorne, não feche o vão.
- Não ponha degradê quente, brilho ou laranja (vira chama), nem verde (vira "eco").
- Não anime a marca e não use como sinal de "em voz": dentro do app esse papel é do ponto índigo de 6 px.
- Não reduza o vetor para 16–20 px: use os mestres de pixel.

**Bandeja.** `tray.svg` recebe o mestre do tamanho e soma o estado:

- `idle` = marca pura;
- `connected` = ponto `#61c28e` (`--online`);
- `muted` = ponto `#e66e68` (`--danger`), para microfone silenciado ou áudio desativado.

Em 16 px o ponto tem 4 px, no canto 4 × 4, e não encosta no glifo. Em voz, só o ponto respira.

**Badge da barra de tarefas** (menções): desenhado em pixels no main (`src/main/badge.ts`). Círculo vermelho com dígitos brancos (na Direção B o alvo é `--danger-fill` `#c04444`), de 1 até "9+". Pendente: o main ainda pinta `#e5484d`.

**Instalador.**

- Lateral: gradiente escuro com os arcos índigo quase invisíveis, a marca em duas cores (60 px de caixa, alinhada ao texto), "Alga Meet" (Segoe UI Variable Display 600) e "Voz, tela e comunidades.".
- Cabeçalho: branco, com o ícone do app à direita, para combinar com o cabeçalho nativo do NSIS.

**No app.** `LogoMark` (`src/renderer/src/features/app/Logo.tsx`) desenha a marca parada, em SVG inline.

- Quando o tamanho cai exatamente em 16, 20, 24 ou 32 pixels do dispositivo, ele desenha o mestre de pixel. A barra de título usa 16, então pega os mestres em 100, 125, 150 e 200 %.
- Nos outros tamanhos (login 36, splash 44, portões 28), desenha o vetor.
- Os dados do componente são cópia dos mestres: ao mudar a marca, atualize os dois.
- O logo deixou de ser indicador de voz. Os `Fronds` de `src/renderer/src/ui` continuam à parte até a onda de design que troca esse sinal pelo ponto de 6 px.

Status: **v2 · Encosto**. Ao mudar a marca, edite os SVGs, regenere e revise com `--preview` em 8x, nas barras de tarefas escura e clara, e no app em 100 %, 125 % e 150 %. Antes do lançamento público, falta a busca de anterioridade no INPI (classes 9, 38 e 42).
