// "Ouvir a sala": vozes sintetizadas no navegador (nenhuma gravação, nenhuma voz de IA).
// Cada sílaba é uma onda dente-de-serra passando por dois filtros nas formantes de uma vogal, com a altura de
// cada amigo e posição no estéreo pela roda. Por baixo, um tom de sala bem baixo.
import { people, syllables } from '../../data/conversation';

const VOWELS = [[780, 1250], [450, 1900], [320, 2250], [520, 920], [360, 800]]; // a é i ó u (F1, F2)
const PAN = people.map((_, i) => Math.cos(-Math.PI / 2 + (i * Math.PI * 2) / 5) * 0.7);

export class RoomAudio {
  private ctx: AudioContext;
  private master: GainNode;
  private live: AudioScheduledSourceNode[] = [];
  private pad: OscillatorNode[] = [];
  playing = false;

  constructor() {
    this.ctx = new AudioContext();
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 3;
    this.master = this.ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(comp).connect(this.ctx.destination);
  }

  /** Toca a conversa a partir de `from` segundos. */
  play(from: number) {
    this.halt();
    const c = this.ctx;
    if (c.state === 'suspended') c.resume();
    const now = c.currentTime + 0.06;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(0.9, now + 0.3);
    // tom de sala
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520;
    const pg = c.createGain(); pg.gain.value = 0.022;
    lp.connect(pg).connect(this.master);
    for (const f of [110, 164.8, 220.6]) { const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f; o.connect(lp); o.start(now); this.pad.push(o); }
    for (const s of syllables) {
      if (s.at + s.dur < from) continue;
      const t = now + Math.max(0, s.at - from);
      this.voice(s.who, t, s.dur, s.amp, s.vowel, s.bend);
    }
    this.playing = true;
  }

  private voice(who: number, t: number, dur: number, amp: number, vowel: number, bend: number) {
    const c = this.ctx;
    const f = people[who].pitch * bend;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f * 1.05, t);
    o.frequency.exponentialRampToValueAtTime(f * 0.96, t + dur);
    const [f1, f2] = VOWELS[vowel];
    const b1 = c.createBiquadFilter(); b1.type = 'bandpass'; b1.frequency.value = f1; b1.Q.value = 5;
    const b2 = c.createBiquadFilter(); b2.type = 'bandpass'; b2.frequency.value = f2; b2.Q.value = 7;
    const g = c.createGain();
    const peak = 0.55 * amp;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.018);
    g.gain.setValueAtTime(peak * 0.85, t + dur);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur + 0.07);
    const pan = c.createStereoPanner(); pan.pan.value = PAN[who];
    o.connect(b1); o.connect(b2);
    b1.connect(g); b2.connect(g);
    g.connect(pan).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.1);
    this.live.push(o);
    o.onended = () => { this.live = this.live.filter((x) => x !== o); };
  }

  private halt() {
    const t = this.ctx.currentTime;
    for (const o of [...this.live, ...this.pad]) { try { o.stop(t + 0.02); } catch { /* já parou */ } }
    this.live = []; this.pad = [];
  }

  stop() {
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(this.master.gain.value, t);
    this.master.gain.linearRampToValueAtTime(0, t + 0.25);
    setTimeout(() => this.halt(), 300);
    this.playing = false;
  }
}
