# Retenção — servidor e contrato (pacote D1)

Pacote D1 do `docs/business/growth-plan.md` §5.2 "(D) Retenção": eventos com RSVP e lembretes, sessões de voz,
agregados noturnos, resumo da semana, "Semanas juntos", e-mail de atividade, escopos do aviso "entrou na voz" e funil
da loja. A parte desktop (D2) consome o contrato descrito aqui. Data: 2026-11-01.

## Onde está

| O quê | Arquivo |
|---|---|
| Contrato (tipos, corpos zod, limites, cálculo de horário) | `packages/shared/src/events.ts` |
| Rotas (lista com limites) | `packages/shared/src/api.ts`, bloco "Retention" |
| Eventos do gateway | `packages/shared/src/gateway.ts` (`EVENT_*`, `WEEKLY_RECAP_READY`) |
| Permissão "Criar eventos" | `packages/shared/src/permissions.ts` (`CREATE_EVENTS`, ligada no @everyone) |
| Eventos, RSVP, lembretes | `apps/server/src/events/events.ts`, `apps/server/src/routes/events.ts` |
| Atividade, agregados, agendador | `apps/server/src/activity/activity.ts` |
| Resumo, "Semanas juntos", grupos ativos | `apps/server/src/activity/recap.ts` |
| Cálculo puro sobre sessões | `apps/server/src/activity/spans.ts` |
| E-mail de atividade, descadastro | `apps/server/src/activity/email.ts`, `apps/server/src/routes/activity.ts` |
| Gravação de `voice_sessions` | `apps/server/src/voice.ts` (`onSessionEnd`), ligada em `apps/server/src/app.ts` |
| Tabelas | `apps/server/src/db/schema.ts` (seção "retention"), `apps/server/drizzle/0012_retention.sql` |
| Testes | `apps/server/test/events.test.ts`, `apps/server/test/retention.test.ts` |

## O que o D2 (desktop) precisa saber

### Eventos

- **Datas.** Toda data é hora de parede em `America/Sao_Paulo` (`EVENT_TIME_ZONE`), no formato `AAAA-MM-DDTHH:MM`.
  - O formulário envia `startsLocal` sem fuso, qualquer que seja o fuso do PC.
  - Para mostrar, use `utcToZoned`.
  - Para saber a ocorrência atual ou a próxima, use `currentOccurrence(ev)`. É o mesmo cálculo do servidor e vale para
    eventos semanais que atravessam meia-noite ou horário de verão.
- **Modelos.** `EVENT_TEMPLATE_DEFAULTS` preenche o formulário de "Sexta do jogo", "Cinema de domingo" e "Estudo". O
  servidor só guarda o `template`.
- **Capa.** É uma arte pronta (`EVENT_COVERS`) que o desktop desenha. Só pode ser escolhida com a Casa acesa
  (`Space.upgrade.active`); fora disso o servidor responde 409.
  - O servidor manda `cover: null` enquanto a Casa estiver apagada. A escolha volta quando a Casa acender.
- **Canal.** `channelId` precisa ser um canal de voz do espaço. Se o canal for apagado, ele vira `null` e o evento
  continua.
- **"Agora" da Home.** Use `GET /events`: eventos de todos os seus espaços com ocorrência ao vivo ou futura, a mais
  próxima primeiro.
  - Cartão do espaço: `GET /spaces/:id/events`.
  - Os eventos não vêm no `READY`. Busque depois dele e aplique `EVENT_CREATE`, `EVENT_UPDATE` e `EVENT_DELETE`.
- **"Começou · 3 na sala · Entrar".** Sai do `next` do evento mais os `VoiceState` do `channelId`. Não há evento de
  gateway para isso.
- **Quem pode.**
  - Criar: `CREATE_EVENTS`.
  - Editar ou apagar: quem criou (enquanto tiver `CREATE_EVENTS`) ou quem tem `MANAGE_SPACE`.
  - O editor de cargos (`features/spaceSettings/strings.ts`, `PERMISSION_GROUPS`) ainda não lista `CREATE_EVENTS`.
    Sugestão de texto: "Criar eventos" / "Marcar noites de jogo, cinema e estudo no espaço."

### RSVP

- **Uma resposta vale para todas as ocorrências** de um evento semanal. Decisão: assim o lembrete semanal continua sem
  pedir resposta toda semana.
- **"Não" é privado.**
  - `GET /events/:id/rsvps` lista só "Vou" e "Talvez".
  - No `EVENT_RSVP_UPDATE`, quem não é o autor recebe `status: null`.
  - As contagens `going` e `maybe` estão no evento.
- **E-mail 2 h antes.** É o `emailReminder` do `PUT /events/:id/rsvp`.
  - Precisa de e-mail confirmado (403 sem ele).
  - Cai sozinho com "Não".
  - Omitido no corpo = não muda.

### Lembretes

- **`EVENT_REMINDER`** chega 15 min antes de cada ocorrência, só para quem respondeu "Vou" ou "Talvez".
  - O desktop mostra o aviso do Windows. O texto e o botão "Entrar" usam `channelId`.
  - Sai no máximo uma vez por ocorrência, mesmo com reinício ou dois servidores rodando.
  - Quem estiver offline perde o aviso; o cartão do evento continua mostrando.
- **E-mail.** Sai entre 2 h e 15 min antes, só para quem pediu naquele evento. Não traz o título, que é texto de outro
  usuário.

### Resumo da semana

- **Quando.** Fica pronto segunda-feira às 10h (BRT), para a semana anterior (segunda 00h a domingo 24h).
  - Adultos online recebem `WEEKLY_RECAP_READY`.
  - Quem tem 16–17 anos não recebe aviso: o app mostra o cartão quando abrir.
  - Busque com `GET /users/@me/recap`. `{ recap: null }` = sem voz na semana: não mostre cartão.
- **Campos.**
  - `voiceMinutes` e `nights` (dias com 30 min ou mais).
  - `topChannel`: só canais de espaço.
  - `events` que você foi: 10 min ou mais no canal durante a ocorrência.
  - `people`: até 3, só de quem deixou "Aparecer no resumo dos outros" ligado, sem bloqueio entre vocês e sem tempo.
  - `weeksTogether`.
- **Fora do resumo.** Nada de mensagens, contagens de mensagem ou ranking.
- **`streamWatchedMinutes` nunca vem.** O servidor não sabe quem assiste a uma transmissão: a inscrição na faixa é
  decidida no cliente. Para medir, seria preciso um relatório do app, que a §4.5 proíbe. Deixe o espaço no cartão
  preparado e oculto.
- **Compartilhar.** O cartão para compartilhar é gerado no próprio app (growth-plan §4.1). O servidor não gera imagem.

### Semanas juntos

- **Rotas.** `GET /spaces/:id/weeks-together` (qualquer membro) e `PATCH` com `{ enabled }` (`MANAGE_SPACE`).
- **Onde aparece.** Só no hover do cabeçalho do espaço e no resumo.
- **Sem avisos.** Não existe evento de gateway nem e-mail ligado a isso, e um teste prova. `pauseAvailable` é
  informação, não um alerta: nunca escreva "vai perder".

### Configurações (`GET` e `PATCH /users/@me/activity-settings`)

- **`showInOthersRecap`** ("Aparecer no resumo dos outros"): ligado por padrão.
- **`metricsOptOut`** ("Não usar minha atividade nas métricas do produto"): desligado por padrão.
  - Ao ligar, os `activity_days` da pessoa são apagados e não voltam a ser gravados.
  - Ela também sai de todos os agregados.
- **`activityEmail`**: caixa desmarcada por padrão.
  - Mostre só quando `activityEmailAllowed` for verdadeiro: 18+ com e-mail confirmado. Ligar fora disso dá 403.
  - Cada mudança vira registro em `consent_records` (`purpose = 'activity_email'`, com `withdrawn_at` ao desligar).
  - O texto ao lado da caixa precisa da versão `ACTIVITY_EMAIL_CONSENT_VERSION` (`apps/server/src/activity/email.ts`).
    Mudou o texto, suba a versão.

### Aviso "entrou na voz" (decidido no desktop)

- **De onde vem.** `GET /users/@me/voice-notify` devolve os escopos (espaço, ou canal de DM e grupo) em que você esteve
  em chamada nos últimos 21 dias (`lastCallAt`) e as suas escolhas (`notify`).
  - `notify`: `true` = "Avisar", `false` = nunca, `null` = automático.
  - Para mudar: `PUT /users/@me/voice-notify/:scopeId` com `{ notify }`.
- **Quando avisar.** Quando `notify === true`, ou `notify === null` com `lastCallAt` presente.
- **Tetos (`VOICE_NOTICE_CAPS`), aplicados no cliente:**
  - 1 por escopo a cada 3 h;
  - 4 por dia;
  - nada entre 01h e 09h;
  - nada em chamada, em "Não perturbe" ou com jogo em tela cheia.
- **Atualização.** A lista não é empurrada. Busque de novo ao sair de uma chamada, ou some o escopo localmente.

### Loja

- Chame `POST /shop/opened` (204, até 30 por hora) quando a loja abrir. É só um contador sem usuário.
- Prova e checkout o servidor já conta sozinho.

## Decisões e porquês

1. **Lembrete no máximo uma vez, não pelo menos uma.**
   - A tabela `event_reminders` tem chave primária `(evento, ocorrência, tipo)`. Quem consegue inserir a linha envia.
   - Se o processo cair entre a inserção e o envio, aquele lembrete se perde. Repetir aviso seria pior que perder um.
2. **Agendador único.** `Activity.tick` roda a cada minuto e faz quatro coisas:
   - envia os lembretes;
   - roda o job noturno de cada um dos últimos 7 dias, a partir das 04h do dia seguinte;
   - roda o job semanal de cada uma das últimas 4 semanas, a partir de segunda às 10h (só a mais recente avisa);
   - envia o e-mail de atividade uma vez por dia, entre 11h e 20h.
   - Cada período é reservado em `job_runs`, então roda uma vez mesmo com reinício ou dois servidores.
   - Um período preso há mais de 30 min sem terminar é retomado. Todos os passos podem ser repetidos sem efeito
     duplicado.
3. **Sessões de voz.**
   - Uma linha por `VoiceState` encerrado: saiu, caiu, foi movido ou o canal foi apagado. É o mesmo ponto que o E2EE
     usa (`onLeave`).
   - Se o servidor reiniciar no meio de uma chamada, o `reconcile` recria o estado com o `joinedAt` do LiveKit e a
     sessão é gravada inteira na saída.
   - Uma saída que acontece com a API fora do ar não é gravada.
4. **Copresença ("quem esteve com quem").**
   - É calculada uma vez por semana e guardada só dentro de `weekly_recaps.data.people`: até 10 ids, sem minutos.
   - O resumo mostra 3, filtrando na leitura: chave desligada, bloqueio, conta apagada.
   - Não existe tabela de pares.
5. **Agregados sem ids.**
   - `metric_daily`: `active_users`, `messaging_users`, `voice_users`, `voice_with_other_users`, `signups`,
     `events_with_2plus`, e `active_groups_week` na segunda-feira da semana.
   - `metric_cohorts`: `d1`, `d7`, `d30` e `activated_24h` por dia de cadastro.
   - Toda contagem abaixo de 10 é gravada como `null`. Numa coorte com menos de 10 pessoas, tamanho e valor são `null`.
   - Quem fez opt-out é removido antes de contar.
6. **`activity_days.flags`.**
   - Bit 1, abriu: gravado no primeiro uso autenticado do dia (REST, gateway ou login).
   - Bit 2, mandou mensagem; bit 4, 3 min ou mais em voz; bit 8, 3 min ou mais com a mesma pessoa. Os três são
     derivados à noite, de `messages` e `voice_sessions`.
   - "Mandou mensagem" é só o bit: nunca conteúdo nem contagem.
7. **Ativação aproximada.** `activated_24h` usa os dias BRT do cadastro e o seguinte, não exatamente 24 h.
   - O servidor não sabe se o cadastro veio de convite ou foi orgânico. Por isso não há a divisão 60% / 25% da §4.4.
8. **"Semanas juntos".**
   - A semana conta com 30 min ou mais de 3+ membros juntos no mesmo canal de voz (tempo somado com 3+ presentes).
   - A cada 4 semanas contadas desde a última pausa, uma semana sem chamada vira pausa automática em vez de zerar.
   - Semanas que o job não avaliou (servidor fora do ar a semana toda) contam como perdidas.
   - Quando o admin desliga, a contagem zera. Ao religar, começa do 0.
   - Conta mesmo para quem fez opt-out de métricas: é um recurso do grupo, não uma métrica.
9. **E-mail de atividade.** Só sai quando tudo isto vale:
   - consentimento aberto em `consent_records`;
   - 18+ com e-mail confirmado, conta não restrita e sem exclusão pedida;
   - último uso há 7 dias ou mais;
   - um motivo concreto:
     - evento nos próximos 3 dias num espaço seu, que a pessoa não marcou como "Não";
     - ou um amigo entrou numa chamada de DM com ela depois do último uso.
   - **Tetos:**
     - 1 a cada 7 dias;
     - 4 em 60 dias;
     - depois de 4 sem a pessoa voltar, para até ela voltar (`emails_since_seen` volta a zero no uso seguinte).
   - **Descadastro em 1 clique.** É um link HMAC sem validade (`GET` mostra uma página; `POST` aceita o formulário
     RFC 8058).
10. **16–17 anos.**
    - Não recebem aviso do resumo nem e-mail de atividade.
    - Lembrete de evento: recebem, porque foi pedido no RSVP. O e-mail de lembrete também, se pedirem naquele evento.
    - Os dois lembretes são resposta a um pedido, não notificação de engajamento. Confirmar com o advogado (diff,
      item e).
11. **Eventos avulsos que acabaram.** São apagados 35 dias depois, com os RSVPs. Os semanais ficam até serem apagados.
12. **Limite de 50 eventos marcados por espaço.** Contam os semanais e os avulsos que ainda não acabaram.
13. **Rótulos do Prometheus.** `alga_shop_funnel_total{step, product_type}` só aceita valores de listas fixas; qualquer
    outra coisa vira `other`.
    - Prova e checkout são contados por um gancho `onResponse` em `app.ts`. O código de cobrança não foi tocado.

## Retenção

| Tabela | Prazo | Onde é apagada |
|---|---|---|
| `voice_sessions` | 35 dias depois do fim | `Activity.purge` (noturno) |
| `activity_days` | 90 dias | idem |
| `voice_weekly`, `weekly_recaps` | 12 semanas | idem |
| `event_reminders` | 35 dias | idem |
| eventos avulsos (+ RSVPs) | 35 dias depois de acabar | idem |
| `activity_emails` | 60 dias | idem |
| `job_runs` | 180 dias | idem |
| `metric_daily`, `metric_cohorts` | sem prazo (sem ids, células < 10 ocultas) | — |
| `activity_settings`, `voice_notify_prefs`, `space_streaks` | enquanto a conta ou o espaço existir | cascata |

- **Exclusão de conta.** O expurgo apaga tudo em cascata pelo `user_id`. Em `events.creator_id` o valor vira `null` e o
  evento fica com o espaço.
- **Exportação LGPD.** `dados.json` ganhou a chave `retention`:
  - eventos criados, RSVPs, configurações, `activity_days`, `voice_sessions`, `voice_weekly`;
  - resumos sem `people` (quem os outros encontraram não é dado seu);
  - e-mails de atividade e escolhas de aviso.
  - `consents` passou a trazer `purpose` e `withdrawnAt`.

## Evidência

- **Testes.** `npm test -w apps/server` (PGlite) e `npm run test:pg -w apps/server` (PostgreSQL 18.6 real, via
  `embedded-postgres`): 225 de 225 nos dois. Antes eram 203.
  - Os 22 novos estão em `test/events.test.ts` e `test/retention.test.ts`.
- **Lembrete.** Há testes para:
  - uma vez com dois `remind` concorrentes;
  - semanal atravessando meia-noite UTC;
  - horário de verão de São Paulo em 2018/19;
  - sem repetir depois de reiniciar sobre o mesmo banco (PGlite em diretório ou PostgreSQL);
  - e-mail só para quem pediu.
- **IDOR.** Quem é de fora recebe 403 nas rotas de espaço e 404 em evento, RSVP, lista e edição. A lista geral vem
  vazia e quem sai do espaço deixa de ver.
- **"Semanas juntos" não avisa.**
  - Um espião em `hub.dispatch` e em `mail.sender.send` fica zerado durante 9 semanas de job, pausa e chave do admin.
  - O teste também lê o código: o contrato não tem evento de sequência, e `recap.ts` só despacha `WEEKLY_RECAP_READY`.

## O que ficou fora

- **Painel das métricas da §4.4** (staff ou Grafana). As tabelas existem; falta a tela ou a consulta.
- **`streamWatchedMinutes`.** Não há dado sem relatório do app (ver o resumo da semana, acima).
- **Cabeçalho `List-Unsubscribe`.** `EmailMessage` (`email.ts`) não aceita cabeçalhos. O link no corpo resolve o 1
  clique, e a rota `POST` já existe para quando o cabeçalho existir.
- **Divisão convite × orgânico na ativação.** O cadastro não guarda a origem.
- **Escala.**
  - O lembrete percorre todos os eventos semanais a cada minuto.
  - A copresença é quadrática por canal e por semana.
  - Os dois têm comentário `shortcut:` no código.
