# Cosméticos Hora Azul — desempenho

> Prova do pacote B (`docs/business/growth-plan.md` §3.3.4 e §5.2 B): ≤ 1 ms de main thread por quadro por cosmético visível e teto global de cosméticos animando ao mesmo tempo.
> Script: `apps/desktop/scripts/cosmetics-perf.mjs` (build e perfil isolados, API num porto morto; nada toca o stack de dev).

## Cena

`index.html#cosmetics-gallery/bench` (só builds não empacotados), janela de 1440 × 900 a 100 %:

- **Lista de 50 membros**, cada um com uma decoração que se move (Órbita, Constelação, Fita de seda, Halo de vidro em 32 px) e uma placa (as quatro da coleção). A cena **repete todos os gestos a cada 2,5 s** (`replayAll`), muito mais do que o uso real (um gesto por hover); o teto global (`MAX_PLAYING = 8`) decide quantos rodam de fato e o resto mostra o quadro de repouso.
- **8 tiles de chamada falando o tempo todo** (voz simulada em frases, o mesmo `useEnvelope` do palco), cada um com aura (Respiro, Prisma, Ondas, Frondes) e decoração parada.
- **1 transmissão com a Moldura Cinema.**

A linha de base é a mesma cena sem cosméticos (`/bench-off`): mesmos avatares, mesmo envelope de voz, anel padrão.

## Como se mede

CPU e quadros: **um app só, as duas cenas intercaladas** (sem, com, com, sem) em 4 janelas de 15 s cada (3 s de aquecimento por janela), 60 s medidos por cena. Medir cada cena num app recém-aberto dava ±0,5–1 ms/quadro de diferença só de abrir de novo: maior que o efeito medido. Memória: um app novo por cena, 60 s.

| Medida | Fonte |
|---|---|
| Main thread por quadro | CDP `Performance.getMetrics` (`TaskDuration`, `ScriptDuration`, `RecalcStyleDuration`, `LayoutDuration`) ÷ quadros desenhados (contador de rAF da cena); média e faixa entre as janelas |
| JS dos cosméticos | contador do motor (`engine.ts` `timed()`): callbacks das auras e quadros de canvas |
| Intervalo de quadro | rAF da cena, p50 e p95 |
| CPU do processo de GPU e do renderer | `app.getAppMetrics()` a cada 1 s (% de um núcleo) |
| Memória | bytes privados do renderer (início, média, fim) e heap JS |
| Teto global | `stats.started`, `stats.skipped`, pico e média de gestos simultâneos |

## Resultados (2026-11-01, i5-13600KF, GPU NVIDIA, tela de 180 Hz)

> Máquina bem mais rápida que a de referência do plano (i5 de 8ª geração, UHD 620). O que vale levar daqui é a **diferença** entre as cenas e o custo por cosmético; tempos absolutos na máquina de referência serão maiores.

### Cena inteira, 60 s por cena (app novo por cena, código antes das duas otimizações abaixo)

| Medida | Sem cosméticos | Com cosméticos |
|---|---|---|
| Quadros por segundo | 180,6 | 179,3 |
| Main thread por quadro (ms) | 1,35 | 2,70 |
| script / estilo / layout (ms) | 0,12 / 0,48 / 0,01 | 0,14 / 0,94 / 0,05 |
| JS dos cosméticos por quadro (ms) | — | 0,013 |
| Intervalo de quadro p50 / p95 (ms) | 5,6 / 5,7 | 5,6 / 5,7 |
| Quadros > 25 ms | 0,0 % | 0,0 % |
| CPU do processo de GPU, média / p95 (% de 1 núcleo) | 2,8 / 4,1 | 2,7 / 4,0 |
| CPU do renderer (% de 1 núcleo) | 1,8 | 3,1 |
| Memória privada do renderer: início / média / fim (MB) | 106 / 140 / 158 | 220 / 347 / 358 |
| Gestos iniciados / recusados pelo teto ou fora da tela | — | 192 / 1824 |
| Gestos simultâneos, média / pico | — | 3,5 / 8 |
| Cortes por orçamento estourado | — | 0 |

**Leitura:** 11,6 cosméticos em movimento por quadro em média (8 auras + 3,5 gestos) custaram 1,35 ms de main thread por quadro no total, **0,12 ms por cosmético em movimento** (meta: ≤ 1 ms). O JS dos próprios cosméticos é 0,013 ms por quadro: o custo é estilo e pintura, não script. Nenhum quadro passou de 25 ms, o p95 ficou em 5,7 ms nas duas cenas e a GPU não mudou. O teto global segurou o pico em 8 gestos, mesmo com a cena pedindo ~100 a cada 2,5 s.

### O que a atribuição mostrou e o que mudou

Rodando cada parte da cena sozinha (`--parts`), o custo não estava nas auras: estava nas **decorações paradas dos tiles**. O anel de fala padrão repinta a cada quadro e, sem camada própria, arrastava a decoração junto (8 tiles: +1,26 ms/quadro). Correções, já no código:

1. `.deco` ganhou camada própria (`will-change: transform`) e corta a herança de `--speak` (o envelope reescreve a variável a cada quadro; a arte não precisa ser re-estilizada).
2. Os anéis de Respiro e Prisma deixaram de ser `conic-gradient` com `mask` (uma camada mascarada cuja opacidade segue a voz) e viraram SVG pintado uma vez dentro de um elemento que só muda opacidade e transform.
3. O reflexo do Halo, a conta da Órbita e as estrelas da Constelação viraram camadas HTML (gesto no compositor, sem repintar o SVG).
4. A luz da Moldura Cinema não existe em repouso (`display: none` fora do gesto).

### Limites desta medição

- **Ruído de abertura.** Medir cada cena num app recém-aberto variou ±0,5–1 ms/quadro só de abrir de novo, a mesma ordem do efeito. Por isso o script agora intercala as cenas num app só (ver "Como se mede"); a rodada intercalada com o código final está pendente: as rodadas de Electron foram suspensas enquanto o processo principal ganha o modo de automação (janelas fora da tela, sem foco). Rodar: `node apps/desktop/scripts/cosmetics-perf.mjs --parts`.
- **Teto de 1 ms somando tudo na chamada** (§3.3.4): o custo por cosmético está folgado, mas a soma da metade "chamada" da cena (8 auras falando sem parar + 8 decorações + moldura) ainda não está provada abaixo de 1 ms com o código final; a cena de estresse fala em 8 tiles ao mesmo tempo, o que uma chamada real não faz.
- **Memória.** Com cosméticos, a memória privada do renderer sobe mais (+100–200 MB nas rodadas) com o heap JS estável; parece lixo de estilo e camadas recolhido tarde, não vazamento de JS, mas a causa não foi isolada. Medir por mais tempo (10 min) é o próximo passo.
- **Fallback por economia de energia do Windows**: não implementado (precisa do `powerMonitor` no processo principal). Os outros três gatilhos estão no motor.
