/** Sala de Cinema UI copy (pt-BR). */
import type { CinemaEndReason, CinemaErrorReason } from '@alga/shared'

const pad = (n: number) => String(n).padStart(2, '0')
/** 1:02:13 / 4:05 (film time, floored to the second). */
export function clock(s: number): string {
  const t = Math.max(0, Math.floor(s))
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  return h ? `${h}:${pad(m)}:${pad(t % 60)}` : `${m}:${pad(t % 60)}`
}
/** 2h46 / 10 min. */
export function length(s: number): string {
  const m = Math.round(s / 60)
  return m >= 60 ? `${Math.floor(m / 60)}h${pad(m % 60)}` : `${Math.max(1, m)} min`
}

export const t = {
  button: 'Cinema',
  buttonHint: 'Projetar um vídeo do seu PC para a chamada',
  sitHere: 'Sentar na sessão',
  standUp: 'Sair da sessão',
  card: (name: string) => `${name} abriu uma sessão:`,
  sit: 'Sentar',
  projecting: (name: string) => `${name} está projetando`,
  someone: 'Alguém',
  dropHint: 'Solte para projetar este vídeo para a chamada',
  sheet: {
    title: 'Projetar para a chamada',
    name: 'Título',
    tracks: 'Faixas',
    audio: 'Áudio',
    subtitles: 'Legendas',
    none: 'Nenhuma',
    open: 'Abrir sessão',
    cancel: 'Cancelar',
    noDecode: 'Este PC não decodifica o vídeo deste arquivo.',
    seatsCheck: 'Quem da chamada não conseguir decodificar aparece como "sem suporte" ao sentar.',
  },
  warnings: {
    dv_profile5: 'Este arquivo é Dolby Vision perfil 5. Procure uma versão HDR10 ou SDR.',
    high_bitrate: 'Bitrate alto: pode faltar upload para todo mundo assistir junto.',
    pgs_ignored: 'Legenda em imagem: ainda não suportada.',
    audio_converted: 'Parte do áudio é convertida para tocar no app.',
    atmos_dropped: 'O Atmos vira 5.1/7.1 comum.',
    tracks_truncated: 'O arquivo tem faixas demais: só as primeiras aparecem.',
  } as Record<string, string>,
  probeErrors: {
    no_video: 'Este arquivo não tem vídeo.',
    unsupported_video: 'Este formato de vídeo ainda não é suportado (só H.264, HEVC, AV1 e VP9).',
    no_duration: 'Não deu para saber a duração deste arquivo.',
    unreadable: 'Não deu para ler este arquivo.',
  } as Record<string, string>,
  ffmpegBlocked: 'O antivírus bloqueou o componente de vídeo do Alga. Libere o ffmpeg.exe da pasta do Alga no antivírus e tente de novo.',
  ffmpegMissing: 'O componente de vídeo do Alga não foi encontrado. Reinstale o Alga para projetar.',
  ffmpegCrashed: 'O componente de vídeo do Alga não abriu. Reinicie o Alga e tente de novo.',
  errors: {
    disabled: 'Cinema desligado neste servidor',
    not_in_call: 'Entre na chamada para usar o cinema.',
    forbidden: 'Você não tem permissão para isso nesta sessão.',
    exists: 'Já tem uma sessão aberta nesta chamada.',
    full: 'A sessão está cheia.',
    not_found: 'Esta sessão já acabou.',
    locked: 'Só quem projeta controla esta sessão.',
    not_seated: 'Sente na sessão primeiro.',
    invalid: 'O cinema recusou este pedido.',
    stale: '',
  } satisfies Record<CinemaErrorReason, string>,
  engineFailed: 'Não deu para abrir a sessão neste PC. Saia e sente de novo.',
  close: 'Fechar',
  /** Tech chip: the video is the file's own (never re-encoded). */
  native: 'Nativo',
  seatsOf: (ready: number, all: number) => `${ready} de ${all}`,
  relay: ' · relay',
  factoryError: 'O Alga parou de preparar uma parte do vídeo. Tentando de novo ao pular.',
  playerFailed: 'Seu PC não conseguiu tocar este vídeo.',
  unsupported: { video_codec: 'Seu PC não decodifica o vídeo deste filme.', audio_codec: 'Seu PC não decodifica esta faixa de áudio.' } as Record<string, string>,
  ipNotice: 'Na sala de cinema seu PC conecta direto com quem está assistindo.',
  e2eeFailed: 'Não foi possível proteger a conexão desta sessão',
  ended: { host_ended: 'Sessão encerrada', host_left: 'Quem projetava saiu', moderator: 'Um moderador encerrou a sessão', call_empty: 'A chamada acabou', channel_gone: 'O canal não existe mais' } satisfies Record<CinemaEndReason, string>,
  endedSummary: (watched: string, reactions: number) => `${watched} assistidos juntos · ${reactions} ${reactions === 1 ? 'reação' : 'reações'}`,
  stage: {
    play: 'Tocar',
    pause: 'Pausar',
    start: 'Começar',
    back10: 'Voltar 10 s',
    fwd10: 'Avançar 10 s',
    fullscreen: 'Tela cheia',
    exitFullscreen: 'Sair da tela cheia',
    stats: 'Estatísticas',
    end: 'Encerrar sessão',
    foyerHost: 'Todos sentados? Começa quando quiser.',
    foyerGuest: (name: string) => `Esperando ${name} começar`,
    waitingFor: (names: string) => `Esperando ${names}`,
    continueWithout: (name: string) => `Continuar sem ${name}`,
    paused: (name: string) => `${name} pausou`,
    buffering: 'Carregando para todos…',
    hostAway: 'Quem projeta saiu. Esperando voltar…',
    countdown: 'Começando…',
    timeline: 'Linha do tempo',
    noAudio: 'Sem áudio',
    seats: 'Poltronas',
    inSync: 'Em sincronia',
    status: { preparing: 'preparando', ready: 'pronto', stalled: 'travou', unsupported: 'sem suporte' } as Record<string, string>,
  },
  stats: {
    video: 'Vídeo',
    position: 'Posição',
    room: 'sala',
    mine: 'meu vídeo',
    drift: 'Sincronia',
    dropped: 'quadros perdidos',
    buffer: 'Buffer à frente',
    clock: 'Relógio',
    pieces: 'Peças',
    fromHost: 'de quem projeta',
    fromPeers: 'de amigos',
    peers: 'pares',
    relay: 'Relay',
    none: 'nenhum',
    cache: 'Cache',
    audio: 'Faixa de áudio',
    seats: 'Poltronas',
  },
  audio: {
    echoNotice: 'Use fone para os outros não ouvirem o filme pelo seu microfone',
    filmVolume: 'Volume do filme',
    mute: 'Mudo (só para você)',
    ducking: 'Baixar o filme quando alguém falar',
    track: 'Faixa de áudio',
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
  trackName: (lang: string | null, title: string | null, i: number) => [title, lang?.toUpperCase()].filter(Boolean).join(' · ') || `Faixa ${i + 1}`,
}
