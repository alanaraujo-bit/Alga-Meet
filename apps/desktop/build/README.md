# build/ — ícones, arte do instalador e marca v0

Tudo aqui é gerado a partir dos SVGs em `brand/` por `scripts/brand.mjs`, que usa o Chromium do próprio Electron para rasterizar, sem dependências extras:

```sh
cd apps/desktop
npx electron scripts/brand.mjs                 # regenera todos os arquivos abaixo
npx electron scripts/brand.mjs --preview x.png # + folha de revisão (todos os tamanhos, 1:1 e 8x)
```

Os arquivos gerados são versionados, então `npm run dist` nunca precisa rodar esse passo.

| Arquivo | Uso |
|---|---|
| `icon.ico` | Ícone do app, do instalador e do desinstalador. Tamanhos 16, 20, 24 e 32 vêm de `mark-small.svg`; 40, 48, 64, 128 e 256 vêm de `mark.svg`. Entradas DIB de 32 bits abaixo de 256 px e PNG em 256 px. |
| `runtime/icon.png` | 256 px. Ícone das notificações e da janela em dev. Vai para `resources/assets` (`extraResources`). |
| `runtime/tray-{idle,connected,muted}[@1.25x\|@1.5x\|@2x\|@2.5x].png` | Bandeja em 16/20/24/32/40 px. O Electron escolhe a escala do DPI atual automaticamente. |
| `installer-sidebar.bmp` | 164×314, 24 bits. Lateral das páginas de boas-vindas e conclusão (instalar e desinstalar). |
| `installer-header.bmp` | 150×57, 24 bits. Cabeçalho das páginas internas do instalador. |
| `installer.nsh` | Hooks NSIS: modo por usuário forçado, página de boas-vindas, pergunta sobre dados pessoais na desinstalação. Salvo em UTF-8 **com BOM**. |

## Marca v0

**Conceito.** Um "A" geométrico (Λ) atravessado por uma onda sonora no lugar da barra. A onda tem duas cristas e lê também como um "m": **A**lga **M**eet. É a voz passando pelo nome.

- **Tile:** quadrado arredondado em "água profunda", gradiente `#1c232b → #0b0e12` (neutro H≈230° da identidade). Leva um brilho radial teal muito baixo sob a onda e um filete interno branco a 8%.
- **Λ:** `#eef3f5`, traço redondo.
- **Onda:** acento "Bioluminescência" `#4ddcdc` (OKLCH 0.82 0.12 195; ver `docs/research/linear-design-study.md` §17.1).
- **Tamanhos pequenos (≤ 32 px, bandeja):** `mark-small.svg` simplifica o desenho. Traços mais grossos, a onda vira barra reta, o tile ocupa o quadrado inteiro. Continua legível como "A" em 16 px.
- **Bandeja:**
  - `idle` = marca pura;
  - `connected` = ponto `#4fce74` (online);
  - `muted` = ponto `#f75d59` (perigo/mudo). Vale para microfone silenciado ou áudio desativado.
  
  Os pontos ficam no canto inferior direito, com recorte transparente para destacar sobre qualquer cor de barra de tarefas.
- **Badge da barra de tarefas** (menções): desenhado em pixels no main (`src/main/badge.ts`). Círculo `#e5484d` com dígitos brancos, de 1 até "9+".
- **Instalador:**
  - lateral escura em gradiente, com arcos concêntricos teal quase invisíveis saindo do canto inferior;
  - marca, "Alga Meet" (Segoe UI Variable Display 600) e "Voz, tela e comunidades.";
  - cabeçalho branco com a marca à direita, para combinar com o cabeçalho nativo do NSIS.

Status: **v0**, provisória até um trabalho de identidade dedicado. Ao mudar a marca, edite os SVGs, regenere e revise com `--preview` em 100%, 125% e 150%.
