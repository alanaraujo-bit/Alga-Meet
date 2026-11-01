# apps/site — site do Alga Meet

Página única de apresentação e download (pt-BR). Direção visual "Índigo suave" (`docs/design/design-system.md`). O estudo de referência está em `docs/research/site-reference-heyparker.md`.

## Rodar

```bash
npm run dev -w apps/site          # http://localhost:3100 (porta fixa)
npm run build -w apps/site        # gera apps/site/dist (estático)
npx astro preview --port 3102     # (dentro de apps/site) serve o build para medir
```

| Script | O que faz |
|---|---|
| `npm run shots -w apps/site` | Copia as capturas reais de `docs/screenshots` para `src/assets/shots`, cobre o selo "shots" da title bar e gera o par 720p/1080p do comparador. |
| `npm run shoot -w apps/site -- [url] [--tier=a\|b\|c] [--widths=390,1440] [--no-video]` | Playwright: cada seção em 390, 768, 1440 e 1920 → `docs/site/screenshots/<data>-<seção>-<largura>-vN.png`, mais um vídeo de rolagem por largura em `docs/site/videos/`. O histórico é preservado: o N cresce. |
| `npm run lighthouse -w apps/site -- [url] [--tier=…]` | Lighthouse (celular Moto G Power + desktop) contra o build em `astro preview`. Gera o resumo em `docs/site/lighthouse/`. |

## Download e convite

O botão "Baixar para Windows" lê variáveis de ambiente no build (veja `.env.example`):

| Variável | Efeito |
|---|---|
| `PUBLIC_DOWNLOAD_URL` | Link do instalador. **Definido:** todos os botões viram links reais para o `.exe`. **Vazio:** os botões abrem o aviso "O Alga Meet ainda é só para convidados" (`<dialog>` nativo). Nunca mostramos um download falso. |
| `PUBLIC_INVITE_URL` | Opcional. Com beta fechado, o aviso ganha o botão "Pedir convite" (formulário, `mailto:` ou `wa.me`). Sem ela, o texto pede o convite a quem mandou o site. |
| `PUBLIC_SITE_URL` | URL pública, usada no `canonical` e nas tags de compartilhamento. Padrão: `https://algameet.com.br`. |

```bash
# exemplo: apps/site/.env (fora do git)
PUBLIC_DOWNLOAD_URL=https://github.com/alanaraujo-bit/alga-meet/releases/latest/download/AlgaMeet-Setup.exe
```

## Stack e por quê

- **Astro 7 (estático).**
  - A página sai como HTML pronto, com o CSS inline.
  - **Zero JS no caminho crítico:** o único script é um módulo de ~4 KB, e o motor de animação só carrega depois da primeira pintura e só em aparelho que aguenta.
  - O `astro:assets` gera AVIF/WebP com `srcset` no build, sem serviço de imagem.
  - Next.js com export estático entregaria o mesmo HTML, mas com o runtime do React (~90 KB) que esta página não usa.
- **GSAP 3.15 + ScrollTrigger:** sequências ligadas à rolagem (janela que endireita, frase que acende, barras, comparador). É o padrão de mercado para esse tipo de movimento, gratuito desde a 3.13 e com `scrub`, `batch` e `quickTo` prontos. Fica só no nível A.
- **Lenis 1.3:** rolagem suave só com mouse/trackpad e só no nível A. No toque fica a rolagem nativa.
- **Inter Variable** (`@fontsource-variable/inter`, latin, eixos `opsz` + `wght`, 71 KB):
  - um arquivo só, pré-carregado e com `font-display: swap`;
  - `opsz 32` nos títulos, que é a Inter Display do app.
- **Sem WebGL.** A luz do índigo cabe em gradientes e `box-shadow`. Se um dia houver 3D, ele entra atrás do nível A.
- **Playwright + Lighthouse** (devDependencies) para as capturas e as medições.

## Níveis de desempenho (cada aparelho com o que aguenta)

A decisão roda num script inline no `<head>`, antes da primeira pintura (`Base.astro`). O nível vira classe no `<html>`:

| Nível | Quando | O que roda |
|---|---|---|
| **A** completo | Padrão. Depois da pintura, uma medição de ~32 quadros (`requestAnimationFrame`): se o p75 passar de 24 ms (< ~42 fps), cai para B. | GSAP + ScrollTrigger + Lenis (`src/scripts/motion-a.ts`, carregado sob demanda), envelope de fala simulado por quadro na sala de voz, luz que segue o cursor. |
| **B** só CSS | `deviceMemory ≤ 2`, ou `deviceMemory ≤ 4` com `hardwareConcurrency ≤ 4`, ou rede `3g`. | Revelação com `IntersectionObserver` + transições CSS, contadores leves, pulso de fala em CSS, sem vidro (`backdrop-filter`). |
| **C** estático | `prefers-reduced-motion`, `saveData` ou rede `2g`. | Nada anima. Tudo aparece pronto e completo, a interação continua (comparador, ruído, FAQ, convite). |

- Sem JS, a página fica completa e estática: nada é escondido sem a classe `js`.
- `?tier=a|b|c` força um nível para testar.
- Imagens:
  - o LCP é o texto do hero, e a captura do hero tem `fetchpriority=high` + `loading=eager`;
  - o resto é `lazy`;
  - todas têm `width`/`height`, então nada empurra o layout.
