export const t = {
  placeholder: (target: string) => `Mensagem para ${target}`,
  noPermission: 'Você não tem permissão para enviar mensagens neste canal.',
  offline: 'Sem conexão. Sua mensagem sai quando voltar.',
  emoji: { title: 'Emojis', open: 'Emoji', search: 'Buscar emoji', none: 'Nenhum emoji com esse nome.', react: 'Adicionar reação' },
  mentions: { title: 'Mencionar' },
  send: 'Enviar',
  sendHint: 'Enter',
  tooLong: (n: number) => `Mensagem ${n} caracteres acima do limite`,
  replyingTo: 'Respondendo a',
  cancelReply: 'Cancelar resposta',
  edited: '(editado)',
  editedAt: (d: string) => `Editado em ${d}`,
  editHint: { esc: 'Esc', cancel: 'para cancelar', enter: 'Enter', save: 'para salvar' },
  sending: 'Enviando…',
  failed: 'Não enviada.',
  retry: 'Tentar de novo',
  discard: 'Descartar',
  unread: 'Novas',
  jumpNew: (n: number) => `${n} ${n === 1 ? 'nova mensagem' : 'novas mensagens'}`,
  jumpLatest: 'Ir para as mais recentes',
  loadError: 'Não foi possível carregar as mensagens.',
  loadingOlder: 'Carregando mensagens anteriores…',
  replyMissing: 'Mensagem original indisponível',
  unknownUser: 'usuário desconhecido',
  actions: {
    react: (e: string) => `Reagir com ${e}`,
    reply: 'Responder',
    edit: 'Editar',
    delete: 'Excluir',
    copy: 'Copiar texto',
    copyGroup: 'Copiar',
    yours: 'Sua mensagem',
    more: 'Mais ações',
  },
  reactionLabel: (emoji: string, n: number, me: boolean) => `${emoji}: ${n} ${n === 1 ? 'reação' : 'reações'}${me ? ', incluindo a sua' : ''}`,
  deleteTitle: 'Excluir mensagem?',
  deleteBody: 'Ela será apagada para todos. Isso não pode ser desfeito.',
  deleteConfirm: 'Excluir',
  deleteTip: 'Dica: segure Shift ao clicar em excluir para pular esta confirmação.',
  cancel: 'Cancelar',
  error: 'Algo deu errado. Tente de novo.',
  typing: (names: string[]) =>
    names.length === 1 ? `${names[0]} está digitando`
    : names.length === 2 ? `${names[0]} e ${names[1]} estão digitando`
    : names.length === 3 ? `${names[0]}, ${names[1]} e ${names[2]} estão digitando`
    : 'Várias pessoas estão digitando',
  intro: {
    channelTitle: (n: string) => `#${n}`,
    channelBody: (n: string) => `Tudo o que for dito em #${n} começa aqui.`,
    dmBody: (n: string) => `Aqui começa sua conversa com ${n}. Que tal uma chamada?`,
    call: 'Ligar',
  },
  header: {
    members: 'Lista de membros',
  },
} as const

/** Quick reactions in the hover toolbar. */
export const QUICK_EMOJI = ['👍', '❤️', '😂'] as const
