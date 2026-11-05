# Eco — o mascote do Alga Meet

> 2026-11-05. Direção escolhida pelo dono depois de duas tentativas recusadas: a v1 era fofa, a v2 era ilustração cinematográfica.
> Base: `docs/research/mascots/mascot-study.md`, sobre os mascotes de Claude Code, OpenClaw, Codex e OpenCode.
> Os prompts do Gemini e as referências ficam fora do git, no checkout principal (`docs/brand/mascote/prompts-gemini.md` e `ref/`).

## O personagem

**Eco** é um ser encapuzado que mora nas salas de voz.
- **Rosto:** um visor escuro com dois olhos, sem boca. Os olhos funcionam como **medidor de voz**.
- **Antenas:** as duas antenas são as **folhas do logo**.
- **Aura:** vem do contorno na cor de destaque, nunca de brilho ou fumaça.
- **Atitude:** fria e um pouco misteriosa, nunca infantil.

## O desenho mestre

Fica em `apps/desktop/src/renderer/src/ui/eco/Eco.tsx` (SVG vetorial, `viewBox 0 0 100 130`). Ele tem duas molduras:
- **`full`:** o corpo inteiro. É usado nas telas grandes: boas-vindas, sala vazia, erro.
- **`avatar`:** cabeça e ombros, com o recorte fechando conforme o tamanho diminui (`avatarBox`). Assim o rosto continua grande de 128 px até 16 px.

Regras do desenho:
- **Paleta:** corpo grafite `#1c1c23`, capuz `#25252e`, visor `#0c0c10` e uma cor de destaque. No índigo da marca, os olhos ficam brancos `#f7f8f8`.
- **Proibido:** gradiente de luz, brilho, fumaça, partículas, reflexo nos olhos e boca.
- **Estados:** mudam só os olhos, as antenas ou 1 a 4 unidades de posição. O corpo nunca muda.

## Estados (`EcoState`)

| Estado | Olhos | Antenas |
|---|---|---|
| idle | conforme o tipo (barra, fenda, ponto, linha); pisca a cada ~4,6 s dentro de `.eco-alive` | em pé |
| blink | linha fina | em pé |
| talking | duas barras de medidor, fora de compasso | em pé |
| listening | olhar para o lado | a direita dobrada para o som |
| muted | linha fina apagada | abaixadas |
| connecting | um ponto de luz varrendo o visor | em pé |
| streaming | um retângulo (tela) | em pé |
| sleeping | linhas baixas, "z" encostado | caídas |
| error | x x | caídas para os lados |
| success | ^ ^, corpo 4 unidades acima | em pé |

Movimento reduzido: nada anima, mas o estado continua visível.

## Avatares

Quem não tem foto nem GIF ganha um Eco **derivado do próprio id** (`ecoFor` em `ecoRules.ts`): a mesma pessoa tem o mesmo Eco em qualquer aparelho. A combinação é 12 cores × 4 olhos × 13 acessórios.
- **Acessórios:** nenhum, headset, boné, gorro, máscara, headset de gato, óculos, coroa, chifres, bandana, cachecol, brincos e visor rachado.
- **Cor escolhida:** se a pessoa escolheu uma cor de destaque (`accentColor`), ela substitui a cor sorteada.

**Próximos passos:**
- Camada **feminina**: cabelo saindo do capuz (trança, coque, rabo de cavalo, franja) e olhos com delineado, a partir da leva do Gemini pedida em 2026-11-05.
- **Escolher o próprio Eco** no perfil. Exige guardar a escolha no servidor.
- **O Eco no sistema:** sala vazia, conectando, erro de rede e boas-vindas, com os estados acima.
