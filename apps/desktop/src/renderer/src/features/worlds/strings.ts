import type { WorldErrorReason, WorldGesture, WorldItemCategory, WorldRoomAccess } from '@alga/shared'

export const t = {
  name: 'Mundo',
  button: 'Mundo',
  buttonHint: 'Ver a chamada em 3D',
  action: 'Abrir o mundo desta chamada',
  actionKeywords: '3d sala mundo worlds avatar lounge manequim',
  lounge: 'Lounge',
  myRoom: 'Minha sala',
  roomOf: (name: string) => `Sala de ${name}`,

  open: {
    title: 'Onde a chamada vai ficar?',
    body: 'A voz continua a mesma. Só muda o lugar: cada pessoa entra quando quiser.',
    lounge: 'Lounge',
    loungeHint: 'Do grupo',
    mine: 'Minha sala',
    mineHint: 'Do seu jeito',
    go: 'Abrir',
  },

  card: {
    badge: 'Mundo aberto',
    inside: (n: number) => (n === 0 ? 'Ninguém lá dentro ainda' : n === 1 ? '1 pessoa lá dentro' : `${n} pessoas lá dentro`),
    enter: 'Entrar',
    entering: 'Entrando…',
    back: 'Voltar para o mundo',
    openedBy: (name: string) => `${name} abriu`,
  },

  loading: {
    pack: 'Baixando o cenário',
    room: 'Montando a sala',
    people: 'Chamando o pessoal',
    first: 'Só na primeira vez. Depois abre na hora.',
  },

  hud: {
    leave: 'Sair do mundo',
    backToCall: 'Ver a chamada (continuo na sala)',
    leaveHint: 'Volta para a chamada normal. A voz não cai.',
    sit: 'Sentar',
    stand: 'Levantar',
    sitHint: 'E para sentar',
    standHint: 'E para levantar',
    gestures: 'Gestos',
    reactions: 'Reações',
    watch: 'Assistir à tela',
    stopWatching: 'Parar de assistir',
    screen: 'Tela da sala',
    screenAuto: 'Automático',
    screenNobody: 'Ninguém está transmitindo',
    screenOf: (name: string) => `Tela de ${name}`,
    place: 'Trocar de lugar',
    edit: 'Editar minha sala',
    avatar: 'Meu manequim',
    store: 'Loja',
    quality: 'Qualidade do 3D',
    controls: 'W A S D para andar · Shift corre · clique no chão para ir até lá · arraste para olhar',
    toolbar: 'Controles do mundo',
  },

  quality: {
    auto: 'Automática',
    low: 'Leve',
    medium: 'Equilibrada',
    high: 'Alta',
    hint: 'Automática mede o seu PC e se ajusta sozinha, inclusive com um jogo aberto.',
  },

  gestures: {
    wave: 'Acenar', yes: 'Sim', no: 'Não', dance: 'Dançar', fold: 'Cruzar os braços', phone: 'No telefone', drink: 'Brindar', point: 'Apontar',
  } satisfies Record<WorldGesture, string>,

  access: {
    call: 'Todo mundo da chamada',
    friends: 'Só meus amigos',
    locked: 'Só eu',
  } satisfies Record<WorldRoomAccess, string>,
  accessHint: {
    call: 'Quem estiver na chamada pode entrar.',
    friends: 'Só entra quem é seu amigo no Alga.',
    locked: 'Ninguém mais entra, mesmo com a sala aberta.',
  } satisfies Record<WorldRoomAccess, string>,

  categories: {
    seating: 'Assentos', tables: 'Mesas', storage: 'Estantes', lighting: 'Luz', plants: 'Plantas', decor: 'Decoração', rugs: 'Tapetes', media: 'Telas', beds: 'Camas',
  } satisfies Record<WorldItemCategory, string>,

  studio: {
    title: 'Ateliê',
    open: 'Abrir o Ateliê',
    openKeywords: 'atelie ateliê sala quarto manequim avatar móveis decorar loja mundo 3d',
    close: 'Fechar',
    tabs: { room: 'Minha sala', avatar: 'Manequim', store: 'Loja' },
    loading: 'Abrindo a sua sala',
    loadFailed: 'Não deu para abrir a sua sala.',
    save: 'Salvar sala',
    saved: 'Sala salva.',
    saveAvatar: 'Salvar manequim',
    savedAvatar: 'Manequim salvo.',
    saving: 'Salvando…',
    unsaved: 'Você tem mudanças que ainda não foram salvas.',
    discard: 'Sair sem salvar',
    keep: 'Continuar editando',
    saveFailed: 'Não deu para salvar. Tente de novo.',
    notHeld: (name: string) => `“${name}” ainda não é seu. Tire da sala ou compre para salvar.`,
    name: 'Nome da sala',
    access: 'Quem pode entrar',
    finishes: 'Acabamentos',
    floor: 'Piso',
    walls: 'Paredes',
    accent: 'Parede da tela',
    accentSame: 'Igual às outras',
    mood: 'Luz',
    pieces: 'Peças',
    count: (n: number, max: number) => `${n} de ${max} peças na sala`,
    add: 'Colocar na sala',
    full: 'A sala está cheia: tire uma peça para colocar outra.',
    copies: 'Você já colocou o máximo desta peça.',
    selected: { rotateLeft: 'Girar para a esquerda', rotateRight: 'Girar para a direita', remove: 'Tirar da sala', colour: 'Cor' },
    editHint: 'Clique numa peça e arraste. Q e E giram, Delete tira da sala.',
    body: 'Silhueta',
    bodies: { a: 'Larga', b: 'Esguia' },
    finish: 'Acabamento',
    joints: 'Cor das juntas',
    outfit: 'Roupa',
    fabrics: { top: 'Parte de cima', bottom: 'Parte de baixo', shoes: 'Calçado' },
    head: 'Cabeça',
    automatic: 'Voltar ao automático',
    automaticHint: 'O manequim volta a nascer do seu Eco.',
    trying: (name: string) => `Provando “${name}”.`,
    buy: (price: string) => `Comprar por ${price}`,
    owned: 'Seu',
    plus: 'Incluso no Plus',
    seePlus: 'Ver o Plus',
    soon: 'Em breve',
    storeIntro: 'Peças de assinatura para a sala e o manequim. Tudo o que você precisa para conversar, sentar e assistir é seu de graça, para sempre.',
    forRoom: 'Para a sala',
    forAvatar: 'Para o manequim',
    highlights: 'Destaques',
    kind: { item: 'Peça', floor: 'Piso', wall: 'Parede', mood: 'Luz', avatar_finish: 'Acabamento', avatar_outfit: 'Roupa', avatar_head: 'Cabeça' },
    walkHint: 'W A S D para andar pela sala',
  },

  failed: {
    title: 'O mundo não abriu',
    body: 'A chamada continua normal. Você pode tentar de novo quando quiser.',
    contextLost: 'A placa de vídeo interrompeu o 3D. A chamada continua normal.',
    offline: 'Não deu para baixar o cenário. Confira a conexão e tente de novo.',
    retry: 'Tentar de novo',
    close: 'Voltar para a chamada',
  },
} as const

/** One sentence for a refused world action. */
export function errorText(reason: WorldErrorReason): string {
  switch (reason) {
    case 'disabled': return 'O mundo não está disponível neste servidor.'
    case 'not_in_call': return 'Entre na chamada para abrir o mundo.'
    case 'no_session': return 'O mundo desta chamada foi fechado.'
    case 'forbidden': return 'Você não pode entrar nesta sala.'
    case 'locked': return 'Esta sala está trancada: só quem é dono entra.'
    case 'friends_only': return 'Só os amigos de quem é dono entram nesta sala.'
    case 'full': return 'A sala está cheia.'
    case 'not_inside': return 'Entre no mundo primeiro.'
    case 'seat_taken': return 'Alguém sentou ali primeiro.'
    case 'not_found': return 'Isso não está mais na sala.'
    case 'slow_down': return 'Calma: espere um instante.'
    case 'invalid': return 'Não deu para fazer isso.'
  }
}
