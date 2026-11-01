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
| `npm run og -w apps/site -- [url]` | Regera `public/og.jpg` (1200×630, imagem de compartilhamento) a partir do próprio hero. |

Os vídeos de rolagem ficam fora do git (`docs/site/videos/`); as capturas e os resumos do Lighthouse entram.

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

## Medições (2026-11-01)

Lighthouse 13.6 contra o build (`astro preview`, local, sem CDN). Celular = Moto G Power emulado (4G lento simulado, CPU 4× mais lenta). A rede real soma o TTFB do servidor.

| Nível | Forma | Desempenho | LCP | TBT | CLS | Peso | Acessibilidade · Boas práticas · SEO |
|---|---|---|---|---|---|---|---|
| A (auto) | celular | **99** | 1,9 s | 100 ms | **0** | 239 KiB | 100 · 100 · 100 |
| A (auto) | desktop | **100** | 0,4 s | 0 ms | **0** | 254 KiB | 100 · 100 · 100 |
| B | celular | **98** | 2,0 s | 150 ms | **0** | 189 KiB | 100 · 100 · 100 |
| C | celular | **98** | 1,9 s | 140 ms | **0** | 188 KiB | 100 · 100 · 100 |

- **Detecção de nível conferida no Playwright (390×844):**
  - CPU 1× e 4× → A;
  - CPU 6× e 10× → B;
  - `deviceMemory` 2 GB → B;
  - 4 GB com 4 núcleos → B;
  - `prefers-reduced-motion` → C.
  - Os níveis B e C não baixam o GSAP/Lenis (131 KB).
- **Comparação com a referência:**
  - o heyparker.ai mediu CLS 0,13 / 0,21 / 0,26 (desktop / tablet / celular) e transferiu 4,3 MB numa rolagem;
  - aqui o CLS é 0 e a página inteira pesa ~190–250 KiB, com o hero AVIF de 11–72 KB conforme a tela.
- **Capturas por seção:** `docs/site/screenshots/2026-11-01-<seção>-<390|768|1440|1920>-vN.png`. A versão mais alta é a atual.

## Rodada de crítica (v1 → v3)

Comparando com o estudo de referência e com o design system:

- **Comportamento**
  - **Capítulos:** a frase da voz fica presa no meio da tela enquanto acende (só em tela larga, nível A). É a "uma ideia por tela" da referência, sem prender a rolagem no celular.
  - **Barras de memória:** antes cresciam com a rolagem e em sequência, então no meio do caminho a barra do Discord podia aparecer menor que a nossa. Agora crescem juntas, e a proporção é verdadeira em todo quadro.
  - **Detecção de nível:** quadros ociosos não pesam nada, então um aparelho lento passava como A. Agora um laço fixo de CPU complementa a medição.
- **Layout**
  - **Hero no celular:** o app inteiro ficava ilegível em 358 px. Agora mostra a conversa ampliada, com as bordas sumindo.
  - **Hora Azul:** o texto saía em cima dos prédios. Agora o texto fica em cima e a cidade embaixo.
  - **Espaços:** o cartão estava vazio. Ganhou uma lista de canais com cargo.
  - **Fechamento:** o horizonte não aparecia. Virou a borda de um planeta com a luz índigo nascendo atrás.
- **Correções**
  - **Logo:** a marca sumia (`img` em flex encolhia para 0).
  - **Contraste:** a linha esmaecida do "Agora" e as notas em `#62666d` reprovavam AA no nível C. Foram corrigidas para 100 de acessibilidade nos três níveis.
  - **Captura:** a v1 de 390 saiu com seções vazias porque o dev server recarregou no meio. Foi descartada, e o script agora tolera recarga.

## O que depende do dono

- **Download de verdade:** `PUBLIC_DOWNLOAD_URL` precisa de uma release pública (repo de releases) e, de preferência, do certificado de assinatura. Sem ele, o SmartScreen avisa. Até lá, o site mostra o aviso de beta fechado.
- **Pedido de convite:** decidir o canal (formulário, e-mail, WhatsApp) e preencher `PUBLIC_INVITE_URL`.
- **Domínio e hospedagem:**
  - `PUBLIC_SITE_URL` (canonical e `og:image`).
  - O `dist/` é estático e serve em qualquer CDN (Cloudflare Pages, Vercel, Netlify).
- **Marca final:** trocar o arquivo em `Logo.astro` e `src/assets/brand/` quando os SVGs saírem em `apps/desktop/build/brand/web/`. O favicon vem do `concept-a-icon.svg`.
- **Preços e benefícios do Plus v2, e a Casa:** estão no site como "em validação" e "em breve". Aprovar ou ajustar o texto.
- **Capturas mais bonitas:** as capturas reais vêm da conta de teste. Uma transmissão real (jogo ou filme com direito de uso) e um palco de voz com 4–5 pessoas fariam as seções de tela e de grupo brilharem mais.
- **Números citados** (`src/data/facts.ts`, com a fonte de cada um):
  - a voz de 46 ms foi medida em rede local, e a página diz isso;
  - quando houver medição pela internet (SFU em São Paulo), trocar o número e a nota.
