# Dominó no Alga Worlds

> Como funciona, o que está verificado e o que falta. Contrato: `packages/shared/src/domino.ts` (regras, quadros, o que
> cada pessoa pode ver). Servidor: `apps/server/src/worlds.ts` (`handleDomino`, `dominoSync`). Desktop:
> `apps/desktop/src/renderer/src/features/worlds/domino/`.

## O que é
Uma mesa de dominó dentro da sala 3D, jogável de verdade. É uma peça do catálogo (`w_mesa_domino`, categoria Jogos,
gratuita, 4 cores de feltro) que já vem com as quatro cadeiras e a luminária: o Lounge tem uma, entre o sofá e a
estante, e cada pessoa pode pôr uma na própria sala pelo Ateliê.

- **Sentar é entrar no jogo.** Clicar numa cadeira da mesa (ou chegar perto e apertar **E**) senta; a câmera vai para
  o seu lugar e as suas pedras ficam em pé na sua frente. Levantar (**E**, ou o botão do placar) é sair.
- **Começar:** com 2 ou mais na mesa, qualquer um que esteja sentado distribui. Cadeira vazia pode receber um **bot**
  ("Pôr um bot"), então dá para jogar sozinho ou completar a mesa.
- **Jogar:** as pedras que encaixam acendem e as outras escurecem. **Arrastar** a pedra até a ponta, ou **clicar**
  nela. Se ela serve nas duas pontas, aparecem os dois lugares: clicar num deles (Esc devolve a pedra). Pelo teclado:
  **setas** escolhem a pedra, **Enter** joga.
- **Sem cliques inúteis:** quem não tem pedra que encaixe compra do monte sozinho, pedra a pedra, até uma encaixar; sem
  monte, passa (duas batidas na mesa e um "Passo!" sobre a cabeça).
- **Câmera:** arrastar fora das pedras olha em volta da mesa, a roda aproxima e afasta, **V** olha de cima. As suas
  pedras se inclinam para ficar de frente para a câmera e são desenhadas um pouco maiores que as dos outros.
- **Quem assiste** vê a mesa, a corrente e as mãos de todos pelo verso.

## Regras (escolha do dono em 2026-11-17: "duplas quando são 4")
Duplo-seis, 28 pedras, 7 para cada. As cadeiras jogam em sentido anti-horário.
- **4 na mesa: duplas**, parceiro de frente (cadeiras 0+2 contra 1+3), sem monte. **2 ou 3: cada um por si**, com monte.
- A primeira rodada da partida é aberta por quem tem a **maior carroça**, com ela (com 2 ou 3 pode não haver carroça
  distribuída: abre a pedra mais pesada). Depois, quem ganhou a rodada abre a seguinte com a pedra que quiser.
- **Batida:** simples **1** ponto; de **carroça 2**; **lá-e-lô** (a pedra serve nas duas pontas) **3**; **cruzada**
  (carroça que serve nas duas pontas) **4**.
- **Jogo trancado** (ninguém tem pedra e não há monte): **1** ponto para o lado com menos pontos na mão; empate na
  menor contagem, ninguém pontua.
- **Fecha em 6.** A partida também recomeça quando as cadeiras ocupadas mudam entre rodadas.
- Quem **levanta no meio da rodada** deixa um bot na cadeira com as pedras que tinha; qualquer pessoa pode sentar na
  cadeira de um bot e seguir dali (inclusive quem saiu).
- Quem demora **45 s** tem a jogada feita pela mesa (a mesma que um bot faria).
- Depois da rodada a próxima é distribuída sozinha em 10 s (16 s depois de fechar a partida), ou na hora por
  "Jogar agora".
- O bot joga algo legal: prefere se livrar de carroça e de pedra pesada e deixar aberta uma ponta que ainda tem.

## Tempo real
- O **servidor é dono de cada mesa** e as mãos são segredo: `WORLD_DOMINO` leva, para cada pessoa, o jogo **como ela
  pode ver** (`dominoView`): as próprias pedras com número, as dos outros só contadas, o monte só contado. No fim da
  rodada todas as mãos vão abertas. A pedra comprada só é dita a quem comprou; a pedra que tem de abrir a rodada só a
  quem a tem. No app, uma pedra cujo número não foi dito mostra uma face em branco: não há nada de outra mão na cena.
- **Quem senta onde é quem joga**: o servidor concilia as cadeiras da mesa com os assentos da sala a cada mudança
  (`dominoSync`, chamado de `broadcast`). Sentar, levantar, sair do mundo, desligar e cair passam todos por ali.
- O que a mesa faz sozinha (jogada de bot, compra, passe, jogada de quem demorou, próxima rodada) é decidido no código
  compartilhado (`dominoAuto`, `dominoStep`) e cronometrado pelo servidor, um temporizador por mesa.
- A jogada vai como `world_domino_play` com o número de sequência do jogo (jogada repetida ou atrasada é recusada). O
  app de quem joga mostra a pedra na mesa na hora; se o servidor recusar, a mesa volta ao que o servidor tem.
- Quadros `world_domino_start`, `world_domino_bot`, `world_domino_play`: só para quem está sentado naquela mesa; contam
  na cota do mundo. Quadro malformado fecha o socket (4003).
- Sentar para o dominó larga o taco da sinuca. Trocar o mundo de lugar esquece as partidas.
- Servidor antigo: `READY.worlds.domino` ausente, o app não manda nenhum `world_domino_*`. App antigo (até 0.1.20) num
  servidor novo: não conhece a peça e não desenha a mesa (as cadeiras dela também não aparecem para ele).

## Na tela
- A corrente cresce do meio para os dois lados, carroça atravessada, e dobra antes da beira: até três fileiras por
  ponta, o bastante para as 28 pedras numa ponta só (`layout.ts`). Uma pedra nunca muda de lugar depois de posta.
- Embaralhar e distribuir são animados (as pedras trocam de número enquanto estão viradas para baixo); a pedra jogada
  voa da mão para a ponta; a comprada vem do monte.
- Sons sintetizados: pedra na mesa, embaralhar, pedra chegando na mão, batida de passe, sua vez, fim de rodada.
- Placar no topo: quem está na mesa, quantas pedras cada um tem, de quem é a vez (com o tempo que resta), pontos
  (em duplas, "Nós × Eles"), rodada e monte.
- Movimento reduzido: as pedras vão direto para o lugar.

## Verificado (2026-11-17)
- Compartilhado: 25 testes novos (cadeiras e bots, distribuição, abertura, encaixe e virada da pedra, compra e passe,
  jogo trancado, os quatro tipos de batida, duplas, fechar em 6, partida que recomeça, 360 rodadas e uma partida
  inteira jogadas pela mesa sozinha com todas as pedras conferidas, o que cada um vê, quadros, a peça no Lounge).
- Servidor: 10 testes novos no gateway (sentar é entrar, só quem está sentado manda, cada um só recebe as próprias
  pedras, jogada aceita pelo servidor, rodada inteira com bots e a seguinte, levantar no meio deixa bot e outra pessoa
  assume, fim do jogo ao sair da mesa, do mundo ou da chamada, largar o taco, troca de lugar, quadro inválido).
- Desktop: 9 testes novos (a corrente sem sobreposição, tocando a pedra anterior e dentro do feltro para centenas de
  jogos e para as 28 pedras numa ponta só; mãos, monte; a loja de estado).
- Laboratório (`#worlds-lab`, sem conta): `?room=lounge&sit=dom:0&domino=3` senta com três bots; rodadas inteiras
  jogadas por teclado, clique e arrasto de verdade; vista de cima.
- **E2E no app real, duas instâncias, API e LiveKit próprios: 7/7** (`apps/desktop/scripts/domino-e2e.mjs`, capturas e
  `results.json` em `docs/screenshots/domino/`): mesa posta; Ana senta e não consegue distribuir sozinha; Bia senta,
  Ana distribui e **cada app tem na cena exatamente 7 pedras com número**; uma rodada inteira pelo teclado com as duas
  mesas iguais a cada jogada (numa das execuções, 27 pedras na mesa e batida de lá-e-lô); "Jogar agora"; Bia levanta no
  meio e um bot assume, e de fora ela só conhece as pedras da corrente; Ana levanta e a mesa fica livre; o `joinedAt`
  da voz dos dois é o mesmo do começo ao fim.
- Suítes inteiras depois de tudo: compartilhado 124, desktop 928, servidor 393; typecheck dos três pacotes limpo.

## O que falta (sem enfeite)
- **Não está publicado.** Está na branch `feat/worlds-domino` (worktree `.claude/worktrees/release`), feita sobre a
  0.1.19; a `main` já está na 0.1.20 e a branch ainda não foi trazida para cima dela (dois arquivos em comum:
  `gateway.ts` e `socket.ts`). O E2E não rodou contra build empacotado.
- **Som não foi ouvido por ninguém**, como na sinuca: timbre e volume escolhidos no papel.
- **Sensação de jogo não foi calibrada por gente jogando:** tempo dos bots, da compra e do passe, tamanho das pedras na
  mão, posição da câmera, os 45 s de espera.
- O boneco não joga: fica sentado enquanto a pedra voa da mão dele para a mesa (sem braço esticando). O bot não tem
  boneco, só o nome sobre a cadeira. As mãos de quem senta ao lado aparecem na beira da sua vista.
- Só a regra escolhida. Não há opção de cada um por si com 4, de passar em vez de comprar, de contar pontos até 100.
- O empate no jogo trancado não vale dobrado na rodada seguinte (uma variante comum).
- Quem assiste de fora não tem placar na tela, só a mesa.
- A mesa só é "sólida" até os assentos: dá para atravessar o encosto das cadeiras ao andar em volta.
- A luminária passa do teto para cima em salas baixas, como a da sinuca.
