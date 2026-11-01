# Desempenho da interface (lista de mensagens, bundle, partida, ocioso) — 2026-11-01

Tudo medido no **app Electron real** (build de produção, Playwright `_electron`) contra uma **API própria** (porta 4300, PGlite/uploads/outbox em `%TEMP%\alga-perf`, LiveKit apontado para uma porta morta — o stack de dev em :4000/:7880 não é tocado), perfil `perf`, janela 1320×840, monitor de **180 Hz** (quadro ideal 5,6 ms), Windows 11.

- Reproduzir: `node apps/desktop/scripts/perf-ui.mjs seed` (uma vez, ~10 min por causa do rate limit), depois `chat`, `startup`, `idle`, `shots` ou `check` (`--label=…`, `--skip-build`). Resultados brutos: `%TEMP%\alga-perf\results\<modo>-<label>.json`.
- **Antes** = lista sem virtualização e bundle sem minificar (HEAD `b864039` para bundle/partida; a lista é a mesma desde `d072cfa`). **Depois** = esta mudança, em build limpo (HEAD + só estes arquivos, sem o trabalho em andamento de outros agentes).
- Canal semeado pela API real: **10 010 mensagens** em `#geral`, 20 autores; 45 % curtas, 30 % frases, 12 % parágrafos longos, 5 % blocos de código, 4 % menções, 4 % respostas, ~1 % com 1–3 imagens (16:9, 2:3, 1:1), 3 % com reação.

## Resumo [MEDIDO]

| | Antes | Depois |
|---|---|---|
| Reabrir `#geral` com as 10 k em memória (clique → linhas pintadas) | 2 156 ms | **23 ms** |
| Abrir `#geral` a frio (inclui buscar a 1ª página) | 114 ms (63 ms após a resposta) | **72 ms** (30 ms após a resposta) |
| Página mais antiga, tempo no cliente após a resposta — primeiras 10 / com ~10 k carregadas (mediana) | 28,7 / **568 ms** | 15,0 / **19,8 ms** |
| Deslocamento da mensagem âncora quando a página chega | até 21 px (136 px quando a introdução do canal aparece) | **0 px** |
| Rolagem 40 px/quadro para baixo: fps · p95 · quadros > 25 ms | 56,9 · 33,6 ms · 70/599 | **179,9 · 5,6 ms · 0** |
| Rolagem 40 px/quadro para cima | 54,6 · 38,7 ms · 76/599 | **179,9 · 5,7 ms · 0** |
| "Arremesso" 240 px/quadro para cima | 47,5 · 38,9 ms · 85/249 | **179,1 · 5,7 ms · 0** |
| Nós no DOM com 10 k carregadas | 334 030 | **921** |
| Heap JS com 10 k carregadas (após GC) | 260 MB | **13 MB** |
| Memória privada total com 10 k carregadas (renderer) | 1 286 MB (1 053) | **354 MB (110)** |
| … depois de reabrir o canal | 1 744 MB (1 467) | **446 MB (120)** |
| Memória privada no shell, antes de abrir o chat | 241 MB | 237 MB |
| JS carregado na partida (min. kB) | 3 004 (sem minificar) | **1 333** |
| Tempo de script na thread principal até o shell (mediana, 2×5 partidas) | 76–77 ms | **66–68 ms** |
| Lançamento do Electron → shell visível (mediana, 2×5 partidas) | 566–571 ms | 570–583 ms (igual: ver §3) |

A memória total varia ±40 MB entre rodadas por causa do processo de GPU (texturas de rolagem); o número do renderer é o estável.

## 1. Lista virtualizada [MEDIDO]

Só as linhas perto da janela ficam montadas (900 px além de cada borda; um novo render só quando a rolagem consome 2/3 disso). As linhas ficam em fluxo normal entre dois espaçadores cuja altura vem **só das linhas desmontadas**; por isso uma linha montada que muda de altura (imagem, reação, edição, fonte) só exige corrigir o `scrollTop`, nunca um render — e a correção acontece antes da pintura (layout effect ou `ResizeObserver`).

- **Alturas variáveis**: estimativa por tipo (texto por largura, cabeçalho de grupo, resposta, reações, caixa da imagem pela proporção conhecida via `fitBox`/`gridRows`), trocada pela medida real (`getBoundingClientRect` ao montar, `ResizeObserver` depois).
- **Âncora**: a primeira **mensagem** visível (não o separador de dia, que muda de lugar entre páginas) + distância até o topo. Páginas antigas, o esqueleto "Carregando…", a introdução do canal e linhas acima que crescem não movem o que está na tela (0 px medidos em 200 páginas; reação acima da janela: 0,0 px).
- **Preso ao fim**, pílula "N novas mensagens" (a vista não se move quando chega mensagem de outra pessoa), ir para o fim (instantâneo se longe, suave se perto), carga antecipada a 1 000 px do topo, e carga automática quando a 1ª página não enche a tela.
- **Teclado e foco**: a mensagem mais nova montada é o ponto de Tab (tabindex roving); ↑/↓/PageUp/PageDown andam entre mensagens (montando o que for preciso), Home/End vão à mais antiga carregada/mais nova. A linha com foco e a que está em edição ficam montadas mesmo fora da janela.
- **Leitor de tela**: o rolador continua `role="log"` com o mesmo rótulo, mas `aria-live="off"` (montar linhas ao rolar não pode ser anunciado); mensagens novas de outras pessoas são anunciadas por um `role="status"` oculto ("Nome: texto"). Cada mensagem é `role="article"` com `aria-posinset` (1 = mais antiga carregada) e `aria-setsize` (−1 enquanto houver histórico antes).
- **Comportamentos mantidos**, conferidos no app real por `perf-ui.mjs check` (16 verificações): barra de ações no hover, menu de contexto, edição inline (↑ no compositor vazio), linha "Novas", salto para a resposta (monta a original fora da tela, centraliza e pisca), pílula.
- Matemática pura (somas de prefixo, busca, faixa, segmentos com linhas fixadas, âncora sob prepend e sob crescimento acima, estimativas) em `features/chat/virtual.ts`, testada em `virtual.test.ts`.

O custo antigo crescia com o histórico: cada página nova re-renderizava e re-layoutava as N linhas (568 ms com 10 k), e reabrir o canal montava 10 k `MessageItem` (2,2 s, 1,4 GB no renderer).

## 2. Bundle [MEDIDO]

| Arquivo (kB, 1 kB = 1000 B) | Antes | Depois |
|---|---|---|
| `index` (React) | 570,5 | 221,9 |
| `App` | 1 290,9 | 263,2 |
| chunk compartilhado (store, ui, motion, zod) | — | 275,1 |
| `media` (livekit-client) | 1 142,5 | 573,1 |
| **JS na partida** | **3 003,9** | **1 333,3** |
| CSS na partida | 157,1 | 107,1 |
| Sob demanda: Configurações (com Assinatura/Personalização) · Config. do espaço · ImagePicker · Lightbox | — | 35,0 · 23,8 · 12,0 · 3,6 |

- **Minificação**: o electron-vite deixa o renderer sem minificar por padrão; `build.minify: true` em `electron.vite.config.ts`.
- **Fora da primeira pintura**: Configurações (com Assinatura e Loja) montam quando o app fica ocioso (`requestIdleCallback`, para o Ctrl+, continuar valendo) ou na 1ª abertura; Configurações do espaço e o Lightbox na 1ª abertura (os stores foram para `spaceSettings/store.ts` e `chat/lightboxStore.ts` para isso). Dados de emoji: `emoji.ts` tem 5 kB de fonte e o seletor é usado em toda mensagem — não vale um chunk.
- **zod continua no renderer (~160 kB de fonte, ~55 kB min.)**: o renderer só usa constantes e tipos de `@alga/shared`, mas `api.ts` e `trust-safety.ts` misturam essas constantes (`MIN_PASSWORD_LENGTH`, `MAX_ATTACHMENTS`, `DEFAULT_MAX_ATTACHMENT_BYTES`, `MAX_AVATAR_BYTES`, `AVATAR_CONTENT_TYPES`, `REMOVED_USER_ID`) com schemas criados no topo do módulo. `treeshake.manualPureFunctions` do rolldown tira as chamadas-raiz, mas `.extend()`/`.shape`/`.optional()` sobre os schemas ficam e seguram o zod (testado, ganho ~4 kB, descartado). **Precisa de mudança em `packages/shared`**: constantes sem zod num módulo próprio (ex. `src/limits.ts`) com `"sideEffects": false`, ou um subpath `./constants`.
- **livekit-client** (~1 MB de fonte, quase todo o chunk `media`) entra na partida porque o app importa `@/media` estaticamente; carregá-lo só ao entrar numa chamada é mudança em `media/**` (fora deste escopo).

## 3. Partida a frio [MEDIDO]

5 partidas por rodada, 2 rodadas intercaladas antes/depois, perfil já logado; parede = do `electron.launch` até `nav[aria-label="Espaços"]` existir; script/tarefas = contadores do Blink (`Performance.getMetrics`) até esse momento.

| Mediana | Antes (r1 / r2) | Depois (r1 / r2) |
|---|---|---|
| Lançamento → shell | 571 / 566 ms | 583 / 570 ms |
| Navegação → shell (renderer) | 435 / 436 ms | 433 / 433 ms |
| Script na thread principal | 77 / 76 ms | 68 / 66 ms |
| Tarefas na thread principal | 150 / 148 ms | 137 / 136 ms |

O bundle menor tira ~10 ms de script, mas **o tempo até o shell não é limitado por JS**: a thread principal fica ~140 ms ocupada de ~435 ms; o resto é espera — ~150 ms do processo principal até a navegação, token pelo IPC, conexão do gateway e o `READY` (o shell só aparece com `hydrated`). Próximo ganho real: mostrar o shell a partir de um snapshot local enquanto o `READY` chega, e abrir a janela mais cedo (fora deste escopo: `store/session`, `src/main`).

## 4. Ocioso logado, sem chamada [MEDIDO]

Depois de 10 min parado em `#geral` com a janela em foco, e mais 10 min minimizada; CPU = média do último minuto somando todos os processos (`app.getAppMetrics()`), memória = privada. Build limpo (HEAD + esta mudança).

| | Privada total | Browser | GPU | Renderer | Rede | CPU (todos) |
|---|---|---|---|---|---|---|
| Em foco, 10 min | **233 MB** | 66 | 102 | 53 | 12 | 0,01 % |
| Minimizada, +10 min | **229 MB** | 66 | 98 | 53 | 11 | 0,01 % |

Dentro da meta (≤ 300 MB). O maior bloco é o processo de GPU (~100 MB), não o renderer. Acordadas/s não são reportadas pelo Electron no Windows (sempre 0).

## 5. Tamanhos de janela

Capturas em `docs/screenshots/2026-11-01-<tela>-<tamanho>-v1.png`, `--force-device-scale-factor=1.25`: `960x600` = janela mínima (960×600 DIP → 1200×750 px) e `1920x1080` = tela Full HD a 125 % (1536×864 DIP). Telas: `chat-attachments`, `billing`, `shop`, `space-settings`, `space-settings-cargos`, `space-settings-membros`.

- Chat (escopo desta mudança): sem quebras nos dois tamanhos (a lista de membros some abaixo da largura mínima dela, como antes).
- Fora do escopo, para quem cuida: iniciais do avatar ficam "P1" para "Pessoa 10…19" (`ui/Avatar` pega a inicial de cada palavra, inclusive dígitos); na Assinatura em 1920×1080 a nota "A página de pagamento de teste abre no seu navegador" quebra em duas linhas com o ícone de link solto à esquerda (`billing/Plan.tsx`).
- **Palco de chamada não capturado**: só aparece com estado de voz, que vem do LiveKit; a API de medição aponta para um LiveKit morto de propósito (não pode tocar no SFU do dono).

## Observado fora do escopo

- O trabalho **não commitado** em `media/**` + `features/voice/voice.ts` (árvore compartilhada, 2026-11-01 ~05:40) sobe `AudioService` + `VideoCaptureService` na partida: **+70 MB privados** com o app ocioso (331 MB contra 258 MB no build limpo, `perf-ui.mjs idle`). Causa: `media.setPlanPresets()` passou a chamar `start()` e `voice.ts` o chama no boot (plano do `READY`/`ENTITLEMENTS_UPDATE`); `start()` faz `enumerateDevices` (sobe a captura de vídeo) e `probeEncoder`. Guardar os presets sem ligar o motor até a primeira chamada evita isso.
