/** Sala de Cinema UI copy (pt-BR). */
export const t = {
  audio: {
    echoNotice: 'Use fones de ouvido para os amigos não ouvirem o filme pelo seu microfone.',
    filmVolume: 'Volume do filme',
    ducking: 'Baixar o filme quando alguém falar',
  },
  subtitles: {
    off: 'Sem legenda',
    track: 'Legenda',
    size: 'Tamanho',
    sizes: { P: 'Pequena', M: 'Média', G: 'Grande' },
    offset: 'Atraso',
    offsetValue: (s: number) => `${s > 0 ? '+' : ''}${s.toFixed(1).replace('.', ',')} s`,
    loadFailed: 'Não deu para carregar esta legenda.',
  },
}
