import type { VoiceDisconnectReason } from '@alga/shared'

const num1 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const pct = (n: number) => `${num1.format(n)} %`
/** Under 5 ms is a local network, not a broken measure. */
const ping = (ms: number) => (ms < 5 ? '< 5 ms' : `${Math.round(ms)} ms`)

export const t = {
  joinError: 'Não foi possível entrar no canal de voz.',
  join: (name: string) => `Entrar em ${name}`,
  joinShort: 'Entrar',
  joining: 'Conectando…',
  rejoin: 'Entrar de novo',
  moved: (name: string) => `Você foi movido para ${name}.`,
  leave: 'Desconectar',
  switchTo: (name: string) => `Trocar para ${name}`,

  state: {
    connecting: 'Conectando à voz…',
    connected: 'Voz conectada',
    reconnecting: 'Reconectando à voz…',
    disconnected: 'Voz desconectada',
  },
  /** Stage overlay while the media connection is down: never pretend people are fine. */
  reconnectingBody: 'Você não está ouvindo ninguém agora. A conversa volta sozinha assim que a conexão voltar.',
  reconnectingShort: 'Você não está ouvindo ninguém agora.',
  disconnectedBody: 'A conexão com a voz caiu e não voltou sozinha.',

  removed: {
    channel_full: 'O canal de voz está cheio.',
    moderator: 'Um moderador desconectou você do canal de voz.',
    access_lost: 'Você não tem mais acesso a este canal de voz.',
  } satisfies Record<VoiceDisconnectReason, string>,

  stage: {
    emptyTitle: 'Ninguém aqui ainda',
    emptyBody: 'Entre e chame alguém. Quem chegar já te ouve.',
    preview: (n: number) => (n === 1 ? '1 pessoa conversando agora' : `${n} pessoas conversando agora`),
    you: 'Você',
    muted: 'Microfone desativado',
    deafened: 'Áudio desativado',
    noMic: 'Sem microfone',
    quality: { excellent: 'Conexão ótima', good: 'Conexão boa', poor: 'Conexão instável', lost: 'Sem sinal', unknown: 'Conexão desconhecida' },
    live: 'AO VIVO',
    watch: 'Assistir',
    watching: 'Assistindo',
    stopWatching: 'Parar de assistir',
    streamOf: (name: string) => `Transmissão de ${name}`,
    youAreLive: 'Você está transmitindo',
    yourStreamBody: 'Quem quiser assistir clica em Assistir. Nada é enviado para quem não está assistindo.',
    people: 'Pessoas na chamada',
    show: 'Mostrar no palco',
    fullscreen: 'Tela cheia',
    exitFullscreen: 'Sair da tela cheia',
    pip: 'Janela flutuante',
    volume: 'Volume da transmissão',
    qualityAuto: 'Automática',
    qualitySource: 'Original',
    qualityLabel: 'Qualidade da transmissão',
    qualityHint: { auto: 'Ajusta ao tamanho da janela e à sua rede.', source: 'Sempre a resolução máxima de quem transmite.' },
    stats: 'Estatísticas',
    statsShortcut: 'Ctrl Shift E',
    loadingStream: 'Carregando a transmissão…',
    hw: 'por hardware',
    sw: 'por software',
    personVolume: (name: string) => `Volume de ${name}`,
    muteFor: 'Silenciar para mim',
    unmuteFor: 'Voltar a ouvir',
    serverMuted: 'Silenciado pela moderação',
    serverDeafened: 'Áudio desativado pela moderação',
  },

  dock: {
    mute: 'Desativar microfone',
    unmute: 'Ativar microfone',
    deafen: 'Desativar áudio',
    undeafen: 'Ativar áudio',
    share: 'Compartilhar tela',
    stopShare: 'Parar transmissão',
    switchSource: 'Trocar o que está sendo compartilhado',
    settings: 'Configurações de voz',
    leave: 'Desconectar',
    noMic: 'Nenhum microfone encontrado',
    serverMuted: 'A moderação silenciou você neste canal',
    serverDeafened: 'A moderação desativou seu áudio neste canal',
    pttHint: 'Push-to-talk: segure o atalho para falar',
  },

  mod: {
    group: 'Moderação',
    mute: 'Silenciar para todos',
    unmute: 'Permitir que fale',
    deafen: 'Desativar o áudio para todos',
    undeafen: 'Devolver o áudio',
    moveTo: 'Mover para',
    disconnect: 'Desconectar da voz',
    you: 'Para você',
    failed: 'Não foi possível concluir a ação de moderação.',
  },

  panel: {
    ping,
    link: (ms: number | null, lossPct: number | null) =>
      [ms === null ? null : ping(ms), lossPct === null ? null : `perda ${pct(lossPct)}`].filter(Boolean).join(' · ') || 'Medindo a conexão…',
    quality: { 3: 'Conexão ótima', 2: 'Conexão boa', 1: 'Conexão instável', 0: 'Sem sinal' } as Record<number, string>,
    live: 'Você está transmitindo',
    liveShort: 'Transmitindo',
    open: 'Abrir a chamada',
  },

  live: {
    title: 'Agora',
    empty: 'Quando seus amigos entrarem em uma sala de voz, eles aparecem aqui.',
    here: 'Você está aqui',
    call: 'Chamada',
    join: (name: string) => `Entrar em ${name}`,
    more: (n: number) => `+${n}`,
    streaming: 'ao vivo',
  },

  here: {
    count: (n: number, room: string) => `${n} em ${room}`,
    open: 'Abrir',
  },

  ring: {
    title: (name: string) => `${name} está te ligando`,
    group: (name: string) => `Chamada em ${name}`,
    body: 'Está te ligando',
    groupBody: 'Chamada em grupo começando',
    accept: 'Atender',
    decline: 'Recusar',
    notifyTitle: 'Chamada no Alga Meet',
    notifyBody: (name: string) => `${name} está te ligando.`,
  },

  call: {
    start: 'Iniciar chamada de voz',
    join: 'Entrar na chamada',
    inCall: 'Em chamada',
    ongoing: (n: number) => (n === 1 ? '1 pessoa na chamada' : `${n} pessoas na chamada`),
    waiting: (name: string) => `Chamando ${name}…`,
  },

  /** Screen-reader announcements (VoiceAnnouncer): who came and went in the call you are in. */
  announce: {
    connected: (where: string) => `Você entrou na chamada em ${where}`,
    disconnected: 'Você saiu da chamada',
    joined: (name: string) => `${name} entrou na chamada`,
    left: (name: string) => `${name} saiu da chamada`,
  },

  picker: {
    title: 'Compartilhar tela',
    description: 'Só o que você escolher aqui é transmitido, e só para quem clicar em Assistir. Você pode parar a qualquer momento.',
    screens: 'Telas',
    windows: 'Janelas',
    none: { screens: 'Nenhuma tela encontrada.', windows: 'Nenhuma janela aberta para compartilhar.' },
    loading: 'Procurando telas e janelas…',
    unavailable: 'A captura de tela não está disponível nesta versão.',
    preview: 'Prévia',
    quality: 'Qualidade',
    resolution: 'Resolução',
    fps: 'Quadros por segundo',
    qualityHint: 'Só aparecem as opções que este computador sustenta.',
    qualityLiveHint: 'Muda na hora, sem interromper quem assiste.',
    plus: 'Alga Plus',
    lockedHint: (labels: string[]) => `${new Intl.ListFormat('pt-BR').format(labels)} ${labels.length > 1 ? 'vêm' : 'vem'} com o Alga Plus.`,
    seePlus: 'Ver o Alga Plus',
    apply: 'Aplicar',
    content: 'O que você vai mostrar',
    motion: 'Jogo ou vídeo',
    motionHint: 'Movimento suave: prioriza quadros por segundo.',
    detail: 'Texto ou código',
    detailHint: 'Letras nítidas: prioriza a definição.',
    audio: 'Compartilhar áudio',
    audioHint: 'Quem assiste ouve o som do computador. A chamada não entra na transmissão.',
    audioWindowHint: 'O áudio do sistema inteiro vai junto, não só o desta janela.',
    start: 'Transmitir',
    switch: 'Trocar fonte',
    cancel: 'Cancelar',
    failed: 'Não foi possível começar a transmissão.',
  },

  mini: {
    label: (name: string) => `Transmissão de ${name} em miniatura`,
    back: 'Voltar para a chamada',
    close: 'Parar de assistir',
  },

  stats: {
    title: 'Estatísticas da transmissão',
    resolution: 'Resolução',
    fps: 'Quadros/s',
    bitrate: 'Taxa',
    decoder: 'Decodificador',
    codec: 'Codec',
    loss: 'Perda',
    freezes: 'Congelamentos',
    kbps: (n: number) => (n >= 1000 ? `${num1.format(n / 1000)} Mb/s` : `${Math.round(n)} kb/s`),
    pct,
  },
} as const
