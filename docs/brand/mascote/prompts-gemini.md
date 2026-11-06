# Mascote do Alga Meet — prompts para o Gemini (v3: mascote de verdade)

> 2026-11-05, v3. A v1 (criaturas fofas do mar) e a v2 (figuras dark cinematográficas) foram recusadas: eram **ilustrações**, não um **mascote**.
> Base desta versão: `docs/research/mascots/mascot-study.md` (Clawd do Claude Code, Molty do OpenClaw, pets do Codex, OpenCode).

## O que mudou

Um mascote é uma **especificação simples** (grid, 4 cores, poucas formas, estados) da qual todas as imagens saem, e não uma imagem bonita. Ele tem de:
- ser desenhável de memória;
- ler bem com 16 a 24 px, até numa cor só;
- ter rosto de **dois elementos, sem boca**, que mudam para mostrar o estado;
- viver no app ligado a coisas reais: falando, ouvindo, conectando, erro, vazio;
- **nascer da matéria do produto**. O do Claude Code é feito de blocos do terminal e o do Codex tem `>_` no rosto. O nosso tem um **medidor de voz** no rosto.

O "dark com aura" continua, só que feito com as ferramentas de mascote:
- **corpo escuro**;
- **contorno duro de 1 pixel em índigo** (a "aura");
- **olhos como a única luz**;
- **um corte de pálpebra inclinado** (a atitude).

Nada de fumaça, brilho ou névoa.

## O personagem: Eco (nome provisório)
- **Corpo:** um bloco compacto e escuro, grafite.
- **Rosto:** um visor com **dois olhos em barra**. Quando alguém fala, as barras sobem e descem como um medidor de voz.
- **Topo da cabeça:** duas folhas finas e afiadas, inclinadas uma para a outra. É o logo do Alga Meet virando "antenas", e dá uma silhueta só nossa.

## Como usar

1. Use **uma conversa nova** no Gemini, para ele não carregar o estilo das versões antigas.
2. Mande o **Prompt 0** (contexto, sem imagem).
3. Mande o **Prompt 1** e escolha uma das três silhuetas.
4. Responda: "This is the master. Keep exactly this sprite, palette and grid." Depois siga com os Prompts 2 e 3.
5. Me mande as imagens. **O desenho final eu refaço pixel a pixel em SVG**: nítido em qualquer tamanho, leve, e animável no app. O Gemini serve para achar a silhueta e a personalidade.

---

## Prompt 0 — Contexto (sem imagem)

```
You are designing the MASCOT of Alga Meet. Read this and do not generate an image yet; reply with a 3-line summary.

IMPORTANT: a mascot is not an illustration. It is a simple character system, like the small pixel creatures that live inside developer tools: drawable from memory, built on a pixel grid with very few flat colors, readable at 16 px, with a face made of only two elements and no mouth, and with a set of states (idle, talking, error...) that the app shows in real situations. Personality comes from tiny changes in the eyes and posture, not from detail.

THE PRODUCT
Alga Meet is a desktop app where friends talk by voice late at night, play games and share their screens. Dark, minimal interface. Built for young gamers in Brazil.

THE BRAND
The logo is two slender, sharp fronds leaning into each other, one indigo and one white. Colors: near-black #0B0B0C, graphite #1E1E26, indigo #8B8EF7, cold white #F7F8F8.

THE CHARACTER: "ECO"
A small dark creature that lives in the voice channels. Cool, calm, slightly mysterious, a bit of attitude; never cute in a childish way. Its face is a small visor with two bar-shaped eyes that work like a voice meter: when someone talks, the bars move. On top of its head, two slender sharp fronds leaning into each other (our logo) work as antennae.

STYLE RULES (ALWAYS)
- Pixel art on a 16x16 grid (character inside, centered on a 24x24 canvas), shown enlarged with perfectly crisp square pixels.
- Maximum 4 flat colors: graphite body #1E1E26, a 1-pixel hard indigo #8B8EF7 outline as its "aura", eyes in cold white #F7F8F8 or light indigo, and at most one mid-tone for inner shadow.
- Background: flat #0B0B0C.
- No gradients, no glow, no blur, no smoke, no particles, no reflections in the eyes, no mouth, no cheeks, no anti-aliasing, no text, no watermark.
- Strong, compact, slightly angular silhouette that reads as a solid shape at 16 px.
```

---

## Prompt 1 — Três silhuetas para escolher
*O mesmo Eco em três formatos de corpo. Você escolhe um.*

```
Draw ECO in 3 silhouette options side by side, same pixel grid, same 4-color palette, same face (visor with two white bar eyes), same two frond antennae on top. Each sprite large and centered with a lot of empty #0B0B0C around it.

Option A, THE BLOCK: a wide rectangular body like a tiny amplifier, two short pixel legs, the visor across the front.
Option B, THE HOOD: a compact body with a short pointed hood shape; the visor sits in the dark opening of the hood; the two frond antennae come out through the top of the hood.
Option C, THE SPIRIT: a floating body with no legs; its bottom edge is a jagged 3-step pixel flame, like a small ghost made of the indigo outline.

Pixel art, crisp squares, flat colors, no glow, no gradients, no text.
```

---

## Prompt 2 — Folha de estados (depois de escolher)
*As expressões que o app vai mostrar. Só os olhos, as antenas ou 1 pixel de posição mudam.*

```
Use the option I chose as the master sprite. Make a sprite sheet: 10 states in a grid, same sprite, same size, same palette, each changing only the eyes, the antennae or a 1-pixel offset:
1. idle (normal bar eyes)
2. blink (eyes become a thin line)
3. talking (the two eye bars at different heights, like a voice meter)
4. listening (eyes shifted to one side, one antenna tilted toward the sound)
5. muted (eyes closed as flat lines, antennae drooping)
6. connecting (a single bright eye pixel scanning across the visor)
7. streaming (the visor shows a tiny rectangle, like a screen)
8. sleeping / empty room (eyes as low lines, a small "z" made of pixels touching its head)
9. error (eyes as two small x's, antennae fallen)
10. success (eyes as ^ ^, sprite raised by 2 pixels)
Pixel art, crisp squares, flat colors, no glow, no text labels.
```

---

## Prompt 3 — Avatares para quem não tem foto
*O mesmo Eco com variações de cor e acessório. Cada pessoa ganha o seu.*

```
Using the same master sprite and grid, make 12 avatar variations in a 4x3 grid, each centered inside a circle on #0B0B0C. Keep the dark body, the 2-element face and the frond antennae. Vary only:
- the accent color of the outline and eyes, one per avatar: indigo, crimson, cyan, violet, amber, toxic green, ice white, teal;
- one accessory per avatar, made of a few pixels: gaming headset, cap worn backwards, beanie, short hood, single-line face mask, cat-ear headset, small earring, visor shades, bandana, scarf, crown of three pixels, horns;
- the eye shape: bar, slit, dot or visor line.
Some must read as masculine, some as feminine, some neutral. All cool and a bit mysterious, none childish.
Pixel art, crisp squares, flat colors, no glow, no gradients, no text.
```

---

## Extra — Versão vetorial plana (opcional)
*O mesmo Eco em vetor de três formas, para usos grandes como boas-vindas e site.*

```
Redraw the master ECO as a flat vector mascot built from 3 to 4 simple shapes: the body, the visor, the two bar eyes and the two frond antennae. Flat colors from the same palette, a crisp indigo outline, no gradients, no glow, no texture. Centered on #0B0B0C. No text.
```

---

## O que eu observo quando você mandar as imagens

- **É mascote?** Dá para desenhar de memória? Lê bem pequeno?
- **Atitude sem fofura:** escuro, contorno índigo, olhos como única luz, nenhuma boca.
- **Marca:** as duas folhas no topo são reconhecíveis como o logo.
- **Produto:** o rosto-medidor de voz funciona nos estados.
- **Família:** as variações de avatar continuam sendo o mesmo Eco.
