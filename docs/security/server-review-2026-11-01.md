# Revisão de segurança — `apps/server` (2026-11-01)

Escopo: `apps/server/**` (contrato em `packages/shared/src/*.ts`, intenção em `docs/ARCHITECTURE.md`).
Método: leitura ponta a ponta de cada rota e op do gateway; provas de conceito em vitest numa **cópia** do
servidor (scratchpad, nada no repositório foi alterado além deste arquivo). Suíte atual: `npm test -w apps/server`
→ **47/47 passando**.

Resumo: **0 Crítico · 2 Alto · 10 Médio · 11 Baixo**. Não encontrei IDOR clássico (ler ou escrever dados de
espaço ou DM alheio). Os riscos reais são **abuso e DoS** (rate limit contornável, fan-out sem throttle),
**configuração que falha aberta** e **bloqueio e moderação contornáveis**.

Legenda: **[PoC]** = reproduzido por teste; **[Código]** = demonstrado só pela leitura do caminho.

---

## Alto

### A1. Rate limit de login/registro é contornável (`TRUST_PROXY=true`) ou vira bloqueio global (`false`) — [PoC]
- `src/app.ts:35` (`trustProxy: config.trustProxy`, booleano), `src/config.ts:22`, `src/routes/auth.ts:11`
  (chave padrão do `@fastify/rate-limit` = `req.ip`), `.env.example` ("Atrás de proxy reverso (Railway etc.) use true").
- `trustProxy: true` confia em **todos** os saltos. Por isso `req.ip` vira o primeiro valor de `X-Forwarded-For`,
  e esse valor quem escolhe é o cliente.
- **Ataque:** o atacante manda um `X-Forwarded-For: <aleatório>` diferente a cada tentativa. Resultado:
  - força bruta e credential stuffing ilimitados em `/auth/login`;
  - criação de contas em massa em `/auth/register`.
  - PoC: 25 logins com XFF distintos → 0 respostas 429. Com o mesmo XFF → 429 a partir da 11ª.
  - Bônus: com o store LRU de 5000 chaves, girar chaves também apaga os contadores das vítimas.
- **Ataque (com `false`, atrás do proxy):** todos os clientes compartilham o IP do proxy. Assim 10 requisições
  por minuto de qualquer pessoa bloqueiam login e registro para todo mundo.
- Cada tentativa custa um argon2 (19 MiB) no threadpool do libuv, que tem 4 threads. Sem limite efetivo, isso
  vira DoS de CPU de toda a autenticação.
- **Correção mínima:**
  - Trocar o booleano por número de saltos ou lista de IPs do proxy, por exemplo `trustProxy: 1`
    (`TRUST_PROXY_HOPS`).
  - Somar um limite por conta: chave `login:<login normalizado>` (ex.: 5 por 15 min) além do limite por IP.
  - Usar store Redis quando houver mais de uma instância.

### A2. Amplificação de fan-out sem throttle (ops do gateway e `PATCH /users/@me`) — [PoC]
- `src/gateway/socket.ts:124-135` (`presence`, `voice_state`), `src/voice.ts:145-151` (`updateSelf` despacha
  mesmo sem mudança), `src/routes/users.ts:18-28,62-79` (`USER_UPDATE` para `profileAudience`), `src/app.ts:66-69`
  (`global: false`: só auth e envio de mensagem têm limite).
- **Ataque:** um usuário comum, membro de espaços grandes, envia um loop de frames
  `{op:'presence',status:'dnd'|'online'}`.
  - Cada frame faz 2 queries mais `presenceAudience` e despacha `PRESENCE_UPDATE` para todos os co-membros e amigos.
  - `voice_state` despacha para **todos os membros do espaço** a cada frame.
  - `PATCH /users/@me` alternando `displayName` faz o mesmo com `USER_UPDATE`.
  - PoC: 200 frames → 200 `PRESENCE_UPDATE` entregues a outro membro em menos de 1,5 s.
  - Com 5k membros e cerca de 1k frames/s, são cerca de 5M envios por segundo. A instância única cai.
- **Correção mínima:**
  - Token bucket por conexão no handler do gateway: ex. 5 ops por 5 s; acima disso, fechar com 4008.
  - `updateSelf`: não despachar quando as flags são iguais às atuais.
  - Rate limit em `PATCH /users/@me` (ex. 5/min por usuário, `keyGenerator` como em `messages.ts:75`).

---

## Médio

### M1. Guarda de produção depende de `NODE_ENV`, cujo padrão é `development` (falha aberta) — [PoC]
- `src/config.ts:18,27,31,35-43,78`.
- Sem `NODE_ENV=production`, o servidor sobe com `DATABASE_URL` e `HOST=0.0.0.0`, mas com problemas:
  - a chave padrão `devkey` fica ativa;
  - o segredo LiveKit vira `alga-dev-secret-change-me-…`, que é **público no repositório**
    (`infra/livekit/livekit.dev.yaml:12`, `.env.example`);
  - o CORS fica com `localhost`, `null` e `file://`.
- PoC: `loadConfig({DATABASE_URL, HOST:'0.0.0.0'})` → `env='development'` e o segredo de dev, sem erro.
- **Ataque:** se o SFU de produção for configurado a partir do yaml de dev (só ele existe hoje), qualquer pessoa:
  - forja tokens LiveKit para `ch_<id>` e escuta qualquer chamada de voz ou DM;
  - forja webhooks (estado de voz falso, `CALL_RING`).
- **Correção:**
  - Recusar o segredo de dev **sempre que o host não for loopback** ou quando `DATABASE_URL` estiver definida,
    não só quando `NODE_ENV=production`.
  - Exigir `LIVEKIT_API_KEY` diferente de `devkey` nesses casos.
  - Não ter CORS padrão fora de dev.

### M2. Sessões eternas; sem troca de senha nem "sair de todas"; logout não derruba voz — [Código]
- `src/db/schema.ts:25-36` (sem `expires_at`), `src/auth.ts:50-63` (`resolveToken` não olha a idade),
  `src/routes/auth.ts:59-63`, `src/voice.ts:55-59` (token LiveKit de 1 h, sem vínculo com a sessão).
- **Ataque:** um token roubado (backup do perfil, máquina compartilhada, malware) vale para sempre.
  - A vítima pode revogar a sessão, mas não consegue trocar a senha. O atacante que tem a senha volta a logar.
  - Depois do logout ou da revogação, quem está numa chamada **continua na sala LiveKit**.
- **Correção:**
  - Expiração absoluta (ex. 30 dias) mais expiração por inatividade (`last_used_at`) em `resolveToken`.
  - `POST /auth/password`, que revoga as outras sessões.
  - `DELETE /auth/sessions` (todas exceto a atual).
  - No logout ou na revogação, chamar `voice.disconnect(userId, [canal atual])` se a sessão for a única do usuário.

### M3. Gateway sem limites de conexão, sem backpressure e com fila ilimitada — [Código + PoC parcial]
- `src/gateway/socket.ts:65-81,139-145`, `src/gateway/hub.ts:46-55`, `src/app.ts:70`.
- Sockets **não autenticados** vivem até `2×HEARTBEAT_INTERVAL_MS` (60 s) sem limite por IP.
- Um usuário pode abrir N sockets autenticados. PoC: 30 sockets aceitos, e cada `identify` monta um READY
  completo com todos os membros de todos os espaços.
- `chain = chain.then(...)` enfileira frames sem limite: o cliente envia mais rápido do que o servidor processa
  e a memória cresce.
- `hub.dispatch` chama `socket.send` sem olhar `bufferedAmount`. Um cliente que **não lê** (janela TCP zero)
  num espaço movimentado faz o buffer crescer sem limite.
- **Correção:**
  - Limite de sockets por IP (pré-auth) e por usuário (ex. 10).
  - Timeout de `identify` curto (ex. 10 s).
  - Fechar quando `socket.bufferedAmount` passar de um teto (ex. 1 MiB).
  - Descartar ou fechar quando houver mais de N frames pendentes.

### M4. `userLimit` do canal de voz é TOCTOU — [PoC]
- `src/routes/voice.ts:16-20` confere o mapa em memória **ao emitir o token**. `src/voice.ts:96-137`
  (`participantJoined`) não confere de novo.
- **Ataque:** vários usuários pedem `/voice/join` ao mesmo tempo, ou guardam o token (válido por 1 h) e entram
  depois que o canal lotou.
  - PoC: canal com limite 1 → 2 tokens emitidos e 2 participantes aceitos.
- **Correção:**
  - Em `participantJoined`, se `count >= userLimit` e o usuário não tem `MOVE_MEMBERS`, chamar `kick`.
  - Opcional: criar a sala com `maxParticipants`.

### M5. Qualquer um abre DM com qualquer um e coloca estranhos em grupos sem saída — [PoC]
- `src/routes/users.ts:157-196`. O contrato (`packages/shared/src/api.ts:21`) não tem rota para sair de `group_dm`.
- **Ataque:** um spammer entra num espaço grande. O READY entrega os ids de todos os membros, e
  `GET /invites/:code` (público) expõe `ownerId` e `inviterId`.
  - O spammer abre DMs e cria grupos de até 9 vítimas, sem amizade nem consentimento, quantas vezes quiser:
    sem `dm_key` e sem rate limit.
  - A vítima **não consegue sair** (PoC: 21 grupos idênticos criados; `DELETE /channels/:id` → 403).
- **Correção:**
  - `DELETE /channels/:id/recipients/@me` para sair de grupo.
  - Exigir amizade, ou espaço em comum mais uma preferência de privacidade, para abrir DM.
  - Para adicionar alguém a um grupo, exigir amizade.
  - Rate limit na criação.

### M6. Bloqueio contornado pela edição de mensagens antigas (e sem `SEND_MESSAGES`) — [PoC]
- `src/routes/messages.ts:119-129` pede só `VIEW_CHANNELS` e autoria. Não chama `assertDmNotBlocked`.
- **Ataque:** B foi bloqueado por A na DM. B edita mensagens antigas da DM em loop, e cada edição chega a A em
  tempo real via `MESSAGE_UPDATE`.
  - PoC: envio → 403, edição → 200, e A recebe "assédio após bloqueio".
  - O mesmo vale para quem perder `SEND_MESSAGES` num espaço.
- **Correção:**
  - No PATCH, exigir `Permission.SEND_MESSAGES` e chamar `assertDmNotBlocked(db, access, me)`.
  - Na rota de reação já existe essa checagem; replicar.

### M7. Reações ilimitadas com texto arbitrário — [PoC]
- `src/routes/messages.ts:36-39,143-155` aceita qualquer string de até 32 unidades UTF-16.
  `src/views.ts:156-183` carrega **todas** as reações das mensagens da página.
- **Ataque:** um usuário aplica milhares de "emojis" distintos (`<img src=x>1`, `…2`, …) numa mensagem.
  - Cada um gera um `REACTION_ADD` para o canal inteiro.
  - O histórico fica pesado para todos: PoC com 300 reações aceitas numa mensagem e devolvidas no GET.
  - O texto chega cru ao renderer.
- **Correção:**
  - Validar contra um conjunto de emojis Unicode, ex. `/^\p{Extended_Pictographic}(‍\p{Extended_Pictographic}|️)*$/u`,
    ou contra ids de emoji próprios.
  - Teto de 20 emojis distintos por mensagem.
  - Rate limit por usuário.

### M8. Kick sem ban: o expulso volta na hora com o mesmo convite — [PoC]
- `src/routes/spaces.ts:124-134,201-226`. `BAN_MEMBERS` existe (`packages/shared/src/permissions.ts:10`), mas não
  há tabela nem checagem. Convites padrão duram 7 dias, com usos ilimitados.
- **Ataque:** o assediador expulso usa o mesmo link e volta. PoC: kick → 204, join → 200.
- **Correção:**
  - Tabela `space_bans(space_id,user_id)`.
  - `DELETE …/members/:userId?ban=1` exigindo `BAN_MEMBERS`.
  - Checar o ban no `POST /invites/:code`.

### M9. `avatarUrl` e `iconUrl` aceitam qualquer esquema e host — [PoC]
- `packages/shared/src/api.ts:93,112` (`z.string().url()` aceita `javascript:`, `file:`, `data:`, IPs de LAN).
  Persistido em `src/routes/users.ts:72` e `src/routes/spaces.ts:99`.
- **Ataque:** hoje o renderer só usa a URL em `<img>` com CSP `img-src https: data:`. Mesmo assim:
  - Um avatar `https://atacante/pixel?u=<id>` revela **o IP e o horário** de todos que veem o perfil ou as
    mensagens. Isso inclui o preview de convite, que é público.
  - Qualquer uso futuro em `href`, `openExternal` ou notificação nativa herda os esquemas perigosos.
- **Correção:** `z.url({ protocol: /^https$/, hostname: /^cdn\.algameet\./ })`, ou seja, só URLs do próprio
  storage. Até existir upload, aceitar só `https:`.

### M10. Cobertura de rate limit ausente nas rotas de escrita — [Código]
- `src/app.ts:66-69` (`global:false`). Sem limite:
  - pedidos de amizade (`users.ts:88`);
  - DMs e grupos (`users.ts:157`);
  - criação de espaços, canais e convites (`spaces.ts:76,138,184`);
  - reações (`messages.ts:143`);
  - `typing` e `ack`;
  - `/voice/join` e `CALL_RING`: entrar e sair da chamada em loop toca a outra pessoa sem parar;
  - `GET /invites/:code` (público).
- **Ataque:** spam de pedidos de amizade para todos os usernames coletados; criação de milhares de espaços
  (o READY de quem é adicionado incha); ring-spam.
- **Correção:** ligar `global: true` com um teto genérico por usuário/IP (ex. 120/min) e limites específicos:
  amizade 10/min, DM/grupo 10/min, espaço 5/h, convite 20/h, `voice/join` 10/min.

---

## Baixo

### B1. Sala "fantasma" depois de excluir canal ou espaço — [PoC]
- `src/voice.ts:98-101`: se o canal não existe, o código só registra um warn e **não chama `kick`**.
- Com token ainda válido (até 1 h), membros reentram em `ch_<id excluído>`. O LiveKit recria a sala e o servidor
  não rastreia nem expulsa ninguém. PoC: `removeParticipant` não é chamado.
- **Correção:** chamar `await this.kick(channelId, userId)` nesse ramo.

### B2. Corrida em relacionamentos pode sobrescrever um bloqueio — [Código; não reproduzido no PGlite]
- `src/routes/users.ts:36-39` (`setRel` faz upsert incondicional), `:94-104`, `:115-136`. As leituras ficam fora
  da transação.
- Com o pool `pg` (10 conexões), um `POST /relationships` de A concorrente com o bloqueio feito por B pode gravar
  `B→A = incoming` por cima de `blocked`. Também pode deixar os dois lados em `outgoing`.
- **Correção:** ler com `SELECT … FOR UPDATE` dentro da transação, ou fazer o upsert com
  `setWhere: ne(relationships.type, 'blocked')`.

### B3. Logs podem conter conteúdo privado — [Código]
- `src/errors.ts:74` registra `err`. O `DrizzleQueryError` (drizzle-orm 0.45.4) põe `params` na mensagem e nas
  propriedades.
- Numa falha de DB, o log recebe o texto de mensagens, e-mails e hashes argon2.
- A URL `/invites/<code>` também vai para o log de requisição.
- **Correção:** serializer de `err` que remova `params` e `query`, e redact de `req.url` para `/invites/`.

### B4. `position` sem limite superior → 500 — [PoC]
- `packages/shared/src/api.ts:126`. `2**40` estoura o `integer` → 500, que ainda passa pelo B3.
- **Correção:** `.max(10_000)`.

### B5. Enumeração de e-mail e username — [Código]
- `src/routes/auth.ts:51-56`: o 409 diz qual campo já está em uso. `src/routes/users.ts:92`: "Usuário não
  encontrado" no pedido de amizade.
- O login foi equalizado, mas o registro anula essa proteção, e o limite dele é contornável (A1).
- **Correção:** registro com resposta genérica, mais verificação de e-mail.

### B6. Convites: preview público sem limite e convites que sobrevivem ao criador — [Código]
- `src/routes/spaces.ts:20-28,66-70`: 8 caracteres base62, cerca de 47,6 bits. `GET` sem rate limit.
- O convite continua valendo depois que o criador sai, é expulso ou perde `CREATE_INVITES`.
- **Correção:** rate limit no preview; invalidar os convites do criador em `removeMember`.

### B7. `canPublishData: true` para todos — [Código]
- `src/voice.ts:66`. O canal de dados do LiveKit entrega mensagens arbitrárias a todos da sala. Ele ignora
  `SEND_MESSAGES`, bloqueios e moderação, e não deixa registro.
- **Correção:** `canPublishData: false`, a menos que um recurso precise.

### B8. `voice_state` aceita `streaming` e `video` sem permissão — [Código]
- `src/gateway/socket.ts:131-135`, `src/voice.ts:145-151`. Quem não tem `STREAM` ou `SPEAK` pode se anunciar
  "transmitindo" ou "com câmera" na UI dos outros.
- **Correção:** forçar `false` quando faltar a permissão, ou derivar as flags dos `track_published` do webhook.

### B9. Webhook LiveKit sem deduplicação — [Código]
- `src/routes/voice.ts:36-47`. A assinatura, o `exp` e o sha256 do corpo são verificados.
- Mas um webhook capturado pode ser reenviado dentro da validade do JWT, por exemplo um `participant_left`
  que derruba alguém da UI.
- **Correção:** guardar `event.id` por alguns minutos e ignorar repetidos.

### B10. Política de senha mínima e sem verificação de e-mail — [Código]
- `packages/shared/src/api.ts:72`: só 8 caracteres, sem lista de senhas vazadas.
- Qualquer um registra o e-mail de outra pessoa (squatting).
- **Correção:** lista k-anon (HIBP) ou top-100k; verificação de e-mail.

### B11. CORS padrão permissivo também em produção — [Código]
- `src/config.ts:29-32`: `null`, `file://` e `localhost` por padrão. O impacto é baixo porque a autenticação é
  bearer e não há credencial ambiente.
- **Correção:** sem padrão fora de dev; exigir `CORS_ORIGINS` explícito.

### Nota para o renderer (sem correção no servidor)
O servidor devolve **cru** e o renderer precisa tratar como texto:
- `content`, `topic`, `name`, `displayName`, `bio`;
- `emoji` (texto livre, M7) e `nonce`, que é repassado a **todos** os destinatários;
- `avatarUrl` e `iconUrl`.

`displayName` aceita bidi, zero-width e nomes repetidos, o que permite personificação.

---

## Verificado e OK
- **Token de sessão:** 32 bytes de `randomBytes` em base64url; só o SHA-256 fica no banco, com índice único.
  `resolveToken` rejeita tokens com mais de 128 caracteres. O token vai no frame `identify`, nunca na URL.
- **argon2id** com m=19456, t=2, p=1 (piso OWASP). O hash dummy iguala o tempo do login, e a mensagem de erro
  é a mesma com ou sem usuário.
- **Sessões:** listar e revogar só alcança as do próprio usuário (`auth.ts:65-84`). Logout e revogação fecham
  os sockets com 4004.
- **Mass assignment:** o zod remove chaves desconhecidas em `PatchMe`, `PatchSpace` e `PatchChannel` (provado
  por teste). Não dá para injetar `email`, `passwordHash`, `ownerId`, `spaceId` ou `type`.
- **Parâmetros validados:** todo id de path passa por `idParam` (UUID → 404); `code` por regex; `before`/`after`
  como UUID; `limit` ≤ 100. Corpo limitado a 256 KiB, webhook a 1 MiB, frame WS a 16 KiB.
- **AuthZ de espaço e canal:**
  - `requireSpace`/`requireChannel` estão em todas as rotas.
  - Só o dono exclui o espaço. O dono não sai e não pode ser expulso.
  - `MANAGE_CHANNELS` não vale em DM.
  - Só o autor edita. Apagar exige autoria ou `MANAGE_MESSAGES`.
  - `messageIn` amarra a mensagem ao canal, então não há IDOR cruzado. `replyToId` e `ack` ficam restritos ao canal.
- **Voz:**
  - `/voice/join` exige `CONNECT`. Os grants seguem `SPEAK` (mic e câmera) e `STREAM` (tela e áudio da tela).
  - `identity` é definida pelo servidor. A sala `ch_<uuid>` tem parse estrito.
  - `participantJoined` revalida acesso e expulsa quem foi removido.
  - Webhook: parser de corpo cru encapsulado; HS256 com issuer, `exp` obrigatório e sha256 do corpo. Um token de
    join não serve como webhook, porque não tem `sha256`.
- **Gateway:**
  - O frame é validado por schema zod; `identify` só uma vez; códigos 4001 e 4003; heartbeat.
  - Não precisa checar `Origin`, porque não há credencial ambiente.
  - As audiências do fan-out são recalculadas no DB a cada dispatch. Depois de sair, ser expulso ou desfazer a
    amizade, o usuário para de receber mensagens, presença, digitação e voz.
  - O READY filtra `voiceStates` pelos espaços e DMs do usuário.
  - `invisible` aparece como `offline` no READY, no `exchangePresence` e no broadcast. Digitação e voz ainda
    revelam atividade, como no Discord.
- **Bloqueio** impede: pedido de amizade (sem revelar o bloqueio), abrir DM, enviar, digitar, reagir e chamar
  em DM 1:1. A exceção é M6.
- **Corridas tratadas:**
  - convite com incremento condicional dentro da transação, sem passar de `maxUses`;
  - join idempotente;
  - DM 1:1 sem corrida (`dm_key` único);
  - registro e username com índice único e tratamento de `23505`.
- **SQL:** só fragmentos `sql` estáticos (`access.ts:28`, `messages.ts:103`, `spaces.ts:210`). Todos os valores
  vão parametrizados.
- **Regex:** todas lineares, sem ReDoS (`username`, `MENTION_RE`, bearer, `codeParam`, `UUID_RE`). As menções
  só contam para quem está na audiência.
- **Erros e privacidade:** o handler não vaza stack, e o 500 é genérico. O logger redige `authorization`,
  `cookie` e `sec-websocket-protocol`. `PublicUser` não expõe e-mail nem `statusPreference`.
- **Guarda de produção:** com `NODE_ENV=production` existe e funciona (`LIVEKIT_API_SECRET` e `DATABASE_URL`).
  O problema é só o padrão (M1).

## Prioridade sugerida
1. A1 e A2: rate limit correto e throttle do gateway.
2. M1: guarda de configuração.
3. M6 e M2: bloqueio e sessões.
4. M3, M4, M5, M7, M8, M10.
5. Os Baixos, junto com o próximo trabalho em cada módulo.

---

## Status das correções (2026-11-01)

Cada achado ganhou primeiro um teste de regressão que falhava no código revisado (`apps/server/test/security.test.ts`,
um `describe` por achado; M8 em `moderation.test.ts`), depois a correção. Suíte: `npm test -w apps/server` → **87/87**.

| Achado | Correção | Commit | Teste | Status |
|---|---|---|---|---|
| A1 rate limit de login | `TRUST_PROXY` = IPs/CIDRs ou nº de saltos (`true` recusado); 10 logins falhos/15 min por conta, conferido antes do argon2, além de 10/min/IP | `d02ab89` | `A1 trusted proxy + login limits` | Corrigido. Store em memória: com mais de uma instância, usar Redis |
| A2 fan-out sem throttle | `presence`/`voice_state` ≤ 1 fan-out/s por usuário (último valor vence); `updateSelf` sem mudança não emite; `PATCH /users/@me` 10/min | `7100034`, `d02ab89` | `A2/M3 gateway…`, `M10/A2 write routes…` | Corrigido |
| M1 guarda de produção | `NODE_ENV` ausente = produção; `devkey`/segredo de dev só com dev/test em HOST loopback ou `ALGA_ALLOW_DEV_SECRETS=1`; `npm run dev` passa `--dev` | `d02ab89` | `M1/B11 configuration fails closed` | Corrigido |
| M2 sessões eternas | Expiração 30 dias sem uso / 90 dias absoluta; `POST /auth/password` (revoga as outras); `DELETE /auth/sessions`; sem sessão → sai da voz e `participant_joined` recusa | `84b59a0` | `M2 sessions…` | Corrigido |
| M3 limites do gateway | `identify` em 10 s; 120 frames/60 s e 10 sockets por usuário (4008, novo `GatewayClose.RATE_LIMITED`); buffer > 1 MiB → `terminate` | `7100034` | `A2/M3 gateway…` | Corrigido (backpressure só por código, sem teste) |
| M4 `userLimit` TOCTOU | Conferido de novo no `participant_joined`, sem `await` entre a checagem e o registro; excedente removido do SFU + `VOICE_DISCONNECT {reason:'channel_full'}` | `7b7e0b8` | `M4/B1/B7/B8/B9 voice` | Corrigido |
| M5 DM/grupo sem consentimento | DM 1:1 nova exige amizade ou espaço em comum; grupo exige amizade com todos; `DELETE /channels/:id/recipients/@me`; 10/min na criação | `da7d8f3` | `M5 DMs need consent…` | Corrigido. Preferência de privacidade "DMs de membros do espaço" fica para depois |
| M6 edição após bloqueio | PATCH de mensagem exige `SEND_MESSAGES` + `assertDmNotBlocked` | `da7d8f3` | `M6 blocks and SEND_MESSAGES…` | Corrigido |
| M7 reações ilimitadas | Um emoji RGI (`\p{RGI_Emoji}`), até 20 distintos por mensagem, 10 reações/5 s | `da7d8f3`, `d02ab89` | `M7 reactions…` | Corrigido (checagem do teto não é atômica: concorrência pode passar de 20 por poucas) |
| M8 kick sem ban | `space_bans`; `PUT/DELETE/GET /spaces/:id/bans`; convite recusa banido; ban/kick derrubam a voz no LiveKit | `f3861a5` | `moderation.test.ts › bans and kicks` | Corrigido |
| M9 `avatarUrl`/`iconUrl` | Só `https:` | `da7d8f3` | `M9/B4 input bounds` | Mitigado: o pixel de rastreio via https continua possível até existir upload próprio |
| M10 rotas sem limite | `global: true` (200/min por usuário, por IP em rotas públicas) + limites por rota (amizade, DM, espaço, convite, preview, join, `voice/join`, reações) | `d02ab89` | `M10/A2 write routes…` | Corrigido |
| B1 sala fantasma | `kick` quando o canal não existe | `7b7e0b8` | `M4/B1/B7/B8/B9 voice` | Corrigido |
| B2 corrida no bloqueio | Upsert com `setWhere: type <> 'blocked'` (só um bloqueio substitui um bloqueio) | `da7d8f3` | `B2/B3/B6` | Corrigido |
| B3 logs com dados | `safeErr` (sem `params`, sem `detail` do pg) em todos os logs de erro; `safeUrl` redige `/invites/<código>` | `da7d8f3` | `B2/B3/B6` | Corrigido |
| B4 `position` sem teto | `.max(10_000)` (canais e cargos) | `da7d8f3` | `M9/B4 input bounds` | Corrigido |
| B5 enumeração no registro | — | — | — | Adiado: exige verificação de e-mail e muda a UX do cadastro (o desktop mostra o erro por campo) |
| B6 convites | Preview 30/min/IP; convites do criador apagados quando ele sai, é expulso ou banido | `da7d8f3`, `d02ab89` | `B2/B3/B6` | Corrigido |
| B7 `canPublishData` | `false` | `7b7e0b8` | `M4/B1/B7/B8/B9 voice` | Corrigido |
| B8 `streaming`/`video` sem permissão | Forçados a `false` sem `STREAM`/`SPEAK` | `7b7e0b8` | `M4/B1/B7/B8/B9 voice` | Corrigido |
| B9 replay de webhook | `event.id` lembrado por 10 min | `7b7e0b8` | `M4/B1/B7/B8/B9 voice` | Corrigido |
| B10 política de senha | — | — | — | Adiado: precisa de lista de senhas vazadas (HIBP k-anon ou top-N) e verificação de e-mail |
| B11 CORS permissivo | Sem padrão fora de dev/test; `CORS_ORIGINS` obrigatório em produção | `d02ab89` | `M1/B11 configuration fails closed` | Corrigido |

Moderação no SFU validada com LiveKit 1.13.11 real (smoke em `apps/server/README.md`): após `serverMute`, o
participante perde `MICROPHONE` em `canPublishSources`, o SFU despublica o microfone e a republicação do cliente falha
com `insufficient permissions`.
