# Sala de Cinema: teste real com o dono (filme dele, amigo em outra casa)

> Complementa `docs/benchmarks/cinema-engine.md`, que mediu tudo o que dá para medir numa máquina só. O que só
> acontece entre duas casas (internet de verdade, relay, eco com caixa de som, filme real de 1–2 h) fica para este
> roteiro. Tempo total: ~1 h 15 min.

## Antes (Maestro, não o dono)

**Quando:** depois que o Plano 2 (a experiência) for lançado. O dono decidiu que **não haverá app de teste separado**:
o teste com o amigo acontece no **Alga Meet normal**, na versão que já traz o cinema. Nada de instalador "Sandbox".

1. **Servidor:** o servidor desta branch (`feat/sala-de-cinema`) com `CINEMA=true`. Para implantar a branch no staging a
   partir deste worktree, **ligar o worktree ao projeto do Railway primeiro** (`railway link`, projeto alga-meet, ambiente
   staging, serviço api): um `railway up` num worktree sem link cria um projeto novo.
2. **Relay:** o coturn do `home-server` **ainda não está no ar**: este PC (outra sub-rede da casa) não alcança o servidor de
   casa. Sem ele, quem não conecta direto não assiste: o teste registra se isso acontece. Se o relay for publicado
   antes, configurar `CINEMA_TURN_*` no servidor e avisar o dono.
3. **App:** o Alga Meet normal, atualizado para a versão com o cinema (o dono e o amigo, cada um no seu PC).
4. **Espaço com E2EE:** um espaço com o dono e o amigo, com E2EE ligado. Ainda não há tela para isso: **o Maestro liga a
   flag** (`PATCH /spaces/:id { "e2ee": true }`) com a própria sessão de administrador ou por um script dele; **o dono
   nunca copia nem cola token nenhum**. A sessão de cinema numa chamada E2EE amarra as conexões diretas à chave do grupo.

## O que o dono precisa ter

- Um filme **1080p** em MKV ou MP4 (de preferência H.264 ou HEVC, 8–15 Mbps, 1–2 h).
- Um filme **4K** (HEVC, de preferência com HDR) para o segundo bloco.
- Fone de ouvido **e** caixa de som no PC do dono.
- O celular para anotar tempos e tirar fotos da tela (ou Win+Shift+S).

## Passo a passo

### Bloco 1 — 1080p, conexão direta (25 min)

1. Os dois abrem o Alga Meet, entram no espaço do teste e na mesma sala de voz. Conferir no topo da sala:
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
- Os logs do app dos dois: `%APPDATA%\Alga Meet\logs` (zip da pasta). **Atenção:** os logs podem conter o IP do amigo
  (as conexões diretas do cinema mostram o endereço de cada um): mandar só para o Maestro, não postar em lugar público.

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
