# Sala de Cinema — design

Data: 2026-11-05. Status: aprovado pelo dono em 2026-11-05. Plano: `docs/superpowers/plans/2026-11-05-sala-de-cinema-motor.md` (Plano 1: spike + motor).

Legenda: **[dono]** = decidido pelo dono na conversa. **[minha escolha]** = decisão do designer (Claude), revisável. **[pesquisa]** = número ou fato vindo da pesquisa técnica (fontes no fim). Sem marca = consequência direta das anteriores.

## 1. Intenção

Uma sala dentro da chamada do Alga Meet feita **só para assistir filme e série com os amigos**, como se todos estivessem sentados no mesmo cinema. Não é transmissão de tela com outro nome. [dono]

A dor que resolve [dono]:
- **Rave/Teleparty** exigem conta em Netflix/YouTube para cada um. "Não é algo legal."
- **Transmitir pelo Discord** um filme baixado: só quem transmite controla; os outros não pausam; ninguém vê na mesma qualidade de quem tem o arquivo.

O que tem que acontecer [dono]:
- Quem tem o arquivo escolhe o filme e ele chega em todo mundo **na melhor qualidade possível, de preferência nativa**.
- Funciona **igual YouTube**: começa rápido e vai carregando os próximos minutos enquanto todos assistem, sem travar.
- **Todo mundo controla** (pausa, volta, avança) e **todo mundo está no mesmo frame**.
- Tem que surpreender pela qualidade. Bem desenhado, temático, criativo, com sacadas, sexy e gostoso de usar. [dono]

Direção visual do app: Linear + índigo suave (memória `design-direction-linear-indigo`). Comparar sempre com o Linear. O tema de cinema entra pela **luz e pelo vocabulário**, nunca por clipart (§7.1). [minha escolha]

## 2. Objetivos

1. **Fonte: arquivo local** de quem projeta. Nada de conta em plataforma. [dono]
2. **Qualidade nativa:** o vídeo chega aos amigos sem ser recomprimido. 1080p chega 1080p, 4K chega 4K, HDR10 chega HDR10. [dono]
3. **Streaming progressivo:** primeiro frame em segundos, carregamento contínuo à frente, sem travar. [dono]
4. **Sincronia de frame:** todos no mesmo frame, diferença p95 ≤ 1 frame (§8). [dono: "mesmos frames"; número: minha escolha]
5. **Controle compartilhado:** qualquer pessoa sentada pausa, volta, avança, troca a própria legenda e o próprio áudio. [dono]
6. **Experiência de cinema:** chegada, poltronas, luzes, intervalo, fim de sessão com lembrança (§7). [dono: "temático, criativo"; forma: minha escolha]
7. **Dublado e legendado na mesma sessão:** cada pessoa escolhe a faixa de áudio e a legenda dela, no mesmo frame dos outros. [minha escolha]
8. **Séries:** próximo episódio da mesma pasta engatilhado no fim, com contagem e cancelar. [minha escolha; o dono citou "filme ou série"]
9. **Voz continua:** a call segue rolando; o volume do filme abaixa sozinho quando alguém fala. [minha escolha, aceita pelo dono na playback]
10. **Alga nunca vê nem guarda o filme:** os bytes vão de PC para PC, criptografados. [minha escolha, aceita pelo dono na playback]

## 3. Não-objetivos (esta versão)

- **YouTube, Netflix e outras plataformas.** Fase futura. [dono: "vamos focar só no arquivo baixado por enquanto"] Não fechar a porta: o player e a sincronia (§6.6) devem aceitar outras fontes depois, sem reescrever o motor.
- Catálogo, busca de filmes, sessões públicas, descoberta. A sessão existe só dentro de uma chamada. [minha escolha]
- Capas e sinopses de serviços externos (TMDB etc.). A "capa" é um frame do próprio arquivo. Evita chave de API e evita mandar o título para terceiros. [minha escolha]
- Chat de texto por cima do filme. Quem está na sala está em chamada de voz. O chat normal do app continua ao lado. Só **reações** (conjunto fixo de emojis) aparecem sobre o filme. [minha escolha: evita um canal de texto paralelo que fuja da moderação]
- Converter vídeo para quem não decodifica o codec (ex.: PC sem HEVC por hardware). Esta versão mostra um aviso claro (§6.5). [minha escolha]
- Legenda em imagem (PGS/VobSub). Esta versão aceita legendas de texto (SRT, ASS/SSA, WebVTT), embutidas ou soltas. [minha escolha]
- Dolby Atmos e áudio "bitstream" para receiver. O áudio vira PCM multicanal decodificado pelo app (até 7.1).
- Monetização. Esta versão é grátis para todos [minha escolha]. Espaço futuro: cosméticos de poltrona, temas de sala, designs de canhoto. Nada disso é construído agora.
- Mexer nos termos de uso. Fica registrado como pendência jurídica (§6.8).

## 4. Anti-objetivos (falha mesmo que "funcione")

- **Dessincronia perceptível:** alguém ri antes dos outros; alguém fica para trás em silêncio sem a sala saber.
- **Eco do filme na call:** o áudio do filme de quem usa caixa de som vazando pelo microfone dos outros.
- **Qualidade perdida em silêncio:** qualquer recompressão do vídeo sem avisar.
- **Interface por cima do filme:** controles e enfeites que disputam atenção com a tela.
- **Tema cafona:** cortina vermelha, rolo de filme, pipoca de clipart, letreiro de neon. O tema é luz, ritmo e vocabulário.
- **Frágil:** sessão que morre quando a internet de alguém oscila; arquivo estranho que trava o app de quem projeta.
- **Alga como distribuidor:** o filme passando por, ou guardado em, servidor do Alga (além do relay criptografado de §6.4).

## 5. Restrições

O que já existe e esta feature precisa respeitar (recon do código, 2026-11-05):

- **Electron 45.2.1 / Chromium 156** (`apps/desktop/package.json:33`). HEVC por hardware no Windows; AC-3, E-AC-3, DTS e TrueHD **não** tocam no Chromium. [pesquisa]
- **MSE não aceita Matroska.** Precisa remuxar para MP4 fragmentado (fMP4/CMAF). [pesquisa]
- **Sem ffmpeg no app hoje.** Só scripts de dev usam o do PATH.
- **Sem data channels hoje.** O servidor emite tokens LiveKit com `canPublishData: false` de propósito: o data channel "fugiria do SEND_MESSAGES, bloqueios e moderação" (`apps/server/src/voice.ts:56-57`). Esta feature **não** muda essa decisão (§6.4).
- **Gateway:** WebSocket JSON, limite de **120 frames/min** e **16 KiB por frame** por conexão (`apps/server/src/gateway/socket.ts:18-20`). Novos ops seguem o caminho de três edições: `ClientFrame` em `packages/shared/src/gateway.ts`, `ClientFrameSchema` e o switch em `socket.ts`.
- **Estado de chamada no servidor é em memória**, instância única (`Voice.states`, `apps/server/src/voice.ts:61-62`).
- **Renderer em sandbox com context isolation;** o preload reconstrói argumentos como dados puros; o main valida o remetente (`apps/desktop/src/main/ipc.ts`). Não existe `dialog` nem `protocol.handle` ainda.
- **CSP** permite `media-src blob: mediastream:` e `worker-src blob:` (`renderer/index.html:9`, espelhado em `main/security.ts`).
- **E2EE (MLS)** opcional por chamada; o exporter aceita qualquer label (`native/mls/src/lib.rs:658-669`), mas o renderer não tem acesso a ele.
- **Permissão `STREAM`** já existe para transmitir em espaços (`packages/shared/src/permissions.ts:17`).
- **Pt-BR via `strings.ts` por feature;** tokens visuais em `styles/tokens.css`; motion em `ui/motion.ts`; Eco em `ui/eco/Eco.tsx` com regras de `docs/brand/mascote/eco.md`.
- **Testes:** Vitest (desktop e servidor); Playwright dirigindo instâncias reais do Electron nos scripts (`apps/desktop/scripts/media-lab.mjs`); multiusuário local com `npm run dev -- --profiles=bob,carol`; degradação de rede com `scripts/netem/udp-impair.mjs`.
- **Internet de quem projeta é o gargalo:** fibra no Brasil costuma ter upload = metade do download (ex.: 500/250); cabo coaxial pode ter só 35–50 Mbps de upload. [pesquisa] Bitrates típicos: web 1080p 5–10 Mbps; remux Blu-ray 1080p 25–40; remux 4K 50–100. [pesquisa]

## 6. Como funciona

### 6.1 Visão geral [minha escolha]

```
PC de quem projeta                       Servidor Alga                    PC de cada amigo
───────────────────                      ─────────────                    ────────────────
arquivo local                            sessão (estado, relógio,         player MSE
  → ffmpeg (remux, áudio,                 permissões, reações)              ← peças do enxame
    legendas, capa)                        ↑↓ gateway (comandos,            → sincronia pelo
  → peças fMP4 ─── P2P (WebRTC, DTLS) ───── sinalização P2P) ─────────────    relógio do servidor
                     enxame: cada um repassa o que já tem
```

- **Plano de controle:** gateway do Alga. Abre/fecha sessão, quem sentou, comandos (play, pausa, pular), reações, relógio, sinalização WebRTC. O servidor é a autoridade do estado.
- **Plano de dados:** conexões WebRTC diretas entre as pessoas sentadas (malha completa). Carregam só peças do filme e mensagens binárias do protocolo do enxame. Nada de texto livre.
- **Cada um decodifica o filme no próprio PC**, inclusive quem projeta (mesmo caminho para todos, mesma latência de player).

### 6.2 A sessão no servidor [minha escolha]

**Estado em memória, uma sessão por chamada** (canal de voz de espaço, DM ou grupo), ao lado de `Voice.states`:

- `sessionId`, `channelId`, `hostId`, `createdAt`.
- **Ficha do filme**, enviada por quem projeta: título (editável), duração, resolução, HDR, codec de vídeo, faixas de áudio (idioma, canais, codec original), faixas de legenda, capítulos, índice de peças (duração de cada peça), tamanho total. **Nunca o caminho local do arquivo.**
- **Reprodução:** `playing`, `position` (segundos de mídia), `at` (tempo do servidor em que `position` vale), `rate` (sempre 1 fora de correção local), `seq`, `by` (quem fez a última ação), `reason` (`user`, `waiting:<userId>`, `intermission`, `host_away`).
- **Poltronas:** quem sentou, estado de cada um (`preparing`, `ready`, `stalled`), buffer à frente em segundos (atualizado no máximo a cada 2 s), codec suportado ou não.
- **Opções:** `controlLock` (só quem projeta controla; padrão **desligado** [dono: "todo mundo controla"]), `waitForStalled` (padrão **ligado**, §6.6).
- **Reações:** lista em memória `(userId, emoji, mediaPosition, serverTime)` para o mapa de calor e o canhoto. Some quando a sessão acaba.

**Regras:**
- **Abrir:** precisa estar na chamada e, em espaço, ter `STREAM`. Em DM/grupo, qualquer participante. Uma sessão por chamada; abrir outra pede para encerrar a atual.
- **Sentar:** qualquer participante da chamada. Máximo **8 poltronas** [minha escolha: malha de 8 = 28 conexões; o dono estimou salas de 2 a 6].
- **Controlar:** quem está sentado (ou só quem projeta, com `controlLock`).
- **Encerrar:** quem projeta; em espaço, também quem tem `MUTE_MEMBERS` ou `MOVE_MEMBERS` (moderação).
- **Sair da chamada** = levantar da poltrona.
- **Quem projeta sai ou cai:** a sessão pausa com `reason: host_away` e "A sessão continua quando a Ana voltar". Depois de **2 min** sem volta, a sessão termina (com canhoto). Não existe troca de projetista: o arquivo está no PC dele.
- **Reiniciou o servidor:** sessão perdida. Os clientes mostram "A sessão caiu" e quem projeta reabre com "Continuar de 1:02:13" (§7.4).

**Gateway (novos ops, nomes do builder):** abrir/encerrar, sentar/levantar, status da poltrona, comando de reprodução, reação, sinalização WebRTC (para um destinatário da mesma sessão), ping de relógio. Dispatches: estado da sessão, sinal WebRTC, reação. Os ops do cinema têm **orçamento de frames próprio**, como os de E2EE já têm: estourar os 120 frames/min hoje fecha o socket inteiro (`socket.ts:216-219`), e o cinema não pode derrubar a conexão de ninguém. Mesmo assim: candidatos ICE agrupados, scrub da timeline só envia o comando ao soltar, status no máximo a cada 2 s, reação com limite próprio (ex.: 1/s, rajada de 5).

**Versões antigas do app na mesma chamada:** só clientes com suporte ao cinema veem o cartão e sentam. Os outros seguem na call normalmente. O builder decide como o servidor sabe a capacidade do cliente.

**Flag de servidor:** a feature liga por configuração (padrão do projeto em `apps/server/src/config.ts`), ligada no staging.

**Benefício "cinema" da Casa:** não mexer nesta entrega. É um benefício pago planejado no plano de crescimento (stream 1080p60 do espaço, `catalog.ts:203-205`, `CASA_CINEMA`), não só um rótulo velho. O dono não conhecia; decidir junto com a trilha de monetização se ele some, muda de nome ou vira um extra desta sala. [minha escolha]

### 6.3 Preparar o arquivo no PC de quem projeta

**ffmpeg empacotado no app.** [minha escolha]
- Build **LGPL** (nunca GPL nem `nonfree`); de preferência um build mínimo só com o necessário (demux Matroska/MP4/MOV/WebM/TS, decoders de áudio de cinema, encoders AAC/Opus/FLAC, legendas de texto, muxer HLS fMP4). Alternativa aceitável: build `lgpl` do BtbN. [pesquisa]
- Fora do asar (`extraResources`), com o **mesmo status de assinatura do app**: hoje o app não é assinado (ADR 0003 espera o certificado); quando o certificado chegar, o `ffmpeg.exe` é assinado junto. [pesquisa; minha escolha]
- **Antivírus pode bloquear o executável.** Ao escolher o arquivo, o main confere que o ffmpeg abre (versão) antes de qualquer coisa. Se falhar, mensagem clara: "O antivírus bloqueou o componente de vídeo do Alga", com o caminho e o que fazer. Nunca um "não deu" mudo. [minha escolha]
- Meta de tamanho: **≤ 40 MB a mais no instalador** (hoje 109 MiB).
- Roda **só no processo main**, com argumentos em array (nunca string montada com texto do usuário), timeout e limite de prioridade para não travar o PC de quem projeta.

**Passo 1 — Ler a ficha (≤ 2 s para arquivos com índice).** `ffprobe` (ou ffmpeg) devolve streams, capítulos, duração e anexos. A partir daí:
- **Título:** limpar o nome do arquivo (`Duna.Parte.Dois.2024.2160p.WEB-DL.DDP5.1.HDR.mkv` → "Duna Parte Dois (2024)"); quem projeta pode editar.
- **Série:** reconhecer `S01E02`, `1x02` e parecidos; listar os próximos episódios **da mesma pasta** (§7.4).
- **Capa:** 3 frames candidatos (por volta de 10%, 25% e 40% do filme), escolher o de melhor exposição; 960 px WebP. [minha escolha]
- **Capítulos:** marcadores na timeline; capítulo chamado "Opening/Intro/Abertura/OP" habilita **Pular abertura**; "Credits/Créditos/ED" antecipa o próximo episódio.

**Passo 2 — Regras de compatibilidade (o que muda e o que não muda).**

| Entrada | O que acontece |
|---|---|
| Vídeo H.264, HEVC 8/10-bit, AV1, VP9 | **Cópia exata** (sem recomprimir). |
| HDR10, HLG | Cópia; tela HDR mostra HDR; tela SDR recebe tone-mapping do Chromium. [pesquisa] |
| Dolby Vision perfil 8 | Toca como HDR10 (Chromium 122+). [pesquisa] |
| Dolby Vision perfil 5 | **Não toca certo** (cores erradas). Avisar quem projeta antes de abrir: "Este arquivo é Dolby Vision perfil 5. Procure uma versão HDR10 ou SDR." [pesquisa] |
| MPEG-2, VC-1, outros | Não suportado nesta versão; aviso claro. |
| Áudio AAC, Opus, FLAC, MP3 | Cópia. |
| Áudio AC-3, E-AC-3, DTS (com perda) | Convertido **só o áudio** para multicanal de alta taxa (AAC 5.1 ~640 kbps ou Opus), mantendo os canais. [pesquisa] |
| Áudio TrueHD, DTS-HD MA (sem perda) | **FLAC multicanal** (sem perda) se o spike confirmar FLAC 5.1/7.1 no MSE; senão AAC de alta taxa. [pesquisa: FLAC em fMP4 via MSE desde Chrome 62] |
| Legendas SRT, ASS/SSA, WebVTT | Extraídas; fontes anexadas do MKV também. |
| Legendas PGS/VobSub | Ignoradas nesta versão; o menu mostra "Legenda em imagem: ainda não suportada". |

A ficha mostra a verdade: "Vídeo nativo · 4K · HDR10 · HEVC" e "Áudio 5.1 · Dolby Digital → AAC 5.1". Nada é convertido sem aparecer escrito.

**Passo 3 — Gerar as peças.** Vídeo copiado + áudio em **segmentos fMP4/CMAF separados** (vídeo de um lado, cada faixa de áudio do outro), cortados nos keyframes (`-c:v copy`, HLS `fmp4`, `-hls_time 4`; a duração real segue o GOP). [pesquisa] Separar áudio de vídeo é o que deixa cada pessoa escolher a própria faixa (§2.7): só as faixas que alguém escolheu são convertidas, e só elas viajam.
- Ordem: começa pelo ponto de partida (início ou "continuar de"), segue em frente; pulo para trecho não gerado reinicia a geração naquele ponto com o mesmo índice de peças (como o Jellyfin faz com transcodificação sob demanda). [pesquisa]
- O **índice de peças** (início e duração de cada uma) é fixado antes de abrir a sessão, a partir dos keyframes, para que qualquer reinício gere peças com os mesmos limites. O builder escolhe como extrair os keyframes rápido (Cues do MKV, `ffprobe -skip_frame nokey`).
- **Disco:** peças em pasta temporária com orçamento (padrão: o menor entre o tamanho do arquivo e 20% do espaço livre). Fora do orçamento, apaga as mais antigas que já foram distribuídas. Pasta apagada no fim da sessão e na próxima abertura do app (caso de crash).
- **Miniaturas da timeline:** em segundo plano, uma imagem pequena a cada 10 s (sprite), distribuída pelo enxame. [minha escolha]

**Passo 4 — Legendas soltas.** Quem projeta pode arrastar um `.srt`/`.ass` para a sessão a qualquer momento; vira uma faixa para todos. **Detectar codificação** (muitos `.srt` brasileiros vêm em Windows-1252/ISO-8859-1): nada de "Ã©" na tela. [minha escolha]

**Escolha do arquivo:** botão abre o seletor nativo pelo main (novo IPC com `dialog.showOpenDialog`); arrastar um vídeo para o palco da chamada também funciona (`webUtils.getPathForFile` no preload). O renderer nunca recebe permissão de ler disco à vontade; o main guarda o caminho e devolve um id de sessão local.

### 6.4 Distribuição P2P (o enxame)

**Transporte:** `RTCPeerConnection` com data channels binários entre as pessoas sentadas, em malha completa. [minha escolha] Isso **não** reabre os data channels do LiveKit: são conexões próprias da sala, e o protocolo só aceita mensagens binárias tipadas (mapa de peças, pedido, pedaço de peça, estatística). Nenhum texto livre trafega por aí; reações e comandos vão pelo gateway, com as regras do servidor.

**Enxame (como um torrent pequeno):** [pesquisa]
- Peça = um segmento fMP4. Envio em pedaços de 64–224 KiB, com controle de `bufferedAmount` (alto ~256 KiB, baixo ~128 KiB).
- **Janela crítica** (próximos ~30 s de cada pessoa): em ordem, da fonte mais rápida.
- Depois dela: **mais rara primeiro**, para espalhar.
- **Quem projeta faz "super-seed":** manda cada peça uma vez para alguém e deixa os amigos repassarem. Upload de quem projeta cai para ~1–1,5× o bitrate em vez de N×.
- Pré-carregar o filme inteiro em segundo plano quando o cache permitir.
- Uma conexão por par aguenta ~57 Mbps com 20 ms de latência; mais fontes somam. Se uma única conexão não der conta (remux 4K), o builder pode abrir uma segunda conexão por par. [pesquisa]

**Quando duas pessoas não conseguem se conectar direto:** a peça chega por um terceiro que alcança as duas (o enxame já faz isso). Se alguém não alcança **ninguém**, usa **TURN** como relay. [minha escolha]
- O LiveKit tem TURN embutido, mas ele só aceita credenciais do próprio LiveKit. A sala usa um **coturn no servidor de casa do dono** (`home-server`, ao lado do SFU de staging, kit `infra/home-sfu/`), com credenciais temporárias emitidas pelo servidor por sessão. [dono: "o servidor daqui de dentro de casa mesmo, por enquanto"] Quando existir SFU de produção, o relay muda junto.
- **Teto de banda: ~30 Mbps somando todos os relays** (o upload da casa é 220 Mbps e também carrega as calls). Ao bater o teto, quem precisaria de relay vê um aviso claro em vez de degradar as calls de todo mundo. [minha escolha no número]
- O relay só vê bytes criptografados (DTLS).
- **Custo:** um relay carrega o filme inteiro para aquela pessoa (~4–18 GB por filme). Métrica de bytes relayados obrigatória. ~15–25% das sessões 1:1 precisam de relay segundo fornecedores (número fraco). [pesquisa] O spike mede a taxa real no grupo de amigos.
- Porta e regras de firewall do coturn seguem o padrão do kit de casa (UPnP, sem sudo onde der; o que precisar de sudo vira passo do dono).

**Criptografia:**
- Data channels WebRTC já são criptografados de ponta a ponta com DTLS entre os PCs.
- **Em chamada E2EE,** cada lado autentica a impressão digital DTLS do SDP com uma chave derivada do grupo MLS (label própria, ex.: `"Alga Cinema v1"`, contexto = `sessionId`). Assim nem o servidor consegue se colocar no meio. Precisa de um método novo no bridge E2EE (hoje o renderer não acessa o exporter). [minha escolha]
- Sem E2EE na chamada: DTLS com fingerprints trocadas pelo servidor, mesma confiança do resto do app.

**IP:** conexão direta revela o IP público entre quem está sentado. Na primeira vez que alguém senta, um aviso curto: "Na sala de cinema seu PC conecta direto com quem está assistindo." Quem bloqueou alguém nunca conecta direto com essa pessoa: as peças passam por um terceiro ou pelo relay. [minha escolha]

### 6.5 Reprodução

- **Player:** `<video>` + **MSE** com dois `SourceBuffer` (vídeo e a faixa de áudio escolhida). Mesmo player para quem projeta e para os amigos. [pesquisa]
- **Buffer:** o enxame guarda peças num cache próprio; o `SourceBuffer` recebe ~60 s à frente (o MSE do Chromium tem cota pequena). Meta: **≥ 10 min à frente** de um remux 1080p (40 Mbps), ou o filme todo se couber, com o cinema usando **≤ 1,5 GB de RAM**. Se precisar de mais, cache em disco temporário pelo main, apagado no fim. [minha escolha]
- **Teste ao sentar:** `MediaSource.isTypeSupported` + decodificar o primeiro segmento. HEVC no Windows é **só por hardware** (NVIDIA GTX 645+, Intel HD 4400+, AMD RX 460+). [pesquisa] Sem suporte: a poltrona mostra "Seu PC não decodifica HEVC" e a pessoa não entra nesta sessão, mas segue na call. Quem projeta vê isso **na ficha antes de abrir**, para cada pessoa da chamada.
- **Legendas:** SRT/WebVTT renderizadas por um overlay próprio (tipografia do design system, contorno discreto, tamanhos P/M/G, sobe quando os controles aparecem). ASS/SSA com **JASSUB** (libass em WASM, worker + OffscreenCanvas), limitado a 1080p de renderização. [pesquisa] Cada pessoa escolhe a faixa, o tamanho e um ajuste de atraso (±0,1 s) **só para si**.
- **Miniplayer:** saiu da tela da chamada (foi para o chat, por exemplo), o filme continua no `MiniPlayer` existente (`features/voice/MiniPlayer.tsx`), sincronizado.

### 6.6 Sincronia

**Relógio:** o servidor é a referência. [minha escolha] Cada cliente estima a diferença do relógio dele para o do servidor no estilo NTP, por um op de ping no gateway: guarda 8–16 amostras e usa a de menor ida e volta; 1 ping/s nos primeiros segundos, depois a cada 15 s (cabe no limite de 120/min). [pesquisa: Jellyfin SyncPlay]
- Se o spike mostrar erro acima da meta (§8), refinar com ping P2P até quem projeta. O builder decide.

**Comandos agendados:** todo comando vira "a partir do instante `at` do servidor, a posição é `position` e o estado é tocando/pausado". O servidor marca `at` = agora + folga (padrão 250 ms; aumenta com a pior latência da sala). [pesquisa: SharePlay e Jellyfin agendam o play no futuro]
- **Pausa:** todos param **no mesmo frame**: a posição de pausa é calculada pelo servidor; quem passou um pouco volta exatamente para ela.
- **Play depois de pausa longa** (> 15 s): contagem curta de 3 s na tela para ninguém perder a fala. [minha escolha]
- **Pular:** o scrub é local (com miniaturas); o comando sai ao soltar. Toast para todos: "Ana pulou para 1:12:40 · Desfazer" (qualquer pessoa desfaz por 8 s). [minha escolha]

**Correção contínua:** [pesquisa]
- Medir o frame realmente exibido com `requestVideoFrameCallback` (`mediaTime`), não `currentTime`.
- Erro = `mediaTime` − posição esperada para aquele `expectedDisplayTime`, mediana dos últimos ~10 frames.
- **< 20 ms:** nada.
- **20–500 ms:** ajustar `playbackRate` em 1 ± min(erro/3 s, 5%), com `preservesPitch` ligado.
- **> 500 ms ou sem convergir em 5 s:** pausar, pular para o alvo (somando a latência de seek aprendida naquele PC) e retomar no instante agendado.
- **Fone Bluetooth:** compensar `AudioContext.outputLatency` para o áudio de cada um sair junto com a imagem.

**Quem trava:** [pesquisa: SharePlay "suspension"; minha escolha nos números]
- Com `waitForStalled` ligado (padrão): se alguém fica sem buffer por **> 2 s**, a sala pausa com "Esperando a Ana" e a poltrona dela mostra o progresso. Volta sozinha (com contagem de 3 s) quando ela tiver ≥ 10 s à frente. Qualquer um pode tocar em "Continuar sem a Ana"; ela entra de novo no frame atual quando carregar.
- Desligado: os outros seguem e quem travou volta direto para o frame da sala.
- **Começo, pulo e volta do intervalo** esperam todos ficarem prontos, com limite de 10 s.

**Entrar no meio:** carregar a partir da posição atual, entrar no frame da sala em ≤ 8 s.

### 6.7 Áudio

- O som do filme passa por um nó de ganho WebAudio próprio, separado da call. **Dois volumes:** filme e vozes. [minha escolha]
- **Abaixar o filme quando alguém fala** (ligado por padrão, desligável): −10 dB, ataque 150 ms, soltura 700 ms, usando a detecção de fala que a call já tem (`engine.ts`, `features/voice/levels.ts`). [pesquisa: "smart volume" do SharePlay]
- **Eco do filme:** quem usa caixa de som tem o filme captado pelo microfone. Cada um já ouve o próprio filme sincronizado, então esse vazamento chega aos outros como eco atrasado. **O spike precisa medir** se o cancelamento de eco do Chromium usa o áudio de `<video>`/WebAudio como referência. Se não usar, tentar caminhos dentro do Chromium (ex.: rotear o áudio do filme por um caminho que o AEC enxerga) por tempo limitado.
- **Se nenhum caminho dentro do Chromium resolver, a sala sai assim mesmo** [dono]: na primeira sessão (e sempre que a pessoa estiver sem fone, se der para saber pelo dispositivo de saída), aviso "Use fone para os outros não ouvirem o filme pelo seu microfone" e a sugestão de falar apertando. A correção completa (caminho de áudio nativo) vira fase futura. Nesse caso o critério de eco do §8 vira meta da fase futura, não bloqueio.

### 6.8 Segurança, privacidade, moderação e legal

- **Arquivo nunca sai do PC** de quem projeta a não ser como peças para as pessoas sentadas. O servidor só vê metadados (título editável, duração, faixas). O caminho local nunca sai do main.
- **Entrada hostil:** o arquivo é dado não confiável. ffmpeg só no main, argumentos em array, timeout, limite de memória quando possível, prioridade baixa. Nome do arquivo e metadados são texto não confiável na UI (nunca HTML). Peças recebidas de pares são validadas (tamanho máximo, índice existente, hash por peça enviado por quem projeta junto com o índice).
- **Hash por peça:** quem projeta publica o SHA-256 de cada peça no índice (conforme gera); quem recebe de um terceiro confere antes de usar. Um par malicioso não injeta vídeo. [minha escolha] Se uma peça for gerada de novo (pulo, orçamento de disco), ela precisa sair com os mesmos bytes ou ganhar uma nova versão/hash que invalida a antiga nos pares; o builder escolhe.
- **Moderação:** abrir exige `STREAM` em espaço; moderadores encerram; denúncia em "⋯ › Denunciar sessão" usa o fluxo de T&S existente (quem projetou, título, horário; nunca conteúdo). Reações seguem limite e bloqueios.
- **Presença:** a atividade mostra "Numa sessão de cinema", **sem o título**. O título só aparece para quem está na chamada. [minha escolha]
- **Legal:** o Alga não hospeda nem distribui o filme; a responsabilidade pelo conteúdo é de quem projeta. Registrar como pendência para os termos (mexer em termos muda `LEGAL_VERSIONS` e pede novo aceite; fora desta entrega). Atualizar `docs/decisions/0004-e2ee.md` com uma nota curta sobre o cinema.

## 7. A experiência

### 7.1 Princípio: o tema é a luz [minha escolha]

Num cinema de verdade, a luz conta o que está acontecendo: acesa na chegada, apagando quando começa, meia-luz no intervalo, acendendo devagar nos créditos. A sala usa **o mesmo idioma**:

| Momento | Luz da sala (o entorno da tela) |
|---|---|
| Chegada (foyer) | Acesa: fundo normal do app |
| Começou | Apaga em ~1,2 s até preto quase puro; a interface some |
| Pausa | Meia-luz (sobe ~35%) |
| Intervalo | Acesa |
| Fim | Acende devagar (~3 s) |

A luz é **funcional**: dá para saber o estado da sala de relance. Nada de cortina, rolo de filme ou pipoca de clipart. Paleta Linear + índigo; o índigo só aparece em estado (poltrona falando, progresso, foco).

**Luz da tela** (sacada; revisável): um campo de cor muito suave, tirado das bordas do frame ~4 vezes por segundo e interpolado, vaza para o entorno escuro, como a luz do telão batendo na sala. Intensidade baixa (≤ 12% de opacidade), desligável, desligada com movimento reduzido. [minha escolha; precedente: modo ambiente do YouTube, 2022] Fica na lista do §12 porque a direção visual pede cuidado com brilho.

### 7.2 Vocabulário [minha escolha]

Sessão · poltrona · sentar · **projetar** ("Ana está projetando") · intervalo · créditos · canhoto. Usado com parcimônia; botões continuam diretos ("Pausar", "Legendas").

### 7.3 Jornada

**1. Projetar.** Na chamada, o dock ganha o botão **Cinema** (ao lado de transmitir). Também: arrastar um vídeo para o palco ("Projetar *Duna Parte Dois* para a sala?") e o Ctrl+K.

**2. A ficha (só quem projeta, segundos).** Capa, título editável, chips técnicos ("4K · HDR10 · HEVC · 5.1 · 2h46"), faixas de áudio e legenda encontradas, avisos (DV perfil 5, quem da chamada não decodifica o vídeo, bitrate alto para o upload). Botão **Abrir sessão**.

**3. O foyer (todos).** A chamada vê um cartão "Ana abriu uma sessão: *Duna Parte Dois* · 2h46 · 4K" com **Sentar**. Ao sentar:
- A capa ocupa a tela, desfocada atrás, nítida no centro; título e chips técnicos.
- Embaixo, a **fileira de poltronas**: cada pessoa sentada aparece no lugar dela, com um anel fino de preparo (carregando, decodificador testado). Fica índigo quando está pronta.
- Cada um escolhe áudio e legenda ali mesmo ("Dublado · Português 5.1" / "Original · Inglês 5.1").
- Sala vazia: o **Eco** espera na fileira, dentro das regras do mascote (só olhos e antenas mudam): "Esperando a galera sentar". Quando alguém senta, ele faz `hop`. [minha escolha]
- Quem projeta toca **Começar** (habilitado quando todos estão prontos; "Começar mesmo assim" depois de 10 s).

**4. As luzes apagam.** Instante agendado pelo servidor, igual em todos: a interface some, a sala escurece (~1,2 s), contagem discreta de 3 s (um anel fino, sem números gigantes), e o primeiro frame aparece **ao mesmo tempo para todos**. Um som curto e original do sistema de cues do app marca o início (desligável junto com os outros sons). [minha escolha]

**5. Assistindo.**
- Tela cheia dentro da janela; a barra lateral do app recolhe ("modo sala"). `F` vai para tela cheia de verdade.
- **Tudo some** depois de 2 s sem mexer o mouse. Ao mexer, aparecem: em cima, título e chip "Nativo · 4K HDR"; em baixo, timeline e controles; e a fileira de poltronas.
- **Poltronas durante o filme:** finas, embaixo, quase invisíveis. Quando alguém fala, a poltrona dele acende com o mesmo brilho de fala da call, **mesmo com a interface escondida** — dá para saber quem falou sem tirar o olho do filme.
- **Reações:** `R` ou o botão abre 6 emojis; a reação sobe da poltrona de quem reagiu e some em ~1,6 s. Aparece para todos no mesmo frame.
- **Chip de sincronia** (canto superior direito, só com a interface visível): ponto índigo + "Em sincronia". Passando o mouse: "4 de 4 · ±6 ms".

**6. Timeline social.**
- Faixas de quanto já carregou no enxame.
- Marcadores de capítulo; **Pular abertura** quando o capítulo existe.
- **Mapa de calor de reações**: onde a sala mais reagiu (fica bonito em reprise e no canhoto).
- Miniaturas ao arrastar.

**7. Pausa.** Meia-luz. Na tela: "Pedro pausou" com o avatar dele e o tempo. O frame congelado é **o mesmo para todos**.

**8. Intervalo.** Pausa > 3 min vira **Intervalo**: luz acesa, a capa volta suave, "Faltam 1h12". As poltronas crescem um pouco (é hora de conversar). Para voltar: **Pronto** em cada poltrona; quando todos estão prontos (ou 10 s depois de alguém pedir), contagem de 3 s e luzes apagam de novo. [minha escolha]

**9. Esperando alguém.** "Esperando a Ana" + anel de progresso na poltrona dela + "Continuar sem a Ana" (§6.6).

**10. Créditos e fim.**
- **Série:** ao entrar no capítulo de créditos (ou nos últimos 30 s), aparece "Próximo: S01E03 — *Título* em 10 s · Cancelar". Quem projeta já preparou o próximo arquivo em segundo plano. Continua na mesma sessão, mesmas poltronas. [minha escolha]
- **Filme:** as luzes acendem devagar e aparece o **canhoto**: um cartão no formato de canhoto de ingresso com a capa, título, data, as poltronas (quem estava), tempo assistido junto, total de reações e **o momento mais reagido** (frame daquele instante + minutagem). Botões: **Copiar imagem** (cola em qualquer chat do app, que já aceita colar imagem) e **Salvar**. [minha escolha]

**11. Voltar depois.** Quem projeta guarda localmente a posição por arquivo. Abrir o mesmo arquivo de novo oferece "Continuar de 1:02:13". [minha escolha]

### 7.4 Controles e atalhos

`Espaço` pausa/toca · `←`/`→` 10 s · `Shift+←/→` 60 s · `F` tela cheia · `C` legendas · `A` faixa de áudio · `M` muda o filme (só para si) · `↑`/`↓` volume do filme · `R` reações · `S` estatísticas · `Esc` sai da tela cheia.

**Estatísticas (`S`):** codec, resolução, bitrate, buffer à frente, de onde vêm as peças (quem projeta vs. amigos, %), relay em uso, erro de sincronia p95, frames descartados. É o que prova a qualidade para quem gosta de número.

### 7.5 Movimento e acessibilidade

- Durações e curvas do design system (`ui/motion.ts`); luzes usam a curva de painel (300 ms) ou mais lenta onde §7.1 diz.
- `prefers-reduced-motion`: luzes trocam sem fade, reações aparecem sem subir, luz da tela desligada, contagem vira texto.
- Todos os controles por teclado e leitor de tela; toasts de ação ("Pedro pausou") anunciados em região `aria-live` educada.
- Contraste das legendas garantido com contorno; tamanho G para quem precisa.

## 8. Números de aceitação

Medidos com instâncias reais do Electron (padrão `media-lab.mjs`), em rede local e no teste real entre casas.

| Critério | Meta |
|---|---|
| Vídeo nativo | Amostras de vídeo nas peças idênticas às do arquivo (sem recompressão), verificado por teste |
| Primeiro frame | ≤ 10 s de "Abrir sessão" a todos vendo, com 1080p web (8 Mbps), upload de quem projeta ≥ 20 Mbps |
| Sincronia | Diferença entre quaisquer dois clientes, p95 ≤ 1 frame (≤ 42 ms a 24 fps) após 10 s; nunca > 3 frames por mais de 1 s |
| Pausa | Todos param no mesmo frame em ≤ 300 ms |
| Entrar no meio | ≤ 8 s até sincronizado |
| Travamentos | Zero numa sessão de 2 h com 4 pessoas, upload de quem projeta ≥ 1,5× o bitrate |
| Eco | Com caixa de som, filme vazando pelo microfone atenuado ≥ 30 dB e inaudível para os outros |
| RAM | Cinema ≤ 1,5 GB por cliente |
| Instalador | ≤ 40 MB a mais |

## 9. Riscos e spike inicial

Antes de construir a interface, um **spike descartável** responde com números (vira `docs/benchmarks/cinema-spike.md`):

1. **MSE no Electron 45:** HEVC 10-bit HDR10, AV1, H.264 em fMP4; áudio AAC 5.1, Opus 5.1, FLAC 5.1/7.1 — `isTypeSupported` **e** reprodução real.
2. **ffmpeg LGPL:** remux de MKVs de exemplo para HLS fMP4 (velocidade de cópia, velocidade da conversão de áudio, tempo para o índice de keyframes de um arquivo de 2 h).
3. **Data channel** entre duas casas (dono + amigo): Mbps com 1 e 2 conexões; quantas vezes precisou de relay.
4. **Relógio pelo gateway** contra o staging: distribuição do erro de offset; erro entre clientes medido com rVFC.
5. **Eco:** áudio do filme com caixa de som vaza na call?

Se (4) falhar a meta: ping P2P até quem projeta. Se (5) vazar: tentar os caminhos do §6.7 por tempo limitado; sem solução, segue com aviso de fone [dono]. Se (1) reprovar FLAC multicanal: AAC de alta taxa.

Outros riscos:
- **HEVC só por hardware**: amigo com GPU antiga fica de fora (aviso claro; conversão é fase futura).
- **Upload fraco de quem projeta** (cabo coaxial com 35–50 Mbps): o enxame alivia; a ficha avisa quando o bitrate é alto demais para o número de pessoas.
- **Relay no servidor de casa**: disputa o upload com as calls; teto e métrica obrigatórios (§6.4). Se a casa cair, quem depende do relay cai junto.
- **Banda e CPU de quem projeta jogando ao mesmo tempo**: fora do escopo; ffmpeg roda com prioridade baixa.

## 10. Fases sugeridas

1. **Spike** (§9).
2. **Motor:** sessão no servidor + ops do gateway; ffmpeg e peças no main; enxame P2P; player MSE; sincronia; atrás de flag, com uma UI crua de teste.
3. **Experiência:** ficha, foyer, poltronas, luzes, controles, timeline social, reações, intervalo, esperando alguém, créditos/próximo episódio, canhoto, estatísticas.
4. **Endurecer:** 4 instâncias com `netem`; teste real entre casas; capturas no padrão `docs/screenshots/`; métricas do §8; nova versão do desktop.

## 11. Fica com o builder

- Nomes dos ops, formato exato das mensagens do enxame e do índice de peças.
- Como o main entrega peças ao renderer (IPC com `ArrayBuffer` ou protocolo próprio com `protocol.handle`), desde que sem base64 e sem copiar o filme inteiro para a RAM do renderer.
- Algoritmo do enxame além das regras de §6.4.
- Build exato do ffmpeg (mínimo ou BtbN `lgpl`), dentro das metas de tamanho e licença.
- Detalhes do deploy do coturn no kit de casa, dentro do teto de §6.4.
- Layout fino, ícones e microcopy, sempre comparando com o Linear e dentro das regras do Eco.

## 12. Decisões que tomei (para o dono conferir)

1. **Luz da tela** (cor do filme vazando de leve para o entorno) ligada por padrão, bem suave. A direção visual pede cuidado com brilho; posso deixar desligada por padrão.
2. **Sem chat de texto sobre o filme**; só reações. A conversa é por voz e pelo chat normal.
3. **Cada pessoa escolhe a própria faixa de áudio e legenda** (dublado e legendado na mesma sessão).
4. **Grátis para todos** nesta versão; cosméticos de sala ficam para depois.
5. **Máximo de 8 poltronas.**
6. **Esperar quem trava** por padrão, com "Continuar sem a Ana".
7. **Teto de ~30 Mbps** para o relay no servidor de casa (onde o relay roda foi decisão sua).
8. **Aviso de IP** na primeira vez que alguém senta; bloqueados nunca conectam direto.
9. **Presença sem título do filme.**
10. **Benefício "cinema" da Casa fica como está** por enquanto; decidir com a monetização.
11. **ffmpeg dentro do instalador** (até +40 MB) em vez de baixar na primeira vez; sem assinatura até o app ter certificado, com checagem de bloqueio por antivírus.

## Fontes da pesquisa

- HEVC no Chromium/Electron: https://github.com/StaZhu/enable-chromium-hevc-hardware-decoding
- AC-3/E-AC-3 fora do Chromium: https://github.com/cjw1115/enable-chromium-ac3-ec3-system-decoding
- FLAC em fMP4 via MSE: https://beaufortfrancois.github.io/samples/media/flac-in-mp4-for-mse.html
- Opus em MSE: https://developer.chrome.com/blog/media-updates-in-chrome-70
- ffmpeg LGPL (BtbN): https://github.com/BtbN/FFmpeg-Builds
- JASSUB: https://github.com/ThaUnknown/jassub
- Syncplay: https://raw.githubusercontent.com/Syncplay/syncplay/master/syncplay/constants.py
- SharePlay / AVPlaybackCoordinator: https://developer.apple.com/videos/play/wwdc2021/10225/
- requestVideoFrameCallback: https://web.dev/articles/requestvideoframecallback-rvfc
- Throughput de data channel no Chromium: https://groups.google.com/g/discuss-webrtc/c/NCZLRRMmb1s/m/3W7D36n0AwAJ
- WebTorrent, peças críticas: https://github.com/webtorrent/webtorrent/issues/375
- Upload no Brasil: https://tecnoblog.net/noticias/claro-reduz-velocidade-de-upload-em-plano-de-internet-fixa/
- Modo ambiente do YouTube: https://9to5google.com/2022/10/24/youtube-ambient-mode/
