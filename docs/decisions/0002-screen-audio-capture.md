# 0002 — Captura de tela e de áudio do sistema (sem eco da chamada)

- Status: **aceita** (2026-11-01)
- Escopo: `apps/desktop/src/main/capture.ts`, `src/main/security.ts`, contrato `window.alga.screen` (`src/shared/bridge.ts`)

## Problema

Ao transmitir a tela com "áudio do sistema", o Windows entrega via WASAPI *loopback* **tudo** o que sai no dispositivo de reprodução, inclusive a própria chamada de voz do Alga Meet. Quem assiste ouviria as vozes da call de volta (eco), e quem fala ouviria a si mesmo com atraso. O Discord resolve isso capturando por processo.

## O que foi medido (Electron 45.2.1 / Chromium 156.0.8078.75, Windows 11 26300)

Script reproduzível: `apps/desktop/scripts/loopback-probe.mjs` (`npx electron scripts/loopback-probe.mjs`).
A página do probe toca um tom de **1000 Hz** dentro do Electron (simula a chamada). Ao mesmo tempo, um **outro processo** (PowerShell `[console]::beep`) toca **1500 Hz** (simula um jogo). Em seguida o probe chama `getDisplayMedia` com o handler devolvendo `audio: 'loopback'` e mede as duas frequências na faixa capturada.

| Execução | `deviceId` da faixa | Nosso tom (1000 Hz) | Outro processo (1500 Hz) |
|---|---|---|---|
| `audio: true` | `loopback` | **−56 dB** (capturado = eco) | −25 dB |
| `audio: { restrictOwnAudio: true }` | `loopbackWithoutChrome` | **−80 dB** | −23 dB |
| controle: sem tom nosso, `audio: true` | `loopback` | **−80 dB** (piso nessa frequência com o beep tocando) | −24 dB |

Leitura dos dados:
- Com `restrictOwnAudio` o bin de 1000 Hz fica **igual ao controle sem tom nenhum**. Nosso áudio foi totalmente excluído.
- O áudio de outros processos continua intacto.
- `navigator.mediaDevices.getSupportedConstraints().restrictOwnAudio === true`.
- O resultado é o mesmo com e sem `--enable-features=RestrictOwnAudio`. A feature já vem ligada por padrão nesta versão do Chromium.

### Opções avaliadas

| Opção | Resultado |
|---|---|
| `audio: 'loopback'` (padrão do Electron) | Captura tudo, inclusive a call → eco. |
| `audio: 'loopbackWithMute'` | Captura tudo **e silencia a saída local** enquanto transmite: o usuário deixa de ouvir a call. Inaceitável. |
| `audio: 'loopbackWithoutChrome'` direto no handler | O Electron recusa: `audio must be a WebFrameMain, "loopback" or "loopbackWithMute"`. |
| **Constraint `restrictOwnAudio: true` + handler `'loopback'`** | O Chromium troca o dispositivo para `loopbackWithoutChrome`. Por baixo, usa a *process loopback* do Windows (`ActivateAudioInterfaceAsync` com `PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE` sobre a árvore de processos do app). Funciona, sem módulo nativo. **Escolhida.** |
| Módulo nativo próprio (process loopback → PCM → `MediaStreamTrackGenerator`) | Desnecessário hoje. Fica como plano B (ver abaixo). |

## Decisão

1. O main (`capture.ts`) atende `getDisplayMedia` **somente** com a fonte pré-selecionada por `window.alga.screen.select(id, { audio })` nos últimos 10 s. A seleção vale para uma única chamada. Sem seleção, o pedido é negado. Também é negado se vier de outro frame ou origem. Com `audio` pedido, o main devolve `audio: 'loopback'`.
2. **O renderer deve sempre pedir o áudio do sistema assim:**
   ```ts
   await window.alga.screen.select(source.id, { audio: true })
   const stream = await navigator.mediaDevices.getDisplayMedia({
     video: { /* resolução/fps do preset */ },
     audio: { restrictOwnAudio: true }, // exclui o próprio Alga Meet do loopback (sem eco da call)
   })
   // conferir: stream.getAudioTracks()[0].getSettings().deviceId === 'loopbackWithoutChrome'
   ```
   Sem `restrictOwnAudio: true` quem assiste ouve a call de volta. Isso está documentado no JSDoc de `screen.select` em `src/shared/bridge.ts`.
3. A permissão `display-capture` é concedida só para a página do próprio app (o Chromium a consulta antes do handler). O controle real continua sendo a seleção explícita no picker.

## Consequências

- Também ficam fora da transmissão as notificações sonoras do app e o áudio de outras transmissões que o usuário esteja assistindo no Alga Meet. É o comportamento desejado.
- A exclusão vale para a **árvore de processos** do app. Um áudio tocado por um processo filho que não seja do Electron também seria excluído (não temos nenhum).
- A process loopback exige Windows 10 2004 (build 19041) ou mais novo. Em versões anteriores, o comportamento do Chromium não foi verificado (sem máquina para testar). O alvo mínimo do produto é Windows 10 22H2.
- **Regressão possível em upgrade do Electron/Chromium.** Rode `scripts/loopback-probe.mjs` e `scripts/verify-native.mjs` a cada upgrade. O verify confere `deviceId === 'loopbackWithoutChrome'`.

## Plano B (se uma versão futura quebrar isso)

Módulo nativo N-API pequeno:
1. Chamar `ActivateAudioInterfaceAsync(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, AUDIOCLIENT_ACTIVATION_PARAMS{ PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE, pid do main })`.
2. Ler PCM float 48 kHz num thread.
3. Entregar ao renderer por `MessagePort` ou `SharedArrayBuffer`.
4. No renderer, um `AudioWorklet` ou `MediaStreamTrackGenerator` vira a faixa publicada no LiveKit.

Esforço estimado: 2–3 dias, mais assinatura do binário.
