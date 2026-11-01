// Roteiro da sala (nível A): a gota cai, o chão acende, a rolagem é a linha do tempo da conversa.
// "Ouvir a sala" toca a conversa em tempo real com som sintetizado; a rolagem continua mandando se for adiante.
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Room } from './room';
import { lines, people, T, lineAt } from '../../data/conversation';
import type { World } from '../world/world';

export function initRoom(world: World | null) {
  const ch = document.querySelector<HTMLElement>('[data-room-ch]');
  const host = document.querySelector<HTMLElement>('[data-room-gl]');
  if (!ch || !host) return;
  let room: Room;
  try { room = new Room(host); } catch { return; }
  const names = [...ch.querySelectorAll<HTMLElement>('[data-name]')];
  const who = ch.querySelector<HTMLElement>('[data-cap-who]')!;
  const text = ch.querySelector<HTMLElement>('[data-cap-text]')!;
  const btn = ch.querySelector<HTMLButtonElement>('[data-listen]')!;
  const narrow = innerWidth < 760;

  const s = { t: -1 };
  let playing = false, tp = 0, last = performance.now(), shownLine = -2;
  let audio: import('./audio').RoomAudio | null = null;

  const setLine = (i: number) => {
    if (i === shownLine) return;
    shownLine = i;
    const l = lines[i];
    who.textContent = l ? (l.laugh ? 'Todo mundo' : people[l.who[0]].name) : '';
    text.textContent = l ? l.text : '';
    if (l) gsap.fromTo(text, { opacity: 0, y: 8, filter: 'blur(6px)' }, { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.35, ease: 'power2.out' });
  };

  room.onFrame = () => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (playing) {
      tp += dt;
      if (s.t > tp + 0.4) { tp = s.t; audio?.play(tp); }
      if (tp >= T + 0.4) toggle(false);
    }
    room.t = playing ? Math.max(s.t, tp) : s.t;
    const li = room.t < 0 ? -1 : lineAt(room.t);
    setLine(li);
    const speaking = li >= 0 && room.t < (lines[li + 1]?.at ?? T + 0.3) - 0.2 ? lines[li].who : [];
    names.forEach((n, i) => {
      const [x, y] = room.screen(i);
      n.style.transform = `translate(${x}px, ${y}px) translate(-50%, 0)`;
      n.style.opacity = String(gsap.utils.clamp(0, 1, (room.reveal - 3) / 2));
      n.classList.toggle('on', speaking.includes(i));
    });
  };

  const toggle = async (on: boolean) => {
    playing = on;
    btn.setAttribute('aria-pressed', String(on));
    if (on) {
      if (!audio) { const { RoomAudio } = await import('./audio'); audio = new RoomAudio(); }
      tp = s.t < 0 || s.t >= T ? 0 : s.t;
      audio.play(tp);
    } else audio?.stop();
  };
  btn.addEventListener('click', () => toggle(!playing));
  // O "Ouvir a sala" do topo leva até a sala e já liga o som (o clique é o gesto que o navegador exige).
  for (const a of document.querySelectorAll<HTMLAnchorElement>('a[href="#sala"]')) a.addEventListener('click', () => { setTimeout(() => toggle(true), 1500); });

  // A sala só renderiza perto da tela; com ela cobrindo tudo, a água global descansa.
  ScrollTrigger.create({ trigger: ch, start: 'top bottom', end: 'bottom top', onToggle: (st) => (st.isActive ? room.start() : (room.stop(), playing && toggle(false))) });
  if (world) ScrollTrigger.create({ trigger: ch, start: 'top top', end: 'bottom bottom', onToggle: (st) => (st.isActive ? world.stop() : world.start()) });

  const tl = gsap.timeline({ defaults: { ease: 'none' } });
  tl.set(room, { elev: 1.15, dist: narrow ? 16 : 10, azimuth: -0.6, shift: narrow ? 0.4 : 0.35 }, 0)
    .fromTo(room, { dropY: 3.4, dropOn: 0 }, { dropY: 0.02, dropOn: 1, duration: 0.8, ease: 'power2.in' }, 0)
    .to(room, { elev: narrow ? 1.0 : 0.8, dist: narrow ? 14.5 : 9.4, duration: 2.4, ease: 'power2.inOut' }, 0)
    .to(room, { dropOn: 0, duration: 0.15 }, 0.8)
    .fromTo(room, { impact: 0, reveal: 0 }, { impact: 2.6, reveal: 9, duration: 1.6, ease: 'power1.out' }, 0.8)
    .fromTo(s, { t: -1 }, { t: 0, duration: 0.2 }, 1.4)
    .to(s, { t: T, duration: 7.0 }, 1.6)
    .to(room, { azimuth: 0.55, duration: 7.0 }, 1.6)
    .to('.room-head', { opacity: 0, y: -20, duration: 0.5 }, 2.6)
    .to('[data-caption]', { opacity: 0, duration: 0.4 }, 8.7)
    .to(room, { elev: 1.38, dist: narrow ? 17 : 14, duration: 1.4, ease: 'power2.inOut' }, 8.6)
    .fromTo('[data-latency]', { opacity: 0, scale: 0.94 }, { opacity: 1, scale: 1, duration: 0.8, ease: 'power2.out' }, 9.0)
    .set({}, {}, 10.4);
  ScrollTrigger.create({ trigger: ch, start: 'top top', end: 'bottom bottom', scrub: 0.6, animation: tl });
  addEventListener('pagehide', () => room.dispose(), { once: true });
}
