# Alga Meet

Voz, transmissão de tela e comunidades para Windows — construído para ser a casa diária de grupos de amigos.

> Estado real do projeto: [`docs/STATE.md`](docs/STATE.md) · Arquitetura: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · Retomar trabalho: [`docs/MAESTRO.md`](docs/MAESTRO.md)

## Requisitos
- Windows 10 2004+ / 11 (x64)
- Node.js 24+, npm 11+

## Rodar tudo localmente (dev)
```bash
npm install
npm run dev
```
Sobe o SFU LiveKit local (baixa o binário fixado na primeira vez e confere o SHA-256), a API em `http://localhost:4000` e o app desktop com hot reload.

Testar com mais de um usuário na mesma máquina (cada perfil tem dados e login próprios):
```bash
npm run dev -- --profiles=bob,carol
```

Peças isoladas:
```bash
npm run dev:livekit
npm run dev:server
npm run dev:desktop
```

## Testes e checagens
```bash
npm run typecheck
npm test
```

## Instalador Windows
```bash
npm run dist:win
```
Gera `apps/desktop/release/AlgaMeet-Setup-<versão>.exe` (NSIS, por usuário, sem admin). Sem certificado de assinatura ainda — o SmartScreen vai avisar (ver `docs/STATE.md` → Bloqueios humanos).

## Estrutura
| Pasta | O que é |
|---|---|
| `packages/shared` | Contrato único: modelos, rotas REST (zod), protocolo do gateway, permissões |
| `apps/server` | API Fastify + gateway WebSocket + integração LiveKit |
| `apps/desktop` | App Electron (main nativo, preload, renderer React) |
| `infra/livekit` | Config do SFU |
| `docs` | Estado, arquitetura, decisões, pesquisa, benchmarks, screenshots |
