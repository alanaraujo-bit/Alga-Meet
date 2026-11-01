# @alga/server

API REST (`/api/v1`) + gateway WebSocket (`/gateway`) + integração LiveKit do Alga Meet.
Contrato (modelos, rotas, eventos, permissões): `packages/shared/src`.

## Rodar

```sh
node scripts/livekit.mjs          # na raiz: SFU local (baixa o binário na 1ª vez)
npm run dev -w apps/server        # API em http://127.0.0.1:4000 (tsx watch)
npm test -w apps/server           # vitest (PGlite em memória)
npm run typecheck -w apps/server
npm run build -w apps/server && node apps/server/dist/index.js   # bundle de produção
npm run db:generate -w apps/server  # nova migração após mudar src/db/schema.ts
```

Migrações (`drizzle/`) são aplicadas automaticamente na subida. Sem `DATABASE_URL` o banco é PGlite em
`apps/server/data/pglite` (ignorado pelo git); com `DATABASE_URL` usa Postgres 16+ via `node-postgres` (mesmo SQL).

## Ambiente

Ver `.env.example` (copie para `.env`; é carregado automaticamente). Validação em `src/config.ts` (zod):
`PORT`, `HOST`, `LOG_LEVEL`, `TRUST_PROXY`, `DATABASE_URL`, `PGLITE_DIR` (`memory://` = efêmero), `LIVEKIT_URL`
(servidor→SFU), `LIVEKIT_PUBLIC_URL` (vai para o cliente), `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `CORS_ORIGINS`,
`HEARTBEAT_INTERVAL_MS`. Em `NODE_ENV=production`, `DATABASE_URL` e um `LIVEKIT_API_SECRET` diferente do de dev são obrigatórios.

## Módulos

| Arquivo | Papel |
|---|---|
| `src/index.ts` | `listen`, `.env`, shutdown gracioso (SIGINT/SIGTERM, 10 s), reconcile de voz com o LiveKit |
| `src/app.ts` | `buildApp(config)`: Fastify, CORS, rate limit, websocket, contextos público/autenticado |
| `src/config.ts` | env → `Config` |
| `src/db/` | schema Drizzle, driver (pg/PGlite), migrator, detecção de unique violation |
| `src/errors.ts` | `HttpError`, formato `ApiError`, zod → `fields`, `idParam` |
| `src/auth.ts` | argon2id (m=19 MiB, t=2), token opaco de 32 bytes (só SHA-256 no banco), hook `onRequest` |
| `src/access.ts` | permissões (`computePermissions`/`hasPermission`), acesso a espaço/canal, bloqueios, audiências de fan-out |
| `src/views.ts` | linhas → modelos do contrato; snapshots de espaço; `Reaction.me` por destinatário |
| `src/gateway/` | registro de conexões, fan-out, presença; handshake, heartbeat, READY, ops `presence`/`voice_state` |
| `src/voice.ts` | tokens LiveKit, verificação de webhook, `VoiceState` autoritativo, CALL_RING, kicks/limpeza de salas |
| `src/routes/` | `auth`, `users` (perfil, relacionamentos, DMs), `spaces` (espaços, membros, canais, convites), `messages`, `voice` |

Regras principais: dono não sai (exclui); `@everyone` tem id = id do espaço; canais padrão `geral` (texto) e
`Geral` (voz, 64 kbps); bloqueio impede pedido de amizade, DM, mensagens, reações, digitação e chamada; DM 1:1 é
idempotente (`dm_key` único); mensagens paginadas por UUIDv7; menções `<@userId>` contam em `read_states`;
convites base62 de 8 caracteres com incremento condicional de `uses` (sem corrida acima de `maxUses`).
Rate limit: 10/min/IP em `register`/`login`; 10 mensagens/10 s por usuário.

## Testes (`test/`, 47 casos)

Auth (registro, login sem enumeração, rate limit, sessões, revogação fecha socket com 4004, logout), handshake do
gateway (4001/4002/4003, heartbeat), CORS, amizades (ciclo completo, bloqueio, desbloqueio), DMs (idempotência,
grupo, READY.users), presença (`invisible` → `offline`), espaços (criação, permissões negadas, canais, kick/leave,
exclusão), convites (preview público, join idempotente, expirado, `maxUses`), mensagens (MESSAGE_CREATE em outro
socket, paginação, edição/remoção, reações com `me` por usuário, digitação com throttle, ack/menções, DMs, rate limit),
voz (grants do JWT por permissão, limite de usuários, DM, webhook com assinatura inválida/adulterada,
participant_joined/left/room_finished → VOICE_STATE_*, troca de canal, CALL_RING, kick derruba voz).

## Lacunas conhecidas

- **Anexos/uploads fora de escopo**: `attachments` é sempre `[]` e não há rota de upload.
- Sem rotas de cargos (roles), apelidos, ban ou moderação de voz (`serverMute`/`serverDeaf` sempre `false`);
  `ROLE_*` e `MEMBER_UPDATE` nunca são emitidos. As permissões já consideram `member_roles`.
- Estado de voz, conexões e throttle de digitação ficam em memória: uma instância só. Para escalar, Redis pub/sub.
- Gateway sem `resume`: reconexão recebe um READY novo (como no contrato).
- Sem troca de senha/verificação de e-mail; contadores de menção não diminuem quando a mensagem é apagada.
