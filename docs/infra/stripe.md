# Stripe (pagamentos, conta pessoa física)

Adaptador: `apps/server/src/billing/stripe.ts` (Checkout Sessions, sem SDK). Testado só contra API simulada
(`apps/server/test/stripe.test.ts`) até existirem chaves de teste reais.

## 1. Conta

1. Criar conta em https://dashboard.stripe.com/register, país **Brasil**, tipo **Pessoa física** (CNPJ opcional).
   O CPF e o tipo não mudam depois de verificados: virar empresa = conta nova.
2. Conta bancária em reais no mesmo CPF.
3. Pix: só por convite no Stripe Brasil. Sem ele, o checkout oferece cartão; presente "só Pix" (`pixOnly`) falha.

## 2. Chave e webhook (modo de teste primeiro)

Dashboard > Developers > API keys: copiar a **Secret key** `sk_test_…` (não colar em chat nem no git).

O webhook **precisa** ser criado com a versão de API `2024-06-20` (a que o adaptador fixa). Pelo Dashboard a
versão é a padrão da conta, por isso criar pela API:

```bash
curl https://api.stripe.com/v1/webhook_endpoints \
  -u "$STRIPE_SECRET_KEY:" \
  -d url="https://api-staging-b3ea.up.railway.app/api/v1/billing/webhooks/stripe" \
  -d api_version=2024-06-20 \
  -d "enabled_events[]=checkout.session.completed" \
  -d "enabled_events[]=checkout.session.async_payment_succeeded" \
  -d "enabled_events[]=checkout.session.async_payment_failed" \
  -d "enabled_events[]=checkout.session.expired" \
  -d "enabled_events[]=customer.subscription.created" \
  -d "enabled_events[]=customer.subscription.updated" \
  -d "enabled_events[]=customer.subscription.deleted" \
  -d "enabled_events[]=invoice.paid" \
  -d "enabled_events[]=invoice.payment_failed" \
  -d "enabled_events[]=charge.refunded" \
  -d "enabled_events[]=charge.dispute.created"
```

A resposta traz `secret` (`whsec_…`): é o `STRIPE_WEBHOOK_SECRET`.

## 3. Variáveis no servidor (Railway)

| Variável | Valor |
|---|---|
| `BILLING_PROVIDER` | `stripe` |
| `STRIPE_SECRET_KEY` | `sk_test_…` (staging) / `sk_live_…` (produção) |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` do passo 2 |
| `BILLING_RETURN_URL` | página https de retorno (ex.: `https://algameet.com.br/billing/return`) |

## 4. Teste

Assinar o Plus no app → página do Stripe → cartão `4242 4242 4242 4242`, data futura, qualquer CVC.
Conferir no Dashboard > Developers > Webhooks que as entregas voltaram 200 e no app que o plano virou Plus.
Para produção: repetir o passo 2 com `sk_live_…` (outro `whsec_…`).
