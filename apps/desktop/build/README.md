# build/ — ícones, arte do instalador e marca v1

Tudo aqui é gerado a partir dos SVGs em `brand/` por `scripts/brand.mjs`, que usa o Chromium do próprio Electron para rasterizar, sem dependências extras:

```sh
cd apps/desktop
npx electron scripts/brand.mjs                 # regenera todos os arquivos abaixo
npx electron scripts/brand.mjs --preview x.png # + folha de revisão (todos os tamanhos, 1:1 e 8x, barra escura e clara)
```

Os arquivos gerados são versionados, então `npm run dist` nunca precisa rodar esse passo.

| Arquivo | Uso |
|---|---|
| `icon.ico` | Ícone do app, do instalador e do desinstalador. 16 e 32 vêm de `mark-16.svg`, 20 de `mark-20.svg`, 24 de `mark-24.svg`; 40, 48, 64, 128 e 256 vêm de `mark.svg`. Entradas DIB de 32 bits abaixo de 256 px e PNG em 256 px. |
| `runtime/icon.png` | 256 px. Ícone das notificações e da janela em dev. Vai para `resources/assets` (`extraResources`). |
| `runtime/tray-{idle,connected,muted}[@1.25x\|@1.5x\|@2x\|@2.5x].png` | Bandeja em 16/20/24/32/40 px. O Electron escolhe a escala do DPI atual automaticamente. |
| `installer-sidebar.bmp` | 164×314, 24 bits. Lateral das páginas de boas-vindas e conclusão (instalar e desinstalar). |
| `installer-header.bmp` | 150×57, 24 bits. Cabeçalho das páginas internas do instalador. |
| `installer.nsh` | Hooks NSIS: modo por usuário forçado, página de boas-vindas, pergunta sobre dados pessoais na desinstalação. Salvo em UTF-8 **com BOM**. |

## Marca v1: as frondes

**Conceito.** Três barras de voz, que também são três frondes de alga crescendo de um eixo comum. É o mesmo glifo que, dentro do app, mostra quem está falando (`Fronds`). Parado, ele é o logo. Em voz, as barras seguem o envelope de quem fala. A marca é a própria voz, uma só em todos os lugares: barra de tarefas, bandeja, instalador, notificação, title bar, login e splash.

**Geometria (uma só).** Num módulo `u`:

- barras de `u` de largura, com `u` de intervalo, pontas totalmente redondas;
- alturas `3u / 5u / 3u` (proporção 3/5/3), centradas no mesmo eixo horizontal;
- o grupo forma um quadrado de `5u × 5u`.

As laterais com 3/5 da central dão um contorno estável, legível como "voz" em 16 px e simétrico para conviver com o ponto de estado da bandeja.

| Onde | `u` | Grupo | Observação |
|---|---|---|---|
| Ícone 16 px (`mark-16.svg`) | 2 px | 10 × 10 em x 3–13 | Barras de 2 px com 2 px de intervalo, alturas 6/10/6. Tudo em pixel inteiro. |
| Ícone 32 px | 4 px | 20 × 20 | `mark-16.svg` em 2x. |
| Ícone 20 px (`mark-20.svg`) | 3 px, intervalo 2 | 13 × 13 | 1:1 não cabe em pixel inteiro a 20 px. Grupo meio pixel à esquerda (margens 3/4) para as bordas verticais ficarem nítidas. Alturas 7,8/13. |
| Ícone 24 px (`mark-24.svg`) | 3 px | 15 × 15 | A geometria exata (9/15/9). Grupo ímpar num quadro par: meio pixel à esquerda (margens 4/5). |
| Ícone 40 px e acima (`mark.svg`, grade 256) | 28 | 140 × 140, centrado | 58 % do tile. |
| App: `LogoMark` e `Fronds` | `max(2, round(tamanho / 7))` px | `5u`, centrado | 14 px: `u = 2`, as mesmas barras do ícone de 16. 28 px: `u = 4`. 44 px: `u = 6`. |

Só as bordas verticais precisam de pixel inteiro. As pontas são redondas e sempre suavizadas, então as alturas não precisam de ajuste. Ao mexer na marca, mantenha `u` inteiro em cada master. Os masters pequenos só são escalados por fator inteiro (32 = 16 × 2, 40 = 20 × 2).

**Cores.**

- **Barras:** acento "Bioluminescência" `#4ddcdc` (OKLCH 0.82 0.12 195; ver `docs/research/linear-design-study.md` §17.1). No app, `var(--accent)`, ou `currentColor` com `mono`.
- **Tile:** quadrado arredondado em "água profunda", gradiente vertical `#1c232b → #0b0e12` (neutro H≈230° da identidade).
  - Em 40 px e acima, o tile tem 8/256 de respiro, raio 56/256, um brilho radial teal (`#21c9ca` a 26 % no centro) sob as barras e um filete interno branco a 8 %.
  - Em 16, 20 e 24 px, o tile ocupa o quadrado inteiro, sem brilho nem filete. O gradiente sobe um pouco (`#1e252d → #0e1115`) para a borda aparecer na barra de tarefas escura.
- **Barra de tarefas:** na escura, as barras teal leem sozinhas e o tile quase some. Na clara, o tile escuro dá o contraste.

**Bandeja.** `tray.svg` recebe o master do tamanho e soma o estado:

- `idle` = marca pura;
- `connected` = ponto `#4fce74` (online);
- `muted` = ponto `#f75d59` (perigo/mudo). Vale para microfone silenciado ou áudio desativado.

O ponto fica no canto inferior direito, centro (224, 224) e raio 32 na grade 256. Um anel transparente de raio 44 é recortado do tile para destacar o ponto sobre qualquer cor de barra de tarefas. Em 16 px, o ponto tem 4 px e ocupa o canto 4 × 4. Sobra uma linha de pixel inteira entre ele e a barra da direita, e o mesmo vale em 20, 24, 32 e 40 px. O ponto nunca encosta nas barras.

**Badge da barra de tarefas** (menções): desenhado em pixels no main (`src/main/badge.ts`). Círculo `--danger` `#f75d59` com dígitos brancos, de 1 até "9+". Pendente: o main ainda pinta `#e5484d`.

**Instalador.**

- Lateral: gradiente escuro, com arcos concêntricos teal quase invisíveis saindo do canto inferior, como a voz se espalhando. Leva a marca em 48 px, "Alga Meet" (Segoe UI Variable Display 600) e "Voz, tela e comunidades.".
- Cabeçalho: branco, com a marca à direita, para combinar com o cabeçalho nativo do NSIS.

**No app.** `LogoMark` (`src/renderer/src/features/app/Logo.tsx`) renderiza o próprio `Fronds` (`src/renderer/src/ui/Fronds.tsx`), em `span`s HTML. O Chromium encaixa essas caixas no pixel do dispositivo, então as barras ficam nítidas e iguais também a 125 % e 150 %. Com `breathing`, as três barras respiram em `scaleY` 0,55 → 1 (1,6 s, atraso de 0,2 s entre elas). Parado, é exatamente a geometria acima.

Status: **v1**. Ao mudar a marca, edite os SVGs, regenere e revise com `--preview` em 8x, nas barras de tarefas escura e clara, e no app em 100 %, 125 % e 150 %.
