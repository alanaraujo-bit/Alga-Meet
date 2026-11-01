// A "sala de voz" do hero: quem fala ganha o anel índigo, como no app (envelope tipo compressor:
// ataque 60 ms, release 240 ms). Nível A: envelope de fala simulado por quadro. Nível B: troca de quem
// fala a cada frase e o pulso fica no CSS. Pausa fora da tela e com a aba escondida.
export function initVoiceRoom(tier: 'a' | 'b') {
  const room = document.querySelector<HTMLElement>('[data-voice-room]');
  if (!room) return;
  const people = [...room.querySelectorAll<HTMLElement>('[data-person]')];
  const status = room.querySelector<HTMLElement>('[data-speaking]');
  if (!people.length) return;

  let visible = false;
  let speaker = 0;
  let phraseEnd = 0;
  let raf = 0;
  let timer = 0;
  const env = people.map(() => 0);

  const say = (i: number) => {
    speaker = i;
    people.forEach((p, j) => p.classList.toggle('talking', j === i));
    if (status) status.textContent = people[i].dataset.person + ' está falando';
  };
  const next = () => {
    let i = Math.floor(Math.random() * (people.length - 1));
    if (i >= speaker) i++;
    return i;
  };

  // Fala simulada: sílabas de 120–260 ms com intensidade variável, pausas curtas entre palavras.
  let sylEnd = 0, target = 0, last = 0;
  const frame = (t: number) => {
    if (t > phraseEnd) { say(next()); phraseEnd = t + 1600 + Math.random() * 2200; }
    if (t > sylEnd) {
      const pause = Math.random() < 0.18;
      target = pause ? 0 : 0.45 + Math.random() * 0.55;
      sylEnd = t + (pause ? 90 + Math.random() * 160 : 120 + Math.random() * 140);
    }
    const dt = last ? Math.min(64, t - last) : 16;
    last = t;
    people.forEach((p, i) => {
      const goal = i === speaker && t < phraseEnd - 150 ? target : 0;
      const tau = goal > env[i] ? 60 : 240;
      env[i] += (goal - env[i]) * (1 - Math.exp(-dt / tau));
      p.style.setProperty('--speak', env[i].toFixed(3));
    });
    raf = requestAnimationFrame(frame);
  };

  const start = () => {
    if (tier === 'a') { cancelAnimationFrame(raf); last = 0; raf = requestAnimationFrame(frame); }
    else {
      clearTimeout(timer);
      const loop = () => { say(next()); timer = window.setTimeout(loop, 2200 + Math.random() * 1600); };
      loop();
    }
  };
  const stop = () => { cancelAnimationFrame(raf); clearTimeout(timer); };

  room.classList.add('live', 'live-' + tier);
  say(0);
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; visible && !document.hidden ? start() : stop(); }).observe(room);
  document.addEventListener('visibilitychange', () => (visible && !document.hidden ? start() : stop()));
}
