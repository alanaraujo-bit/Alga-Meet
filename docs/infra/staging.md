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
| Domínio próprio | usando `*.up.railway.app` | Comprar domínio e apontar DNS |

## Pagamentos (Mercado Pago, ligado em 2026-11-08)
- `BILLING_PROVIDER=mercadopago` com credenciais de **produção** (dinheiro real) do app MP `AlgaMeet` (`5423594413650676`), conta do dono.
- Webhook (painel MP, produção e teste): `https://api-staging-b3ea.up.railway.app/api/v1/billing/webhooks/mercadopago`, tópicos `payment`, `subscription_preapproval`, `subscription_authorized_payment`.
- `BILLING_RETURN_URL` = `/api/v1/billing/return` da própria API (página estática; o estado só vem do webhook).
- `MP_ACCESS_TOKEN`/`MP_WEBHOOK_SECRET` gravados pelo dono no Railway (nunca no git).
- **Checkout no app** (2026-11-08): `MP_PUBLIC_KEY` (chave pública, não é segredo) liga `provider.inApp`. Modal do desktop (`features/billing/Pay.tsx`) com cartão (Secure Fields do MP dentro de `GET /billing/card-frame`, iframe isolado da ponte do app) e Pix (QR + copia e cola); `POST /billing/pay` aplica na hora a resposta do MP, o webhook confirma depois. Verificado de fora: SDK e os 3 campos seguros carregam com a chave de produção. Precisa de versão nova do desktop para os usuários verem.
- Verificado de fora: catálogo `provider.id=mercadopago, sandbox=false`; retorno 200; webhook sem `x-signature` → 401. **Falta:** primeira compra real (assinatura + cosmético) para fechar `docs/business/monetization.md` §8.

## Sem liberação grátis
Não existe mais conta com tudo liberado (`ALGA_OWNER_EMAILS` foi removido do código e do Railway em 2026-11-08, a pedido do dono): Plus e cosméticos só por pagamento ou presente aceito, inclusive para o dono. Linhas `source: grant` antigas são revogadas no primeiro sweep após subir.

## Como publicar uma nova versão
Dois caminhos; nos dois as migrações rodam no boot.

1. **Pelo GitHub, preso a um commit** (como foi feito em 2026-11-13, numa máquina sem o CLI do Railway): o serviço
   `api` tem como fonte o repositório `alanaraujo-bit/Alga-Meet`, **fixado num commit** (`b10ece5`). Fixado quer dizer
   que um push na `main` **não** publica nada sozinho. Para publicar outro commit: no painel do Railway, serviço `api`
   › Settings › Source, troque o commit (ou, pelo conector MCP do Railway, `connect-service-source` com `commitSha`).
   O commit precisa estar no GitHub. Para voltar ao modo antigo, basta desconectar a fonte no mesmo lugar.
2. **Pelo CLI**, da raiz do repo (`.railwayignore` evita subir docs, app desktop e screenshots):
   ```bash
   railway up --service api --environment staging --detach
   ```

Voltar atrás: a implantação anterior fica na lista do serviço com "Rollback" (as migrações são só aditivas).

## Alga Worlds (ligado em 2026-11-13)
- `WORLDS=true` no serviço `api`. Sem essa variável o Worlds fica desligado em produção: as rotas respondem 404 e o
  app não mostra o botão Mundo.
- O pacote 3D (33,5 MiB, `apps/server/assets/worlds/v1`) vai dentro da imagem e sai por
  `GET /api/v1/worlds/assets/*`. Verificado de fora: `manifest.json` 200 com 90 arquivos, arquivo fora do manifesto
  404, `GET /worlds/rooms/@me` sem token 401.
- Os produtos da coleção Ateliê entram no catálogo com os preços de `docs/business/monetization.md` §3.1 e são
  cobrados de verdade pelo Mercado Pago. O app 0.1.17 ignora esses produtos (não os conhece).

## Instalador de staging
`apps/desktop/release/AlgaMeet-Setup-0.1.0-staging.exe` (110 MB, SHA-256 `39f81da0…b28c`), build de `031bbf6` numa worktree limpa com a URL de staging embutida. Verificado: instalação silenciosa, app empacotado abre a tela de login apontando para `api-staging-b3ea.up.railway.app` (`scripts/check-installed.mjs`), desinstalação limpa (pasta e protocolo `algameet://` removidos). **Sem assinatura de código** → SmartScreen avisa "editor desconhecido".

## App desktop apontando para staging
Build com `MAIN_VITE_API_URL=https://api-staging-b3ea.up.railway.app npm run dist -w apps/desktop`, ou em dev: `ALGA_API_URL=https://api-staging-b3ea.up.railway.app`.
