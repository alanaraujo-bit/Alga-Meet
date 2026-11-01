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

### Cena inteira, código final (commit 2125eac), 60 s por cena em 4 janelas intercaladas

| Medida | Sem cosméticos | Com cosméticos |
|---|---|---|
| Quadros por segundo | 180,6 | 175,0 |
| Main thread por quadro (ms), média e faixa entre janelas | 1,36 (1,24–1,47) | 2,93 (2,27–3,77) |
| script / estilo / layout (ms) | 0,12 / 0,48 / 0,01 | 0,18 / 0,95 / 0,00 |
| JS dos cosméticos por quadro (ms) | — | 0,017 |
| Intervalo de quadro p50 / p95 (ms) | 5,6 / 5,7 | 5,6 / 5,7 |
| Quadros > 25 ms | 0,0 % | 0,0 % |
| CPU do processo de GPU, média / p95 (% de 1 núcleo) | 2,7 / 3,4 | 2,9 / 3,8 |
| CPU do renderer (% de 1 núcleo) | 1,8 | 3,4 |
| Memória privada do renderer: início / média / fim (MB) | 64 / 100 / 100 | 103 / 244 / 258 |
| Gestos iniciados / recusados (teto ou fora da tela) | — | 192 / 1824 |
| Gestos simultâneos, média / pico | — | 3,7 / 8 |
| Cortes por orçamento estourado | — | 0 |

Só uma metade da cena ligada (mesma rodada, 60 s cada): **chamada** (8 tiles falando com aura, decoração parada e moldura) +1,64 ms/quadro; **lista** (50 linhas repetindo gestos) +1,39 ms/quadro. As faixas entre janelas dessas duas foram largas (1,8–4,3 ms), então servem de ordem de grandeza, não de prova.

**Leitura:**
- **Por cosmético: 0,135 ms de main thread por quadro** (1,58 ms ÷ 11,7 cosméticos em movimento em média: 8 auras + 3,7 gestos). Meta: ≤ 1 ms. Cumprida com folga, em todas as rodadas (0,12–0,16 ms).
- O JS dos cosméticos é 0,017 ms por quadro. O resto é estilo (+0,47 ms: o `--speak` reescrito a cada quadro re-estiliza os anéis) e pintura/composição.
- Nenhum quadro passou de 25 ms; p50 e p95 iguais nas duas cenas; a GPU subiu 0,2 ponto de um núcleo.
- O teto global segurou o pico em 8 gestos com a cena pedindo ~100 a cada 2,5 s.
- **Soma na cena de estresse: 1,58 ms por quadro, acima do teto de 1 ms** que o plano põe para a soma de cosméticos numa chamada. A cena é pior que uma chamada real (8 pessoas falando sem pausa, 50 linhas repetindo gestos a cada 2,5 s, tela de 180 Hz), mas a metade "chamada" sozinha também passou de 1 ms nesta rodada. Ver limites.

Rodada anterior, mesmo método, antes de tirar a camada própria das decorações da lista: 1,10 → 3,03 ms (+1,93 ms; 0,16 ms por cosmético).

### O que a atribuição mostrou e o que mudou

Rodando cada parte da cena sozinha (`--parts`), um custo grande estava nas **decorações paradas dos tiles**: o anel de fala padrão repinta a cada quadro e, sem camada própria, arrastava a decoração junto (8 tiles: +1,26 ms/quadro numa rodada de app novo por cena). Correções, já no código:

1. `.deco` corta a herança de `--speak` (o envelope reescreve a variável a cada quadro; a arte não precisa ser re-estilizada) e, **só nos tiles de chamada**, ganha camada própria (`will-change: transform`). Na lista a camada só somava trabalho de composição a cada quadro (tirá-la baixou a cena de +1,93 para +1,58 ms).
2. Os anéis de Respiro e Prisma deixaram de ser `conic-gradient` com `mask` (uma camada mascarada cuja opacidade segue a voz) e viraram SVG pintado uma vez dentro de um elemento que só muda opacidade e transform.
3. O reflexo do Halo, a conta da Órbita e as estrelas da Constelação viraram camadas HTML (gesto no compositor, sem repintar o SVG).
4. A luz da Moldura Cinema não existe em repouso (`display: none` fora do gesto).

### Limites desta medição

- **Teto de 1 ms somando tudo na chamada (§3.3.4): não provado.** Na cena de estresse a soma é 1,6 ms/quadro, e a metade "chamada" sozinha também passou de 1 ms (medida ruidosa). O que falta medir é o cenário do aceite do plano (12 tiles, 4 falando, 1 transmissão) na máquina de referência a 60 Hz; o próximo corte seria o custo por quadro do `--speak` (hoje cada aura re-estiliza 1–3 elementos por quadro de fala).
- **Ruído de abertura.** Medir cada cena num app recém-aberto variou ±0,5–1 ms/quadro só de abrir de novo; por isso o script intercala as cenas num app só. Mesmo intercaladas, as metades isoladas (`--parts`) variaram muito entre janelas.
- **Memória.** Com cosméticos a memória privada do renderer fica ~145 MB acima (244 contra 100 MB de média) e ainda subia no fim dos 60 s, com o heap JS estável; parece lixo de estilo e camadas recolhido tarde, não vazamento de JS, mas a causa não foi isolada. Medir 10 min é o próximo passo.
- **Captura.** As rodadas usam o modo de automação do processo principal (janela fora da tela, inativa, sem barra de tarefas), uma instância por vez, fechada ao fim de cada medida.
- **Fallback por economia de energia do Windows**: não implementado (precisa do `powerMonitor` no processo principal). Os outros três gatilhos estão no motor.
