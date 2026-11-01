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
| Mídia onda 2 (vazamento, unmute, rede degradada) | `media/` | **feito** — ver Qualidade |
| Mídia onda 3 (gating por plano, 720p60, palco: grade/destaque/mini-player/toque, congelamento em 3 Mbit/s, DTX ao reentrar) | `media/`, `features/voice` | em andamento |
| Desempenho da UI (virtualização, bundle, tamanhos de janela, ociosidade) | `features/chat`, config Vite | em andamento |
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
| Servidor: complementos de T&S (status de exportação, resumo de mudanças legais, datas de restrição, denúncia duplicada, revisão de rate limit) | `apps/server` | em andamento |
| Desenho de E2EE (`docs/decisions/0004-e2ee.md`) | docs | em andamento |
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

Codec de tela: HEVC por GPU quando disponível, H.264 de backup para quem não decodifica HEVC (backup **ainda não exercitado**); H.264 por hardware não engata no Electron 45 (sempre OpenH264). Decisão em `docs/decisions/0001-media-engine.md`.

## Problemas conhecidos
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
| Repositório GitHub de releases `alanaraujo-bit/alga-meet` | Canal do auto-update. Precisa ser **público** (ou um repo público só de releases), senão o app teria que embutir um token | Autorizar criação | Auto-update não tem de onde baixar |
| Deploy de teste: API+Postgres no Railway (~US$ 9–21/mês no beta) + domínio | Testar entre PCs diferentes | Autorizar criação no Railway; comprar/definir domínio | Só funciona nesta máquina |
| Servidor com UDP para o SFU: VM São Paulo (Vultr ~US$ 40–80/mês + banda) **ou** LiveKit Cloud plano grátis | Railway não expõe UDP | Criar conta Vultr (ou LiveKit Cloud) e autorizar custo | Voz/tela só funcionam em rede local/dev |
| Conta Resend + domínio de envio verificado (DKIM/SPF/DMARC) | E-mails de verificação e reset em produção | Criar conta, configurar DNS (ver `docs/infra/deploy.md`) | Produção não sobe sem provedor de e-mail |
| **Cadastro no sistema Nidus da Polícia Federal (prazo ~meados de dez/2026)** + pessoa credenciada + contato de apoio psicológico | ECA Digital: notificação de crimes contra crianças (Portaria MJSP 1.312) | Cadastrar a empresa, nomear responsáveis (ver `docs/trust-safety/csam-process.md`) | Descumprimento legal no lançamento |
| Aprovar preços e planos (`docs/business/monetization.md`) | Decisão comercial | Revisar e aprovar/ajustar | Checkout fica só em sandbox |
| Conta Mercado Pago (CNPJ) + `MP_ACCESS_TOKEN`/`MP_WEBHOOK_SECRET` + URL de webhook + página https de retorno | Cobrar de verdade | Criar conta, gerar credenciais, configurar webhook | Sem pagamentos reais |
| Contador (Simples Anexo III vs V, NFS-e, ISS, remessas em USD) e advogado (termos, arrependimento 7 dias, compras por menores) | Operar comercialmente no Brasil | Contratar | Lançamento pago bloqueado |
| Cotação escrita Latitude.sh São Paulo (pacote de banda) | O custo recomendado depende dela (US$ 4,9k vs 18,3k/mês a 10k CCU) | Pedir cotação antes da fase 1k CCU | Plano de custo a 1k+ CCU fica incerto |
| Segunda máquina independente | Validar voz/tela entre dispositivos reais e NATs diferentes | Instalar o build em outro PC e entrar num canal | Só temos medições em localhost |

## Próximos passos (fila do Maestro, em ordem)
1. **Aguardando agentes:** mídia onda 3, desempenho da UI e Trust & Safety/LGPD no servidor.
2. **UI onda 6:** equipar cosméticos (`PUT /users/@me/cosmetics`) e renderizar cosméticos dos outros (`PublicUser.cosmetics` via `USER_UPDATE`), `INVITE_CREATE/DELETE` na lista de convites (tirar o polling), botão "retomar renovação", interruptor de telemetria (`PATCH telemetryOptIn`), "Denunciar" no menu das mensagens, painel de staff.
3. **Mídia onda 3:** `ScreenPicker` bloquear presets fora de `VoiceJoinResponse.streamPresets` (dica Alga Plus → `openSettings('plan')`), re-limitar camada publicada quando o plano muda em chamada, preset `720p60` (grátis), apelidos no `CallStage.tsx:167` (`displayName(st, id, spaceId)`), grade de 3 tiles, destaque da transmissão, mini-player ao sair do palco, som de toque. Depois: **E2EE** (paridade com DAVE do Discord) — desenho + protótipo.
4. **Depois do agente de desempenho:** "Denunciar" no menu de contexto das mensagens (`features/chat`). Painel de staff (hoje só API), visualizador seguro de quarentena.
5. **E2EE de mídia** (paridade com DAVE): desenho + protótipo com LiveKit insertable streams; distribuição de chaves sem o servidor conhecer a chave.
6. **Deploy de teste** quando o dono aprovar (Railway + SFU) → teste real entre máquinas e comparação com Discord na mesma rede.
