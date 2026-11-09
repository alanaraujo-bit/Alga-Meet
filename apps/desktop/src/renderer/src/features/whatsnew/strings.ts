import type { ReleaseCategory } from '@alga/shared'

/** Novidades copy: a product team talking to its community. Short, warm, about what changes for you. */
export const t = {
  rail: 'Novidades',
  railNew: 'Novidades, tem coisa nova',

  welcome: {
    eyebrow: 'O Alga Meet ficou ainda melhor',
    range: (from: string, to: string) => `Você pulou algumas versões. Aqui está o melhor da ${from} até a ${to}.`,
    version: (v: string) => `Versão ${v}`,
    versions: (n: number) => `${n} versões novas`,
    got: 'Entendi',
    later: 'Lembrar depois',
    details: 'Ver todos os detalhes',
    preview: 'Pré-visualização',
    close: 'Fechar',
    of: (i: number, n: number) => `${i} de ${n}`,
  },

  center: {
    title: 'Novidades',
    subtitle: 'Tudo o que mudou no Alga Meet, versão por versão.',
    close: 'Fechar as novidades',
    versions: 'Versões',
    installed: 'Você está aqui',
    fresh: 'Novo',
    all: 'Tudo',
    empty: ['Nada por aqui ainda', 'Quando sair uma versão nova, contamos aqui o que mudou.'] as const,
    offline: ['Sem conexão', 'Não deu para buscar as novidades agora. A gente tenta de novo sozinho.'] as const,
    loading: 'Carregando as novidades',
    nothingIn: 'Nada nesta categoria nesta versão.',
    manage: 'Escrever novidades',
    published: (date: string) => `Publicada em ${date}`,
  },

  category: { new: 'Novidades', improved: 'Melhorias', fixed: 'Correções' } satisfies Record<ReleaseCategory, string>,
  categoryOne: { new: 'Novo', improved: 'Melhoria', fixed: 'Correção' } satisfies Record<ReleaseCategory, string>,

  react: {
    ask: 'O que achou?',
    up: 'Gostei',
    down: 'Não gostei',
    upOn: 'Você gostou. Clique de novo para desfazer.',
    downOn: 'Você não gostou. Clique de novo para desfazer.',
    thanks: 'Valeu! A equipe vai ler.',
  },
  reactError: 'Não deu para registrar sua opinião. Tente de novo.',

  media: {
    unavailable: 'Mídia indisponível agora',
    play: 'Reproduzir animação',
    pause: 'Pausar',
  },

  update: {
    downloading: (p: number) => `Baixando atualização · ${p}%`,
    ready: 'Atualização pronta',
    readyVersion: (v: string) => `Versão ${v} pronta`,
    body: 'Ela já foi baixada. Reinicie quando for bom para você; se preferir, ela entra sozinha quando você fechar o app.',
    restart: 'Reiniciar agora',
    later: 'Depois',
    inCall: 'Termine a chamada para reiniciar. Ela também entra sozinha quando você fechar o app.',
    coming: 'O que vem nela',
    more: (n: number) => `e mais ${n}`,
  },
}
