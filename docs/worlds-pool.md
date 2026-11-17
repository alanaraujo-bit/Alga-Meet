# Sinuca no Alga Worlds

> Como funciona, o que está verificado e o que falta. Contrato: `packages/shared/src/pool.ts` (jogo, regras, quadros)
> e `pool-physics.ts` (física). Servidor: `apps/server/src/worlds.ts` (`handlePool`). Desktop:
> `apps/desktop/src/renderer/src/features/worlds/pool/`.

## O que é
Uma mesa de sinuca dentro da sala 3D, jogável de verdade. É uma peça do catálogo (`w_mesa_sinuca`, categoria Jogos,
gratuita, 4 cores de pano): o Lounge já tem uma, e cada pessoa pode pôr uma na própria sala pelo Ateliê.

- **Pegar o taco:** chegar perto da mesa e apertar **E**, ou clicar na mesa (a figura vai até ela e pega). Sozinho é **treino livre**; quando a segunda pessoa pega o
  outro taco começa uma **partida de Bola 8** com as bolas arrumadas de novo. Os demais assistem na sala.
- **Tacar:** arrastar mira (Shift = ajuste fino; A/D ou setas também); clicar no pano mira naquele ponto; **segurar
  o botão direito (ou Espaço) e puxar** dá a força, **soltar** taca. A barra de força da tela faz o mesmo. A roda do
  mouse aproxima e afasta a câmera; **V** olha de cima (lá o taco segue o ponteiro); **Esc** larga o taco.
- **Efeito:** a bola branca no canto da tela mostra onde o taco bate. Arrastar o ponto dá efeito lateral, de avanço
  (em cima) e de recuo (embaixo). Dois cliques voltam ao centro.
- **Bola na mão:** depois de uma falta (e na saída, atrás da linha), arrastar a branca para onde quiser.
- **A linha no pano é a tacada de verdade**, simulada: vai até a primeira bola (ou um pouco além da primeira tabela)
  e mostra para onde a branca e a bola atingida saem, já com o efeito e a força escolhidos.
- **O boneco joga:** quem está na vez vai até atrás da branca, inclina sobre a mesa, apoia uma mão no pano e segura
  o taco com a outra; o braço acompanha o taco indo para trás e a tacada. Quem espera segura o taco em pé.

## Regras (Bola 8 de bar, sem cantar a jogada)
- A mesa fica **aberta** depois da saída. A primeira bola encaçapada legalmente dá o grupo a quem tacou: **lisas**
  (1 a 7) ou **listradas** (9 a 15).
- Tacada legal: a branca toca primeiro numa bola do seu grupo (qualquer uma menos a 8 com a mesa aberta; a 8 quando o
  grupo acabou) e depois alguma bola cai ou chega a uma tabela.
- **Falta** (branca na caçapa, não tocar em nada, tocar primeiro na bola errada, nada cair nem chegar à tabela): a vez
  passa com **bola na mão** em qualquer lugar.
- Encaçapar bola do próprio grupo mantém a vez.
- A **8** vence quando cai legalmente depois do grupo; **perde** quando cai antes ou numa falta. Na saída ela volta
  para o ponto.
- Depois da partida, quem ganhou dá a saída da próxima. Qualquer jogador pode arrumar as bolas de novo.
- Treino livre: só a branca na caçapa importa (bola na mão); mesa vazia é arrumada de novo.

## Física (`pool-physics.ts`)
Modelo de livro (Marlow; provas técnicas do Alciatore; Han 2005 para a tabela), em metros, mesa de 8 pés
(2,24 × 1,12 m entre as tabelas), bolas de 57,15 mm:
- bola tacada **desliza** (o atrito do pano troca giro e velocidade: é de onde vêm avanço, recuo, parada seca e a
  curva do massé) e depois **rola**; o giro lateral decai por conta própria;
- **bola contra bola:** impulso normal com restituição 0,95 mais atrito no contato (o desvio da bola atingida, o
  "throw", e a passagem de giro), com atrito que cai com a velocidade;
- **bola contra tabela:** o bico toca acima do centro; o atrito no bico faz o giro lateral mudar o ângulo de saída;
- **caçapas:** um furo atrás de bicos em ângulo (142° no canto, 104° no meio). A bola cai quando o centro passa da
  borda do furo e pode bater nos bicos antes. Largura útil medida: ~70 mm no canto a 45°, ~90 mm no meio de frente,
  ~20 mm no meio a 60° (como numa mesa real, o meio rejeita bola rasante);
- **taco:** velocidade de 0,05 a 8 m/s, ponta até 0,55 raio do centro (além disso escorregaria), elevação mínima
  calculada para o taco passar por cima da tabela atrás da branca (colada na tabela obriga a levantar o taco), e um
  pequeno desvio lateral da branca com efeito ("squirt").
- Não modelado: bola saindo do pano (salto, bola fora da mesa).

**Determinística por construção:** só `+ - * /` e `Math.sqrt` em double (arredondados exatamente pelo IEEE 754), sem
trigonometria nem aleatório, ordem de iteração fixa. A direção viaja como vetor e a elevação como seno por isso. O
mesmo código roda no servidor e em cada app e dá os mesmos números bit a bit (um teste compara, inclusive depois de
passar pelo JSON). Passo de 1 ms; dentro do passo o movimento é exato até cada evento (contato, bola começando a
rolar, bola parando).

## Tempo real
- O **servidor é dono de cada mesa**: recebe a tacada como poucos números (direção, velocidade, ponto de contato,
  elevação e, com bola na mão, onde a branca foi posta), roda a simulação, aplica as regras e manda `WORLD_POOL` com o
  estado depois da tacada **e a tacada dentro dele** (`last`). Cada app reproduz as bolas com a mesma simulação e
  mostra o estado do servidor quando elas param. Ninguém manda posição de bola.
- Custo no servidor: uma saída forte leva de 2 a 13 ms de CPU (400 saídas medidas, pior caso 11,6 ms).
- O app de quem taca começa a reproduzir na hora, sem esperar a rede. Se o servidor recusar (fora da vez, número de
  tacada velho, branca em lugar inválido), a mesa volta sozinha ao estado conhecido.
- O placar fica **uma tacada atrás** enquanto as bolas rolam, para não entregar o resultado antes.
- A mira de quem está na vez é repassada aos outros (`WORLD_POOL_AIM`, até 10 por segundo) para verem o taco mexer.
- Enquanto as bolas de uma tacada rolam o servidor recusa outra tacada e arrumar as bolas.
- Quadros `world_pool_*`: contam na cota do mundo (1200 por 60 s). Quadro malformado fecha o socket (4003).
- Quem larga o taco, sai do mundo, desliga ou cai devolve o taco; mesa sem ninguém volta a ser uma mesa arrumada.
  Trocar o mundo de lugar esquece as partidas.
- Servidor antigo: `READY.worlds.pool` ausente, o app não manda nenhum `world_pool_*`. App antigo (0.1.18) num
  servidor novo: não conhece a peça e simplesmente não desenha a mesa.

## Verificado
- Compartilhado: 19 testes novos (física: deslize e rolamento batendo com as equações, determinismo, parada seca,
  avanço, recuo, corte a 90°, tabela com e sem efeito, massé, caçapas, saída; regras da Bola 8; quadros).
- Servidor: 7 testes novos no gateway (quem pode pegar o taco, tacada jogada pelo servidor igual à simulação
  compartilhada bit a bit, relógio da tacada, mira repassada só aos outros, sair e cair, troca de lugar, quadro
  inválido).
- Desktop: 7 testes novos (loja de estado, taco, linha de mira).
- Laboratório (`#worlds-lab`, sem conta): mesa, HUD e uma partida contra um segundo jogador automático
  (`?room=lounge&pool=match`), dirigida com mouse e teclado de verdade.
- **E2E no app real, duas instâncias, API e LiveKit próprios: 7/7** (2026-11-16, `apps/desktop/scripts/pool-e2e.mjs`,
  capturas e `results.json` em `docs/screenshots/pool/`): mesa igual nas duas telas; E pega o taco (treino); a segunda
  pessoa vira partida; saída puxando o taco com o botão direito; tacada com Espaço; depois de cada tacada **as duas
  telas terminam com as bolas no mesmo lugar** (o motor escreve no canvas uma impressão digital das posições e o teste
  compara as duas); placares e vez concordam; vista de cima; Esc larga o taco e o outro segue em treino; o `joinedAt`
  da voz dos dois no servidor é o mesmo do começo ao fim.
- Suítes inteiras depois de tudo: compartilhado 99, desktop 919, servidor 371; typecheck dos três pacotes limpo.
- **Build empacotado (0.1.19, 2026-11-16):** o mesmo E2E contra `release/win-unpacked/Alga Meet.exe` (`QA_EXE=…`,
  API e LiveKit próprios): **7/7**. Publicada na 0.1.19 (`docs/STATE.md`); em produção `READY.worlds.pool` vem ligado
  junto com o Worlds. Uma partida em produção ainda não foi jogada por ninguém.

## O que falta (sem enfeite)
- **Som não foi ouvido por ninguém.** Os sons (bola, tabela, taco, caçapa) são sintetizados e tocam sem erro, mas
  o timbre e o volume foram escolhidos no papel.
- **Sensação de jogo não foi calibrada por gente jogando:** velocidade do pano, força máxima, sensibilidade da mira,
  tamanho das caçapas. A saída encaçapa pouco: alguma bola cai em 20 a 30% das saídas (0,3 bola por saída, 300 saídas
  medidas por força); um amador numa mesa real encaçapa em 40 a 50% delas.
- A pose do boneco é feita em código sobre o manequim: pernas não acompanham, a mão não fecha no taco, e quando a
  branca está longe demais de qualquer borda as mãos não alcançam o taco.
- Só Bola 8. Sinuca brasileira (regra das 7 coloridas), bola 9 e fila de quem joga com o vencedor não existem.
- Dois jogadores por mesa. Sem placar de partidas, sem histórico.
- Sem tacada cantada, sem salto, sem controle manual de elevação do taco (o massé existe na física, não na tela).
- A luminária da mesa passa do teto para cima em salas baixas (some na parede do teto, não aparece por dentro).
