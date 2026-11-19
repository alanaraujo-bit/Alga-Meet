# algameet.com — domínio, serviços e DNS

Comprado pelo dono na Hostinger em 2026-11-19. DNS na Hostinger (nameservers `dns-parking.com`); os registros saem
pela API da Hostinger com o token que o dono guarda em `%USERPROFILE%\.alga\hostinger.token` (nunca no repositório,
nunca impresso): `node scripts/dns-algameet.mjs` (mostra e valida) e `--apply` (grava; salva a zona antiga antes).

| Nome | Serviço (Railway, projeto `alga-meet`, ambiente `staging` = produção) | Registro |
|---|---|---|
| `algameet.com` | `site` (`infra/site`: Astro estático + Caddy, repassa `/api`) | ALIAS → `zzdby9jt.up.railway.app` + TXT `_railway-verify` |
| `www.algameet.com` | o Railway recusou o 2º domínio no `site` (2×, "Failed to create custom domain"); o Caddy do site já redireciona `www` → raiz quando chegar | pendente |
| `app.algameet.com` | `pwa` (`infra/web`: o renderer do desktop para o navegador + Caddy, repassa `/api` e `/gateway`) | CNAME → `labn6y17.up.railway.app` + TXT `_railway-verify.app` |
| `api.algameet.com` | `api` (o endereço antigo `api-staging-b3ea.up.railway.app` continua: os desktops instalados apontam para ele) | CNAME → `fvrbql08.up.railway.app` + TXT `_railway-verify.api` |
| `voz.algameet.com` | SFU no PC do dono (substitui o DuckDNS); IP dinâmico atualizado pela API da Hostinger | A → IP público do PC (falta) |

**Por que o `site` e o `pwa` repassam a API:** o navegador fala com a mesma origem, então nada muda em `CORS_ORIGINS`
na API e ela não precisa de redeploy. Consequência conhecida: a API vê o IP do serviço (`site`/`pwa`) como origem
das requisições sem login (limite de tentativas de login por IP), porque `TRUST_PROXY` conta só o salto do Railway.

**Fontes:** os serviços `site` e `pwa` constroem a branch `feat/pwa` do GitHub a cada push (padrões de arquivos em
cada serviço). O `api` segue preso a um commit (`docs/infra/staging.md`).

**Ainda depende do dono:** o token da Hostinger (para criar os registros), o `voz` (atualizador de IP no kit
`infra/win-sfu`, instalação no PC dele), e o aval para o deploy da API com o Web Push (migração `0023_push`,
variáveis `VAPID_*`) e para trocar `EMAIL_LINK_URL` para `https://app.algameet.com/auth`.
