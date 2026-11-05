# Soundboard por espaço — design

Data: 2026-11-04. Status: aprovado pelo dono em 2026-11-05.

**Fim do trabalho [dono]:** mesclar no `main` e publicar uma nova versão do desktop (staging, auto-update), para o dono atualizar o app e testar com os amigos.

Legenda: **[dono]** = decidido pelo dono na conversa. **[minha escolha]** = decisão do designer (Claude), revisável. Sem marca = consequência direta das duas.

## 1. Intenção

Um soundboard estilo Discord dentro de cada espaço (servidor) do Alga Meet: alguém na call de voz clica num som e **todo mundo na call ouve** — memes, zoeira, reação. [dono]

Tem que ser "foda, sexy e gostoso de usar": bonito, responsivo, organizado, fluido, intuitivo, sempre pensando na experiência. Animações e efeitos **só onde ajudam** (feedback de clique, quem tocou, cooldown), nunca decoração gratuita. [dono] Direção visual do app: Linear + índigo suave (ver memória `design-direction-linear-indigo`); comparar sempre com o Linear.

Grátis por enquanto — nada de Premium/slots pagos nesta versão. [dono]

## 2. Objetivos

1. Tocar: painel acessível pela barra da call; grade de sons (emoji, nome, duração); um clique toca para todos na call; todos veem quem tocou. [dono]
2. Anti-spam: uma pessoa não pode ficar clicando o tempo todo. [dono] Números em §5.3.
3. Controle do ouvinte: volume do soundboard e "silenciar soundboard" por pessoa, só para si. [minha escolha, aprovada pelo dono como parte da playback]
4. Subir som: membro com permissão arrasta um arquivo, **corta como quiser** num editor com forma de onda, ouve, ajusta, nomeia, escolhe emoji. [dono]
5. Pacote padrão do Alga Meet: sons originais, com personalidade, **nada genérico**. [dono]
6. Testado de ponta a ponta, à prova de erros. [dono]

## 3. Não-objetivos

- Monetização (slots extras, usar sons em qualquer espaço). [dono: grátis por enquanto] Deixar o modelo de dados sem impedir isso depois, sem construir nada.
- Sons de entrada (`entrance_sound`) — pertencem aos cosméticos/billing, outra IA está trabalhando ali. Não tocar em `features/billing/**`, `apps/server/src/billing/**`, `packages/shared/src/billing.ts`. [minha escolha]
- Soundboard em DM/chamadas de grupo fora de espaço. [minha escolha] (o modelo é "sons do espaço").
- Tocar som fora de call.
- Favoritos cross-espaço, busca global, categorias. [minha escolha — v1 enxuta; busca simples dentro do painel sim, se o espaço tiver muitos sons]

## 4. Anti-objetivos (falha mesmo que "funcione")

- Irritante: spam, som estourado, som que não dá pra calar.
- Genérico: visual de template, sons padrão "beep boop" de banco gratuito.
- Frágil: arquivo malicioso derruba o servidor/app; som tocando só pra metade da call sem ninguém saber; cooldown burlável pelo cliente.
- Clipes com direito autoral no pacote padrão (áudio de filme, vídeo viral, música). Não podemos distribuir. Membros sobem os memes deles; o pacote padrão é 100% original.

## 5. Como funciona

### 5.1 Transporte do som [minha escolha]

O clique **não** transmite áudio pela call (nada de faixa extra no LiveKit).

1. Cliente chama `POST /channels/:channelId/soundboard/play { soundId }`.
2. Servidor valida: o usuário está nesse canal de voz agora, tem `USE_SOUNDBOARD`, não está mutado pelo servidor (server mute; não existe timeout no app hoje). Permissão é por espaço (não há override por canal), o som existe e é deste espaço (ou é padrão), cooldown/limites (§5.3).
3. Servidor emite um evento de gateway `SOUNDBOARD_PLAY { channelId, soundId, userId, playId }` para quem está **naquele canal de voz**.
4. Cada cliente toca localmente a partir de cache (baixa o arquivo na primeira vez; pré-carrega os sons do espaço ao entrar na call). Quem está ensurdecido (selfDeaf/serverDeaf) ou silenciou o soundboard não toca, mas ainda vê o indicador visual.

Por quê: qualidade perfeita, zero banda de upload de quem clica, volume/silenciar por ouvinte trivial, cooldown imposto no servidor, funciona igual em calls E2EE (o arquivo já vive no servidor; o evento revela apenas "fulano tocou o som X", o que é aceitável e deve constar em `docs/decisions/0004-e2ee.md` como nota curta).

Saída de áudio: tocar no mesmo dispositivo de saída da call (respeitar a preferência de saída, como `setCueOutput` em `media/sounds.ts`). Não usar o mesmo volume das cues de UI: o soundboard tem seu próprio volume (padrão 70%).

Atraso: alvo < 250 ms entre o clique e o som em outro cliente na mesma rede. Não exigimos sincronização exata entre ouvintes.

Primeiro uso sem cache: se o arquivo ainda não baixou quando o evento chega, baixar e tocar se chegar em < 1,5 s; senão descartar silenciosamente (som atrasado é pior que som perdido).

### 5.2 Permissões [minha escolha]

Dois bits novos em `packages/shared/src/permissions.ts` (bits livres; conferir antes de usar, outra IA pode ter mexido):

- `USE_SOUNDBOARD` (1 << 21) — entra em `DEFAULT_EVERYONE_PERMISSIONS`.
- `MANAGE_SOUNDBOARD` (1 << 22) — subir, editar, apagar sons do espaço. Não está no padrão; dono/admin/cargos com a permissão.

Ambos aparecem na tela de cargos (`features/spaceSettings/Roles.tsx` / `permissions.ts`) com rótulos em pt-BR.

Para espaços existentes: migração que adiciona `USE_SOUNDBOARD` ao cargo @everyone (id == space id) de todos os espaços.

### 5.3 Anti-spam [dono pediu limite; números são minha escolha]

Impostos no servidor (fonte da verdade), espelhados no cliente para a UI:

- **Cooldown pessoal:** depois de tocar, a pessoa só toca de novo quando o som dela terminou **+ 3 s**. Logo, no máximo 1 som seu por vez.
- **Teto do canal:** no máximo 3 sons tocando ao mesmo tempo no canal; o 4º recebe "o canal está barulhento, espere um instante".
- **Rajada:** no máximo 10 toques por pessoa por minuto (rate limit da rota).

A resposta 429 traz `retryAfterMs`; o cliente mostra o cooldown sem precisar adivinhar. Estado em memória no servidor (como o rate limit atual: uma instância). `shortcut:` em memória; mover para Redis junto com o rate limit quando houver várias instâncias.

### 5.4 Sons do espaço — dados e arquivos

Tabela nova `space_sounds` (Drizzle, migração `00NN_soundboard.sql` com o próximo número livre no momento do merge — a outra IA também cria migrações):

`id (uuidv7), space_id, name (1–32), emoji (opcional, 1 emoji), storage_key, duration_ms, gain_db, created_by, created_at, updated_at`. [minha escolha] A normalização é **embutida no WAV** pelo editor; `gain_db` é só registro (para diagnóstico/recalibração futura). O player não aplica ganho por som, só o volume do ouvinte. Índice por `space_id`. Apagar espaço apaga os sons (e enfileira em `storage_deletions`, como anexos).

Limites [minha escolha]: **até 24 sons por espaço**, **até 5 s por som**, arquivo final ≤ 512 KB.

Formato armazenado [minha escolha]: **WAV PCM 16-bit mono 48 kHz** gerado pelo app depois do corte (≤ 5 s ≈ 480 KB). O servidor **não confia** no cliente: valida cabeçalho RIFF/WAVE, formato PCM 16-bit, mono, 48 kHz, duração ≤ 5,05 s, tamanho, e rejeita o resto. Sem ffmpeg no servidor. `shortcut:` WAV é pesado; trocar por Opus (WebCodecs AudioEncoder + mux Ogg) se o cache dos clientes virar problema.

Armazenamento: `Storage` existente (`apps/server/src/storage.ts`), chave `sounds/<spaceId>/<soundId>`. Download autenticado só para membros do espaço, com `Cache-Control` imutável (o id muda se o som muda — editar áudio = som novo; editar só nome/emoji não muda o arquivo).

Rotas (sob o padrão REST atual):

- `GET /spaces/:id/sounds` — lista (membros).
- `POST /spaces/:id/sounds` — upload multipart (WAV + name + emoji) — `MANAGE_SOUNDBOARD`.
- `PATCH /spaces/:id/sounds/:soundId` — name/emoji — `MANAGE_SOUNDBOARD`.
- `DELETE /spaces/:id/sounds/:soundId` — `MANAGE_SOUNDBOARD`.
- `GET /spaces/:id/sounds/:soundId/audio` — bytes.
- `POST /channels/:channelId/soundboard/play` — §5.1.

Gateway: `SPACE_SOUNDS_UPDATE` (lista mudou) para membros do espaço; `SOUNDBOARD_PLAY` para quem está no canal de voz.

Moderação: sons entram no fluxo de denúncia existente (`trust-safety.ts`) como os anexos — se for simples reaproveitar; senão, registrar como lacuna. Quem tem `MANAGE_SOUNDBOARD` apaga qualquer som do espaço.

### 5.5 Pacote padrão "Alga" [dono: nada genérico; como fazer é minha escolha]

- ~12 sons originais, sempre disponíveis em todo espaço, numa seção própria do painel ("Alga"), não contam no limite de 24.
- Embarcados no app (assets do renderer), mesmo formato WAV, já normalizados, ids fixos (`alga:<slug>`). Um manifesto em `packages/shared` (id, nome, emoji, `durationMs`) é a fonte que o servidor usa para validar ids e calcular o cooldown.
- [minha escolha] **O pacote não bloqueia a primeira entrega**: a fatia de sons do espaço sai primeiro (seção "Alga" oculta enquanto o manifesto estiver vazio); o pacote é uma fatia própria no fim, depois da aprovação de créditos e da escuta do dono.
- Produção: efeitos e vinhetas gerados com ElevenLabs (sound effects) e/ou vozes curtas geradas, curados por ouvido, com loudness alinhado aos sons do usuário. Personalidade de "grupo de amigos brasileiro": reação, drama, vitória, fail, suspense, aplauso, risada, "tá de sacanagem", corneta etc. Lista final, nomes e emojis: o builder propõe ao dono **ouvindo**, antes de embarcar.
- Gera custo de créditos ElevenLabs do dono: pedir confirmação antes de gerar o lote.
- Nenhum sample de terceiros, nenhum clipe de meme existente.

### 5.6 Experiência

**Abrir:** botão de soundboard na `ControlsDock` da call (só em canais de voz de espaço), atalho de teclado configurável [minha escolha: sem atalho padrão para não conflitar; opcional nas configurações de atalhos se o mecanismo de hotkeys existente permitir barato]. Abre um popover ancorado ao botão (não um modal), fecha com Esc/clique fora, mantém foco acessível.

**Painel:**
- Seções: "Deste espaço" e "Alga". Busca aparece quando há > 12 sons.
- Grade de tiles: emoji grande, nome, duração discreta. Hover = pré-escuta só para você (botão de fone no canto do tile); clique = tocar para todos.
- Ao tocar: o tile dá um "pulse" curto e uma barra de progresso do som atravessa o tile; depois, o cooldown aparece como um anel/preenchimento esvaziando sobre **todos** os tiles (você está em cooldown, não o som). Tudo com `prefers-reduced-motion` respeitado (sem pulse, só estado).
- Rodapé: slider de volume do soundboard + toggle "silenciar soundboard" (por ouvinte, salvo nas prefs de mídia).
- Para quem tem `MANAGE_SOUNDBOARD`: tile "+ Adicionar som" e menu por tile (renomear, emoji, apagar com confirmação inline — sem `confirm()` nativo). Contador "8/24".
- Sem permissão de usar (ou server-muted): painel abre em modo só leitura com o motivo em uma linha.

**Quem tocou:** no `CallStage`, no tile/avatar de quem tocou, o emoji do som sobe e desvanece (≈1 s) e o avatar ganha um anel suave durante o som. Ouvintes com soundboard silenciado também veem isso (assim sabem que algo tocou). Um item curto no `VoiceAnnouncer` para leitores de tela ("Ana tocou Corneta").

**Editor de upload (o ponto alto):**
1. Arrastar arquivo (mp3, wav, ogg, m4a, webm — o que o `decodeAudioData` do Chromium decodificar) ou escolher. Até 20 MB / 10 min de entrada; erro claro se não decodificar.
2. Forma de onda do arquivo inteiro, com janela selecionada de até 5 s; arrastar alças de início/fim, arrastar a janela inteira, zoom (roda do mouse/pinça) para cortar no milissegundo. Teclado: setas movem alças.
3. Play/pause do trecho, loop opcional, cursor de reprodução animado sobre a onda.
4. Fade in / fade out (0–500 ms), ganho manual ±.
5. **Normalização automática** de loudness ligada por padrão (alvo único para todos os sons, incluindo os padrão; medir RMS/LUFS aproximado em JS) com limiter de pico para não estourar.
6. Nome (pré-preenchido do nome do arquivo, limpo) e emoji (seletor de emoji existente no app, se houver).
7. Salvar: o app renderiza o trecho final (OfflineAudioContext → mono 48 kHz → WAV 16-bit), envia, e o novo tile aparece no painel com uma entrada suave. Erros do servidor viram mensagens humanas no lugar certo.

Responsivo: painel e editor funcionam desde a largura mínima da janela do app até tela cheia; o editor vira coluna única em janelas estreitas.

Textos: pt-BR, tom do app, em `strings.ts` do recurso.

## 6. Onde mora no código (pontos de partida, não exaustivo)

- Novo recurso: `apps/desktop/src/renderer/src/features/soundboard/` (painel, editor, store, strings, player).
- Player: separado de `media/sounds.ts` (cues sintetizadas) mas reaproveitando o padrão de AudioContext + sinkId.
- Call UI: `features/voice/ControlsDock.tsx`, `CallStage.tsx`, `VoiceAnnouncer.tsx`.
- Cargos: `features/spaceSettings/permissions.ts`, `Roles.tsx`.
- Servidor: rotas novas em `apps/server/src/routes/`, estado de voz em `voice.ts` (quem está em qual canal, mute de servidor), gateway `gateway/hub.ts`, tipos em `packages/shared/src/gateway.ts` e `api.ts`, schema em `db/schema.ts` + `drizzle/`.

## 7. Testes e verificação [dono: ponta a ponta]

- Unit (vitest): validador de WAV (válido, mono errado, sample rate errado, longo demais, truncado, lixo com cabeçalho falso); regras de cooldown/teto/rajada; permissões; encoder WAV e normalização no cliente; lógica de janela do editor (limites, 5 s, zoom).
- Servidor com Postgres (`vitest.pg.config.ts`): CRUD de sons, limites 24, isolamento entre espaços (não tocar som de outro espaço, não baixar som de espaço onde não é membro), play só estando no canal, migração do bit para @everyone.
- E2E real: script novo em `apps/desktop/scripts/` usando o **QA stack isolado** (`scripts/qa-stack.mjs`, API :4340, LiveKit :7940 — não toca o stack de dev nem o trabalho da outra IA). Dois clientes numa call: A sobe um som pelo editor, B vê o tile aparecer; A toca, B recebe e **o áudio realmente sai** (medir via nó analisador/telemetria no player); cooldown visível e imposto; B silencia o soundboard e não ouve mas vê o indicador; ensurdecido não ouve; E2EE ligado funciona igual.
- Visual: screenshots do painel e do editor (estados vazio, cheio, cooldown, erro, sem permissão, janela estreita) comparados com o padrão Linear antes de mostrar ao dono.
- Ao vivo com o dono: instância de teste separada (QA stack + um segundo perfil) aberta na máquina dele para ver cada etapa em tempo real.

## 8. Restrições

- Outra IA trabalha em paralelo em pagamentos/billing com muitos arquivos não commitados em `main`. Trabalhar num **git worktree/branch próprio** (`feat/soundboard`) e não editar arquivos de billing. Arquivos compartilhados que vamos tocar (`db/schema.ts`, `permissions.ts`, `gateway.ts`, `api.ts`, `config.ts`) — mudanças pequenas e aditivas para o merge ser trivial; número da migração decidido no merge.
- Economia de tokens: no máximo 2–3 agentes em paralelo; entregar fatias verificadas cedo (memória `token-budget-lean`).
- Sem dependências novas sem necessidade (decodificar/encodar/forma de onda com WebAudio + canvas).
- Acessibilidade: tudo operável por teclado, rótulos ARIA, reduced-motion.

## 9. Fica a cargo do builder

Ordem de entrega das fatias, nomes internos, desenho exato das animações dentro das regras acima, algoritmo de loudness, estrutura do store, formato exato dos erros (seguindo `errors.ts`), se o pré-carregamento é na entrada da call ou na abertura do painel, e a lista proposta do pacote "Alga" (aprovada pelo dono ouvindo).
