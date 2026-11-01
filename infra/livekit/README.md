# LiveKit (SFU)

`livekit.dev.yaml` (local, `node scripts/livekit.mjs`) e `livekit.prod.yaml` (um nó, `docs/infra/deploy.md`). Binário em
`bin/` (1.13.11, `checksums.txt`). O LiveKit lê a config **só na subida** e em modo estrito: chave desconhecida = não sobe
(`could not parse config: ... field packet_trackr not found in type sfu.StreamTrackerConfig`).

## Tempo para o SFU notar uma camada de tela parada (pesquisado 2026-11-01, sem mudança)

Problema (`docs/benchmarks/media-network.md` §3.1): com o uplink de quem transmite caindo, o WebRTC desliga a camada
alta e o espectador fica parado ~4 s até o SFU trocá-lo para a camada de baixo. O desktop já contorna isso no cliente
(stall guard: pior caso 1,2 s).

**Chaves (código do 1.13.11: `pkg/config/config.go`, `pkg/sfu/streamtrackermanager.go`, `pkg/sfu/streamtracker/`):**

```yaml
video:
  dynacast_pause_delay: 5s            # outra coisa: pausar camadas que ninguém assiste
  stream_tracker_manager:
    screenshare:                      # também há `video:` (câmera), com padrões próprios
      stream_tracker_type: packet     # ou `frame` (usa frame_tracker.<camada>.min_fps)
      bitrate_report_interval: { 0: 4s, 1: 4s, 2: 4s }   # relatório de bitrate ao alocador, não a detecção
      packet_tracker:
        0: { samples_required: 1, cycles_required: 1, cycle_duration: 2s }   # padrão nas 3 camadas
        1: { samples_required: 1, cycles_required: 1, cycle_duration: 2s }
        2: { samples_required: 1, cycles_required: 1, cycle_duration: 2s }
```

- A camada vira "parada" quando um ciclo inteiro passa com menos de `samples_required` pacotes com carga (padding não
  conta), e volta no primeiro ciclo com pacotes. Com `cycle_duration: 2s` a detecção leva **2–4 s** (o ~4 s medido);
  com `1.5s`, 1,5–3 s; com `1s`, 1–2 s. Parada → o SFU tira a camada das disponíveis e troca os espectadores na hora.
- **Armadilha:** a entrada de uma camada substitui a padrão inteira. `2: { cycle_duration: 1s }` sozinho deixa
  `samples_required: 0` e a camada **nunca** é dada como parada (medido com tela parada: 4 trocas de estado contra 6,
  faltam as de "parada"). Sempre as três chaves.

**Medido (2026-11-01):** LiveKit próprio (:7990), Chromium headless publicando um canvas 1920×1080 como tela
(`contentHint: detail`, simulcast 360p + 1080p, VP8), que só gera quadro quando o conteúdo muda; trocas de estado das
camadas contadas no log de debug do SFU em ~25 s (as primeiras 4–6 são da subida).

| Conteúdo da tela | `cycle_duration` 2 s (padrão) | 1,5 s | 1 s |
|---|---|---|---|
| parado (0 quadros/s depois do 1º) | 6 | 6 | 6 |
| muda 1×/s (relógio) | 4 | 4 | **10** |
| muda a cada 1,5 s | 8 | 8 | **30** |
| muda a cada 1,75 s | 10 | **16** (a camada alta oscila) | — |

- Tela parada não manda quadro nenhum (Chromium 156: 0 quadros/s, só padding), então ela já "para" com o padrão.
  O risco de encurtar é a tela com pouca mudança (relógio, cursor piscando devagar, slides): cada volta da camada é
  uma troca de camada e um quadro-chave para quem assiste. Com 1 s isso já triplica a 1 Hz; com 1,5 s aparece a
  ~0,6 Hz.
- O ganho iria só para clientes sem o stall guard, e o único cliente (desktop) já o tem.

**Decisão:** manter o padrão do LiveKit nas duas configs. Se um cliente sem stall guard aparecer, o valor a testar é
`1.5s` nas três camadas de `screenshare` (sobe sem erro em modo estrito, conferido), medindo antes a oscilação com
telas reais de pouca mudança.
