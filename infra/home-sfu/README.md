# SFU em casa (custo zero) — LiveKit + Caddy + DuckDNS + UPnP

Kit para rodar o SFU de voz/tela do Alga Meet num servidor Ubuntu em casa, sem pagar nada, apontado pela API de
staging (`https://api-staging-b3ea.up.railway.app`). Ninguém além do dono roda nada no servidor: este diretório só
traz os arquivos e o passo a passo.

**Nada aqui exige sudo**, exceto um passo opcional (§5). O ufw não é alterado: o Docker publica as portas com as suas
próprias regras (DNAT), que valem antes do ufw. Os outros serviços do servidor (Minecraft, alga-connect etc.) não são
tocados.

| Arquivo | O quê |
|---|---|
| `docker-compose.yaml` | LiveKit `v1.13.11` + Caddy (`livekit/caddyl4:v2.11.3`, TLS) em rede bridge com portas publicadas; DuckDNS e UPnP com rede do host |
| `livekit.home.yaml` | Config do LiveKit: **uma porta UDP** (7882) para toda a mídia, TCP 7881, TURN (UDP 3478 + TLS no 443), webhook para a API |
| `caddy.home.yaml` | 443 dividido por nome: `<sub>.duckdns.org` → sinalização, `turn.<sub>.duckdns.org` → TURN/TLS |
| `install.sh` | Confere a máquina e o `.env`, gera `livekit.yaml`/`caddy.yaml`, sobe tudo, instala o cron do `ipwatch.sh` (sem sudo) |
| `doctor.sh` | Relatório de saúde: IPs, CGNAT, DNS, portas, UPnP, certificados, LiveKit, TURN, hairpin |
| `ipwatch.sh` | Cron a cada 5 min: se o IP público mudou, recria o LiveKit (ele só descobre o IP ao subir) |
| `duckdns.sh` / `upnp.sh` | Rodam nos contêineres `duckdns` (atualiza o DNS) e `upnp` (pede ao roteador para abrir as portas) |
| `root-setup.sh` | **Opcional, com sudo**: buffers UDP, atualizações automáticas, Docker (se faltar) |
| `railway-env.mjs` | Leva a chave/segredo do LiveKit do Railway para o `.env` do servidor sem mostrar o segredo |

Servidor deste projeto (levantado em 2026-11-01): Ubuntu 24.04.5, Xeon E5-2650 v2 (16 threads), 15 GB de RAM,
64 GB livres, Docker 29.9 + Compose v5.6, IP local `192.168.1.110`, roteador Huawei com UPnP ligado, IPv4 público
`203.0.113.10` (sem CGNAT), IPv6 público, upload de 220 Mbit/s.

Portas que precisam chegar de fora até o servidor (o serviço `upnp` abre sozinho; tabela manual em §2):

| Porta | Protocolo | Para quê |
|---|---|---|
| 80 | TCP | Let's Encrypt (emitir/renovar o certificado) |
| 443 | TCP | `wss://` (sinalização) e TURN/TLS (redes que só liberam HTTPS) |
| 7881 | TCP | mídia por TCP (redes que bloqueiam UDP) |
| 7882 | UDP | **mídia de todas as chamadas** (uma porta só, "UDP mux") |
| 3478 | UDP | TURN/UDP |
| 3479 | TCP e UDP | coturn da Sala de Cinema (§11) |
| 49160-49200 | UDP | relay do coturn (§11) |

7880 (sinalização sem TLS) e 5349 (TURN depois do Caddy) **não** são publicadas: só o Caddy fala com elas.

---

## 1. Conferir se há CGNAT (sem isso, nada funciona)

Com CGNAT o provedor divide um IPv4 entre vários clientes, e ninguém de fora consegue chegar à sua casa.

1. No servidor: `curl -4 ifconfig.me` → IP público (como a internet vê a casa).
2. Na página do roteador (`http://192.168.1.1`), em **Status → WAN** (ou "Informações da WAN"), veja o **IP WAN**.
3. Compare:
   - **iguais** → sem CGNAT. Siga para §2. (É o caso deste servidor: os dois são `203.0.113.10`.)
   - **diferentes**, ou o IP WAN começa com `100.64`–`100.127`, `10.`, `172.16`–`172.31` ou `192.168.` → CGNAT ou
     NAT duplo.
   - O `./doctor.sh` faz essa comparação sozinho (pergunta o IP WAN ao roteador por UPnP).
   - Ver `10.x.x.x` no traceroute **depois** do roteador (ex.: `10.94.207.1`) é normal na rede do provedor e não
     indica CGNAT. O que decide é o IP WAN do roteador.

**Com CGNAT**, ligue para o provedor e peça: *"Preciso de IP público IPv4 na minha conexão. Podem desativar o CGNAT?"*
- Na maioria dos provedores de fibra do Brasil isso é gratuito (IP público **dinâmico**). "IP fixo" costuma ser pago
  e não é necessário: o DuckDNS acompanha as trocas de IP.
- Se o modem estiver em modo roteador e houver outro roteador atrás (NAT duplo), peça o modem em **bridge** ou
  encaminhe as portas nos dois.

**Só IPv6 (se o CGNAT não sair) não serve para este kit**:
- A API no Railway precisa chamar o SFU (moderação, `/ready`) e os webhooks precisam sair dele. Sem IPv4 de entrada, a
  API não alcança o SFU (não verificado se o Railway tem saída IPv6).
- Muitas redes de clientes (empresas, escolas, parte das operadoras) ainda não têm IPv6. Esses usuários não entrariam.
- Na rede bridge do Docker, este kit só anuncia mídia em IPv4.
- Nesse caso, use a VM gratuita da Oracle (§10).

## 2. Roteador: IP fixo na rede local e portas

**Reserva de DHCP** (o servidor sempre recebe `192.168.1.110`; sem isso, um dia ele troca de IP e as portas
apontam para o lugar errado):
1. No servidor: `ip -br link` → anote o MAC da placa de rede ligada (ex.: `eno1  UP  aa:bb:cc:dd:ee:ff`).
2. Na página do roteador, procure **LAN → Servidor DHCP → Reserva de IP / IP estático / "Static DHCP"**.
3. Crie a reserva: MAC do servidor → `192.168.1.110`. Salve.

**Portas.** Por padrão o serviço `upnp` pede ao roteador para abrir as portas (inclusive as do coturn, §11) e renova o pedido a cada 20 min;
quando a pilha para (`docker compose down`), ele as fecha. Confira com `./doctor.sh` (seção "Roteador (UPnP)").

Se o roteador recusar (comum para portas abaixo de 1024, como 80 e 443), encaminhe à mão e ponha `UPNP=0` no `.env`.
Na Huawei: **Encaminhamento / Port Mapping / NAT → Port Mapping**, uma regra por linha:

| Nome | Protocolo | Porta externa | IP interno | Porta interna |
|---|---|---|---|---|
| alga-acme | TCP | 80 | 192.168.1.110 | 80 |
| alga-https | TCP | 443 | 192.168.1.110 | 443 |
| alga-ice-tcp | TCP | 7881 | 192.168.1.110 | 7881 |
| alga-media | UDP | 7882 | 192.168.1.110 | 7882 |
| alga-turn | UDP | 3478 | 192.168.1.110 | 3478 |
| alga-cinema-turn | TCP e UDP | 3479 | 192.168.1.110 | 3479 |
| alga-cinema-relay | UDP | 49160-49200 | 192.168.1.110 | 49160-49200 |

- Não encaminhe 22 (SSH). Para acessar de fora, use Tailscale (já instalado no PC de desenvolvimento).
- Se o provedor bloquear a porta 80 de entrada, o Caddy tenta o desafio TLS-ALPN pelo 443. Se o certificado não sair
  mesmo assim, o log mostra: `docker compose logs caddy | grep -i acme`.

## 3. DuckDNS (nome grátis)

1. Entre em <https://www.duckdns.org> com Google ou GitHub.
2. Em **sub domain**, crie um nome (ex.: `algameet`) → `algameet.duckdns.org`. **Add domain**.
3. Copie o **token** do topo da página. Ele é segredo: quem o tiver pode apontar o seu nome para outro lugar.
- `turn.algameet.duckdns.org` funciona sozinho: o DuckDNS responde qualquer nome abaixo do seu com o mesmo IP
  (conferido em 2026-11-01).
- O contêiner `duckdns` atualiza o registro A a cada 5 min. O AAAA (IPv6) fica desligado (`DUCKDNS_IPV6=0`): a mídia
  é só IPv4 neste kit e, com o firewall IPv6 do roteador fechado (padrão), um AAAA só atrasa a conexão.

## 4. Criar o `.env` no servidor (segredos nunca na tela)

**No PC com o Railway CLI logado**, na raiz do repositório (Git Bash, PowerShell ou cmd):

```sh
railway variables -s api -e staging --json | node infra/home-sfu/railway-env.mjs | ssh alanaraujo@192.168.1.110 "umask 077; mkdir -p ~/alga-sfu; cat > ~/alga-sfu/.env"
```

- O `railway-env.mjs` grava `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` (**o mesmo par da API**: tokens e webhooks
  são assinados com ele) e `ALGA_API_URL`.
- Ele se recusa a escrever na tela e recusa o par de dev (`devkey`).
- Rodar de novo recria o arquivo do zero; refaça então os passos abaixo.

**No servidor** (`ssh alanaraujo@192.168.1.110`), acrescente o DuckDNS. O `read -s` não mostra nem guarda no
histórico o que você digita:

```sh
cd ~/alga-sfu
read -rp 'Subdomínio DuckDNS (só o nome, ex.: algameet): ' s && echo "DUCKDNS_SUBDOMAIN=$s" >> .env
read -rsp 'Token DuckDNS: ' t && echo "DUCKDNS_TOKEN=$t" >> .env; unset t; echo
chmod 600 .env && cut -d= -f1 .env      # confere só os NOMES das variáveis
```

Variáveis opcionais (acrescente com `echo 'NOME=valor' >> .env`):

| Variável | Padrão | Uso |
|---|---|---|
| `UPNP` | `1` | `0` = portas encaminhadas à mão (§2) |
| `UPNP_LAN_IP` | IP local do servidor | força o IP interno dos encaminhamentos |
| `DUCKDNS_IPV6` | `0` | `1` = também publica AAAA (só depois de liberar entrada IPv6 no roteador) |
| `UPNP_URL` | vazio | URL de descrição do IGD do roteador (ex. `http://192.168.1.1:12345/12345gatedesc.xml`). Necessário quando o ufw bloqueia as respostas SSDP e o `upnp` diz "No IGD UPnP Device found" — caso deste servidor. Descubra no PC com um M-SEARCH SSDP |
| `NODE_IP` | vazio | IP público fixo para o LiveKit, se o STUN falhar (§7, "LiveKit anuncia") |

`ALGA_UID`/`ALGA_GID` são escritos pelo `install.sh` (os contêineres rodam como o seu usuário).

## 5. Instalar e subir

**Copiar o kit** (do PC, na raiz do repositório; repita para atualizar, o `.env` não é tocado):

```sh
scp -r infra/home-sfu alanaraujo@192.168.1.110:alga-sfu-kit
ssh alanaraujo@192.168.1.110 "mkdir -p ~/alga-sfu && cp ~/alga-sfu-kit/* ~/alga-sfu/ && rm -r ~/alga-sfu-kit"
```

**No servidor:**

```sh
cd ~/alga-sfu && bash install.sh
./doctor.sh
```

O `install.sh`:
1. confere Ubuntu, CPU/RAM/disco, Docker e o `.env` (sem mostrar segredos);
2. confere se as portas estão livres;
3. gera `livekit.yaml` e `caddy.yaml`;
4. baixa as imagens e sobe os 5 contêineres (inclui o `coturn`, §11);
5. instala o cron do `ipwatch.sh`.

É idempotente: rode de novo depois de editar o `.env` ou copiar uma versão nova do kit.

**Opcional, uma vez, pelo dono** (pede a senha do sudo): `sudo bash root-setup.sh`. Ele faz três coisas:
- **Buffers UDP de 5 MB.** Medido neste servidor: `net.core.rmem_max`/`wmem_max = 212992` (208 KiB, o padrão do
  kernel).
  - Um quadro-chave de tela em 1080p60/1440p60 chega como uma rajada de centenas de pacotes por espectador. Com
    208 KiB o kernel descarta parte dela antes de o LiveKit ler.
  - Resultado: perda, pedido de novo quadro-chave e a tela trava por instantes.
  - Voz não precisa disto. Tela em alta resolução para vários espectadores, sim.
- **Atualizações automáticas de segurança** (`unattended-upgrades`). O reinício continua manual; o `doctor.sh` avisa
  quando o sistema pedir.
- **Instalação do Docker** pelo repositório oficial, só se ele não existir (aqui já existe).

## 6. Apontar a API (Railway) para o SFU de casa

Só depois de o `./doctor.sh` mostrar os certificados válidos e `https://<sub>.duckdns.org/ -> OK`. No PC:

```sh
railway variable set -s api -e staging LIVEKIT_URL=https://<sub>.duckdns.org LIVEKIT_PUBLIC_URL=wss://<sub>.duckdns.org
```

- `LIVEKIT_URL` é o caminho API → SFU (HTTPS). `LIVEKIT_PUBLIC_URL` vai para o app (WebSocket seguro).
- Definir variáveis já dispara um novo deploy. Se não disparar: `railway redeploy -s api -e staging`.
- Confira: `curl https://api-staging-b3ea.up.railway.app/api/v1/ready` deve mostrar `livekit` ok (antes estava
  `fail`, apontando para `sfu.pending.invalid`).
- O par `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET` não muda: o `.env` foi copiado dele.

## 7. Verificar de fora de casa

Dentro de casa, o nome DuckDNS aponta para o IP público. Funcionar de dentro depende de o roteador fazer "NAT
loopback" (o `doctor.sh` mostra). Por isso **o teste que vale é de fora**: ligue o PC no **roteador do celular**
(4G/5G, Wi-Fi desligado da casa).

```sh
curl https://<sub>.duckdns.org                      # deve imprimir: OK
curl https://api-staging-b3ea.up.railway.app/api/v1/ready
```

Teste de carga com o CLI do LiveKit (`winget install LiveKit.LiveKitCLI`). O `railway run` injeta a chave e o segredo
como variáveis de ambiente, sem passar pela tela nem pelo histórico:

```sh
railway run -s api -e staging -- lk load-test --url wss://<sub>.duckdns.org --room teste-casa --audio-publishers 5 --subscribers 5 --duration 1m
railway run -s api -e staging -- lk load-test --url wss://<sub>.duckdns.org --room teste-casa --video-publishers 1 --subscribers 4 --duration 1m
```

- Espere `0` em erros/falhas de conexão e bitrate estável por assinante.
- O segundo teste baixa ~4 vídeos por 1 min no celular: cerca de 50–100 MB do plano de dados.
- Por fim, o teste real: dois PCs (um em casa, outro no celular) no app de staging, entrem num canal de voz e
  compartilhem a tela.

Se algo falhar, rode `./doctor.sh` no servidor e leia a linha marcada **FALHA**:

| Sintoma | Causa provável |
|---|---|
| "IP WAN … privado/CGNAT" | §1 |
| "A … != IP público" | token/subdomínio errado no `.env`: `docker compose logs duckdns` |
| "sem certificado" | porta 80/443 não chega de fora (§2) |
| "LiveKit anuncia 'x'" | o STUN falhou. Rode `./ipwatch.sh`. Se persistir, fixe o IP (abaixo) |
| conecta mas sem áudio/vídeo | 7882/udp não chega. Redes que bloqueiam UDP usam 7881/tcp |

**Fixar o IP (se o STUN falhar):** em `livekit.home.yaml` troque `use_external_ip: true` por `use_external_ip: false`.
Ponha `NODE_IP=<IP público>` no `.env` e rode `bash install.sh`. O `node_ip` é **ignorado** enquanto
`use_external_ip` for `true` (testado no 1.13.11). O `ipwatch.sh` mantém o `NODE_IP` atualizado quando o IP muda.

**TURN e NAT loopback:** o TURN embutido repassa a mídia de dentro do servidor para `<IP público>:7882`. Isso só
funciona se o roteador fizer NAT loopback. Sem ele, o TURN não ajuda, mas UDP 7882 e TCP 7881 continuam atendendo
quase todas as redes. O `doctor.sh` informa qual é o caso.

## 8. Upload da casa: quanto aguenta

O upload da casa é a **saída** do SFU: cada espectador recebe a própria cópia de cada stream. Valores com o teto do
app (`packages/shared/src/billing.ts`: 1080p60 = 8 Mbit/s, 1440p60 = 12 Mbit/s, 4K30 = 16 Mbit/s; voz Opus 64 kbit/s)
mais ~5 % de cabeçalhos/retransmissão.

| Cenário | Saída do SFU (upload da casa) |
|---|---|
| Voz, 5 pessoas (cada uma ouve 4) | ≈ 1–2 Mbit/s (pior caso, todos falando) |
| 1 tela 1080p60 → 4 espectadores | ≈ 34 Mbit/s |
| 1 tela 1080p60 → 8 espectadores | ≈ 68 Mbit/s |
| 1 tela 1440p60 → 4 espectadores | ≈ 50 Mbit/s |
| 1 tela 1440p60 → 8 espectadores | ≈ 101 Mbit/s |
| 2 telas 1440p60 → 8 espectadores cada | ≈ 202 Mbit/s |

| Upload do plano | Até onde vai (usando no máximo ~70 %) |
|---|---|
| 220 Mbit/s (esta casa) | 1440p60 para 8 com folga; 2 telas 1440p60 para 8 já satura |
| ~150 Mbit/s (ex.: fibra 300/150) | 1440p60 para 8 |
| ~50 Mbit/s | 1080p60 para 4 |
| ≤ 20 Mbit/s (cabo/planos de entrada) | só voz e tela 720p para poucos |

- Na fibra, o upload costuma ser metade do download (ex.: 300/150, 500/250 Mbit/s); no cabo, bem menos. Confira o
  seu num medidor (speedtest) ou no contrato.
- Deixe ~30 % livres para a voz e para o resto da casa (o Minecraft também usa este upload).
- Tela parada gasta muito menos que o teto; jogo e vídeo chegam perto dele.

**Quando o upload satura:**
1. A fila do roteador cresce e a latência sobe para todos, inclusive na voz.
2. O LiveKit mede a banda de cada espectador e o passa para uma camada menor do simulcast: 720p30 (1,7 Mbit/s) ou
   360p (0,4 Mbit/s). O áudio tem prioridade.
3. Se nem isso couber, o vídeo daquele espectador pausa até sobrar banda.
4. Como todos dividem o mesmo upload, todos caem juntos. Por isso a folga de 30 %.

## 9. Segurança

- **O IP da casa fica visível** para todo participante de chamada (o app conecta direto nele) e para quem consultar o
  nome DuckDNS.
  - Ele revela provedor e cidade aproximada e permite um ataque de negação de serviço contra a sua internet.
  - Mantenha o beta só com convidados.
  - Se for atacado, reiniciar o modem costuma trocar o IP; o DuckDNS e o `ipwatch.sh` acompanham sozinhos.
  - A VM (§10) esconde o IP da casa.
- **Isole o servidor** se der: VLAN própria ou rede de convidados, longe dos PCs e do NAS da casa. Um contêiner
  comprometido na mesma rede local alcança os outros aparelhos.
- **Só estas portas abertas**: 80, 443, 7881/tcp, 7882, 3478/udp e as do coturn (3479, 49160-49200/udp).
  - 7880 e 5349 ficam só na rede interna do Docker.
  - Não abra o SSH (22) para a internet.
- **UPnP** é cômodo, mas deixa qualquer aparelho da casa abrir portas. Depois de estável, você pode criar as regras à
  mão (§2), pôr `UPNP=0` e desligar o UPnP no roteador.
- **Contêineres endurecidos**: rodam como o seu usuário (não root), com sistema de arquivos só leitura, sem
  capabilities e logs rotacionados (10 MB × 3).
- **Atualizações**: o `root-setup.sh` liga as de segurança do Ubuntu. As imagens são fixas (`v1.13.11`, `v2.11.3`
  etc.): para atualizar, troque a tag no `docker-compose.yaml` e rode `bash install.sh`.
- **Segredos**: o `.env` (modo 600) fica só no servidor. Quem está no grupo `docker` equivale a root na máquina:
  proteja essa conta.
- **Monitoramento**:
  - `./doctor.sh` sob demanda.
  - O `/api/v1/ready` da API já falha (503) se o LiveKit cair.
  - Um monitor externo grátis (ex.: UptimeRobot) em `https://<sub>.duckdns.org` procurando o texto `OK` avisa por
    e-mail.

## 10. Alternativa de custo zero se o CGNAT não sair: Oracle Cloud Always Free (São Paulo)

Conferido em 2026-11-01 na documentação da Oracle
([Always Free Resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)):

- **Ampere A1 (Arm)**: 1.500 OCPU-horas e 9.000 GB-horas por mês, "equivalente a 2 OCPUs e 12 GB de memória". É
  **menos** que os 4 OCPU/24 GB citados em guias antigos. Basta para um SFU de beta.
- **10 TB/mês de saída grátis.** Uma tela 1080p60 para 8 pessoas (~68 Mbit/s) gasta ~30 GB por hora, ou ~330 horas
  por mês dentro da franquia.
- **A VM precisa estar na região "home"**, escolhida no cadastro e que **não muda depois**. Escolha
  **Brazil East (São Paulo), `sa-saopaulo-1`**.
- **Armazenamento**: 200 GB no total (disco de boot de 47–50 GB, a página se contradiz).
- **Instância ociosa pode ser recuperada** se, em 7 dias, CPU (p95), rede e memória ficarem abaixo de 20 %. Um SFU
  parado a semana toda pode cair nessa regra.
  - Guias de terceiros dizem que converter a conta para Pay As You Go (continua grátis dentro dos limites) evita isso.
    A Oracle não confirma isso na página acima.
- **Falta de capacidade** ("out of host capacity") é comum para A1: há relato de 3 dias sem conseguir criar em
  `sa-saopaulo-1` ([Oracle Community](https://community.oracle.com/customerconnect/discussions/tagged/arm)). Tente
  outro horário ou um formato menor (1 OCPU/6 GB).

Na VM, use este kit com `UPNP=0`. Libere as mesmas 5 portas (mais 3479 TCP/UDP e 49160-49200/UDP se usar o relay da Sala de Cinema, §11) em dois lugares:
- na **Security List** da VCN;
- no firewall da própria VM (as imagens Ubuntu da Oracle vêm com regras iptables que bloqueiam quase tudo).

Também serve o kit de VM em `infra/livekit/` (rede do host, faixa UDP 50000–60000). As imagens têm versão arm64.

## 11. Relay da Sala de Cinema (coturn)

A Sala de Cinema transfere o filme por P2P. Quem não alcança ninguém direto usa um TURN, e o do LiveKit (3478/udp) só
aceita credenciais do LiveKit. Por isso o kit tem um **coturn** (serviço `coturn`, `coturn/coturn:4.7.0`, rede do host):

| O quê | Valor |
|---|---|
| Porta de escuta | **3479** TCP e UDP |
| Portas de relay | **49160-49200/udp** (41 portas) |
| Teto | **30 Mbps somando todos os relays** (`bps-capacity=3750000` bytes/s) e **10 Mbps por sessão** (`max-bps=1250000` bytes/s). O coturn conta em **bytes** por segundo. Cotas: 4 alocações por credencial, 12 no total |
| Credenciais | TURN REST: usuário `<expiraUnix>:<idDoUsuario>`, senha `base64(HMAC-SHA1(segredo, usuário))`, emitidas pela API |
| Segredo | `CINEMA_TURN_SECRET`, o mesmo na API (Railway) e no `.env` do servidor. Nunca no git |
| Realm / IP | `<sub>.duckdns.org`; o IP público é lido desse nome ao subir, e o `ipwatch.sh` recria o coturn se mudar |

- `denied-peer-ip` recusa toda faixa privada (10/8, 172.16/12, 192.168/16, 100.64/10, 198.18/15, 192.0.0/24, loopback,
  link-local) e **todo IPv6** (o relay é só IPv4). Também recusa o **IP público da própria casa**: o entrypoint lê o IP
  do nome DuckDNS ao subir e o passa como `--denied-peer-ip`, então, se o roteador fizer NAT loopback, o relay não
  alcança os serviços da casa por ele. Nada disso leva IP real para o git. O relay não vira porta para a rede da casa. `no-cli`, `no-multicast-peers` e `no-tcp-relay` também estão ligados.
- O coturn não mascara IPs nos logs; eles rodam em 10 MB x 3 e não vão a lugar nenhum.
- **Opcional**: o `coturn` é um perfil do compose (`cinema`). Sem `CINEMA_TURN_SECRET` no `.env` o `install.sh` só avisa e
  não o sobe; o SFU não depende dele.
- Com o segredo, o serviço `upnp` abre 48 mapeamentos (5 do SFU + 3479 TCP/UDP + 41 de relay, UPnP não tem faixa); sem ele, 5. Se o roteador recusar
  tantos, encaminhe à mão as portas acima e ponha `UPNP=0` (§2).
- Mesma limitação do TURN do LiveKit: sem NAT loopback no roteador, só o teste de fora de casa vale (§7).

### Subir (só depois do OK explícito do dono; nenhum passo exige sudo)

No PC, na raiz do repositório, com o Railway CLI logado. O segredo nasce e viaja por pipe, sem aparecer na tela:

```sh
# 1. gera o segredo direto para o Railway e liga a feature no staging (3 variáveis; o Railway redeploya a API)
node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))" | railway variable set -s api -e staging CINEMA_TURN_SECRET --stdin
railway variable set -s api -e staging CINEMA=true CINEMA_TURN_URLS="turn:<sub>.duckdns.org:3479?transport=udp,turn:<sub>.duckdns.org:3479?transport=tcp"
# 2. acrescenta SÓ a linha CINEMA_TURN_SECRET ao .env existente do servidor (nunca reescreve o arquivo)
railway variables -s api -e staging --json | node infra/home-sfu/railway-env.mjs --cinema-secret-only | ssh <usuario>@<ip-do-servidor> "umask 077; { echo; cat; } >> ~/alga-sfu/.env"
```

- Confira só os nomes: `ssh <usuario>@<ip-do-servidor> "cut -d= -f1 ~/alga-sfu/.env"` deve listar `CINEMA_TURN_SECRET`.

No servidor (ou por `ssh`), copie o kit (§5) e rode:

```sh
cd ~/alga-sfu && bash install.sh && ./doctor.sh
```

O `doctor.sh` deve mostrar `coturn ... 3479/udp responde`, `coturn anuncia o IP público` e 48 encaminhamentos UPnP. Sem o segredo no `.env`, o `install.sh` avisa e o coturn simplesmente não sobe.
Teste o relay com um `turnutils_uclient` e uma credencial gerada como a API gera (`docker run --rm --network host
coturn/coturn:4.7.0 turnutils_uclient -u <expiraUnix>:teste -w <credencial> -p 3479 -y <sub>.duckdns.org`).

O que precisar de sudo vira passo do dono. Hoje não há nenhum além do `root-setup.sh` opcional (§5).
