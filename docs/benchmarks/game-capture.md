# Captura de jogo: transmissão de tela com um jogo aberto

> 2026-11-01 (medições "antes" e sondagens) e 2026-11-05 (medições "depois").
> - Dados brutos: `game-capture.json`, chave = tag.
> - Script: `apps/desktop/scripts/media-game.mjs`.

## O problema (relato de campo)

Com um jogo aberto a 191 fps (GPU em ~38 %), a transmissão 720p60 saía a 5–36 fps. O jogo continuava liso, mas quem
assistia via um slide.

## Como medimos

- **O "jogo":** um D3D11 nativo, compilado na hora com MSVC.
  - Tem detalhe de alta frequência, a câmera anda e o número do quadro é desenhado como código de barras.
  - Roda em janela, sem borda ou em tela cheia exclusiva.
  - Aceita `--cpu=N` threads ocupadas, para simular jogos que comem processador.
- **A transmissão:**
  - A instância A do app transmite a tela ou a janela do jogo para a instância B.
  - Usa o LiveKit do laboratório (:7890), preset 720p60, HEVC por hardware (NVIDIA).
  - Sem flags de teste: as mesmas opções que o app usa em casa.
- **A máquina:** RTX 3070 e tela 1920×1080.
- **O que olhamos:**
  - **fps enviado:** a melhor camada que sai.
  - **fps da fonte:** o que o Windows entregou ao Chromium.
  - **fps do jogo.**

## Causa

1. **Jogo pesado de CPU:** todos os núcleos ficam ocupados em prioridade normal.
   - O laço de captura do Chromium (processo browser), o WebRTC (renderer) e o codificador (processo GPU) esperam a vez.
   - O laço de captura ainda cai pela metade quando um quadro demora (`max_cpu_consumption_percentage=50`).
   - Resultado: 5–9 fps (`probe-rep-none-*`).
2. **Jogo leve, limitado pela GPU:** a captura pedia exatamente o fps do preset.
   - Qualquer atraso virava quadro perdido: 26–51 fps em janela sem borda (`before-idle`).

## Correção (`src/main/capture.ts`, `media.captureHeadroom`)

- **Prioridade:** ao conceder a captura, todos os processos do app sobem para *acima do normal*.
  - Eles preemptam o jogo só no ~1 núcleo que usam.
  - Testamos cada processo sozinho (`probe-prio-*`, `probe-rep-Browser*`, `probe-rep-Browser,GPU*`): nenhum resolve só. Só "todos" resolve.
- **Folga:** a captura pede 20 % de folga sobre o fps do preset (`headroom 1.2`). Uma demora não derruba a média.

## Resultado

| Situação | Antes (fps enviado) | Depois | fps do jogo |
|---|---|---|---|
| Jogo pesado de CPU (16 threads), sem borda, tela | 5,6 / 5,5 / 9,5 (`probe-rep-none-1..3`) | **58,7** (`after-cpu16`) | 191 → 191 |
| Jogo pesado de CPU, sem borda, janela | — | **60** (`after-cpu16`) | 191 |
| Jogo pesado de CPU, em janela, tela | — | **57,9** (`after-cpu16`) | 191 |
| Jogo leve, sem borda, tela | 48,1 (`before-idle`) | **58,3** (`after-idle`) | 191 |
| Jogo leve, sem borda, janela | 26,2 (`before-idle`) | **59,8** (`after-idle`) | 191 |
| Jogo leve, em janela, tela | 51 (`before-idle`) | **59,5** (`after-idle`) | 191 |
| Tela cheia exclusiva, tela | 56,5 (`m-idle-before-exclusive-screen`) | **59,8** (`m-idle-after-exclusive-screen`) | 191 |
| Tela cheia exclusiva, janela | 57,1 (`m-idle-before-exclusive-window`) | **59,7** (`m-idle-after-exclusive-window`) | 191 |

O jogo não perdeu nenhum quadro em nenhum caso. A CPU do app ficou em ~3 %.

## Para quem transmite

Quando a transmissão fica abaixo de 85 % da meta, o cartão "Você está ao vivo" diz o motivo em português.
- O diagnóstico é o `diagnoseSend` em `media/stats.ts`, com testes.
- Cada motivo vem com o que fazer:
  - **Codificador sem processador:** feche programas pesados ou baixe a qualidade.
  - **Conexão de envio no limite:** pause downloads ou baixe a qualidade.
  - **Windows entregando poucos quadros:** limite o fps do jogo (ex.: 144) ou feche programas pesados.
  - **Codificador descartando quadros:** limite o fps do jogo ou baixe a qualidade.
- Tela parada (código, documento) envia poucos quadros de propósito: ali não aparece aviso.

## Limites conhecidos

- **Janela de um jogo em modo janela com tamanho ímpar** (aqui 1226×718), transmitida como *janela*:
  - O codificador por hardware recusa o tamanho e o Chromium cai no OpenH264 (software).
  - Quem assiste recebe 60 fps a 1226×718, mas a codificação gasta CPU.
  - Nas estatísticas de envio essa camada aparece sem fps (`sent 0`), então o diagnóstico fica em silêncio.
  - **Próximo passo:** arredondar a captura para múltiplos de 16 (restrição de largura e altura) para manter o hardware.
- **`ZeroCopyDesktopCapture`** (`probe-zc*`, `probe-zct*`) não ajudou sozinho e às vezes travou a captura. Não está ligado.
- **A prioridade nunca volta ao normal quando a transmissão acaba:** o processo principal não recebe o sinal de fim.
  - Processos ociosos em prioridade alta não custam nada.
  - O atalho está anotado no código.
