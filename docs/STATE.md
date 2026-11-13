# Alga Meet — Estado do projeto

## 2026-11-13 — Alga Worlds: a chamada dentro de uma sala em 3D (branch `feat/worlds`, NÃO mesclada, NÃO publicada)
- **Estado:** commit `15c3f65` na branch local `feat/worlds` (a partir de `afe95e1`), sem push e sem deploy. Decisão do
  dono: revisar, mesclar, publicar a API e lançar um desktop novo. Como funciona, medições e o que falta: `docs/worlds.md`.
- **O que é:** o botão Mundo no dock leva a chamada para um lugar em 3D sem tocar na voz: o **lounge** (sala pronta do
  grupo) ou a **sala pessoal** de quem abre (persistente, com acesso por chamada / só amigos / só o dono). Cada pessoa é
  um manequim de ateliê montável; anda, senta, gesticula, reage, e a tela da sala mostra a transmissão de tela de
  alguém da chamada. **Ateliê** (Ctrl K, dock, HUD): montar a sala, vestir o manequim, loja da coleção Ateliê.
- **Como:** sessão por canal em memória no gateway (`world_*`/`WORLD_*`, posições a cada 100 ms só para quem está
  dentro); motor próprio em three.js num chunk à parte (~1,0 MB, só carrega ao entrar); pacote de assets **fora do
  instalador** (33,5 MiB, CC0, baixado sob demanda com SHA-256 e guardado no OPFS; `tools/worlds-assets` regenera).
  Nada no motor de mídia mudou: a tela da sala usa `media.watch`/`attachScreen`.
- **Servidor:** `src/worlds.ts`, `routes/worlds.ts`, **migração 0020** (`users.world_avatar`, `world_rooms`), 26 produtos
  da coleção Ateliê no catálogo (v3; `kind: 'cosmetic'`, `world: true`), exportação de dados com a sala e o manequim.
  Em produção nasce desligado: `WORLDS=true`.
- **Testes:** shared 76, servidor 361 (mundos também em PostgreSQL real), desktop 908, typecheck de tudo, **e2e no app
  real com duas instâncias 12/12** (`apps/desktop/scripts/worlds-e2e.mjs`, capturas em `docs/screenshots/worlds/`).
- **Não verificado:** `npm run dist`, app instalado contra o staging, GPU/VRAM/fps com um jogo aberto, chamada E2EE com
  o mundo aberto. **Limite assumido:** o avatar é um manequim (CC0), não um humano realista com roupa modelada.
- **Mudanças fora da pasta do Worlds** (para a revisão): CSP ganhou `blob:` em `connect-src` (o carregador de modelos lê
  blobs criados pela própria página); `CallStage`, `ControlsDock`, `QuickSwitcher`, `Shell`, `session.ts` e `icons.tsx`
  ganharam os pontos de entrada; `billing.ts` tira do manequim a parte paga que a conta perdeu; `wishlist.ts` recusa
  itens não presenteáveis; `.gitattributes` marca `.glb/.webp/.hdr` como binários; `three` nas devDependencies.

## 2026-11-09 noite (3) — Música na call ("bot de música", YouTube) — desktop 0.1.17
- **No ar (2026-11-10):** API no Railway (deploy `9732ae75`) e https://github.com/alanaraujo-bit/Alga-Meet/releases/tag/v0.1.17
  (build de `9354da1`, não assinado; testado empacotado: o player do YouTube toca com o Referer do app). Falta a nota
  da 0.1.17 no estúdio de Novidades.
- **O que é:** colar um link do YouTube na call e todo mundo ouve junto, no mesmo ponto: fila, pausar, pular, mudar o
  ponto, parar, volume só seu, "parar de ouvir" só para você. Botão de nota na barra da call e Ctrl K. Como funciona:
  `docs/music.md`.
- **Como (e por quê):** nenhum áudio passa pelo servidor. Cada app toca no player embutido do YouTube
  (`youtube-nocookie.com`), sincronizado pelo relógio da sala. Tirar o áudio do YouTube num servidor (como os bots do
  Discord Groovy e Rythm, fechados pelo Google em 2021) viola os termos deles.
- **Servidor:** `src/music.ts`, em memória por canal de voz, some quando a call esvazia; título pelo oEmbed (que também
  recusa vídeo com incorporação desligada); READY ganha `music: true`.
- **Desktop:** `features/music/`; o processo principal manda `Referer` no documento do player (`main/music-logic.ts`):
  sem ele o YouTube recusa (erro 153), e com IP também (150), então API local por IP vira `localhost`.
- **Testes:** shared 65, servidor 330 (música também em PostgreSQL real), desktop 872, e2e no app real com duas
  instâncias e vídeos de verdade 8/8, diferença entre os dois players de 0,0–0,1 s (`apps/desktop/scripts/music-e2e.mjs`,
  capturas em `docs/screenshots/music/`).

## 2026-11-09 noite (2) — Sala de cinema: tela cheia, chat ao vivo e cadeado — desktop 0.1.17
- **Tela cheia:** menus de legenda/áudio e ⋯, dicas, avisos ("Ana pulou para…") e diálogos (denunciar) não apareciam em
  tela cheia: iam para o `body`, fora do elemento em tela cheia. Agora seguem a tela cheia (`ui/portal.ts`).
- **Chat ao vivo:** `cinema_chat` → `CINEMA_CHAT` para as poltronas, sem guardar; uma linha de até 200 caracteres,
  4 seguidas e depois 1 a cada 2 s, respeitando bloqueios nos dois sentidos. No app: canto inferior esquerdo, some em
  8 s, Enter abre o campo.
- **Cadeado:** segurar Espaço (ou o selo) 3 s trava/destrava; Espaço tocado pausa ao soltar a tecla.
- **Testes:** shared 60, servidor 325 (cinema também em PostgreSQL real), desktop 851, e2e no app real com duas
  instâncias 9/9 (`apps/desktop/scripts/cinema-room-e2e.mjs`, capturas em `docs/screenshots/cinema-room/`).
- **Para publicar:** API primeiro (sem migração; um app novo contra a API antiga não recebe resposta ao chat), depois
  o desktop 0.1.17.

## 2026-11-09 noite — Feedback no app ("Conta pro Eco") — desktop 0.1.16
- **No ar (2026-11-09):** `main` em `08cf0b6`; API no Railway com a migração 0019 (`/ready` ok, `/feedback` respondendo).
  **Desktop 0.1.16:** https://github.com/alanaraujo-bit/Alga-Meet/releases/tag/v0.1.16 (build de `08cf0b6`, não
  assinado; testado empacotado: abre, aponta para a API, as três pontes novas respondem). Quem está na 0.1.15 recebe
  sozinho. **Falta escrever a nota da 0.1.16 no estúdio de Novidades;** sem ela ninguém vê boas-vindas desta versão.
- **O que é:** um cartão pequeno e não modal sobre o painel do usuário para contar bug, travamento, ideia ou elogio.
  O Eco e uma luz na cor do tipo reagem ao que a pessoa faz. Vai junto, à vista: versão, sistema, onde ela estava
  (sem nomes) e, em bug/travamento, o fim do log (dá para tirar); print opcional (colar, arrastar ou "Tirar print do
  app"). Abre por Ctrl K, pelo menu do usuário e por Configurações › Avançado; nada no rail. Depois de um travamento,
  o app oferece uma vez "Quer me contar o que aconteceu?". Como funciona: `docs/feedback.md`.
- **Servidor:** tabela `feedback` (**migração 0019**, com gatilho que põe o print na fila de remoção), `POST /feedback`
  (multipart, 10 por hora por pessoa) e `GET /feedback/@me`. Entra na exportação de dados e some com a conta.
  **Sem tela nem rota para a equipe ler:** fica para o painel administrativo.
- **Desktop:** `features/feedback/`; pontes novas `app.recentLog`, `app.captureWindow`, `app.takeCrash`
  (`main/feedback.ts`); `crash-marker.json` em userData.
- **Testes:** shared 56, servidor 325 (+ feedback em PostgreSQL real), desktop 833, typecheck de tudo, e2e no app real
  14/14 (`apps/desktop/scripts/feedback-e2e.mjs`, capturas em `docs/screenshots/feedback/`).
- A Política de Privacidade ganhou a linha do feedback sem versão nova em `LEGAL_VERSIONS`.

## 2026-11-08 noite — Novidades (patch notes e "O que há de novo") — desktop 0.1.15
- **O que é:** boas-vindas depois de atualizar ("O Alga Meet ficou ainda melhor", com o Eco), Central de Novidades
  permanente (ícone de brilho na barra da esquerda; Configurações › Avançado), pílula "Atualização pronta" na barra de
  título (sem reiniciar no meio de chamada), 👍/👎 por item com totais para a equipe, e o estúdio da equipe (staff
  `admin`) para escrever, traduzir, pré-visualizar e publicar. Como publicar: `docs/releases.md`.
- **Servidor:** tabelas `release_notes`/`release_reactions` (migrações 0017–0018; 0018 grava o histórico 0.1.3–0.1.14 e
  a 0.1.15 já publicada), rotas `/releases*` e `/admin/releases*`.
- **No ar (2026-11-09):** API no Railway (migrações 0017–0018 aplicadas, `/releases` respondendo) e release
  https://github.com/alanaraujo-bit/Alga-Meet/releases/tag/v0.1.15 (build de `7c699d2`, não assinado).
- **Desktop 0.1.15:** `features/whatsnew/`; `updates.status()` no bridge; a versão vem do `downloading`.
- **Testes:** shared 51, servidor 314 (+ releases em PostgreSQL real), desktop 789, typecheck de tudo, e2e no app real
  21/21 (`apps/desktop/scripts/whatsnew-e2e.mjs`, capturas em `docs/screenshots/whatsnew/`).

## 2026-11-05 noite (2) — Sala de Cinema — motor (Plano 1) (branch `feat/sala-de-cinema`, NÃO mesclada)
- **Checkout no app (desktop 0.1.13–0.1.14, 2026-11-08):** campos do cartão com cara do app (nome e CPF nativos, frame transparente com Inter) na 0.1.14; pagar Plus/itens/presentes/Casa sem sair do app: cartão (campos seguros do Mercado Pago num iframe isolado, `GET /billing/card-frame`) e Pix (QR + copia e cola); `POST /billing/pay`; liberação grátis do dono removida. Ver `docs/infra/staging.md` §Pagamentos.
- **Séries no Cinema (desktop 0.1.11, 2026-11-07):** abrir um episódio monta a série (pastas de temporada, `S01E02`/`1x02`/`E02`/`Ep 02`/`01 - Título` em `Temporada N`); a ficha mostra a lista por temporada, ✓ nos assistidos (`cinema-series.json`, por hash, sem caminho) e "Continuar a série"; o próximo episódio nos créditos atravessa temporadas. `main/cinema/names.ts` `seriesOf`, `room/SeriesPanel.tsx`.
- **Sala de Cinema (desktop 0.1.9, 2026-11-06):** assistir filme baixado junto na call, P2P, mesmo frame (p95 22–25 ms em rede local; 0 % parado com 1 % de perda), visual dos mockups aprovados. Servidor com `CINEMA=true` e relay coturn no home-server (`CINEMA_TURN_*`). Detalhes: `docs/benchmarks/cinema-engine.md`, specs/plans `2026-11-05-sala-de-cinema-*`.
- **O que é:** o motor da Sala de Cinema (spec `docs/superpowers/specs/2026-11-05-sala-de-cinema-design.md`): ffmpeg
  LGPL no main (sonda, peças fMP4 sem recompressão de vídeo, áudio convertido quando precisa), enxame P2P próprio
  (data channels DTLS, super-seed, hash por peça, cache em OPFS), relógio pelo gateway, player MSE com sincronia por
  `requestVideoFrameCallback`, som do filme com ducking, legendas SRT/ASS, e um palco de desenvolvimento (`CinemaDev`).
  O cinema fica ligado no servidor fora de produção.
- **Números do §8** (`docs/benchmarks/cinema-engine.md`, lab `apps/desktop/scripts/cinema-lab.mjs` com 2–4 janelas reais):
  - **Passa na rede local:** primeiro frame 2,8 s (Task 15; **3,0–5,8 s depois da Task 16**, ver abaixo); sincronia p95
    25–33 ms (Task 15, só um par) e **22,1–27,3 ms em todos os pares** (Task 16), nunca > 125 ms; pausa no mesmo frame
    em 8/8 (Task 15) e 6/6 pelo último quadro rVFC (Task 16); entrar no meio: Task 15 1,2–3,8 s em **6 de 7** (a sétima
    9,85 s, corrigida); **re-medido na Task 16: 9 de 10 em 1,1–3,2 s, 1 em 7,5 s**; play agendado em ±1 frame; troca de
    áudio sem mexer no vídeo; quem projeta envia 0,7–1,1× o filme.
  - **Reprova:** instalador **+48,6 MiB** (meta ≤ 40 MB; o ffmpeg LGPL genérico comprime para 39,7 MiB sozinho; **o dono
    aceitou o crescimento do instalador, até ~150 MB — R34**);
    na Task 15, a **rede emulada** (RTT 40 ms, upload de quem projeta 12 Mbps, 4 pessoas): ~2,5 Mbps por conexão com 1 %
    de perda; sala parada 343 s de 560 (1 %) e 118 s de 300 (0,1 %). **Resolvido na Task 16** (abaixo). Troca de áudio
    com perda continua reprovando (salto de 191,5–975,5 ms). RAM: o cinema soma 354–703 MiB à chamada (passa).
  - **Task 16 — vazão sob perda** (mesmo lab, build `4cde089`): 3 conexões (RTCPeerConnection) por par, cada uma com
    canal de controle ordenado + canal de dados sem ordem, pedaços divididos entre elas; ritmo do pré-carregamento com
    corte pelo RTT; pré-carga adaptativa (30 s / 60 s numa rede ruim); super-seed também para pedidos urgentes (a menos
    de 10 s da posição da sala, quem projeta repete). **1 %: zero esperas** (antes 343 s), primeiro frame **9,1 s**
    (23,1 s), cada amigo recebeu o filme inteiro, quem projeta mandou 1,04× as peças. **0,1 %: zero esperas** (antes
    118 s), primeiro frame **12,1 s**. Rede local: tudo passa, mas o primeiro frame foi de 2,8 para 3,0–5,8 s (uma peça
    atrasa quando a 2ª conexão abre). Fila do upload de quem projeta (o que a voz dele esperaria): 1 % p95 61 ms; 0,1 %
    p50 77 / p95 249 ms (**a voz não fica protegida num upload saturado**). Sinalização: 35 frames de malha por cliente
    em 60 s com 8 poltronas (simulado), 119 no pior minuto de quem projeta no lab (cota 300). Uma rodada por perfil, e a
    variação entre rodadas é grande (durante o ajuste, 0,1 % deu de 0 a 98 s parada).
  - **Não medido aqui:** eco com caixa de som, internet real entre casas, relay, sessão de 2 h.
- **Corrigido na Task 15:** quem projeta não perde o arquivo num `cinema_hello` lento; aviso quando a E2EE falha com
  alguém sentado; índice do áudio padrão antes dos extras (primeiro frame 6,7 → 2,8 s); quem entra no meio não pausa a
  sala nos primeiros 10 s; legenda ASS quebrada no app construído (worker do JASSUB não empacotado) + trava no
  `check-package.mjs`; escolha da rota do som do filme no painel S.
- **Falta:**
  - **Plano 2 — experiência** (ficha bonita, foyer, luzes, timeline social, miniplayer, atalhos, acessibilidade, nova versão do desktop).
  - **Teste com o dono** (filme dele 1080p e 4K, amigo em outra casa, eco com caixa de som nas duas rotas):
    `docs/qa/2026-11-05-cinema-teste-com-o-dono.md`.
  - **Relay (coturn no `home-server`) não implantado:** este PC fica numa sub-rede da casa que não alcança o servidor de casa
    (192.168.1.110).
  - Teto do envio de quem projeta (voz num upload saturado), primeiro frame na rede local com as conexões extras, troca
    de áudio com perda, repetir os perfis de rede 3×; um ffmpeg LGPL mínimo se o instalador voltar a importar.

## 2026-11-05 noite — Loja (pacote C) e transmissão de jogos terminadas (release v0.1.8)
- **Origem:** o trabalho que estava parado sem commit no checkout principal desde 01/11 (agentes interrompidos). Foi salvo
  como commit (`f02c590`) e terminado na branch `feat/store-media`. Cópia de segurança do WIP em `refs/backup/wip-2026-11-05c`.
- **Pacote C:**
  - Loja Hora Azul, provador (perfil e chamada), conjuntos, lista de desejos.
  - Presentes com revelação, Plus v2 (guarda-roupa, selo, passes), Casa do espaço.
  - **Correções:** a amostra de aura do Plus passava o registro de cobrança como usuário e quebrava com o Eco; tirado o `<Kbd>Esc</Kbd>` fixo das Configurações.
  - O E2E (`scripts/cosmetics-store.mjs`) está todo verde, já ajustado ao lobby da 0.1.6.
  - **Pagamentos seguem desligados no staging:** aviso na tela e compra desativada.
- **Mídia:**
  - A captura sobe a prioridade dos processos do app e pede 20 % de folga.
  - Jogo pesado de CPU: 5–9 fps → 58–60 fps, com o jogo intacto.
  - O cartão "Você está ao vivo" mostra o motivo quando a transmissão fica abaixo da meta (`diagnoseSend`, com teste).
  - Relatório em `docs/benchmarks/game-capture.md`.
  - **Limite conhecido:** a janela de um jogo em modo janela com tamanho ímpar cai no OpenH264. Próximo passo: arredondar a captura.
- **Verificado:** shared 17, desktop 348, servidor 256; E2E fundamentos 22/22; E2E da loja verde; medições novas no `game-capture.json` (`after-cpu16`, `after-idle`).
- **Fora do git de propósito (repositório público):**
  - `docs/research/discord/` e `docs/research/mascots/`: análise de concorrente;
  - `docs/brand/mascote/ref/` e os prompts e imagens do Gemini: imagens de terceiros.

## 2026-11-05 tarde (2) — Instalador, atualização e desinstalação próprios (branch `feat/installer`, NÃO publicada)
- **O que muda:** o NSIS continua fazendo o trabalho (arquivos, registro, atalhos, atualização silenciosa do
  electron-updater). O que a pessoa vê é a nossa janela, `alga-setup-ui.exe`:
  - Rust + WebView2, em `apps/desktop/native/setup-ui`.
  - A página fica em `apps/desktop/src/setup`, com o mesmo `Eco.tsx` do app e embutida num HTML só.
  - A ligação é feita em `build/installer.nsh`.
  - Sem o runtime do WebView2, tudo volta ao NSIS padrão.
- **Instalar** (um clique, por usuário):
  - O logo vira o Eco na abertura.
  - O progresso é real: bytes extraídos e copiados.
  - "Monte seu Eco enquanto isso": o app veste o Eco escolhido no primeiro login, se a conta ainda não tem um (`setup-eco.json` em userData).
  - "Tudo pronto" abre o app sozinho.
- **Atualizar:** um card pequeno aparece só no "reiniciar e atualizar" (`--force-run`). Atualização feita ao fechar o app fica invisível.
- **Desinstalar:** a entrada do Windows (`UninstallString`) abre a janela.
  - Escolha de apagar ou não os dados deste PC.
  - O Eco perde a cor e dorme enquanto os arquivos saem.
  - "Antes de ir: por que está saindo?": 7 motivos e uma nota opcional, anônimo.
    - Envio: `POST /feedback/uninstall`, 5 por hora por IP, **migração 0016**, retenção de 6 meses.
    - Leitura: `GET /admin/uninstall-feedback`, só admin, com contagem por motivo e as notas.
  - Com `/S`, a mesma entrada repassa ao desinstalador real em silêncio: é o que o electron-updater roda nas próximas atualizações.
- **Pasta:** instalações novas continuam em `%LOCALAPPDATA%\Programs\Alga Meet` (`preInit`). Sem isso, o modo de um clique usaria `@algadesktop`.
- **Verificado com um instalador de identidade de teste ("Alga Meet Sandbox")**, sem tocar o app real do dono:
  - instalação nova, vestindo o Eco;
  - atualização do assistente antigo (0.1.89, igual ao de hoje) para o novo, que fica na mesma pasta;
  - atualização do novo para o novo, com o repasse silencioso saindo com código 0;
  - desinstalação pela janela, com o questionário;
  - desinstalação silenciosa, sem sobras.
  - Testes: servidor 256, desktop 334, shared 17.
- **Cuidados de release:**
  - O `alga-verify` resolve `@alga/*` pelo checkout principal: faça o merge na main **antes** do build.
  - O `npm run dist` agora compila também o `setup-ui` e precisa de `cargo` e do rc.exe do Windows SDK.
  - Uma vez o makensis falhou sem repetir: se acontecer, rode de novo.

## 2026-11-05 tarde — Fundamentos + Eco publicados (main `bcef309`, release v0.1.6)
- **Eco, o mascote** (`docs/brand/mascote/eco.md`): substitui as iniciais em todo avatar sem foto. Desenho vetorial único
  (`ui/eco/Eco.tsx`), estados (`idle`, `blink`, `hop`, `talking`, `listening`, `muted`, `connecting`, `streaming`, `sleeping`, `error`,
  `success`) usados na abertura do app, na sala vazia, na queda de conexão, nas telas vazias de Amigos e na pílula de reconexão.
  **"Seu Eco"** em Configurações › Minha conta: 16 cores × 6 olhos × 7 cabelos × 16 acessórios (10.752 combinações, versões
  femininas inclusas), provar passando o mouse, setas do teclado, salvo na conta (`users.eco`, **migração 0015**). Eco automático
  neutro (sem cabelo nem acessório de gênero) nasce do id. Autor removido = Eco anônimo; DM em grupo = ícone de grupo.
- **Convite com rosto:** a prévia pública e a página `https://alga-meet.vercel.app/i/<código>` mostram o Eco de quem convidou na
  cor dele (cópia da paleta automática anotada na página).
- **Publicado:** `feat/fundamentals` + `feat/eco` em fast-forward na main (WIP do pacote C/mídia preservado; `spaceMenu.ts`
  mesclado em 3 vias; cópia nova em `refs/backup/wip-2026-11-05b`). Staging reimplantado (deploy `ad45ed54`, `/ready` ok, migrações
  0014 e 0015 no boot) com `CORS_ORIGINS` incluindo o site. Site no Vercel com a rota `/i/`.
- Verificado: servidor 253 testes, desktop 332, shared 17, typecheck limpo; revisão independente do Eco (10 achados, corrigidos);
  E2E real 22/22 (`fundamentals-shots.mjs`); página de convite conferida em Chromium contra uma API simulada.

## 2026-11-05 manhã — Fundamentos do backlog da pesquisa Discord (mesclado e publicado à tarde, ver acima)
Worktree `D:\PROJETOS\alga-presence`, a partir da main `ffb4ec2`. Itens P0 de `docs/research/discord/04-prioritized-backlog.md`
(a pesquisa em si está no checkout principal, ainda não commitada):
- **BL-05 Olhar a sala antes de entrar:** o 1º clique na sala de voz (barra lateral e "Agora" da Home) abre o lobby (quem está, o
  que cada um faz, "Ninguém te vê aqui ainda"); o 2º clique, duplo clique ou Enter entra. Barra do lobby no lugar da barra da
  chamada: mic, áudio, teste de mic opcional (o anel acende), ajustes e "Entrar"; "Sala cheia" no limite. Botões "Entrar"
  explícitos (Ativo agora, cabeçalho do chat) continuam entrando direto.
- **BL-07 Notificação calma:** nível por espaço (Todas / Só @menções / Silenciado) com padrão adaptativo (≤ 10 membros: todas;
  maior: menções), "Silenciar por 1 hora", silenciar canal e DM. Silenciado não mostra ponto, não notifica e não conta na barra
  de tarefas; a @menção continua visível no app. Guardado no PC por conta (atalho anotado em `notifyPrefs.ts`).
- **BL-06 Sem ações implícitas:** conferido, sem mudança ("digitando" só com texto; Esc não marca lido).
- **BL-02 Mensagem que sempre chega, uma vez:** envio idempotente por nonce no servidor (**migração 0014**, coluna + índice único);
  falha de rede vira "Sem conexão. Ela sai sozinha…" e reenvia sozinha ao reconectar. A fila vive na memória (atalho anotado).
- **BL-04 Convite → dentro em segundos:** prévia pública do convite traz quem convidou; tela de cadastro com o rosto de quem chamou
  e o espaço, começando em "Criar conta"; criar a conta ali = aceitar (entra sozinho). Convite aberto já logado continua pedindo
  confirmação.
- **Links de convite que abrem (achado novo, era P0 escondido):** os links apontavam para `alga.meet`, que não existe, e o site não
  tinha `/i/`. Agora: página `apps/site/src/pages/i` (quem chamou, abrir no app, baixar, código) e links do app para
  `https://alga-meet.vercel.app/i/<código>`; "Enviar no WhatsApp" no convite. **Para valer:** publicar o site com a rota do README
  e pôr `https://alga-meet.vercel.app` em `CORS_ORIGINS` do staging.
Verificado: servidor 251 testes, desktop 329, typecheck limpo; revisão independente (8 achados, todos corrigidos); E2E real 19/19 (`apps/desktop/scripts/fundamentals-shots.mjs`, API
de QA :4360, voz simulada por webhook do LiveKit) e página de convite em Chromium contra a API de QA. Prints:
`docs/screenshots/2026-11-05-fundamentals-*`. **Publicar** = deploy do servidor (migração 0014 roda no boot), release 0.1.6 no
`alga-verify`, deploy do site e o `CORS_ORIGINS`. Não feito (depende do dono): BL-01 parecer jurídico, BL-08 auditoria da loja
(pacote C não commitado), BL-03 motor de mídia (trabalho de mídia não commitado).

## 2026-11-05 madrugada — Atividade em tempo real + perfil (branch `feat/presence`, NÃO mesclada)
Worktree `D:\PROJETOS\alga-presence`. Rich presence (detector nativo sem dependência nova; jogo/app com ícone, capa Steam,
tempo ao vivo), "Ativo agora" em Amigos, status personalizado com validade (balão no perfil), perfil completo (agora,
recente, membro/amigos desde, amigos/espaços em comum, nota privada), Configurações → Atividade (apps detectados com
interruptor). Servidor só em memória, **sem migração**. Verificado: servidor 234 testes, desktop 297, E2E real 16/16
(`apps/desktop/scripts/activity-shots.mjs`). Design, decisões e cuidados de merge: `docs/superpowers/specs/2026-11-05-rich-presence-and-profile-design.md`.
Estudo do Discord (só web; o Windows negou controle da janela do Discord): `docs/research/discord-profile-study.md`.

## HANDOFF — 2026-11-01 tarde (pausa pedida pelo dono para economizar tokens)
**Fechado hoje:** site v2 (7 momentos; Lighthouse celular 93/93/99 nos níveis A/B/C) **publicado no Vercel: https://alga-meet.vercel.app** (projeto `alga-meet`, time `aionixdev`, deploy estático pré-construído — passos em `apps/site/README.md`); nomes da sala de voz escolhidos pelo dono; onda de design 9 + UI de E2EE (9 commits, 274 testes; autocrítica r4 7,5 Linear / 6,5 desejo — **falta crítica independente r5**); pacote D1 retenção no servidor (eventos/RSVP/lembretes, `voice_sessions`, resumo semanal, "Semanas juntos", e-mail de atividade com consentimento; 226 testes em PGlite e PG 18; contrato e notas para o D2 em `docs/retention/server.md`; rascunho do diff da Política em `docs/legal/politica-diff-pacote-d.md`); **Release v0.1.2** (ver "Release pública").

**PAUSADO pelo dono às 13:2x (economia de tokens).** Os agentes de mídia e do pacote C foram parados no meio, **sem commit e sem relatório**; o trabalho deles está NÃO COMMITADO no checkout principal (não use `stash`/`reset`/`checkout`):
- **Mídia (captura de tela inteira/jogo ~30 fps):** `src/main/capture.ts`, `renderer/src/media/{engine,lab,stats,store}.ts`, `media/telemetry.test.ts`, `scripts/{media-lab,media-game}.mjs`, `docs/benchmarks/game-capture.json` (sem o `.md` ainda).
- **Pacote C (loja/provador/presentes/Plus v2/Casa + vazamento dos cosméticos):** `features/billing/**` (inclui novos `Gift`, `TryOn`, `Wish`, `Host`, `Fine`, `accents`, `appIcon`, `icons`, `store.test.ts`), `features/spaces/upgrade/`, `features/spaces/spaceMenu.ts`, `features/shell/{MemberList,Shell,people}.tsx`, `scripts/{cosmetics-perf,cosmetics-store}.mjs`. Typecheck do desktop estava vermelho por `Shop.tsx` em andamento.

**Próxima tarefa exata do Maestro (ao retomar):** (1) relançar **dois** agentes com escopo restante (mídia; pacote C), cada um começando por ler o próprio diff não commitado acima e o brief do pacote (`docs/business/growth-plan.md` §5.2 C; mídia: entregar `docs/benchmarks/game-capture.md` + diagnóstico para quem transmite); ao fecharem: verificar num worktree limpo (`D:\PROJETOS\alga-verify`, node_modules por junção), push, Release v0.1.3 (auto-update leva aos amigos). Manter ≤ 2–3 agentes em paralelo (orçamento de tokens do dono); (2) pedidos pendentes da onda 9: mídia — `requireE2ee` no motor para DM e `leave()` desligar E2EE só depois de sair; som — cue "chegada" de 3 notas; C — remover `<Kbd>Esc</Kbd>` em `settings/Frame.tsx:115`; servidor/bucket — CORS nas URLs de avatar (senão a cor da pessoa cai no padrão); (3) reimplantar staging com o servidor atual (migração 0012 liga "Criar eventos" no @everyone de todos os espaços) antes do D2; (4) D2 retenção no desktop (onboarding < 2 min, eventos, "Agora" com tetos, resumo, `CREATE_EVENTS` em `PERMISSION_GROUPS`); (5) crítica independente r5 + "desejo" dos cosméticos; (6) site: legenda "TODO MUNDO" cobre o nome "Alan Araújo" no vídeo/quadro do nível B/C da sala (`tier-media.mjs` regrava), seções grupo/privacidade/Plus/FAQ ainda no layout v1, vozes sintetizadas nunca ouvidas por humano.
**Do dono:** testar v0.1.2 com os amigos (inclusive 4G/CGNAT); onboarding com 5 pessoas reais; domínio; certificado; Mercado Pago/CNPJ; Resend; advogado/contador; Nidus PF (~meados dez/2026); INPI.

**Acessos operacionais:** staging Railway (`docs/infra/staging.md`), SFU de casa via SSH (valores reais em `docs/private/home-network.md`, fora do git), GitHub público com hook anti-vazamento (`.git/hooks/public_guard.py`). Memórias do dono: design Linear/índigo "sexy", site espetacular, trilha de monetização, uso livre do PC com explicação de atividade visível.


> Fonte de verdade. Só entra como "Validado" o que tem evidência (teste, medição, screenshot). Atualizado: 2026-11-01.

## Staging (Railway, criado 2026-11-01 com aprovação do dono)
API pública `https://api-staging-b3ea.up.railway.app` + Postgres + bucket — ver `docs/infra/staging.md`. Funciona: contas, social, espaços, convites, mensagens, gateway (e-mail auto-verificado só em staging). Instalador apontando para staging: `apps/desktop/release/AlgaMeet-Setup-0.1.0-staging.exe` (não assinado; **build limpo de 085c992 com o visual Índigo**, instalado no PC do dono em 2026-11-01). **Não funciona ainda: voz/tela (sem SFU com UDP), e-mail real, pagamentos.**

## Servidor de voz em casa (decisão do dono 2026-11-01: custo zero, servidor Ubuntu próprio)
- **Sem CGNAT (confirmado):** WAN do roteador (Huawei IGD, via UPnP) = `203.0.113.10` = IP público visto de fora. IPv6 público também (provedor local).
- Upload medido pelo dono: **220 Mbps** (download 429, ping 2 ms) → folga para ~20+ espectadores de 1080p60.
- Servidor `home-server` (`192.168.1.110`): Ubuntu 24.04.5, Xeon E5-2650 v2 ×16, 15 GB RAM, 64 GB livres, Docker 29.9 + Compose v5.6. **Acesso SSH por chave autorizado** (`~/.ssh/alga_homeserver` deste PC, usuário `alanaraujo`, grupo `docker`; `sudo` exige senha → Maestro não usa sudo). ufw **ativo** → stack em modo bridge com portas publicadas (DNAT do Docker contorna o ufw, como o Minecraft já faz). Serviços existentes a preservar: Minecraft (25565, 8100), alga-connect/aionix-connect (UDP 7441-7442, postgres, redis). Livres: 80, 443, 7880-7882, 3478, 5349.
- Kit `infra/home-sfu/` (00f94d1 + correção UPnP) **instalado em 2026-11-01**: LiveKit 1.13.11 + Caddy (TLS Let's Encrypt para `example-sfu.duckdns.org` e `turn.`) + DuckDNS + UPnP, em `~/alga-sfu`, sem sudo. UPnP abriu 80/443/7881 TCP e 7882/3478 UDP no roteador (com `UPNP_URL`, porque o ufw bloqueia SSDP). Segredos do LiveKit copiados do Railway sem exibição; token DuckDNS gravado pelo dono.
- **Staging aponta para o SFU de casa:** `LIVEKIT_URL=https://example-sfu.duckdns.org`; `/api/v1/ready` (visto do Railway, de fora) → `livekit: ok`. NAT loopback funciona do PC da LAN (HTTPS 200 pelo IP público).
- Feito pelo dono: reserva DHCP do `192.168.1.110`; `root-setup.sh` com sudo (buffers UDP 5 MB, persistidos em `/etc/sysctl.d/90-alga-sfu.conf`; verificado). **O contêiner do LiveKit precisa reiniciar para usar os buffers novos** — adiado até terminar o teste de mídia em andamento.
- **Teste real de mídia pelo staging + SFU de casa (98203a5, `docs/benchmarks/staging-home-sfu.md`) — LAN com hairpin:** ICE UDP em `203.0.113.10:7882`, RTT 1 ms; voz 10 min: latência A→B 46,7 ms (p95 50,3), 0 perdidos de 20.834 pacotes, 0 % ocultação, 0 reconexões; tela real 1280×720 HEVC por hardware: 29 fps a 4,9 Mbit/s (1080p30) e 49 fps a 2,8 Mbit/s (720p60), 0 congelamentos; fallback TCP 7881 funcionou; webhooks 76/0 erros; contêiner LiveKit 1,2–2,5 % de um núcleo (voz), 6–16 % (tela), 51–77 MiB. LiveKit recriado depois para usar os buffers de 5 MB.
- **Primeiro teste real entre casas (2026-11-01, amigo em outra casa da mesma cidade, release 0.1.1):** transmissão do amigo publicada em **H.265 por hardware, 1080p com 3 camadas (360p/720p/1080p)**; no espectador (dono): 1920×1080, **21 fps**, 5,3–5,8 Mb/s, decodificação por hardware (D3D11), **0 % de perda, 0 congelamentos**, tanto em "Automática" quanto em "Original". SFU de casa: 5,6 % de CPU, 78 MiB. Segundo teste: jogo real a 191 fps, preset 720p60, modo "Jogo/vídeo" → espectador recebeu **1280×720 a 32 fps**, 3,5 Mb/s, H.265 HW, 0 % perda, 0 congelamentos → o limite está no **lado de quem transmite** (provável captura do Windows/Chromium); agente de mídia investigando + diagnóstico para o streamer. **Aberto (1º teste):** por que 21 fps e não 30 (preset escolhido? tipo de conteúdo "texto" mantém resolução e corta fps? upload do amigo? CPU/GPU do amigo?) — falta estatística do lado de quem transmite.
- Pendentes: teste com CGNAT/4G e mais pessoas; staging já reimplantado com o servidor atual.

## Site (apps/site, Astro 7) — primeira versão (085c992)
Estudo do heyparker.ai em `docs/research/site-reference-heyparker.md`. Seções: hero com sala de voz viva sobre captura real, voz, transmissão (comparador 720p×1080p), leveza (barras de memória vs Discord), grupo, privacidade (E2EE descrito exatamente como implementado), planos + teaser Hora Azul, FAQ, CTA. Números só de `src/data/facts.ts` com fonte. 3 níveis de desempenho escolhidos antes do primeiro paint (A completo com GSAP/Lenis, B só CSS, C estático). Lighthouse local: mobile 98–99 / LCP 1,9–2,0 s / CLS 0; desktop 100; a11y/SEO 100. Dev ao vivo em `http://localhost:3100`. Pendências: URL pública do instalador, canal de convites, domínio/hospedagem, SVG final da marca, capturas melhores (stream real, palco com 4–5 pessoas), teste em celulares reais e Safari/Firefox.

## Repositório (2026-11-01)
**Público:** https://github.com/alanaraujo-bit/Alga-Meet (decisão do dono). Antes do primeiro push o histórico foi reescrito (git filter-repo) trocando os dados reais da rede de casa por valores genéricos (IP público, rede local, nome/MAC do servidor, domínio DuckDNS, provedor). Valores reais ficam só em `docs/private/` (git-ignored). Hooks locais `pre-commit` + `commit-msg` (`.git/hooks/public_guard.py`, regras em `.git/info/public-replacements.txt`) bloqueiam commits que reintroduzam esses dados. Política: o Maestro faz push para `origin/main` depois de cada lote de commits verificados. Auto-update (`electron-builder.yml`) e Railway IaC apontam para esse repositório.

## Release pública
**v0.1.6 (2026-11-05) — Eco, olhar antes de entrar, notificações calmas, convites que abrem.** https://github.com/alanaraujo-bit/Alga-Meet/releases/tag/v0.1.6 — build limpo de `bcef309` no `alga-verify`. Quem está na 0.1.5 recebe sozinho.

**v0.1.5 (2026-11-05) — corrige o auto-update.** A 0.1.3 e a 0.1.4 saíram sem as dependências do `electron-updater` (e o `node-gyp-build` do `uiohook-napi`): foram geradas em worktrees cujo `node_modules` era uma pasta de junções por pacote, e o electron-builder não seguiu as dependências transitivas. Quem está nelas precisa instalar a 0.1.5 uma vez à mão. **Build de release só no `D:\PROJETOS\alga-verify`** (`node_modules` = uma junção para o do checkout principal), e o `npm run dist` agora falha se faltar dependência no `app.asar` (`scripts/check-package.mjs`).

**v0.1.4 (beta fechado, 2026-11-05)**: https://github.com/alanaraujo-bit/Alga-Meet/releases/tag/v0.1.4 — merge de `feat/presence` sobre a 0.1.3 (soundboard), build limpo de `fe14a40` no worktree `alga-presence` (typecheck; 325 testes do desktop; servidor 249). Traz atividade em tempo real, status personalizado, "Ativo agora" e perfil completo. Staging reimplantado com o mesmo commit (deploy `4b6bb004`, `/ready` ok). O trabalho não commitado do pacote C/mídia continua no checkout principal (MemberList mesclado em 3 vias); cópia de segurança local em `refs/backup/wip-2026-11-05`.

**v0.1.2 (beta fechado, 2026-11-01)**: https://github.com/alanaraujo-bit/Alga-Meet/releases/tag/v0.1.2 — build limpo de `701472f` num worktree (typecheck + 274 testes do desktop; servidor 226), aponta para o staging (que já tem o servidor de E2EE por chamada; o contrato novo só adiciona rotas/eventos). Traz a onda 9 e a UI de E2EE; **ainda sem a correção de fps de captura** (vem na 0.1.3).

**v0.1.1 (beta fechado)**: https://github.com/alanaraujo-bit/Alga-Meet/releases/tag/v0.1.1 — build limpo de `eca519f` (typecheck + 266 testes do desktop passando), aponta para o staging. Link estável sempre da última versão: `https://github.com/alanaraujo-bit/Alga-Meet/releases/latest/download/AlgaMeet-Setup.exe`. **Auto-update verificado de ponta a ponta:** o app 0.1.0 instalado no PC do dono encontrou e baixou a 0.1.1 sozinho (instala ao sair). Não assinado (SmartScreen avisa). Como publicar a próxima: subir a versão em `apps/desktop/package.json`, build limpo numa worktree com `MAIN_VITE_API_URL`, `gh release create vX.Y.Z` com `.exe`, `.blockmap`, `latest.yml` e a cópia `AlgaMeet-Setup.exe`.

## Versão executável
- Dev: `npm install && npm run dev` (ver `README.md`). Multiusuário local: `npm run dev -- --profiles=bob` — abre duas janelas; crie uma conta em cada, adicione como amigo, crie um espaço, convide, entre no canal de voz e transmita a tela.
- Funciona só nesta máquina/rede local até o deploy (API no Railway + SFU em VPS) — ver Bloqueios humanos.
- Instalador: `npm run dist:win` → `apps/desktop/release/`.

## Implementado
- Monorepo (npm workspaces), contrato compartilhado `@alga/shared` (modelos, REST com zod, protocolo do gateway, permissões, UUIDv7).
- Esqueleto Electron (janela com caption buttons nativos, perfis isolados para multi-instância, bridge tipado `window.alga`).
- SFU LiveKit 1.13.11 local (binário fixado com SHA-256 conferido) + config dev com webhooks para a API.

## Em desenvolvimento (agentes paralelos)
| Frente | Escopo | Status |
|---|---|---|
| Backend onda 1 | `apps/server` | **feito** — ver Validado |
| Desktop nativo onda 1 | `apps/desktop/src/main`, `preload`, instalador | **feito** — ver Validado |
| Backend onda 2 (segurança + cargos/banimento/moderação) | `apps/server`, `packages/shared` | **feito** — ver Validado |
| UI onda 2 (chamada, transmissão, configurações, correções da crítica) | `apps/desktop/src/renderer` | **feito** — ver Validado |
| Mídia onda 2 (vazamento, unmute, rede degradada) | `media/` | **feito** — ver Qualidade |
| Mídia onda 3 (gating por plano, 720p60, palco, congelamento, DTX, telemetria) | `media/`, `features/voice` | **feito** — ver Qualidade |
| Desempenho da UI (e5f1359) | `features/chat`, config Vite | **feito** — ver Qualidade |
| UI onda 6 (64317dd, 121 testes) | renderer | **feito** — cosméticos equipáveis e de outros ao vivo, convites ao vivo (~30 ms), retomar renovação, interruptor de telemetria, exportação com senha (zip real), mini-player no Shell, painel de staff (csam primeiro, mídia nunca exibida) |
| Motor de mídia onda 1 | `apps/desktop/src/renderer/src/media` | **feito** — ver Validado e Qualidade |
| Backend onda 3 (anexos/avatares, Postgres real, pacote de deploy) | `apps/server`, `infra/` | **feito** — ver Validado |
| Backend onda 4 (EXIF/GPS, verificação de e-mail, reset de senha) | `apps/server` | **feito** — ver Validado |
| Nativo onda 2 (deep links, verificações visuais) | `src/main`, `preload` | **feito** — ver Validado |
| UI onda 3 (anexos, avatares, configurações do espaço, verificação de e-mail/reset) | `apps/desktop/src/renderer` | **feito** — ver Validado |
| Monetização (estratégia + motor de direitos) + listar/revogar convites | `docs/business`, `apps/server` | **feito** — ver Validado |
| UI onda 4a (assinatura, loja, deep links, convites) | `apps/desktop/src/renderer` | **feito** — ver Validado |
| Rascunhos legais | `docs/legal` | **feito** (rascunho p/ advogado) |
| Trust & Safety + LGPD (servidor) | `apps/server`, `docs/trust-safety` | **feito** — ver Validado |
| UI onda 5 (telas de T&S/LGPD) | `apps/desktop/src/renderer` | **feito** — ver Validado |
| Servidor: complementos de T&S (1c059e2, 165 testes) | `apps/server` | **feito** |
| Servidor: endurecimento de T&S (0b08eec, 167 testes em PGlite e PG 18) | `apps/server` | **feito** |
| Desenho de E2EE (f753ac3) | `docs/decisions/0004-e2ee.md` | **feito** — opção A: MLS (RFC 9420) por chamada, OpenMLS (MIT, auditado) em WASM num `utilityProcess`, chaves por remetente via MLS-Exporter no frame cryptor do LiveKit |
| E2EE fase 0 (08d73e3) | `native/mls`, `src/main/mls` | **GO: OpenMLS 0.9.2** (MIT) em `utilityProcess`: `.wasm` 2,23 MiB (662 KiB gzip); entrar numa chamada de 99 pessoas custa p95 9,7 ms de CPU (19,7 ms worker frio); worker 30–34 MB; 157 crates sem GPL (4 MPL-2.0 → aviso de terceiros) |
| E2EE fase 1a (d6a9a47..4c8f4db) | `packages/shared`, `apps/server`, `src/main`, `native/mls` | **feito** — Delivery Service guarda só chaves públicas + `PublicGroup`, valida cada commit contra a árvore real, Remove imediato em sair/kick/ban/move; identidade do dispositivo só cifrada via DPAPI; bridge `window.alga.e2ee` entrega só chaves de quadro ao renderer; teste ponta a ponta com clientes WASM reais pelo servidor real; **175 testes** em PGlite e PG; `native/mls/pkg` commitado + `verify:mls` no build; avisos de terceiros no instalador. O que um servidor malicioso ainda pode fazer: `docs/security/e2ee-delivery-service.md` |
| E2EE fase 1b-mídia (6888b4e) | `media/` | **feito** — grupo MLS ativo em 39/67 ms (p50/p95); primeiro áudio decifrado +142 ms no p95 (meta ≤150 ms — no limite); CPU voz +0,6/+0,9 % de um núcleo, tela +2,2/+1,3 %; RED restaurado sob E2EE por plugin de build que falha se o SDK mudar (ocultação a 5–10 % de perda 1,1 % com e sem E2EE); espectador sem HEVC recebe H.264 em 0,9–2,0 s; cliente sem chaves decodificou 0/591 quadros e aparece em `mismatch`; nunca publica sem cifrar quando E2EE é esperado (falha fecha a chamada). **QA BUG-02 corrigido (0/16 → 24/24)** — camada < 144 px quebrava o decodificador HEVC; **BUG-03 corrigido** (Original 960×540; 60 fps em 46–50 fps) |
| **Trilha de monetização e retenção** — estratégia feita (`docs/business/growth-plan.md`, 17de322): Plus v2 (R$ 14,90 mantido; guarda-roupa mensal, aura de voz, ícones/acentos, banner animado, selo de tempo, 2 passes de 7 dias para amigos), **Casa** (compra do grupo R$ 19,90/30 dias via vaquinha Pix), **Coleção 01 "Hora Azul"** (28 itens, 5 heróis), presentes, retenção sem padrões manipuladores. Decisões do Maestro: aposentar o catálogo "oceano" (nada vendido); adotar Casa; perk "Cinema" (1080p60 do espaço) desligado até o pacote de banda | docs | **estratégia feita**; pacote A **feito** (bc536e3/fa81ba7/410fa0d, 203 testes em PGlite e PG: catálogo v2 Hora Azul, presentes com "Abrir", bundles fechados até a onda 2, wishlist, try-on, Plus v2, Casa com vaquinha Pix, reembolso 7 dias; Cinema atrás de `CASA_CINEMA`); B **feito** (motor `<Cosmetic>` + 28 itens Hora Azul; galeria `#cosmetics-gallery`; `docs/design/cosmetics/hora-azul/`; ~0,14 ms/quadro por item, mas cena de estresse 50 membros + 8 tiles +1,58 ms/quadro (meta ≤1 ms) e **memória do renderer +145 MB subindo em 60 s — investigar**; faltam som de entrada ao entrar na voz, cores de acento, ícone na janela); C (loja/try-on/presentear) e D (retenção) na fila |
| Redesenho visual B · Índigo suave (4e8d477..cd64bf7, 232 testes) | renderer, `build/` | **feito** — neutros `#0b0b0c`/`#0f1011`/`#161718`, texto `#f7f8f8`/`#d0d6e0`/`#8a8f98`, índigo `#8b8ef7` (texto/foco/anel de fala), fill primário `#6163d0` (AA); ícones **Phosphor** (traço 1,5 px a 16 px, variantes sólidas no estado ativo; lucide removido); Inter Display real nos títulos; anel de fala calmo sem brilho; marca 3 barras branco→índigo; teste `tokens.test.ts` garante AA e proíbe teal. 29 comparações lado a lado em `docs/design/compare/`. Diferenças intencionais: barra de espaços/lista de membros (migrantes do Discord), mensagens 15 px |
| Servidor: E2EE por chamada (133002d, 183 testes) | `apps/server`, `packages/shared` | **feito** — DMs sempre E2EE; espaços seguem `Space.e2ee` (padrão off); `capabilities` no `voice/join` → atributos `alga.e2ee`/`alga.decode`; `VOICE_E2EE_CHANGED` pede reentrada. **Staging ainda não reimplantado com isso** |
| Mídia: seguir a flag de E2EE por chamada (1e845ff, 232 testes) | `media/`, `store/actions.ts` | **feito** — chamada simples em espaço, alternância de `Space.e2ee` com reentrada < 1 s mantendo mute e transmissão, DM cifrada; verificado com API/LiveKit próprios. **Risco aberto:** o cliente confia na flag do servidor também em DM (servidor mentiroso pode desligar E2EE) → fixar E2EE obrigatório em DM no cliente na próxima onda de UI de E2EE |
| Teste real de mídia: staging + SFU de casa (2 instâncias na LAN) | `docs/benchmarks` | em andamento |
| Servidor: downgrade de plano no meio da live (8f1854d, 2e3a0aa; 168 testes) | `apps/server`, `infra/livekit` | **feito** — atributo atualizado na hora; reverificação em 10 s muta transmissão acima do plano. Timeout de camada do LiveKit **mantido em 2 s** (1–1,5 s causou oscilação de camadas; detalhes em `infra/livekit/README.md`) |
| Mídia: republicar a transmissão no downgrade (6a2d551) | `media/` | **feito** — nova publicação 720p60 em 124–171 ms; servidor não muta após a reverificação de 10 s; espectador continua inscrito (maior lacuna entre quadros 150–223 ms em Original, 356–512 ms em Auto); áudio da tela sem interrupção; memória −1,0 MB/ciclo no fluxo real |
| Crítica de design rodada 2 (`docs/design/critique-2026-11-01-r2.md`) | docs | **feito**: **6,5/10** (antes 5) — shell 6,5 · chat 7 · chamada 7 · transmissão 6 · configurações 7 · billing 8 / loja 5 · T&S 8 · consistência 5,5; identidade ainda é sobretudo a cor |
| UI onda 7 (c3b95ae..73d270e, 135 testes) | renderer, `build/` | **feito** — todos os Alto/Médio da r2 exceto zoom da UI (precisa `setZoomFactor` no preload); marca v1 = 3 barras de voz em ícone, bandeja e instalador (Λ removido); identidade: brilho de fala como luz + palco que clareia com a voz mais alta, cabeçalho de canal de texto mostra quem está em voz, respostas com linha reta. Capturas `chat-channel-v8`, `voice-stage-v7`, `stream-watching-v5`… Maestro: badge com a cor de perigo do design system e miniaturas do seletor em 640×360 |
| QA independente da jornada completa (92b4596) | `docs/qa/2026-11-01-report.md` | **feito**: 100 verificações, **87 passaram, 13 falharam (6 bugs)**. Passaram inteiros: contas, amizade/bloqueio, voz (incl. queda do SFU), configurações, T&S. Bugs: BUG-02 (Alto) transmissão de janela pequena trava o espectador (HEVC cai para NullVideoDecoder e o H.264 reserva não entra — 6/6); BUG-01 (Alto) moderador/dono sem "Excluir" em mensagem alheia; BUG-03 espectador em "Original" preso em 640×360@30; BUG-04 "Usuário desconhecido" após reabrir; BUG-05 menção embaralha texto; BUG-06 403 no console |
| Correções do QA na UI (3ae9602, 150 testes) | renderer | **feito** — BUG-01/04/05/06 corrigidos; passos 3, 4 e 9 do QA re-rodados: 34/34; 0 chamadas a `/admin` (antes 28); cabeçalho `X-Alga-Client`, sessões com aparelho, zoom 80–150 % (Ctrl+=/−/0 persistem), interruptor da bandeja; 3 quebras de layout a 150 % em 960×600 corrigidas |
| Correções do QA na mídia (BUG-02/03) junto com a negociação de codec da E2EE 1b | `media/` | em andamento |
| Pequenos (564be84..aee9dce; 178 testes servidor, 30 nativos) | server, `src/main` | **feito** — `Me.staffRole`, sessões com `client`/`os` via cabeçalho `X-Alga-Client`, zoom da UI 0,8–1,5 no bridge, bandeja "respirando" em voz (~0,19 ms/quadro, para quando mudo/ocioso/movimento reduzido). Renderer ligando na onda de correções |
| Servidor: cosméticos equipáveis/públicos, eventos de convite, retomar renovação, observabilidade | `apps/server` | **feito** — ver Validado |
| Design system + telas onda 1 | `apps/desktop/src/renderer` | **feito** — ver Validado |
| Crítica de design independente | `docs/design/critique-2026-11-01.md` | **feito**: nota 5/10 vs Linear (tela de chamada ausente, layout clone do Discord, excesso de vermelho e bordas) → corrigindo na UI onda 2 |
| Camada de dados do renderer | `lib/api.ts`, `lib/gateway.ts`, `store/*` | feito (Maestro), typecheck ok, sem teste de integração ainda |

## Validado
- `@alga/shared`: 2 testes unitários (UUIDv7, permissões) passando.
- Esqueleto desktop: `electron-vite build` e `typecheck` passando.
- Revisão de segurança independente do backend (`docs/security/server-review-2026-11-01.md`): 0 crítico, 2 alto, 10 médio, 11 baixo; sem IDOR. **Corrigidos: todos os altos e médios + 9/11 baixos**, cada um com teste de regressão escrito antes (tabela de status no próprio relatório). Adiados: B5 (registro revela campo já usado) e B10 (senha mínima 8 sem lista de vazadas) — dependem de verificação de e-mail.
- Backend onda 2: cargos (CRUD, ordem, atribuição), apelidos, banimento, moderação de voz (mute/ensurdecer/mover/desconectar). Mute de moderação **aplicado no SFU** (smoke real: LiveKit retirou a permissão de publicar microfone; republicar falhou com "insufficient permissions"). 87 testes passando (antes 47).
- Desktop nativo: bridge `window.alga` completo; 16 testes unitários (hotkeys, bounds, badge) + 21/21 checagens e2e com Playwright no app empacotado (tray, token via DPAPI sem texto puro no disco, captura negada sem escolha do usuário, hooks globais reais de PTT). Instalador NSIS 109 MiB: instalação silenciosa 7,8 s, desinstalação 6,2 s, dados do usuário preservados por padrão.
- Eco do áudio do sistema na transmissão: resolvido sem módulo nativo com `restrictOwnAudio: true` (tom do próprio app caiu de −56 dB para −80 dB, outros apps intactos em −24 dB). `docs/decisions/0002-screen-audio-capture.md`.
- UI onda 1: design system (`docs/design/design-system.md`) + 20 componentes; telas de auth, onboarding (2 passos até criar/entrar em espaço), amigos, DMs, espaços, convites, chat completo (agrupamento, edição, respostas, reações, digitação, não lidas, reenvio em falha), banner de reconexão, Ctrl+K. Cada tela capturada no app real com dados criados pela API real (`docs/screenshots/2026-11-01-*-vN.png`, histórico de versões preservado). 18 testes unitários novos.
- UI onda 2: palco de chamada com brilho de fala real, "Agora" (onde as pessoas estão), painel de voz, seletor de transmissão, assistir sob demanda/foco/tela cheia/stats, chamadas em DM com toque, moderação por tile, configurações completas (conta, voz e vídeo, atalhos, notificações, aparência, inicialização, avançado), emoji picker, autocomplete de @menção. Capturas de **duas instâncias reais na mesma sala LiveKit** (`docs/screenshots/2026-11-01-voice-stage-v5.png`, `stream-watching-v3.png`, `screen-picker-v3.png`, `settings-voice-v3.png`…). 57 testes no desktop. Maestro conferiu as capturas e abriu o app integrado nesta máquina (LiveKit + API + 2 janelas, perfis padrão e `bob`).
- Backend onda 3: anexos em mensagens (multipart, tipo detectado pelo conteúdo, HTML/SVG disfarçado servido só como download), downloads com URL assinada por usuário (~1 h) e reverificação de acesso, avatares/ícones próprios (M9 fechado). **104 testes passando em PGlite e os mesmos 104 em PostgreSQL 18.6 real.** Corrida B2 (pedido de amizade × bloqueio) confirmada no Postgres real e corrigida com lock transacional. Build de produção sobe contra Postgres real. Pacote de deploy: `infra/server/Dockerfile`, `railway.ts`, `infra/livekit/livekit.prod.yaml` + Caddy/TURN 443, guia `docs/infra/deploy.md` (Docker build não testado — sem Docker na máquina).
- Backend onda 4: imagens re-codificadas com sharp (EXIF/GPS removidos, orientação aplicada, bombas de descompressão rejeitadas); verificação de e-mail e recuperação de senha (driver console em dev → `apps/server/data/outbox/*.eml`; driver Resend em prod); B5 e B10 corrigidos (senha mínima 10 + lista de senhas comuns). Contas não verificadas não criam convites, não têm >1 espaço nem abrem DM com não-amigos. **120 testes em PGlite e em PostgreSQL 18.**
- UI onda 3: anexos (botão, arrastar, colar, progresso real, retry, grade 1–10, lightbox, players, refetch de link expirado testado com 403 forçado), avatar/ícone com recorte, configurações do espaço (visão geral, cargos com hierarquia espelhando o servidor, membros, banimentos, convites), apelidos em todo lugar, troca de senha, sair de outras sessões, verificação de e-mail e "Esqueci minha senha". 78 testes no desktop. Capturas `docs/screenshots/2026-11-01-chat-attachments-v3.png`, `space-settings-roles-v4.png`, `settings-account-security-v2.png`…
- Nativo onda 2: deep links `algameet://auth/verify-email?token=`, `auth/reset-password?token=`, `invite/<code>` (parse estrito, tokens redigidos do log), entregues a frio, por segunda instância e pelo caminho real do Windows (`Start-Process`); protocolo registrado/removido pelo instalador NSIS (testado). safeStorage migrado para API assíncrona sem perder tokens antigos. Verificados com captura: toast nativo (clique foca e dispara evento), badge da barra de tarefas, iniciar com o Windows (`--hidden` vai para a bandeja). 20 testes nativos + verify-native verde. **UI ainda não consome `window.alga.deepLinks`.**
- Monetização (`docs/business/monetization.md`): proposta **Alga Plus R$ 14,90/mês ou R$ 149/ano** (1080p60/1440p60/4K30, anexos 100 MB, 2 cosméticos inclusos); grátis mantém voz igual para todos, social completo e tela até 1080p30; cosméticos avulsos R$ 5,90–12,90, sem moeda virtual, sem anúncios/quests. Provedor recomendado: **Mercado Pago** (Pix 0,99%). Com banda em pacote o Plus cobre toda a infra a partir de ~2,3% de conversão (1k CCU); a preço de tabela precisa ~5,5%. Motor de direitos no servidor: só webhook verificado muda estado de pagamento; provedor sandbox bloqueado em produção; presets de transmissão do plano vão no token LiveKit e o servidor muta transmissão acima do plano. **138 testes em PGlite e PostgreSQL 18.** Adaptador Mercado Pago testado só contra API simulada.
- UI onda 4a: compra sandbox ponta a ponta no app real (checkout → sandbox confirma → webhook → `ENTITLEMENTS_UPDATE` → UI), recusa e cancelamento no fim do período; loja de personalização com prévia no próprio perfil e cosméticos desenhados em CSS/SVG; deep links consumidos (verificar e-mail, reset, convite — a frio e por segunda instância); página de convites com revogar. Texto legal aplicado ("fica na sua conta, sem renovação"; reembolso 7 dias antes do clique). 85 testes no desktop. Capturas `docs/screenshots/2026-11-01-billing-*-v5.png`, `shop-*-v5.png`.
- Trust & Safety/LGPD no servidor: idade (data de nascimento; <16 recusado; 16–17 só DM com amigos e sem compras), denúncias com snapshot de evidência, ações de conta (aviso/suspensão/banimento) aplicadas em login, gateway (4010) e voz, apelação com token, processo CSAM (`docs/trust-safety/csam-process.md`) com quarentena automática de anexos, exclusão de conta com carência de 7 dias e transferência de espaços, exportação de dados (zip, link 7 dias), logs de acesso 6 meses (Marco Civil), registro de aceite de termos, rotas de staff com log de auditoria. **153 testes em PGlite e PostgreSQL 18.**
- Servidor (e66d7ef): equipar cosméticos (`PUT /users/@me/cosmetics`, `PublicUser.cosmetics`), `INVITE_CREATE/DELETE`, retomar renovação, `/metrics` Prometheus protegido por token (HTTP, gateway, READY, voz, webhooks, DB, rate limit, e-mail, billing, processo), `/ready`, telemetria de qualidade de chamada **opt-in, desligada por padrão**, agregada, sem conteúdo nem IP, retenção 30 dias; regras de alerta e guia em `docs/infra/observability.md`. **163 testes em PGlite e PostgreSQL 18.** Política de privacidade (rascunho) atualizada para declarar a telemetria opcional.
- UI onda 5 (73cfbd7): cadastro com data de nascimento + aceite de termos, tela única de termos/data antes do shell, avisos para 16–17 anos na assinatura e loja, denúncias (perfil, espaço; mensagens via `messageReportEntries` a ligar no chat), tela de conta restrita com apelação, Configurações › Privacidade (ações na conta, exportar dados, excluir conta). Fluxos exercitados com ações reais de staff. 37 capturas, 109 testes no desktop.
- Backend: 47 testes vitest (PGlite em memória, REST via inject + gateway via WebSocket real) passando, conferido pelo Maestro. Smoke test com LiveKit real: webhooks `room_started/finished` e `participant_joined/left` reais recebidos e assinatura verificada; `VOICE_STATE_UPDATE/REMOVE` entregues no gateway.

## Pesquisa concluída
- `docs/research/discord-benchmark.md` — barra a superar (fatos/medições/relatos separados). Medido: Discord ocioso na bandeja = 6 processos, ~808 MB de memória privada.
- `docs/research/linear-design-study.md` — princípios + tokens propostos; identidade "Bioluminescência" (acento teal-ciano H≈195°, brilho de fala segue o nível de áudio). Capturas de referência ficam só locais (`docs/references/`, fora do git por direitos autorais).
- `docs/infra/cost-model.md` — Railway sem UDP (confirmado); ~US$ 0,93k–1,98k/mês por 1k CCU com SFU em São Paulo; provedores por GB inviabilizam stream grátis. Decisões D11–D13 em `ARCHITECTURE.md`.

## Qualidade (voz / transmissão / interface / desempenho)
Medições [MEDIDO] em `docs/benchmarks/media-baseline.md` — **localhost, duas instâncias Electron na mesma máquina (i5-13600KF, RTX 3070); não prova rede real.**
| Métrica | Alga Meet | Discord (benchmark) | Meta |
|---|---|---|---|
| Latência de voz A→B via SFU (mediana / p95) | 46/50 ms cru · 53/55 ms padrão · 62/65 ms RNNoise | não medido | ≤ paridade |
| Entrar no canal | 132 ms (p95 137) | não medido | < 500 ms |
| Reconexão após queda de 3 s do SFU | 3,4 s após volta (padrão LiveKit: 6,0 s) | — | < 5 s |
| RAM ociosa | ~200 MB privada | ~808 MB | ≤ 300 MB ✅ |
| Em chamada de voz | 1,7 % CPU, 370 MB | não medido | — |
| Transmissão 1080p60 (captura real) | 49–50 fps, 9,4 Mbps, encode HEVC por hardware (NVENC), 3,4 % CPU total, sem congelamentos | grátis: 720p30 | 1080p60 ✅ (teto ~52 fps veio da fonte de teste) |
| 4K30 | HEVC sustenta 30 fps; H.264 cai para 1440p por CPU | — | — |
| Opus | mono, DTX, FEC, RED negociado, 64 kbps; mic em silêncio cai para 0,1 kbps | Opus estéreo até 96 kbps | — |

**Rede degradada** (proxy UDP local `scripts/netem/udp-impair.mjs` — aproxima, não substitui rede real; `docs/benchmarks/media-network.md`):
| Cenário | Resultado |
|---|---|
| Voz, 0–10 % perda, RTT 50/150/300 ms ± 30 ms | ≤ 0,5 % ocultado; jitter buffer 82–137 ms |
| Voz, 20 % perda | 0,9–1,4 % ocultado |
| Voz a 10 % perda: RED+FEC / só RED / só FEC / nada | 0,4–1,0 / 0,7–1,2 / 6,0 / 6,3 % ocultado → **RED+FEC+DTX mantidos** (RED dobra a banda de voz 38→76 kbps) |
| Tela 1080p30/60 limpa | 29/50 fps em 1920×1080, sem congelar |
| Tela com RTT 150 ms + 2 % perda | espectador cai para 720p30/360p15 |
| Tela com uplink 3 Mbit/s | 20–23 fps, um congelamento de 3,7–4,5 s (aberto) |
| Tela após queda de 3 s | volta em 0,4–1,6 s |

**Vazamento de memória corrigido:** transceivers do Chromium mantinham encoders vivos após parar a transmissão. Crescimento por ciclo: padrão 20,3 → 1,7 MB, VP9 172 → 0,1 MB (tolerância ≤ 2 MB/ciclo; resíduo ~1,3 MB/ciclo no processo de GPU com HEVC). Também corrigido: HEVC não engatava em janelas menores que o preset (caía para VP8 descartado pelo SFU). Unmute pós-moderação volta em ~1,06 s.

**Interface com 10.010 mensagens** (`docs/benchmarks/ui-performance.md`): reabrir canal 2.156 → 23 ms; página antiga 568 → 20 ms; rolagem 47–57 → 179 fps (tela 180 Hz); sem pulo ao carregar histórico; memória 1.286 → 354 MB; JS na inicialização 3.004 → 1.333 kB; abrir o app → shell ~575 ms; ocioso 10 min: 229–233 MB, 0,01 % CPU. Correção do Maestro: o motor de mídia não inicia mais no boot ao receber o plano (diagnóstico do agente: +70 MB ocioso; **economia não re-medida**). Denunciar mensagem e "Usuário removido" ligados no chat.

**E2EE (spike sem MLS, chaves por remetente, 2 instâncias, HEVC 1080p60):** entrada 130 vs 128 ms (sem mudança); CPU +0,5 %/+0,6 % de um núcleo por faixa de voz (envio/recebimento), tela +2,5 % transmissor / +1,9 % espectador; 55–58 fps sem congelar; cliente sem chave decodificou 0 quadros. **Lacunas do `livekit-client` 2.23 sob E2EE:** desliga RED (ocultação a 10 % de perda sobe de ~1 % para ~6 %; patch de uma linha restaura, +12 kbps) e não publica codec reserva H.264 (espectador sem HEVC fica sem vídeo) → fase 3 do plano.

**Gating por plano (verificado ponta a ponta com billing sandbox):** grátis oferece 720p30/720p60/1080p30 e mostra 1080p60 bloqueado; upgrade durante a live libera em 302 ms (espectador em 1080p em 420 ms); downgrade re-limita em 93 ms sem mute do servidor. 720p60: 51 fps a ~2,8 % CPU. **Congelamento com uplink de 3 Mbit/s:** antes 7/12 execuções com congelamento > 2 s (pior 4,6 s); depois 0/12 (pior 1,2 s) — o espectador desce de camada sozinho. **DTX:** ~1 em 32 entradas volta sem DTX (causa no LiveKit 1.13.11; cliente detecta e republica o mic). Palco: grades equilibradas 3/5/7, transmissão assistida em destaque, mini-player arrastável, toque de chamada sintetizado (nunca ouvido por humano).

Codec de tela: HEVC por GPU quando disponível, H.264 de backup para quem não decodifica HEVC (backup **ainda não exercitado**); H.264 por hardware não engata no Electron 45 (sempre OpenH264). Decisão em `docs/decisions/0001-media-engine.md`.

## Acessibilidade (a9330d4, `docs/accessibility/2026-11-01-audit.md`)
Percursos só por teclado 3/10 → **10/10**; achados da auditoria 31 → 1; regiões ao vivo 2/5 → 5/5 (toasts e entrada/saída na chamada anunciadas); alto contraste (emulação clara do Playwright) 12 estados invisíveis → 0; movimento reduzido já funcionava. Pendentes: teste manual com NVDA/Narrador; rótulo + `aria-pressed` duplicados nos botões de mudo/surdo (precisa mudar junto com os scripts que procuram por texto); temas escuros de alto contraste do Windows não verificados.

## Problemas conhecidos
- Corrigido 2026-11-01: app de dev e app instalado compartilhavam a pasta de dados (token e trava de instância única) → o instalado fechava e focava a janela de dev. Dev agora usa `%APPDATA%\Alga Meet Dev`.
- **Lição do QA:** a flag `--use-fake-device-for-media-stream` troca silenciosamente a captura de tela por uma tela sintética — testes antigos de transmissão nunca capturaram janela real. Testes de tela agora devem rodar o transmissor sem fake devices.
- `livekit-client` (~500 kB) carrega na inicialização (motor de mídia importado no boot) e zod (~55 kB) ainda vai no renderer — exigem carregamento preguiçoso do `media/` e separar constantes/schemas no `@alga/shared`.
- Decisões do Maestro (reversíveis) em 2026-11-01: download de exportação dentro do app exige redigitar a senha (sessão roubada não baixa os dados); denúncia `csam` coloca anexos em quarentena automaticamente, mas legal hold do autor só por decisão de staff (evita uso de denúncias falsas como arma).
- **Bloqueios de conformidade para lançamento** (`docs/legal/review-notes.md`): sem verificação de idade (ECA Digital — idade mínima proposta 16+), sem denúncia/suspensão/apelação, sem processo CSAM, sem exclusão de conta nem exportação de dados (LGPD), sem logs de acesso de 6 meses (Marco Civil), sem registro de aceite de termos, sem DPAs/cláusulas-padrão ANPD com provedores, sem CNPJ/encarregado publicados. Os itens técnicos estão em desenvolvimento; os jurídicos dependem do dono.
- Checagem de qualidade de transmissão confia nas dimensões reportadas pelo cliente (cliente modificado pode burlar); sem reembolso self-service; Pix ainda não em assinaturas.
- PGlite aceita um processo por diretório: dois servidores no mesmo `PGLITE_DIR` travam (`postmaster.pid`). Aconteceu em 2026-11-01 com um servidor órfão de agente — Maestro matou o órfão e removeu o lock.
- E-mail sem retry (falha do provedor só aparece no log); HEIC/TIFF mantêm EXIF; contas não verificadas nunca são limpas.
- Downloads de anexos passam pela API → egress do Railway (US$ 0,05/GB); buckets do Railway não têm backup; uploads > 5 min são cortados pelo Railway.
- Reentrar na mesma sala sem pausa às vezes volta sem DTX (não reproduzido isoladamente); janelas de tamanho ímpar (ex. 1366×705) caem para H.264.
- Pendências de mídia sem evidência: rede real (perda, NAT/TURN, FEC/RED sob perda), máquinas separadas, GPUs AMD/Intel, CPUs fracas, fallback H.264, latência de hardware de áudio, 1440p60 real, teste de escuta prolongado do RNNoise, desconexão física de dispositivo, PTT via hotkey global em chamada.
- Lista de mensagens sem virtualização (históricos muito longos ficam lentos); sem autocomplete de menção nem seletor de emoji; DMs não podem ser fechadas.
- Domínio do link de convite (`https://alga.meet/i/`) é provisório — precisa de domínio real.
- Bundle do renderer ~835 KB (zod do `@alga/shared` entra no renderer).
- Push-to-talk não funciona enquanto um jogo rodando como administrador tem o foco (limite do Windows para hooks de processo não elevado).
- **Sem E2EE de mídia.** Mídia é cifrada só até o SFU (DTLS-SRTP). Discord tem E2EE (DAVE) obrigatório desde 2026-03 → paridade necessária antes de lançamento público.
- Strings da UI direto em pt-BR, sem framework de i18n ainda.
- Anexos/upload de arquivos fora do escopo da primeira fatia.
- Sem permissões por canal (overwrites) ainda; sem verificação de e-mail nem recuperação de senha por e-mail (precisa provedor de e-mail).
- Contadores de rate limit em memória (instância única).
- Estado de voz, conexões do gateway e throttle de digitação em memória → instância única até introduzir Redis pub/sub.
- Testado só em PGlite (Postgres 18 WASM); migração ainda não rodada em Postgres real.

## Bloqueios humanos
| O quê | Por quê | O que fazer | Sem isso |
|---|---|---|---|
| Certificado de assinatura de código (OV/EV ou Azure Trusted Signing) | Windows SmartScreen e confiança do updater | Contratar certificado; fornecer `CSC_LINK`/`CSC_KEY_PASSWORD` ou credenciais Azure | Instalador mostra aviso "editor desconhecido" |
| Domínio próprio (ex. `algameet.com.br`) | URLs estáveis, e-mail, links de convite | Comprar domínio e apontar DNS | Staging fica em `*.up.railway.app` |
| Servidor com UDP para o SFU: VM São Paulo (Vultr ~US$ 40–80/mês + banda) **ou** LiveKit Cloud plano grátis | Railway não expõe UDP | Criar conta Vultr (ou LiveKit Cloud) e autorizar custo | Voz/tela só funcionam em rede local/dev |
| Conta Resend + domínio de envio verificado (DKIM/SPF/DMARC) | E-mails de verificação e reset em produção | Criar conta, configurar DNS (ver `docs/infra/deploy.md`) | Produção não sobe sem provedor de e-mail |
| **Cadastro no sistema Nidus da Polícia Federal (prazo ~meados de dez/2026)** + pessoa credenciada + contato de apoio psicológico | ECA Digital: notificação de crimes contra crianças (Portaria MJSP 1.312) | Cadastrar a empresa, nomear responsáveis (ver `docs/trust-safety/csam-process.md`) | Descumprimento legal no lançamento |
| Busca de marca no INPI para "Alga Meet" + o símbolo Encosto | Evitar conflito de marca antes do lançamento | Fazer a busca (ou contratar) | Risco de ter que trocar nome/marca depois |
| Aprovar preços e planos (`docs/business/monetization.md`) | Decisão comercial | Revisar e aprovar/ajustar | Checkout fica só em sandbox |
| Primeira compra real no Mercado Pago (Plus + cosmético) | Fechar os itens não verificados do adaptador (`monetization.md` §8) | Assinar o Plus no app e pedir o reembolso de 7 dias | MP ligado em 2026-11-08 (`docs/infra/staging.md`), sem pagamento real ainda |
| Contador (Simples Anexo III vs V, NFS-e, ISS, remessas em USD) e advogado (termos, arrependimento 7 dias, compras por menores) | Operar comercialmente no Brasil | Contratar | Lançamento pago bloqueado |
| Cotação escrita Latitude.sh São Paulo (pacote de banda) | O custo recomendado depende dela (US$ 4,9k vs 18,3k/mês a 10k CCU) | Pedir cotação antes da fase 1k CCU | Plano de custo a 1k+ CCU fica incerto |
| Segunda máquina independente | Validar voz/tela entre dispositivos reais e NATs diferentes | Instalar o build em outro PC e entrar num canal | Só temos medições em localhost |

## Direção de design (2026-11-01)
O dono rejeitou o teal ("artificial, robotizado, nada parecido com o Linear") e escolheu **B · Índigo suave** (D10b). Redesenho aplicado em todo o renderer, com comparação lado a lado contra o Linear (`docs/design/compare/`). Critério permanente: *"algo gostoso, sexy, que as pessoas tenham prazer de ver e de utilizar"*.

**Crítica r3 (e786d05):** 7/10 vs Linear, **5/10 em desejo/prazer** ("Discord escuro bem-feito"). Áreas mais fracas: palco de chamada (5; caixas 16:9 vazias), loja/cosméticos (4; sendo refeitos no pacote B), marca (4,5; parece equalizador genérico e se repete ~5× por tela), login (5,5). Movimentos "sexy" propostos: cor vinda das pessoas (tom de cada um no banner e no palco), coreografia + 3 sons suaves ao entrar numa sala, Ctrl+K nascendo da busca da barra de título. Fila: conceitos de marca para o dono escolher (em andamento) → onda de design 9 depois do pacote B (palco só de voz, contenção do índigo, login, menos esqueleto Discord, conteúdo de demonstração digno).

## Próximos passos (fila do Maestro, em ordem)
0. **Pequenos pendentes:** `setZoomFactor` no bridge (zoom da UI), bandeja "respirando" durante voz, avisos de mídia com `kind` (hoje a UI reconhece pelo texto), sessões com dispositivo/Windows no servidor, grades 5/7 recapturadas com 5–7 instâncias.
1. **Aguardando agentes:** mídia onda 3, desempenho da UI e Trust & Safety/LGPD no servidor.
2. **Servidor (fila):** expor papel de staff em `Me`; `staffId` em `AdminAppeal`; eventos de gateway para denúncias/apelações/exportações/usos de convite; visualizador seguro de quarentena; campos de protocolo/recibo CSAM; tela de logs de acesso (staff admin).
3. **Pendências de mídia/servidor:** servidor só checa o preset da transmissão na publicação (downgrade no meio da live depende do cliente) → reavaliar faixas ativas quando `ENTITLEMENTS_UPDATE`; timeout de camada de tela menor na config do LiveKit; repetir o caso DTX num LiveKit mais novo; expor classe de CPU (intel/amd/outra) no bridge para a telemetria; montar o mini-player no `Shell.tsx` (hoje dentro de `IncomingCall`); toasts sobrepõem o botão Desconectar do dock.
4. **Depois do agente de desempenho:** "Denunciar" no menu de contexto das mensagens (`features/chat`). Painel de staff (hoje só API), visualizador seguro de quarentena.
5. **E2EE de mídia** (paridade com DAVE): desenho + protótipo com LiveKit insertable streams; distribuição de chaves sem o servidor conhecer a chave.
6. **Deploy de teste** quando o dono aprovar (Railway + SFU) → teste real entre máquinas e comparação com Discord na mesma rede.
