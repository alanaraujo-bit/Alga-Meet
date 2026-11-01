# Benchmark: cliente Discord para Windows (a barra a superar)

> Pesquisa feita em 2026-11-01. Cliente observado: Discord `app-1.0.9266` (Windows 11 Pro 10.0.26300, i5-13600KF, RTX 3070, 32 GB).
>
> **Legenda das tags**
> - **[FATO]**: confirmado por fonte oficial ou primária (URL indicada).
> - **[MEDIDO]**: medido nesta máquina (método indicado).
> - **[RELATO]**: relatos de usuários, fóruns ou imprensa (URLs indicadas).
> - **[HIPÓTESE]**: inferência (o motivo é dado).
>
> O que não foi verificado aparece como "não verificado". Não inventamos números.
>
> **Limitação de método:** `support.discord.com` responde HTTP 403 a buscadores automáticos. Os dados dessas páginas vieram de trechos indexados pela busca, não da página completa. Antes de usar um número como contrato, confira a página ao vivo.

---

## Resumo executivo: a barra a superar

1. **Voz:** Opus 48 kHz estéreo, até 96 kbps sem boost e até 384 kbps com boost nível 3. Krisp grátis no dispositivo. E2EE (DAVE) obrigatório em todas as chamadas desde 1º de março de 2026.
2. **Rede:** SFU próprio em C++ com relay obrigatório, que esconde o IP. Retomada de sessão (`Resume`) e troca automática de servidor em falhas ou DDoS.
3. **Go Live:** grátis limitado a 720p/30fps. Nitro chega a 1080p60 ou 4K60 (as fontes divergem). Máximo de 50 espectadores. Codec negociado VP8/H.264, com HEVC/AV1 só em algumas plataformas.
4. **Recursos:** cerca de 808 MB de memória privada com o app parado na bandeja, em 6 processos Electron. A própria Discord admite que o app deveria ficar abaixo de 1 GB. Ela testa reinício automático ao passar de 4 GB.
5. **Monetização:** Nitro US$ 9,99/mês e Basic US$ 2,99/mês. No Brasil, cerca de R$ 24,99/mês (preço oficial não confirmado). Há Shop de cosméticos, Orbs e Quests (anúncios).
6. **Clima em 2025–2026:** revolta com verificação de idade e com o vazamento de 70 mil documentos (out/2025). Também com o redesign de março/2025, a pressão de anúncios e o pedido de IPO. As buscas por "alternativas ao Discord" explodiram.

**As 5 oportunidades de diferenciação mais fortes para o Alga Meet:**

1. **Stream 1080p60 grátis** com encode por hardware (NVENC/AMF/QSV, AV1/HEVC quando houver). O Discord cobra por qualquer coisa acima de 720p30.
2. **Cliente leve:** meta de memória privada em ocioso ≤ 1/3 do Discord (≤ 300 MB). Sem "reinício automático" como remendo de vazamento de memória.
3. **Privacidade na verificação de idade:** fazer só o que a lei exige (Brasil incluso). Não reter documento ou selfie, nem passar dados por fornecedores de suporte. Comunicar isso de forma clara.
4. **Sem anúncios, Quests ou Orbs**, com UI limpa e densa. Oferecer opção de densidade ou layout "clássico", que foi o pedido mais repetido após o redesign de 2025.
5. **Áudio bom para todos sem boost:** 128 kbps por padrão em qualquer servidor, preço em BRL acessível e E2EE como padrão. O E2EE é paridade, não diferencial, mas precisa existir desde o dia 1.

---

## 1. Voz

### Codec e formato
- **[FATO]** Áudio em Opus, 2 canais (estéreo), 48 kHz, transportado como RTP sobre UDP. Fonte: https://docs.discord.com/developers/topics/voice-connections
- **[FATO]** Em pausas de transmissão, o cliente envia 5 frames de silêncio (`0xF8, 0xFF, 0xFE`) para evitar interpolação do Opus. Fonte: a mesma página.
- **[FATO]** Áudio não é enviado durante silêncio. O SFU reescreve números de sequência. Fonte (2018): https://discord.com/blog/how-discord-handles-two-and-half-million-concurrent-voice-users-using-webrtc
- Tamanho de frame Opus: **não verificado** (não consta na página de voice connections).

### Bitrate por nível de boost
- **[FATO]** Limites de bitrate de canal de voz:

  | Situação | Bitrate máximo |
  |---|---|
  | Servidor normal | 96 kbps |
  | Boost nível 1 | 128 kbps |
  | Boost nível 2 | 256 kbps |
  | Boost nível 3 (ou feature `VIP_REGIONS`) | 384 kbps |
  | Stage channels | 64 kbps |

  Fontes: https://docs.discord.com/developers/resources/channel e https://support.discord.com/hc/en-us/articles/33694251638295-Discord-Account-Caps-Server-Caps-and-More
- **[FATO]** Boosts necessários: nível 1 = 2 boosts, nível 2 = 7 boosts, nível 3 = 14 boosts. Fonte: https://support.discord.com/hc/en-us/articles/11635925354775-Audio-Bitrate-FAQ
- **[FATO, possivelmente desatualizado]** O bitrate padrão de 64 kbps só aparece num changelog de 2016. Fonte: https://blog.discord.com/2016-2-18-change-log-a4a21c8067f5 . O padrão atual **não foi verificado**.
- **[RELATO]** Usuários reclamam que a qualidade de áudio fica "atrás do Nitro/boost". Fontes: https://support.discord.com/hc/en-us/community/posts/360046249171-Audio-Quality-behind-Nitro-is-NOT-okay e https://support.discord.com/hc/en-us/community/posts/360055360972-Base-Audio-Quality

### Processamento de voz
- **[FATO]** Supressão de ruído Krisp é **grátis** dentro do Discord e roda **no dispositivo**: nenhum áudio vai para a Krisp. Filtra apenas o áudio de saída do próprio usuário. Disponível em Windows, Linux, Mac (Apple Silicon, macOS 12+), Android e iOS. Fonte: https://support.discord.com/hc/en-us/articles/360040843952-Krisp-FAQ
- **[MEDIDO]** Existem módulos nativos `discord_krisp-1`, `discord_voice-1` e `discord_media-1` em `%LOCALAPPDATA%\Discord\app-1.0.9266\modules`. Método: `Get-ChildItem` (só nomes de pastas, sem inspecionar código).
- **[RELATO]** Cancelamento de eco e controle automático de ganho (AGC) existem como opções em "Voz e Vídeo". Guias relatam efeitos colaterais: voz "oca" com o cancelamento de eco, e o AGC amplificando ruído em sala barulhenta. Fontes: https://voxbooster.com/blog/discord-audio-quality-optimization-2026/ e https://simpleclean.app/blog/discord-noise-suppression-not-working . O nome exato dos toggles na versão atual **não foi verificado** em fonte oficial.
- **[FATO]** A sensibilidade de entrada pode ser automática. A Discord recomenda desligá-la se o volume oscila ou se finais de palavra são cortados. Fonte: https://support.discord.com/hc/en-us/articles/360045138471-Discord-Voice-and-Video-Troubleshooting-Guide

### Modos de entrada
- **[FATO]** Há dois modos: Detecção de voz (Voice Activity) e Push-to-Talk.
  - **Detecção de voz** tem atraso inerente de cerca de **200 ms**.
  - **PTT** quase não tem atraso ao pressionar e tem um slider "Push to Talk Release Delay".
  - Fonte: https://support.discord.com/hc/en-us/articles/211376518-Voice-Input-Modes-101-Push-to-Talk-Voice-Activated
- **[FATO]** O motor nativo dá acesso ao áudio bruto para detecção de voz, ajuste do auto-ducking do Windows, controle de volume próprio e PTT global. Fonte (2018): blog "2.5 million concurrent voice users" (URL acima).

### Volume por usuário e atenuação
- **[FATO]** Há volume individual por usuário: no desktop, clique direito no perfil e slider. Fonte: Troubleshooting Guide (URL acima).
- O máximo de 200% e a opção "Atenuação" (reduzir outros apps quando alguém fala) **não foram verificados** em fonte oficial nesta pesquisa.
  - **[HIPÓTESE]** Ambos existem: são amplamente citados e o motor nativo controla o auto-ducking do Windows (FATO acima). Mesmo assim, confirme na UI antes de usar como requisito.
- **[RELATO]** Usuários pedem perfis de volume por usuário. Fonte: https://support.discord.com/hc/en-us/community/posts/26207425975063-Voice-and-User-Volume-Profiles

### Arquitetura, regiões e reconexão
- **[FATO]** Desktop e mobile usam um único motor de mídia em C++ sobre a biblioteca nativa do WebRTC.
  - A sinalização substitui o SDP por uma troca de cerca de 1000 bytes.
  - Não usa ICE: todo cliente conecta ao relay, o que esconde o IP.
  - O SFU é próprio, em C++.
  - Em 2018: mais de 850 servidores de voz, 13 regiões e mais de 30 datacenters.
  - Fonte: https://discord.com/blog/how-discord-handles-two-and-half-million-concurrent-voice-users-using-webrtc
- **[FATO]** A região do canal de voz é "Automática" por padrão. Dá para sobrescrevê-la em Configurações do canal > Visão geral > Region Override, o que exige a permissão Gerenciar Canais. Fonte: https://support.discord.com/hc/en-us/articles/1500007645701-Voice-Regions-on-Discord-FAQ
- **[FATO]** Reconexão:
  - Se um SFU cai, o processo de sinalização o reinicia e reconstrói o estado sem ação do cliente.
  - Se um servidor falha no health check ou sofre DDoS, sai do service discovery. O cliente detecta o WebSocket caído, pede um novo servidor ao gateway e reconecta.
  - Fonte: blog de 2018 acima.
- **[FATO]** O voice gateway v8 usa `Resume` (opcode 7) com `seq_ack`. O servidor reenvia mensagens que ficaram no buffer. Se a sessão não é retomável, o cliente refaz o fluxo completo. O endereço do servidor de voz nunca deve ser cacheado. Fonte: https://docs.discord.com/developers/topics/voice-connections

### Criptografia
- **[FATO]** Criptografia de transporte:
  - Preferido: `aead_aes256_gcm_rtpsize`.
  - Obrigatório suportar: `aead_xchacha20_poly1305_rtpsize`.
  - Modos `xsalsa20_*` descontinuados em 18/11/2024.
  - Fonte: https://docs.discord.com/developers/topics/voice-connections
- **[FATO]** E2EE com o protocolo **DAVE**: grupos MLS e frames criptografados com AES128-GCM (tag truncada em 8 bytes). Desde **1º de março de 2026**, só são aceitas chamadas E2EE em DMs, grupos, canais de voz e Go Live. Fonte: a mesma página.

### Fluxo de entrada no canal e latência
- **Não verificado / não medido.** Não há número oficial de latência boca-ouvido nem de tempo de entrada no canal.
- Medir aqui exigiria logar no Discord e entrar em voz, o que está fora do escopo permitido.
- **[FATO]** O que se sabe do fluxo: o gateway envia o voice state e o voice server update. O cliente abre o voice WebSocket, recebe Ready e Session Description, e então envia áudio após o opcode 5 (Speaking). Fonte: docs de voice connections acima.

---

## 2. Compartilhamento de tela / Go Live

### Limites free vs Nitro
- **[FATO]** Todos os usuários podem transmitir até **720p/30fps**. Fonte: https://support.discord.com/hc/en-us/articles/360040816151-Go-Live-and-Screen-Share
- **[FATO, mas com conflito entre fontes oficiais]** Limites com Nitro:
  - O artigo de Go Live diz "Nitro e Nitro Classic: até 4K/60fps".
  - A página de caps mostra "1080p @ 60fps" para Nitro Basic e "Source @ 60fps" para o Nitro completo em DMs.
  - A página de vendas diz apenas "HD streaming".
  - Fontes: Go Live (URL acima), https://support.discord.com/hc/en-us/articles/33694251638295-Discord-Account-Caps-Server-Caps-and-More e https://discord.com/nitro
  - **[HIPÓTESE]** O teto atual é "Source/4K @ 60" no Nitro e 1080p60 ou menos no Basic. A página de caps é a mais recente. Confirme no app.
- **[FATO]** Boost de servidor eleva o Go Live de todos no servidor:
  - Nível 1: 720p60.
  - Nível 2: 1080p60.
  - Fonte: https://support.discord.com/hc/en-us/articles/360028038352-Server-Boosting-FAQ (trecho indexado).

### Espectadores e limites de canal
- **[FATO]** Go Live tem no máximo **50 espectadores** simultâneos, mais quem transmite. Fontes: artigo Go Live e página de caps (URLs acima).
- **[FATO]** Outros limites:
  - Canal de voz com vídeo: **25 membros**.
  - Canal de voz: até **99 usuários** (limite da API).
  - Stage: até 10.000 usuários, 1 Go Live e até 5 vídeos ao mesmo tempo.
  - Fontes: página de caps, https://docs.discord.com/developers/resources/channel e https://support.discord.com/hc/en-us/articles/1500005513722-Stage-Channels-FAQ

### Codecs e encode por hardware
- **[FATO]** O Discord suporta VP8 e H.264. Encoders HEVC e AV1 existem só em plataformas específicas.
  - O codec é negociado para que quem transmite consiga codificar e todos os espectadores consigam decodificar. Ele é renegociado a cada entrada ou saída.
  - O Discord prefere encoder e decoder de GPU.
  - Fonte (mar/2024): https://discord.com/blog/how-it-all-goes-live-an-overview-of-discords-streaming-technology
- **[RELATO]** Em 2023 chegou encode AV1 para GeForce RTX 40, com 4K60 a cerca de 8 Mbps para Nitro (segundo a NVIDIA) e fallback para H.264. Fonte: https://www.tweaktown.com/news/90149/discord-streaming-got-massive-quality-boost-for-geforce-rtx-40-series-gpus/index.html
- **[HIPÓTESE]** Nesta máquina, uma RTX 3070 (Ampere), o NVENC não codifica AV1. O Go Live cairia para H.264 ou HEVC. Motivo: especificação pública do NVENC Ampere. Não foi verificado no app.

### Adaptação, latência e captura
- **[FATO]** Adaptação e latência:
  - Sem buffer de segundos: sob perda de rede, o encoder descarta frames.
  - Qualidade, fps e resolução seguem a estimativa de banda.
  - Quem transmite não envia mais do que o espectador mais lento suporta.
  - Só transmite se houver pelo menos 1 espectador.
  - O relay esconde o IP.
  - Não há meta numérica de latência.
  - Fonte: blog "How it all goes live" (URL acima).
- **[FATO]** Áudio da tela no Windows: o Discord usa APIs de áudio do sistema operacional por aplicação, incluindo processos filhos. A captura de vídeo usa a API do sistema; alguns métodos usam **injeção de DLL** no jogo, com fallback automático entre métodos. Fonte: a mesma página.
- **[FATO]** Problema de qualidade em GPUs AMD ("blocky"):
  - Causas: keyframes demais (até 1 por segundo), rate control rígido e um frame dropper que caía de 60 para 30 fps.
  - Depois da correção, as sessões AMD/Windows abaixo de 50 fps caíram de 39% para 18%.
  - Fonte (mai/2024): https://discord.com/blog/from-blocky-to-brilliant-improving-video-quality-on-discord-go-live-on-amd-gpus
- **[RELATO]** Reclamações recorrentes:
  - Qualidade ruim e pedido de controle direto de bitrate: https://support.discord.com/hc/en-us/community/posts/4417777385623-Discord-Screen-Share-Is-Terrible e https://support.discord.com/hc/en-us/community/posts/4416846098455-Direct-Bitrate-setting-for-Discord-Screen-Share-Advanced-Setting
  - Go Live limitando o fps do jogo a 60: https://support.discord.com/hc/en-us/community/posts/360050558792-In-game-FPS-cap-with-Go-Live
  - Flicker verde e travadas em 1080p60 com a GPU carregada: https://support.discord.com/hc/en-us/community/posts/4407573271447
  - Pedido de mais de 50 espectadores: https://support.discord.com/hc/en-us/community/posts/12380765551639-Video-sharing-limits-locking-out-users-Please-increase-50
- Preview da stream e popout: **não verificados** em fonte oficial nesta pesquisa.

---

## 3. Uso de recursos

### Medição local
**[MEDIDO]** Método: PowerShell.
- `Get-Process Discord` para WorkingSet64, PrivateMemorySize64 e CPU.
- Amostragem do delta de CPU em 30 s.
- `Win32_Process.CommandLine` para identificar o tipo de cada processo.

Estado do cliente:
- Iniciado em 31/10/2026 17:05, ou seja, cerca de 7h47 de uptime.
- Janela oculta na bandeja: nenhum processo com `MainWindowHandle`.
- Fora de chamada: 0 endpoints UDP do Discord e 1 conexão TCP estabelecida.

Coleta em **2026-11-01 00:52:43 a 00:53:27 (-03:00)**.

| PID | Tipo | Working Set (MB) | Privada (MB) |
|---|---|---|---|
| 5716 | browser (principal) | 138,1 | 121,3 |
| 15364 | renderer | 354,5 | 391,9 |
| 14212 | gpu-process | 116,0 | 257,2 |
| 8060 | utility | 91,0 | 9,9 |
| 15300 | utility | 58,9 | 18,8 |
| 3640 | crashpad-handler | 30,7 | 9,0 |
| **Total (6 processos)** | | **789,1** | **808,1** |

- **[MEDIDO]** CPU em ocioso: 0,03% da máquina (20 threads lógicas), o equivalente a 0,62% de um núcleo, numa janela de 30 s.
- **[MEDIDO]** Tamanho em disco:
  - Pasta `app-1.0.9266`: 466,6 MB.
  - Pacote `packages\Discord-1.0.9262-full.nupkg`: 145,2 MB, mantido para rollback/delta.
- GPU: **não medida**. O `gpu-process` usa 257 MB de memória privada de sistema; VRAM não foi coletada.
- **[HIPÓTESE]** A soma do Working Set conta páginas compartilhadas mais de uma vez. A soma de memória privada (cerca de 808 MB) é o número mais justo para comparar. Com a janela aberta e o app em chamada, os valores devem ser maiores.

### O que a própria Discord admite
- **[RELATO: imprensa citando declaração da Discord]**
  - O app deveria ficar normalmente abaixo de 1 GB.
  - Desde dez/2025 há um experimento que **reinicia o cliente Windows automaticamente ao passar de 4 GB de RAM**. Condições: mais de 1 h aberto, usuário inativo, sem chamada ativa, no máximo 1 vez por dia, preservando rascunhos.
  - Mais de 10 vazamentos de memória foram corrigidos desde out/2025.
  - Fontes: https://www.pcworld.com/article/3005317/discord-admits-windows-11-app-hogs-ram-tries-solving-it-with-auto-restarts.html , https://www.techspot.com/news/110542-discord-force-restarting-itself-windows-11-stop-eating.html e https://alternativeto.net/news/2025/12/discord-admits-excessive-ram-usage-on-windows-app-and-tests-auto-restarts-as-temporary-fix

### Arquitetura observada
- **[MEDIDO]** Tipos de processo `browser`, `renderer`, `gpu-process`, `utility` e `crashpad-handler`. Isso indica Chromium/Electron multiprocesso.
- **[MEDIDO]** Módulos nativos, por nome de pasta em `modules\`:
  - Mídia e voz: `discord_voice`, `discord_media`, `discord_krisp`.
  - Overlay: `discord_overlay2`, `discord_desktop_overlay`.
  - Infraestrutura: `discord_desktop_core`, `discord_dispatch`, `discord_erlpack`, `discord_zstd`, `discord_rpc`, `discord_game_utils`, `discord_cloudsync`, `discord_notifications`, `discord_spellcheck`, `discord_utils`, `discord_modules`.
- **[HIPÓTESE]** O nome `discord_erlpack` sugere serialização ETF (formato Erlang) no gateway. Também há compressão zstd no transporte. O motivo é só o nome dos módulos.

---

## 4. Nitro, Nitro Basic, boosts e Shop

### Preços
- **[FATO]** Preços em USD:
  - Nitro: **US$ 9,99/mês**.
  - Nitro Basic: **US$ 2,99/mês**.
  - Fonte: https://discord.com/nitro
- **[RELATO]** Preços anuais em USD: Basic US$ 29,99/ano, segundo https://comparitech.com/blog/vpn-privacy/how-to-get-discord-nitro-cheaper . Nitro anual **não verificado**.
- **[RELATO]** Preços no Brasil (BRL) — **não confirmados em página oficial**:
  - Nitro: R$ 24,99/mês ou R$ 249,99/ano.
  - Nitro Basic: R$ 12,49/mês segundo a ExitLag, ou R$ 8,90/mês segundo a Pumble. As fontes conflitam.
  - Preço em reais existe desde cerca de 2021, quando o Nitro caiu para cerca de R$ 25.
  - Fontes: https://www.exitlag.com/blog/pt/tudo-sobre-a-assinatura-do-discord/ , https://pumble.com/pt/discord-pricing e https://tecnoblog.net/490319/discord-nitro-ganha-novo-preco-mais-baixo-e-em-reais-para-brasileiros/
  - Confirme na tela de compra do app com uma conta BR.

### Benefícios
- **[FATO]** Benefícios listados na página oficial. O resumo automatizado não separou com clareza cada coluna da tabela:
  - **Basic:** emoji custom em qualquer lugar, uploads de 50 MB e ícones de app.
  - **Nitro:** tudo do Basic, mais uploads de 1 GB, "HD streaming", perfis custom (por servidor), temas, super reactions, sons de entrada e soundboard custom, mensagens de 4.000 caracteres, até 200 servidores, 2 boosts com 30% de desconto em boosts extras, 3 passes Nitro para amigos, preço de membro no Shop, Early Access, **multiplicador de Orbs** e **Xbox Game Pass Starter Edition** (em regiões selecionadas).
  - Fonte: https://discord.com/nitro
- Limite de upload grátis e preço de um boost avulso: **não verificados** nesta pesquisa.

### Boosts
- **[FATO]** Níveis de boost: N1 = 2 boosts, N2 = 7 e N3 = 14. Voz: 128, 256 e 384 kbps. Go Live: N1 720p60 e N2 1080p60. Fontes: Audio Bitrate FAQ e Server Boosting FAQ (URLs nas seções 1 e 2).

### Shop de cosméticos
- **[FATO]** O Shop vende decorações de avatar, efeitos de perfil e **nameplates**.
  - Membros Nitro têm desconto em todos os itens.
  - Há bundles de decoração com efeito, disponíveis só se nenhum dos dois foi comprado separado.
  - O Shop é aberto também a quem não tem Nitro.
  - Fontes: https://support.discord.com/hc/en-us/articles/30408457944215 e https://discord.com/blog/nameplates-land-in-the-shop
- **[RELATO]** Faixas de preço:
  - Nameplates: cerca de US$ 5, segundo a TweakTown.
  - Decorações: de £3,99 a £9,99 no Reino Unido, com reclamação de preço alto: https://support.discord.com/hc/th/community/posts/17890076659735-Avatar-Decorations-are-too-expensive-in-my-opinion
  - Não há tabela oficial de preços 2025–2026.

### Orbs e Quests (anúncios)
- **[FATO]** Orbs foram lançados globalmente em 14/07/2025. É uma moeda virtual ganha em Quests (anúncios em vídeo e "jogue X minutos") e gasta no Shop, inclusive em crédito de Nitro. Fonte: https://discord.com/press-releases/discord-launches-orbs-globally
- **[RELATO]** 1.400 Orbs valem cerca de 3 dias de Nitro. Video Quests exigem assistir ao vídeo inteiro no desktop ou navegador. Fontes: https://techcrunch.com/2025/05/28/discord-explores-virtual-rewards-for-its-ad-product-as-it-prepares-for-a-potential-ipo e https://www.pcworld.com/article/2800333/discord-is-now-paying-users-with-orbs-to-watch-ads-and-play-games.html
- **[FATO]** Orbs continuam ativos em 2026: a página do Nitro lista o "multiplicador de Orbs". Fonte: https://discord.com/nitro

---

## 5. Reclamações recorrentes (2025–2026) e oportunidades

### Verificação de idade e privacidade (a maior em 2026)
- **[RELATO]** Linha do tempo:
  - Fev/2026: anúncio de contas "teen-by-default", com verificação por selfie ou documento para desbloquear.
  - 24/02/2026: adiamento para o 2º semestre de 2026, depois da revolta dos usuários e do corte de laços com a Persona.
  - O Discord **manteve a verificação onde a lei exige: Austrália, Brasil e Reino Unido**.
  - Set/2026: rollout global de um modelo baseado em sinais de atividade (adulto, adolescente ou não confirmado).
  - Fontes: https://techcrunch.com/2026/02/24/discord-delays-global-rollout-of-age-verification-after-backlash/ , https://www.windowscentral.com/gaming/discord-delays-its-global-age-verification-update-after-widespread-backlash-severing-persona-ties e https://www.techlicious.com/blog/discords-global-age-check-rollout-begins-this-week/
- **[RELATO]** Vazamento de dados (out/2025):
  - Cerca de 70 mil fotos de documentos de identidade expostas via 5CA, fornecedor de suporte.
  - Também vazaram nomes, e-mails, IPs e tickets de suporte.
  - O incidente começou em 20/09/2025 e foi divulgado em 03/10/2025.
  - Os atacantes alegam 5,5 milhões de usuários; a Discord contesta.
  - Fontes: https://databreaches.net/2025/10/09/discord-confirms-70000-government-ids-exposed-in-third-party-breach e https://www.bitdefender.com/en-us/blog/hotforsecurity/discord-data-breach-5ca-leak-70000-ids
- **[RELATO]** Êxodo de usuários:
  - Buscas por "alternativas ao Discord" subiram cerca de 10.000% nos EUA.
  - TeamSpeak e Stoat (ex-Revolt) ficaram sem capacidade.
  - A Fluxer alega mais de 120 mil usuários novos.
  - Fontes: https://www.techradar.com/computing/software/what-a-great-way-to-kill-your-community-discord-users-are-furious-about-its-new-age-verification-checks-and-are-now-hunting-for-alternatives , https://www.techspot.com/news/111281-discord-age-check-crackdown-already-pushing-users-elsewhere.html e https://piunikaweb.com/2026/02/11/discord-alternatives-nitro-cancel-age-verification/
- **[HIPÓTESE]** O Alga Meet não escapa da exigência legal brasileira. O diferencial está no *como*:
  - Estimativa no dispositivo ou por provedor sem retenção.
  - Nunca armazenar a imagem.
  - Nada disso passa pelo fornecedor de suporte.
  - Política pública e auditável.

### Anúncios, monetização e IPO
- **[RELATO]** Quests e Orbs são vistos como "caçar anúncios". O pedido confidencial de IPO (jan/2026) aumenta o temor de mais monetização. Fontes: https://pixelpnl.beehiiv.com/p/pixel-p-l-discord-has-found-a-way-to-make-users-hunt-for-ads e https://developmentstoday.com/news/discord-age-check-backlash-open-source-chat

### UI e excesso de elementos
- **[RELATO]** O redesign do desktop de 25/03/2025 gerou reclamações:
  - Ícones menores mesmo no modo "Spacious".
  - Padding excessivo e nome do servidor repetido em 3 lugares.
  - Lista de membros espaçada e painel de chamada grande.
  - Pedidos de "UI legada".
  - Fontes: https://support.discord.com/hc/sv/community/posts/30924709104663 , https://support.discord.com/hc/da/community/posts/30925961190679 e https://support.discord.com/hc/pl/community/posts/30939544298391
- **[RELATO]** A Discord diz que o redesign aproximou o desktop do mobile, trouxe lista de canais redimensionável e tema Onyx. Fonte: https://propakistani.pk/2025/03/26/discord-gets-a-visual-overhaul-and-new-themes-for-free/

### Performance e qualidade atrás de paywall
- RAM e reinício automático: ver seção 3.
- Stream grátis em 720p30, bitrate de voz atrelado a boost e problemas de Go Live: ver seções 1 e 2.

### Oportunidades concretas para o Alga Meet

| # | Oportunidade | Evidência no Discord |
|---|---|---|
| 1 | 1080p60 grátis com encode por hardware e fallback por espectador | 720p30 grátis [FATO] |
| 2 | Cliente leve (≤ 300 MB privados em ocioso), sem vazamento e sem reinício | 808 MB [MEDIDO]; reinício a 4 GB [RELATO] |
| 3 | Verificação de idade com retenção zero e transparência | Vazamento de 70 mil documentos [RELATO]; revolta em 2026 [RELATO] |
| 4 | Zero anúncios e Quests; UI densa e configurável, com modo "clássico" | Orbs/Quests [FATO]; redesign 2025 [RELATO] |
| 5 | Áudio de 128 kbps para todos, E2EE por padrão e preço BRL justo | 96 kbps sem boost [FATO]; DAVE obrigatório [FATO] |
| 6 (extra) | Mais de 50 espectadores por stream e controle de bitrate avançado | Limite de 50 [FATO]; pedidos [RELATO] |

---

## 6. Resumo dos demais tópicos

- **Servidores, canais, cargos e permissões.** O modelo do Discord tem servidores com canais de texto, voz, stage e fórum; cargos hierárquicos com permissões em bitfield; e sobrescritas por canal. **[HIPÓTESE: conhecimento prévio, não reverificado nesta pesquisa]** Referência para conferir: https://docs.discord.com/developers/topics/permissions
- **[FATO]** Region override de voz exige a permissão Gerenciar Canais. Fonte: Voice Regions FAQ (seção 1).
- **Amigos, DMs e presença.** Há DMs e grupos com chamadas E2EE (DAVE). **[FATO]** Fonte: docs de voice connections. O modelo de presença (online, ausente, não perturbe, invisível) e o "rich presence" (`discord_rpc`, **[MEDIDO]** pelo nome do módulo) não foram detalhados em fonte oficial nesta pesquisa.
- **Onboarding.** **Não verificado** nesta pesquisa.
- **Notificações e atalhos.** Há módulo nativo `discord_notifications` **[MEDIDO]** e PTT global no motor nativo **[FATO]** (blog de 2018). Os atalhos padrão **não foram verificados**.
- **Instalador e atualizador.**
  - **[MEDIDO]** `%LOCALAPPDATA%\Discord` contém `Update.exe`, `SquirrelSetup.log`, `packages\RELEASES` e `packages\Discord-1.0.9262-full.nupkg` (145 MB), além de pastas `app-<versão>` lado a lado. Esse é o padrão do Squirrel.Windows: instala por usuário, sem admin, e troca de versão por pasta.
  - **[MEDIDO]** Também existe `installer.db`, modificado em 2026-11-01 00:05.
  - **[HIPÓTESE]** O `installer.db` é o banco do atualizador próprio, que convive com o Squirrel. Motivo: ele foi modificado depois do último pacote. Não abrimos o arquivo.
  - **[HIPÓTESE]** Os módulos `*-1` são baixados e atualizados separadamente do shell. Motivo: pastas versionadas independentes.
- **Estados de erro de voz.** Há um artigo oficial sobre erros de conexão de voz: https://support.discord.com/hc/en-us/articles/115001310031-Voice-Connection-Errors . **[HIPÓTESE: conhecimento prévio, não reverificado]** Os estados mostrados ao usuário incluem "RTC Connecting", "No Route" e "ICE Checking". O artigo sugere trocar a região e conferir firewall ou VPN.

---

## Tabela de metas

| Métrica | Discord (valor + tag) | Meta Alga Meet sugerida |
|---|---|---|
| Latência de voz (boca-ouvido) | Sem número oficial; não medido. Detecção de voz soma cerca de 200 ms de atraso inerente [FATO] | ≤ 150 ms boca-ouvido p95 na mesma região. A ITU-T G.114 (https://www.itu.int/rec/T-REC-G.114) recomenda ≤ 150 ms de atraso de ida para interatividade boa. Detecção de voz ≤ 60 ms de hangover/onset [HIPÓTESE: alvo de engenharia] |
| Bitrate de voz | Máximo de 96 kbps sem boost; 128/256/384 kbps com boost N1/N2/N3 [FATO]; padrão de 64 kbps só citado em 2016 [FATO, desatualizado] | Padrão de 96 kbps e máximo de 128 kbps Opus estéreo em **qualquer** servidor, sem paywall. Acima de 128 kbps o ganho perceptual do Opus é pequeno e o custo de banda cresce [HIPÓTESE] |
| Stream grátis (resolução/fps) | 720p/30fps [FATO]; boost N2 ou Nitro chega a 1080p60 ou mais [FATO] | 1080p/60fps grátis com encode por hardware (H.264/HEVC/AV1) e adaptação por espectador |
| RAM em ocioso | 808 MB privados / 789 MB de Working Set em 6 processos, na bandeja, fora de chamada [MEDIDO 2026-11-01 00:52 -03]; "deveria ficar < 1 GB", reinício a 4 GB [RELATO] | ≤ 300 MB privados em ocioso na bandeja; ≤ 500 MB em chamada com 1 stream assistida; nenhum reinício automático |
| Tempo de entrada no canal (clique até áudio) | Sem número oficial; não medido (exigiria login) | p50 ≤ 500 ms e p95 ≤ 1 s, da mesma região até o primeiro pacote de áudio ouvido [HIPÓTESE: alvo de engenharia; medir com telemetria própria] |

---

### Próximas verificações recomendadas
1. Abra no navegador as páginas de suporte que deram 403: Go Live, Account Caps, Audio Bitrate FAQ e Server Boosting. Confirme os tetos do Nitro e do Basic.
2. Com uma conta BR de teste, anote o preço exato do Nitro e do Basic, mensal e anual, na tela de compra.
3. Meça a latência boca-ouvido e o tempo de entrada no canal do Discord com duas máquinas, um loopback e uma câmera de 240 fps. Exige login, então quem faz é uma pessoa da equipe, não um agente.
