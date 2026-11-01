// Nível A: rolagem suave (Lenis, só com mouse/trackpad) + sequências ligadas à rolagem (GSAP ScrollTrigger).
// Carregado sob demanda depois da primeira pintura; nada aqui decide o LCP.
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';

const fmt = (n: number, dec: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec });

export function initTierA() {
  gsap.registerPlugin(ScrollTrigger);
  const fine = matchMedia('(pointer: fine)').matches;

  if (fine) {
    const lenis = new Lenis({ lerp: 0.11, wheelMultiplier: 1 });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add((t) => lenis.raf(t * 1000));
    gsap.ticker.lagSmoothing(0);
    // âncoras internas passam pelo Lenis para não "pular"
    for (const a of document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')) {
      a.addEventListener('click', (e) => {
        const id = a.getAttribute('href')!;
        const el = id.length > 1 ? document.querySelector<HTMLElement>(id) : null;
        if (!el) return;
        e.preventDefault();
        lenis.scrollTo(el, { offset: -64, duration: 1.2 });
        history.replaceState(null, '', id);
      });
    }
  }

  // Revelação em lote: sobe 16 px e acende, 80 ms entre vizinhos.
  ScrollTrigger.batch('[data-reveal]', {
    start: 'top 90%',
    once: true,
    onEnter: (els) => gsap.to(els, { opacity: 1, y: 0, duration: 0.9, ease: 'expo.out', stagger: 0.08, overwrite: true }),
  });

  // Hero: a janela do app deita para trás e endireita conforme você desce, como quem puxa a tela para perto.
  const shot = document.querySelector('[data-hero-shot]');
  if (shot) {
    gsap.fromTo(shot,
      { rotateX: 24, scale: 0.9, yPercent: 4, transformOrigin: '50% 0%' },
      { rotateX: 0, scale: 1, yPercent: 0, ease: 'none', scrollTrigger: { trigger: shot, start: 'top 92%', end: 'top 18%', scrub: 0.6 } });
  }

  // Luz do hero segue o cursor, com atraso (só com mouse).
  const glow = document.querySelector<HTMLElement>('[data-glow]');
  if (glow && fine) {
    const x = gsap.quickTo(glow, 'x', { duration: 1.2, ease: 'power3.out' });
    const y = gsap.quickTo(glow, 'y', { duration: 1.2, ease: 'power3.out' });
    const host = glow.parentElement!;
    host.addEventListener('pointermove', (e) => {
      const r = host.getBoundingClientRect();
      x(e.clientX - r.left - r.width / 2);
      y(e.clientY - r.top - r.height / 2);
    });
  }

  // Frase que acende palavra por palavra com a rolagem. Em tela larga ela fica presa no meio enquanto acende:
  // um capítulo, uma ideia. No celular só acompanha a rolagem, sem prender.
  const wide = matchMedia('(min-width: 900px) and (min-height: 600px)').matches;
  for (const lit of document.querySelectorAll<HTMLElement>('[data-lit]')) {
    gsap.fromTo(lit.querySelectorAll('.w'), { opacity: 0.18 }, {
      opacity: 1, ease: 'none', stagger: 0.12,
      scrollTrigger: wide
        ? { trigger: lit, start: 'center 52%', end: '+=85%', pin: true, scrub: 0.4 }
        : { trigger: lit, start: 'top 78%', end: 'bottom 42%', scrub: true },
    });
  }

  // Contadores: do zero ao número medido, uma vez.
  for (const el of document.querySelectorAll<HTMLElement>('[data-count]')) {
    const to = Number(el.dataset.count), dec = Number(el.dataset.dec || 0), o = { v: 0 };
    ScrollTrigger.create({
      trigger: el, start: 'top 88%', once: true,
      onEnter: () => gsap.to(o, { v: to, duration: 1.6, ease: 'expo.out', onUpdate: () => { el.textContent = fmt(o.v, dec); } }),
    });
  }

  // Barras de memória: crescem juntas, no mesmo ritmo, então a proporção entre elas é verdadeira em todo quadro.
  for (const bars of document.querySelectorAll<HTMLElement>('[data-bars]')) {
    const fills = bars.querySelectorAll('.fill');
    gsap.set(fills, { scaleX: 0 });
    ScrollTrigger.create({ trigger: bars, start: 'top 75%', once: true, onEnter: () => gsap.to(fills, { scaleX: 1, duration: 1.6, ease: 'expo.out' }) });
  }

  // Comparador: a linha passeia uma vez para mostrar que dá para arrastar.
  for (const cmp of document.querySelectorAll<HTMLElement>('[data-compare]')) {
    const input = cmp.querySelector<HTMLInputElement>('input[type=range]')!;
    const o = { v: 50 };
    const apply = () => { input.value = String(o.v); cmp.style.setProperty('--pos', o.v + '%'); };
    let touched = false;
    input.addEventListener('pointerdown', () => { touched = true; gsap.killTweensOf(o); }, { once: true });
    ScrollTrigger.create({
      trigger: cmp, start: 'top 70%', once: true,
      onEnter: () => { if (!touched) gsap.timeline({ onUpdate: apply }).to(o, { v: 22, duration: 0.9, ease: 'power2.inOut' }).to(o, { v: 78, duration: 1.3, ease: 'power2.inOut' }).to(o, { v: 50, duration: 0.9, ease: 'power2.inOut' }); },
    });
  }

  // Horizonte da hora azul sobe no fim da página.
  const sky = document.querySelector('[data-horizon]');
  if (sky) {
    gsap.fromTo(sky, { y: 160, opacity: 0.4 }, { y: 0, opacity: 1, ease: 'none', scrollTrigger: { trigger: sky, start: 'top bottom', end: 'bottom bottom', scrub: true } });
  }

  // Seções com parallax leve em imagens marcadas.
  for (const el of document.querySelectorAll<HTMLElement>('[data-parallax]')) {
    const amt = Number(el.dataset.parallax || 8);
    gsap.fromTo(el, { yPercent: amt }, { yPercent: -amt, ease: 'none', scrollTrigger: { trigger: el, start: 'top bottom', end: 'bottom top', scrub: true } });
  }

  // A pinagem empurra o que vem depois: recalcula tudo agora e de novo quando imagens e fonte terminarem.
  ScrollTrigger.refresh();
  if (document.readyState !== 'complete') addEventListener('load', () => ScrollTrigger.refresh(), { once: true });
  document.fonts?.ready.then(() => ScrollTrigger.refresh());
}
