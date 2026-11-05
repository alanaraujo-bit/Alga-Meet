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
| Verificação de e-mail real | Sem provedor; **`ALGA_AUTO_VERIFY_EMAIL=1` ligado** (d036bcb): contas novas nascem verificadas — verificado de fora: convite 201. Manter cadastro restrito a convidados enquanto estiver ligado | Conta Resend → desligar a flag |
| Pagamentos | `BILLING_PROVIDER=none` | Chaves de teste do Stripe (`docs/infra/stripe.md`) |
| Domínio próprio | usando `*.up.railway.app` | Comprar domínio e apontar DNS |

## Conta do dono (tudo liberado)
`ALGA_OWNER_EMAILS` (variável do serviço `api`, e-mails separados por vírgula; **nunca no git**, o repositório é público): contas com esse e-mail **verificado** têm Plus e todos os cosméticos para sempre (`source: grant`), aplicado pela varredura de billing (até 1 min após subir ou após verificar o e-mail). O log `billing: founder accounts` mostra quantas foram encontradas. Vale igual em produção: defina a mesma variável lá.

## Como publicar uma nova versão
```bash
railway up --service api --environment staging --detach
```
(da raiz do repo; `.railwayignore` evita subir docs, app desktop e screenshots). Migrações rodam no boot.

## Instalador de staging
`apps/desktop/release/AlgaMeet-Setup-0.1.0-staging.exe` (110 MB, SHA-256 `39f81da0…b28c`), build de `031bbf6` numa worktree limpa com a URL de staging embutida. Verificado: instalação silenciosa, app empacotado abre a tela de login apontando para `api-staging-b3ea.up.railway.app` (`scripts/check-installed.mjs`), desinstalação limpa (pasta e protocolo `algameet://` removidos). **Sem assinatura de código** → SmartScreen avisa "editor desconhecido".

## App desktop apontando para staging
Build com `MAIN_VITE_API_URL=https://api-staging-b3ea.up.railway.app npm run dist -w apps/desktop`, ou em dev: `ALGA_API_URL=https://api-staging-b3ea.up.railway.app`.
