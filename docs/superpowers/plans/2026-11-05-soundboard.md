# Soundboard por espaço — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Soundboard estilo Discord em cada espaço: membro na call clica num som e todos na call ouvem; upload com editor de corte; anti-spam no servidor; pacote original "Alga".

**Architecture:** O clique chama `POST /channels/:id/soundboard/play`; o servidor valida (membro no canal, permissão, cooldown) e emite `SOUNDBOARD_PLAY` pelo gateway só para quem está naquele canal de voz; cada app toca o WAV do cache local com WebAudio. Sons do espaço ficam em `space_sounds` + `Storage` (`sounds/<spaceId>/<soundId>`); o editor corta/normaliza no app e envia WAV PCM16 mono 48 kHz, que o servidor valida byte a byte.

**Tech Stack:** Fastify + Drizzle (Postgres/PGlite) + zod no servidor; Electron + React + zustand + CSS modules + WebAudio/canvas no desktop; vitest; scripts `.mjs` de E2E com o QA stack.

**Spec:** `docs/superpowers/specs/2026-11-04-soundboard-design.md` (ler antes de qualquer tarefa).

## Global Constraints

- Trabalhar no worktree `D:\PROJETOS\alga-soundboard`, branch `feat/soundboard` a partir de `main`. **Nunca** editar `features/billing/**`, `apps/server/src/billing/**`, `packages/shared/src/billing.ts` (outra IA). Mudanças em arquivos compartilhados (`db/schema.ts`, `permissions.ts`, `gateway.ts`, `api.ts`, `models.ts`) só aditivas.
- Limites (copiar exatamente): `MAX_SOUNDS_PER_SPACE = 24`, `MAX_SOUND_MS = 5000`, tolerância do validador `5050` ms, `MAX_SOUND_BYTES = 512 * 1024`, formato `WAV PCM 16-bit mono 48000 Hz`, nome 1–32 caracteres, emoji opcional (1 emoji).
- Anti-spam: cooldown pessoal = fim do som + `3000` ms; teto do canal = `3` sons simultâneos; rajada = `10` toques/pessoa/minuto. 429 com `retryAfterMs`.
- Permissões: `USE_SOUNDBOARD: 1 << 21` (entra em `DEFAULT_EVERYONE_PERMISSIONS`), `MANAGE_SOUNDBOARD: 1 << 22`.
- Player: volume próprio padrão `0.7`, saída = dispositivo de saída da call; som que não baixar em `1500` ms é descartado.
- Editor: entrada ≤ 20 MB; fade in/out 0–500 ms; normalização ligada por padrão com limiter de pico.
- Texto de UI em pt-BR em `strings.ts` do recurso; comentários de código em inglês (padrão do repo).
- Sem dependências novas. Visual Linear + índigo; animações só como feedback; `prefers-reduced-motion` respeitado; tudo operável por teclado com rótulos ARIA; sem `alert/confirm` nativos.
- Comandos de teste: servidor `npm test -w apps/server` (PGlite) e `npm run test:pg -w apps/server` quando disponível; desktop `npm test -w apps/desktop`; tipos `npm run typecheck`.

## Review Focus

1. **Arquivo "WAV" malicioso ou estranho** (cabeçalho RIFF válido com `data` maior que o arquivo, chunks extras `LIST` antes de `data`, `fmt` com extensible) — esperado: aceita WAVs PCM16 mono 48 k legítimos com chunks extras, rejeita o resto com 400, nunca lança exceção não tratada. Teste na Task 1.
2. **Usuário sai/troca de canal no meio** — esperado: `play` de quem não está mais no canal → 403; quem entra durante um som não recebe sons tocados antes. Teste na Task 3.
3. **Som apagado enquanto outros têm cache/painel aberto** — esperado: `SPACE_SOUNDS_UPDATE` remove o tile; `play` de id apagado → 404; o player ignora `SOUNDBOARD_PLAY` de id desconhecido sem quebrar. Testes nas Tasks 3 e 5.
4. **Arquivo de entrada que o Chromium não decodifica ou tem 0 s / silêncio total** — esperado: mensagem humana no editor; normalização de silêncio não gera NaN/Infinity (ganho limitado). Teste na Task 6.
5. **Cliques simultâneos de várias pessoas** — esperado: teto de 3 por canal vale sob concorrência (estado síncrono em memória, verificação e registro na mesma volta do event loop). Teste na Task 3.

---

### Task 0: Worktree

- [ ] **Step 1:** `git worktree add D:\PROJETOS\alga-soundboard -b feat/soundboard main`; `npm ci` (ou junção de `node_modules` como em `D:\PROJETOS\alga-verify`, ver `docs/STATE.md`).
- [ ] **Step 2:** `npm run typecheck && npm test -w apps/server && npm test -w apps/desktop` — Expected: tudo verde (linha de base). Anotar contagem de testes.

### Task 1: Contrato compartilhado + validador de WAV

**Files:**
- Modify: `packages/shared/src/permissions.ts` (bits 21/22, `DEFAULT_EVERYONE_PERMISSIONS`)
- Create: `packages/shared/src/soundboard.ts` (constantes, tipos, manifesto Alga, `parseWav`), export em `packages/shared/src/index.ts`
- Modify: `packages/shared/src/gateway.ts` (dois dispatches)
- Test: `packages/shared/src/soundboard.test.ts`

**Interfaces — Produces:**
```ts
export const MAX_SOUNDS_PER_SPACE = 24, MAX_SOUND_MS = 5000, MAX_SOUND_BYTES = 512 * 1024
export const SOUND_SAMPLE_RATE = 48000, SOUND_COOLDOWN_MS = 3000, CHANNEL_MAX_CONCURRENT = 3, PLAYS_PER_MINUTE = 10
export interface SpaceSound { id: string; spaceId: string; name: string; emoji: string | null; durationMs: number; createdBy: string; createdAt: string }
export interface AlgaSound { id: `alga:${string}`; name: string; emoji: string; durationMs: number }
export const ALGA_SOUNDS: readonly AlgaSound[]          // vazio até a Task 9
export const SoundMetaBody: z.ZodType<{ name: string; emoji?: string | null }>
export function parseWav(buf: Uint8Array): { ok: true; durationMs: number; samples: number } | { ok: false; reason: string }
// gateway.ts Dispatch union:
| { t: 'SPACE_SOUNDS_UPDATE'; d: { spaceId: string; sounds: SpaceSound[] } }
| { t: 'SOUNDBOARD_PLAY'; d: { channelId: string; soundId: string; userId: string; playId: string; durationMs: number } }
```

- [ ] **Step 1: testes** `parseWav`: aceita PCM16 mono 48k de 1 s (`durationMs === 1000`); aceita com chunk `LIST` antes de `data`; rejeita estéreo, 44100 Hz, 8-bit, float (format 3), 5,1 s, `data` declarado maior que o buffer, buffer < 44 bytes, `RIFF` sem `WAVE`, bytes aleatórios. `Permission.USE_SOUNDBOARD` está em `DEFAULT_EVERYONE_PERMISSIONS`; `MANAGE_SOUNDBOARD` não. `SoundMetaBody` rejeita nome vazio/33 chars e emoji com 2 emojis.
- [ ] **Step 2:** rodar → FAIL. **Step 3:** implementar (percorrer chunks RIFF com limites checados; aceitar `fmt` tag 1 ou 0xFFFE com subformat PCM; `durationMs = round(samples/48)`). **Step 4:** PASS + typecheck. **Step 5:** commit `feat(shared): soundboard contract and WAV validator`.

### Task 2: Banco, storage e CRUD de sons

**Files:**
- Modify: `apps/server/src/db/schema.ts` (tabela `spaceSounds`)
- Create: `apps/server/drizzle/0013_soundboard.sql` (+ entrada no journal do drizzle; inclui `update roles set permissions = permissions | 2097152 where id = space_id` para o @everyone — conferir o nome real das colunas)
- Create: `apps/server/src/routes/sounds.ts`; registrar em `app.ts`
- Test: `apps/server/test/soundboard.test.ts`

**Interfaces:**
- Consumes: Task 1; `requireSpace(db, spaceId, userId, needed)`, `spool(file, name, maxBytes)`, `ctx.storage.put/get/delete`, `storageDeletions` (padrão dos anexos), `hub.dispatch(userIds, t, d)`, `spaceMemberIds(db, spaceId)`.
- Produces: rotas `GET /spaces/:id/sounds → SpaceSound[]`, `POST /spaces/:id/sounds` (multipart: `file` + campo `payload_json` com `SoundMetaBody`, igual ao padrão de mensagens) `→ 201 SpaceSound`, `PATCH /spaces/:id/sounds/:soundId` `→ SpaceSound`, `DELETE … → 204`, `GET /spaces/:id/sounds/:soundId/audio` (`audio/wav`, `Cache-Control: private, max-age=31536000, immutable`). Toda mudança emite `SPACE_SOUNDS_UPDATE` para os membros. Helper exportado `soundRow(db, spaceId, soundId)` para a Task 3.

- [ ] **Step 1: testes** (usar `startServer`, `register`, e o helper `multipart` de `uploads.test.ts` — mover para `helpers.ts` se precisar): dono sobe WAV válido → 201 e `GET` lista; membro comum sem `MANAGE_SOUNDBOARD` → 403 no POST/PATCH/DELETE e 200 no GET/áudio; não-membro → 404/403 no áudio; WAV inválido → 400; 25º som → 400 com mensagem de limite; DELETE enfileira o objeto em `storageDeletions`; gateway de outro membro recebe `SPACE_SOUNDS_UPDATE`; espaço criado antes da migração ganha `USE_SOUNDBOARD` no @everyone (testar a SQL da migração num espaço inserido com a máscara antiga, se o harness permitir; senão, testar o default em espaço novo).
- [ ] **Step 2:** FAIL. **Step 3:** implementar. Contagem dos 24 dentro de transação com lock na linha do espaço (`select … for update`), para dois uploads simultâneos não passarem de 24. **Step 4:** PASS (`npm test -w apps/server`). **Step 5:** commit `feat(server): space sounds storage and CRUD`.

### Task 3: Tocar + anti-spam

**Files:**
- Create: `apps/server/src/soundboard.ts` (classe `SoundboardLimiter`, pura, relógio injetável)
- Modify: `apps/server/src/routes/sounds.ts` (rota play), `apps/server/src/app.ts` (instância no `Ctx`)
- Test: `apps/server/test/soundboard.test.ts`, `apps/server/src/soundboard.test.ts` (unit do limiter, se o vitest do servidor incluir `src/`; senão em `test/`)

**Interfaces — Produces:**
```ts
export class SoundboardLimiter {
  constructor(now?: () => number)
  /** Checks and, when allowed, records in the same call (no await between). */
  tryPlay(userId: string, channelId: string, durationMs: number): { ok: true } | { ok: false; retryAfterMs: number; reason: 'cooldown' | 'channel_busy' | 'burst' }
}
```
Rota `POST /channels/:channelId/soundboard/play { soundId }` → `204`; erros `403` (não está no canal / sem `USE_SOUNDBOARD` / server mute), `404` (som inexistente ou de outro espaço, ou canal sem espaço), `429 { error: { code, message, details: { retryAfterMs, reason } } }` no formato de `errors.ts`. Mensagens pt-BR: cooldown "Calma aí — espere um instante para tocar de novo.", canal "O canal está barulhento. Espere um instante.". Emite `SOUNDBOARD_PLAY` para `voice.inChannel(channelId).map(s => s.userId)` com `playId = uuidv7()`.

- [ ] **Step 1: testes unit do limiter** com relógio falso: 2º toque antes de `duração + 3000` → `cooldown` com `retryAfterMs` exato; depois → ok; 4º som simultâneo no canal (3 usuários diferentes tocando) → `channel_busy`; 11º toque em 60 s (sons curtos, relógio avançando) → `burst`; estado de usuários antigos é limpo (sem crescer para sempre).
- [ ] **Step 2: testes de rota**: usuário "no canal" via `postWebhook(participant_joined)` toca → 204 e o gateway de outro participante recebe `SOUNDBOARD_PLAY`; um membro fora da call **não** recebe; quem não está no canal → 403; depois de `participant_left` → 403; server mute (via rota de moderação existente) → 403; som de outro espaço → 404; `alga:` id inexistente → 404; segundo toque imediato → 429 com `retryAfterMs`.
- [ ] **Step 3:** FAIL → implementar → PASS. **Step 4:** commit `feat(server): soundboard play with cooldown and channel cap`.

### Task 4: Cliente — API, store e player

**Files:**
- Create: `apps/desktop/src/renderer/src/features/soundboard/{api.ts,store.ts,player.ts,strings.ts}`
- Modify: `apps/desktop/src/renderer/src/store/data.ts` (tratar `SPACE_SOUNDS_UPDATE` e `SOUNDBOARD_PLAY` delegando ao store do soundboard), `apps/desktop/src/renderer/src/media/prefs.ts` (prefs `soundboardVolume: 0.7`, `soundboardMuted: false`)
- Test: `apps/desktop/src/renderer/src/features/soundboard/soundboard.test.ts`

**Interfaces — Produces:**
```ts
// store.ts (zustand)
useSoundboard: { bySpace: Record<string, SpaceSound[]>; cooldownUntil: number; playing: Record<string /*userId*/, { soundId: string; until: number }> }
loadSounds(spaceId: string): Promise<void>
playSound(channelId: string, soundId: string): Promise<{ ok: true } | { ok: false; message: string; retryAfterMs?: number }>
// player.ts
preload(spaceId: string, ids: string[]): Promise<void>          // fetch + decodeAudioData, cache por id
playLocal(soundId: string, opts: { volume: number }): boolean   // false se não está em cache
previewLocal(soundId: string): void                              // só para mim, ignora mute do soundboard
setSoundboardOutput(deviceId: string | null): void              // mesmo padrão de setCueOutput
```
Regra ao receber `SOUNDBOARD_PLAY`: sempre registrar em `playing[userId]` (indicador visual); tocar só se `!selfDeaf && !serverDeaf && !soundboardMuted`; se não estiver em cache, baixar e tocar só se chegar em ≤ 1500 ms após o evento. Se `userId === eu`, o `cooldownUntil` passa a `agora + durationMs + 3000`; um 429 sobrescreve com `agora + retryAfterMs`. Ids `alga:` resolvem para assets embarcados (Task 9).

- [ ] **Step 1: testes** (com AudioContext/fetch mockados): ensurdecido não chama `playLocal` mas registra `playing`; `soundboardMuted` idem; id desconhecido não lança; download que chega em 1600 ms é descartado; `cooldownUntil` calculado como acima; `SPACE_SOUNDS_UPDATE` substitui a lista.
- [ ] **Step 2:** FAIL → implementar → PASS + typecheck. **Step 3:** commit `feat(desktop): soundboard store and player`.

### Task 5: Painel na call + indicador de quem tocou

**Files:**
- Create: `features/soundboard/{SoundboardButton.tsx,SoundboardPanel.tsx,SoundTile.tsx,soundboard.module.css}`
- Modify: `features/voice/ControlsDock.tsx` (botão, só em canal de voz de espaço), `features/voice/CallStage.tsx` (emoji subindo + anel no participante a partir de `playing`), `features/voice/VoiceAnnouncer.tsx` ("Ana tocou Corneta")
- Test: `features/soundboard/panel.test.ts` (lógica pura extraída: estado do tile, seções, busca)

Comportamento (spec §5.6): popover ancorado ao botão, Esc/clique fora fecham, foco gerenciado; seções "Deste espaço" e "Alga" (oculta se `ALGA_SOUNDS` vazio); busca quando > 12 sons; tile = emoji grande, nome, duração; botão de fone = pré-escuta; clique = tocar; pulse + barra de progresso ao tocar; cooldown como preenchimento esvaziando sobre todos os tiles; rodapé com slider de volume + "Silenciar soundboard"; gestores veem "+ Adicionar som" (abre o editor da Task 6), contador `n/24` e menu por tile (renomear, emoji, apagar com confirmação inline); sem `USE_SOUNDBOARD` ou server mute → somente leitura com motivo. Pré-carregar os sons do espaço ao entrar na call. `prefers-reduced-motion` desliga pulse/emoji subindo.

- [ ] **Step 1: testes** da lógica pura: `tileState({ now, cooldownUntil, playingMine, canUse })` → `'ready' | 'cooldown' | 'playing' | 'disabled'` com progresso 0–1; filtro de busca acento-insensível (reusar `lib/fuzzy.ts`); seção Alga oculta com manifesto vazio.
- [ ] **Step 2:** FAIL → implementar → PASS. **Step 3:** screenshots (padrão de `scripts/screenshot.mjs`) dos estados: vazio, cheio (24), cooldown, sem permissão, janela estreita; comparar com o Linear e corrigir antes de seguir. **Step 4:** commit `feat(desktop): soundboard panel in the call dock`.

### Task 6: Editor de upload

**Files:**
- Create: `features/soundboard/{SoundEditor.tsx,Waveform.tsx,editor.module.css,audio-edit.ts}`
- Test: `features/soundboard/audio-edit.test.ts`

**Interfaces — Produces (`audio-edit.ts`, puro, testável sem DOM):**
```ts
export function clampWindow(w: { start: number; end: number }, totalMs: number, maxMs?: number /*5000*/): { start: number; end: number }
export function peaks(samples: Float32Array, buckets: number): Float32Array          // para a forma de onda
export function loudnessGainDb(samples: Float32Array, targetDb?: number): number    // limitado a [-24, +18] dB, 0 para silêncio
export function applyEdits(samples: Float32Array, rate: number, e: { startMs: number; endMs: number; fadeInMs: number; fadeOutMs: number; gainDb: number; normalize: boolean }): Float32Array // mono 48k, limiter de pico ≤ -1 dBFS
export function encodeWav(mono48k: Float32Array): Uint8Array                       // PCM16, aceito por parseWav
```
UI: arrastar/escolher arquivo (≤ 20 MB) → `decodeAudioData` → mixdown mono + resample para 48 kHz (`OfflineAudioContext`); forma de onda em canvas com janela de até 5 s, alças arrastáveis, arrastar janela, zoom (roda/pinça), setas do teclado movem a alça focada; play/pause do trecho com cursor animado e loop; fades 0–500 ms; ganho ±; normalização ligada; nome (do nome do arquivo, limpo, ≤ 32) e emoji (seletor de emoji existente do app, se houver; senão campo de 1 emoji); salvar → `encodeWav` → `POST /spaces/:id/sounds`; erros do servidor no campo certo. Coluna única em janela estreita. Alvo de loudness único (mesmo dos sons Alga).

- [ ] **Step 1: testes**: `clampWindow` nunca passa de 5000 ms nem sai de [0, total]; `loudnessGainDb` de silêncio = 0 (sem NaN) e de ruído alto é negativo; `applyEdits` com fade 0 não altera amostras do meio, pico final ≤ -1 dBFS; `parseWav(encodeWav(x))` ok com `durationMs` correto para 4,999 s; arquivo de 0 amostras → erro tratado.
- [ ] **Step 2:** FAIL → implementar → PASS. **Step 3:** screenshots (arquivo carregado, cortando, erro de decodificação, janela estreita). **Step 4:** commit `feat(desktop): sound upload editor with waveform trim`.

### Task 7: Permissões na tela de cargos

**Files:** Modify `features/spaceSettings/permissions.ts` (grupo/rotulagem: "Usar soundboard", "Gerenciar sons"), `features/spaceSettings/strings.ts`. Test: o teste existente de permissões (se houver) ganha os dois bits; senão um assert em `panel.test.ts` de que ambos aparecem num grupo.

- [ ] Implementar, testar, commit `feat(desktop): soundboard permissions in roles`.

### Task 8: E2E real no QA stack

**Files:** Create `apps/desktop/scripts/soundboard-e2e.mjs` (seguir o estilo de `media-lab.mjs`/`qa-journey.mjs` + `qa-stack.mjs`).

Roteiro: `qa-stack build && start`; dois usuários (A dono, B membro) num espaço com canal de voz, ambos na call; A abre o editor, carrega um arquivo de teste (gerar um WAV de 8 s com tom no script), corta 2 s, salva; B vê o tile chegar via gateway; A toca → em B o player registra reprodução (expor contador de teste via `window.__soundboardStats` somente quando a flag de QA já usada pelo projeto estiver ligada) e um `AnalyserNode` mede energia > limiar; segundo clique de A dentro do cooldown → tiles em cooldown e servidor 429; B liga "Silenciar soundboard" → não toca, indicador aparece; B ensurdecido → não toca; repetir com espaço E2EE ligado; apagar o som → some em B. Saída: JSON com cada verificação `pass/fail` + screenshots em `docs/screenshots/soundboard/`.

- [ ] Rodar até todas as verificações `pass`; commit `test(e2e): soundboard end to end on the QA stack`.

### Task 9: Pacote "Alga"

- [ ] **Step 1:** propor ao dono lista de ~12 sons (nome, emoji, descrição) e **pedir confirmação dos créditos ElevenLabs antes de gerar**.
- [ ] **Step 2:** gerar (ElevenLabs sound effects / falas curtas), escolher takes, cortar ≤ 5 s, normalizar com o mesmo alvo de `loudnessGainDb`, exportar WAV PCM16 mono 48k; validar todos com `parseWav`.
- [ ] **Step 3:** dono ouve e aprova (tocar na instância de teste).
- [ ] **Step 4:** embarcar em `apps/desktop/src/renderer/src/assets/soundboard/<slug>.wav`, preencher `ALGA_SOUNDS` (ids `alga:<slug>`, `durationMs` reais), player resolve `alga:` para os assets; teste: todo item do manifesto tem asset e `durationMs` bate com o arquivo. Commit `feat(soundboard): original Alga sound pack`.

### Task 10: Docs, revisão, merge e release

- [ ] **Step 1:** nota curta em `docs/decisions/0004-e2ee.md` (o evento revela "quem tocou qual som"; arquivo no servidor); seção no `apps/server/README.md` (rotas) e `docs/STATE.md`; denúncia de sons via `trust-safety.ts` registrada como lacuna se não couber barato (spec §5.4).
- [ ] **Step 2:** revisão do branch inteiro por um revisor novo (superpowers:requesting-code-review); corrigir.
- [ ] **Step 3:** `npm run typecheck && npm test -w apps/server && npm test -w apps/desktop` verdes no worktree. Rebase em `main`; se a outra IA já tiver commitado uma `0013_*`, renumerar a nossa.
- [ ] **Step 4:** merge em `main` (fast-forward) e `git push`.
- [ ] **Step 5:** **servidor primeiro:** `railway up --service api --environment staging --detach` **a partir de um worktree limpo de `main`** (nunca da raiz com arquivos não commitados da outra IA); checar `/api/v1/ready` e que a migração rodou.
- [ ] **Step 6:** bump de `apps/desktop/package.json` para a próxima versão (0.1.3, ou a seguinte se já existir), build limpo com `MAIN_VITE_API_URL=https://api-staging-b3ea.up.railway.app npm run dist -w apps/desktop`, `gh release create vX.Y.Z` com `.exe`, `.blockmap`, `latest.yml` e a cópia `AlgaMeet-Setup.exe` (processo em `docs/STATE.md` "Release pública"). Commit do bump.
- [ ] **Step 7:** avisar o dono para atualizar o app e testar.
