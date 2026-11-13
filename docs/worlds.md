# Alga Worlds — uma chamada dentro de uma sala em 3D

> Como funciona, o que está verificado e o que falta. Contrato: `packages/shared/src/worlds.ts` e `worlds-catalog.ts`.
> Servidor: `apps/server/src/worlds.ts`, `routes/worlds.ts`. Desktop: `apps/desktop/src/renderer/src/features/worlds/`.

## O que é
Uma camada opcional por cima da chamada, como a Sala de Cinema e a música. A chamada continua sendo a mesma (mesma sala
do LiveKit, mesma voz, mesma transmissão de tela); o mundo só diz **onde** as pessoas estão e desenha isso em 3D.

- **Entrar e sair não mexe na voz.** O botão Mundo fica no dock da chamada. Sair do mundo, fechar o Ateliê ou o 3D falhar
  deixam a chamada exatamente como estava (o e2e compara, no servidor, o `joinedAt` da voz dos dois antes e depois de
  tudo: é o mesmo, ninguém saiu nem voltou).
- **Lugares.** Uma chamada fica em um lugar por vez:
  - **Lounge**: sala compartilhada pronta (dois cantos para sentar, mesa longa, telão), igual para todo mundo.
  - **Sala pessoal**: cada conta tem a sua, persistente, e monta do seu jeito no Ateliê. Só quem é dono leva a chamada
    para ela, e ela só fica aberta enquanto o dono está naquela chamada (se ele sai, o mundo volta ao lounge com todo
    mundo dentro).
- **Convidar para a sua sala** é ligar para a pessoa (DM, grupo ou sala de voz) e abrir a sua sala ali. Quem entra segue
  `WorldRoom.access`: todo mundo da chamada, só amigos do dono, ou só o dono. Bloqueio em qualquer sentido barra.
- **Manequim.** A figura de cada pessoa é um manequim de ateliê articulado: silhueta (2), acabamento, cor das juntas (a
  mesma paleta do Eco), roupa por partes do corpo com 16 tecidos, e peça de cabeça. Quem nunca montou um ganha um que
  nasce do id e do Eco (mesma cor; headset, boné e gorro acompanham).
- **Na sala:** andar (W A S D, Shift corre, clique no chão), sentar (E ou clique no assento), gestos (acenar, sim, não,
  dançar, cruzar os braços, telefone, brindar, apontar), reações, e a **tela da sala**, que mostra a transmissão de tela
  de alguém da chamada. "Assistir à tela" leva a câmera para a frente dela.
- **Quem fala gesticula** (o nível de voz vem do mesmo motor de mídia da chamada) e ganha um anel na cor das juntas.

## Como funciona
### Tempo real (gateway)
Uma sessão por canal de voz, em memória, que some quando a chamada esvazia. `world_*` → `WORLD_*`:
- `WORLD_STATE` (sessão e quem está dentro) e `WORLD_ROOM` (o layout mostrado) vão para **todo mundo da chamada**: quem
  está fora vê o cartão "Mundo aberto · N pessoas lá dentro".
- Posições: cada app manda a sua no máximo 12 vezes por segundo (só quando mudou); o servidor guarda a última e espalha
  o que mudou a cada 100 ms, só para quem está dentro (`WORLD_TICK`, inteiros: cm e graus). Os outros são desenhados
  160 ms no passado, entre duas posições, para não tremer.
- O servidor decide assentos (um por pessoa), limita velocidade (6 m/s), prende todo mundo dentro das paredes, limita
  gestos (5 seguidos, depois 1/s) e troca de lugar (1 a cada 5 s). Cota própria: 1200 frames por 60 s por socket.
- Nada de áudio ou vídeo passa por aqui. O data channel do LiveKit continua fechado.

### Tela da sala
O palco 3D põe um `<video>` atrás do canvas e pede ao motor de mídia o mesmo que o palco normal pede
(`media.watch` + `media.attachScreen`, ou `attachOwnScreen` para a própria transmissão). Esse vídeo vira a textura das
telas da sala, sem tone mapping. Nada no motor de mídia foi alterado. Se foi o mundo que começou a assistir, é ele que
para ao sair.

### Pacote de assets (fora do instalador)
`apps/server/assets/worlds/v1/` (33,5 MiB: 41 modelos, 13 conjuntos de textura, 3 céus, 2 corpos, 17 animações), gerado
por `tools/worlds-assets` (reprodutível; tudo CC0, créditos em `CREDITS.md` do pacote).
- O app **não** embute nada disso. Baixa na primeira vez que alguém entra num mundo, arquivo por arquivo, só o que a
  sala na frente usa; guarda no OPFS do app; a segunda visita abre offline.
- Cada arquivo está no `manifest.json` com SHA-256; só é guardado e usado depois de conferir. Caminho fora do manifesto
  nem sai para a rede.
- O servidor diz onde o pacote está (`READY.worlds.assetsUrl`): por padrão a própria API (`GET /worlds/assets/*`,
  imutável, cache de um ano); com `WORLDS_ASSETS_URL` vira um CDN sem lançar app novo.
- O chunk do motor 3D (three.js + cena, ~1,0 MB) e o do Ateliê só carregam quando abertos.

### Luz e imagem
- Três climas: hora azul (padrão), tarde, noite. Luz fria pela parede de vidro, luz quente das luminárias.
- Luz indireta aproximada uma vez por sala: a sala iluminada é fotografada do centro para um cubo e isso vira o que as
  superfícies refletem (duas rodadas). Refaz quando o layout ou o clima muda.
- O céu é uma foto equirretangular; abaixo do horizonte vira névoa (as fotos são do chão, a sala é num andar alto).
- Sombra de contato desenhada sob cada móvel e cada pessoa; sombra de verdade a partir do nível médio.

### Peso (o app continua sendo um app de chamada)
| Nível | Pixels | fps | Sombras | Acabamento | Luminárias de verdade |
|---|---|---|---|---|---|
| Leve | até 0,8× | 30 | só de contato | não | 2 |
| Equilibrada | até 1× | 60 | 1024, uma vez por layout | não | 4 |
| Alta | até 1,5× | 60 | 2048, ao vivo | oclusão, brilho, MSAA | 6 |
- **Automática** (padrão) mede os próprios quadros: desce quando perde o orçamento por 2,5 s, sobe com folga por 12 s,
  e não volta por 2 min ao nível que acabou de falhar.
- Janela sem foco (um jogo na frente): 12 fps. Janela escondida: não desenha.
- Sair do palco (outro canal, outra tela do app, o Ateliê) **desmonta o motor**: `dispose()` solta geometrias,
  texturas, alvos de renderização e devolve o contexto WebGL.

**Medido** (2026-11-13, Electron fora da tela a 1440×860, 8 figuras, nesta máquina; `window.__world.stats()` no
laboratório). Tempo de CPU é o de montar e enviar o quadro; **tempo de GPU, VRAM e fps com um jogo aberto não foram
medidos**.
| Nível | Sala inicial | Lounge |
|---|---|---|
| Leve | 146 desenhos · 0,50 M triângulos · 2,6 ms de CPU | 181 · 0,54 M · 2,7 ms |
| Equilibrada | 146 · 0,50 M · 2,8 ms | 181 · 0,54 M · 3,0 ms |
| Alta | 540 · 2,24 M · 4,6 ms | 652 · 2,56 M · 5,7 ms |

O que pesa nos triângulos: as plantas (a hera tem 176 mil) e as figuras (≈14 mil cada). A hera é a primeira candidata a
uma versão simplificada no pipeline.

### Quando o 3D falha
Pacote que não baixa, WebGL que não cria contexto, contexto perdido, erro ao montar a sala: o palco mostra "O mundo não
abriu", com "Tentar de novo" e "Voltar para a chamada". Um `ErrorBoundary` só do mundo segura erros de renderização.
Uma peça que não carrega é pulada e o resto da sala abre.

## Economia
- **De graça, para sempre:** uma sala inteira e boa (STARTER_ROOM usa só peças `base`), todos os climas, 4 acabamentos de
  manequim, 5 roupas, 16 tecidos, 5 peças de cabeça, e a tela para assistir. Um teste do catálogo garante isso.
- **Coleção Ateliê** (26 produtos): 24 à venda (R$ 5,90 a 12,90) e 2 inclusos no Plus. São `Product` do mesmo catálogo de
  cobrança (`kind: 'cosmetic'`, `world: true`, sem `cosmeticType`): mesmo checkout, mesmo webhook verificado, mesmo
  reembolso de 7 dias. **Nada aqui concede item.** Um teste garante que a lista de produtos `world` e a de SKUs pagos do
  catálogo de mundos são a mesma.
- O servidor recusa salvar sala ou manequim com SKU que a conta não tem (403). No Ateliê dá para **provar** (a peça
  aparece na sala), mas o botão vira "Comprar por R$ …" em vez de "Salvar".
- Perder o direito (reembolso, fim do Plus): a parte paga do manequim volta para a gratuita na hora; a sala guardada
  não é reescrita, as peças só deixam de aparecer (comprar de novo traz de volta).
- Ainda não dá para presentear nem pôr na lista de desejos (a revelação de presente não desenha 3D).

## Publicar
1. **API primeiro** (migração 0020: `users.world_avatar` e `world_rooms`). Em produção o Worlds nasce **desligado**:
   `WORLDS=true` liga. Sem isso, `READY` não traz `worlds` e o app não mostra nada.
2. A imagem do servidor já leva `apps/server/assets` (o pacote vai junto). Com CDN: `WORLDS_ASSETS_URL=https://…`
   (precisa aceitar `Origin: null`, que é o que o app instalado manda).
3. Desktop novo (o 0.1.17 ignora tudo isso: nunca manda `world_*` sem `READY.worlds`).
4. O catálogo de cobrança passa a listar a coleção Ateliê mesmo com `WORLDS` desligado (o 0.1.17 esconde cosméticos
   que não conhece). Se quiser segurar a venda até ligar, publique API e desktop juntos.

## Verificado
- Typecheck dos três pacotes limpo.
- Compartilhado: 76 testes (11 do catálogo e do protocolo de mundos; antes 65).
- Servidor: 361 testes em PGlite (30 de mundos e 1 de cobrança; antes 330) e os 30 de mundos também em PostgreSQL 18
  real.
- Desktop: 908 testes (36 novos; antes 872): lógica do motor (colisão, interpolação, governador de qualidade), pacote
  (hash, offline, caminho fora do manifesto), loja de estado e o que a conta tem.
- **E2E no app real, duas instâncias, API e LiveKit próprios: 12/12** (`apps/desktop/scripts/worlds-e2e.mjs`, capturas e
  `results.json` em `docs/screenshots/worlds/`): abrir o lounge com a voz conectada; entrar pelo cartão; ver o outro
  andar; reação; **tela compartilhada (1280×720) na tela da sala sem clicar em Assistir**; levar a chamada para a sala
  pessoal; sair do mundo com o mesmo `joinedAt` de voz no servidor (ninguém reconectou); pacote que não baixa → "O mundo não abriu" e chamada inteira; Ateliê
  salvando no servidor; peça da loja recusada pelo servidor (403) e liberada depois de uma compra sandbox com webhook;
  manequim salvo; desconectar solta o canvas.
- Laboratório sem conta nem API: `npx vite --config vite.worlds-lab.config.ts` → `http://localhost:5391/#worlds-lab`.
- Miniaturas: `node scripts/worlds-thumbs.mjs` (56 imagens, 410 KiB, desenhadas pelo próprio motor).

- **Build empacotado (0.1.18, 2026-11-13):** o mesmo E2E rodado contra `release/win-unpacked/Alga Meet.exe`
  (`QA_EXE=…`, API e LiveKit próprios): **12/12**. `check-package.mjs` passou; o `app.asar` leva o chunk do motor e
  nenhum modelo 3D. O instalador atualizou um 0.1.17 instalado pelo mesmo caminho do "Reiniciar e atualizar"
  (`--updated /S --force-run`) e o app abriu na 0.1.18.
- **Produção (2026-11-13):** `manifest.json` do pacote 200 com 90 arquivos, arquivo fora do manifesto 404, sala sem
  token 401 (`docs/infra/staging.md`).

Não verificado: **uma chamada de verdade com o mundo aberto em produção** (no dia da publicação o SFU de casa estava
fora do ar: `/api/v1/ready` → `livekit: fail`), GPU/VRAM/fps com um jogo aberto, e uma chamada cifrada de ponta a
ponta com o mundo aberto (o mundo não toca na mídia, mas não foi exercitado junto).

## O que falta (sem enfeite)
- **Corpos humanos realistas com roupa de verdade.** O manequim é uma escolha de direção de arte possível com assets
  CC0; cabelo e roupas modeladas pedem um artista 3D ou um pacote licenciado sobre o mesmo esqueleto (o contrato do
  avatar já separa corpo, acabamento, roupa e cabeça).
- **Texturas comprimidas na GPU (KTX2).** Hoje são WebP: na placa ocupam RGBA cheio. Mede-se e troca-se no pipeline.
- Os `.hdr` dos céus (4,7 MiB) estão no pacote e **ainda não são usados** por nenhum nível (o app nunca os baixa): a luz
  do céu hoje vem da foto e dos valores de cada clima em `engine/lighting.ts`.
- O segundo corpo ainda mostra dois painéis pequenos no peito com a cor do acabamento por baixo da roupa.
- **Não medido:** VRAM e fps com um jogo pesado aberto, GPUs integradas, sessão longa, 16 pessoas reais.
- Áudio espacial (volume por distância): fora de propósito nesta entrega, para não tocar no motor de voz.
- Presentear e lista de desejos para itens de mundo; miniatura 3D na revelação.
- Editar a sala **de dentro da chamada** (hoje o Ateliê é uma tela própria; quem está na sala vê a mudança ao salvar).
- Mais ambientes (só `loft` e `lounge`), sala pessoal em mais de um formato, coleções sazonais.
- Painel de métricas do Worlds no servidor.
