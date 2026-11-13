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

Deploy (não feito; precisa de aprovação do dono): imagem em `infra/server/Dockerfile` (build a partir da raiz do
monorepo), IaC do Railway em `infra/server/railway.ts`, passo a passo em `docs/infra/deploy.md`.

Migrações (`drizzle/`) são aplicadas automaticamente na subida. Sem `DATABASE_URL` o banco é PGlite em
`apps/server/data/pglite` (ignorado pelo git); com `DATABASE_URL` usa Postgres 16+ via `node-postgres` (mesmo SQL).

## Ambiente

Ver `.env.example` (copie para `.env`; é carregado automaticamente). Validação em `src/config.ts` (zod):
`PORT`, `HOST`, `LOG_LEVEL`, `TRUST_PROXY`, `DATABASE_URL`, `PGLITE_DIR` (`memory://` = efêmero), `LIVEKIT_URL`
(servidor→SFU), `LIVEKIT_PUBLIC_URL` (vai para o cliente), `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`,
`ALGA_ALLOW_DEV_SECRETS`, `CORS_ORIGINS`, `HEARTBEAT_INTERVAL_MS`, `PUBLIC_URL`, `FILES_SECRET`, `FILE_URL_TTL_SECONDS`,
`MAX_ATTACHMENT_BYTES`, `STORAGE_DRIVER` (`local` | `s3`), `UPLOADS_DIR`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`,
`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_URL_STYLE` (`virtual` | `path`), `EMAIL_DRIVER` (`console` | `resend`),
`ALGA_ALLOW_CONSOLE_EMAIL`, `ALGA_AUTO_VERIFY_EMAIL`, `EMAIL_OUTBOX_DIR`, `EMAIL_FROM`, `RESEND_API_KEY`, `EMAIL_LINK_URL`, `BILLING_PROVIDER`
(`none` | `sandbox` | `mercadopago`), `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `MP_API_URL`, `BILLING_RETURN_URL`, `CASA_CINEMA`,
`REQUIRE_BIRTHDATE`, `LEGAL_URL`, `METRICS_TOKEN`, `E2EE_DS_KEY`, `E2EE_MLS_PKG`, `WORLDS` (`true` | `false`),
`WORLDS_ASSETS_URL`, `WORLDS_ASSETS_DIR`.

Falha fechada:
- **Sem `NODE_ENV` o servidor é produção**: exige `DATABASE_URL`, `CORS_ORIGINS`, `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET`
  reais, `PUBLIC_URL` https, `FILES_SECRET`, `E2EE_DS_KEY` (base64 de 32 bytes aleatórios: a chave Ed25519 do Delivery
  Service; em dev/test é aleatória por processo), `STORAGE_DRIVER` explícito (`s3` exige as 4 variáveis `S3_*`) e
  `EMAIL_DRIVER` explícito (`resend` exige `RESEND_API_KEY` e `EMAIL_FROM`; `console` só com
  `ALGA_ALLOW_CONSOLE_EMAIL=1`). O banco precisa ser UTF8 (a subida falha caso contrário). `npm run dev` passa `--dev`.
- **`ALGA_AUTO_VERIFY_EMAIL=1` é só para staging fechado** (sem provedor de e-mail): `POST /auth/register` cria a conta
  já com o e-mail confirmado e não envia o link; a subida loga `staging: auto-verifying e-mails` (warn). É recusado
  sem `EMAIL_DRIVER=console` **e** `ALGA_ALLOW_CONSOLE_EMAIL=1`, então nunca convive com um provedor real. Um endereço
  já confirmado em outra conta continua não confirmado (e o dono recebe o aviso de B5), mas o `emailVerified` da
  resposta passa a distinguir os dois casos: não use com cadastro aberto.
- **Pagamentos**: em produção o padrão é `BILLING_PROVIDER=none` (checkout 503). `sandbox` é **recusado em produção**,
  sem válvula de escape (nem `ALGA_ALLOW_DEV_SECRETS`); staging usa `mercadopago` com credenciais de teste do MP.
  `mercadopago` exige `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET` e `BILLING_RETURN_URL` (https). `CASA_CINEMA=1` (1080p60
  da Casa) é recusado em produção: falta o pacote de banda, o medidor de 60 h/mês e a concessão no `voice.ts`; em
  dev só lista o perk.
- **Alga Worlds** (`src/worlds.ts`): ligado fora de produção e **desligado em produção** até `WORLDS=true` (mesma regra
  da Sala de Cinema). Desligado: `READY` não traz `worlds`, os ops `world_*` respondem `disabled` e as rotas
  `/worlds/*` dão 404. `WORLDS_ASSETS_URL` é de onde os clientes baixam o pacote 3D (URL absoluta https de um CDN, sem
  barra no fim; em produção só https); sem ela vale `/api/v1/worlds/assets`, servido por esta API a partir de
  `WORLDS_ASSETS_DIR` (padrão `assets/worlds/v1`). Sem o `manifest.json` do pacote a subida só avisa no log (warn) e a
  rota responde 404.
- A chave `devkey` e o segredo de `infra/livekit/livekit.dev.yaml` (públicos) só são aceitos com `NODE_ENV=development`
  ou `test` **e** `HOST` loopback, ou com `ALGA_ALLOW_DEV_SECRETS=1` (ex. teste em LAN com `HOST=0.0.0.0`).
- **Cadastro em produção** exige `birthDate` e `termsVersion` (`GET /legal`); fora de produção só com
  `REQUIRE_BIRTHDATE=1` (até o desktop mandar os campos, o cadastro sem eles só gera `warn` no log).
- **Métricas**: `GET /metrics` exige `Authorization: Bearer <METRICS_TOKEN>` (≥ 32 caracteres) quando o token existe;
  **em produção sem token a rota não existe** (404). Em dev/test sem token fica aberta.
- `TRUST_PROXY`: `false` (padrão), IPs/CIDRs do proxy (`10.0.0.0/8,100.64.0.0/10`) ou número de saltos (`1`; só é
  seguro se a API não for alcançável sem o proxy). `true` é recusado: confiaria em qualquer `X-Forwarded-For`.

## Módulos

| Arquivo | Papel |
|---|---|
| `src/index.ts` | `listen`, `.env`, `--dev`, shutdown gracioso (SIGINT/SIGTERM, 10 s), reconcile de voz com o LiveKit |
| `src/app.ts` | `buildApp(config)`: Fastify, CORS, rate limit global, websocket, logger sem segredos, contextos público/autenticado |
| `src/metrics.ts` | registro Prometheus sem dependência (counter/gauge/histogram, formato texto 0.0.4) e todos os instrumentos do processo |
| `src/observability.ts` | `/health` (liveness), `/ready` (banco + LiveKit), `/metrics` (bearer), hook `onResponse` (métricas HTTP + a linha `request completed` com `reqId`/`uid`/`route`), `logUserHash` |
| `src/telemetry.ts` | telemetria de qualidade de chamada opt-in: hash do usuário com sal diário em memória, só o dia, histogramas, expurgo de 30 dias |
| `src/config.ts` | env → `Config` (guardas de produção acima) |
| `src/db/` | schema Drizzle, driver (pg/PGlite), migrator, detecção de unique violation |
| `src/errors.ts` | `HttpError`, formato `ApiError`, zod → `fields`, `idParam`, `safeErr`/`safeUrl` para logs |
| `src/auth.ts` | argon2id (m=19 MiB, t=2), token opaco de 32 bytes (só SHA-256 no banco), expiração, hook `onRequest`; tokens de e-mail (`email_tokens`: emitir, conferir, consumir) e `requireVerifiedEmail` |
| `src/email.ts` | `EmailSender` (driver `console`: .eml em `EMAIL_OUTBOX_DIR` + log; `resend`: API REST), `Mailer` (cota por endereço, links, envio sem bloquear a requisição) |
| `src/email-templates.ts` | e-mails em pt-BR (texto + HTML simples): verificação, "você já tem uma conta", redefinição de senha |
| `src/passwords.ts` | política de senha (B10): lista de `src/common-passwords.ts`, repetições, sequências, nome de usuário/e-mail |
| `src/access.ts` | permissões, hierarquia de cargos (`requireActor`, `assertOutranks`), acesso a espaço/canal, bloqueios, audiências |
| `src/views.ts` | linhas → modelos do contrato; snapshots de espaço; `Reaction.me` e `Attachment.url` por destinatário |
| `src/storage.ts` | `Storage` (put/get com Range/delete): `LocalStorage` (disco) e `S3Storage` (SigV4 via `aws4fetch`, SHA-256 do corpo conferido pelo bucket) |
| `src/files.ts` | spool do multipart em arquivo temporário, tipo real (`file-type`) e dimensões (`image-size`), re-encode de imagens (`sharp`, sem metadados), nome sanitizado, URL assinada (HMAC), cabeçalhos dos arquivos, fila `storage_deletions` + `sweep` |
| `src/gateway/` | conexões, fan-out, presença, `Throttle`; handshake, heartbeat, limites, READY, ops `presence`/`voice_state` |
| `src/voice.ts` | tokens/grants LiveKit, webhook (assinatura + dedupe), `VoiceState` autoritativo, limite de usuários, moderação no SFU |
| `src/e2ee.ts` | **E2EE Delivery Service** (`docs/decisions/0004-e2ee.md`; contrato e fluxo em `packages/shared/src/e2ee.ts`; garantias e ataques em `docs/security/e2ee-delivery-service.md`): dispositivos e key packages (uso único, `SKIP LOCKED`), grupo MLS por chamada com o estado **público** (OpenMLS `PublicGroup` do `native/mls/pkg`, carregado em Node), proposals Add/Remove assinadas pelo DS, um commit por época conferido contra a árvore, Welcome só para o dispositivo adicionado, remoção imediata no hook `Voice.onLeave`, timeout do committer e reset. Sem `native/mls/pkg` a E2EE fica desligada (503) |
| `src/billing/` | `catalog.ts` (planos, preços, Coleção 01, conjuntos, Casa, coleções/ondas; versionado), `billing.ts` (motor: checkout, presentes, convites Plus, item anual, reembolsos, webhooks idempotentes, recompute de direitos, job de expiração, recibos), `casa.ts` (dias da Casa, mural, tom e convite próprio), `wishlist.ts`, `tryon.ts` (provador na chamada, em memória), `provider.ts` (interface `PaymentProvider` + `SandboxProvider`), `mercadopago.ts` (Checkout Pro + preapproval + reembolso, `x-signature`) |
| `src/legal.ts` | catálogo `LEGAL_VERSIONS` (versão + `changeSummary`; a do topo é `TERMS_VERSION`), faixa etária (`ageBracketOf`), prioridade e rótulos pt-BR dos motivos, prazos |
| `src/trust-safety.ts` | medidas na conta (`applyAction`: warn/suspend/ban/lift aplicados em login, sessões, gateway 4010 e voz), token de recurso, quarentena de anexos com cópia em `evidence/` + SHA-256 e liberação (falso positivo), retenção legal, `setStaffRole` |
| `src/privacy.ts` | registros de acesso (Marco Civil art. 15), exclusão de conta (carência + expurgo), exportação (zip + link assinado por e-mail; no app, só com a senha), job de retenção |
| `src/zip.ts` | escritor de ZIP mínimo (deflate, sem zip64) para a exportação |
| `scripts/grant-staff.ts` | único jeito de dar/tirar `staff_role` (`npx tsx scripts/grant-staff.ts <username> <admin\|moderator\|none>`; com PGlite, pare o servidor antes) |
| `src/routes/` | `auth` (inclui verificação de e-mail e redefinição de senha), `users` (perfil, relacionamentos, DMs), `spaces` (espaços, membros, canais, convites, listar/revogar convites), `roles` (cargos, apelidos), `moderation` (bans, voz), `messages` (inclui envio multipart), `files` (download assinado, avatares/ícones), `voice`, `e2ee` (dispositivos e key packages), `billing`, `privacy` (idade, aceite, exclusão, exportação, `/legal`), `reports` (denúncias, medidas da própria conta, recursos), `admin` (equipe, auditado), `telemetry` (relatório de qualidade de chamada) |

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
- **E2EE por chamada** (0004 §5.1 fase 5a): `VoiceJoinResponse.e2ee` e o atributo `alga.e2ee` do token
  (`'true'`/`'false'`) dizem se a chamada é de ponta a ponta. DM e grupo: sempre; canal de voz: `Space.e2ee` (coluna
  `spaces.e2ee`, padrão `false`, `PATCH /spaces/:id` com `MANAGE_SPACE`); nenhuma sem o módulo MLS
  (`Voice.callE2ee`). O DS só cria grupo para chamada E2EE; `e2ee_join` em outra → `E2EE_RESYNC_REQUIRED not_e2ee`.
  `capabilities.e2ee: false` numa chamada E2EE → 409 `fields['capabilities.e2ee'] = 'required'` (sem `capabilities`,
  cliente antigo, nada é recusado). **Mudou `Space.e2ee` com gente em voz**: ninguém sai da sala; quem está em cada
  canal recebe `VOICE_E2EE_CHANGED {channelId, e2ee}` e deve reentrar (`POST /voice/join` → token e flag novos);
  desligar descarta o grupo MLS e os dispositivos dele recebem `not_e2ee`; ligar forma o grupo conforme reentram.
  Um `participant_joined` com `alga.e2ee` diferente do atual (token emitido antes da mudança) também recebe
  `VOICE_E2EE_CHANGED`. Até todos reentrarem a sala fica mista (o cliente E2EE acusa os outros em `e2ee.mismatch`).
- **Codecs que o cliente decodifica**: `capabilities.decode` (os `mimeType` de `RTCRtpReceiver.getCapabilities`, até
  64, formato `video/<nome>`) vira o atributo `alga.decode` (`h265,h264,…`, só os de `DECODE_CODECS`, sem repetição;
  vazio = nenhum dos nossos). Sem `capabilities` o atributo não vai e vale o nome da publicação do microfone.
- **Relacionamentos**: cada `POST/PUT/DELETE /relationships` lê os dois sentidos dentro de uma transação com
  `pg_advisory_xact_lock` do par (B2): pedido × bloqueio concorrentes não deixam pedido pendente, e pedidos simultâneos
  dos dois lados viram amizade (antes: deadlock → 500).
- DMs: 1:1 nova exige amizade ou espaço em comum; grupo exige que todos sejam amigos do criador;
  `DELETE /channels/:id/recipients/@me` sai do grupo. Bloqueio impede pedido de amizade, DM, mensagens, edição,
  reações, digitação e chamada. DM 1:1 é idempotente (`dm_key` único).
- **E-mail** (`src/email.ts`; contrato em `api.ts`): tokens opacos de 32 bytes, só o SHA-256 em `email_tokens`, um vivo
  por usuário e tipo (emitir outro invalida o anterior), uso único por um `DELETE … RETURNING`. O e-mail sai depois da
  resposta (mesmo tempo de resposta em todos os casos; provedor fora do ar não derruba a requisição, só gera `error` no
  log) e cada endereço recebe no máximo 3 e-mails por hora por fluxo (verificação, redefinição), conferido **antes** de
  emitir o token: inundar pedidos não enche a caixa nem invalida o link que o dono já recebeu. Nenhum texto escolhido
  pelo usuário (nome, username de quem pediu) vai num e-mail que pode cair na caixa de outra pessoa.
  - **Verificação** (24 h): o cadastro manda o link `EMAIL_LINK_URL/verify-email?token=…` (e o código para colar);
    `POST /auth/verify-email` (sem auth: o token é a prova) marca `email_verified_at` e emite `ME_UPDATE`;
    `POST /auth/verify-email/resend` (3/15 min). `Me.emailVerified` no contrato.
  - **Cadastro sem enumeração (B5)**: só o username em uso vira 409 (usernames são públicos). E-mail em uso nunca é
    revelado: a conta é criada não verificada, com sessão, igual a um cadastro novo, e o endereço recebe "você já tem
    uma conta" (com o @ do dono) em vez do link. Por isso o e-mail é único só entre contas verificadas
    (`users_verified_email_key`, índice parcial) e o login por e-mail só vale para e-mail verificado (por username,
    sempre). Se duas contas não verificadas disputam um endereço, a primeira a confirmar fica com ele (a outra recebe 409).
    A migração 0003 marcou como verificadas as contas anteriores a ela (o e-mail delas já era único).
  - **Conta não verificada** pode tudo, menos: criar convites, ter mais de um espaço próprio e abrir DM nova com quem
    não é amigo (403 `forbidden`, "Confirme seu e-mail para …"). Motivo: são os vetores de spam de conta descartável
    (convites espalhados, espaços em massa, DM para membros de espaços grandes); entrar por convite, conversar nos
    espaços, voz, pedidos de amizade e DM com amigos continuam livres para a pessoa experimentar antes de confirmar.
  - **Redefinição de senha** (1 h): `POST /auth/password-reset/request {email}` responde 204 sempre, antes de qualquer
    consulta (5/15 min por IP); o token vai para a conta verificada do endereço ou, sem ela, para a conta mais recente
    que o reivindica; endereço sem conta não recebe nada. `POST /auth/password-reset/confirm {token, password}`: senha
    recusada não queima o link; troca a senha, verifica o e-mail (abrir o e-mail prova a caixa), apaga todas as sessões
    e fecha os sockets com 4004 (e tira da voz). `POST /auth/password` invalida links de redefinição pendentes.
  - **Trocar de provedor**: implementar `EmailSender` (`send(msg)`: `to`, `subject`, `text`, `html`) numa classe nova em
    `src/email.ts`, acrescentar o valor em `EMAIL_DRIVER` (`src/config.ts`) e um `case` em `createEmailSender`. O resto
    (cota, links, templates) não muda.
- **Senhas (B10)**: 10 a 256 caracteres (`MIN_PASSWORD_LENGTH`) e, no servidor, nem comum/vazada
  (`src/common-passwords.ts`), nem repetição de 1–4 caracteres, nem sequência reta, nem contendo o username ou a parte
  local do e-mail (≥ 4 caracteres). Vale no cadastro, na troca e na redefinição; o login não aplica (contas antigas de 8+
  caracteres continuam entrando). A lista foi escrita à mão para o projeto (não é cópia de arquivo de terceiros, então
  não há licença a herdar); para cobertura maior, trocar o conteúdo por uma lista pública filtrada a ≥ 10 caracteres,
  por exemplo a top-100k do SecLists (MIT), sem mudar o formato (palavras separadas por espaço/linha).
- Mensagens paginadas por UUIDv7; menções `<@userId>` contam em `read_states`; reações = 1 emoji RGI, até 20
  diferentes por mensagem.
- **Anexos** (`POST /channels/:id/messages` multipart: `payload_json` + até 10 `files`, contrato em `api.ts`): exige
  `SEND_MESSAGES` + `ATTACH_FILES`, conferidos antes de ler o corpo. Cada arquivo vai para um temporário (SHA-256 e
  tamanho; 413 acima de `MAX_ATTACHMENT_BYTES`), o tipo vem dos bytes (`file-type`; o `Content-Type` e a extensão do
  cliente são ignorados), imagens ganham `width`/`height` (rotação EXIF aplicada).
- **Imagens re-codificadas** (`scrubImage`, `sharp`): todo tipo exibido inline (png/jpeg/webp/gif/avif) é decodificado
  e gravado de novo antes de ir ao storage. Nada de EXIF (GPS incluído), XMP, IPTC, comentários nem ICC sobrevive; a
  orientação EXIF é aplicada aos pixels, as cores vão para sRGB, a animação de GIF/WebP é mantida. Anexos mantêm o
  formato (AVIF vira WebP) e o tamanho até 8192 px por lado (acima disso, reduz); `width`/`height`/`size` gravados são
  os do arquivo novo. Bomba de descompressão é recusada pelo cabeçalho, antes de decodificar: mais de 100 MP somando os
  quadros ou mais de 500 quadros → 400 (`fields.files`), sem gravar nada. No máximo 2 decodificações por vez no
  processo; `sharp.cache(false)`. O `contentType` gravado é como o
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
  (SVG recusado), ≤ 8 MiB, ≤ 4096 px por lado, gravados como WebP (animado se a entrada era) cabendo em 1024 px, sem
  metadados e sem recorte (o recorte é do cliente); nome aleatório de 128 bits, servidos públicos e `immutable` em
  `/avatars/:userId/:arquivo` e `/icons/:spaceId/:arquivo`. `avatarUrl`/`iconUrl` só aceitam `null` ou uma URL nossa do
  mesmo usuário/espaço (M9; a migração 0002 limpou as URLs externas antigas). Trocar/remover enfileira o objeto antigo.
- **Remoção no storage**: apagar mensagem, canal ou espaço remove as linhas de `attachments` (cascade) e um trigger
  as coloca em `storage_deletions`; `Files.sweep` (a cada minuto e logo após exclusões) apaga do bucket e só tira da
  fila em caso de sucesso. Falha fica com `attempts`/`last_error`, backoff de 1 min a 1 dia e `warn` no log (`error`
  a partir de 10 tentativas). Uploads entram na fila 1 h adiante antes de ir ao bucket e saem dela na transação que os
  referencia: uma queda no meio do caminho também é limpa.
- **Convites**: `GET /spaces/:id/invites` lista os utilizáveis (com `MANAGE_SPACE` todos; sem, só os seus);
  `DELETE /invites/:code` revoga (quem criou ou `MANAGE_SPACE`; fora do espaço = 404, como código inexistente).
  `INVITE_CREATE` (o `Invite`) e `INVITE_DELETE {code, spaceId}` vão para quem a lista mostraria: membros com
  `MANAGE_SPACE` + o criador. `INVITE_DELETE` sai na revogação e quando o criador sai/é expulso/banido (os convites
  dele vão junto); convite que expira ou esgota os usos não é anunciado.
- **Pagamentos e direitos** (`src/billing/`; estratégia em `docs/business/monetization.md`; contrato em
  `packages/shared/src/billing.ts`):
  - Catálogo em `catalog.ts` (`CATALOG_VERSION = 2`, `docs/business/growth-plan.md` §2–§3), copiado para `products` a
    cada subida (SKU removido ou aposentado fica inativo). Planos: `free` (720p30/720p60/1080p30, anexo =
    `MAX_ATTACHMENT_BYTES`) e `plus` (+1080p60/1440p60/4K30, anexo 100 MiB, `perks` do Plus v2). Voz igual para todos
    (D12). Coleção 01 "Hora Azul": 28 itens em 2 ondas (`COLLECTIONS[].waves[].opensAt`; `null` = onda fechada; a 2
    ainda não tem data), 25 vendáveis (R$ 240,50) e o guarda-roupa Plus (aura Frondes, ícones Noite/Porcelana, 3 cores
    do app; um item mensal = `includedIn: ['plus']` + `includedFrom`). `Product.available` = vendável agora. Os 7
    itens v1 "oceano" saíram da venda (`retired`), mas quem tiver um continua com ele (pedido pago → direito). Preços e
    datas são do dono: uma edição em `catalog.ts`.
  - **Lugares**: `COSMETIC_SLOTS` ganhou `voiceAura`, `entranceSound`, `callReactions`, `streamFrame`, `appIcon` e
    `appAccent`; os dois últimos (`PRIVATE_COSMETIC_SLOTS`) só aparecem em `Me.cosmetics`, nunca em `PublicUser`.
  - **Conjuntos**: `kind: 'bundle'` com `items`; preço = conjunto × (valor que falta ÷ soma), para baixo em ,90
    (`bundlePriceCents`, `GET /billing/quote`); o pedido grava em `orders.items` só o que faltava e um webhook concede
    tudo de uma vez. Todos os 4 conjuntos têm item da onda 2: abrem com ela.
  - **Presentes** (`gifts`): amigo há 72 h+, sem bloqueio, não para quem já tem (nem para quem já vai ganhar); pedido
    `pending` + presente `unpaid` → pago (webhook) → `delivered` (`GIFT_RECEIVED`; em `deliverAt`, pelo job) → só
    vale depois de `accept` (para todos; 16–17 também, sem e-mail) ou `decline` antes de abrir (estorno ao pagador).
    O reembolso de 7 dias do pagador revoga do destinatário (`GIFT_UPDATE` `refunded`). Limite em 24 h: acima de
    R$ 100 a preferência do MP sai só com Pix (o saldo MP não pode ser excluído), acima de R$ 300, 409. Plus como
    presente e "Plus 12 meses no Pix" (`billing: 'one_time'`) viram `subscriptions.kind = 'period'`
    (`cancel_at_period_end`, sem renovação, empilhado depois do plano atual; `resume` 409).
  - **Plus v2**: insígnia por meses **somados** (`users.plus_since` = agora − tempo pago somado, mantido pelo
    `recompute`; `PublicUser.plusBadge` só com Plus pago ativo; passes e reembolsos não contam; virar de faixa não
    gera evento). Convites (`POST /billing/passes`): 2 por mês (BRT) de quem paga, para amigo 18+, 1 por pessoa a cada
    12 meses, 7 dias a partir do "Abrir" (`kind = 'pass'`, `granted_by`). Item anual: 1 da Coleção 01 até R$ 12,90 por
    ano pago, pedido de valor 0 ligado à assinatura (`orders.subscription_id`), revogado se a assinatura for
    reembolsada.
  - **Lista de desejos** (`wishlists`, até 20): só amigos veem, nada é anunciado; padrão ligado para 18+ e desligado
    para 16–17 (`users.wishlist_visible` null = padrão).
  - **Provador** (`tryon.ts`): em chamada, 18+, item à venda, 5 min, 1 por vez, 10 por dia; `USER_UPDATE` com
    `tryOn` só para o canal de voz; acaba sozinho. Em memória (uma instância).
  - **Casa** (`space_upgrade_contributions` + cache em `spaces.upgrade_*`): contribuição de membro 18+ (R$ 5/10/19,90/199
    = 7/15/30/365 dias) por `POST /spaces/:id/upgrade/contributions`; pagos somam dias a partir do fim (ou do
    pagamento, se já tinha acabado), reembolso tira; nada renova. `Space.upgrade` nos snapshots e
    `SPACE_UPGRADE_UPDATE` (pagamento, reembolso, ajuste e fim, no mesmo job). Mural: quem escolheu aparecer, em ordem
    alfabética, sem valores. Tom e convite próprio (`invites` comum que expira com a Casa) com `MANAGE_SPACE`, só com a
    Casa acesa. Os avisos de fim saem do `endsAt` no cliente (não há mensagem de sistema). Cinema desligado
    (`CASA_CINEMA`).
  - **Reembolso self-service** (7 dias, Termos 9.5): `POST /billing/orders/:id/refund` (itens, conjuntos, presentes,
    Plus único, Casa) e `POST /billing/subscription/refund` (1ª cobrança do Plus recorrente; cancela a preapproval de
    vez). Pede `POST /v1/payments/{id}/refunds` (corpo vazio = total, `X-Render-In-Process-Refunds: true`) e grava
    `refund_requested_at`; o estado só muda quando o webhook re-buscado diz `refunded` (no sandbox, o provedor confirma
    na hora, como a página de checkout). Recibo por e-mail (`receiptMail`) a cada pedido pago e 1ª ativação, e aviso de
    presente ao destinatário adulto (sem a mensagem, que é texto do usuário).
  - `POST /billing/checkout` cria `subscriptions`/`orders` **pendentes** e devolve a página do provedor; nada é
    concedido aqui. Só `POST /billing/webhooks/:provider` com assinatura válida muda estado. Cada evento entra em
    `billing_events` (único por provedor + id do evento, SHA-256 do corpo, sem dado de cartão) na mesma transação que
    aplica o estado: repetido = 200 ignorado; transação que falha não deixa linha, então a retentativa do provedor
    reprocessa. Atualização com `occurredAt` mais velho que o último aplicado é ignorada (fora de ordem). Valor abaixo
    do preço não concede. Reembolso/chargeback (`revoked`) é terminal.
  - `recompute` (na mesma transação, com `FOR UPDATE` no usuário) reconstrói `entitlements` e o cache `users.plan` a
    partir das assinaturas vivas e pedidos pagos; depois `ENTITLEMENTS_UPDATE` (+ `ME_UPDATE` e atributo LiveKit se o
    plano mudou). Renovação automática e `past_due` têm 3 dias de carência após `current_period_end`; cancelada
    (`cancel_at_period_end`) termina no fim do período. Em produção linhas `sandbox` nunca concedem nada.
  - Job a cada minuto (`Billing.sweep`): expira assinaturas vencidas e checkouts pendentes há 24 h.
  - Cancelamento: `POST /billing/subscription/cancel` para a renovação no provedor e marca `cancel_at_period_end`.
    **Retomar**: `POST /billing/subscription/resume` desfaz enquanto o período pago não acabou (renovação volta no
    provedor, `cancelAtPeriodEnd: false`, a carência de 3 dias volta; idempotente; 404 sem assinatura viva). No
    Mercado Pago o cancelamento do usuário **pausa** a preapproval (`paused`, retomável com `authorized`); a exclusão
    de conta cancela de vez (`cancelled`). Um webhook que re-busca `authorized` também desfaz o cancelamento (o
    pagador pode pausar/retomar pela conta dele no MP).
  - **Cosméticos equipados** (`users.cosmetics`, `PublicUser.cosmetics`): `PUT /users/@me/cosmetics` equipa por
    espaço do perfil (`COSMETIC_SLOTS`: `avatarDecoration`, `profileTheme`, `profileEffect`, `nameplate`, derivados de
    `cosmeticType` do catálogo) só itens com direito vivo (comprado ou incluído no plano), sob o mesmo lock do usuário
    que o `recompute`; `null` desequipa, espaço omitido fica como está. Fan-out `ME_UPDATE` + `USER_UPDATE`. Quando o
    `recompute` tira um direito (plano acabou, reembolso), o item sai do perfil na mesma transação e o `USER_UPDATE`
    vai para a audiência do perfil. `PublicUser.cosmetics` só aparece quando há algo equipado.
  - **Imposição (D11)**: o token LiveKit leva o atributo `alga.stream_presets` (sem `canUpdateOwnMetadata`, o
    cliente não muda); `VoiceJoinResponse.streamPresets` traz o mesmo. O motor de mídia deve limitar a camada topo
    a um preset (`STREAM_PRESETS`: lado curto ≤ `height`, fps ≤ `fps`, bitrate ≤ `maxBitrateKbps`) e reagir a
    `ENTITLEMENTS_UPDATE`. No `track_published` de `SCREEN_SHARE` o servidor compara o lado curto e o bitrate das
    camadas (com 10% de folga) com o maior preset do plano e **muta a faixa no SFU** se passar. **Mudança de plano
    durante a transmissão** (subida ou descida): o atributo muda na hora (`updateParticipant`, na sala em que o usuário
    está; quem entra com um token anterior à mudança é corrigido no `participant_joined`); `PLAN_RECHECK_MS` (10 s)
    depois, cada tela não mutada do usuário passa pela mesma conferência do `track_published` contra o plano atual
    (lido do banco: subir de novo dentro dos 10 s cancela) e é mutada se passar. Na subida não há o que mutar. O teto
    de anexo por plano vale no upload (413).
  - **Sandbox** (padrão em dev/test): o checkout aponta para `GET /billing/sandbox/checkout/:ref?sig=` (link HMAC;
    `&outcome=decline` recusa), que faz o papel da página do provedor; webhooks assinados com
    `x-alga-sandbox-signature: t=<unix>,v1=<HMAC-SHA256(segredo, "t.corpo")>` (±5 min; segredo aleatório por processo,
    `config.billing.sandboxSecret`). Respostas trazem `sandbox: true`.
  - **Mercado Pago** (`mercadopago.ts`): plano = preapproval `status: pending` (link `init_point`, cartão recorrente),
    cosmético = preferência do Checkout Pro (`notification_url` = nosso webhook). `external_reference` = `s_<id>` /
    `o_<id>`. Webhook: `x-signature` = HMAC-SHA256(`MP_WEBHOOK_SECRET`, `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`),
    `data.id` da query (minúsculo se alfanumérico) e obrigatório; o estado é **re-buscado na API**
    (`/v1/payments`, `/preapproval`, `/authorized_payments`), o corpo não é confiável. No painel do MP: URL
    `<PUBLIC_URL>/api/v1/billing/webhooks/mercadopago`, tópicos `payment`, `subscription_preapproval`,
    `subscription_authorized_payment`.
- **Trust & Safety e privacidade** (decisões, retenção e operação em `docs/trust-safety/README.md`; abuso infantil em
  `docs/trust-safety/csam-process.md`; contrato em `packages/shared/src/trust-safety.ts`):
  - **Idade**: `birth_date` guardada só para a faixa (`Me.ageBracket`); < 16 no cadastro → 400 sem gravar nada; conta
    antiga declara uma vez (`PATCH /users/@me/birth-date`), < 16 → suspensa (`underage`) e exclusão em 30 dias salvo
    recurso. 16–17: DM só com amigos (nos dois sentidos) e sem compras.
  - **Aceite**: `TERMS_VERSION` (`src/legal.ts`) no cadastro + `consent_records`; versão nova → `Me.needsTermsAcceptance`
    até `POST /users/@me/accept-terms` (idempotente: aceitar a versão em vigor de novo não grava outra linha). Versão
    nova = entrada nova no topo de `LEGAL_VERSIONS`, com `changeSummary` (pt-BR curto, "o que mudou") que `GET /legal`
    devolve para a tela de novo aceite (texto em rascunho até o advogado revisar).
  - **Denúncias** (`POST /reports`, 10/h): retrato do alvo na hora (sobrevive à exclusão), sem autodenúncia, mensagem
    só se o denunciante a vê, duplicada aberta = a mesma (200 com `duplicate: true`; nova = 201 com `duplicate: false`).
    `csam` = prioridade 100 + quarentena automática dos anexos (reversível) + expurgo do autor segurado enquanto a
    denúncia está aberta; no máximo `CSAM_REPORTS_PER_DAY` (5) por denunciante em 24 h, contadas no banco (429). A
    retenção legal vem só da equipe: denúncia `csam` decidida como `resolved` (ou quarentena manual, ou
    `PATCH /admin/users/:id`). Denúncia `dismissed` soma 1 em `users.false_reports` do denunciante
    (`AdminReport.reporterFalseReports`); a equipe age sobre quem abusa com `POST /admin/users/:id/actions`.
  - **Medidas** (equipe): warn / suspend até / ban / lift. Suspensão e banimento apagam as sessões, fecham o gateway com
    **4010**, tiram da voz (`removeParticipant`); o login (senha certa) responde 403 com `error.restriction` e um token
    de recurso (1 h); `restriction.createdAt` = quando a medida foi decidida (o prazo do recurso conta dele). E-mail com a categoria, só para endereço verificado; `csam` não avisa e aparece como `other`.
  - **Recursos**: `POST /appeals` (sessão ou token; 30 dias; um por medida; 10/h por IP); "aceito" levanta a medida.
  - **Equipe**: `users.staff_role` só pelo script; `/admin/*` exige o papel (`access-logs`: admin); toda chamada vai
    para `staff_audit_log` antes de executar (status depois); moderador não age sobre contas da equipe.
  - **Quarentena**: anexo some na hora (404, `MESSAGE_UPDATE`), bytes copiados para `evidence/<id>` (nenhuma rota
    serve) com SHA-256, original apagado só depois da cópia (falha → retido e retentado); `receiptConfirmed` com
    protocolo apaga o material. Falso positivo: `POST /admin/quarantine/:id/release` devolve o arquivo à mensagem com
    um id novo (`MESSAGE_UPDATE`; pode ir de novo à quarentena), apaga a cópia e marca `released_at`; 409 depois do
    `receiptConfirmed`, na segunda vez ou com a cópia pendente; não mexe na retenção legal.
  - **Exclusão** (`DELETE /users/@me`, senha): para a renovação da assinatura, 4004 em todas as sessões, expurgo em 7
    dias (login cancela; retenção legal, recurso aberto ou denúncia `csam` aberta contra a conta seguram). E-mails de
    "exclusão marcada" e "exclusão cancelada": 1 de cada por conta a cada 24 h (em memória). Espaços → maior cargo /
    mais antigo, ou excluídos; mensagens `anonymize` (autor `REMOVED_USER_ID`, "Usuário removido", criado pela migração
    0005) ou `delete` (os clientes abertos recebem `MESSAGE_DELETE` de cada uma, 100 por canal a cada 100 ms, em
    segundo plano);
    anexos/avatar/exportações sempre apagados; `subscriptions`/`orders` passam para `REMOVED_USER_ID` (FK `restrict`
    mantida de propósito); `deleted_accounts` (username + SHA-256 do e-mail) 6 meses. `REMOVED_USER_ID` só aparece como
    `Message.author` (REST, eventos, retrato de denúncia; `GET /users/:id` o resolve); no expurgo os clientes abertos
    recebem, com o id antigo, `USER_UPDATE` (mesmo perfil "Usuário removido"), `MEMBER_REMOVE`, `RELATIONSHIP_REMOVE`,
    `REACTION_REMOVE` de cada reação e `CHANNEL_UPDATE` das DMs sem a pessoa; membros, destinatários e digitação nunca
    mostram nenhum dos dois ids.
  - **Exportação** (`POST /users/@me/export`, e-mail verificado, 1/24 h no banco): zip (`dados.json` + `LEIA-ME.txt`)
    em `exports/`, link HMAC de 7 dias por e-mail (`GET /exports/:id`), anexos com URL assinada de 7 dias.
    `GET /users/@me/exports` (30/min) lista os 20 últimos pedidos (`queued`/`processing`/`ready`/`expired`/`failed`),
    só o estado: `downloadUrl` é sempre `null` (campo mantido por compatibilidade). O app baixa com
    `POST /users/@me/exports/:id/download {password}` → `{ downloadUrl }`: senha de novo, link de 10 min
    (`EXPORT_DOWNLOAD_TTL_MINUTES`, nunca além do zip), 5/15 min, linha `export_download` em `access_logs`. Assim uma
    sessão roubada sozinha não leva os dados.
  - **Registros de acesso** (`access_logs`, sem FK): todo login/cadastro + 1º uso do dia por IP e user agent (hash),
    REST e gateway, + cada link de exportação emitido no app (`export_download`); IP pela regra de `TRUST_PROXY`; expurgo aos 6 meses salvo retenção legal; sem porta de origem.
  - **Job** (`Privacy.sweep`, a cada minuto): expurgos devidos, retenção (acesso 6 meses, casos decididos 6 meses salvo
    `csam`, exportações vencidas), exportações pendentes; `TrustSafety.sweep` retenta cópias de prova.
- **Sessões** expiram após 30 dias sem uso ou 90 dias do login; `POST /auth/password` revoga as outras;
  `DELETE /auth/sessions` revoga todas menos a atual; sem sessão o usuário sai da voz e o token LiveKit antigo não
  reentra.
- **Rate limit** (chave = usuário autenticado, ou IP em rotas públicas): teto global 200/min; `register`/`login`
  10/min/IP + 10 logins falhos/15 min por conta; mensagens 10/10 s; reações 10/5 s; `PATCH /users/@me`, pedidos de
  amizade, DMs, `POST /invites/:code` e `/voice/join` 10/min; `verify-email` e `password-reset/confirm` 10/min/IP;
  `password-reset/request` 5/15 min/IP; reenvio da verificação 3/15 min; e-mails 3/h por endereço e fluxo; preview de convite 30/min/IP; equipar cosméticos 10/min; checkout 10/h e cancelar/retomar assinatura 10/h cada (cada chamada cria ou muda um objeto no
  provedor); lista de exportações 30/min; relatórios de qualidade de chamada 20/h; espaços 10/h; convites
  20/h; troca de senha 5/15 min; 30 arquivos anexados/10 min por usuário; avatar/ícone 5/min; downloads de
  arquivo/avatar/ícone 1200/min/IP (uma página de chat carrega muitos de uma vez); denúncias 10/h (`csam` 5/24 h, no
  banco); recursos 10/h/IP; `DELETE /users/@me` 5/15 min; exportação 1/24 h (no banco); link de exportação no app
  5/15 min; data de nascimento 5/min. Store em memória de 5000 chaves por rota (LRU); chaves despejadas contam em
  `alga_ratelimit_evictions_total` (por rota; `global` = o teto padrão). Webhook do LiveKit, `/health` e
  `/ready` sem limite (`/metrics` fica no teto global por IP).
- **Gateway**: `identify` em até 10 s; 120 frames/60 s por socket e 10 sockets por usuário (senão 4008);
  `presence`/`voice_state` no máximo 1 fan-out/s por usuário (o último valor vence); cliente que não lê (buffer >
  1 MiB) é derrubado. `voice_state` sem mudança não emite; `streaming`/`video` exigem `STREAM`/`SPEAK`.
- Tokens LiveKit sem `canPublishData`. Webhooks repetidos (mesmo `id`) são ignorados por 10 min.
- Logs: sem corpo, sem `authorization`, sem parâmetros SQL nem `detail` do Postgres, código de convite redigido.
  Uma linha `request completed` por requisição (`reqId`, `uid` = HMAC do id com `FILES_SECRET`, `route` = template,
  `method`, `statusCode`, `durationMs`); sondas e telemetria em `debug`.
- **Observabilidade** (`docs/infra/observability.md`: métricas, SLOs, painéis, alertas em `infra/monitoring/`):
  `/health` = liveness (healthcheck do Railway, sem mudança); `/ready` = `select 1` + `GET /` no LiveKit (2 s cada),
  503 se algum falhar; `/metrics` = Prometheus (HTTP por template de rota e classe de status, gateway, fan-out, READY,
  voz, tokens, webhooks, banco por `op`, rate limit e chaves despejadas do store, e-mail, pagamentos, memória, event
  loop).
- **Telemetria de chamada** (`POST /telemetry/call-quality`, contrato em `packages/shared/src/telemetry.ts`): só com
  `Me.telemetryOptIn` (padrão `false`, `PATCH /users/@me`; `telemetry_opt_in_at` registra o consentimento). Schema
  estrito de agregados (enums e números, nada de texto livre, sala ou IP), 20/h. Guarda o dia (não a hora), id v4
  aleatório e `user_hash` com sal aleatório trocado todo dia e nunca gravado; expurgo aos 30 dias; vira histogramas
  `alga_call_*`.

## Testes (`test/`, 203 casos)

`npm test` roda em PGlite; `npm run test:pg` roda os mesmos casos num PostgreSQL 18 real (`test/pg-setup.ts`: um
cluster UTF8 descartável por execução, um banco por `startServer`). Os dois passam.

`e2ee.test.ts` (8): dispositivos de verdade = o WASM de `native/mls/pkg` + o controlador do desktop
(`apps/desktop/src/main/mls/session.ts`) falando com este servidor por REST e gateway. Três dispositivos entram numa
chamada e instalam a mesma chave para cada remetente (mesmo `export_secret`, mesmo código da chamada, código par a
par simétrico); expulsar um membro gera o Remove na hora, ele recebe `removed`, a chave nova é outra e ele não exporta
mais nada; saída pelo webhook também remove; um dispositivo que perdeu o estado (registro de novo) volta com uma folha
só. Corrida de commits na mesma época (um vence, o outro e uma réplica recebem `commit_rejected`; o Welcome vai uma
vez, só ao novato; commit adulterado recusado); dispositivo desconhecido, canal sem acesso e não membro recusados;
frame `e2ee_*` de 21 KB aceito e o mesmo tamanho em outra op fecha com 4003; cota própria de 60 frames (4008).
Registro por sessão, key package de outro dispositivo/forjado/lixo recusado, teto de 100 por dispositivo, logout
apaga dispositivo e key packages; 10 resgates concorrentes de um estoque de 5 levam 5 diferentes (no PG real é a
prova do `SKIP LOCKED`) e o estoque vazio faz o dispositivo enviar mais e entrar. `E2EE_DS_KEY` obrigatória em
produção (32 bytes), aleatória em dev/test. Espaço sem E2EE: `e2ee_join` recebe `not_e2ee` e não há grupo; ligar
manda `VOICE_E2EE_CHANGED` e o grupo se forma na reentrada; desligar descarta o grupo vivo (`not_e2ee` aos dois).

Auth, handshake do gateway, CORS, amizades, bloqueio, DMs, presença, espaços, convites, mensagens, voz (grants,
limite, DM, webhook, VOICE_STATE_*, CALL_RING, kick derruba voz, `alga.e2ee`/`alga.decode` no token, 409 para cliente
sem E2EE, `PATCH e2ee` com `MANAGE_SPACE` e `VOICE_E2EE_CHANGED` só para quem está na chamada e para token antigo). `security.test.ts` (32): uma regressão por achado
de `docs/security/server-review-2026-11-01.md`, incluindo a corrida B2 com 20 pares concorrentes (reproduzida no PG
real antes da correção). `moderation.test.ts` (10): cargos (CRUD, hierarquia, reordenação), apelidos, ban/unban/kick,
mute/deafen/mover/desconectar com as chamadas ao `RoomServiceClient` conferidas. `email.test.ts` (13): verificação
(link, hash no banco, uso único, expiração, token substituído, `ME_UPDATE`, limites da conta não verificada),
cadastro sem enumeração (B5: mesma resposta, e-mail ao dono, login por e-mail só verificado), disputa de endereço,
reenvio (rate limit e cota por endereço), redefinição (204 sempre, sem e-mail para endereço inexistente, senha fraca
não queima o link, 4004, sessões revogadas, expiração, troca de senha invalida o link, 429 por IP e cota silenciosa),
política de senha (B10), drivers (`.eml` e log sem corpo em produção; Resend com `fetch` simulado) e config de
produção. `uploads.test.ts` (18): anexos
(tipo real, nomes, dimensões, URL por leitor), authz (não membro, sem `ATTACH_FILES`, expulso), spoofing
(HTML/SVG/PDF como `.png`, imagem como `.html`, imagem gigante), teto de tamanho e de quantidade (413, sem sobras),
URL adulterada/expirada, `Range`, remoção (mensagem, espaço, falha do bucket com retentativa), avatar/ícone e o driver
S3 contra um S3 falso que confere SigV4 e o SHA-256 do corpo, e privacidade das imagens (JPEG de celular com GPS/ICC/orientação
6 sai sem metadados e em pé, GIF animado mantido, redução acima de 8192 px, avatar WebP ≤ 1024 px, bomba de 400 MP e
GIF de 501 quadros recusados sem gravar nada). `billing.test.ts` (15): catálogo público e `Me.plan`, checkout (e-mail
verificado, produto vendável, nada concedido, 409), página sandbox assinada, assinatura de webhook (ausente, errada,
vencida, corpo adulterado, provedor não configurado), idempotência, eventos fora de ordem, valor abaixo do preço,
cancelamento no fim do período → expiração pelo job (com `ENTITLEMENTS_UPDATE`/`ME_UPDATE`), carência, recompute
(reembolso, cosmético próprio × coleção do plano), teto de anexo por plano, atributo de presets no token e mute de
tela acima do plano, mudança de plano com a tela no ar (`RoomServiceClient` simulado: atributo na hora, mute só
depois da carência e só do que passa do plano novo, subida sem mute, token antigo corrigido na entrada), sandbox
recusado em produção, e o adaptador Mercado Pago contra uma API simulada (`x-signature`,
re-busca, `past_due`, cancelamento, compra avulsa). `spaces.test.ts` inclui listar/revogar convites (authz) e `INVITE_CREATE`/`INVITE_DELETE` (audiência: gestores + criador,
saída do criador). `billing.test.ts` também cobre retomar (idempotente, carência volta, 404 depois do fim), cosméticos
(só itens com direito, espaço errado/desconhecido, `USER_UPDATE` e perfis com `cosmetics`, desequipar; itens do plano
saem no fim do plano e o comprado fica; reembolso tira) e, no Mercado Pago simulado, `paused` no cancelamento,
`authorized` no retomar, pausa/retomada pela conta do pagador e `cancelled` na exclusão de conta.
`billing-v2.test.ts` (20): catálogo v2 (28 itens, ondas, soma R$ 240,50, conjuntos, Casa, v1 aposentado e o item v1
de quem já tem), conjunto com 0/1/todos possuídos e concessão atômica, presentes (amizade de 72 h, bloqueio, já tem,
16–17 não dão e só recebem com aceite, entrega agendada, aceite/recusa → estorno, reembolso do pagador revoga com
evento, recibo sem a mensagem, Plus de presente de 12 meses, limites R$ 100/R$ 300), lista de desejos, Plus v2
(guarda-roupa, lugares privados, item do mês pelo job, insígnia por meses somados, convites, item anual que fica e
que sai com o reembolso, Plus no Pix), Casa (contribuições somam, duplicado não soma, reembolso tira, mural, READY,
tom e convite próprio que expira com ela, fim pelo job, Cinema desligado e recusado em produção), reembolsos (7 dias,
só o pagador, idempotente, 1ª cobrança) e provador; e, no Mercado Pago simulado, reembolso → re-busca, preferência
só Pix e reembolso da 1ª cobrança com cancelamento definitivo.
`observability.test.ts` (6): formato de exposição (escape, histogramas cumulativos), `uid` dos logs, acesso ao
`/metrics` (aberto em test, bearer com token, 404 em produção sem token), `/health` × `/ready` (banco ok, LiveKit
fechado → 503, LiveKit falso → 200), métricas de HTTP/gateway/banco (driver certo nas duas suítes)/voz/webhooks/rate
limit/e-mail/pagamentos/processo, e a telemetria (403 sem opt-in, schema estrito, linha só com o dia e hash diário,
métricas, expurgo de 30 dias, retirada do consentimento, 20/h) e o store do rate limit (chave despejada do LRU cheio
conta em `alga_ratelimit_evictions_total` e recomeça do zero).
`privacy.test.ts` (11): idade no cadastro (< 16 sem gravar nada, 16 hoje, 18, datas inválidas, sem data em dev,
`REQUIRE_BIRTHDATE` e produção), declaração única e < 16 → suspensão + 4010 + exclusão segurada por recurso aceito,
16–17 (DM só com amigos sem revelar idade, sem compra), aceite e novo aceite com histórico (`changeSummary` do catálogo, aceite repetido sem linha nova), registros de acesso (login,
1º uso do dia por IP/app, gateway, expurgo de 6 meses salvo retenção legal, rota só de admin), exclusão (senha, 4004,
cancelada pelo login, 1 e-mail de cada tipo por 24 h no vaivém, expurgo: herdeiro do espaço, espaço sozinho excluído, mensagens anonimizadas com anexos apagados
no bucket, DM, pedido pago passa ao usuário removido, denúncia sem denunciante, `deleted_accounts`, eventos aos outros;
`delete` com `MESSAGE_DELETE` de cada mensagem em lotes e retenção legal) e exportação (e-mail verificado, 1/24 h, zip lido de volta, link e URLs de anexo de 7 dias,
assinatura adulterada, expiração), a lista de exportações (só estados, `downloadUrl` sempre nulo, só as próprias) e o
link no app (senha errada, de outra conta, falha, em preparo → 409, 10 min que baixa o zip, nunca além do zip, linha
`export_download`, 5/15 min) e a paridade do autor removido (`REMOVED_USER_ID` no REST, na DM, em `GET /users/:id` e no retrato;
`USER_UPDATE`/`MEMBER_REMOVE`/`REACTION_REMOVE`/`CHANNEL_UPDATE` com o id antigo; nenhum dos ids no READY seguinte).
`trust-safety.test.ts` (7): papel de equipe só pelo script + auditoria com status,
denúncias (retrato que sobrevive, autodenúncia, visibilidade, duplicada com `duplicate`, 10/h), suspensão (4010, `removeParticipant`,
401, e-mail sem nota interna, login 403 com motivo, `createdAt` + prazo do recurso, token de recurso, recurso aceito), ban/lift/warn/expiração/guardas
(equipe só por admin, `csam` sem aviso), quarentena `csam` (404, `MESSAGE_UPDATE`, prioridade, prova + SHA-256,
original apagado, sem retenção legal automática, denúncia aberta que segura a exclusão, retenção quando a equipe
confirma, `receiptConfirmed` com protocolo), quarentena manual (idempotente, cópia que falha fica retida e é
retentada, retenção legal do autor) e abuso da denúncia (`dismissed` soma no denunciante, liberação com id novo e
mesmos bytes, cópia apagada, auditada, uma vez só, nova quarentena possível; 5 `csam`/24 h → 429).

## Smoke com LiveKit real (server mute)

Com `node scripts/livekit.mjs` e `npm run dev -w apps/server` rodando: registrar dono + membro, criar espaço,
convidar, `POST /voice/join` do membro; um Chromium headless (Playwright, `--use-fake-device-for-media-stream`) entra
na sala com `livekit-client` e publica o microfone; o dono chama `PATCH /spaces/:id/members/:userId/voice
{serverMute:true}`. Verificado em 2026-11-01 via `RoomServiceClient.listParticipants`: `canPublishSources` passa a
`[CAMERA, SCREEN_SHARE, SCREEN_SHARE_AUDIO]`, o SFU despublica o microfone e a nova tentativa do cliente falha com
`insufficient permissions`; com `serverMute:false` o cliente volta a publicar.

## Smoke com LiveKit real (plano durante a transmissão)

2026-11-01, LiveKit 1.13.11 próprio (:7990, webhooks para uma API própria em :4390, PGlite em memória, sandbox com
segredo conhecido; nada no stack de dev). Três usuários entram pela API (`POST /voice/join`); cada um é uma página
headless do Chromium com `livekit-client` 2.23 publicando um canvas a 60 fps com `source: ScreenShare` e simulcast
(o SFU só vê a origem e as camadas declaradas, então não precisa de `getDisplayMedia`). Leitura por
`RoomServiceClient.getParticipant` a cada 500 ms:

| Quem | Tela | Mudança | Atributo no cliente / no SFU | Resultado |
|---|---|---|---|---|
| hi | 1080p60, 8 Mbps (só Plus); re-cap no lugar ao ver o atributo, como o desktop (102 ms) | Plus → Grátis (revoked) | 35 ms / ≤ 110 ms | **mutada em 10,1 s**; o SFU continuou com `1920x1080@8000k` |
| ok | 720p60, 3 Mbps (cabe no Grátis) | Plus → Grátis | 66 ms / ≤ 110 ms | não mutada |
| fr | 720p30, 2 Mbps | Grátis → Plus | 35 ms / ≤ 110 ms | não mutada |

**O SFU não vê o re-cap no lugar.** Para um cliente normal o LiveKit guarda as camadas do `AddTrackRequest`: o
`TrackInfo` só é atualizado pela mídia no modo de sinalização one-shot (`UpdateTrackInfoByVideoSizeChange:
UseOneShotSignallingMode`, `pkg/rtc/participant.go` 1.13.11), e o `livekit-client` 2.23 nunca manda
`UpdateLocalVideoTrack`/`UpdateVideoLayers` (que de todo jeito não levam fps nem bitrate). `docs/benchmarks/media-plan.json`
mostra o mesmo no sentido oposto (subida 720p60 → 1080p60 no lugar, o SFU segue com `1280x720@3000k`). Consequência
na lacuna abaixo.

## Lacunas conhecidas

- **Imagens fora dos tipos inline** (HEIC, TIFF, BMP, RAW…) vão como download, sem re-encode: o EXIF delas chega a
  quem baixar. Sem antivírus.
- Downloads passam pela API (controle total dos cabeçalhos), o que conta como egress do serviço no Railway
  (US$ 0,05/GB); o egress do bucket é grátis. Otimização futura: redirect para uma URL pré-assinada do bucket.
- Migrações rodam na subida sem lock: com mais de uma réplica, subir uma por vez (ou mover para `preDeploy`).
- **E2EE**: os grupos do DS ficam em memória (uma instância; restart = grupos recriados quando os clientes reenviam
  `e2ee_join`). `infra/server/Dockerfile` ainda não copia `native/mls/pkg` (falta `COPY native/mls/pkg
  native/mls/pkg` no runtime; `E2EE_MLS_PKG` aponta para outro lugar se preciso): sem ela a imagem sobe com E2EE
  desligada. O DS não confere as tags MAC do commit (só membros conseguem). Detalhes em
  `docs/security/e2ee-delivery-service.md`.
- Overwrites de permissão por canal ainda não existem (permissões valem para o espaço inteiro).
- Estado de voz, conexões, throttles e contadores de rate limit ficam em memória: uma instância só. Para escalar,
  Redis (pub/sub + store do `@fastify/rate-limit`). **Plano do Redis para o rate limit**: trocar `RateLimitStore`
  (`src/observability.ts`, que hoje embrulha o `LocalStore` do plugin para contar despejos) pela opção `redis` do
  `@fastify/rate-limit` (contadores com TTL no Redis, sem teto de 5000 chaves nem despejo), junto com o pub/sub do
  gateway; as cotas de e-mail e o "1º uso do dia" vão para o mesmo Redis. Enquanto isso, alerta se
  `alga_ratelimit_evictions_total` subir.
- Gateway sem `resume`: reconexão recebe um READY novo (como no contrato).
- **E-mail sem fila nem retentativa**: falha do provedor fica só no log (`e-mail not sent`); a pessoa pede de novo
  (reenvio/redefinição). Contas não verificadas nunca expiram (limpeza periódica fica para depois). A lista de senhas
  comuns é pequena (escrita à mão); HIBP k-anon não é consultado (exigiria rede na hora do cadastro).
- As cotas de e-mail por endereço também ficam em memória (mesma ressalva do Redis acima).
- Contadores de menção não diminuem quando a mensagem é apagada.
- **Telemetria de chamada**: a Política de Privacidade publicada ainda diz "não há telemetria" — precisa ser revista
  antes de o desktop mostrar o opt-in. Regras de alerta sem `promtool` (YAML validado, PromQL não). `/ready` não é
  sondado de fora (só o Prometheus na VM do SFU).
- **Mercado Pago nunca rodou contra a API real** (sem credenciais): lista do que falta conferir em
  `docs/business/monetization.md` §8, mais o retomar: conferir que `paused` não cobra e que `authorized` volta a
  cobrar no `next_payment_date` original, sem cobrança imediata (falta anotar no §8). Uma preapproval pausada pelo
  cancelamento fica pausada no MP depois que a assinatura expira aqui (não cobra; se o pagador a retomar pelo MP, o
  webhook reativa a assinatura antiga). Reembolso self-service e preferência só com Pix dos presentes escritos pela doc
  (2026-11-01) e testados só contra a API simulada. Sem Pix na assinatura recorrente: a busca na doc do MP
  (2026-11-01) não acha Pix Automático no `/preapproval`; o Plus no Pix é pagamento único. USD não é cobrado (MP é só
  BRL).
- **Pacote A (growth-plan §5.2) fora daqui**: "Contar no espaço" e os avisos de fim da Casa como mensagem (não há
  mensagem de sistema), "Denunciar" no presente (fluxo de T&S), contadores do funil da loja (pacote D), avatar por
  espaço, Casa Cinema (medidor de 60 h e preset no `voice.ts`). O provador e o limite diário dele ficam em memória.
- O mute de tela acima do plano usa as dimensões/bitrates que o SDK do cliente declara ao publicar: um cliente
  modificado pode declarar menos (medição real exigiria estatísticas do SFU). **Descida com a tela no ar:** como o
  SFU guarda as camadas da publicação (smoke acima), uma tela publicada acima do plano novo é mutada 10 s depois
  **mesmo que o cliente tenha feito o re-cap no lugar** (o desktop faz, em ~100 ms, e avisa "a transmissão continua").
  Para não mutar quem cumpre, o desktop precisa republicar a tela (publicação nova → conferida no `track_published`)
  ao descer de plano, dentro dos 10 s. Sem essa mudança, a alternativa é a re-checagem só registrar (o log
  `screen share above the plan`) em vez de mutar.
- Dois checkouts de plano pagos ao mesmo tempo não são bloqueados: o recompute usa o melhor e o outro precisa de
  estorno manual. Pagamento duplo de um pedido é logado como erro (estorno manual).
- Downloads de anexo passam pela API: o anexo de 100 MiB do Plus custa egress do Railway (ver lacuna acima).
- **Trust & Safety** (detalhes em `docs/trust-safety/`): idade só autodeclarada; sem detecção por hash de material
  conhecido nem envio automático ao Nidus/PF; liberar a quarentena devolve o anexo com id novo (links antigos dão 404); prova em
  `evidence/` no mesmo bucket (recomendado bucket/política própria); denúncia comum preserva só os metadados dos
  anexos; sem expurgo fiscal automático de `subscriptions`/`orders`; exportação montada em memória (sem zip64); conta
  suspensa/banida não se autoexclui (pedido ao encarregado); registros de acesso sem porta de origem (D23); o cache de
  "1º uso do dia" fica em memória (mesma ressalva do Redis).
- **Revisão de abuso (T&S + pagamentos, 2026-11-01)**: corrigidos o checkout e o cancelar/retomar (10/min → 10/h: cada
  chamada vira objeto/chamada no provedor) e o aceite repetido. Decisões do lead aplicadas depois: (1) denúncia `csam`
  continua pondo os anexos em quarentena na hora (reversível, `POST /admin/quarantine/:id/release`), mas a retenção
  legal só vem da equipe ao confirmar; 5 `csam`/24 h por denunciante; `users.false_reports` conta as arquivadas.
  Continua: qualquer conta, até sem e-mail verificado, faz até 5 por dia (contas descartáveis multiplicam isso) e a
  denúncia aberta segura a exclusão do denunciado até a equipe decidir. (2) O store em memória continua com 5000
  chaves por rota (LRU): acima disso, no mesmo intervalo, contadores antigos somem e o limite vaza. Agora medido
  (`alga_ratelimit_evictions_total`); resolve com o Redis (plano acima). (3) Exclusão em modo `delete` anuncia
  `MESSAGE_DELETE` (um por mensagem, sem evento em lote no contrato). (4) E-mails de exclusão marcada/cancelada: 1 de
  cada por conta a cada 24 h.
