# Alga Meet — Estado do projeto

> Fonte de verdade. Só entra como "Validado" o que tem evidência (teste, medição, screenshot). Atualizado: 2026-11-01.

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
| Mídia onda 2 (vazamento de memória, pedidos da UI, rede degradada) | `media/` | em andamento |
| Motor de mídia onda 1 | `apps/desktop/src/renderer/src/media` | **feito** — ver Validado e Qualidade |
| Backend onda 3 (anexos/avatares, Postgres real, pacote de deploy) | `apps/server`, `infra/` | **feito** — ver Validado |
| Backend onda 4 (EXIF/GPS, verificação de e-mail, reset de senha) | `apps/server` | **feito** — ver Validado |
| Nativo onda 2 (deep links `algameet://`, notificação/badge/iniciar com Windows verificados) | `src/main`, `preload` | em andamento |
| UI onda 3 (anexos, avatares, configurações do espaço: cargos/membros/banimentos) | `apps/desktop/src/renderer` (exceto `media/`, `features/voice`) | em andamento |
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

Codec de tela: HEVC por GPU quando disponível, H.264 de backup para quem não decodifica HEVC (backup **ainda não exercitado**); H.264 por hardware não engata no Electron 45 (sempre OpenH264). Decisão em `docs/decisions/0001-media-engine.md`.

## Problemas conhecidos
- E-mail sem retry (falha do provedor só aparece no log); HEIC/TIFF mantêm EXIF; contas não verificadas nunca são limpas.
- Downloads de anexos passam pela API → egress do Railway (US$ 0,05/GB); buckets do Railway não têm backup; uploads > 5 min são cortados pelo Railway.
- **Memória do renderer cresceu com transmissões repetidas no mesmo processo (143 → 889 MB com VP8/VP9/AV1)** — investigar vazamento antes de liberar para usuários.
- Pendências de mídia sem evidência: rede real (perda, NAT/TURN, FEC/RED sob perda), máquinas separadas, GPUs AMD/Intel, CPUs fracas, fallback H.264, latência de hardware de áudio, 1440p60 real, teste de escuta prolongado do RNNoise, desconexão física de dispositivo, PTT via hotkey global em chamada.
- Lista de mensagens sem virtualização (históricos muito longos ficam lentos); sem autocomplete de menção nem seletor de emoji; DMs não podem ser fechadas.
- Domínio do link de convite (`https://alga.meet/i/`) é provisório — precisa de domínio real.
- Bundle do renderer ~835 KB (zod do `@alga/shared` entra no renderer).
- Push-to-talk não funciona enquanto um jogo rodando como administrador tem o foco (limite do Windows para hooks de processo não elevado).
- Notificação nativa, badge da barra de tarefas e iniciar com o Windows ainda não verificados visualmente.
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
| Repositório GitHub de releases `alanaraujo-bit/alga-meet` | Canal do auto-update. Precisa ser **público** (ou um repo público só de releases), senão o app teria que embutir um token | Autorizar criação | Auto-update não tem de onde baixar |
| Deploy de teste: API+Postgres no Railway (~US$ 9–21/mês no beta) + domínio | Testar entre PCs diferentes | Autorizar criação no Railway; comprar/definir domínio | Só funciona nesta máquina |
| Servidor com UDP para o SFU: VM São Paulo (Vultr ~US$ 40–80/mês + banda) **ou** LiveKit Cloud plano grátis | Railway não expõe UDP | Criar conta Vultr (ou LiveKit Cloud) e autorizar custo | Voz/tela só funcionam em rede local/dev |
| Conta Resend + domínio de envio verificado (DKIM/SPF/DMARC) | E-mails de verificação e reset em produção | Criar conta, configurar DNS (ver `docs/infra/deploy.md`) | Produção não sobe sem provedor de e-mail |
| Cotação escrita Latitude.sh São Paulo (pacote de banda) | O custo recomendado depende dela (US$ 4,9k vs 18,3k/mês a 10k CCU) | Pedir cotação antes da fase 1k CCU | Plano de custo a 1k+ CCU fica incerto |
| Segunda máquina independente | Validar voz/tela entre dispositivos reais e NATs diferentes | Instalar o build em outro PC e entrar num canal | Só temos medições em localhost |

## Próximos passos
1. Integrar backend + nativo + mídia; rodar o fluxo ponta a ponta com dois perfis.
2. Design system e telas (após estudo do Linear), com ciclo de screenshots e crítica.
3. Primeiro build instalável para o usuário testar.
