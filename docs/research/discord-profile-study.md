# Estudo: perfil, personalização e atividade em tempo real no Discord

> Pesquisa de 2026-11-05 para o Alga Meet. Complementa `discord-benchmark.md` (seção 4 já cobre Nitro, Shop e preços; não é repetida aqui).
>
> **Legenda**
> - **[WEB]**: lido em fonte pública (URL indicada).
> - **[VISTO]**: observado no app Discord real.
> - **[INFERÊNCIA]**: dedução minha, com o motivo.
>
> **Limite importante: não há nenhum item [VISTO] neste documento.** O pedido de acesso ao app Discord foi parcialmente negado: a janela do cliente não ficou visível para mim (o processo `discord.exe` não foi liberado pelo dono). Seguindo a regra de não insistir, o estudo é 100% web. Consequências: não temos rótulos exatos em pt-BR do app, tamanhos em pixels, durações de animação nem micro-interações medidas. Onde isso faria diferença, está marcado **"verificar no app"** (seção 7, lista de verificação).
>
> `support.discord.com` responde 403 a leitores automáticos. Parte dos fatos de suporte veio de trechos de busca, não da página inteira. Páginas de blog e docs de desenvolvedor foram lidas na íntegra.

---

## 0. O que o Alga Meet já tem (ponto de partida)

Fonte: `packages/shared/src/billing.ts`, `models.ts`, `activity.ts` e a pasta `features/billing`.

| Área | Estado atual |
|---|---|
| Slots cosméticos | `avatar_decoration`, `profile_theme`, `profile_effect`, `nameplate`, `voice_aura`, `entrance_sound`, `call_reactions`, `stream_frame`, `app_icon`, `app_accent`. Os dois últimos são privados (só o próprio usuário vê). |
| Perfil público (`PublicUser`) | `displayName`, `avatarUrl`, `accentColor`, `bio`, `cosmetics`, `plusBadge` (selo de tempo de Plus). |
| Atividade (`Activity`) | `kind` (game/code/creative/music/video/app), `name`, `startedAt` (timer ao vivo), `icon` (PNG data URL), `steamAppId`. Nunca título de janela nem arquivo. Só amigos e co-membros, só quando visível. |
| Loja | Já existem no código arquivos de presente (`Gift.tsx`), lista de desejos (`Wish.tsx`), experimentar (`TryOn.tsx`), galeria e planos (arquivos novos ainda não commitados). |

**Lacunas em relação ao Discord (candidatas):** banner, pronomes, status personalizado com emoji e validade, widgets de perfil (jogos favoritos), perfil por espaço (servidor), detalhes/estado/arte na atividade, botões "Juntar-se", privacidade de atividade por espaço, jogo ocultável, aba de atividade recente, "membro desde", nota privada, estilo do nome de exibição.

---

## 1. Mapa de personalização de perfil no Discord

Fonte principal: https://discord.com/blog/how-to-customize-your-discord-profile [WEB]. Onde editar: engrenagem (canto inferior esquerdo) e "Edit Profiles" no desktop; aba "You" e "Edit Profile" no mobile. Clicar no próprio avatar mostra o perfil como os amigos veem (pré-visualização) [WEB].

| Item | O que é | Grátis / Nitro / Shop | Onde aparece | Fonte |
|---|---|---|---|---|
| Avatar | Imagem estática | Grátis | Em todo lugar | blog acima |
| Avatar animado (GIF) | Imagem animada | Nitro | Em todo lugar | blog acima |
| Banner | Faixa no topo do perfil | Nitro | Perfil e popout | blog acima |
| Tema do perfil | Gradiente de duas cores sobre o perfil; pode variar por servidor | Nitro (gerou revolta por ser bloqueado) | Perfil e popout | blog acima; https://piunikaweb.com/blog/discord-gradient-color-themes-being-locked-behind-for-some |
| Sobre mim (bio) | Texto curto | Grátis | Perfil e popout | blog acima |
| Decoração de avatar | Moldura animada ou estática ao redor do avatar | Shop (qualquer pessoa compra); itens extras de Nitro só usáveis com assinatura ativa | Popout, perfil e o avatar ao lado das mensagens no chat | https://discord.com/blog/avatar-decorations-collect-and-keep-the-newest-styles |
| Efeito de perfil | Animação grande que cobre o perfil inteiro | Shop; alguns itens Nitro-only | Só ao abrir o perfil de alguém (desktop e mobile) | https://discord.com/blog/how-to-customize-your-discord-profile ; resultados de busca do Shop |
| Plaquinha (nameplate) | Fundo decorativo atrás do nome | Shop. Lançou com 8 itens, "inspirados em coleções queridas" (Cyberpunk, Galaxy, Anime). Dá para pré-visualizar antes de comprar | Lista de membros do servidor, lista de DMs (ao passar o mouse) e barra do usuário. Visível para todos | https://discord.com/blog/nameplates-land-in-the-shop |
| Moldura de perfil (Profile Frame) | Borda decorativa ao redor do perfil | Shop; com Nitro dá para ter uma moldura diferente por servidor | Perfil | https://discord.com/blog/introducing-profile-frames-decorative-borders-to-make-your-discord-profile-museum-worthy |
| Estilo do nome de exibição | Fonte, cor e efeito animado no nome | Nitro (para salvar). Recurso "experimental", desktop e web. Mobile mostra sem animação. FAQ oficial lista 8 fontes | Perfil e DMs | https://support.discord.com/hc/en-us/articles/33833879643927 (via busca; 403 na página) |
| Perfil por servidor | Avatar, bio, decoração, efeito, tema e moldura próprios por servidor; campos não alterados espelham o perfil global | Nitro | Dentro daquele servidor | blog acima |
| Status personalizado | Mensagem curta com validade; emoji customizado só com Nitro | Grátis (texto); Nitro (emoji custom) | Popout, lista de membros, DMs | blog acima; docs de dev (tipo 4 Custom) |
| Widgets de perfil | "Favorite Game", "Games in Rotation", "Games I Like", "Want to Play". Edição só no desktop na data do artigo | Grátis | Perfil | blog acima |
| Widget de estatísticas de jogo | Conta vinculada mostra stats do jogo no perfil (ex.: conquistas, personagem favorito). Em mar/2026 passou a aceitar um segundo jogo | Grátis | Perfil | https://discord.com/blog/discord-update-march-24-2026-changelog |
| Wishlist | Itens do Shop que você quer ganhar, visíveis no perfil. Botão de coração em item não possuído. Amigos presenteiam; ao chegar o presente, o item sai da lista e você recebe notificação. Pública por padrão, com ajuste de privacidade | Grátis | Perfil | https://discord.com/blog/save-and-display-your-faves-add-discord-shop-marvel-rivals-items-to-your-profiles-wishlist ; https://support.discord.com/hc/en-us/articles/36288192746903-Wishlist-FAQ (via busca) |
| Server Tag | Tag de um servidor ao lado do nome e no perfil; o servidor precisa de nível de boost e admins liberam | Grátis para o usuário | Ao lado do nome | blog acima |
| Contas conectadas | PlayStation, Xbox, Spotify, Crunchyroll: compartilham atividade automaticamente | Grátis | Atividade | blog acima |
| Pronomes | Campo de texto no perfil | O blog de personalização não os menciona | Perfil | [INFERÊNCIA] existem hoje no app, mas não foi confirmado nesta pesquisa. Verificar no app |

**Observações**
- [WEB] Preços exatos de decoração, efeito e plaquinha **não estão em fonte oficial**. Há relatos de £3,99 a £9,99 por decoração (já citado no benchmark) e queixas de que "decoração custa mais da metade do Nitro" (https://support.discord.com/hc/da/community/posts/17887365753239-Avatar-Decorations-are-egregiously-overpriced). Há preço regional para alguns itens, mas **valor em reais não confirmado** (https://support.discord.com/hc/pt-br/articles/13410113109911-Decorações-de-avatar). Decorações são **não reembolsáveis** [WEB, mesma fonte]. O Shop mostra o preço em dinheiro e, quando elegível, o preço em Orbs (itens de presente não aceitam Orbs) [WEB, resultados de busca].
- [WEB] Pacotes (bundles) juntam decoração + efeito da mesma coleção com desconto, e só aparecem se nenhum dos dois foi comprado separado (já no benchmark).

---

## 2. Atividade em tempo real (Rich Presence)

### 2.1 Como o Discord detecta
- [WEB] **Jogos detectáveis:** o cliente reconhece jogos rodando no computador a partir de uma lista própria. A lista de "Jogos registrados" em Configurações do usuário permite ligar ou desligar a detecção por jogo e adicionar manualmente um programa. Fonte: https://support.discord.com/hc/en-us/articles/7931156448919 (via busca).
- [WEB] **Contas conectadas e apps parceiros:** Spotify, console (PlayStation, Xbox), Crunchyroll alimentam a atividade sem o app rodar no PC.
- [WEB] **Rich Presence (o jogo informa de forma ativa):** o jogo usa o Game SDK, o Discord Social SDK ou o Embedded App SDK para enviar dados ricos. Fonte: https://docs.discord.com/developers/rich-presence/overview
- [WEB] Em desenvolvimento, usar conta de teste, porque os dados da Rich Presence são públicos no perfil (mesma fonte).

### 2.2 Dados que a atividade carrega (objeto Activity)
Fonte: https://docs.discord.com/developers/events/gateway-events [WEB]

| Campo | Uso |
|---|---|
| `name`, `type` | Nome e tipo: 0 Jogando, 1 Transmitindo, 2 Ouvindo, 3 Assistindo, 4 Personalizado, 5 Competindo |
| `details`, `state` | Duas linhas curtas ("o que faz agora" e "estado da partida/grupo") |
| `details_url`, `state_url` | Links nas linhas de texto |
| `timestamps.start` / `end` | Timer: decorrido ou restante |
| `party.size [atual, máx]` | Indicador de grupo ("2 de 4") |
| `assets` | Imagem grande e pequena com texto de hover e URL clicável; capa de convite |
| `buttons` (máx. 2) | Rótulo 1 a 32 caracteres, URL 1 a 512. Outros usuários só veem os rótulos pelo gateway; bots não leem as URLs |
| `secrets.join/spectate/match` + flags JOIN, SPECTATE, JOIN_REQUEST, PARTY_PRIVACY_FRIENDS, PARTY_PRIVACY_VOICE_CHANNEL | Botão de entrar ou assistir. Privacidade do grupo: amigos ou canal de voz |
| `status_display_type` | Qual campo aparece como texto na lista de membros: nome, estado ou detalhes |

Boas práticas oficiais (https://docs.discord.com/developers/rich-presence/best-practices) [WEB]: texto curto em uma linha; informação secundária em tooltip; arte 1024x1024; imagem grande igual para todos do grupo e a pequena para personalização por jogador; arte para todo estado, inclusive menu; só mandar segredo de entrada quando o jogador pode realmente convidar.

### 2.3 Onde aparece (superfícies)
- [WEB] Perfil e popout (cartão de atividade com ícone, nome, timer e botões).
- [WEB] Lista de membros do servidor, com a linha de texto escolhida em `status_display_type`.
- [WEB] Tela Amigos e a seção "Ativo agora" (Active Now). A aba de Atividade antiga foi removida num redesign antigo e usuários pediram de volta; o "Active Now" foi chamado de redundante e confuso (https://support.discord.com/hc/zh-tw/community/posts/360056325891-Please-revert-or-bring-back-the-activity-tab).
- [WEB] "Atividade recente" (Recent Activity) no perfil, segundo o artigo de suporte de Activity Status. Detalhes de layout: **verificar no app**.
- [INFERÊNCIA] Participantes de canal de voz mostram ícone do jogo ao lado do nome. Isso é amplamente conhecido, mas não foi confirmado em fonte lida agora.

### 2.4 Privacidade e controles
Fonte: https://support.discord.com/hc/en-us/articles/7931156448919 (via busca) [WEB]
- Chave global **"Share my activity"**.
- Por servidor, em "My Servers": liga/desliga. Atenção: membros de um servidor desligado ainda veem a atividade se forem seus amigos ou se dividirem **outro** servidor onde ela está permitida. Isso confunde.
- **"Automatically share my activity when joining a server"**: padrão para servidores novos.
- Jogos registrados: ligar/desligar por jogo.
- Status personalizado pode ser omitido da presença quando a privacidade do perfil restringe (docs de dev).
- Reclamação antiga e recorrente: pedido de atividade por servidor (https://support.discord.com/hc/it/community/posts/360047651651--Privacy-Server-Specific-Game-Activity). O Discord acabou implementando, mas com a regra de vazamento por amigo em comum.

### 2.5 Social em volta da atividade
- [WEB] Botão "Ask to Join" nas Activities do Embedded App SDK (sempre mostrado). Convite em jogos com Social SDK.
- [WEB] Changelog de mar/2026: opção "Invite to Voice" quando você está em voz, sugerindo membros do servidor e amigos de fora (https://discord.com/blog/discord-update-march-24-2026-changelog).

---

## 3. Perfil completo e popout

**Limitação:** não consegui abrir o app, então anatomia, ordem dos blocos, abas e motion são em grande parte [INFERÊNCIA] de conhecimento geral mais o que o blog confirma. Tudo abaixo marcado **verificar no app**.

- [WEB] O perfil mostra: banner, avatar com decoração, nome de exibição (com estilo e plaquinha), tema em gradiente, efeito de perfil animado cobrindo tudo, sobre mim, widgets, wishlist, atividade, tag de servidor, selos.
- [WEB] O **efeito de perfil só toca ao abrir o perfil de alguém** (https://discord.com/blog/how-to-customize-your-discord-profile, resultado de busca). Isso é um bom gatilho: é a "vitrine" que dá status social.
- [WEB] A **decoração de avatar também aparece no chat**, ao lado de cada mensagem. É a superfície de maior volume e a que vende. A plaquinha vive na lista de membros, outra superfície de alto volume.
- [INFERÊNCIA] Abas do perfil completo: Atividade, Amigos em comum, Servidores em comum, mais "Membro desde" e Nota privada. Confirmar nomes e ordem no app.
- [INFERÊNCIA] Hierarquia: nome + atividade ficam acima da dobra; bio e widgets abaixo. Efeito de perfil é decorativo e não pode cobrir texto lido.

---

## 4. Loja e monetização de perfil

| Mecanismo | O que o Discord faz | Fonte |
|---|---|---|
| Coleções temáticas | Coleções nomeadas (Fantasia, Anime, Café da manhã, Halloween, Outono; depois Cyberpunk, Galaxy) com decoração + efeito + plaquinha combinando | https://discord.com/blog/avatar-decorations-collect-and-keep-the-newest-styles ; nameplates |
| Tempo limitado | Coleções saem do Shop em data fixa (ex.: Halloween até 3/nov/2025; coleção de jogo até 7 de maio). Quem comprou **mantém para sempre** | resultados de busca (blog Halloween, Dot Esports, Digit) |
| Colaborações de jogo | Coleções de marca de jogo (ex.: um shooter tático, um jogo de heróis) com lista de desejos de itens dentro do jogo e presentes entre amigos | changelog mar/2026; blog de Wishlist |
| Acesso antecipado | Nitro compra primeiro; depois abre para todos | blog de decorações |
| Bundles | Decoração + efeito juntos, com desconto | busca |
| Desconto Nitro | Preço de membro no Shop | https://discord.com/nitro |
| Presentear | Itens do Shop e Nitro como presente; Wishlist público transforma o perfil em "vitrine de pedidos" | blog Wishlist |
| Moeda alternativa | Orbs (Quests) pagam alguns itens | benchmark |
| Experimentar | Pré-visualizar plaquinha antes de comprar | blog nameplates |

**Por que vende (análise)** [INFERÊNCIA, a partir das superfícies]:
1. **Visibilidade repetida:** decoração aparece em cada mensagem e plaquinha em cada lista. O comprador "vê o retorno" dezenas de vezes por dia, e os outros também.
2. **Identidade de grupo:** coleções temáticas casam com comunidades (anime, jogo).
3. **Escassez honesta com posse permanente:** a coleção sai, mas quem comprou fica. Gera urgência sem tirar nada de ninguém.
4. **Presente social:** Wishlist pública cria demanda de amigos para amigos.
5. **Motion de entrada:** efeito de perfil é uma "cena" ao abrir o perfil.

---

## 5. Dores e falhas do Discord (oportunidades)

| Dor | Evidência | Oportunidade |
|---|---|---|
| Customização básica atrás de Nitro (tema de gradiente, banner, GIF) | https://piunikaweb.com/blog/discord-gradient-color-themes-being-locked-behind-for-some ; https://support.discord.com/hc/tr/community/posts/21308359456023-why-isn-t-there-a-tier-just-for-custom-profiles ("por que não há um plano só de perfil?") | Tema e banner grátis; pagar por **itens**, não por **liberdade de ajuste** |
| Preço de decoração alto e não reembolsável | queixas "egregiously overpriced" (link acima); política de não reembolso | Preço baixo, experimentar em tempo real, reembolso curto |
| Interface poluída por upsells e avisos | https://support.discord.com/hc/ru/community/posts/4403519737111-So-much-clutter ; https://www.pcgamer.com/i-am-begging-discord-to-stop-bombarding-me-with-pointless-new-features ; AntiNitro (userstyle que esconde upsells) | Zero banner de venda fora da loja |
| Privacidade de atividade com vazamento por amigo em comum | artigo de Activity Status (busca) | Regra simples e previsível: "quem vê" explicado na própria tela |
| "Ativo agora" redundante e confuso; aba de atividade removida | link do post 360056325891 | Uma única superfície clara de "o que meus amigos fazem" |
| Detecção de jogos opaca (lista de jogos registrados com entradas velhas) | guias de terceiros, não verificado | Lista de apps detectados visível, com um clique para ocultar |
| Efeitos animados pesam (Electron já usa muita RAM) | benchmark: 808 MB | Efeitos leves, pausáveis, respeitando "reduzir movimento" |
| Funcionalidades espalhadas e experimentais (estilo de nome só no desktop/web) | FAQ de display name styles | Paridade entre plataformas desde o dia 1 |
| Wishlist pública por padrão | FAQ Wishlist | Privada por padrão, pública por escolha |

---

## 6. Recomendações priorizadas para o Alga Meet

Legenda de esforço: P pequeno, M médio, G grande. Todas respeitam: sem dark patterns, privacidade forte, visual contido Linear + índigo.

| # | Ideia | Valor para o usuário | Monetização / retenção | Esforço | Como fazer MELHOR que o Discord |
|---|---|---|---|---|---|
| 1 | **Atividade rica: segunda linha ("detalhes") e arte do app/jogo** (hoje há nome, ícone, timer) | Amigos entendem o que você faz sem perguntar | Retenção: motivo para abrir a lista de amigos | M | Só campos que o app consegue detectar sozinho; nada de texto digitado por jogo. Nunca título de janela. Pré-visualização "como seus amigos veem" |
| 2 | **Privacidade de atividade em uma tela só**: global, por espaço, por app, com texto "quem vê isso" ao vivo | Confiança; evita susto | Diferencial de marca (privacidade) | M | Regra sem exceção escondida: se o espaço está desligado, **ninguém** ali vê, mesmo amigo em comum. Mostrar contador ("visível para 14 pessoas") |
| 3 | **Lista de apps detectados com "ocultar este app"** e modo "Não mostrar nada por 1 h" | Controle imediato | Confiança | P | Um clique na própria superfície de atividade ("ocultar para sempre", "ocultar agora") |
| 4 | **Tema do perfil (cor/gradiente) e banner grátis**; cobrar por itens | Perfil bonito sem pagar | Conversão por **desejo de itens**, não por bloqueio; menos revolta | P (tema já parte de `accentColor` e `profile_theme`) | Tema grátis limitado (paleta curada), Plus libera cores livres e animadas |
| 5 | **Plaquinha e decoração visíveis nas superfícies de alto volume** (lista de membros, mensagem, chamada), com prévia ao vivo antes de comprar | Retorno visível do que comprou | É o maior gatilho de compra observado no Discord | M (plaquinha e decoração já são slots) | Prévia no próprio contexto ("assim aparece na sua lista e no chat"), botão **Experimentar 24 h** (já há `TryOn`), reembolso curto |
| 6 | **Coleções temáticas rotativas, com posse permanente** | Identidade e colecionismo | Retenção por novidade; sem pegadinha | M | Mostrar a data de saída **de forma honesta** ("sai em 12 dias"); sem contagem regressiva piscante; quem comprou mantém; item volta numa "Reprise" anunciada |
| 7 | **Wishlist e presente** (já em construção) com perfil **privado por padrão** | Amigos acertam o presente | Aquisição por amigo (loop social) | P (já existe) | Privada por padrão; presente com mensagem; notificação única, sem lembretes insistentes |
| 8 | **Perfil por espaço** (apelido, bio, avatar por espaço) | Identidade diferente por comunidade | Plus (como o Discord), mas **apelido e bio por espaço grátis** | G | Só avatar e decoração por espaço no Plus. Campos não alterados espelham o global, como no Discord |
| 9 | **Status personalizado com validade** ("1 h", "hoje", "não limpar"), emoji | Expressão leve e comum | Emoji custom no Plus | P | Presets de validade e "volta às 14h"; sem prompt de preenchimento |
| 10 | **Widgets de perfil: "Jogando agora", "Favoritos" (3 apps/jogos), "Em rotação"** com arte, **ocultáveis** | Perfil com personalidade e conversa | Retenção; base para coleções por jogo | M | Preenchimento automático a partir do tempo real de uso, opt-in, sem sincronizar conta de terceiros |
| 11 | **Efeito de perfil de entrada** (cena curta ao abrir o perfil, 1 vez por sessão por pessoa) | Prazer visual; vitrine | Item caro e desejado | M | Respeita "reduzir movimento"; pausa quando a janela perde foco; custo de GPU orçado; uma única animação, nunca em loop infinito na lista |
| 12 | **Estilo do nome de exibição** (fonte, cor, efeito sutil) | Marca pessoal | Plus ou item | M | Paridade em todas as plataformas; fontes limitadas a 6; nunca em tamanho que quebre a lista |
| 13 | **Botão "Entrar na sessão"/"Ouvir junto" quando o app informa** (futuro SDK local) | Entrar com amigo em 1 clique | Retenção forte (uso em grupo) | G | Só quando o jogador marca "aceitar convite"; secreto de entrada nunca fica em texto visível |
| 14 | **Perfil completo com "Membro desde", Nota privada, Amigos e Espaços em comum, Atividade recente** | Contexto social | Retenção | M | Layout denso, uma coluna; nota privada criptografada e só local |

**As 10 de maior valor, em ordem:** 2, 5, 1, 4, 3, 7, 6, 9, 10, 11.

---

## 7. Lista de verificação no app (o que faltou ver)

Quando o app Discord for liberado, olhar e anotar (sem salvar nada):
1. Rótulos exatos pt-BR de Configurações > Perfis, Privacidade de atividade e Jogos registrados.
2. Layout do popout e do perfil completo: abas, ordem, tamanhos, hover e transições.
3. Cartão de atividade: ícone, timer ao vivo, botões, "Atividade recente".
4. Ícone de jogo em participantes de voz e na lista de membros.
5. Loja: organização, prévia, preços em reais, Orbs, presente, "saindo em breve".
6. Pronomes e "Nota": existem, onde ficam, e se há opção de ocultar.
7. Efeito de perfil: duração, loop, interação com texto.

---

## 8. Fontes consultadas

- https://discord.com/blog/how-to-customize-your-discord-profile
- https://discord.com/blog/introducing-profile-frames-decorative-borders-to-make-your-discord-profile-museum-worthy
- https://discord.com/blog/nameplates-land-in-the-shop
- https://discord.com/blog/avatar-decorations-collect-and-keep-the-newest-styles
- https://discord.com/blog/save-and-display-your-faves-add-discord-shop-marvel-rivals-items-to-your-profiles-wishlist
- https://discord.com/blog/discord-update-march-24-2026-changelog
- https://docs.discord.com/developers/rich-presence/overview
- https://docs.discord.com/developers/rich-presence/best-practices
- https://docs.discord.com/developers/events/gateway-events (objeto Activity)
- https://support.discord.com/hc/en-us/articles/7931156448919 (via busca)
- https://support.discord.com/hc/en-us/articles/33833879643927 (via busca)
- https://support.discord.com/hc/en-us/articles/36288192746903-Wishlist-FAQ (via busca)
- https://support.discord.com/hc/pt-br/articles/13410113109911-Decorações-de-avatar (via busca)
- Fóruns de usuários e imprensa citados na seção 5.
