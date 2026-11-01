# Alga Meet — Arquitetura

> Fonte de verdade das decisões estruturais. Mudou uma decisão? Atualize aqui e registre o porquê em `docs/decisions/`.

## Visão geral

```
┌──────────────── Windows ────────────────┐        ┌──────────── Cloud ─────────────┐
│ Electron (apps/desktop)                 │        │ API + Gateway (apps/server)    │
│  main: janela, tray, hotkeys globais,   │ HTTPS  │  Fastify REST /api/v1          │
│        captura de tela, updater, DPAPI  │◄──────►│  WebSocket /gateway            │
│  preload: window.alga (bridge tipado)   │  WSS   │  PostgreSQL (Drizzle)          │
│  renderer: React + design system        │        │  emite tokens LiveKit          │
│    media/: LiveKit client (voz + tela)  │        └──────────────┬─────────────────┘
└──────────────┬──────────────────────────┘                       │ webhooks (assinados)
               │ WebRTC (DTLS-SRTP, UDP; fallback TCP/TURN-TLS)   ▼
               └──────────────────────────────────►  LiveKit SFU (infra/livekit)
```

## Decisões

| # | Decisão | Por quê | Alternativas rejeitadas |
|---|---|---|---|
| D1 | **Electron** para o desktop | Stack WebRTC do Chromium (AEC3, NS, AGC2, Opus FEC/DTX/RED, simulcast, H.264 por hardware via Media Foundation, VP9/AV1 SVC), `desktopCapturer` + `setDisplayMediaRequestHandler` com áudio *loopback* no Windows, NSIS + `electron-updater` maduros. O próprio Discord é Electron + módulos nativos. | Tauri/WebView2 (sem controle do picker de captura nem loopback de áudio); nativo C++/WinUI (meses até paridade de mídia). |
| D2 | **LiveKit SFU** auto-hospedado (Go, Apache-2.0) | SFU maduro: simulcast, dynacast, adaptive stream, Opus RED, TURN embutido, webhooks, E2EE via insertable streams. Mesmo protocolo funciona com LiveKit Cloud se precisarmos terceirizar. | mediasoup (mais código próprio), Janus, P2P mesh (não escala além de ~4). |
| D3 | **SFU fora do Railway** | Railway não expõe faixas UDP; mídia precisa de UDP. API/Postgres podem ficar no Railway. | — (ver `docs/infra/cost-model.md`) |
| D4 | **Node 24 + Fastify + Drizzle + PostgreSQL** | TypeScript ponta a ponta com `@alga/shared`; Drizzle gera SQL previsível. Em dev usamos **PGlite** (Postgres em WASM, zero instalação) com o mesmo schema/dialeto. | Prisma (runtime pesado), SQLite (dialeto diferente da produção). |
| D5 | **Sessões opacas** (token aleatório 256 bits, servidor guarda só SHA-256) + **argon2id** | Revogação imediata (logout remoto, troca de senha), sem segredo de assinatura para vazar. Token no cliente cifrado com DPAPI (`safeStorage`). | JWT (revogação difícil). |
| D6 | **Gateway WebSocket próprio** com snapshot `READY` + eventos | Simples, debugável, contrato em `packages/shared/src/gateway.ts`. Escala horizontal futura via Redis pub/sub (não necessário até ~10k conexões por instância). | Socket.IO (camada extra sem ganho). |
| D7 | **Estado de voz autoritativo no servidor via webhooks do LiveKit** (`participant_joined/left`) + flags do cliente (`mute/deaf/streaming`) pelo gateway | Quem está na sala vem do SFU, não da palavra do cliente. | Cliente reportar entrada/saída (mente/perde estado ao cair). |
| D8 | IDs **UUIDv7** | Ordenáveis por tempo (paginação de mensagens por id), sem coordenação. | Snowflake (precisa worker id). |
| D9 | Monorepo **npm workspaces** | Sem surpresas com electron-builder (pnpm exige hoisting). | pnpm. |
| D10 | UI: **React 19 + CSS próprio com tokens** (CSS variables), `motion` para animações com física, `lucide-react` para ícones, **Inter Variable** empacotada | Design system próprio, sem biblioteca de componentes genérica. | Tailwind/shadcn (estética genérica, pedido explícito para evitar). |
| D10b | **Direção visual B · "Índigo suave" (2026-11-01, escolha do dono)**: linguagem visual do Linear — neutros quase pretos, cor rara, acento índigo suave e dessaturado — substitui a identidade "Bioluminescência" (teal) | O dono rejeitou o teal como artificial/robótico e "nada parecido com o Linear". Objetivo declarado: *"algo gostoso, sexy, que as pessoas tenham prazer de ver e de utilizar"*. Toda tela é comparada lado a lado com o Linear. | Teal/ciano (rejeitado); grafite monocromático e âmbar quente (opções A e C, não escolhidas). |
| D11 | **Tiers de transmissão (proposta, validar no beta):** grátis = **1080p30 e 720p60**; assinatura = 1080p60, 1440p60, 4K30 | Grátis já supera o Discord grátis (720p30). Custo: mix "tudo liberado" custa ~2,1× o mix freemium em egress de vídeo (`docs/infra/cost-model.md` §3.3); 1080p30 grátis fica no meio (~+25–30%) e o simulcast faz espectadores em miniatura puxarem camadas baixas. | Tudo grátis (inviável por GB); 720p30 grátis (sem diferencial). |
| D12 | **Voz igual para todos:** padrão 64 kbps mono Opus + DTX + RED; admins do espaço podem subir até 128 kbps sem pagar | Voz é a proposta central; fala satura perto de 48–64 kbps, então o custo médio quase não muda. Nunca degradar voz grátis para forçar conversão. | Bitrate de voz como benefício pago (Discord). |
| D13 | **Infra de mídia por fase:** dev local → beta com 1 VM em São Paulo (Vultr) → 1k CCU com 2× bare metal São Paulo (Latitude.sh) → colocation com IX.br em 100k | Usuários no Brasil: SFU fora de SP = +110–300 ms. Provedores cobrando por GB (AWS/GCP/LiveKit Cloud) inviabilizam transmissão grátis. Ver `docs/infra/cost-model.md`. | LiveKit Cloud/AWS (US$ 22k+/mês a 1k CCU). |

## Pastas

```
packages/shared   contrato: modelos, REST (zod), gateway, permissões, uuidv7
apps/server       API + gateway + integração LiveKit (tokens, webhooks)
apps/desktop      Electron
  src/shared/bridge.ts   contrato main<->renderer (window.alga)
  src/main               processo principal (nativo)
  src/preload            implementa o bridge via IPC
  src/renderer/src       React
    media/               motor de voz e transmissão (LiveKit client)
infra/livekit     config do SFU (dev/prod) e binário (baixado + checksum)
scripts           dev.mjs (sobe tudo), livekit.mjs
docs              arquitetura, estado, pesquisa, referências, decisões, screenshots
```

## Segurança (garantias reais — não anunciar além disso)
- Transporte: HTTPS/WSS para API; mídia com **DTLS-SRTP** (cifrada entre cliente e SFU). O SFU **pode** ver mídia em claro. **Não há E2EE ainda.** O Discord tem E2EE (DAVE/MLS) obrigatório desde 2026-03 — E2EE é item de roadmap prioritário (ver `docs/STATE.md`).
- Renderer: `sandbox`, `contextIsolation`, sem `nodeIntegration`, CSP restritiva, nenhuma captura de tela sem ação explícita do usuário no picker.
- Senhas argon2id; tokens de sessão só como hash no banco; rate limit em auth.

## Como rodar
Ver `README.md`.
