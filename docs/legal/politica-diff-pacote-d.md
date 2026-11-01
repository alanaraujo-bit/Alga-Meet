> **RASCUNHO — requer revisão de advogado antes de publicação**
>
> Proposta de mudanças na `docs/legal/politica-de-privacidade.md` para os pacotes A–D do `docs/business/growth-plan.md`
> (§4.5, itens a–h). Data: 2026-11-01. A política em si **não** foi editada: este arquivo é para o dono e o advogado
> decidirem. Os fatos vêm do código. Nos itens a, b, e, f, o código é o do pacote D (`docs/retention/server.md`). Nos
> itens c, d, g, h, é o do pacote A (`apps/server/src/billing/**`). Isto não é parecer jurídico.

# Diff da Política de Privacidade — pacote D (retenção) e itens de cobrança

## Como ler

- **Onde:** seção da política que muda.
- **Texto proposto:** o que entra, em linguagem de usuário.
- **Base legal:** sugestão, a confirmar com o advogado.
- **Perguntas:** o que precisa de decisão antes de publicar.
- **Regra de publicação.** Nada disto pode ser ligado em produção antes da política publicada.
  - A nova versão do pacote legal entra em `apps/server/src/legal.ts` (`LEGAL_VERSIONS`), com o "o que mudou".
  - Toda conta passa a ver o pedido de novo aceite.

## Mudanças transversais

### "Em resumo" e seção 3: a frase sobre relatórios

- **Hoje:** "Nenhum SDK de rastreamento, nenhum pixel e nenhum relatório de uso é enviado."
- **Problema:** a frase pode sugerir que não existe métrica nenhuma, e o servidor passa a calcular métricas agregadas
  (item a).
- **Texto proposto:**

  > **Não há analytics nem rastreamento no app.** Nenhum SDK de terceiros, nenhum pixel e nenhum relatório de uso sai
  > do app. As métricas do produto são calculadas no nosso servidor, a partir do que ele já recebe para funcionar (por
  > exemplo, quando você usa o app ou entra numa chamada), e guardadas só como totais, sem identificar ninguém (item
  > "Registros de atividade" na seção 2). Você pode tirar sua atividade dessas métricas a qualquer momento.

- **Exceção a citar:** a loja manda ao servidor um aviso de "loja aberta" (`POST /shop/opened`).
  - Ele vira um contador sem usuário: nada é guardado sobre você.
  - Mesmo assim, é um sinal enviado pelo app. Sugestão: dizer isso na mesma frase ("…exceto um aviso anônimo de que a
    loja foi aberta, que só soma um contador").
  - Alternativa: o dono pode decidir tirar esse aviso, e então o funil começa na prova.

### Seção 7: consentimento

- **Hoje:** "Hoje não usamos consentimento como base legal."
- **Problema:** isso já não é verdade com a telemetria de chamada, e o e-mail de atividade (item f) também usa
  consentimento.
- **Texto proposto para a linha "Consentimento (VIII e IX)":**

  > Usamos consentimento em dois casos, ambos desligados por padrão: o relatório de qualidade de chamada (seção 3) e
  > o e-mail de atividade (seção 2). Você liga e desliga quando quiser nas Configurações, e o e-mail de atividade tem
  > um link de descadastro em 1 clique. Recusar ou revogar não tira nada do serviço. Guardamos quando você deu e quando
  > retirou cada consentimento, como prova (LGPD, art. 8º, §2º).

- Na coluna "Hoje": "Existe".

### Seção 2: base legal nova

- **Proposta:** acrescentar à lista de bases o **consentimento** (inciso I).
- **Legítimo interesse:** ampliar de "segurança e prevenção de abuso" para incluir "melhorar o produto com métricas
  agregadas (item a)".
  - Exige o teste de balanceamento (LIA), descrito no item a.

## Itens

### (a) Registros de atividade para métricas agregadas

**Onde:** seção 2 (linha nova na tabela), seção 3 (frase acima) e seção 8 (prazos).

**O que o código faz:**

- **`activity_days`.** Uma linha por pessoa e dia (horário de Brasília) com 4 marcações: abriu o app, mandou alguma
  mensagem, ficou 3 min ou mais em voz, ficou 3 min ou mais em voz com outra pessoa.
  - Nunca conteúdo, nunca quantidade de mensagens.
  - Guardada **90 dias**.
- **Toda noite viram totais sem ids:**
  - `metric_daily`: usuários ativos no dia, cadastros, grupos ativos na semana, eventos com 2+ presentes;
  - `metric_cohorts`: D1, D7, D30 e ativação por dia de cadastro.
  - Contagens abaixo de 10 pessoas ficam ocultas.
- **Opt-out "Não usar minha atividade nas métricas do produto".** Apaga na hora as linhas da pessoa, para de gravar e
  tira a pessoa de todos os totais.
- **"Último uso"** (`activity_settings.last_seen_at`): data do primeiro uso do dia, para o e-mail de atividade (item f).

**Linha proposta na tabela da seção 2:**

| Dado | Para quê | Base legal | Por quanto tempo | Com quem compartilhamos |
|---|---|---|---|---|
| **Registros de atividade**: por dia, se você abriu o app, mandou alguma mensagem, ficou 3 min ou mais em voz e se foi com outra pessoa. **Nunca o conteúdo nem quantas mensagens** | Calcular totais do produto (quantas pessoas voltam, quantos grupos se encontram). Os totais não identificam ninguém e grupos com menos de 10 pessoas não aparecem | Legítimo interesse (inciso IX) | 90 dias. Os totais, sem identificação, ficam guardados | Hospedagem |

**Texto curto para "Seus controles":**

> Em Configurações > Privacidade, "Não usar minha atividade nas métricas do produto" apaga seus registros de atividade
> e tira você dos totais. Fica só o que a lei exige.

**LIA (para o advogado completar):**

- **Finalidade:** medir retenção e ativação do produto. É o mínimo para saber se o app serve aos grupos.
- **Necessidade:** 4 marcações por dia, sem conteúdo nem horário.
- **Balanceamento:**
  - a pessoa espera que o servidor saiba que ela usou o app;
  - os totais não identificam ninguém;
  - o opt-out é imediato.
- **Salvaguardas:**
  - células abaixo de 10 pessoas ocultas;
  - 90 dias;
  - nenhum dado sai para terceiros.

**Perguntas:**

1. Legítimo interesse serve aqui para adolescentes de 16–17? A LGPD (art. 14) pede o melhor interesse do adolescente.
   - Opção: opt-out ligado por padrão para 16–17.
   - Isso exige uma mudança pequena no código (hoje o padrão é igual para todos).
2. A marcação "mandou mensagem" é derivada do horário das mensagens já guardadas. Basta citar na política, ou é
   preciso detalhar mais?

### (b) Resumo da semana e "Semanas juntos"

**Onde:** seção 2 (linha nova), seção 6 (o que outras pessoas veem) e seção 8 (prazos).

**O que o código faz:**

- **Sessões de voz (`voice_sessions`).**
  - Quem, em qual canal, de que horas a que horas.
  - Vem do servidor de voz, que já precisa saber quem está na sala.
  - Guardadas **35 dias**.
- **Uma vez por semana (segunda, 10h) viram:**
  - `voice_weekly`: minutos e noites por pessoa, semana e canal, por **12 semanas**;
  - o resumo da pessoa, por **12 semanas**: horas em voz, noites, canal mais usado, eventos em que esteve, até 3
    pessoas com quem mais esteve.
- **Copresença.** "Com quem esteve" é calculado só nesse momento e guardado só dentro do resumo de quem o recebe.
  - São até 10 ids, sem tempo; 3 aparecem.
- **Chave "Aparecer no resumo dos outros"** (ligada por padrão). Desligada, a pessoa nunca aparece no resumo de
  ninguém, inclusive nos já calculados.
  - Bloqueio entre duas pessoas também tira uma do resumo da outra.
- **"Semanas juntos".**
  - Por espaço: semanas seguidas com ao menos 1 chamada de 3+ membros por 30 min.
  - Visível aos membros, no espaço e no resumo.
  - O admin desliga. Nunca há aviso.
- **16–17 anos:** veem o resumo no app, sem aviso.

**Linha proposta na tabela da seção 2:**

| Dado | Para quê | Base legal | Por quanto tempo | Com quem compartilhamos |
|---|---|---|---|---|
| **Tempo em voz**: em qual canal e de que horas a que horas você esteve em chamada | Montar o seu resumo da semana (horas em voz, noites, canal mais usado, eventos em que esteve, as 3 pessoas com quem mais esteve) e as "Semanas juntos" do espaço | Contrato `[ou legítimo interesse — decidir]` | Bruto: 35 dias. Totais por semana e o resumo: 12 semanas | Hospedagem. Seu resumo só você vê. Você aparece no resumo de outras pessoas só se deixar "Aparecer no resumo dos outros" ligado |

**Seção 6, acréscimos:**

- "Se você deixar 'Aparecer no resumo dos outros' ligado, as pessoas com quem você mais esteve em voz numa semana
  podem ver seu nome entre as 3 do resumo delas. Elas não veem quanto tempo."
- "Os membros de um espaço veem há quantas semanas seguidas o grupo se encontra ('Semanas juntos'). O admin pode
  desligar."

**Perguntas:**

1. **Base do resumo.** É contrato (um recurso do app) ou legítimo interesse? A chave "Aparecer no resumo dos outros"
   protege o terceiro; ela basta como salvaguarda?
2. **"Semanas juntos"** revela aos membros que o grupo se encontrou, mas não quem. Precisa de chave individual além da
   do admin?

### (c) Presentes

**Onde:** seção 2 (linha de Pagamentos) e seção 6. Código do pacote A: tabela `gifts`.

**O que o código faz:**

- Guarda quem deu, quem recebeu, o item, a mensagem (até 140 caracteres), a data de entrega e o estado.
- Os dois lados veem o presente e a mensagem.
- Fica junto com o pedido pelo prazo fiscal.
- Se uma das contas for excluída, o lado dela vira `null` e o pedido perde a identidade, como os demais pagamentos.

**Texto proposto, acrescentado à linha "Pagamentos":**

> Presentes: quem deu, quem recebeu e a mensagem (até 140 caracteres). Quem deu e quem recebeu veem o presente e a
> mensagem. Ficam guardados com o pedido, pelo prazo fiscal. Se você excluir a conta, seu nome sai do presente.

**Pergunta:** a mensagem do presente é conteúdo de comunicação privada. Guardá-la pelo prazo fiscal é necessário, ou
dá para apagar a mensagem antes (por exemplo, 6 meses) e manter só o pedido?

### (d) Lista de desejos

**Onde:** seção 2 (linha nova) e seção 6. Código do pacote A: tabela `wishlists`, `users.wishlist_visible`.

**O que o código faz:**

- Até 20 itens.
- Visível a amigos quando a pessoa deixa.
- Por padrão: ligada para 18+, desligada para 16–17.
- Fica até a pessoa tirar ou excluir a conta.

**Texto proposto:**

> **Lista de desejos**: os itens da loja que você marcou. Seus amigos podem ver se você deixar visível (ligado por
> padrão para maiores de 18, desligado para 16 e 17 anos). Fica até você tirar o item ou excluir a conta.

### (e) Eventos e RSVP

**Onde:** seção 2 (linha nova), seção 6 e seção 10 (adolescentes).

**O que o código faz:**

- **Evento:** título, descrição, canal de voz, data e hora, recorrência semanal e capa, criado por um membro.
  - Visível só aos membros do espaço.
  - Avulsos são apagados 35 dias depois de acabar. Semanais ficam até alguém apagar.
- **Respostas.**
  - "Vou" e "Talvez" são visíveis aos membros do espaço.
  - "Não" só a própria pessoa vê.
- **Lembrete** no app 15 min antes, para quem respondeu "Vou" ou "Talvez".
  - E-mail 2 h antes só se a pessoa pedir naquele evento.
  - O e-mail não traz o título, que é texto de outro usuário.
- **Envio.** O servidor guarda que o lembrete de cada ocorrência foi enviado, por 35 dias, para nunca repetir.

**Linha proposta na tabela da seção 2:**

| Dado | Para quê | Base legal | Por quanto tempo | Com quem compartilhamos |
|---|---|---|---|---|
| **Eventos e respostas**: eventos que você cria (título, descrição, canal, data e hora, se repete) e suas respostas (Vou, Talvez, Não; se pediu lembrete por e-mail) | Marcar encontros do grupo e lembrar quem vai | Contrato | Evento único: 35 dias depois de acontecer. Semanal: até ser apagado. Resposta: enquanto o evento existir | Hospedagem. Membros do espaço veem o evento e quem vai ou talvez vá. "Não" só você vê. O e-mail de lembrete passa pelo Resend |

**Perguntas:**

1. **Lembretes para 16–17.** Hoje adolescentes recebem o lembrete de evento (no app e, se pedirem, por e-mail),
   porque é resposta a um pedido deles. A §4.3 do plano só proíbe o e-mail de atividade para 16–17. Confirmar.

### (f) E-mail de atividade, por consentimento

**Onde:** seção 2 (linha nova), seção 7 (consentimento, acima) e seção 10.

**O que o código faz:**

- **Só sai com consentimento:**
  - caixa desmarcada por padrão;
  - cada "sim" e cada "não" ficam registrados com data em `consent_records`, com a versão do texto.
- **Só para quem pode receber:** 18+ com e-mail confirmado. **Nunca para 16–17.**
- **Só quando há motivo:** a pessoa está há 7 dias ou mais sem usar e há um motivo concreto.
  - Motivo 1: um evento nos próximos 3 dias num espaço dela.
  - Motivo 2: um amigo a chamou numa chamada.
- **Tetos:** no máximo 1 a cada 7 dias e 4 em 60 dias. Depois de 4 sem a pessoa voltar, para até ela voltar.
- **Descadastro:** em 1 clique, sem login.
- **Registro de envio:** guardado 60 dias (motivo e data), para cumprir os tetos.

**Linha proposta na tabela da seção 2:**

| Dado | Para quê | Base legal | Por quanto tempo | Com quem compartilhamos |
|---|---|---|---|---|
| **E-mail de atividade** (só se você ativar): quando você usou o app pela última vez e os e-mails que mandamos | Avisar, no máximo uma vez por semana, quando há algo concreto esperando você (um evento marcado, um amigo que chamou) | Consentimento (inciso I), revogável a qualquer momento | Enquanto estiver ativado. Registro de envio: 60 dias. A prova do consentimento fica enquanto a conta existir | Resend (envio do e-mail) |

**Texto ao lado da caixa (precisa da aprovação do advogado; versão `2026-11-01` no código):**

> Quero receber e-mails do Alga Meet quando eu ficar uma semana sem entrar e houver algo me esperando, como um evento
> marcado ou um amigo que me chamou. No máximo um por semana. Posso desligar quando quiser.

**Perguntas:**

1. **Exige consentimento ou basta legítimo interesse?** O e-mail é de reengajamento: o plano optou por consentimento,
   que é o mais protetivo.
2. **Usar "último uso" e "um amigo chamou"** para escolher o momento do e-mail é perfilamento no sentido do art. 20?
   Sugestão: não, porque é uma regra simples e divulgada, sem pontuação de perfil.

### (g) Provador transmitido à sala

**Onde:** seção 6. Código do pacote A: `apps/server/src/billing/tryon.ts`.

**O que o código faz:**

- Quem está numa chamada pode "provar" um item à venda por 5 minutos.
- As outras pessoas da mesma chamada veem o item e a etiqueta "provando".
- Nada fica guardado no banco: só na memória do servidor durante a prova.
- Há um limite de 10 provas por dia. 16–17 não têm acesso.

**Texto proposto (seção 6):**

> Quando você usa o provador numa chamada, as pessoas da chamada veem o item em você por até 5 minutos, com a etiqueta
> "provando". Não guardamos isso.

### (h) Mural da Casa (opcional)

**Onde:** seção 6. Código do pacote A: `space_upgrade_contributions.show_on_wall`.

**O que o código faz:**

- Quem contribui para a Casa de um espaço escolhe se aparece no mural.
- O mural mostra o nome, em ordem alfabética, aos membros do espaço.
- **Nunca o valor.** Desmarcado por padrão.

**Texto proposto (seção 6):**

> Se você contribuir para a Casa de um espaço e escolher aparecer no Mural da Casa, os membros do espaço veem seu
> nome na lista (em ordem alfabética, sem valores).

## Seção 8 (retenção): linhas novas

| Dado | Prazo |
|---|---|
| Registros de atividade | 90 dias |
| Sessões de voz (bruto) | 35 dias |
| Minutos por semana e resumo da semana | 12 semanas |
| Eventos únicos e suas respostas | 35 dias depois do evento |
| Registro de lembretes enviados | 35 dias |
| Registro de e-mails de atividade | 60 dias |
| Totais sem identificação | sem prazo (não são dados pessoais) |

Ao excluir a conta, tudo isso é apagado junto. Os eventos que você criou ficam com o espaço, sem o seu nome.

## Seção 7 e exportação

A cópia dos dados (`POST /users/@me/export`) passa a incluir:

- eventos criados;
- respostas;
- configurações de atividade;
- registros de atividade;
- sessões de voz;
- minutos por semana;
- resumos (sem as pessoas, que são dados de terceiros);
- e-mails de atividade enviados;
- escolhas de aviso;
- consentimentos com a data de retirada.

A linha de portabilidade da seção 7 pode citar isso.

## Seção 10 (adolescentes): acréscimos

- **16 e 17 anos:**
  - não recebem e-mail de atividade nem aviso de resumo semanal;
  - não têm provador nem compras;
  - a lista de desejos começa oculta.
- **Pendente (item a, pergunta 1):** decidir se os registros de atividade de 16–17 começam fora das métricas.
