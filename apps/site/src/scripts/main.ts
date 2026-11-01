// Entrada de JS da página. Interações valem para todos os níveis; movimento depende do nível
// decidido no <head> (Base.astro): A = GSAP + ScrollTrigger + Lenis, B = CSS + IntersectionObserver, C = estático.
const root = document.documentElement;
type Tier = 'a' | 'b' | 'c';
let tier = (root.dataset.tier || 'c') as Tier;
const forced = new URLSearchParams(location.search).has('tier');

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

initNav();
initInvite();
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
  const { initVoiceRoom } = await import('./voice-room');
  initVoiceRoom(tier);
}
