# Sala de Cinema: teste real com o dono (filme dele, amigo em outra casa)

> Complementa `docs/benchmarks/cinema-engine.md`, que mediu tudo o que dá para medir numa máquina só. O que só
> acontece entre duas casas (internet de verdade, relay, eco com caixa de som, filme real de 1–2 h) fica para este
> roteiro. Tempo total: ~1 h 15 min.

## Antes (Maestro, não o dono)

1. **Servidor:** staging com o servidor desta branch (`feat/sala-de-cinema`) e `CINEMA=true`.
2. **Relay:** o coturn do `home-server` **ainda não está no ar**: este PC (outra sub-rede da casa) não alcança o servidor de
   casa (192.168.1.110). Sem ele, quem não conecta direto não assiste: o teste registra se isso acontece. Se o relay
   for publicado antes, configurar `CINEMA_TURN_*` no staging e avisar o dono.
3. **App de teste:** instalador desta branch com a identidade de teste ("Alga Meet Sandbox"), para não mexer no app de
   todo dia. Um para o dono, outro para o amigo.
4. **Espaço:** um espaço de teste com o dono e o amigo, com E2EE ligado (`PATCH /spaces/:id { "e2ee": true }` com o
   token do dono: ainda não há tela para isso). A sessão de cinema numa chamada E2EE amarra as conexões diretas à
   chave do grupo.

## O que o dono precisa ter

- Um filme **1080p** em MKV ou MP4 (de preferência H.264 ou HEVC, 8–15 Mbps, 1–2 h).
- Um filme **4K** (HEVC, de preferência com HDR) para o segundo bloco.
- Fone de ouvido **e** caixa de som no PC do dono.
- O celular para anotar tempos e tirar fotos da tela (ou Win+Shift+S).

## Passo a passo

### Bloco 1 — 1080p, conexão direta (25 min)

1. Os dois abrem o app de teste, entram no espaço de teste e na mesma sala de voz. Conferir no topo da sala:
   **"Criptografia de ponta a ponta"**.
2. O dono clica em **Cinema** (no dock da chamada) e escolhe o filme 1080p.
   - **Anotar o que a ficha mostra:** resolução, codec, Mbps, faixas de áudio, avisos (por exemplo "o áudio vai ser
     convertido").
3. O dono clica em **Abrir sessão** e **começa o cronômetro**. O amigo clica em **Sentar** assim que o cartão aparecer.
   - **Anotar:** quanto tempo até **os dois** verem a primeira imagem.
4. Quando as duas poltronas estiverem "pronto", o dono clica em **Começar**.
5. Os dois apertam **S** (abre o painel de estatísticas). Tirar uma foto do painel dos dois **aos 2, 10 e 30 minutos**.
   As linhas que importam:
   - **Sincronia** (o número de p95, em ms);
   - **Peças** (de quem projeta / de amigos, ↓ e ↑ em Mbps);
   - **Relay** ("nenhum" = direto; um nome = passou por relay);
   - **Relógio** (offset e RTT);
   - **Buffer à frente**.
6. **Sincronia a olho:** o dono pausa. Os dois tiram print da tela pausada (tem que ser o mesmo quadro). Depois:
   tocar, pular +10 s, voltar 10 s, e o amigo troca a faixa de áudio e liga uma legenda.
7. **Entrar no meio:** o amigo clica em **Sair da sessão**, espera 10 s e clica em **Sentar** de novo.
   - **Anotar:** quanto tempo até ele voltar a ver o filme junto (o banner some e o p95 do painel volta abaixo de 42 ms).
8. Deixar tocar **pelo menos 30 minutos** sem mexer. **Anotar** se aparecer "Esperando o(a) …" (travou) e quantas vezes.

### Bloco 2 — eco: caixa de som contra fone, nas duas rotas de som (20 min)

O som do filme pode sair por dois caminhos. A troca fica no painel **S › Saída do som do filme** e vale **na próxima
sessão** (encerrar e abrir de novo).

Para cada linha da tabela, 30 s com o filme num trecho com fala ou música, volume normal, **o dono calado** e com o
microfone ligado. O amigo, **de fone**, dá a nota.

| # | Saída do dono | Rota do som | Nota do amigo |
|---|---|---|---|
| 1 | Fone | WebAudio | |
| 2 | Caixa de som | WebAudio | |
| 3 | Caixa de som | MediaStream (`<audio>`) | |
| 4 | Fone | MediaStream (`<audio>`) | |

Nota: 0 = não ouço o filme vindo do dono; 1 = ouço baixinho; 2 = ouço claro; 3 = ouço alto, com eco ou atraso.

### Bloco 3 — 4K (15 min)

1. Encerrar a sessão; abrir o filme 4K, mesmo roteiro dos passos 2–5 do bloco 1.
2. **Anotar:** se a ficha avisou algo (HEVC, HDR, bitrate alto), o tempo até a primeira imagem, e se o amigo viu
   "Seu PC não decodifica" (GPU dele sem HEVC).
3. Deixar 10 min tocando, com fotos do painel aos 2 e 10 min.

## O que mandar de volta

- As fotos e os prints (painéis S, telas pausadas).
- Os tempos anotados: primeira imagem (1080p e 4K) e volta depois de "Sair/Sentar".
- A tabela do eco preenchida.
- O plano de internet do dono e do amigo (velocidade de **upload** do dono, principalmente).
- Se apareceu **Relay** com nome em algum momento, ou se o amigo não conseguiu assistir (e a mensagem).
- Quantas vezes apareceu "Esperando o(a) …" e quanto tempo durou.
- Os logs do app de teste dos dois: `%APPDATA%\Alga Meet Sandbox\logs` (zip da pasta).

## Como o Maestro lê o resultado

| Critério (§8) | Passa se |
|---|---|
| Primeiro frame | ≤ 10 s de "Abrir sessão" a os dois vendo (1080p) |
| Sincronia | p95 do painel ≤ 42 ms depois dos primeiros 10 s |
| Pausa | os dois prints pausados mostram o mesmo quadro |
| Entrar no meio | ≤ 8 s até sincronizado |
| Travamentos | nenhum "Esperando…" em 30 min, com upload do dono ≥ 1,5× o bitrate do filme |
| Eco | nota 0 com caixa de som em pelo menos uma das rotas → essa rota vira o padrão; senão fica o aviso de fone [dono] |
| Relay | anotar a taxa real (direto ou relay); sem relay no ar, conexão impossível = pendência do relay, não do motor |
