# Alga Admin (app Android da equipe)

O painel de bolso do dono: dinheiro, uso, saúde do sistema, contas e avisos na hora. Código em `apps/admin-android`
(Kotlin + Jetpack Compose); API em `apps/server/src/routes/admin-app.ts`, `src/admin/` e o contrato em
`packages/shared/src/admin.ts`.

## Por que nativo (Kotlin + Compose)

- Push confiável no Android só existe pelo FCM, e o FCM entrega no app nativo mesmo com o app fechado e o celular em
  Doze (mensagem de prioridade alta).
- Vidro de verdade (desfoque do que está atrás): `RenderEffect` do Android 12+, via Haze. `minSdk 31` por isso.
- Gráficos com o dedo (arrastar mostra o valor do dia) a 120 Hz sem WebView.

## Acesso e segurança

- Mesma sessão do Alga Meet (`POST /auth/login`); só entra conta com `users.staff_role` (dada só por
  `scripts/grant-staff.ts`). Toda chamada `/admin/*` passa pela checagem de equipe e fica no `staff_audit_log`.
- Dinheiro (Início, Uso, pagamentos de uma conta, avisos de venda) é só para `admin`; moderação vê Saúde, Contas e
  Alertas sem valores.
- No celular: token cifrado com chave AES-GCM do Android Keystore, sem backup em nuvem; bloqueio com digital/PIN ao
  abrir e depois de 1 minuto fora (Ajustes → "Bloquear com digital").
- Aparelho de push ligado à sessão: sair, trocar a senha, revogar sessões ou suspender a conta apaga o registro.
- O texto do push passa pelo Google: nunca leva nome, @ ou e-mail. O app mostra quem foi ao abrir o aviso.

## Telas

**Início (dinheiro, admin).** Período: hoje, 7, 30, 90 dias, 1 ano.
- Recebido no período (líquido = bruto − reembolsos), comparação com o período anterior, curva acumulada (arraste para
  ver "até o dia X" e o valor daquele dia), bruto, reembolsos, número de cobranças. Dólar (Stripe) à parte.
- MRR (assinaturas que renovam sozinhas; anual ÷ 12) e quanto está em risco (cobrança pendente ou "não renova").
- Assinantes Plus (recorrentes, avulsos via Pix, passes de 7 dias), novos e que saíram no período, churn de 30 dias.
- Conversão Plus ÷ MAU, pagantes ÷ MAU, ARPPU, taxa de reembolso (metas do growth-plan §4.4 ao lado).
- Gráfico do MRR (90 dias ou 12 meses), últimas compras (quem, o quê, quanto, presente), receita por produto e o funil
  da loja (desde o último reinício do servidor).

**Uso (admin).** 7, 30 ou 90 dias.
- Cadastros por dia e comparação; ativos hoje / 7 / 30 dias (abriram o app), aderência DAU ÷ MAU, quem mandou mensagem
  e quem passou 3+ min em voz.
- Ativação: cadastros com 3+ min de voz com outra pessoa no dia ou no seguinte.
- Tempo em chamada: minutos totais, pessoas, minutos por pessoa, sessão mediana, minutos por dia, últimas semanas.
- Mensagens por dia, espaços novos; retenção por semana de cadastro (S0–S7); grupos ativos na semana (estrela-guia);
  base de contas; motivos de desinstalação; a lista "O que ainda não é medido".

**Saúde.** API (versão, tempo no ar, memória), servidor de voz (sondado pela API a cada minuto), erros 5xx, webhooks
de pagamento e e-mails que falharam; agora (online, em voz, salas, cinema); qualidade das chamadas (entrada, ida e
volta, perda, reconexões, por versão); moderação (fila, urgentes, recursos, quarentena); "Conta pro Eco"; versões do
app em uso; tarefas agendadas.

**Contas.** Busca por nome, @, e-mail ou id; cadastros recentes. Detalhe: plano, estado, idade declarada, último acesso,
espaços e amigos, denúncias contra e feitas, pagamentos (admin), aparelhos conectados (sem IP), histórico de medidas e
"Aplicar uma medida" (advertir, suspender 1/3/7/30 dias, banir, retirar), sempre com confirmação. A ação é a
`POST /admin/users/:id/actions` que já existia: o servidor confere quem pode agir sobre quem.

**Alertas.** Feed por dia, ao vivo enquanto a aba está aberta. Tocar abre a conta.

**Ajustes.** Servidor e ambiente (QA aparece em amarelo), modo plantão, bloqueio com digital, notificação de teste,
quais avisos receber, sair.

## Avisos (push)

| Aviso | Onde nasce |
|---|---|
| Nova compra, Plus avulso, presente | `Billing.applyOrder` quando o pedido vira pago |
| Nova assinatura / renovação | `Billing.applySubscription` (primeira ativação / período avançou) |
| Renovação recusada, pagamento recusado | `applySubscription` (past_due), `applyOrder` (failed), `Billing.pay` (cartão recusado no app) |
| Reembolso | `applyOrder` (refunded), `applySubscription` (revoked) |
| Novo cadastro | `POST /auth/register` |
| Denúncia urgente, pico de denúncias | `POST /reports` (prioridade ≥ 50; 5+ na hora e 3× a média da semana) |
| Servidor de voz fora / de volta | sonda da API a cada minuto, 2 falhas seguidas |
| API com erros | 20+ respostas 5xx em 5 min (depois silêncio de 30 min) |
| API fora do ar | o próprio celular, a cada 15 min (o servidor não avisa da própria queda) |

Três caminhos, com o mesmo id de evento (um aviso aparece uma vez):
1. **FCM** (o principal): precisa do projeto Firebase do dono, abaixo.
2. **Modo plantão**: serviço em primeiro plano com `GET /admin/stream` aberto; funciona sem Firebase, com um aviso fixo
   silencioso e algum gasto de bateria.
3. **Ao vivo no app**: a aba Alertas e os números se atualizam sozinhos.

### Ligar o FCM

1. console.firebase.google.com → projeto (por exemplo `alga-admin`) → app Android com o pacote `app.alga.admin`.
2. Baixe o `google-services.json` para `apps/admin-android/app/` (fica fora do git) e recompile: o plugin entra sozinho.
3. Configurações do projeto → Contas de serviço → Gerar chave. No servidor, `FCM_SERVICE_ACCOUNT` = o JSON (ou base64)
   ou `FCM_SERVICE_ACCOUNT_FILE` = caminho. Sem isso a API funciona igual, só sem FCM.
4. No app: Ajustes → "Enviar notificação de teste".

## Sem senha ou sem papel de equipe (quebrar o vidro)

O e-mail de produção roda no driver `console` (o link de "esqueci a senha" não sai do servidor) e o banco não é
acessível de fora. Para isso existe `ADMIN_BOOTSTRAP_EMAIL` (`src/admin/bootstrap.ts`):

1. Defina a variável no serviço `api` do Railway com o e-mail da conta. Na subida, a conta vira admin (registrado no
   `staff_audit_log`) e o log do deploy mostra um código `XXXX-XXXX-XXXX`, de uso único, que vale 1 h.
2. **Remova a variável** logo depois (cada reinício com ela gera um código novo e invalida o anterior).
3. No app: "Tenho um código de acesso", e-mail ou usuário, o código e a senha nova que a pessoa escolhe.

Usado em 2026-11-16 para a conta do dono.

## Rodar em QA (pelo cabo)

1. Banco QA novo: `PGLITE_DIR=<pasta> npx tsx scripts/seed-admin-demo.ts <arquivo-de-senha>` (em `apps/server`): cria
   ~260 contas de teste (`@exemplo.test`), atividade, voz, mensagens, assinaturas e pedidos sandbox, e a conta `dono`
   (admin) com senha aleatória gravada no arquivo.
2. API nessa pasta numa porta livre (por exemplo 4350, `.claude/launch.json` → `admin-qa-api`), LiveKit opcional.
3. `adb reverse tcp:4340 tcp:4350`; no app, "QA local (USB)".
4. Build: `apps/admin-android/gradlew :app:installDebug` (JDK 17+ e Android SDK 36).

## O que o banco ainda não guarda

- Tempo de uso do app (só o dia em que a pessoa abriu).
- Taxas do Mercado Pago/Stripe: os valores são o que o cliente pagou.
- Cada cobrança de renovação como linha: é deduzida do ciclo (início + N intervalos até o fim do período atual). Uma
  renovação atrasada aparece na data do ciclo, não na do pagamento. Para precisão de centavo por dia, gravar as
  cobranças numa tabela própria no `Billing.apply`.
- Data exata do reembolso (usa a última atualização do pedido ou da assinatura).
- Origem do cadastro (convite, orgânico, campanha) e instalações do desktop.
- Quem desligou as métricas fica fora de DAU/WAU/MAU, coortes e ativação (de propósito).
- Voz por pessoa além de 35 dias; funil da loja zera a cada reinício.

## Antes de produção (decisão do dono)

- A migração é `0021_admin_app` e já está em produção (2026-11-16). A das playlists de música, que nasceu como `0021`
  num checkout sem esta, entrou como `0022_music_playlists` (gerada de novo por cima desta, mesmo SQL), com `when`
  maior: o migrador de produção só aplica o que tem `when` maior que o último aplicado.
- Deploy da API com `FCM_SERVICE_ACCOUNT` e o app compilado com o `google-services.json`.
- O APK de release usa a chave de debug (`shortcut` em `app/build.gradle.kts`): criar uma chave própria antes de
  distribuir para outra pessoa da equipe.
