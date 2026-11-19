# Alga Meet PWA — desenho

Data: 2026-11-19. Branch `feat/pwa` (worktree `.claude/worktrees/pwa`).

## Intenção

Pedido do dono: uma versão PWA do Alga Meet para quem não tem PC (celular, tablet, qualquer navegador). Apesar de ser
web, **o foco é parecer ao máximo um app nativo**, porque depois virão Android e iOS e este é o primeiro passo. A
experiência tem de ser "foda": bonita, gostosa, fluida, rápida, responsiva, e com **todas as funções do desktop**, ou
uma alternativa clara onde o navegador não deixa.

Sucesso: instalar pelo navegador do celular, abrir em tela cheia como app, entrar numa call, conversar, ver a
transmissão de um amigo, assistir ao cinema, entrar no Mundo, receber notificação com o app fechado. Tudo isso
sentindo-se num app, não num site.

## Metas, não-metas, anti-metas

- **Metas:** PWA instalável (manifest, service worker, ícones, splash, standalone, safe areas); navegação mobile de app
  nativo; layout responsivo do celular ao desktop; tema claro e escuro; Web Push; cada função do desktop presente ou
  com caminho honesto; verificado com os próprios olhos (painel de navegador, viewport mobile e desktop, claro e escuro)
  e com testes e typecheck passando.
- **Não-metas:** apps Android/iOS nativos (próximo passo); E2EE no navegador (desligado em produção hoje, ver abaixo);
  projetar arquivo no cinema pelo navegador; transmitir tela pelo celular.
- **Anti-metas (falha mesmo funcionando):** parecer um site encolhido (barra de rolagem da página, zoom de pinça, toque
  com atraso, piscar azul do toque, texto selecionável nos botões, teclado cobrindo o campo); um fork do renderer que
  envelhece separado do desktop; qualquer mudança visível no app desktop que o dono não aprovou (o desktop continua
  escuro por padrão); subir algo para produção sem o aval dele.

## Restrições

- Não publicar nada (Railway, Vercel, domínio, release) sem o aval explícito do dono, um de cada vez.
- `npm run dev` não sobe a API nesta máquina: testar contra a pilha isolada (`apps/desktop/scripts/qa-stack.mjs`).
- Voz: o SFU de produção roda no PC do dono; nunca subir uma segunda cópia (a pilha isolada tem o próprio LiveKit).
- Editar arquivos com a ferramenta Edit (PowerShell corrompe `${}` e crases).
- A API só aceita origens em `CORS_ORIGINS` (em dev já aceita `http://localhost:5173`); o gateway autentica pelo frame
  `identify` (sem cabeçalho), então funciona no navegador. `X-Alga-Client` já está em `allowedHeaders`.

## Abordagens consideradas

1. **Escolhida: um app `apps/web` que reaproveita o renderer do desktop.** Vite + React, com alias `@` para
   `apps/desktop/src/renderer/src`. Antes de montar o `App`, instala em `window.alga` uma implementação web da
   `AlgaBridge` (`apps/desktop/src/shared/bridge.ts`). Só 50 arquivos do renderer falam com o Electron, todos por essa
   ponte. Toda função nova do desktop chega ao PWA sem trabalho dobrado, e o mesmo pacote web vira o Android/iOS
   depois (Capacitor envolve um app web).
2. Reescrever em React Native/Expo agora: descartada. Reescreve tudo, perde funções, e o PWA viraria um terceiro
   código.
3. Fork do renderer dentro de `apps/web`: descartada. Envelhece separado do desktop no primeiro mês.

## Decisões do dono (2026-11-18)

- **Navegação mobile A, "abas + pilha"**: abas embaixo (Espaços, Conversas, Amigos, Você); telas entram da direita;
  arrastar da borda esquerda volta; a call é uma tela cheia que encolhe numa pílula flutuante.
- **Tema claro agora**, seguindo o claro/escuro do aparelho.
- **Web Push nesta leva**, com a subida para produção esperando o aval dele.

## Como funciona

### 1. Estrutura

- `apps/web/` (workspace npm novo): `index.html`, `vite.config.ts`, `src/main.tsx` (instala a ponte, registra o
  service worker, importa o `App` do desktop), `src/bridge/*` (implementação web da ponte), `src/sw.ts` (service
  worker), `public/` (manifest, ícones, splash).
- O plugin do LiveKit (RED sob E2EE) sai de `electron.vite.config.ts` para um arquivo compartilhado
  (`apps/desktop/build/livekit-red.ts` ou similar) usado pelos dois builds.
- `AppConfig` ganha `shell: 'electron' | 'web'`. As telas perguntam **capacidades**, não a plataforma:
  `window.alga.caps` (ex.: `screenShare: 'picker' | 'browser' | 'none'`, `cinemaHost`, `globalHotkeys`, `tray`,
  `activityDetection`, `musicPopout`, `startAtLogin`, `updates: 'electron' | 'sw'`). O preload do Electron devolve tudo
  ligado como hoje; a ponte web liga o que o navegador permite.
- O **layout compacto** é decidido por largura (`(max-width: 760px)`), não pela plataforma: o navegador do desktop
  estreito também vira mobile; o Electron nunca fica tão estreito (largura mínima da janela) e não muda.

### 2. Ponte web (`window.alga`), função por função

| Ponte | No navegador |
|---|---|
| `config` | `apiUrl`/`gatewayUrl` de variável de build (`VITE_API_URL`), `version` do package, `platform` derivado do user agent, `osVersion` ("Android 15", "iOS 18", "Windows"…), `shell: 'web'` |
| `auth` token | `localStorage` (a CSP sem script inline segura o risco de XSS) |
| `window.*` | sem efeito; `setBadge` → `navigator.setAppBadge`; zoom guardado em `localStorage` e aplicado no `html` (só desktop) |
| `musicPop` | Document Picture-in-Picture onde existe (Chrome desktop); senão o botão some |
| `screen` | sem seletor próprio: `getDisplayMedia` com o seletor do navegador (computador); no celular a opção some e aparece "Transmitir tela só pelo computador" |
| `hotkeys` | teclas com a aba em foco (mapa `KeyboardEvent.code` ↔ código uiohook para reaproveitar os binds); no celular um botão "segure para falar" na call |
| `notify` | `ServiceWorkerRegistration.showNotification`; clique foca o app no canal |
| `tray` | sem bandeja; a pílula da call e a Media Session (controles na tela de bloqueio: mutar, sair) cumprem o papel |
| `power` | `visibilitychange` + `online` → `onResume` depois de muito tempo oculto |
| `updates` | service worker novo esperando → `ready`; `install()` → `skipWaiting` e recarrega |
| `deepLinks` | lidos da URL na abertura (`/i/:code`, `/auth/verify-email?token=`, `/auth/reset-password?token=`), depois `history.replaceState` apaga o token |
| `e2ee` | `status` = `off` (igual aos builds de produção, que só ligam com `ALGA_E2EE=1`); `cinemaTag` = `null` |
| `cinema` (projetar) | `checkFfmpeg` diz indisponível; a UI troca "Projetar" por "Projetar um filme só pelo app do computador". **Assistir** funciona (a poltrona recebe peças pelo WebRTC e toca com MSE; no iPhone, que não tem `MediaSource`, usar `ManagedMediaSource`) |
| `activity` | nada detectado; a seção "Atividade" das configurações some; as atividades dos amigos continuam aparecendo |
| `app` | iniciar com o sistema, fechar para bandeja e animação da bandeja somem; `openExternal` → `window.open`; `recentLog` → últimas linhas do console guardadas em memória; `captureWindow`/`takeCrash` → `null`; `quit` sem efeito |

### 3. Navegação mobile (layout compacto)

- `features/mobile/` no renderer: `MobileShell` (substitui o `Shell` no compacto), `TabBar`, `Stack` (pilha de telas
  com transição de entrada pela direita e gesto de voltar pela borda, com a lib `motion` que já está no projeto),
  `CallSheet` (call em tela cheia que encolhe numa pílula ao arrastar para baixo), `Sheet` (modais viram folhas que
  sobem de baixo).
- As telas reaproveitam os componentes do desktop (canal de texto, palco da call, lista de membros, perfil, loja,
  configurações); o que muda é a moldura e o tamanho dos alvos de toque (mínimo 44 px).
- Abas: **Espaços** (lista de espaços → canais → canal), **Conversas** (DMs), **Amigos**, **Você** (perfil,
  configurações, loja/Plus). Contadores de não lidas nas abas.
- Menu de contexto do desktop (botão direito) vira toque longo com folha de ações.
- URL acompanha a pilha (`history.pushState`), então o botão voltar do Android e o gesto do iOS fazem o certo.

### 4. Sensação de app nativo

- `viewport-fit=cover`, `env(safe-area-inset-*)` em barras e folhas, `100dvh`, `overscroll-behavior: none`, sem zoom
  de pinça na moldura, sem `-webkit-tap-highlight-color`, `user-select: none` fora do texto de mensagens,
  `touch-action` certo nos gestos.
- Teclado: o compositor acompanha `visualViewport` para nunca ficar coberto.
- Transições de 200–300 ms com curvas de mola; respeita `prefers-reduced-motion`.
- Vibração curta (`navigator.vibrate`, Android) em ações como mutar e segurar para falar.
- Splash: a `BootSplash` que já existe + `background_color`/ícones no manifest + `apple-touch-startup-image` no iOS.
- Convite para instalar: `beforeinstallprompt` no Android/Chrome; no iOS uma folha explicando "Compartilhar → Adicionar
  à Tela de Início" (só no Safari, só uma vez, dispensável).

### 5. Tema claro

- `styles/tokens.css` ganha `:root[data-theme="light"]` com todos os tokens de superfície, texto, borda, estado e
  acento recalculados na mesma linguagem (OKLCH, indigo suave), com contraste verificado em `tokens.test.ts`.
- As ~785 cores literais nos CSS modules: as que são superfície, texto ou borda viram tokens; as que ficam sobre vídeo
  ou sobre a cena 3D (scrims, rótulos sobre câmera) continuam fixas de propósito.
- Configurações › Aparência: **Sistema / Escuro / Claro**. Padrão **Sistema no PWA** e **Escuro no desktop** (o desktop
  não muda para ninguém sem o dono decidir). `meta theme-color` acompanha o tema.
- A cena 3D do Mundo mantém a própria luz; só a interface por cima muda.

### 6. Web Push (servidor + service worker)

- Servidor: dependência `web-push` (VAPID); variáveis `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
  (sem elas o push fica desligado e o resto funciona); migração `push_subscriptions` (usuário, endpoint único, chaves
  `p256dh`/`auth`, criado, último uso); rotas `GET /api/v1/push/key`, `POST /api/v1/push/subscriptions`,
  `DELETE /api/v1/push/subscriptions`. Assinatura que o serviço de push responde 404/410 é apagada.
- Quando manda: DM recebida, menção, `CALL_RING`. Mesmo critério de quem receberia o aviso no desktop. O payload vai
  cifrado pelo padrão Web Push; leva só o necessário (quem, onde, um trecho curto).
- Service worker: mostra a notificação **só se nenhuma janela do app estiver em foco**; respeita os silenciamentos que
  a página espelha num IndexedDB pequeno (as preferências de aviso hoje vivem no aparelho); clique abre ou foca o app
  no canal certo.
- iOS só entrega push para PWA instalado (16.4+), e a permissão precisa vir de um toque: o pedido fica num botão
  ("Ativar notificações") e não aparece sozinho.

### 7. Funções por plataforma (o que a pessoa vê)

- **Iguais:** chat, DMs, amigos, espaços, perfil, loja/Plus, soundboard, música (player do YouTube; no iOS o primeiro
  play pede um toque), voz e vídeo, assistir transmissão, assistir cinema, Mundo com sinuca e dominó.
- **Mundo no celular:** joystick virtual e arrastar para olhar; densidade de pixels e sombras reduzidas; sinuca e
  dominó por toque (eles já usam ponteiro).
- **Só no computador (com aviso claro):** transmitir tela pelo celular, projetar filme no cinema, detecção de atividade.
- **Viram outra coisa:** atalhos globais → tecla com a aba em foco ou "segure para falar"; bandeja → pílula da call e
  tela de bloqueio; atualização automática → aviso "nova versão".

### 8. Testes e verificação

- Vitest: ponte web (deep links, mapa de teclas, capacidades), regras do push no servidor, contraste do tema claro.
- Typecheck dos pacotes (`shared`, `desktop`, `server`, `web`).
- Pilha isolada (`qa-stack.mjs start`) + `vite` do `apps/web` em `localhost:5173`; olhar no painel de navegador
  embutido em viewport de celular (375×812) e desktop, claro e escuro, com screenshots mostradas ao dono durante o
  trabalho. Um script Playwright (`apps/web/scripts/*.mjs`) para a jornada: entrar, canal, call entre dois navegadores,
  instalar (manifest/SW válidos pelo Lighthouse PWA).
- Testes do desktop continuam passando (o renderer é o mesmo).

## Hospedagem (fica para a hora de subir, com o aval do dono)

O PWA é estático. Proposta: um projeto Vercel próprio (ex.: `app.` no domínio do site), ou um caminho no site atual.
Subir exige, no Railway: a origem nova em `CORS_ORIGINS`, as chaves VAPID, e `EMAIL_LINK_URL` apontando para o PWA
(hoje é `algameet://auth`, que não abre num celular sem o app). Nada disso é feito sem a palavra dele.

## Deixado para quem constrói

- Nomes de arquivos e componentes; a divisão em commits.
- Service worker escrito à mão (precache dos assets com hash gerados pelo build) em vez de uma lib, se ficar pequeno.
- A ordem: casca PWA e ponte → navegação mobile → tema claro → push → Mundo no toque → polimento.
