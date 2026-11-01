# Site v2 — storyboard: "Mergulho na Hora Azul"

> v1 foi reprovado por ser contido demais ("parece site gerado por IA"). O v2 é um filme de rolagem: a página inteira é **um mergulho** — começa logo abaixo da superfície, na luz da hora azul, desce até o escuro onde o grupo conversa e volta à superfície no fim, quando o horizonte nasce. Uma água só, contínua, atrás de todos os capítulos (um canvas WebGL fixo); cada capítulo muda a profundidade, a cor e a luz dessa água.
>
> Revoga do estudo do heyparker (§7 "Evitar") a regra "animação só em CSS / sem sequência / pinagem curta". Mantém: CLS ≈ 0, LCP rápido, texto real no HTML, três níveis.

## Níveis

| Nível | Quem | O que vê |
|---|---|---|
| **A** espetáculo | desktop e celular capazes (prova de quadros + CPU no carregamento) | WebGL em tempo real (OGL), GSAP + ScrollTrigger com capítulos presos, Lenis, cursor de luz, áudio procedural opcional |
| **B** filme | aparelho fraco, rede 3g | Os mesmos momentos em **vídeo pré-renderizado do próprio WebGL** (H.264, preguiçoso, ≤ 6 MB no total). Sem pinagem |
| **C** quadro | `prefers-reduced-motion`, economia de dados, 2g | **Quadros parados** dos mesmos momentos (AVIF/WebP). Nada se move; tudo legível |

Regras de A: DPR ≤ 1,75 (água a 0,5× — é luz difusa, não precisa de nitidez), pausa fora da tela e com a aba escondida, `dispose` ao sair, ≥ 50 fps na RTX 3070 e com CPU 4× mais lenta. Mídia pesada só depois da primeira pintura; tudo com tamanho reservado.

## Os momentos

### 1. Abertura — "Hora Azul"
- **Vê:** quase preto que clareia em azul-índigo vindo de cima. Feixes de luz atravessam a água (raios volumétricos), cáusticas dançam, plâncton de luz flutua com profundidade de campo. Do fundo, **as duas frondes do Encosto crescem** balançando na corrente; quando terminam, a pequena, índigo, **se inclina e encosta** na alta, branca. Só então o título acende, letra a letra, como se nascesse da luz.
- **Faz:** move o mouse → a luz do cursor segue com atraso e perturba as cáusticas (anéis na água).
- **Técnica:** shader de tela cheia (raios + cáusticas + gradiente de profundidade) num alvo de render a 0,5×; frondes = dois quads subdivididos com a silhueta exata do SVG final (máscara rasterizada), curvatura no vertex shader, frente de crescimento brilhante; partículas em `gl.POINTS`. Título em HTML com cada letra saindo do desfoque + brilho.
- **B:** vídeo em loop da mesma cena atrás do título. **C:** quadro parado da cena com as frondes encostadas.

### 2. O mergulho — o app sobe da luz
- **Vê:** ao rolar, o título sobe e se desfaz; a câmera mergulha entre as frondes; do clarão lá embaixo **sobe a janela do Alga Meet**, deitada, em vidro com espessura, refletindo a luz da água — e endireita na sua frente, com as camadas da interface em leve paralaxe.
- **Técnica:** capítulo preso (~2 telas). Janela em CSS 3D (`preserve-3d`) sobre o WebGL, captura real em camadas recortadas com `clip-path` da **mesma imagem** (zero bytes a mais); poça de luz no WebGL acompanha a subida; brilho de vidro passa conforme ela gira.
- **B/C:** janela parada, montada, sem pinagem.

### 3. Por dentro — a vista explodida
- **Vê:** a janela **se abre em profundidade**: trilho, canais, conversa, "em voz", barra de título se separam em camadas no espaço, o conjunto gira em 3D; cada camada ganha um rótulo curto com linha de chamada. Depois **tudo se fecha de uma vez, com um clique** (mola com leve passada + lampejo de luz nas emendas).
- **Técnica:** continuação do mesmo capítulo preso (~2,5 telas); GSAP com `scrub`; clique = mola `back.out` + flash.
- **B/C:** imagem montada com os rótulos em lista ao lado.

### 4. A sala — voz que dá para ver
- **Vê:** escuro. Uma gota de luz cai e **acende um chão líquido**. Cinco amigos sentados em roda. Quando alguém fala, **ondas de luz saem dele e atravessam o chão**, cruzando-se com as dos outros; legendas da conversa aparecem embaixo. A rolagem **é a linha do tempo** da conversa (vai e volta). No fim: **46 ms** — da boca de um ao ouvido do outro.
- **Faz:** "Ouvir a sala" liga um som **sintetizado no navegador** (sílabas com formantes, cada amigo com sua altura de voz, nenhuma voz gravada ou de IA) sincronizado com as ondas.
- **Técnica:** canvas próprio; chão = plano com altura analítica: cada fala é uma textura de envelope (5 linhas × N amostras) e o shader lê o envelope **atrasado pela distância** (`t − r/c`), então as ondas viajam exatamente com a fala; normais por diferenças finitas, reflexo especular índigo. Avatares em quads com gradiente e anel de fala.
- **B:** vídeo da conversa. **C:** quadro com dois falando e as ondas cruzando.

### 5. "Sua tela, nítida" — a lente
- **Vê:** uma janela de transmissão com um **jogo que a gente mesmo gera**: voo baixo por um canal entre prédios na hora azul, janelas acendendo, HUD fino com nomes do grupo. A imagem está em **720p** (o grátis de lá). Onde o cursor passa, **uma lente de vidro mostra o mesmo quadro em 1080p** (o grátis daqui), com borda refrativa.
- **Faz:** passa a lente pelo HUD e pelos letreiros: fora, borrado; dentro, nítido. No toque, arrasta a lente.
- **Técnica:** cena renderizada uma vez em resolução cheia (prédios instanciados + névoa + HUD em textura 2D) → reduzida a 2/3 da resolução (a proporção exata 720/1080) para fora da lente; lente composta no mesmo passe. Honesto: só resolução, legenda diz que é simulação.
- **B:** vídeo do jogo + comparação parada 720/1080 com a lente fixa. **C:** quadro com a lente fixa sobre o HUD.

### 6. "Leve como uma alga"
- **Vê:** a água fica mais clara. Uma esfera escura e densa — **808 MB, 6 processos** — afunda pesada e levanta sedimento ao bater no fundo; uma bolha de vidro com a fronde índigo dentro — **230 MB** — **sobe flutuando** e balança até a superfície. Área proporcional à memória.
- **Técnica:** as duas formas vivem no shader da água global (esferas com luz e refração falsa), posições por rolagem com física de empuxo (subida com amortecimento, queda com impacto). Rótulos em HTML acompanham.
- **B/C:** vídeo / quadro da cena final (bolha em cima, esfera no fundo).

### 7. Fechamento — a superfície
- **Vê:** subimos; a câmera **atravessa a superfície** e o horizonte da Hora Azul nasce (céu índigo, linha de luz). As duas frondes do Encosto voltam e **se encontram** no momento em que aparece "Chama o pessoal." O botão de baixar responde ao clique com um anel de luz que corre pela água.
- **Técnica:** o mesmo shader global (profundidade → 0 → acima da superfície); clique gera impulso de onda no shader; sem `PUBLIC_DOWNLOAD_URL`, o aviso honesto de beta fechado.

## Entre capítulos
- **A água é a transição:** a profundidade, a cor e os raios mudam com a rolagem, então não há corte seco.
- **Luz do cursor** (A, mouse): segue com atraso, deixa anéis na água.
- **Botões magnéticos** (A, mouse) e **texto que nasce da luz** (títulos dos capítulos: palavras saem do desfoque com brilho índigo).
- **Bordas líquidas:** a borda superior das seções de conteúdo ondula com a velocidade da rolagem.

## Texto (tom)
Curto, quente, confiante. Uma ideia por tela. Números só de `src/data/facts.ts`.
