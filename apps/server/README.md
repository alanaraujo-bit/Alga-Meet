# @alga/server

API REST (`/api/v1`) + gateway WebSocket (`/gateway`) + integração LiveKit do Alga Meet.
Contrato (modelos, rotas, eventos, permissões): `packages/shared/src`.

## Rodar

```sh
node scripts/livekit.mjs          # na raiz: SFU local (baixa o binário na 1ª vez)
npm run dev -w apps/server        # API em http://127.0.0.1:4000 (tsx watch, passa --dev → NODE_ENV=development)
npm test -w apps/server           # vitest (PGlite em memória)
npm run typecheck -w apps/server
npm run build -w apps/server && NODE_ENV=development node apps/server/dist/index.js   # bundle (sem NODE_ENV = produção)
npm run db:generate -w apps/server  # nova migração após mudar src/db/schema.ts
```

Migrações (`drizzle/`) são aplicadas automaticamente na subida. Sem `DATABASE_URL` o banco é PGlite em
`apps/server/data/pglite` (ignorado pelo git); com `DATABASE_URL` usa Postgres 16+ via `node-postgres` (mesmo SQL).

## Ambiente

Ver `.env.example` (copie para `.env`; é carregado automaticamente). Validação em `src/config.ts` (zod):
`PORT`, `HOST`, `LOG_LEVEL`, `TRUST_PROXY`, `DATABASE_URL`, `PGLITE_DIR` (`memory://` = efêmero), `LIVEKIT_URL`
(servidor→SFU), `LIVEKIT_PUBLIC_URL` (vai para o cliente), `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`,
`ALGA_ALLOW_DEV_SECRETS`, `CORS_ORIGINS`, `HEARTBEAT_INTERVAL_MS`.

Falha fechada:
- **Sem `NODE_ENV` o servidor é produção**: exige `DATABASE_URL`, `CORS_ORIGINS` e `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET`
  reais. `npm run dev` passa `--dev`.
- A chave `devkey` e o segredo de `infra/livekit/livekit.dev.yaml` (públicos) só são aceitos com `NODE_ENV=development`
  ou `test` **e** `HOST` loopback, ou com `ALGA_ALLOW_DEV_SECRETS=1` (ex. teste em LAN com `HOST=0.0.0.0`).
- `TRUST_PROXY`: `false` (padrão), IPs/CIDRs do proxy (`10.0.0.0/8,100.64.0.0/10`) ou número de saltos (`1`; só é
  seguro se a API não for alcançável sem o proxy). `true` é recusado: confiaria em qualquer `X-Forwarded-For`.

## Módulos

| Arquivo | Papel |
|---|---|
| `src/index.ts` | `listen`, `.env`, `--dev`, shutdown gracioso (SIGINT/SIGTERM, 10 s), reconcile de voz com o LiveKit |
| `src/app.ts` | `buildApp(config)`: Fastify, CORS, rate limit global, websocket, logger sem segredos, contextos público/autenticado |
| `src/config.ts` | env → `Config` (guardas de produção acima) |
| `src/db/` | schema Drizzle, driver (pg/PGlite), migrator, detecção de unique violation |
| `src/errors.ts` | `HttpError`, formato `ApiError`, zod → `fields`, `idParam`, `safeErr`/`safeUrl` para logs |
| `src/auth.ts` | argon2id (m=19 MiB, t=2), token opaco de 32 bytes (só SHA-256 no banco), expiração, hook `onRequest` |
| `src/access.ts` | permissões, hierarquia de cargos (`requireActor`, `assertOutranks`), acesso a espaço/canal, bloqueios, audiências |
| `src/views.ts` | linhas → modelos do contrato; snapshots de espaço; `Reaction.me` por destinatário |
| `src/gateway/` | conexões, fan-out, presença, `Throttle`; handshake, heartbeat, limites, READY, ops `presence`/`voice_state` |
| `src/voice.ts` | tokens/grants LiveKit, webhook (assinatura + dedupe), `VoiceState` autoritativo, limite de usuários, moderação no SFU |
| `src/routes/` | `auth`, `users` (perfil, relacionamentos, DMs), `spaces` (espaços, membros, canais, convites), `roles` (cargos, apelidos), `moderation` (bans, voz), `messages`, `voice` |

## Regras principais

- Dono não sai (exclui); `@everyone` tem id = id do espaço e posição 0; canais padrão `geral` (texto) e `Geral` (voz, 64 kbps).
- **Cargos**: maior `position` manda. Fora o dono, só se cria/edita/exclui/atribui/reordena cargo abaixo do seu mais
  alto, só se concede permissão que se tem, e kick/ban/apelido de outro exigem estar acima do alvo. Cargo novo nasce
  na posição 1. `ROLE_UPSERT`/`ROLE_DELETE`/`MEMBER_UPDATE` vão para os membros. Apelido próprio: `CHANGE_NICKNAME`
  (padrão do @everyone); de outros: `MANAGE_NICKNAMES`. Sem overwrites de permissão por canal (fora de escopo).
- **Ban** (`space_bans`): remove o membro (voz no LiveKit incluída) e seus convites; `POST /invites/:code` recusa.
- **Moderação de voz**: `serverMute`/`serverDeaf` ficam no membro (valem nas próximas entradas) e são aplicados no
  SFU: o token e `updateParticipant` tiram `microphone` de `canPublishSources` / `canSubscribe`, e um microfone já
  publicado é mutado. Mudança de cargo reaplica as permissões de quem está em voz (sem `CONNECT` → desconecta).
  Mover: `VOICE_MOVE {channelId}` ao usuário, que sai da sala atual e pode entrar no destino mesmo cheio por 60 s.
  Desconectar: `VOICE_DISCONNECT {channelId, reason}`. `userLimit` é conferido no `participant_joined` (o excedente
  é removido do SFU com `reason: 'channel_full'`).
- DMs: 1:1 nova exige amizade ou espaço em comum; grupo exige que todos sejam amigos do criador;
  `DELETE /channels/:id/recipients/@me` sai do grupo. Bloqueio impede pedido de amizade, DM, mensagens, edição,
  reações, digitação e chamada. DM 1:1 é idempotente (`dm_key` único).
- Mensagens paginadas por UUIDv7; menções `<@userId>` contam em `read_states`; reações = 1 emoji RGI, até 20
  diferentes por mensagem; `avatarUrl`/`iconUrl` só `https:`.
- **Sessões** expiram após 30 dias sem uso ou 90 dias do login; `POST /auth/password` revoga as outras;
  `DELETE /auth/sessions` revoga todas menos a atual; sem sessão o usuário sai da voz e o token LiveKit antigo não
  reentra.
- **Rate limit** (chave = usuário autenticado, ou IP em rotas públicas): teto global 200/min; `register`/`login`
  10/min/IP + 10 logins falhos/15 min por conta; mensagens 10/10 s; reações 10/5 s; `PATCH /users/@me`, pedidos de
  amizade, DMs, `POST /invites/:code` e `/voice/join` 10/min; preview de convite 30/min/IP; espaços 10/h; convites
  20/h; troca de senha 5/15 min. Webhook do LiveKit e `/health` sem limite.
- **Gateway**: `identify` em até 10 s; 120 frames/60 s por socket e 10 sockets por usuário (senão 4008);
  `presence`/`voice_state` no máximo 1 fan-out/s por usuário (o último valor vence); cliente que não lê (buffer >
  1 MiB) é derrubado. `voice_state` sem mudança não emite; `streaming`/`video` exigem `STREAM`/`SPEAK`.
- Tokens LiveKit sem `canPublishData`. Webhooks repetidos (mesmo `id`) são ignorados por 10 min.
- Logs: sem corpo, sem `authorization`, sem parâmetros SQL nem `detail` do Postgres, código de convite redigido.

## Testes (`test/`, 87 casos)

Auth, handshake do gateway, CORS, amizades, bloqueio, DMs, presença, espaços, convites, mensagens, voz (grants,
limite, DM, webhook, VOICE_STATE_*, CALL_RING, kick derruba voz). `security.test.ts` (30): uma regressão por achado
de `docs/security/server-review-2026-11-01.md`. `moderation.test.ts` (10): cargos (CRUD, hierarquia, reordenação),
apelidos, ban/unban/kick, mute/deafen/mover/desconectar com as chamadas ao `RoomServiceClient` conferidas.

## Smoke com LiveKit real (server mute)

Com `node scripts/livekit.mjs` e `npm run dev -w apps/server` rodando: registrar dono + membro, criar espaço,
convidar, `POST /voice/join` do membro; um Chromium headless (Playwright, `--use-fake-device-for-media-stream`) entra
na sala com `livekit-client` e publica o microfone; o dono chama `PATCH /spaces/:id/members/:userId/voice
{serverMute:true}`. Verificado em 2026-11-01 via `RoomServiceClient.listParticipants`: `canPublishSources` passa a
`[CAMERA, SCREEN_SHARE, SCREEN_SHARE_AUDIO]`, o SFU despublica o microfone e a nova tentativa do cliente falha com
`insufficient permissions`; com `serverMute:false` o cliente volta a publicar.

## Lacunas conhecidas

- **Anexos/uploads fora de escopo**: `attachments` é sempre `[]` e não há rota de upload (avatar/ícone só por URL https).
- Overwrites de permissão por canal ainda não existem (permissões valem para o espaço inteiro).
- Estado de voz, conexões, throttles e contadores de rate limit ficam em memória: uma instância só. Para escalar,
  Redis (pub/sub + store do `@fastify/rate-limit`).
- Gateway sem `resume`: reconexão recebe um READY novo (como no contrato).
- Sem verificação de e-mail; registro ainda diz qual campo está em uso (B5) e senha só exige 8 caracteres (B10).
- Contadores de menção não diminuem quando a mensagem é apagada.
