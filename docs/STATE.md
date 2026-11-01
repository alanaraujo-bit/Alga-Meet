# Alga Meet — Estado do projeto

> Fonte de verdade. Só entra como "Validado" o que tem evidência (teste, medição, screenshot). Atualizado: 2026-11-01.

## Versão executável
- Dev: `npm install && npm run dev` (ver `README.md`). Multiusuário local: `npm run dev -- --profiles=bob`.
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
| UI onda 2 (chamada, transmissão, configurações, correções da crítica) | `apps/desktop/src/renderer` (exceto `media/`) | em andamento |
| Motor de mídia | `apps/desktop/src/renderer/src/media`: voz (Opus/DTX/RED, RNNoise, PTT, dispositivos) + transmissão (codecs, presets, áudio do sistema) + benchmarks | em andamento |
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
- Backend: 47 testes vitest (PGlite em memória, REST via inject + gateway via WebSocket real) passando, conferido pelo Maestro. Smoke test com LiveKit real: webhooks `room_started/finished` e `participant_joined/left` reais recebidos e assinatura verificada; `VOICE_STATE_UPDATE/REMOVE` entregues no gateway.

## Pesquisa concluída
- `docs/research/discord-benchmark.md` — barra a superar (fatos/medições/relatos separados). Medido: Discord ocioso na bandeja = 6 processos, ~808 MB de memória privada.
- `docs/research/linear-design-study.md` — princípios + tokens propostos; identidade "Bioluminescência" (acento teal-ciano H≈195°, brilho de fala segue o nível de áudio). Capturas de referência ficam só locais (`docs/references/`, fora do git por direitos autorais).
- `docs/infra/cost-model.md` — Railway sem UDP (confirmado); ~US$ 0,93k–1,98k/mês por 1k CCU com SFU em São Paulo; provedores por GB inviabilizam stream grátis. Decisões D11–D13 em `ARCHITECTURE.md`.

## Qualidade (voz / transmissão / interface / desempenho)
Sem medições ainda. Metas iniciais (de `discord-benchmark.md`): stream 1080p60 grátis com encode por hardware; RAM ociosa ≤ 300 MB; voz ≥ paridade Opus 64–128 kbps com DTX+RED.

## Problemas conhecidos
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
| Servidor com UDP para o SFU (VPS) | Railway não expõe UDP | Escolher provedor (ver `docs/infra/cost-model.md`) e autorizar custo | Voz/tela só funcionam em rede local/dev |
| Cotação escrita Latitude.sh São Paulo (pacote de banda) | O custo recomendado depende dela (US$ 4,9k vs 18,3k/mês a 10k CCU) | Pedir cotação antes da fase 1k CCU | Plano de custo a 1k+ CCU fica incerto |
| Segunda máquina independente | Validar voz/tela entre dispositivos reais e NATs diferentes | Instalar o build em outro PC e entrar num canal | Só temos medições em localhost |

## Próximos passos
1. Integrar backend + nativo + mídia; rodar o fluxo ponta a ponta com dois perfis.
2. Design system e telas (após estudo do Linear), com ciclo de screenshots e crítica.
3. Primeiro build instalável para o usuário testar.
