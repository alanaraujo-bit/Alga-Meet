# SFU no PC do dono (Windows, sem Docker) — LiveKit + Caddy + DuckDNS + UPnP

Kit para rodar o SFU de voz/tela do Alga Meet **direto no Windows** do PC principal do dono, no lugar do servidor
Ubuntu de casa (`infra/home-sfu/`, desligado em 2026-11-16). A API continua no Railway
(`https://api-staging-b3ea.up.railway.app`) e não muda: o nome DuckDNS é o mesmo, só a máquina atrás dele trocou.

| Arquivo | O quê |
|---|---|
| `install.ps1` | Instala em `C:\ProgramData\AlgaMeetSFU`: copia os programas, pede o `.env`, cria as regras de firewall e a tarefa de boot, passa as portas do roteador para este PC e roda o diagnóstico. **Rodado pelo dono** (pede admin) |
| `uninstall.ps1` | Para tudo e remove tarefa, regras e encaminhamentos. `-Purge` apaga também a pasta |
| `sfu.mjs` | Supervisor: mantém `livekit-server.exe` e `caddy.exe` de pé, atualiza o DuckDNS (5 min), renova as portas no roteador por UPnP (20 min), reinicia o LiveKit quando o IP público muda |
| `doctor.mjs` | Relatório de saúde, sem admin e sem segredos: `node infra/win-sfu/doctor.mjs` |
| `router.mjs` | Encaminhamentos do roteador: `status` (só lê), `takeover`, `release` |
| `livekit.win.yaml` / `caddy.win.json` | Modelos das configs; o supervisor gera as finais em `run\` a cada início |
| `fetch-caddy.mjs` | Baixa o `caddy.exe` com o módulo layer4 para `bin\` (fora do git) |
| `lib.mjs` | Funções comuns (`.env`, UPnP, STUN, rede) |

Esta máquina (medido em 2026-11-16): Windows 11 Pro 26H2, i5-14600K (20 threads), 32 GB, cabo de 1 Gbit/s, IP local
`192.168.18.199` por DHCP, roteador Huawei EchoLife em `192.168.18.1` com UPnP ligado e **sem CGNAT** (IP WAN do
roteador = IP público), plano de energia que nunca suspende na tomada.

## 1. O que muda em relação ao servidor Linux

- **Sem Docker.** O `livekit-server.exe` é o mesmo binário 1.13.11 que o `npm run dev` já usa
  (`scripts/livekit.mjs`, com SHA-256 conferido). O Caddy é o build oficial com layer4 (a imagem `livekit/caddyl4` do
  kit Linux é a mesma coisa empacotada).
- **Um processo no lugar de cinco contêineres.** DuckDNS, UPnP e a vigia do IP viraram laços dentro do `sfu.mjs`.
- **Sem coturn.** O relay da Sala de Cinema não tem versão para Windows. Enquanto ele não voltar (WSL2 é o caminho
  provável), o cinema só funciona entre pessoas que conseguem conexão direta; a API continua anunciando
  `CINEMA_TURN_URLS`, que não respondem. **Voz e tela não dependem dele.**
- **Portas internas diferentes.** A sinalização fica em `127.0.0.1:7870` (não 7880), porque este PC também é a
  máquina de desenvolvimento e o SFU de dev usa 7880. Pelo mesmo motivo o `tcp_port` do dev mudou de 7881 para 7885
  (`infra/livekit/livekit.dev.yaml`): o 7881 agora é da produção.
- **O LiveKit no Windows não tem "capacity management"** (ele avisa no log ao subir). Só importa com vários nós.

Portas que chegam de fora até este PC (as mesmas do kit Linux, menos as do coturn):

| Porta | Protocolo | Programa | Para quê |
|---|---|---|---|
| 80 | TCP | Caddy | Let's Encrypt (emitir/renovar o certificado) |
| 443 | TCP | Caddy | `wss://` (sinalização) e TURN/TLS, separados pelo nome (SNI) |
| 7881 | TCP | LiveKit | mídia por TCP (redes que bloqueiam UDP) |
| 7882 | UDP | LiveKit | **mídia de todas as chamadas** (uma porta só, "UDP mux") |
| 3478 | UDP | LiveKit | TURN/UDP |

7870 (sinalização) e 5349 (TURN atrás do Caddy) não têm regra de firewall nem encaminhamento: só o Caddy, neste mesmo
PC, fala com elas.

## 2. Antes de instalar

1. Na raiz do repositório, uma vez: `node infra/win-sfu/fetch-caddy.mjs` (51 MB em `infra/win-sfu/bin/`).
2. `infra/livekit/bin/livekit-server.exe` precisa existir (o `npm run dev` baixa na primeira vez).
3. Tenha em mãos:
   - **Railway** → serviço `api` → Variables: `LIVEKIT_API_KEY` e `LIVEKIT_API_SECRET`. É **o mesmo par da API**:
     tokens e webhooks são assinados com ele.
   - **<https://www.duckdns.org>**: o subdomínio (o mesmo para o qual a API aponta em `LIVEKIT_URL`) e o token.

## 3. Instalar

```sh
pwsh -File infra/win-sfu/install.ps1
```

O script pede admin (UAC) e continua numa janela nova. Ele:

1. cria `C:\ProgramData\AlgaMeetSFU` **já travada** (só admins alteram; a conta do serviço lê e executa; a sua sessão
   normal lê logs e estado) e copia para lá o kit, o `node.exe`, o `livekit-server.exe` e o `caddy.exe`;
2. pergunta os valores do `.env`. Os dois segredos não aparecem enquanto você cola e nunca vão para a tela. O arquivo
   fica legível só por admins e pela conta do serviço;
3. cria 3 regras de entrada no Firewall do Windows (grupo "Alga Meet SFU"), cada uma presa a um programa e às portas
   dele;
4. registra a tarefa agendada `AlgaMeetSFU`: sobe **no boot, antes de alguém entrar no Windows**, como
   `LocalService` (conta sem acesso aos seus arquivos), com reinício automático se cair;
5. olha o roteador. Se as portas ainda apontam para o servidor antigo, pergunta se pode passá-las para este PC. Ele só
   tenta com uma máquina que **não responde mais** na 443; se o SFU antigo estiver no ar, recusa. **Neste roteador
   (Huawei EchoLife) a tentativa não adianta**: ele só deixa apagar ou substituir um encaminhamento quem o criou
   (responde 714 e 718 aos outros). As entradas de um servidor desligado saem quando o prazo de 1 h vence, ao
   reiniciar o roteador, ou apagando à mão na página dele; o supervisor assume as portas sozinho em até 1 min depois;
6. inicia, espera 45 s e roda o `doctor.mjs`.

É idempotente: rode de novo depois de um `git pull` que mexa no kit. O `.env` existente é mantido.

Opções: `-SeedEnv <arquivo>` usa um `.env` já preparado em vez de perguntar; `-Yes` responde sim à pergunta das
portas. O token do DuckDNS é opcional: sem ele ninguém atualiza o DNS, o que só funciona enquanto o IP público da
casa não mudar (o `doctor.mjs` avisa).

Com o servidor antigo ainda ligado, `-OldServer usuario@ip` copia o `.env` dele por `scp` (você digita a senha do SSH)
e oferece parar o SFU de lá por SSH na hora da virada.

## 4. Conferir

```sh
node infra/win-sfu/doctor.mjs
```

Sem admin. Confere CGNAT, DNS, processos, portas, regras de firewall, encaminhamentos do roteador, certificados, o
LiveKit pelo Caddy, o NAT loopback e o `/api/v1/ready` da API (que precisa dizer `livekit: ok`).

| Linha marcada FALHA | Causa provável |
|---|---|
| "IP WAN … privado/CGNAT" | o provedor pôs a casa atrás de CGNAT: peça IP público (README do kit Linux, §1) |
| "A … != IP público" | subdomínio ou token do DuckDNS errado: `logs\sfu.log`, linhas `duckdns:` |
| "encaminhada para OUTRA máquina" | o servidor antigo ainda segura a porta: `install.ps1` de novo |
| "sem certificado válido" | 80/443 não chegam de fora: `logs\caddy.log`, linhas com `acme` |
| "LiveKit anuncia 'x'" | o STUN falhou; o supervisor tenta 3 vezes sozinho |
| "o PC suspende depois de…" | Configurações → Sistema → Energia → Suspender: Nunca |

Logs em `C:\ProgramData\AlgaMeetSFU\logs\` (`sfu.log`, `livekit.log`, `caddy.log`; 10 MB × 3). Estado atual, sem
segredos: `run\state.json`.

Reiniciar LiveKit e Caddy sem admin (derruba as chamadas em andamento):

```sh
node -e "require('fs').writeFileSync('C:/ProgramData/AlgaMeetSFU/control/restart.flag','')"
```

## 5. O que este PC precisa para ser servidor

- **Ligado.** Desligado, reiniciando ou suspenso, ninguém entra em chamada (`/api/v1/ready` → 503). Depois de um
  reinício do Windows Update o SFU volta sozinho, sem ninguém fazer login.
- **Não suspender.** Hoje o plano "Equilibrado" já nunca suspende na tomada; o `doctor.mjs` avisa se isso mudar.
- **IP local fixo (recomendado).** No roteador (`http://192.168.18.1`), em LAN → DHCP → reserva/IP estático, prenda o
  MAC deste PC a `192.168.18.199`. Sem a reserva o supervisor acompanha a troca de IP sozinho, mas a voz cai até ele
  refazer os encaminhamentos.
- **Upload.** Cada espectador recebe a própria cópia de cada tela: a tabela do `infra/home-sfu/README.md` §8 vale
  igual. Jogar, baixar ou transmitir neste PC disputa o mesmo upload e a mesma CPU das chamadas.
- **Não rodar outro programa nas portas 80, 443, 7881, 7882/udp ou 3478/udp** (um servidor web local na 80, por
  exemplo, impede o Caddy de renovar o certificado).

## 6. Verificar de fora de casa

De dentro de casa o nome DuckDNS aponta para o IP público, e funcionar depende do "NAT loopback" do roteador (o
`doctor.mjs` mostra). **O teste que vale é de fora**: um PC no roteador do celular (4G/5G).

```sh
curl https://<sub>.duckdns.org
curl https://api-staging-b3ea.up.railway.app/api/v1/ready
```

O primeiro deve imprimir `OK`; o segundo, `livekit: ok`. Depois, o teste real: duas pessoas em redes diferentes num
canal de voz, com tela compartilhada.

**O app do próprio dono, neste mesmo PC, também chega ao SFU pelo IP público** (ida e volta pelo roteador). Se o
roteador não fizer NAT loopback para a própria máquina, o dono não entra em chamada daqui mesmo com todo o resto
funcionando. O `doctor.mjs` testa exatamente esse caminho.

## 7. Segurança

- **O IP da casa fica visível** para todo participante e para quem consultar o nome DuckDNS, como já era com o
  servidor. A diferença: as portas agora chegam ao **PC principal**, não a uma máquina separada.
- Por isso os dois programas expostos rodam como `LocalService`: não leem a sua pasta de usuário, e a pasta do
  serviço só é alterável por admins. Uma falha no LiveKit ou no Caddy não dá acesso direto aos seus arquivos, mas
  continua sendo código exposto à internet rodando na sua máquina.
- **Só 5 portas**, cada regra de firewall presa a um executável. A API de administração do Caddy está desligada.
- **UPnP** precisa ficar ligado no roteador. Para dispensá-lo: encaminhe as 5 portas à mão para `192.168.18.199` e
  ponha `UPNP=0` no `.env` (como admin), depois `install.ps1` de novo.
- **Atualizações.** O Windows Update cuida do sistema. LiveKit e Caddy não se atualizam sozinhos: troque a versão em
  `scripts/livekit.mjs` / rode `fetch-caddy.mjs` de novo, e depois `install.ps1`.

Desinstalar: `pwsh -File infra/win-sfu/uninstall.ps1` (mantém `.env` e certificados; `-Purge` apaga tudo).
**Voltar para o servidor Linux**: desinstale aqui, ligue o servidor e rode `cd ~/alga-sfu && bash install.sh` nele.

## 8. Testar o kit sem tocar em nada (desenvolvimento)

```sh
pwsh -File infra/win-sfu/install.ps1 -DryInstall <pasta>
```

Sem admin, sem firewall, sem tarefa: só copia para `<pasta>` e valida o `.env` que estiver lá. Com `DRY_RUN=1` no
`.env`, o supervisor (`<pasta>\bin\node.exe sfu.mjs`) não chama o DuckDNS, não toca no roteador e usa um certificado de
teste do próprio Caddy. `node doctor.mjs --dir <pasta>` confere essa instalação.

**Rodar de verdade sem admin (provisório).** A mesma cópia, com um `.env` real (sem `DRY_RUN`), serve chamadas se o
Firewall do Windows já liberar aqueles dois executáveis **naquele caminho exato** (quem clica "Permitir" no aviso do
Windows cria essa liberação, para qualquer porta). Usado em 2026-11-16, com o dono longe do PC (resultado em
`docs/STATE.md`). Roda na conta do usuário, não sobrevive a reinício nem a logoff, e a pasta temporária pode ser apagada: é ponte até
o `install.ps1`, que encerra essa cópia e remove as liberações dela.

Verificado assim em 2026-11-16: LiveKit nativo acha o IP público por STUN e só oferece a interface de rede certa;
`/rtc/validate` e o upgrade de WebSocket passam pelo Caddy; queda do LiveKit, `restart.flag` e morte do supervisor se
recuperam. **Não dá para verificar sem a virada:** regras de firewall, tarefa como `LocalService`, certificados Let's
Encrypt, encaminhamento UPnP para este PC, NAT loopback e mídia de verdade.
