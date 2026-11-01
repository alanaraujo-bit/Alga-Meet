# @alga/server

API REST (`/api/v1`) + gateway WebSocket (`/gateway`) + integração LiveKit do Alga Meet.
Contrato (modelos, rotas, eventos, permissões): `packages/shared/src`.

## Rodar

```sh
node scripts/livekit.mjs          # na raiz: SFU local (baixa o binário na 1ª vez)
npm run dev -w apps/server        # API em http://127.0.0.1:4000 (tsx watch, passa --dev → NODE_ENV=development)
npm test -w apps/server           # vitest (PGlite em memória, rápido)
npm run test:pg -w apps/server    # mesma suíte num PostgreSQL 18 real (embedded-postgres: porta aleatória, dir temporário)
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
`ALGA_ALLOW_DEV_SECRETS`, `CORS_ORIGINS`, `HEARTBEAT_INTERVAL_MS`, `PUBLIC_URL`, `FILES_SECRET`, `FILE_URL_TTL_SECONDS`,
`MAX_ATTACHMENT_BYTES`, `STORAGE_DRIVER` (`local` | `s3`), `UPLOADS_DIR`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`,
`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_URL_STYLE` (`virtual` | `path`).

Falha fechada:
- **Sem `NODE_ENV` o servidor é produção**: exige `DATABASE_URL`, `CORS_ORIGINS`, `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET`
  reais, `PUBLIC_URL` https, `FILES_SECRET` e `STORAGE_DRIVER` explícito (`s3` exige as 4 variáveis `S3_*`). O banco
  precisa ser UTF8 (a subida falha caso contrário). `npm run dev` passa `--dev`.
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
| `src/views.ts` | linhas → modelos do contrato; snapshots de espaço; `Reaction.me` e `Attachment.url` por destinatário |
| `src/storage.ts` | `Storage` (put/get com Range/delete): `LocalStorage` (disco) e `S3Storage` (SigV4 via `aws4fetch`, SHA-256 do corpo conferido pelo bucket) |
| `src/files.ts` | spool do multipart em arquivo temporário, tipo real (`file-type`) e dimensões (`image-size`), nome sanitizado, URL assinada (HMAC), cabeçalhos dos arquivos, fila `storage_deletions` + `sweep` |
| `src/gateway/` | conexões, fan-out, presença, `Throttle`; handshake, heartbeat, limites, READY, ops `presence`/`voice_state` |
| `src/voice.ts` | tokens/grants LiveKit, webhook (assinatura + dedupe), `VoiceState` autoritativo, limite de usuários, moderação no SFU |
| `src/routes/` | `auth`, `users` (perfil, relacionamentos, DMs), `spaces` (espaços, membros, canais, convites), `roles` (cargos, apelidos), `moderation` (bans, voz), `messages` (inclui envio multipart), `files` (download assinado, avatares/ícones), `voice` |

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
- **Relacionamentos**: cada `POST/PUT/DELETE /relationships` lê os dois sentidos dentro de uma transação com
  `pg_advisory_xact_lock` do par (B2): pedido × bloqueio concorrentes não deixam pedido pendente, e pedidos simultâneos
  dos dois lados viram amizade (antes: deadlock → 500).
- DMs: 1:1 nova exige amizade ou espaço em comum; grupo exige que todos sejam amigos do criador;
  `DELETE /channels/:id/recipients/@me` sai do grupo. Bloqueio impede pedido de amizade, DM, mensagens, edição,
  reações, digitação e chamada. DM 1:1 é idempotente (`dm_key` único).
- Mensagens paginadas por UUIDv7; menções `<@userId>` contam em `read_states`; reações = 1 emoji RGI, até 20
  diferentes por mensagem.
- **Anexos** (`POST /channels/:id/messages` multipart: `payload_json` + até 10 `files`, contrato em `api.ts`): exige
  `SEND_MESSAGES` + `ATTACH_FILES`, conferidos antes de ler o corpo. Cada arquivo vai para um temporário (SHA-256 e
  tamanho; 413 acima de `MAX_ATTACHMENT_BYTES`), o tipo vem dos bytes (`file-type`; o `Content-Type` e a extensão do
  cliente são ignorados), imagens ganham `width`/`height` (rotação EXIF aplicada). O `contentType` gravado é como o
  arquivo é servido: mídia segura (png/jpeg/gif/webp/avif, mp4/webm, áudio) ou `application/octet-stream`; HTML, SVG,
  PDF, executáveis, desconhecidos e imagens enormes (> 16384 px ou > 50 MP) viram download. Nome: último segmento, sem
  controle/bidi/zero-width/reservados do Windows, ≤ 128 caracteres; mídia recebe a extensão real (`x.html` PNG →
  `x.png`). Chave no storage: `attachments/<canal>/<id>` (nunca o nome do usuário).
- **Download** `GET /files/:id?uid=&exp=&sig=`: HMAC-SHA256(`FILES_SECRET`) de arquivo + leitor + expiração (1 h,
  arredondada em 5 min para a URL se repetir e o cache funcionar), comparação em tempo constante; depois confere que
  `uid` ainda vê o canal (expulso → 404). Resposta com `nosniff`, `CSP: default-src 'none'; sandbox`,
  `Content-Disposition` (inline só para mídia), `Cache-Control: private` até a expiração, `Range` simples. O `sig` é
  redigido dos logs.
- **Avatares e ícones** (`PUT /users/@me/avatar`, `PUT /spaces/:id/icon`, campo `file`): png/jpeg/webp/gif pelos bytes
  (SVG recusado), ≤ 8 MiB, ≤ 4096 px por lado; nome aleatório de 128 bits, servidos públicos e `immutable` em
  `/avatars/:userId/:arquivo` e `/icons/:spaceId/:arquivo`. `avatarUrl`/`iconUrl` só aceitam `null` ou uma URL nossa do
  mesmo usuário/espaço (M9; a migração 0002 limpou as URLs externas antigas). Trocar/remover enfileira o objeto antigo.
- **Remoção no storage**: apagar mensagem, canal ou espaço remove as linhas de `attachments` (cascade) e um trigger
  as coloca em `storage_deletions`; `Files.sweep` (a cada minuto e logo após exclusões) apaga do bucket e só tira da
  fila em caso de sucesso. Falha fica com `attempts`/`last_error`, backoff de 1 min a 1 dia e `warn` no log (`error`
  a partir de 10 tentativas). Uploads entram na fila 1 h adiante antes de ir ao bucket e saem dela na transação que os
  referencia: uma queda no meio do caminho também é limpa.
- **Sessões** expiram após 30 dias sem uso ou 90 dias do login; `POST /auth/password` revoga as outras;
  `DELETE /auth/sessions` revoga todas menos a atual; sem sessão o usuário sai da voz e o token LiveKit antigo não
  reentra.
- **Rate limit** (chave = usuário autenticado, ou IP em rotas públicas): teto global 200/min; `register`/`login`
  10/min/IP + 10 logins falhos/15 min por conta; mensagens 10/10 s; reações 10/5 s; `PATCH /users/@me`, pedidos de
  amizade, DMs, `POST /invites/:code` e `/voice/join` 10/min; preview de convite 30/min/IP; espaços 10/h; convites
  20/h; troca de senha 5/15 min; 30 arquivos anexados/10 min por usuário; avatar/ícone 5/min; downloads de
  arquivo/avatar/ícone 1200/min/IP (uma página de chat carrega muitos de uma vez). Webhook do LiveKit e `/health` sem
  limite.
- **Gateway**: `identify` em até 10 s; 120 frames/60 s por socket e 10 sockets por usuário (senão 4008);
  `presence`/`voice_state` no máximo 1 fan-out/s por usuário (o último valor vence); cliente que não lê (buffer >
  1 MiB) é derrubado. `voice_state` sem mudança não emite; `streaming`/`video` exigem `STREAM`/`SPEAK`.
- Tokens LiveKit sem `canPublishData`. Webhooks repetidos (mesmo `id`) são ignorados por 10 min.
- Logs: sem corpo, sem `authorization`, sem parâmetros SQL nem `detail` do Postgres, código de convite redigido.

## Testes (`test/`, 104 casos)

`npm test` roda em PGlite; `npm run test:pg` roda os mesmos casos num PostgreSQL 18 real (`test/pg-setup.ts`: um
cluster UTF8 descartável por execução, um banco por `startServer`). Os dois passam.

Auth, handshake do gateway, CORS, amizades, bloqueio, DMs, presença, espaços, convites, mensagens, voz (grants,
limite, DM, webhook, VOICE_STATE_*, CALL_RING, kick derruba voz). `security.test.ts` (32): uma regressão por achado
de `docs/security/server-review-2026-11-01.md`, incluindo a corrida B2 com 20 pares concorrentes (reproduzida no PG
real antes da correção). `moderation.test.ts` (10): cargos (CRUD, hierarquia, reordenação), apelidos, ban/unban/kick,
mute/deafen/mover/desconectar com as chamadas ao `RoomServiceClient` conferidas. `uploads.test.ts` (15): anexos
(tipo real, nomes, dimensões, URL por leitor), authz (não membro, sem `ATTACH_FILES`, expulso), spoofing
(HTML/SVG/PDF como `.png`, imagem como `.html`, imagem gigante), teto de tamanho e de quantidade (413, sem sobras),
URL adulterada/expirada, `Range`, remoção (mensagem, espaço, falha do bucket com retentativa), avatar/ícone e o driver
S3 contra um S3 falso que confere SigV4 e o SHA-256 do corpo.

## Smoke com LiveKit real (server mute)

Com `node scripts/livekit.mjs` e `npm run dev -w apps/server` rodando: registrar dono + membro, criar espaço,
convidar, `POST /voice/join` do membro; um Chromium headless (Playwright, `--use-fake-device-for-media-stream`) entra
na sala com `livekit-client` e publica o microfone; o dono chama `PATCH /spaces/:id/members/:userId/voice
{serverMute:true}`. Verificado em 2026-11-01 via `RoomServiceClient.listParticipants`: `canPublishSources` passa a
`[CAMERA, SCREEN_SHARE, SCREEN_SHARE_AUDIO]`, o SFU despublica o microfone e a nova tentativa do cliente falha com
`insufficient permissions`; com `serverMute:false` o cliente volta a publicar.

## Lacunas conhecidas

- **Uploads sem reprocessamento**: sem biblioteca de imagem (sharp) não há re-encode nem remoção de EXIF; o GPS de um
  JPEG de celular chega aos outros. O cliente pode recortar/re-codificar avatares num canvas antes de enviar. Sem
  antivírus.
- Downloads passam pela API (controle total dos cabeçalhos), o que conta como egress do serviço no Railway
  (US$ 0,05/GB); o egress do bucket é grátis. Otimização futura: redirect para uma URL pré-assinada do bucket.
- Migrações rodam na subida sem lock: com mais de uma réplica, subir uma por vez (ou mover para `preDeploy`).
- Overwrites de permissão por canal ainda não existem (permissões valem para o espaço inteiro).
- Estado de voz, conexões, throttles e contadores de rate limit ficam em memória: uma instância só. Para escalar,
  Redis (pub/sub + store do `@fastify/rate-limit`).
- Gateway sem `resume`: reconexão recebe um READY novo (como no contrato).
- Sem verificação de e-mail; registro ainda diz qual campo está em uso (B5) e senha só exige 8 caracteres (B10).
- Contadores de menção não diminuem quando a mensagem é apagada.
