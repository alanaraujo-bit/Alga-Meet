import type { OrderStatus, SubscriptionStatus } from '@alga/shared'
import type { Slot } from './look'

export const t = {
  loadError: 'Não foi possível carregar seu plano.',
  retry: 'Tentar de novo',
  sandbox: 'Sandbox',
  sandboxBody: 'Servidor de teste: a página de pagamento é simulada e nada é cobrado.',
  disabled: 'Pagamentos estão desligados neste servidor. Seu plano e seus itens continuam valendo.',
  test: 'Teste',

  plan: {
    current: 'Seu plano',
    free: 'Grátis',
    freeLine: 'Sem prazo e sem cartão. Voz igual para todos, comunidades sem limite e transmissão até 1080p30.',
    plusLine: (interval: 'month' | 'year' | undefined, date: string, price: string) =>
      `${interval === 'year' ? 'Anual' : 'Mensal'} · renova em ${date} · ${price}`,
    canceledLine: (date: string, price: string) => `Renovação cancelada. O Plus vale até ${date}; depois você volta ao Grátis, sem perder nada que comprou. Se retomar, ele renova em ${date} por ${price}.`,
    resume: 'Retomar renovação',
    pastDueLine: 'Não conseguimos renovar. O Plus continua por alguns dias enquanto o pagamento é tentado de novo.',
    cancel: 'Cancelar renovação',
    arrived: 'Pagamento confirmado. Obrigado por apoiar o Alga Meet.',
  },

  compare: {
    title: 'Grátis e Alga Plus',
    body: 'O Grátis é completo e continua assim. O Plus paga o que custa caro de verdade (transmissão em alta e arquivos grandes) e ajuda a manter o resto grátis para todo mundo.',
    voice: 'Voz',
    voiceBoth: 'Igual para todos',
    stream: 'Transmissão de tela',
    files: 'Anexos',
    filesUpTo: (mb: number) => `até ${mb} MB por arquivo`,
    social: 'Espaços, cargos e DMs',
    socialBoth: 'Sem limite',
    collection: 'Coleção Plus',
    collectionNone: '—',
    collectionWhile: 'enquanto assinar',
    plus: 'Alga Plus',
  },

  subscribe: {
    monthly: 'Mensal',
    yearly: 'Anual',
    perMonth: '/mês',
    perYear: '/ano',
    yearlyNote: (monthly: string) => `Equivale a ${monthly} por mês: dois meses de graça.`,
    monthlyNote: 'Cobrado todo mês, pelo mesmo preço.',
    cta: 'Assinar o Alga Plus',
    fine: 'Renova sozinho pelo mesmo preço até você cancelar. Cancele aqui quando quiser: o Plus vale até o fim do período pago. Você pode pedir reembolso em até 7 dias.',
    where: 'O pagamento abre no seu navegador.',
    whereSandbox: 'A página de pagamento de teste abre no seu navegador.',
  },

  waiting: {
    title: 'Aguardando a confirmação do pagamento…',
    body: 'Abrimos a página de pagamento no seu navegador. Assim que o provedor confirmar, isto muda sozinho. Nada é liberado antes disso.',
    reopen: 'Abrir a página de novo',
    stop: 'Não vou pagar agora',
    declined: 'O pagamento não foi concluído. Nada foi cobrado.',
  },

  cancel: {
    title: 'Cancelar a renovação do Plus?',
    body: (date: string, mb: number) => `Nada muda até ${date}: você continua com o Plus. Depois, sua conta volta ao Grátis (transmissão até 1080p30, anexos até ${mb} MB). O que você comprou na loja continua na sua conta.`,
    keep: 'Manter o Plus',
    confirm: 'Cancelar renovação',
    done: (date: string) => `Renovação cancelada. O Plus vale até ${date}.`,
  },

  history: {
    title: 'Histórico de compras',
    empty: 'Nenhuma compra ainda.',
    subscription: {
      pending: 'Aguardando pagamento',
      active: 'Ativa',
      past_due: 'Renovação pendente',
      canceled: 'Encerrada antes do prazo',
      expired: 'Encerrada',
    } satisfies Record<SubscriptionStatus, string>,
    order: {
      pending: 'Aguardando pagamento',
      paid: 'Pago',
      refunded: 'Reembolsado',
      canceled: 'Pagamento não concluído',
      expired: 'Pagamento não concluído',
    } satisfies Record<OrderStatus, string>,
    unknown: 'Item removido do catálogo',
  },

  shop: {
    intro: 'Itens para o seu perfil, com preço em reais. Comprou uma vez, fica na sua conta, sem renovação. Sem moeda virtual e sem caixa surpresa. Nenhum dá vantagem: é só aparência.',
    preview: 'Prévia no seu perfil',
    previewHint: 'Clique num item para ver como fica em você.',
    slots: { decoration: 'Decorações de avatar', theme: 'Temas de perfil', effect: 'Efeitos de perfil', nameplate: 'Placas de nome' } satisfies Record<Slot, string>,
    slot: { decoration: 'Decoração de avatar', theme: 'Tema de perfil', effect: 'Efeito de perfil', nameplate: 'Placa de nome' } satisfies Record<Slot, string>,
    buy: (price: string) => `Comprar por ${price}`,
    buyFine: 'Pagamento único, sem renovação: fica na sua conta. Você pode pedir reembolso em até 7 dias. O pagamento abre no navegador.',
    inUse: 'Em uso',
    inUseLine: 'Em uso: quem vê seu perfil vê este item.',
    owned: 'Na sua conta',
    ownedLine: 'Está na sua conta. Use quando quiser e troque quantas vezes quiser.',
    included: 'Alga Plus',
    includedLine: 'Vem com o seu Alga Plus. Fica no seu perfil enquanto você assina.',
    replaces: (name: string) => `Usar troca ${name} no seu perfil.`,
    equip: 'Usar no perfil',
    unequip: 'Tirar do perfil',
    plusOnly: 'Coleção Plus',
    plusOnlyLine: 'Vem com o Alga Plus enquanto você assina. Não é vendido separado.',
    seePlus: 'Conhecer o Alga Plus',
    unavailable: 'Indisponível',
    arrived: 'Pronto: está na sua conta. Use no perfil quando quiser.',
    others: 'O que está em uso aparece para quem vê seu perfil: no cartão de perfil, na lista de membros e, discreto, na chamada.',
  },

  arrived: {
    planToast: 'Alga Plus ativo. Obrigado por apoiar o Alga Meet.',
    itemToast: (name: string) => `${name} está na sua conta. Use em Personalização.`,
    see: 'Ver',
  },

  voice: {
    title: 'Qualidade da transmissão',
    body: 'O que o seu plano permite transmitir. O seletor de tela também só oferece o que este computador sustenta.',
    allowed: 'No seu plano',
    locked: 'Alga Plus',
    hintFree: '1080p60, 1440p60 e 4K vêm com o Alga Plus. O resto, incluindo 1080p30, é grátis.',
    hintPlus: 'Seu Alga Plus libera todas as qualidades.',
    seePlan: 'Ver planos',
  },
} as const
