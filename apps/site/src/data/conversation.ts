// A conversa da sala de voz (momento 2). Uma fonte só para as ondas no chão (WebGL), as legendas e o som
// sintetizado: cada fala vira sílabas com início, duração e intensidade, sorteadas com semente fixa.
export const people = [
  { name: 'Carlinha', initials: '', grad: ['#f7c46c', '#e86885'], pitch: 245 },
  { name: 'Bruno', initials: '', grad: ['#7cc0f5', '#2f5ea8'], pitch: 128 },
  { name: 'Diego', initials: 'DA', grad: ['#3a2f2c', '#55443f'], pitch: 112 },
  { name: 'Ana', initials: 'AR', grad: ['#2f2c3f', '#4a4466'], pitch: 210 },
  { name: 'Elisa', initials: 'EN', grad: ['#8b8ef7', '#4b4fc0'], pitch: 230 },
] as const;

// [quem, começa em s, texto]. Risada = várias pessoas ao mesmo tempo (as ondas se cruzam).
export const lines: { who: number[]; at: number; text: string; laugh?: boolean }[] = [
  { who: [0], at: 0.4, text: 'Gente, entrei. Tão me ouvindo?' },
  { who: [1], at: 2.3, text: 'Alto e claro. Parece que você tá aqui do lado.' },
  { who: [2], at: 4.6, text: 'Bora uma ranked antes da janta?' },
  { who: [3], at: 6.3, text: 'Só se o Diego não for de suporte de novo.' },
  { who: [2], at: 8.4, text: 'Ei! Foi UMA vez.' },
  { who: [0, 1, 3, 4], at: 9.5, text: 'kkkkkkkkk', laugh: true },
  { who: [4], at: 11.6, text: 'Tô entrando. Me espera!' },
];
export const T = 13.6;

export type Syl = { who: number; at: number; dur: number; amp: number; vowel: number; bend: number };

let seed = 20261101;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

export const syllables: Syl[] = [];
for (const l of lines) {
  for (const who of l.who) {
    let t = l.at + (l.laugh ? rnd() * 0.25 : 0);
    if (l.laugh) {
      const n = 6 + Math.floor(rnd() * 4);
      for (let i = 0; i < n; i++) {
        const dur = 0.09 + rnd() * 0.05;
        syllables.push({ who, at: t, dur, amp: 0.95 - i * 0.06, vowel: 0, bend: 1.15 - i * 0.03 });
        t += dur + 0.05 + rnd() * 0.04;
      }
      continue;
    }
    for (const word of l.text.split(' ')) {
      const n = Math.max(1, Math.round(word.replace(/[^\p{L}]/gu, '').length / 2.6));
      for (let i = 0; i < n; i++) {
        const dur = 0.085 + rnd() * 0.09;
        const stress = word === word.toUpperCase() && word.length > 1 ? 1 : 0.55 + rnd() * 0.4;
        syllables.push({ who, at: t, dur, amp: stress, vowel: Math.floor(rnd() * 5), bend: 0.92 + rnd() * 0.16 + (/[?]/.test(word) && i === n - 1 ? 0.2 : 0) });
        t += dur + 0.025 + rnd() * 0.04;
      }
      t += 0.07 + rnd() * 0.08;
    }
  }
}

/** Envelope de fala por pessoa, amostrado em `n` pontos de 0 a T (ataque 25 ms, soltura 120 ms). */
export function envelopes(n: number): Float32Array[] {
  const out = people.map(() => new Float32Array(n));
  for (const s of syllables) {
    const a = out[s.who];
    const i0 = Math.max(0, Math.floor(((s.at - 0.03) / T) * n));
    const i1 = Math.min(n - 1, Math.ceil(((s.at + s.dur + 0.2) / T) * n));
    for (let i = i0; i <= i1; i++) {
      const t = (i / n) * T - s.at;
      const v = t < 0 ? 0 : t < 0.025 ? t / 0.025 : t < s.dur ? 1 - 0.25 * ((t - 0.025) / s.dur) : 0.75 * Math.exp(-(t - s.dur) / 0.06);
      a[i] = Math.max(a[i], v * s.amp);
    }
  }
  return out;
}

/** Fala ativa em t (para a legenda). */
export const lineAt = (t: number) => {
  let cur = -1;
  lines.forEach((l, i) => { if (t >= l.at - 0.15) cur = i; });
  return cur;
};
