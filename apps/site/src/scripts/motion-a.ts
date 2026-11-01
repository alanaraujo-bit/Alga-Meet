// Nível A: água WebGL global + rolagem suave (Lenis, só mouse/trackpad) + roteiro ligado à rolagem (GSAP ScrollTrigger).
// Carregado sob demanda depois da primeira pintura; nada aqui decide o LCP.
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { World } from './world/world';

const fmt = (n: number, dec: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
const $ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document) => r.querySelector<T>(s);
const $$ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document) => [...r.querySelectorAll<T>(s)];

export let world: World | null = null;

export function initTierA() {
  gsap.registerPlugin(ScrollTrigger);
  const fine = matchMedia('(pointer: fine)').matches;
  const narrow = innerWidth < 760;
  let velocity = 0;

  if (fine) {
    const lenis = new Lenis({ lerp: 0.1, wheelMultiplier: 0.9 });
    lenis.on('scroll', (e: { velocity: number }) => { velocity = e.velocity; ScrollTrigger.update(); });
    gsap.ticker.add((t) => lenis.raf(t * 1000));
    gsap.ticker.lagSmoothing(0);
    for (const a of $$<HTMLAnchorElement>('a[href^="#"]')) {
      a.addEventListener('click', (e) => {
        const id = a.getAttribute('href')!;
        const el = id.length > 1 ? $(id) : null;
        if (!el) return;
        e.preventDefault();
        lenis.scrollTo(el, { offset: -64, duration: 1.4 });
        history.replaceState(null, '', id);
      });
    }
  } else {
    let last = scrollY;
    gsap.ticker.add(() => { velocity = (scrollY - last) * 0.6; last = scrollY; });
  }

  // ---- A água ----
  try {
    world = new World();
  } catch {
    world = null; // sem WebGL: fica o fundo em CSS e o resto do roteiro
  }
  const w = world;
  if (w) {
    w.start();
    document.documentElement.classList.add('gl-on');
    addEventListener('pagehide', () => w.dispose(), { once: true });
    w.onFrame = () => {
      velocity *= 0.92;
      w.flow += (gsap.utils.clamp(-1, 1, velocity / 60) - w.flow) * 0.08;
      w.blade.bend = w.flow * -0.08;
      w.scroll = scrollY / innerHeight * 0.35;
    };
    // As frondes crescem, a índigo se inclina e encosta na branca; a água responde ao toque.
    const g = { a: 0, b: 0 };
    const sync = () => { w.blade.grow[0] = g.a; w.blade.grow[1] = g.b; };
    gsap.timeline({ delay: 0.25, onUpdate: sync })
      .to(g, { a: 1, duration: 2.6, ease: 'power2.out' }, 0)
      .to(g, { b: 1, duration: 2.2, ease: 'power2.out' }, 0.55)
      .to(w.blade, { lean: 0, duration: 1.5, ease: 'expo.inOut' }, 2.5)
      .add(() => {
        const cx = narrow ? 0.5 : 0.71;
        w.ripple(cx, narrow ? 0.86 : 0.78, 1.4);
      }, 3.75)
      .fromTo(w.blade, { glow: 0 }, { glow: 0.5, duration: 0.25, yoyo: true, repeat: 1, ease: 'sine.inOut' }, 3.7);
    // Clique em qualquer lugar: um anel de luz corre pela água.
    addEventListener('pointerdown', (e) => w.ripple(e.clientX / innerWidth, e.clientY / innerHeight, 1.1), { passive: true });
  }

  initHero(w, narrow);
  initMagnetic(fine);
  initRest();

  ScrollTrigger.refresh();
  if (document.readyState !== 'complete') addEventListener('load', () => ScrollTrigger.refresh(), { once: true });
  document.fonts?.ready.then(() => ScrollTrigger.refresh());
}

// Abertura → mergulho → janela que sobe da luz → vista explodida (pilha isométrica) → clique → afunda para a sala.
function initHero(w: World | null, narrow: boolean) {
  const hero = $('[data-hero]');
  const win = $('[data-win]');
  const tilt = $('[data-tilt]');
  if (!hero || !win || !tilt) return;
  const scene = tilt.parentElement!;
  const layers = $$('[data-layer]', win);
  const pops = $$('[data-pop]', win);
  const tags = $$('[data-tag]', win);
  const k = narrow ? 0.5 : 1;
  const X = narrow ? 44 : 54, R = narrow ? -16 : -32;
  const vh = (f: number) => () => innerHeight * f;
  const sheen = $('[data-sheen]', win)!;
  const flash = $('[data-flash]', win)!;
  // rótulos de frente para a câmera na pose explodida
  gsap.set(tags, { '--rz': `${-R - 4}deg`, '--rx': `${-X}deg` });

  const tl = gsap.timeline({ defaults: { ease: 'none' } });
  // 1) o texto sobe e se apaga; a câmera mergulha entre as frondes
  tl.to('[data-copy]', { yPercent: -18, opacity: 0, duration: 1.2, ease: 'power1.in' }, 0)
    .to('[data-cue]', { opacity: 0, duration: 0.4 }, 0);
  if (w) {
    tl.to(w.cam, { z: 2.2, y: -0.4, duration: 3.4, ease: 'power1.inOut' }, 0)
      .to(w.blade, { fade: 0, duration: 1.4 }, 1.6)
      .to(w.state.pool, { y: 0.12, i: 1.25, duration: 1.8, ease: 'power2.out' }, 0.5)
      .to(w.state.pool, { y: 0.32, r: 1.6, i: 0.35, duration: 1.4, ease: 'power1.inOut' }, 2.3);
  }
  // 2) a janela sobe da luz, deitada, e endireita; camadas em paralaxe
  // (a opacidade fica no pai: opacidade < 1 num elemento preserve-3d achata o 3D)
  tl.fromTo(tilt, { rotateX: 64 }, { rotateX: 0, duration: 2.4, ease: 'power2.out' }, 0.8)
    .fromTo(win, { y: vh(0.75), scale: 0.86, z: -220 }, { y: 0, scale: 1, z: 0, duration: 2.4, ease: 'power2.out' }, 0.8)
    .fromTo(scene, { opacity: 0 }, { opacity: 1, duration: 1.2, ease: 'power1.out' }, 0.8);
  layers.forEach((l) => tl.fromTo(l, { z: Number(l.dataset.z) * 0.2 * k }, { z: 0, duration: 2.4, ease: 'power2.out' }, 0.8));
  tl.fromTo(sheen, { '--sx': '120%', opacity: 0 }, { '--sx': '-40%', opacity: 1, duration: 1.8, ease: 'power1.inOut' }, 1.6)
    .to(sheen, { opacity: 0, duration: 0.5 }, 3.2)
    .fromTo('[data-cap="1"]', { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.5, ease: 'power2.out' }, 3.2)
    .to('[data-cap="1"]', { opacity: 0, y: -16, duration: 0.4 }, 4.4);
  // 3) vista explodida: a janela deita, gira e as camadas sobem em pilha
  tl.to(tilt, { rotateX: X, duration: 2.2, ease: 'power2.inOut' }, 4.4)
    .to(win, { rotation: R, scale: narrow ? 0.8 : 0.56, x: narrow ? 0 : () => innerWidth * 0.08, y: vh(narrow ? 0.08 : 0.17), duration: 2.2, ease: 'power2.inOut' }, 4.4)
    .to('[data-slab]', { '--edge': 1, duration: 2 }, 4.4).to('[data-slab]', { '--edge': 0, duration: 0.7, ease: 'expo.in' }, 7.7);
  layers.forEach((l, i) => tl.to(l, { z: Number(l.dataset.z) * k, '--edge': 1, duration: 2.0, ease: 'power3.inOut' }, 4.6 + i * 0.07));
  pops.forEach((p, i) => tl.fromTo(p, { z: 0, opacity: 0 }, { z: Number(p.dataset.z) * k, opacity: 1, '--edge': 1, duration: 1.8, ease: 'power3.inOut' }, 4.9 + i * 0.12));
  tags.forEach((t, i) => tl.set(t, { '--tz': `${Number(t.dataset.z) * k}px` }, 4.4).fromTo(t, { opacity: 0 }, { opacity: 1, duration: 0.45, ease: 'power2.out' }, 6.0 + i * 0.2));
  tl.fromTo('[data-cap="2"]', { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.5, ease: 'power2.out' }, 5.4)
    .to(win, { rotation: R + 8, duration: 1.3 }, 6.6);
  // 4) tudo se fecha de uma vez (clique), com um lampejo nas emendas
  tl.to('[data-cap="2"]', { opacity: 0, duration: 0.3 }, 7.6)
    .to(tags, { opacity: 0, duration: 0.2 }, 7.6)
    .to(tilt, { rotateX: 0, duration: 0.7, ease: 'expo.in' }, 7.7)
    .to(win, { rotation: 0, scale: 1, x: 0, y: 0, duration: 0.7, ease: 'expo.in' }, 7.7);
  layers.forEach((l) => tl.to(l, { z: 0, '--edge': 0, duration: 0.7, ease: 'expo.in' }, 7.7));
  pops.forEach((p) => tl.to(p, { z: 0, opacity: 0, '--edge': 0, duration: 0.7, ease: 'expo.in' }, 7.7));
  tl.fromTo(flash, { opacity: 0 }, { opacity: 1, duration: 0.08 }, 8.4).to(flash, { opacity: 0, duration: 0.6, ease: 'power2.out' }, 8.48);
  // 5) a janela afunda e a água escurece: estamos descendo para a sala
  tl.to(tilt, { rotateX: -30, duration: 1.4, ease: 'power2.in' }, 8.9)
    .to(win, { y: vh(0.55), scale: 0.7, duration: 1.4, ease: 'power2.in' }, 8.9)
    .to(scene, { opacity: 0, duration: 1.2, ease: 'power2.in' }, 9.0);
  if (w) tl.to(w.state, { depth: 0.75, rays: 0.45, duration: 1.4 }, 8.9).to(w.state.pool, { i: 0, duration: 1 }, 8.9);
  tl.set({}, {}, 10.3);

  let clicked = false;
  ScrollTrigger.create({
    trigger: hero, start: 'top top', end: 'bottom bottom', scrub: 0.7, animation: tl, invalidateOnRefresh: true,
    onUpdate: (self) => {
      // o "clique" da montagem: um anel na água e um tranco mínimo na janela
      const at = tl.progress() * tl.duration();
      if (!clicked && at > 8.4 && self.direction > 0) {
        clicked = true;
        w?.ripple(0.5, 0.52, 2.2);
        gsap.fromTo(scene, { '--bump': 1.015 }, { '--bump': 1, duration: 0.55, ease: 'elastic.out(1, 0.4)', overwrite: true });
      }
      if (at < 8.2) clicked = false;
    },
  });
}

// Botões magnéticos (só mouse): o botão vem um pouco na direção do cursor.
function initMagnetic(fine: boolean) {
  if (!fine) return;
  for (const b of $$('.btn')) {
    const x = gsap.quickTo(b, 'x', { duration: 0.5, ease: 'power3.out' });
    const y = gsap.quickTo(b, 'y', { duration: 0.5, ease: 'power3.out' });
    b.addEventListener('pointermove', (e) => {
      const r = b.getBoundingClientRect();
      x((e.clientX - r.left - r.width / 2) * 0.28);
      y((e.clientY - r.top - r.height / 2) * 0.38);
    });
    b.addEventListener('pointerleave', () => { x(0); y(0); });
  }
}

// Seções de conteúdo (até ganharem os próprios momentos).
function initRest() {
  ScrollTrigger.batch('[data-reveal]', {
    start: 'top 90%', once: true,
    onEnter: (els) => gsap.to(els, { opacity: 1, y: 0, duration: 0.9, ease: 'expo.out', stagger: 0.08, overwrite: true }),
  });
  const wide = matchMedia('(min-width: 900px) and (min-height: 600px)').matches;
  for (const lit of $$('[data-lit]')) {
    gsap.fromTo(lit.querySelectorAll('.w'), { opacity: 0.18 }, {
      opacity: 1, ease: 'none', stagger: 0.12,
      scrollTrigger: wide ? { trigger: lit, start: 'center 52%', end: '+=85%', pin: true, scrub: 0.4 } : { trigger: lit, start: 'top 78%', end: 'bottom 42%', scrub: true },
    });
  }
  for (const el of $$('[data-count]')) {
    const to = Number(el.dataset.count), dec = Number(el.dataset.dec || 0), o = { v: 0 };
    ScrollTrigger.create({ trigger: el, start: 'top 88%', once: true, onEnter: () => gsap.to(o, { v: to, duration: 1.6, ease: 'expo.out', onUpdate: () => { el.textContent = fmt(o.v, dec); } }) });
  }
  for (const bars of $$('[data-bars]')) {
    const fills = bars.querySelectorAll('.fill');
    gsap.set(fills, { scaleX: 0 });
    ScrollTrigger.create({ trigger: bars, start: 'top 75%', once: true, onEnter: () => gsap.to(fills, { scaleX: 1, duration: 1.6, ease: 'expo.out' }) });
  }
  for (const cmp of $$('[data-compare]')) {
    const input = cmp.querySelector<HTMLInputElement>('input[type=range]')!;
    const o = { v: 50 };
    const apply = () => { input.value = String(o.v); cmp.style.setProperty('--pos', o.v + '%'); };
    let touched = false;
    input.addEventListener('pointerdown', () => { touched = true; gsap.killTweensOf(o); }, { once: true });
    ScrollTrigger.create({ trigger: cmp, start: 'top 70%', once: true, onEnter: () => { if (!touched) gsap.timeline({ onUpdate: apply }).to(o, { v: 22, duration: 0.9, ease: 'power2.inOut' }).to(o, { v: 78, duration: 1.3, ease: 'power2.inOut' }).to(o, { v: 50, duration: 0.9, ease: 'power2.inOut' }); } });
  }
  const sky = $('[data-horizon]');
  if (sky) gsap.fromTo(sky, { y: 160, opacity: 0.4 }, { y: 0, opacity: 1, ease: 'none', scrollTrigger: { trigger: sky, start: 'top bottom', end: 'bottom bottom', scrub: true } });
  for (const el of $$('[data-parallax]')) {
    const amt = Number(el.dataset.parallax || 8);
    gsap.fromTo(el, { yPercent: amt }, { yPercent: -amt, ease: 'none', scrollTrigger: { trigger: el, start: 'top bottom', end: 'bottom top', scrub: true } });
  }
}
