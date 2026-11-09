import type { FeedbackContext, FeedbackKind } from '@alga/shared'

/** "Conta pro Eco": the copy of the feedback card (pt-BR, as the rest of the app). */
export const t = {
  title: 'Enviar feedback',
  close: 'Fechar',
  kinds: 'Sobre o que é',
  kind: {
    bug: { label: 'Bug', ask: 'Eita. O que deu errado?', placeholder: 'Ex.: o áudio some quando compartilho a tela' },
    crash: { label: 'Travou', ask: 'Travou? O que você fazia na hora?', placeholder: 'Ex.: abri o Cinema e o app congelou' },
    idea: { label: 'Ideia', ask: 'Boa! Qual é a ideia?', placeholder: 'Ex.: queria fixar mensagens no canal' },
    praise: { label: 'Elogio', ask: 'Opa. Do que você gostou?', placeholder: 'Ex.: a sala de cinema ficou linda' },
  } satisfies Record<FeedbackKind, { label: string; ask: string; placeholder: string }>,
  text: 'Seu feedback',
  left: (n: number) => `${n} caracteres restantes`,

  shot: {
    capture: 'Tirar print do app',
    hint: 'ou cole uma imagem',
    alt: 'Print que vai junto',
    remove: 'Tirar o print',
    check: 'Confira: o print mostra o que estava na tela.',
    bad: 'Use uma imagem PNG, JPEG ou WebP de até 8 MB.',
    failed: 'Não deu para capturar a janela. Cole um print (Win + Shift + S).',
    drop: 'Solte a imagem para ir junto',
  },

  goes: {
    title: 'Vai junto',
    see: 'ver',
    hide: 'ocultar',
    log: 'log recente do app',
    version: 'Versão do app',
    system: 'Sistema',
    where: 'Onde você estava',
    crash: 'A sessão anterior',
    crashed: { renderer: 'a interface caiu', unresponsive: 'a janela parou de responder' } satisfies Record<NonNullable<FeedbackContext['crash']>, string>,
    logRow: 'Log recente do app',
    logOn: 'Vai junto. Ajuda a achar a causa.',
    logOff: 'Não vai.',
    logEmpty: 'Sem registros recentes.',
    logLoading: 'Lendo o log…',
    noNames: 'O contexto não leva nomes de espaços, canais ou pessoas.',
  },
  view: { home: 'Início', dm: 'Conversa direta', space: 'Um espaço' } satisfies Record<FeedbackContext['view'], string>,
  inCall: 'em chamada',
  sharing: 'transmitindo a tela',
  cinema: 'no Cinema',

  send: 'Enviar',
  retry: 'Tentar de novo',
  mine: (n: number) => `Seus envios · ${n}`,

  sent: {
    title: (name: string) => (name ? `Recebido. Valeu, ${name}!` : 'Recebido. Valeu!'),
    body: 'A equipe lê tudo. Você acompanha por aqui.',
    again: 'Enviar outro',
  },
  received: 'Recebido',

  list: {
    title: 'Seus envios',
    back: 'Voltar',
    withShot: 'com print',
    empty: 'Nada por aqui ainda.',
    loading: 'Carregando seus envios…',
    failed: 'Não deu para carregar seus envios.',
  },

  offer: {
    text: 'Travei da última vez. Quer me contar o que aconteceu?',
    tell: 'Contar',
    later: 'Agora não',
  },

  entry: {
    action: 'Enviar feedback',
    keywords: 'bug erro travou travamento sugestão ideia problema reportar relatar melhoria elogio',
    row: 'Feedback',
    rowHint: 'Conte um bug, um travamento ou uma ideia para a equipe.',
  },
}

/** "Um espaço · em chamada · transmitindo a tela": where the person is, in words. */
export function whereText(c: FeedbackContext): string {
  return [t.view[c.view], c.inCall && t.inCall, c.sharing && t.sharing, c.cinema && t.cinema].filter(Boolean).join(' · ')
}
