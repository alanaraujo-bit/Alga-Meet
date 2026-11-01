# Deploy — API + Postgres no Railway, SFU em São Paulo (Vultr)

> **Nada aqui foi executado.** Este documento descreve o deploy; criar recursos custa dinheiro e precisa da aprovação
> do dono. Os passos que criam ou alteram algo pago estão marcados **[$]**. Base de custos: `docs/infra/cost-model.md`
> (§6 Railway, §7 fase 1 "Beta amigos").

Arquivos usados:

| Arquivo | O quê |
|---|---|
| `infra/server/Dockerfile` (+ `Dockerfile.dockerignore`) | Imagem da API: multi-stage, Node 24 slim, usuário `node`, healthcheck em `/api/v1/health`, migrações na subida |
| `infra/server/railway.ts` | IaC do Railway (API + Postgres + bucket). Substitui o `railway.json`, que o Railway descontinuou |
| `infra/livekit/livekit.prod.yaml` | SFU de produção (1 nó): TURN/TLS no 443, faixa UDP, IP externo, webhook para a API |
| `infra/livekit/caddy.prod.yaml` | TLS no 443 dividido por SNI: `livekit.` → 7880, `turn.` → 5349 |
| `infra/livekit/docker-compose.prod.yaml` | LiveKit `v1.13.11` + Caddy (layer4) com rede do host |

O que foi validado nesta máquina (sem Docker instalado): o bundle gerado só com os arquivos que o Dockerfile copia
subiu com `NODE_ENV` ausente (= produção), segredos reais gerados na hora e PostgreSQL 18 real; `/api/v1/health`,
cadastro, envio com anexo, download assinado e exclusão funcionaram. O `livekit.prod.yaml` foi carregado pelo
`livekit-server` 1.13.11 (com portas trocadas para não colidir com o SFU de dev). **Não validados:** `docker build`
de fato, o `railway.ts` (exige o SDK `railway` e a CLI) e o Caddy.

---

## 0. Checklist do dono (aprovar / pagar / decidir)

- [ ] **Domínio** (ex.: `algameet.com.br`, Registro.br ≈ R$ 40/ano) e quem administra o DNS. **[$]**
- [ ] **Railway**: plano Hobby (US$ 5/mês, inclui US$ 5 de uso) no beta; Pro (US$ 20) a partir de ~1k CCU. Estimativa
      do beta: ≈ US$ 9–21/mês (cost-model §6.3). **[$]**
- [ ] **Bucket do Railway** para anexos/avatares: US$ 0,015/GB-mês, egress do bucket grátis. **[$]**
  - Os downloads passam pela API, o que conta como egress do serviço (US$ 0,05/GB). Otimização futura: redirect para
    URL pré-assinada.
  - O Railway **não faz backup de buckets**. Decidir se aceita esse risco no beta ou replica para outro provedor (R2).
- [ ] **Backups do Postgres**: agendados no Railway (custo de armazenamento dos snapshots) e, opcionalmente, um dump
      diário fora do Railway (§7). **[$]**
- [ ] **VM Vultr São Paulo** para o SFU: 2–4 vCPU, ≈ US$ 40–80/mês [HIPÓTESE do cost-model] **+ banda**. **[$]**
  - O preço regional da banda em SP é ambíguo: US$ 0,01 ou 0,08/GB. Confirme no console antes de criar (risco 3 do
    cost-model).
- [ ] **Região do Railway**: não há América do Sul. Use **US East (Virginia)**, a mais próxima (~110 ms, aceitável para
      chat/REST; a voz vai direto ao SFU em SP).
- [ ] **Tamanho máximo de anexo** (`MAX_ATTACHMENT_BYTES`, padrão 25 MiB × 10 por mensagem).
  - O edge do Railway corta corpos que não terminam de subir em **5 minutos**. Com 7 Mbit/s de upload, isso dá cerca
    de 250 MB por envio.
- [ ] **Guarda de segredos**: um cofre de senhas para `LIVEKIT_API_SECRET`, `FILES_SECRET` e a senha do Postgres.
- [ ] **Aprovar o deploy** em si: o primeiro `railway config apply` e a criação da VM.

## 1. DNS

| Registro | Tipo | Valor | Para quê |
|---|---|---|---|
| `api.<domínio>` | CNAME | o alvo que o Railway mostra ao adicionar o domínio (`….up.railway.app`) | API REST + gateway WS |
| `livekit.<domínio>` | A | IP público da VM | sinalização `wss://` (Caddy → 7880) |
| `turn.<domínio>` | A | IP público da VM | TURN/TLS no 443 (Caddy → 5349) |

- Se o Railway pedir um registro TXT de verificação, crie-o também.
- Use TTL de 300 s durante a implantação. Depois de estável, suba para 3600 s.
- Sem proxy do Cloudflare (nuvem laranja) em `livekit.` e `turn.`: WebRTC e TURN precisam do IP real.

## 2. Segredos (gerar localmente, nunca commitar)

```sh
node -e "console.log('API' + require('crypto').randomBytes(6).toString('hex'))"   # LIVEKIT_API_KEY
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"   # LIVEKIT_API_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"   # FILES_SECRET
```

- O par `LIVEKIT_API_KEY` + `LIVEKIT_API_SECRET` é o mesmo na API (Railway) e no SFU (`.env` da VM).
- A API recusa, em produção, o par público de dev (`devkey`).
- Trocar o `FILES_SECRET` invalida todos os links de download emitidos (eles valem ~1 h de qualquer forma).

## 3. API + Postgres no Railway

### 3.1 Pelo painel

1. **[$]** Crie o projeto `alga-meet` na região US East.
2. **[$]** Adicione **PostgreSQL**. Confirme que o encoding é UTF8 (o padrão): a API se recusa a subir em banco que não
   seja UTF8.
3. **[$]** Postgres → **Backups**: ligue os agendamentos (veja §7).
4. **[$]** Adicione um **Bucket** chamado `uploads`, na mesma região. A região não muda depois. Na aba **Credentials**,
   veja se o bucket usa URL *virtual-hosted* (padrão) ou *path-style*.
5. **[$]** Crie um serviço a partir do repositório GitHub (branch `main`). Em **Settings**:
   - Root directory: `/` (raiz do monorepo: o Dockerfile copia `packages/shared` e `apps/server`).
   - Healthcheck path: `/api/v1/health`, timeout de 60 s.
   - Réplicas: **1**. Gateway, estado de voz e rate limits ficam em memória; sem Redis, mais de uma instância quebra
     presença e limites.
   - Restart policy: *On failure*.
6. **Variables** do serviço (use *sealed* nos segredos):

| Variável | Valor |
|---|---|
| `RAILWAY_DOCKERFILE_PATH` | `infra/server/Dockerfile` |
| `NODE_ENV` | `production` (já é o padrão da imagem) |
| `PORT` / `HOST` | `4000` / `0.0.0.0` |
| `TRUST_PROXY` | `1` (a API só é alcançável pelo edge do Railway; confira no passo 9) |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `PUBLIC_URL` | `https://api.<domínio>` |
| `CORS_ORIGINS` | `null,file://` (renderer empacotado do Electron) |
| `LIVEKIT_URL` | `https://livekit.<domínio>` (API → SFU) |
| `LIVEKIT_PUBLIC_URL` | `wss://livekit.<domínio>` (vai para o cliente) |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | §2 |
| `FILES_SECRET` | §2 |
| `STORAGE_DRIVER` | `s3` |
| `S3_ENDPOINT` / `S3_BUCKET` / `S3_REGION` | `${{uploads.ENDPOINT}}` / `${{uploads.BUCKET}}` / `${{uploads.REGION}}` |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | `${{uploads.ACCESS_KEY_ID}}` / `${{uploads.SECRET_ACCESS_KEY}}` |
| `S3_URL_STYLE` | `virtual` (ou `path`, se a aba Credentials disser) |
| `MAX_ATTACHMENT_BYTES` | `26214400` (25 MiB) |
| `LOG_LEVEL` | `info` |

7. **[$]** Em **Networking**, adicione o domínio `api.<domínio>` na porta 4000 e crie o CNAME (§1). O certificado
   costuma sair em até 1 h.
8. Faça o deploy e acompanhe os logs. Espere ver `database ready` e `Server listening`.
   - As migrações rodam antes de a API ouvir a porta.
   - A `0002` cria `attachments`/`storage_deletions` e apaga URLs externas de avatar/ícone (M9).
   - Teste: `curl https://api.<domínio>/api/v1/health` → `{"ok":true,"version":"0.1.0"}`.
9. **Confira o IP do cliente**: faça uma requisição do seu computador e compare o `remoteAddress` do log com
   `curl https://ifconfig.me`.
   - Se aparecer um IP interno (`10.x`, `100.64.x`), ajuste `TRUST_PROXY`.
   - Isso é necessário porque o rate limit por IP depende desse valor.

### 3.2 Pelo IaC (alternativa ao painel)

O `railway.json`/`railway.toml` (Config as Code) está **descontinuado**: serviços novos não podem usá-lo e os
arquivos existentes deixam de ser lidos em 2026-12-01. O substituto é o `infra/server/railway.ts`.

```sh
npm i -D railway                                      # SDK TypeScript do IaC (ainda não está no repositório)
railway login && railway link                         # escolha projeto/ambiente
railway config plan  --file infra/server/railway.ts   # só lê e mostra o plano
railway config apply --file infra/server/railway.ts   # [$] cria/altera recursos
```

- Antes de aplicar, troque `OWNER/alga-meet` e os domínios marcados `TODO(owner)`.
- Os segredos ficam como `preserve()`: defina-os no painel.

## 4. SFU (LiveKit) na Vultr São Paulo

1. **[$]** Crie a VM *Cloud Compute*: região **São Paulo**, Ubuntu 24.04 LTS x64, 2 vCPU / 4 GB (fase beta, ≤ 20 CCU),
   com sua chave SSH.
2. **[$]** Crie um **Firewall Group** na Vultr e associe à VM:

| Porta | Protocolo | Origem | Uso |
|---|---|---|---|
| 22 | TCP | só o seu IP | SSH |
| 80 | TCP | qualquer | desafio ACME (Let's Encrypt) do Caddy |
| 443 | TCP | qualquer | `wss://livekit.` (sinalização) e `turn.` (TURN/TLS, passa por firewall corporativo) |
| 7881 | TCP | qualquer | ICE sobre TCP |
| 3478 | UDP | qualquer | TURN/UDP |
| 50000–60000 | UDP | qualquer | mídia WebRTC |

   - Ficam **fechadas**: 7880 (sinalização sem TLS), 5349 (TURN depois do Caddy) e 30000–40000 (portas de relay do
     TURN, usadas só dentro da VM).

3. Na VM (como root):

```sh
apt update && apt install -y docker.io docker-compose-v2
# Buffers UDP maiores para muitas streams (recomendação do LiveKit).
printf 'net.core.rmem_max=5000000\nnet.core.wmem_max=5000000\n' > /etc/sysctl.d/90-livekit.conf && sysctl --system
mkdir -p /opt/livekit && cd /opt/livekit
```

4. Copie os três arquivos do repositório para a VM e preencha os placeholders:

```sh
scp infra/livekit/livekit.prod.yaml infra/livekit/caddy.prod.yaml infra/livekit/docker-compose.prod.yaml root@<IP>:/opt/livekit/
# na VM:
cd /opt/livekit
sed -i 's/<LIVEKIT_DOMAIN>/livekit.algameet.com.br/g; s/<TURN_DOMAIN>/turn.algameet.com.br/g' caddy.prod.yaml livekit.prod.yaml
sed -i 's/<API_DOMAIN>/api.algameet.com.br/; s/<API_KEY>/APIxxxxxxxxxxxx/' livekit.prod.yaml
printf 'LIVEKIT_API_KEY=APIxxxxxxxxxxxx\nLIVEKIT_API_SECRET=<segredo §2>\n' > .env && chmod 600 .env
grep -n '<' livekit.prod.yaml caddy.prod.yaml | grep -v '#'   # não deve sobrar placeholder fora de comentário
```

5. Suba os serviços:
   - `docker compose -f docker-compose.prod.yaml up -d`
   - `docker compose -f docker-compose.prod.yaml logs -f`: espere `starting LiveKit server` e o Caddy obtendo os
     certificados.
6. Teste:
   - `curl https://livekit.<domínio>` → `OK`.
   - No app desktop, entre num canal de voz. Nos logs do Railway deve aparecer
     `POST /api/v1/livekit/webhook` → 200, e o `VOICE_STATE_UPDATE` chega aos outros membros.
   - Numa rede que só libera 443, a chamada deve conectar via `turn.<domínio>`.

**Mais de um nó** (fase 2 do cost-model): todos os nós precisam do mesmo Redis (bloco `redis:` comentado no
`livekit.prod.yaml`). Assim a sala fica num nó só e as chamadas `RoomService` da API (mute, kick, mover) chegam a ele.
A API continua com um único `LIVEKIT_URL`, atrás de um balanceador.

## 5. Validação ponta a ponta

- [ ] `GET /api/v1/health` responde 200 pelo domínio.
- [ ] Cadastro, login e gateway (`wss://api.<domínio>/gateway`) recebem `READY`.
- [ ] Anexo: enviar imagem e PDF. A imagem aparece inline; o PDF baixa como arquivo. O objeto aparece no bucket
      (aba Files).
- [ ] Apagar a mensagem. Em até 1 min, o objeto some do bucket e a tabela `storage_deletions` fica vazia.
- [ ] Avatar: o upload troca o `avatarUrl` para `https://api.<domínio>/api/v1/avatars/…`.
- [ ] Voz: dois clientes se ouvem; *server mute* corta o microfone (smoke no `apps/server/README.md`).
- [ ] O `remoteAddress` nos logs é o IP real do cliente (§3.1, passo 9).

## 6. Rollback

- **API**: Railway → *Deployments* → deploy anterior → **Redeploy**.
  - As migrações são só para frente. A `0002` é aditiva e o código anterior funciona com ela; só a limpeza de URLs
    externas de avatar não volta.
  - Antes de qualquer migração destrutiva futura, faça um backup manual (§7).
- **Variáveis**: anote o valor antigo antes de mudar. Para reverter, volte o valor e faça redeploy.
- **SFU**: no `docker-compose.prod.yaml`, volte a tag da imagem e rode `docker compose up -d`. Guarde uma cópia
  `livekit.prod.yaml.bak` antes de editar.
  - Quem estiver em chamada cai e o cliente reconecta. Os tokens LiveKit valem 1 h.
- **Troca de VM**: crie a nova VM (§4) e aponte `livekit.`/`turn.` para o novo IP. Com TTL de 300 s, a troca leva
  minutos. A VM não guarda estado: config no git, certificados reemitidos.

## 7. Backups

- **Postgres (Railway)**: aba *Backups* do serviço Postgres → agendamentos.
  - Diário (mantido 6 dias), semanal (1 mês) e mensal (3 meses).
  - Restaurar cria um volume novo a partir do backup e o monta como mudança *staged*. Você revisa e faz **Deploy**;
    o volume antigo fica guardado.
  - Opcional **[$]**: PITR (restauração para um instante), que cria um bucket `Postgres-PITR` com o WAL.
- **Dump fora do Railway** (recomendado antes de dados reais). Crie um serviço *cron* no Railway (ex.:
  `0 6 * * *` UTC) com uma imagem que tenha `pg_dump` 18 e a AWS CLI, e o comando:

```sh
pg_dump "$DATABASE_URL" --format=custom --no-owner | aws s3 cp - "s3://$BUCKET/pg/$(date -u +%F).dump" --endpoint-url "$ENDPOINT"
```

  - O destino ideal é um bucket de **outro provedor** (ex.: R2). Use as variáveis `AWS_ACCESS_KEY_ID`,
    `AWS_SECRET_ACCESS_KEY` e `AWS_DEFAULT_REGION` desse provedor.
  - Teste a restauração todo mês: `pg_restore --no-owner -d <banco descartável> <arquivo>.dump`.
- **Bucket de uploads**: sem backup nativo no Railway. Se o bucket se perder, as mensagens continuam, mas os anexos
  dão 404.
- **Segredos**: no cofre (§2). **VM do SFU**: nada a salvar.

## 8. Custo mensal esperado (beta, ≤ 50 testers)

| Item | US$/mês | Fonte |
|---|---|---|
| Railway (API + Postgres, plano Hobby) | ≈ 9–21 | cost-model §6.3 |
| Bucket (poucos GB) + backups | < 1–2 | US$ 0,015/GB-mês |
| Egress da API (downloads de anexo) | ≈ 0,5–5 | US$ 0,05/GB, 10–100 GB |
| VM Vultr SP + banda | ≈ 40–80 + banda | cost-model §7 fase 1 (confirmar banda) |
| **Total** | **≈ 65–110** | |
