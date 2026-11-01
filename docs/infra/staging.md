# Staging (Railway) — estado real

> Criado em 2026-11-01 com aprovação do dono ("API + Postgres de teste no Railway, ~US$ 9–21/mês").

| Item | Valor |
|---|---|
| Projeto Railway | `alga-meet` (`a58d9c2f-d4be-4c68-835c-9a8c53202f04`), ambiente `staging` |
| API | `https://api-staging-b3ea.up.railway.app` (serviço `api`, imagem `infra/server/Dockerfile`, 1 réplica) |
| Banco | Postgres (template Railway), referenciado por `${{Postgres.DATABASE_URL}}` |
| Arquivos | bucket `uploads` (região `iad`), variáveis por referência `${{uploads.*}}` |
| Segredos | `FILES_SECRET`, `E2EE_DS_KEY`, `LIVEKIT_API_KEY/SECRET`, `METRICS_TOKEN` gerados localmente e gravados direto no Railway (nunca impressos nem commitados) |

## O que funciona (verificado de fora em 2026-11-01)
- `GET /api/v1/health` → `{ ok: true }`; `GET /api/v1/ready` → banco `ok`.
- Cadastro (idade + termos), login, `GET /users/@me`, criar espaço, enviar mensagem, gateway WebSocket (`READY`) — 3 rodadas de smoke, contas de smoke excluídas em seguida (carência de 7 dias).

## O que **não** funciona ainda (e por quê)
| Limitação | Motivo | Como destravar |
|---|---|---|
| Voz e transmissão | Não há SFU com UDP (`LIVEKIT_URL` aponta para `sfu.pending.invalid`; `/ready` mostra `livekit: fail`) | VM em São Paulo ou LiveKit Cloud (ver `deploy.md`) — **decisão/custo do dono** |
| E-mail real | `EMAIL_DRIVER=console` + `ALGA_ALLOW_CONSOLE_EMAIL=1` (e-mails ficam em arquivo no container) | Conta Resend + domínio verificado |
| Contas novas não verificam e-mail → não criam convites | Consequência do item acima | Flag de staging `ALGA_AUTO_VERIFY_EMAIL=1` (fail-closed, só com e-mail console) — em implementação |
| Pagamentos | `BILLING_PROVIDER=none` | Credenciais de teste do Mercado Pago |
| Domínio próprio | usando `*.up.railway.app` | Comprar domínio e apontar DNS |

## Como publicar uma nova versão
```bash
railway up --service api --environment staging --detach
```
(da raiz do repo; `.railwayignore` evita subir docs, app desktop e screenshots). Migrações rodam no boot.

## App desktop apontando para staging
Build com `MAIN_VITE_API_URL=https://api-staging-b3ea.up.railway.app npm run dist -w apps/desktop`, ou em dev: `ALGA_API_URL=https://api-staging-b3ea.up.railway.app`.
