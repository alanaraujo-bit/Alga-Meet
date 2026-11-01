# Coleção 01 "Hora Azul" — os 28 itens como estão no app

> Direção de arte: `docs/business/growth-plan.md` §3 (luz das 11 h, filetes de 0,5–1 px, um gesto e depois repouso, nada de neon, bloom ou partícula contínua). Linguagem: Índigo suave (`docs/design/design-system.md`).
> Código: `apps/desktop/src/renderer/src/features/billing/` (`hora-azul.ts` registro e paleta, `engine.ts` motor de movimento, `render/` um renderizador por lugar, `Cosmetics.tsx` composição e `<Cosmetic>`).
> Capturas geradas por `apps/desktop/scripts/cosmetics-shots.mjs` a partir da galeria de desenvolvimento (`index.html#cosmetics-gallery`, só em build não empacotado), servida a um Chromium headless (nenhuma janela abre). Para ver ao vivo: `npm run dev -w apps/desktop` e abrir `#cosmetics-gallery` (ou `/sheet`, `/bench`).

## Arquivos

| Arquivo | O que mostra |
|---|---|
| `contact-sheet@1x.png`, `contact-sheet@1.25x.png` | os 28 itens em repouso, um por célula |
| `<id>@1x.png`, `<id>@1.25x.png` | o item depois do gesto (auras no meio de uma palavra), a 100 % e 125 % |
| `<id>.reduced@1x.png`, `<id>.reduced@1.25x.png` | o mesmo com movimento reduzido: o quadro de repouso (auras saltam 0/1) |
| `<id>.gif` | o gesto em tempo real (quadros do screencast do Chromium, montados com ffmpeg), para os 15 itens que se movem (sons e itens estáticos não têm) |

Decorações aparecem em 32, 40, 56, 80 e 96 px; temas e efeitos no cartão de perfil (popover de 300 px); placas no cartão e na linha da lista; auras num tile de 96 px e na faixa de 40 px; molduras numa transmissão 16:9; ícones em 96, 48, 32 e 16 px.

## Os 5 heróis, como ficaram

**HA-01 Halo de vidro** (`deco_ha_halo_vidro.gif`). Um tubo de vidro aberto entre 3 h e 6 h. O aro de 3 px (porcelana 55 % → prata 20 % → índigo claro 45 %) ganhou as duas bordas que dão volume a um tubo: a de fora pega a luz das 11 h (porcelana 90 % que some até 3 h e 6 h) e a de dentro carrega a refração (lilás 70 % juntando às 7–8 h, a cáustica). O reflexo especular de 18° entra das 8 h e para às 11 h (900 ms, out-quart), numa camada própria que gira no compositor. Em 40 px ou menos: arco sólido de 2 px em degradê, sem reflexo.
- *Crítica e iteração.* A v1 seguia a ficha ao pé da letra e lia como um anel cinza chapado: "parece barato". Faltava o que faz vidro parecer vidro, a borda acesa de um lado e a refração do outro. Com as duas bordas e o reflexo mais forte, o anel tem espessura e lê caro em 56–96 px sem gritar; em 32 px continua o item mais legível da lista.

**HA-06 Hora azul** (`effect_ha_hora_azul.gif`). Ao abrir o cartão, o crepúsculo (índigo profundo no alto, o índigo do corpo descendo, um brilho brasa-violeta na linha do horizonte de 1 px a 78 %) dá lugar à noite em 1,6 s; o horizonte desce 6 px e cai para 20 %; as 12 estrelas acendem 40 ms uma depois da outra. 2,2 s no total; o último quadro é a noite com o horizonte fraco.
- *Crítica e iteração.* Preso aos 72 px do banner, o céu virava uma faixa com pontos. Agora ele continua 44 px para dentro do cartão e se desfaz atrás do avatar e do nome (máscara), então a cena tem profundidade e o cartão inteiro fica "à noite". As estrelas ganharam três tons lilás e uma delas o brilho de quatro pontas. O momento caro é o meio do gesto: o horizonte acende brasa sobre o índigo e apaga; a brasa nunca passa de uma linha (≤ 8 % da área).

**HA-09 Crepúsculo** (`nameplate_ha_crepusculo.gif`). Degradê da esquerda (profundo 70 % → índigo 35 % → nada aos 85 %), a última luz do dia como linha brasa de 1 px sob os primeiros 40 %, um filete de topo que some no meio. No hover (e ao abrir o cartão) uma faixa de luz de 24 px atravessa uma vez em 700 ms.
- *Crítica e iteração.* No tema Porcelana o degradê escuro deixava o nome escuro sem contraste: a placa ganhou uma versão clara (lilás 55 % → índigo claro 20 %), testada a ≥ 7:1 com o texto `#1b1b1d`.

**HA-16 Respiro** (`aura_ha_respiro.gif`). Substitui o anel padrão e faz o mesmo trabalho: anel interno de 2 px em índigo claro com `min(1, fala × 2,2)` (o mesmo envelope, contraste 6:1 no tile) e um anel externo de 1 px em lilás a 5 px, mais aceso às 11 h, que respira 5 % com a voz (`fala × 1,2`). Silêncio: nada. 40 px: só o anel interno. Movimento reduzido: os dois saltam 0/1. Zero JS: tudo em CSS sobre o `--speak` que o tile já escreve.
- *Crítica.* Calmo e legível como indicador; é o anel padrão com um segundo fôlego, não um brilho. Não precisou de iteração.

**HA-24 Moldura Cinema** (`frame_ha_cinema.gif`). Com moldura, o vídeo deixa 8 px de tarja e a moldura abraça o retângulo do conteúdo (`object-fit: contain`) por fora: borda de 2 px em índigo 70 %, quatro cantoneiras em L de 12 px em porcelana 60 % a 4 px, e uma volta de luz em 1,2 s quando o primeiro quadro chega para quem assiste. É irmã do `<video>` (o vídeo fica na camada de overlay de hardware) e some em tela cheia e na janela flutuante. O selo AO VIVO não muda.
- *Crítica.* Lê "estreia" sem enfeitar a imagem: nenhum pixel de conteúdo é coberto (testado em 5 proporções de vídeo).

## Os outros 23

| Item | Como ficou | Crítica |
|---|---|---|
| HA-02 Órbita | Duas órbitas de 1 px (lilás 50 %, índigo claro 42 %) inclinadas ±18°, que passam atrás do topo da cabeça; a conta de 4 px (porcelana, contorno profundo) percorre 70° e para às 10 h. | v1 deixava fiapos de órbita entre o avatar e o ponto de presença ("cabelo solto"): agora as órbitas vivem à esquerda e por cima e terminam onde passam atrás da cabeça. |
| HA-03 Constelação | 7 estrelas de 2–3 px no arco superior esquerdo, ligadas por filetes de 0,5 px; acendem a cada 60 ms e piscam uma vez (0,6 → 1 → 0,8). A maior tem brilho de quatro pontas. Em ≤ 40 px: 5 estrelas, sem filetes. | Boa em 56–96 px; em 32 px vira pontos soltos, o que é aceitável para o preço. |
| HA-04 Fita de seda | Fita em degradê profundo → índigo → lilás das 7 h à 1 h, com a torção às 10 h (o verso um tom mais escuro), filete de brilho na borda e uma faixa de luz que corre a fita uma vez. | v1 era grossa e pesada no alto; a fita afinou (≈ 5,6 px em 80 px). |
| HA-05 Traço de grafite | Traço de lápis de largura variável (pressão 1,5 → 3 → 1,5 px) com tremor de mão, um núcleo mais claro (densidade do grafite) e a segunda passada às 2 h. | O item de entrada não parece barato: parece feito à mão. |
| HA-07 Poeira de luz | Canvas 2D: 24 grãos (porcelana 80 %, lilás 60 %) sobem com deriva senoidal por 1,8 s e assentam numa faixa que desce para a direita, como poeira num raio de luz das 11 h. Semente pelo id: a poeira de cada um é sempre a mesma. | Sem brilho difuso: discos nítidos. Assentados, os grãos ficam no banner, nunca sobre o nome. |
| HA-08 Cortina de vidro | 7 lâminas de vidro (porcelana 6–9 %, filete de topo 12 %, bisel à esquerda) giram 80° com 50 ms de atraso e revelam o banner. Na miniatura da loja, as lâminas aparecem meio giradas. | O repouso é sem lâminas (a ficha), então a miniatura precisou de uma pose própria. |
| HA-10 Vidro fosco | Porcelana 5 % com grão estático (64 px, pontos de 1 px claros e escuros, sem filtro) e filete de topo 10 %. | Discreto como pedido; no Porcelana vira grão escuro sobre o claro. |
| HA-11 Fio de luz | Placa transparente sobre uma linha de 1 px em índigo claro 50 % (que esmaece no fim); no hover, um ponto de 16 px percorre a linha. | O mais "Linear" de todos, como a ficha queria. |
| HA-12 Nanquim | Mancha de tinta à esquerda com uma poça onde o pincel pousou e a borda sangrando até 70 %. | No Porcelana a tinta vira índigo 28 % (o texto escuro continua ≥ 7:1). |
| HA-13 Noite índigo | Cartão em tinta → profundo; banner profundo com luz índigo vinda do alto à esquerda e filete de topo. Texto ≥ 12:1. | Forte, mas é a base da coleção; o anel em volta do avatar usa a cor do cartão naquela altura. |
| HA-14 Porcelana | Cartão claro (`#f4f4f6 → #e9e9ee`) com os próprios tokens de texto, borda e estado (botões, papéis e rodapé do cartão continuam legíveis), anel escuro externo. | O maior contraste de identidade da loja; placas escuras ganharam versões claras. |
| HA-15 Névoa lavanda | Lilás 18 % no alto à esquerda e índigo 22 % embaixo à direita sobre tinta. | Suave; o cartão mais bonito em repouso. |
| HA-17 Prisma | Anel de 2 px em degradê cônico índigo → lilás → porcelana 70 % → índigo, que gira +90°/s × fala e congela no silêncio (o giro vem do envelope do tile, sem rAF novo). | O trecho mais escuro (índigo) ainda faz 3,5:1 no tile. |
| HA-18 Ondas | Anel interno de 2 px + até 3 anéis de 1 px que saem a cada subida da voz acima de 0,35 (no máximo 1 a cada 180 ms), 1 → 1,25 em 600 ms. | Lê o ritmo da fala; reduzido = só o anel interno. |
| HA-19 Frondes | Anel padrão + as três frondes da marca (branco → `#9a9df9`) na pílula do nome, seguindo o envelope. | O sinal de quem apoia, sem brilho extra. |
| HA-20 Toque de vidro | Sino de vidro sintetizado: Mi5 → Si5, parciais inarmônicos (2,76×, 5,4×), 700 ms. | Prévia na galeria/loja; o tocador no evento de entrada ainda não existe (ver limites). |
| HA-21 Corda | Arpejo de Dó7M (4 notas a 70 ms) com harmônicos de corda de nylon, 900 ms. | Idem. |
| HA-22 Sopro | Ar filtrado subindo 250 ms e um sino suave em Lá5, 600 ms. | Idem. |
| HA-23 Reações Hora Azul | 8 reações em SVG de 64 px (coração de vidro, 3 bolhas, palmas com 2 faíscas, "Boa!" em Inter Display 590, olhos, fogo frio índigo, estrela de vidro, chorei de rir), sobem 40 px do tile com escala 0,9 → 1 em 1,2 s; 1 a cada 1,5 s por pessoa, 6 na tela; reduzido = selo parado 1,5 s. | As palmas são abstratas (duas pílulas e duas faíscas); as outras sete leem de primeira em 40 px. |
| HA-25 Moldura de vidro | Chanfro de 3 px fora do conteúdo (prata 4 → 10 %, borda porcelana 18 %) e o topo aceso a 25 %. | Um acabamento, não um enfeite; fica perto de um bisel de monitor, o que combina com quem transmite todo dia. |
| HA-26 Noite, HA-27 Porcelana, HA-28 Crepúsculo | A Marca v2 "Encosto" (`build/brand/mark.svg`, `mark-mono.svg`: uma alga, duas lâminas) no ladrilho do ícone do app, nas cores da coleção: Noite e Porcelana usam a marca de uma cor (o vão entre as lâminas carrega a ideia); Crepúsculo corre um degradê só, brasa no alto → índigo claro, pelas duas lâminas. | Redesenhados quando a marca mudou de três barras para o Encosto. Em 16 px o vetor fica macio: o ícone aplicado à janela e à bandeja deve usar os masters ajustados à mão (`mark-16…32.svg`), trabalho do processo principal. |

## Regras verificadas em teste (`render/render.test.ts`)

- O último quadro de toda animação é o repouso: nenhum `@keyframes` declara `to`/`100%` e nenhuma animação usa `forwards`, `both` ou `infinite` (o fim é o estilo do próprio elemento, que é o que o movimento reduzido mostra).
- Contraste ≥ 7:1 (primário) e ≥ 4,5:1 (secundário) nos três temas e nas quatro placas, sobre todas as superfícies em que aparecem.
- Nenhuma cor de estado (online, ausente, perigo, ao vivo) nem teal/ciano (OKLCH H 180–230) em `render/**` e `hora-azul.ts`.
- As decorações deixam o quadrante inferior direito vazio em 32, 40, 56, 80 e 96 px e ficam dentro da caixa de 140 %.
- A moldura nunca cruza o retângulo do vídeo (5 proporções) e cabe na tarja.
- SKU desconhecido, lugar desconhecido ou item no lugar errado são ignorados, inclusive nos lugares novos.
- Teto global: 8 gestos ao mesmo tempo; movimento reduzido não toca nenhum.

## Limites conhecidos

- **Sons:** a síntese e a prévia existem (`render/sound.ts`); o tocador no evento de entrada em voz (intervalo de 10 min, teto de 15 pessoas, silenciar por pessoa) e a conferência de −24 LUFS / −3 dBTP ainda não.
- **Ícones do app:** renderizados para a loja; aplicar à janela, à barra de tarefas e à bandeja é do processo principal (`setIcon`), fora deste pacote.
- **Chaves de "quem vê"** (auras dos outros, reações, animações de perfil) e o gatilho de economia de energia do fallback de GPU: não feitos (precisam de Configurações e do processo principal). Os outros três gatilhos (mais de 9 tiles, você transmitindo, p95 de quadro > 20 ms por 2 s) estão no motor.
- **Reações:** o ponto de encaixe no tile e o `showReaction()` existem; o transporte (quem reagiu) é do pacote D.
- **Cor do app (`appAccent`, Plus):** sem renderizador; recolore a UI inteira e pede uma rampa de tokens validada.
