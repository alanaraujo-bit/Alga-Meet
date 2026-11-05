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

## Avatares e "Seu Eco"

- **Quem não tem foto nem GIF** aparece como um Eco.
- **O Eco escolhido:** cada pessoa monta o seu em **Configurações › Minha conta › Seu Eco**.
  - Opções: 16 cores × 6 olhos × 7 cabelos × 16 acessórios = **10.752 combinações**.
  - Cada opção é mostrada no próprio Eco, ao lado de uma prévia grande e dos tamanhos de lista.
  - Fica salvo na conta: `PATCH /users/@me { eco }`, coluna `users.eco`, migração 0015. Os amigos veem na hora (`USER_UPDATE`).
  - O servidor só aceita partes do conjunto fechado (`EcoSpecSchema` em `@alga/shared`).
- **O Eco automático** (quem não escolheu) nasce do id (`ecoFor`) e é **neutro de propósito**: sem cabelo, sem delineado e sem choker, presilha ou véu. Um sorteio não deve decidir a aparência de ninguém.
- **Versões femininas** (a partir da leva do Gemini de 2026-11-05):
  - **Cabelo** que sai do capuz em três camadas: atrás (coques, rabo de cavalo), moldura repartida em volta do visor, e na frente (trança por cima do ombro, franja).
  - **Olhos** com delineado ou em amêndoa.
  - **Acessórios:** choker, presilha de folha e véu.

**Próximos passos:** o Eco nas telas do sistema (sala vazia, conectando, erro de rede, boas-vindas), com os estados acima.
