# Sala de Cinema — Plano 2: a experiência (igual aos mockups)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar a tela crua de engenharia (`CinemaDev.tsx`) pela experiência aprovada pelo dono — convite na call, ficha, foyer com poltronas, luzes, assistindo com interface que some, timeline social, reações, pausa, esperando alguém, intervalo, créditos/próximo episódio e canhoto — reproduzindo os mockups com a maior fidelidade possível, e deixar a branch pronta para publicar.

**Architecture:** O motor do Plano 1 fica como está (store `useCinema`, `actions.ts`, swarm, mesh, player, áudio, legendas). Esta camada é só renderer + duas extensões pequenas no servidor (mapa de calor e troca de episódio na mesma sessão) e uma no main (retomar posição, capturar o canhoto). Um "estado de tela" puro (`roomView`) deriva de `CinemaSessionView` + estado local qual tela e qual luz mostrar; cada tela é um componente que segue o mockup correspondente.

**Tech Stack:** React + zustand + CSS modules (tokens de `styles/tokens.css`), sem dependências novas; Fastify + zod no servidor; Electron `webContents.capturePage` + `clipboard` no main; vitest; Playwright dirigindo o app real para as capturas lado a lado.

**Spec:** `docs/superpowers/specs/2026-11-05-sala-de-cinema-design.md` (§7 inteiro). **Referência visual obrigatória:** `docs/design/cinema/mockups/` — `jpg/01..11-*.jpg` (aprovados pelo dono em 2026-11-05: "é desse jeito que eu quero, desse modelo"), fontes em `screens.js` + `mockups.css`. Ledger do Plano 1: `.superpowers/sdd/2026-11-05-sala-de-cinema-motor/progress.md` (decisões R1–R35).

## Global Constraints

- Worktree `D:\PROJETOS\alga-cinema`, branch `feat/sala-de-cinema`. Não tocar `features/billing/**`, `apps/server/src/billing/**`, `packages/shared/src/billing.ts`.
- **Fidelidade aos mockups é critério de aceite** [dono]: layout, hierarquia, tipografia, espaçamentos, cores (tokens), estados de luz e textos pt-BR iguais ao mockup da tela; diferença inevitável é nomeada no relatório da task com a captura lado a lado. Comparar sempre com o Linear (memória `design-direction-linear-indigo`): índigo só em estado.
- **O tema é a luz** (§7.1): níveis do entorno — `on` (foyer, intervalo), `dim` (assistindo, ~preto), `half` (pausa, +35%), `rising` (fim, acende em ~3 s). Nada de cortina, rolo de filme, pipoca, neon.
- **Luz da tela** (§7.1, call #1 revisável): campo de cor das bordas do frame ~4×/s, ≤ 12% de opacidade, desligável, desligado com `prefers-reduced-motion`; **padrão ligado**.
- Interface some depois de **2 s** sem mexer o mouse (assistindo); poltrona de quem fala acende **mesmo com a interface escondida**.
- Reações: 6 emojis de `CINEMA_REACTIONS`, sobem da poltrona e somem em **~1,6 s**; limite do servidor 1/s rajada 5.
- Contagem: 3 s, anel fino, sem números gigantes (§7.3.4); `playback.countdown` + `at` decidem quando.
- Intervalo: pausa **> 3 min** vira intervalo (cliente); voltar = `control('seek', posição atual)` (o servidor faz a espera de prontos + contagem).
- Créditos/próximo episódio: capítulo de créditos ou últimos **30 s**; "Próximo: … em 10 s · Cancelar".
- Atalhos §7.4 (Espaço, ←/→ 10 s, Shift+←/→ 60 s, F, C, A, M, ↑/↓, R, S, Esc), em fase de captura, sem disparar dentro de campos de texto.
- Acessibilidade §7.5: `prefers-reduced-motion` (luzes sem fade, reações sem subir, luz da tela desligada, contagem vira texto); tudo por teclado; `aria-live="polite"` para "Fulano pausou" etc.
- Texto de UI só em `features/cinema/strings.ts` (pt-BR); comentários de código em inglês. Título do filme e nomes são texto não confiável: nunca `innerHTML`.
- Sem dependências novas. CSS modules; tokens; motion de `ui/motion.ts`.
- Comandos: `npm test -w apps/desktop`, `npm test -w apps/server`, `npm test -w packages/shared`, `npm run typecheck`.
- Commits terminam com linha em branco + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Troca de estado no meio de uma animação** (pausa durante a contagem, alguém trava durante o intervalo, sessão acaba no foyer) → a tela segue `roomView` sem ficar presa num overlay velho; luz certa. Teste na Task 3.
2. **Filme sem capa/miniaturas/capítulos ainda** (peças não chegaram, arquivo sem capítulos) → telas mostram placeholders discretos, nunca quebram nem piscam. Teste nas Tasks 4–7.
3. **Muitas poltronas e nomes longos** (8 pessoas, nome com 32 caracteres, emoji/RTL no nome) → fileira não estoura nem sobrepõe; nomes cortados com reticências. Teste na Task 5.
4. **Janela pequena** (960×600) e **tela cheia** → layout se adapta sem cortar controles; legenda sobe com os controles. Captura na Task 11.
5. **Reações em rajada de 8 pessoas** → no máximo N animações simultâneas (fila), sem queda de FPS do vídeo. Teste na Task 6.

---

### Task 1: Servidor — mapa de calor e troca de episódio

**Files:** `packages/shared/src/cinema.ts`, `packages/shared/src/gateway.ts`, `apps/server/src/cinema.ts`, testes `packages/shared/src/cinema.test.ts`, `apps/server/test/cinema.test.ts`.

**Interfaces (Produces):**
- `CinemaSessionView.heat: number[]` — contagem de reações por balde de 10 s desde o início do filme (comprimento = ceil(durationS/10)), atualizado a cada reação (mesmo balde do resumo).
- Op `{ op: 'cinema_switch'; sessionId: string; film: CinemaFilm; startS: number }` — só quem projeta; troca o filme **na mesma sessão** (mesmas poltronas): limpa o índice de peças, reações e `heat`, volta `playback` para `{ playing:false, position:startS, reason:'buffering', seq:+1 }`, poltronas `preparing`; `CINEMA_STATE` para todos. Título limpo com o mesmo helper de `cinema_open`.

- [ ] Testes que falham: `heat` cresce no balde certo; `cinema_switch` de não-host → `forbidden`; troca mantém poltronas e zera índice; schema recusa `startS` negativo.
- [ ] Implementar; `npm test -w packages/shared`, `npm test -w apps/server`, `npm run typecheck`.
- [ ] Commit `feat(cinema): reaction heat map and next-episode switch in the same session`.

### Task 2: Main/bridge — continuar de onde parou e capturar o canhoto

**Files:** `apps/desktop/src/main/cinema/resume.ts` (+ teste), `apps/desktop/src/main/cinema/ipc.ts`, `src/shared/ipc.ts`, `src/shared/bridge.ts`, `src/preload/index.ts`.

**Interfaces (Produces):**
- `window.alga.cinema.resumeAt(fileId): Promise<number | null>` e `saveResume(fileId, positionS): void` — chave local = SHA-256 de (tamanho + mtime + primeiros 64 KiB) do arquivo, guardada em `userData/cinema-resume.json` (máx. 200 entradas, LRU); `null` se < 60 s ou > duração − 120 s.
- `window.alga.cinema.captureCard(rect: { x; y; width; height }, action: 'copy' | 'save'): Promise<boolean>` — `webContents.capturePage(rect)` do remetente; `copy` → `clipboard.writeImage`; `save` → diálogo "Salvar canhoto" (PNG). Rect validado (inteiros ≥ 0, ≤ tamanho da janela).
- `probe` passa a devolver também `resumeS: number | null`.

- [ ] Testes que falham (Node, `electron` mockado): chave estável para o mesmo arquivo e diferente se o arquivo muda; LRU de 200; limites de 60 s / duração − 120 s; rect inválido recusado.
- [ ] Implementar; testes; typecheck. Commit `feat(desktop): cinema resume position and ticket capture`.

### Task 3: Estado de tela e luzes (fundação)

**Files:** `features/cinema/room/view.ts` (+ `view.test.ts`), `features/cinema/room/CinemaRoom.tsx`, `features/cinema/room/room.module.css`, `features/cinema/room/useIdle.ts`; modificar `features/voice/CallStage.tsx` para montar `CinemaRoom` no lugar de `CinemaDev` (manter `CinemaDev` acessível só pelo painel `S` → "modo engenharia", para depuração).

**Interfaces (Produces):**

```ts
export type RoomScreen = 'card' | 'sheet' | 'foyer' | 'countdown' | 'watching' | 'paused' | 'waiting' | 'intermission' | 'credits' | 'ended'
export type Lights = 'on' | 'dim' | 'half' | 'rising'
export interface RoomView { screen: RoomScreen; lights: Lights; who: string | null; nextUpS: number | null }
export function roomView(i: { session: CinemaSessionView | null; seated: boolean; draft: boolean; ended: boolean; serverNow: number; pausedSince: number | null; durationS: number; creditsAtS: number | null; position: number }): RoomView
```

Regras (copiar do spec §7.1/§7.3): sem sessão e com rascunho → `sheet`; sessão e não sentado → `card`; `reason:'foyer'` → `foyer`/`on`; `countdown` e agora < `at` → `countdown`/`dim`; tocando → `watching`/`dim` (ou `credits`/`dim` a partir do capítulo de créditos ou `durationS − 30`); pausado `reason:'user'` → `paused`/`half` (e `intermission`/`on` se pausado há > 180 s); `waiting` → `waiting`/`half`; `host_away` → `paused`/`half` com `who` = host; `ended` → `ended`/`rising`.
`CinemaRoom` aplica a luz no entorno (variável CSS com transição de 1,2 s para `dim`, 300 ms para `half`, 3 s para `rising`; sem transição com movimento reduzido), recolhe a barra lateral no "modo sala" e renderiza a tela da vez (Tasks 4–9 preenchem). Luz da tela: canvas 16×9 amostrado do `<video>` ~4×/s, `filter: blur`, opacidade ≤ 0,12, desligável em `prefs.ambient` (persistido; padrão ligado).

- [ ] Testes que falham para cada linha da regra (incluindo Review Focus 1: pausa durante a contagem, trava durante intervalo, fim no foyer).
- [ ] Implementar; captura rápida do app (só a estrutura) para conferir que monta. Commit `feat(desktop): cinema room view model and lights`.

### Task 4: Convite na call e ficha do filme (mockups 01 e 02)

**Files:** `room/CallCard.tsx`, `room/FilmSheet.tsx` (+ css), poster helper `room/poster.ts` (lê a peça `poster` do swarm como `blob:` URL e revoga no unmount; placeholder com gradiente neutro enquanto não chega).

- Card 01: posição, tipografia e conteúdo exatamente do mockup (título, ano, duração, chip "4K HDR"/"1080p", "Ana está projetando", botão "Sentar"); botão **Cinema** no dock no mesmo estilo do mockup.
- Ficha 02: capa (frame candidato via `poster`; antes de abrir a sessão ainda não há swarm → use o `probe` + uma prévia gerada no main? **Decisão:** a ficha mostra a capa quando a primeira peça `poster` existir; antes disso, o placeholder), título editável, chips técnicos, faixas de áudio/legenda, avisos (incl. "Carlos não decodifica HEVC neste PC" a partir das poltronas `unsupported` da chamada quando houver sessão; antes de abrir, só os avisos do probe), "Continuar de 1:02:13" quando `resumeS` existir (Task 2), botão "Abrir sessão".
- [ ] Testes de componente onde houver lógica (formatação de duração/chips/avisos — funções puras). Captura lado a lado com 01 e 02. Commit `feat(desktop): cinema call card and film sheet`.

### Task 5: Foyer e poltronas (mockups 03 e 04)

**Files:** `room/Foyer.tsx`, `room/SeatRow.tsx`, `room/Seat.tsx`, `room/TrackPicker.tsx` (+ css), `room/seats.ts` (+ teste).

- `Seat`: avatar/Eco, anel de preparo (progresso = `aheadS / CINEMA_SEEK_READY_S`, índigo quando `ready`), selo ✓, nome (reticências), status ("Pronta/Pronto · Dublado"), brilho de fala com o envelope existente (`useEnvelope`/`levels.ts`), estado `unsupported`, assento livre.
- `SeatRow`: ordem (você primeiro, depois quem projeta, depois por ordem de chegada), até 8, variantes `foyer` (grande) e `strip` (fina, usada nas Tasks 6–8).
- Foyer: capa grande nítida + fundo desfocado, título, chips, seletor "Você assiste: Dublado · Português 5.1 / Legendado · Inglês 5.1" (faixas de áudio + legenda padrão), rodapé "2 de 3 prontos · A Bia está carregando o começo" + "Começar" (quem projeta; "Começar mesmo assim" após 10 s).
- Foyer vazio (04): Eco na fileira com "Esperando a galera sentar"; `hop` quando alguém senta.
- [ ] Testes: `seats.ts` ordenação/limites/rótulos (Review Focus 3: 8 poltronas, nome de 32 caracteres, RTL); capturas 03/04 lado a lado. Commit `feat(desktop): cinema foyer and seats`.

### Task 6: Assistindo (mockups 05 e 06) e reações

**Files:** `room/Watching.tsx`, `room/TopBar.tsx`, `room/Controls.tsx`, `room/SyncChip.tsx`, `room/Reactions.tsx`, `room/reactions.ts` (+ teste), store: tratar `CINEMA_REACTION` (fila local por poltrona) e expor `reactions` recentes.

- 05: título + "Nativo · 4K HDR" + "Ana está projetando" no topo; chip "Em sincronia" com tooltip "4 de 4 · ±6 ms" (prontos/sentados e |driftMs|); controles (play/pause, ±10 s, tempo, reação, legenda, áudio, volume **Filme** e **Vozes** separados — vozes = volume de voz existente do app, fullscreen, menu ⋯ com "Denunciar sessão" e "Modo engenharia"); fileira `strip`.
- 06: interface escondida (2 s de inatividade, `useIdle`), legenda, poltrona falando acesa, reação subindo.
- Reações: `R` abre os 6 emojis; envio via `react`; animação 1,6 s subindo da poltrona; fila com no máximo 6 animações simultâneas (Review Focus 5).
- [ ] Testes: `reactions.ts` (fila, limite, expiração); capturas 05/06. Commit `feat(desktop): cinema watching view, controls and reactions`.

### Task 7: Timeline social

**Files:** `room/Timeline.tsx`, `room/timeline.ts` (+ teste), `room/thumbs.ts` (+ teste).

- Faixas: carregado (contíguo à frente do playhead pelo `swarm`/`aheadS`), assistido, marcadores de capítulo, **mapa de calor** (`session.heat`, normalizado, faixa fina acima da barra como no mockup), miniatura ao passar/arrastar (tile do sprite `thumbs`: 10 colunas, largura 160, altura par `round(160·h/w)`, 1 tile/10 s — R27) com tempo, nome do capítulo e contagem de reações do balde.
- Scrub local; comando só ao soltar; toast "Ana pulou para 1:12:40 · Desfazer" (8 s; desfazer = `control('seek', posiçãoAnterior)`).
- **Pular abertura** quando o capítulo atual casa `/^(opening|intro|abertura|op)\b/i`.
- [ ] Testes: tile de um tempo, normalização do calor, capítulo atual, regra do "Pular abertura" (Review Focus 2: sem capítulos/sem miniaturas). Captura com hover. Commit `feat(desktop): cinema social timeline`.

### Task 8: Pausa, esperando alguém e intervalo (mockups 07, 08, 09)

**Files:** `room/Paused.tsx`, `room/Waiting.tsx`, `room/Intermission.tsx`, `room/Countdown.tsx` (+ css).

- 07: meia-luz, frame congelado escurecido, "Pedro pausou · 1:02:13" com avatar, retomar (Espaço/clique); `aria-live`.
- 08: "Esperando a Ana" com a poltrona dela em progresso + "Continuar sem a Ana" (`continueWithout`).
- 09: luz acesa, capa suave, "Intervalo · faltam 1h12", poltronas maiores com estado "Pronto"; "Voltar" = `control('seek', position)` (o servidor reúne os prontos e conta 3 s).
- Countdown: anel fino 3 s sincronizado em `at`; com movimento reduzido vira texto "Começa em 3".
- [ ] Capturas 07/08/09 + countdown. Commit `feat(desktop): cinema pause, waiting, intermission and countdown`.

### Task 9: Créditos, próximo episódio, fim e canhoto (mockups 10 e 11)

**Files:** `room/Credits.tsx`, `room/Ticket.tsx`, `room/ticket.ts` (+ teste); store/actions: próximo episódio (host chama `probe` do `next[0]` → `start` → `cinema_switch`), `saveResume` periódico do host (a cada 15 s e no fim).

- 10: "Próximo: S01E03 — <título> em 10 s · Cancelar" no capítulo de créditos ou últimos 30 s; quem projeta já prepara o próximo arquivo em segundo plano ao entrar nos créditos; Cancelar desfaz para todos (só quem projeta pode cancelar; os outros veem).
- 11: canhoto com perfuração (sem kitsch), capa, título, data, poltronas, "2h46 juntos" (`summary.watchedS`), "127 reações", momento mais reagido (tile do sprite em `summary.peak.position` + minutagem), **Copiar imagem** / **Salvar** via `captureCard` (Task 2).
- [ ] Testes `ticket.ts` (formatação de tempo/data/contagens, sem pico). Capturas 10/11. Commit `feat(desktop): cinema credits, next episode and ticket`.

### Task 10: Presença, denúncia, avisos, miniplayer e acessibilidade

**Files:** `room/Notices.tsx`, `room/ReportDialog.tsx`, ligações em `features/activity` (presença) e `features/voice/MiniPlayer.tsx`.

- Presença: enquanto sentado, atividade "Numa sessão de cinema" (sem título do filme) pelo mecanismo de atividade existente, sem quebrar a detecção de jogos (prioridade: a atividade do cinema enquanto sentado).
- Denunciar sessão: `POST /reports` com `targetType: 'user'` = quem projeta, motivo do formulário existente de T&S, detalhes "Sala de cinema: <título>, <minutagem>" (nunca conteúdo).
- Avisos estilizados (IP na primeira vez, fone com `echoRisk`, E2EE falhou, ffmpeg bloqueado, "Seu PC não decodifica HEVC", "Cinema desligado neste servidor") com o Eco no estado certo (`error`/`listening`) e sem `alert`.
- Miniplayer: ao sair da tela da chamada com sessão sentada, o filme continua no `MiniPlayer` (mesmo `<video>`/player; sincronizado); voltar restaura.
- Passada de acessibilidade e movimento reduzido em todas as telas; atalhos §7.4 completos; foco visível.
- [ ] Testes onde houver lógica (texto da presença, montagem do corpo da denúncia). Commit `feat(desktop): cinema presence, report, notices, miniplayer and a11y`.

### Task 11: Capturas lado a lado e ajuste fino de fidelidade

**Files:** `apps/desktop/scripts/cinema-shots.mjs` (Playwright + app real, 2–3 instâncias, fixture com capa/capítulos/legenda), `docs/screenshots/2026-11-05-cinema-v1-*.{png,jpg}`, `docs/design/cinema/compare/*.jpg` (composições lado a lado mockup | app).

- Capturar as 11 telas no mesmo enquadramento dos mockups (1440×900) + janela pequena 960×600 + tela cheia (Review Focus 4); compor lado a lado; listar diferenças; corrigir até ficar igual ou nomear a diferença inevitável (dado real, limite do motor).
- [ ] Rodar, corrigir, rodar de novo. Commit `docs(screenshots): cinema v1 side by side with the approved mockups`.
- [ ] O controller envia as composições ao dono pelo celular.

### Task 12: Preparar a publicação (sem publicar)

**Files:** `docs/STATE.md`, changelog do app (onde a versão é anunciada), versão do desktop (`apps/desktop/package.json`), notas de release.

- Atualizar STATE e changelog; subir a versão do desktop; garantir `npm run dist` verde e o guard de pacote; listar as variáveis de staging (`CINEMA=true`; `CINEMA_TURN_*` só quando o relay estiver no ar).
- **Não** mesclar na `main`, não fazer push, não publicar: isso é decisão do dono no fim (o controller pergunta).
- [ ] Commit `chore(release): prepare desktop <versão> — Sala de Cinema`.
