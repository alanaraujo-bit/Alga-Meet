// Entrada de JS da página. Interações valem para todos os níveis; movimento depende do nível
// decidido no <head> (Base.astro): A = GSAP + ScrollTrigger + Lenis, B = CSS + IntersectionObserver, C = estático.
const root = document.documentElement;
type Tier = 'a' | 'b' | 'c';
let tier = (root.dataset.tier || 'c') as Tier;
const forced = new URLSearchParams(location.search).has('tier');
// Trabalho que pode esperar: roda quando o navegador estiver ocioso (não disputa com a primeira pintura).
const idle = (fn: () => void) => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 1500 }) : setTimeout(fn, 200));


function setTier(t: Tier) {
  root.classList.remove('tier-' + tier);
  tier = t;
  root.classList.add('tier-' + t);
  root.dataset.tier = t;
}

// ---- Interações (todos os níveis) ----
function initNav() {
  const nav = document.querySelector<HTMLElement>('[data-nav]');
  if (!nav) return;
  let queued = false;
  const update = () => { queued = false; nav.classList.toggle('scrolled', scrollY > 8); };
  addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(update); } }, { passive: true });
  update();
  // Link da seção visível fica marcado (aria-current), para quem lê e para quem usa leitor de tela.
  const links = new Map([...nav.querySelectorAll<HTMLAnchorElement>('nav a[href^="#"]')].map((a) => [a.hash.slice(1), a]));
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      links.forEach((a, id) => (id === e.target.id ? a.setAttribute('aria-current', 'true') : a.removeAttribute('aria-current')));
    }
  }, { rootMargin: '-45% 0px -50% 0px' });
  links.forEach((_, id) => { const s = document.getElementById(id); if (s) io.observe(s); });
}

function initInvite() {
  const dlg = document.querySelector<HTMLDialogElement>('[data-invite]');
  if (!dlg) return;
  for (const b of document.querySelectorAll('[data-invite-open]')) b.addEventListener('click', () => dlg.showModal());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); }); // clique no fundo fecha
}

function initCompare() {
  for (const el of document.querySelectorAll<HTMLElement>('[data-compare]')) {
    const input = el.querySelector<HTMLInputElement>('input[type=range]');
    if (!input) continue;
    const set = () => el.style.setProperty('--pos', input.value + '%');
    input.addEventListener('input', set);
    set();
  }
}

function initNoise() {
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-noise-toggle]')) {
    const card = b.closest<HTMLElement>('[data-noise]');
    b.addEventListener('click', () => {
      const on = b.getAttribute('aria-pressed') !== 'true';
      b.setAttribute('aria-pressed', String(on));
      card?.classList.toggle('clean', on);
    });
  }
}

// ---- Movimento: utilidades comuns A/B ----
const fmt = (n: number, dec: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec });

function countUp(el: HTMLElement, ms = 1400) {
  const to = Number(el.dataset.count);
  const dec = Number(el.dataset.dec || 0);
  const t0 = performance.now();
  const step = (t: number) => {
    const k = Math.min(1, (t - t0) / ms);
    const e = 1 - Math.pow(1 - k, 4);
    el.textContent = fmt(to * e, dec);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// Mede ~30 quadros: aparelho que não segura ~45 fps desce de A para B (ninguém merece animação engasgando).
function probeFrames(): Promise<number> {
  return new Promise((resolve) => {
    const times: number[] = [];
    let last = performance.now();
    const tick = (t: number) => {
      times.push(t - last); last = t;
      if (times.length < 32) requestAnimationFrame(tick);
      else { times.sort((a, b) => a - b); resolve(times[Math.floor(times.length * 0.75)]); }
    };
    requestAnimationFrame(tick);
  });
}

function initTierB() {
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const el = e.target as HTMLElement;
      el.classList.add('in');
      if (el.dataset.count) countUp(el);
      io.unobserve(el);
    }
  }, { rootMargin: '0px 0px -12% 0px' });
  document.querySelectorAll('[data-reveal], [data-count], [data-bars], [data-lit]').forEach((el) => io.observe(el));
}

// Clique no download (A e B): anel de luz no botão e, com a água ligada, uma onda que corre por ela.
function initDownloadClick() {
  if (tier === 'c') return;
  for (const b of document.querySelectorAll<HTMLElement>('[data-download], [data-invite-open]')) {
    b.addEventListener('click', (e) => {
      const r = b.getBoundingClientRect();
      const ring = document.createElement('span');
      ring.className = 'ring';
      ring.style.setProperty('--rx', `${e.clientX - r.left}px`);
      ring.style.setProperty('--ry', `${e.clientY - r.top}px`);
      b.append(ring);
      setTimeout(() => ring.remove(), 850);
    });
  }
}

initNav();
initInvite();
idle(initDownloadClick);
initCompare();
initNoise();

if (tier !== 'c') {
  // A precisa provar que aguenta; o teste roda depois da primeira pintura, então não atrasa o LCP.
  if (tier === 'a' && !forced) {
    const p75 = await probeFrames();
    // Quadros ociosos não pesam nada; um laço fixo mede a CPU de verdade (~1,5 ms num desktop, ~9 ms com CPU 6× mais lenta).
    const t0 = performance.now();
    let x = 0;
    for (let i = 0; i < 1e6; i++) x += Math.sqrt(i);
    const cost = performance.now() - t0 + (x < 0 ? 1 : 0);
    if (p75 > 24 || cost > 8) setTier('b');
  }
  if (tier === 'a') {
    const { initTierA } = await import('./motion-a');
    initTierA();
  } else {
    initTierB();
  }
}

// Nível B: os momentos em vídeo gravado do próprio WebGL (public/media), só perto da tela e sem som.
// A foto (nível C) fica por baixo como pôster. data-once = toca uma vez e para no último quadro.
if (tier === 'b') idle(() => {
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const host = e.target as HTMLElement;
      let v = host.querySelector('video');
      if (e.isIntersecting && !v) {
        v = document.createElement('video');
        Object.assign(v, { muted: true, playsInline: true, autoplay: true, loop: !('once' in host.dataset), preload: 'auto' });
        v.setAttribute('aria-hidden', 'true');
        v.style.opacity = '0';
        v.style.transition = 'opacity 600ms';
        v.addEventListener('playing', () => { v!.style.opacity = '1'; }, { once: true });
        v.src = host.dataset.video!;
        host.append(v);
      } else if (v) {
        if (e.isIntersecting) v.play().catch(() => {}); else v.pause();
      }
    }
  }, { rootMargin: '200px' });
  document.querySelectorAll('[data-video]').forEach((el) => io.observe(el));
});

// A lente da transmissão vale para todos os níveis (A: WebGL; B/C: fotos + CSS).
idle(() => import('./lens/chapter').then(({ initLens }) => initLens(tier)));
