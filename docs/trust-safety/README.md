> **RASCUNHO — decisões de produto e engenharia, a confirmar com o advogado** (`docs/legal/review-notes.md`).
> Data: 2026-11-01. Código: `apps/server/src/{legal,trust-safety,privacy}.ts`, `src/routes/{privacy,reports,admin}.ts`.
> Contrato: `packages/shared/src/trust-safety.ts`.

# Trust & Safety e privacidade: o que o servidor faz e por quê

| Lacuna (review-notes) | Implementado | Seção |
|---|---|---|
| L1 idade | Data de nascimento no cadastro, recusa abaixo de 16, `Me.ageBracket`, declaração única para contas antigas | 1 |
| L10 / P3 16–17 anos | DM só com amigos, sem compras | 1 |
| L7 aceite | Versão e data no cadastro, histórico em `consent_records`, novo aceite quando a versão muda | 2 |
| L2 denúncia e moderação | `POST /reports`, fila da equipe, aviso, suspensão e banimento da conta, recurso | 3, 4 |
| L3 abuso infantil | Quarentena automática (reversível) com preservação; retenção legal quando a equipe confirma. Procedimento em `csam-process.md` | 5 |
| L4 exclusão | `DELETE /users/@me`, 7 dias de carência, expurgo | 6 |
| L5 exportação | `POST /users/@me/export`: zip com link assinado enviado por e-mail; no app, só com a senha | 7 |
| L6 registros de acesso | `access_logs`, 6 meses, só admin | 8 |
| F3 auditoria da equipe | `staff_audit_log` em toda chamada `/admin/*` | 4 |

## 1. Idade (Lei 15.211/2025)

### O que guardamos

Guardamos a **data de nascimento** (`users.birth_date`, só a data) e quando foi declarada (`birth_date_set_at`).

Por que a data, e não uma faixa com a data da verificação:

- A faixa muda sozinha com o tempo: aos 18, a conta deixa de ser de adolescente sem perguntar nada de novo.
- Guardar "faixa + data em que a pessoa faz 18" seria a mesma informação com outro nome.
- O recurso precisa da data declarada: "a pessoa disse que nasceu em X".

A data é usada **só** para calcular a faixa (art. 13), em `ageBracketOf` (`src/legal.ts`). Ela não aparece em
`PublicUser` nem em `Me`: só `Me.ageBracket` (`unknown` | `teen` | `adult`). Ela entra na exportação da própria pessoa.
A idade é contada no calendário de Brasília.

### Cadastro

- `RegisterBody.birthDate` (AAAA-MM-DD) e `termsVersion` são **obrigatórios em produção**, ou com `REQUIRE_BIRTHDATE=1`.
- Em dev são opcionais, com um `warn` no log, até o desktop mandar os dois campos.
- **Menos de 16 anos:** 400 com `fields.birthDate` ("O Alga Meet é para pessoas com 16 anos ou mais.") e **nada é
  gravado**.

### Contas antigas

Contas antigas ficam com `ageBracket: 'unknown'`. O app pergunta uma vez: `PATCH /users/@me/birth-date`, e depois disso
a rota responde 409. Se a pessoa declarar menos de 16 anos (Termos 3.1, Política 10):

- a conta é **suspensa** com o motivo `underage`;
- as sessões caem e o gateway fecha com o código 4010;
- a exclusão fica marcada para daqui a **30 dias**, apagando também as mensagens;
- o e-mail avisa como contestar;
- um recurso aberto segura a exclusão;
- se o recurso for aceito, a suspensão cai, a data some e a pessoa declara de novo. **A equipe só aceita o recurso
  depois de conferir a idade por fora**, com um documento mostrado e não guardado.

### 16 e 17 anos: padrão mais protetivo (art. 7º)

| Regra | Onde |
|---|---|
| **DM só com amigos, nos dois sentidos.** O adolescente não abre DM com quem não é amigo, e ninguém que não é amigo abre DM com ele. A mensagem de erro não revela a idade da outra pessoa | `POST /users/@me/channels` |
| **Sem compras** até existir o fluxo com o responsável (Código Civil, art. 4º, I; Termos 3.2) | `POST /billing/checkout` |
| Idade `unknown` também não compra quando o servidor exige data de nascimento (produção) | idem |

O que **não** foi feito:

- **Selo de espaço 18+.** O conteúdo sexual é proibido em todo o serviço (D7), então o selo não teria função.
- **Status "invisível" para adolescentes.** Já está disponível para todos.
- **Bloquear pedidos de amizade de desconhecidos.** O adolescente pode recusar ou bloquear.

### Limite conhecido

A aferição é **autodeclaração** (D2). A ANPD a considera pouco confiável. Hoje ela é compensada por três coisas:
suspensão por indícios, recurso e, a seguir, o sinal de idade do sistema operacional (F2).

## 2. Aceite dos Termos

- `TERMS_VERSION` (`src/legal.ts`) é a versão do pacote Termos + Política + Diretrizes, publicados juntos. `GET /legal`
  devolve essa versão e os links.
- O cadastro grava em `users.terms_version` e `terms_accepted_at` e acrescenta uma linha em `consent_records`. Essa
  tabela é o histórico que prova o que foi aceito e quando.
- Para mudar a versão, troque a constante no release que publica o novo texto. A partir daí toda conta recebe
  `Me.needsTermsAcceptance: true`, até chamar `POST /users/@me/accept-terms {termsVersion}`. Uma versão velha
  recebe 400.
- O servidor **não bloqueia** o uso enquanto o novo aceite não vem. Quem mostra o texto e pede o aceite é o app.
  Bloquear ou não é uma decisão do advogado (D16).

## 3. Denúncias

- `POST /reports {targetType: message|user|space, targetId, reason, details?}`. O limite de `details` é 1000
  caracteres.
- Regras:
  - 10 denúncias por hora por conta;
  - **`csam`: no máximo 5 em 24 horas por conta** (`CSAM_REPORTS_PER_DAY`), contadas no banco. A sexta responde 429.
    Cada denúncia `csam` tira anexos de circulação na hora, então o teto limita o que uma pessoa mal-intencionada
    consegue esconder;
  - ninguém denuncia a própria mensagem, a si mesmo ou o próprio espaço;
  - para denunciar uma mensagem, a pessoa precisa conseguir vê-la. Se não consegue, a resposta é 404, igual à de uma
    mensagem que não existe.
- **Repetir a denúncia** do mesmo alvo enquanto a primeira está aberta devolve a mesma denúncia (200).
- **Retrato na hora da denúncia** (`reports.snapshot`):
  - mensagem: texto, autor, canal e metadados dos anexos;
  - perfil: dados públicos;
  - espaço: nome, dono e número de membros.

  O retrato sobrevive à exclusão da mensagem ou da conta. `target_user_id` não tem FK. **Os bytes dos anexos só são
  preservados na quarentena** (seção 5).
- **Os motivos** seguem as Diretrizes (`REPORT_REASONS`). A prioridade vai de **100** (`csam`) a **50** (violência,
  autolesão, imagem íntima sem consentimento) e **10** (o resto).
- **Quem denunciou nunca é revelado** ao denunciado. Só a equipe vê `reporterId`, necessário para tratar denúncias
  abusivas (F11) e para o art. 29 (D17).
- **Confiabilidade de quem denuncia (F11):** cada denúncia que a equipe arquiva (`dismissed`, "sem fundamento") soma 1
  em `users.false_reports` do denunciante. A fila mostra esse número em `AdminReport.reporterFalseReports`. Diante de
  abuso, a equipe aplica uma medida ao denunciante com `POST /admin/users/:id/actions` (por exemplo `warn` ou `suspend`
  com o motivo `spam`). O número não tem efeito automático; ele entra na exportação da própria pessoa.

## 4. Medidas na conta, equipe e recursos

### Equipe

- `users.staff_role` (`moderator` | `admin`) é definido **só** por
  `npx tsx apps/server/scripts/grant-staff.ts <username> <admin|moderator|none>`, e a concessão vai para o log.
- Nenhuma rota da API altera esse campo.
- Tudo em `/admin/*` exige um papel de equipe. Os registros de acesso exigem `admin`.
- Só um admin aplica medidas a contas da equipe, e ninguém aplica medida a si mesmo.
- **Toda chamada** é gravada em `staff_audit_log` **antes** de executar, com rota, parâmetros, query e corpo. O status
  da resposta é gravado depois. Assim nenhuma ação fica sem registro. Ler a fila também é registrado, porque é acesso
  a conteúdo (F3).

### Medidas

| Medida | Efeito |
|---|---|
| `warn` | Só o registro e o e-mail. Nada é bloqueado |
| `suspend` até uma data | O login responde 403 com `error.restriction` (motivo, até quando, prazo e token de recurso). As sessões são apagadas, o gateway fecha com **4010 `ACCOUNT_RESTRICTED`**, a pessoa sai da voz (`removeParticipant` no LiveKit) e o token antigo do LiveKit não entra de novo. A suspensão acaba sozinha na data |
| `ban` | O mesmo efeito, sem data de fim |
| `lift` | Encerra a suspensão ou o banimento em vigor |

- A medida pode vir de uma denúncia (`PATCH /admin/reports/:id {status, action, until?, note?}`). Nesse caso,
  `remove_content` apaga a mensagem ou o espaço denunciado. Também pode ser aplicada direto, com
  `POST /admin/users/:id/actions`.
- O e-mail vai **só para endereço verificado**. Ele leva a **categoria** da regra violada (`REASON_LABELS`), nunca a
  nota interna da equipe, e o prazo do recurso.
- **Exceção, `csam`:** não há e-mail, e a pessoa vê o motivo genérico `other`. Avisar atrapalharia a investigação
  (Termos 8.4).
- O histórico (`account_actions`) dura enquanto a conta existir, porque serve para sanções graduais. Depois do
  expurgo, dura 6 meses.

### Recurso

- `POST /appeals {actionId, message, appealToken?}`, até **30 dias** depois da medida e um por medida.
- Quem está suspenso ou banido não tem sessão: usa o `appealToken` que o login devolveu. Ele vale 1 hora, só serve
  nessa rota e prova que a pessoa acabou de acertar a senha. Quem recebeu aviso usa a sessão normal.
- `GET /users/@me/actions` lista as medidas da conta com o prazo e o recurso de cada uma.
- A equipe decide em `PATCH /admin/appeals/:id {status: upheld|rejected}`.
  - "Aceito" levanta a medida, se ela ainda estiver em vigor.
  - A pessoa recebe o resultado por e-mail.
  - Quem decide não pode ser a própria pessoa recorrendo.
  - Recomendado, ainda não imposto: que o recurso seja decidido por alguém diferente de quem aplicou a medida.

## 5. Quarentena (abuso infantil e outros conteúdos ilegais graves)

O processo completo está em [`csam-process.md`](csam-process.md). O mecanismo:

- Entra em quarentena pela denúncia `csam` (automático) ou por `POST /admin/attachments/:id/quarantine`.
- O anexo fica inacessível na hora: sai da mensagem, `/files/:id` responde 404 e os clientes recebem
  `MESSAGE_UPDATE`.
- Os bytes vão para `evidence/<id>` com o SHA-256 em `quarantined_files`, uma tabela sem FK para a mensagem.
- O original só é apagado depois da cópia. Se a cópia falhar, o job tenta de novo.
- **Retenção legal da conta do autor só por decisão da equipe**, nunca pela denúncia sozinha (uma denúncia pode ser
  falsa e a retenção seguraria a exclusão de um inocente sem prazo). Ela entra quando:
  - a equipe decide uma denúncia `csam` como `resolved` (confirmada);
  - a equipe põe o anexo em quarentena à mão;
  - ou com `PATCH /admin/users/:id {legalHold:true}`.
- Enquanto uma denúncia `csam` contra a conta está **aberta**, o expurgo da conta espera (como um recurso aberto). Se a
  equipe arquiva a denúncia, a exclusão pedida segue.
- **Falso positivo:** `POST /admin/quarantine/:id/release` devolve o arquivo à mensagem, com um id novo, e os clientes
  recebem `MESSAGE_UPDATE`. A cópia em `evidence/` é apagada e o registro fica com `releasedAt`. A chamada vai para o
  `staff_audit_log`. A rota recusa (409) depois do `receiptConfirmed`, na segunda vez e enquanto a cópia não terminou.
  Ela não tira a retenção legal: isso é sempre um passo à parte. Se a mensagem já foi apagada, só a cópia é apagada.
- `PATCH /admin/quarantine/:id {authorityProtocol, receiptConfirmed: true}` apaga o material depois de a PF confirmar o
  recebimento (Decreto 12.880/2026, art. 39, §2º).

**Retenção legal** (`users.legal_hold_at`, `PATCH /admin/users/:id {legalHold}`):

- a conta não é expurgada;
- os registros de acesso não expiram;
- serve também para pedidos de guarda de autoridade (Marco Civil, art. 15, §2º).

## 6. Exclusão de conta (LGPD, art. 18, VI; Marco Civil, art. 7º, X)

`DELETE /users/@me {password, messages?: 'anonymize' | 'delete'}`:

1. Confere a senha. O limite é 5 tentativas a cada 15 minutos.
2. **Para a renovação** de uma assinatura ativa no provedor. Se o provedor falhar, o pedido falha também: a conta
   não pode sumir enquanto a cobrança continua.
3. Marca o expurgo para daqui a **7 dias** e encerra todas as sessões com 4004. Manda um e-mail.
4. **Entrar de novo nesse prazo cancela a exclusão.** A resposta traz `AuthResponse.deletionCanceled` e um e-mail
   avisa.

Os e-mails de "exclusão marcada" e "exclusão cancelada" saem **no máximo 1 de cada por conta a cada 24 horas**. Sem
isso, excluir e entrar de novo em loop (5 a cada 15 minutos) enchia a caixa da própria pessoa. O primeiro aviso de
cada tipo sempre sai.

O expurgo é feito pelo job `Privacy.retention`, a cada minuto. Ele pula contas com retenção legal, recurso aberto ou
denúncia `csam` aberta contra elas.

| O quê | O que acontece |
|---|---|
| **Espaços próprios** | Vão para o membro com o cargo mais alto e, no empate, para o mais antigo. Membro banido ou que também está saindo não herda. Sem herdeiro, o espaço é excluído |
| **Mensagens (D13)** | A pessoa escolhe. **Padrão: `anonymize`.** O texto fica, com o autor "Usuário removido" (`REMOVED_USER_ID`), para as conversas dos outros continuarem legíveis. Com `delete`, as mensagens são apagadas, nos espaços e nas DMs, e os apps abertos recebem `MESSAGE_DELETE` de cada uma (100 por canal a cada 100 ms, em segundo plano) |
| **Anexos e avatar** | **Sempre apagados** do storage. Fotos são o conteúdo que mais identifica |
| Exportações | Apagadas do storage |
| Sessões, e-mails pendentes, amizades, bloqueios, participação em espaços, cargos, reações, leituras, convites, aceites | Apagados (cascade) |
| DMs | A pessoa sai. Uma DM que fica sem ninguém é apagada |
| **Pagamentos** | `subscriptions` e `orders` ficam, como registro fiscal: valor, data, produto e id do provedor. O vínculo passa para `REMOVED_USER_ID`, sem e-mail nem nome. O Mercado Pago guarda os dados do pagador como controlador independente. As FKs `restrict` continuam de propósito: protegem contra apagar registro fiscal sem querer |
| **Fica por 6 meses** | Registros de acesso. `deleted_accounts`: id, username e o **SHA-256** do e-mail, para atender a ordem judicial sobre "a conta X" sem guardar o endereço |
| **Fica com o caso** | Denúncias feitas pela pessoa (o denunciante vira nulo), denúncias contra ela, medidas e recursos (seção 9) |
| Backups do banco | O que estava lá some no ciclo de backup (Política 8: até 3 meses) |

Por que um único "Usuário removido" para todo mundo, e não um pseudônimo por conta: as mensagens de quem saiu não
ficam ligadas entre si por um id. É mais perto da anonimização (LGPD, art. 5º, III) do que um pseudônimo estável.

Contas suspensas ou banidas **não se autoexcluem**, porque não têm sessão. Elas pedem ao encarregado, e o caso é
analisado para não destruir prova. Ver as pendências.

## 7. Exportação de dados (LGPD, art. 18, II e V)

- `POST /users/@me/export` responde 202. Exige **e-mail verificado** e aceita **1 pedido a cada 24 h**, contado no
  banco (sobrevive a reinício). Se a exportação falhar, a pessoa pode pedir de novo.
- Um job monta um **zip** com `dados.json` e `LEIA-ME.txt` em pt-BR. Ele vai para `exports/<user>/<id>.zip` no storage.
- O conteúdo:
  - conta, aceites, sessões, relações, espaços e DMs;
  - mensagens próprias, com a **lista dos anexos e um link assinado** que vale 7 dias e confere o acesso ao canal;
  - reações e pagamentos;
  - registros de acesso dos últimos 6 meses;
  - medidas, recursos e denúncias **feitas** pela pessoa.
- Fica de fora o que é de terceiros: denúncias contra a pessoa e quem as fez.
- O **link de 7 dias vai só por e-mail**, assinado (HMAC). Depois de 7 dias o zip é apagado e o link responde 404.
- **No app, baixar exige a senha de novo.** `GET /users/@me/exports` mostra só o estado de cada pedido. O campo
  `DataExport.downloadUrl` continua no contrato para apps antigos, mas vem sempre `null`. O link sai de
  `POST /users/@me/exports/:id/download {password}`, que devolve `{ downloadUrl }`:
  - confere a senha, como a exclusão de conta;
  - o link vale **10 minutos** (`EXPORT_DOWNLOAD_TTL_MINUTES`) e nunca passa da validade do zip;
  - aceita 5 chamadas a cada 15 minutos por conta;
  - cada link emitido vira uma linha `export_download` em `access_logs`, com IP e hash do user agent (seção 8);
  - pedido em preparo responde 409; falho, expirado ou de outra conta, 404.
- **A garantia:** quem rouba só a sessão não leva os dados. Precisa também da senha ou da caixa de e-mail.
- Limite conhecido: o zip é montado em memória, sem zip64, então serve até alguns GB.

## 8. Registros de acesso (Marco Civil, art. 15)

- A tabela `access_logs` guarda id da conta, IP, SHA-256 do user agent, evento e data e hora, em UTC.
- O que vira linha:
  - **todo login e cadastro**;
  - o **primeiro uso de cada dia** por conta, IP e app, seja em REST ou no gateway;
  - **cada link de exportação emitido no app** (`export_download`, seção 7).
- O IP vem de `req.ip`, com a regra de proxy confiável de `TRUST_PROXY`.
- **Sem FK:** os registros ficam 6 meses mesmo depois da exclusão da conta. Depois são expurgados pelo job, salvo com
  retenção legal.
- A **porta lógica de origem não é registrada (D23).** Atrás do proxy do Railway ela não chega à API. Se o STJ exigir a
  porta (CGNAT), será preciso um proxy que a repasse (por exemplo `X-Forwarded-Port` do cliente) ou registrá-la no
  edge.
- Acesso: só `GET /admin/access-logs` com papel `admin`, auditado, por `userId` ou `username` (também de conta excluída
  há menos de 6 meses).
- **Entregamos esses dados só com ordem judicial** (Política 11). A rota é para atender a ordem, nunca para curiosidade.
- A tabela `sessions` continua sem IP: a afirmação "sessões sem IP" da Política segue verdadeira.

## 9. Retenção

| Dado | Prazo | Quem apaga |
|---|---|---|
| Registros de acesso | 6 meses, ou mais com retenção legal | Job |
| `deleted_accounts` (username + hash do e-mail) | 6 meses | Job |
| Denúncias decididas | 6 meses depois da decisão. **`csam`: sem expurgo automático** | Job |
| Recursos decididos | 6 meses depois da decisão | Job |
| Medidas na conta | Enquanto a conta existir. 6 meses depois do expurgo | Job |
| Exportações | Zip apagado aos 7 dias. A linha, aos 30 | Job |
| Conta pedida para exclusão | 7 dias de carência, ou 30 dias quando a declaração de idade é abaixo de 16 | Job |
| Prova em quarentena | Até a autoridade confirmar o recebimento | Equipe (`receiptConfirmed`) |
| Registro da quarentena (hash, ids, protocolo) | Sem prazo | — |
| `staff_audit_log` | Sem prazo | `[DECIDIR com o advogado]` |
| Pagamentos | Prazo fiscal (Política: cerca de 5 anos), sem a identidade depois do expurgo | `[a implementar quando o prazo for confirmado]` |

## 10. Operação

- **Dar papel de equipe**: `npx tsx apps/server/scripts/grant-staff.ts fulano moderator`.
  - Em produção, rode onde o `DATABASE_URL` alcança o banco (por exemplo `railway run`).
  - Com PGlite local, **pare o servidor antes**: dois processos no mesmo diretório travam.
- **Fila**:
  - leia com `GET /admin/reports`, em ordem de prioridade e, dentro dela, da mais antiga;
  - decida com `PATCH /admin/reports/:id`. `dismissed` conta contra quem denunciou; `csam` como `resolved` põe a conta
    em retenção legal;
  - olhe `reporterFalseReports` antes de confiar numa denúncia `csam` de quem já errou muito;
  - os recursos estão em `GET /admin/appeals`.
- **Denúncia `csam` falsa:** arquive (`dismissed`) e libere cada arquivo com `POST /admin/quarantine/:id/release`
  (ids em `GET /admin/quarantine`, campo `reportId`).
- **Ordem judicial pedindo dados:** registre o número do processo em `note` e use `GET /admin/access-logs`. Se houver
  pedido de guarda, use `PATCH /admin/users/:id {legalHold:true}`.
- **Exportação falhou:** a linha fica com `status='failed'` e `error`. A pessoa pode pedir de novo.

## 11. Pendências para o advogado e para o dono

- **D2.** A autodeclaração basta? Vale o sinal do Windows (F2)?
- **Recurso de idade.** Qual documento a equipe pode pedir e como provar que não guardamos cópia?
- **Exclusão de conta suspensa ou banida.** O direito de exclusão pode esperar o fim do caso? Por quanto tempo?
- **Fiscal.** Confirmar o prazo com o contador e implementar o expurgo de `subscriptions` e `orders`.
- **Retenção de `staff_audit_log` e das denúncias `csam`.**
- **Prazo do ato do MJSP** para os "demais dados" da conta depois do recebimento pela PF (art. 39, §2º).
- **Cadastro no Nidus** e a pessoa credenciada (veja `csam-process.md`).
- **Aceite.** Bloquear o uso até o novo aceite, ou só avisar?
- **D23.** Porta lógica de origem.
- **`deleted_accounts`.** Guardar o hash do e-mail por 6 meses está coberto pelo art. 16, I, da LGPD?
