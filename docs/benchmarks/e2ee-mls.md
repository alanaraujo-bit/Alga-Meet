# E2EE — custo do MLS (OpenMLS em WASM) — 2026-11-01

Fase 0 de `docs/decisions/0004-e2ee.md` (§5.1): o wrapper `native/mls` (OpenMLS 0.9.2, ciphersuite 1 `MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519`) compilado para `wasm32-unknown-unknown` e carregado num `utilityProcess` do Electron. Resultado e decisão: 0004 §9.

- **Máquina:** i5-13600KF + RTX 3070, Windows 11 Pro 10.0.26300, a mesma de `media-baseline.md`. Outros agentes rodavam na máquina ao mesmo tempo. Por isso o **p95 vale mais que o máximo**.
- **Toolchain:** rustc/cargo 1.99.1, `wasm-bindgen` 0.2.130 (crate e CLI), perfil release com `lto = true` e `codegen-units = 1`, sem `wasm-opt`. Dependências fixadas em `native/mls/Cargo.lock`.
- **Runtimes:** Node 24.20.0 (harness simples) e Electron 45.2.1 (Node 24.22.1, Chromium 156.0.8078.75).
- **Reproduzir:**
  - `sh native/mls/build.sh` gera `native/mls/pkg/`;
  - `node native/mls/bench/node.mjs 20`;
  - `sh native/mls/bench/run-electron.sh` (usa `REPS=20` por padrão e escreve `native/mls/target/electron-bench/result.json`).
- **Cenário** (`native/mls/bench/core.mjs`):
  - Sala com n−1 membros. 20 vezes: um novato entra (sala vai a n) e o DS o remove (volta a n−1).
  - O committer é a folha 0. Add e Remove são *proposals* externas do DS, como em 0004 §3.3.
  - Toda entrada confere que todos os n membros derivam o mesmo `export_secret`.
  - "n" é o tamanho do grupo **depois** da entrada, ou **antes** da saída.

## Resumo [MEDIDO]

| | Valor |
|---|---|
| `.wasm` (cru / gzip -9) | **2 340 962 B (2,23 MiB) / 678 307 B**. A seção `name` ocupa 377 KB e pode ser removida (`wasm-bindgen --remove-name-section`), o que daria ~1,96 MB. Com `opt-level = "s"`: 2 792 831 B cru (maior) e 620 KB gzip. Não foi adotado |
| Glue JS (`alga_mls.js`) | 21,8 KB |
| Carregar o glue (ler, compilar e instanciar o WASM) | 3,5 ms (Node), 3,7–5,3 ms (utilityProcess) |
| **Partida a frio do worker real** (`utilityProcess.fork` → primeira identidade criada, via `mls/host.ts`) | **54,5–77,0 ms** (8 partidas, mediana 59 ms) |
| Ida e volta de RPC main ↔ worker (`signature_public_key`, 200 chamadas) | p50 0,06 ms, p95 0,13 ms |
| Memória do worker (1 identidade, sem grupo) | privada **30,3 MB**, *working set* 100 MB (inclui páginas compartilhadas do Electron) |
| Memória do worker como membro de uma chamada de 99 | privada **33,7 MB** (+3,4 MB), *working set* 104,4 MB |
| **Entrar numa sala de 99** (Welcome processado no worker real, via RPC) | **p50 8,8 ms, p95 9,7 ms**. A **primeira** entrada de um worker novo leva 19,7 ms (JIT frio) |
| Testes de correção | `cargo test`: 5 passaram (1,7 s). WASM em Node (`node --test native/mls/test/wasm.test.mjs`): 4 passaram (1,4 s) |

## 1. Tempo por operação no utilityProcess [MEDIDO]

Executado por `bench/utility.mjs` dentro de um `utilityProcess` (mesmo V8 e mesmo Node da produção), sem IPC. Valores em ms, **p50 / p95**. Amostras: 20 por célula (operações de um membro), 20×(n−1) para "proposal" e 20×(n−2) para o processamento de commit.

| Operação | n = 2 | n = 10 | n = 25 | n = 99 |
|---|---|---|---|---|
| Gerar *key package* (novato) | 0,18 / 0,24 | 0,17 / 0,21 | 0,16 / 0,17 | 0,17 / 0,23 |
| Validar a *proposal* Add do DS (cada membro) | 0,24 / 0,36 | 0,22 / 0,28 | 0,21 / 0,27 | 0,21 / 0,26 |
| **Commit + Welcome** da entrada (committer) | 0,45 / 0,52 | 0,53 / 0,64 | 0,62 / 0,67 | **1,34 / 1,67** |
| **Processar o Welcome** (novato) | 0,49 / 0,58 | 1,15 / 1,28 | 2,34 / 2,66 | **8,07 / 8,44** |
| Processar o commit da entrada (cada outro membro) | — | 0,20 / 0,28 | 0,24 / 0,33 | 0,60 / 0,76 |
| Commit da saída, com UpdatePath (committer) | 0,30 / 0,54 | 1,44 / 1,69 | 3,17 / 3,35 | **11,59 / 12,02** |
| Processar o commit da saída (cada outro membro) | — | 0,51 / 0,68 | 0,58 / 0,72 | 1,14 / 1,32 |

**Node 24.20.0 puro** dá o mesmo dentro de ±5 % (n = 99: Welcome 8,23 / 8,64, commit 1,32 / 1,50, saída 11,46 / 12,01, processar commit 0,63 / 0,80). Máximos no Node: só a primeira célula sofre com o JIT frio (n = 2: commit 6,4 ms, Welcome 4,0 ms). Com n = 99, o pior caso de 1.940 processamentos de commit foi 1,64 ms.

**Leitura:**
- A entrada é barata porque o commit de Add **não tem UpdatePath** e cita as *proposals* do DS **por referência**: 198 B para qualquer n. O custo da entrada fica no Welcome: o novato verifica a árvore inteira, ~99 assinaturas Ed25519.
- A saída custa mais para o committer: 11,6 ms com n = 99. A árvore desta medição é o **pior caso**, porque as entradas sem caminho deixam os nós internos vazios, e aí o caminho de saída cifra (HPKE) para quase todas as folhas. Numa chamada real, cada commit com caminho preenche nós e o custo cai para O(log n).
- A estimativa de 0004 §4.5 era de 15–50 ms para o Welcome de 99. O medido é **8–10 ms**, abaixo até do piso da estimativa.

## 2. Worker real via RPC: um dispositivo entrando numa sala de 99 [MEDIDO]

É o `apps/desktop/src/main/mls/worker.ts` forkado pelo `host.ts` do app: o caminho da fase 1. O resto da sala (98 membros + DS) roda no processo do harness. Só o dispositivo testado fica no worker. 20 repetições, em ms, **p50 / p95 / máx**:

| No dispositivo (via RPC, inclui *structured clone* das mensagens) | |
|---|---|
| Gerar *key package* | 0,32 / 0,48 / 3,94 |
| **Processar o Welcome**, sala vai a 99 | **8,78 / 9,71 / 19,70** (o máximo é a 1ª entrada do worker) |
| Validar a *proposal* Add de outro novato | 0,46 / 0,69 / 2,84 |
| Processar o commit dessa entrada (99 → 100) | 0,98 / 1,21 / 4,21 |
| Processar o commit da saída dele (100 → 99, decifra o caminho) | 1,63 / 1,99 / 3,27 |

O RPC soma ~0,1–0,7 ms por chamada em relação ao §1. O Welcome de 19 KB vai de 8,07 para 8,78 ms.

## 3. Tamanhos [MEDIDO]

| Bytes | n = 2 | n = 10 | n = 25 | n = 99 |
|---|---|---|---|---|
| *Key package* (`MLSMessage`) | 289 | 289 | 289 | 290 |
| Commit da entrada (PublicMessage) | 198 | 198 | 198 | 198 |
| **Welcome** (com a extensão `ratchet_tree`) | 743 | 2 492 | 5 320 | **19 173** (25,6 KB em base64) |
| Commit da saída (com UpdatePath, árvore vazia = pior caso) | 364 | 1 194 | 2 459 | 8 597 |
| Estado serializado de um membro (`save_state`) | 6 952 | 16 262 | 31 268 | 105 181 |

- O Welcome de 99 cabe com folga no limite de 64 KB por frame proposto em 0004 §3.3. A estimativa lá era de ~30 KB.
- O estado de 105 KB inclui a árvore e as chaves privadas. Se for persistido, tem de ser cifrado com DPAPI. Pela 0004 §3.6 a recuperação é readicionar, então o estado por chamada **não precisa** ir para o disco.

## 4. Correção [MEDIDO]

Cobertos em `native/mls/src/tests.rs` (nativo) e de novo, contra o WASM, em `native/mls/test/wasm.test.mjs`:

- **Acordo por época:** grupos de 2, 10, 25 e 99. Todos derivam o mesmo `export_secret("Alga Media v1", …)` na mesma época, e o segredo muda a cada época.
- **Saída:** quem foi removido recebe `"removed"`, perde o grupo e não exporta mais nada. Mesmo restaurado do estado salvo antes do commit:
  - ele não acompanha a época seguinte (proposal e commit da época N+2 rejeitados);
  - o segredo dos que ficaram muda.
  - Depois da saída, o armazenamento dele fica **vazio** (ver §5).
- **Commit adulterado:** inverter **um bit em qualquer byte** é rejeitado, tanto no commit de entrada (198 B) quanto no de saída com UpdatePath. Depois disso o commit verdadeiro ainda aplica, porque as tentativas não deixam estado.
- **External sender:** *proposal* assinada por outra chave com o mesmo nome do DS é rejeitada, e a de época errada também. *Proposals* de membros e mensagens de aplicação MLS são recusadas pelo wrapper: só o DS propõe (0004 §3.3).
- **Serialização:**
  - `save_state` → `load_state` → `save_state` devolve os mesmos bytes, com as entradas ordenadas por chave;
  - o cliente restaurado continua no grupo;
  - a identidade (`export_identity`, o que vai para `e2ee-identity.bin`) faz a ida e volta;
  - blobs truncados ou de outro tipo são recusados.
- **Reentrada na mesma chamada** (mesmo `group_id`, *key package* novo): funciona. Também passa pelo harness Electron, onde o dispositivo entra e sai 20 vezes.

## 5. Achados

- **OpenMLS deixa chaves HPKE de quem saiu.** `MlsGroup::delete` não apaga as `EpochKeyPairs` da última época de um membro removido, o que é ruim para o sigilo futuro. O wrapper apaga todas, porque um cliente tem um grupo só. Isso é um `shortcut:` que depende do formato do `openmls_memory_storage` 0.6.0 fixado. Vale reportar ao upstream.
- **`SignatureKeyPair::private()` só existe com `test-utils`.** O wrapper gera o par Ed25519 pelo provedor de cripto e guarda os bytes crus para `export_identity`.
- **WASM:** `ed25519-dalek` e `p256` ainda puxam `getrandom` 0.2, que precisa de `features = ["js"]` explícito no alvo wasm32 (está no `Cargo.toml`). O `rayon` vem como dependência da OpenMLS e roda numa thread só no WASM, sem erro.
- **O provedor RustCrypto embute todas as suítes** (P-256, P-384, ChaCha20 e ML-DSA entram na árvore). Um provedor só com a suíte 1 encolheria o `.wasm`. Não vale o código antes de o tamanho virar problema.

## 6. Licenças [MEDIDO]

Fonte: `cargo metadata --filter-platform` mais `cargo tree`, olhando todas as dependências não-dev alcançáveis (157 crates para wasm32, 154 para Windows). Cerca de 138 entram no binário (dependências normais, sem proc-macros).

| Licença | Crates |
|---|---|
| MIT e/ou Apache-2.0 (incluindo `MIT OR Apache-2.0`, `MIT/Apache-2.0`, `(MIT OR Apache-2.0) AND Unicode-3.0`) | 126 (wasm32). A OpenMLS e os crates `openmls_*` são **MIT** |
| BSD-3-Clause | 6 |
| `BSD-2-Clause OR Apache-2.0 OR MIT` (`zerocopy`), `Unlicense OR MIT` (`memchr`) | 2 |
| **MPL-2.0** | **4: `hpke-rs`, `hpke-rs-crypto`, `hpke-rs-rust-crypto`, `hpke-rs-libcrux` 0.7.0** (o HPKE da OpenMLS) |
| GPL / LGPL / AGPL / sem licença | **nenhum** |

- **MPL-2.0** é *copyleft* fraco, **por arquivo**. Pode ir num app fechado. O que se exige ao distribuir o binário é informar onde está o código-fonte desses arquivos (o crates.io serve, se não forem modificados) e manter o aviso. Não há como trocar: os dois provedores da OpenMLS usam `hpke-rs`.
- Antes de distribuir, gerar o arquivo de avisos de terceiros: os textos MIT, BSD e Apache, os NOTICE da Apache-2.0 e o aviso da MPL com o link para o fonte.
