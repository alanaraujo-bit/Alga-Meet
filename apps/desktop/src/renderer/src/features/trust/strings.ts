import { MIN_AGE, type AccountActionReason, type ReportReason } from '@alga/shared'

/**
 * Trust & Safety and privacy copy (docs/trust-safety/README.md, docs/legal). Calm and plain: say what happens, never
 * threaten. The rule names mirror REASON_LABELS on the server (what the e-mails say).
 */

/** The rule that was broken, as the decision e-mail names it. CSAM decisions arrive as 'other' from the server. */
export const RULE: Record<AccountActionReason, string> = {
  csam: 'conteúdo que sexualiza menores de 18 anos',
  violence: 'ameaça ou incitação à violência',
  non_consensual_intimate: 'imagem íntima sem consentimento',
  self_harm: 'incentivo à autolesão ou ao suicídio',
  harassment: 'assédio',
  hate: 'discurso de ódio',
  sexual_content: 'conteúdo sexual explícito',
  privacy: 'exposição de dados pessoais',
  scam: 'golpe ou fraude',
  malware: 'vírus ou tentativa de invasão',
  spam: 'spam',
  impersonation: 'fingir ser outra pessoa',
  illegal_goods: 'venda ou promoção de itens ilegais',
  piracy: 'pirataria',
  ban_evasion: 'fuga de moderação',
  other: 'violação dos Termos de Uso ou das Diretrizes da Comunidade',
  underage: `idade abaixo do mínimo de ${MIN_AGE} anos`,
}

/** "Assédio" at the start of a line, the rule as the e-mail names it elsewhere. */
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Report reasons in plain language: [label, one line that says what counts]. */
export const REASON: Record<ReportReason, [string, string]> = {
  csam: ['Sexualização de menores', 'Qualquer conteúdo sexual ou sexualizado com alguém de menos de 18 anos.'],
  violence: ['Ameaça ou violência', 'Ameaça alguém, incentiva violência ou mostra violência real.'],
  self_harm: ['Autolesão ou suicídio', 'Incentiva alguém a se machucar ou a tirar a própria vida.'],
  non_consensual_intimate: ['Imagem íntima sem consentimento', 'Nudez ou sexo de alguém que não autorizou, real ou montado.'],
  harassment: ['Assédio ou intimidação', 'Perseguição, humilhação, insistência depois de um "não".'],
  hate: ['Discurso de ódio', 'Ataque a alguém por raça, religião, gênero, orientação, deficiência ou origem.'],
  sexual_content: ['Conteúdo sexual explícito', 'Pornografia ou sexo explícito, que não é permitido em nenhum lugar do app.'],
  privacy: ['Exposição de dados pessoais', 'Endereço, documentos, telefone ou fotos de alguém sem permissão.'],
  scam: ['Golpe ou fraude', 'Pede dinheiro, senha ou dados com mentira.'],
  malware: ['Vírus ou link perigoso', 'Arquivo ou link que tenta invadir ou roubar uma conta.'],
  spam: ['Spam', 'Mensagens repetidas, propaganda ou convites em massa.'],
  impersonation: ['Fingindo ser outra pessoa', 'Usa o nome ou a foto de alguém para enganar.'],
  illegal_goods: ['Venda de itens ilegais', 'Drogas, armas ou outros itens proibidos por lei.'],
  piracy: ['Pirataria', 'Distribui conteúdo protegido sem autorização.'],
  ban_evasion: ['Fugindo de um banimento', 'Conta nova de quem já foi banido.'],
  other: ['Outra coisa', 'Viola os Termos ou as Diretrizes de outro jeito.'],
}

/** Shown first: risk to children and to life go to the top of the queue. */
export const URGENT: ReportReason[] = ['csam', 'violence', 'self_harm', 'non_consensual_intimate']
export const COMMON: ReportReason[] = ['harassment', 'hate', 'spam', 'scam', 'sexual_content', 'privacy']
export const MORE: ReportReason[] = ['malware', 'impersonation', 'illegal_goods', 'piracy', 'ban_evasion', 'other']

const day = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' })
const dayTime = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
/** "8 de novembro de 2026". */
export const longDate = (iso: string) => day.format(new Date(iso))
/** "8 de novembro de 2026 às 14:00". */
export const longDateTime = (iso: string) => dayTime.format(new Date(iso)).replace(',', ' às')

export const t = {
  legal: {
    terms: 'Termos de Uso',
    privacy: 'Política de Privacidade',
    guidelines: 'Diretrizes da Comunidade',
    loadError: 'Não foi possível carregar os Termos.',
    retry: 'Tentar de novo',
    /** Checkbox label, split around the links. */
    accept: ['Li e aceito os ', ' e as ', ', e li a ', '.'] as const,
    acceptRequired: 'Marque a caixa para continuar.',
    opensBrowser: 'abre no navegador',
  },

  signup: {
    birth: 'Data de nascimento',
    birthPlaceholder: 'DD/MM/AAAA',
    birthHint: 'Só para conferir a idade. Ninguém vê.',
    birthInvalid: 'Digite uma data real no formato DD/MM/AAAA.',
    birthFuture: 'Essa data ainda não chegou.',
    birthRequired: 'Preencha sua data de nascimento.',
    tooYoungTitle: 'Ainda não dá para criar sua conta',
    tooYoungBody: `O Alga Meet é para pessoas com ${MIN_AGE} anos ou mais. Para quem é mais novo, a lei pede ferramentas de acompanhamento dos responsáveis, e elas ainda não existem aqui.`,
    tooYoungNothingSaved: 'Nada do que você digitou foi enviado nem guardado.',
    tooYoungBack: 'Voltar para o início',
  },

  gate: {
    signOut: 'Sair da conta',
    termsTitle: 'Os Termos mudaram',
    termsBody: (v: string) =>
      `Atualizamos os Termos de Uso, as Diretrizes da Comunidade e a Política de Privacidade (versão de ${v}). Para continuar no Alga Meet, leia e aceite a versão nova.`,
    termsSubmit: 'Aceitar e continuar',
    disagree: 'Não concorda? Você pode',
    disagreeOr: 'ou',
    deleteAccount: 'excluir sua conta',
    signOutLower: 'sair',
    birthTitle: 'Qual é a sua data de nascimento?',
    birthBody: 'A lei brasileira pede que a gente confira a idade de quem usa o Alga Meet. Perguntamos uma vez só.',
    birthConfirm: (words: string) => `${words}. Confira antes de continuar: a data não pode ser mudada depois.`,
    birthSubmit: 'Continuar',
    birthWhy: 'Usada só para conferir a idade (Lei 15.211/2025, art. 13). Ninguém mais vê.',
  },

  restricted: {
    suspendedTitle: 'Sua conta está suspensa',
    bannedTitle: 'Sua conta foi encerrada',
    until: (d: string) => `Até ${d}. Depois disso, ela volta sozinha.`,
    noEnd: 'Esta decisão não tem data para terminar.',
    rule: 'Regra',
    underageBody: (d: string | null) =>
      `A data de nascimento informada indica menos de ${MIN_AGE} anos, a idade mínima do Alga Meet.${d ? ` A conta e os dados dela serão apagados em ${d}, a não ser que um recurso seja aceito.` : ''}`,
    underageAppealHint: 'Se a data estiver errada, conteste. A equipe confere a idade por fora, com um documento mostrado e não guardado.',
    appealTitle: 'Contestar a decisão',
    appealBody: (d: string) => `Você pode contestar até ${d}. Uma pessoa da equipe analisa e responde no seu e-mail.`,
    appealLabel: 'O que aconteceu, do seu ponto de vista',
    appealPlaceholder: 'Conte com suas palavras. Contexto ajuda: o que você quis dizer, com quem estava falando, o que mudou.',
    appealCount: (n: number) => `${n} de 2000 caracteres`,
    appealShort: 'Escreva pelo menos 10 caracteres.',
    appealSubmit: 'Enviar recurso',
    appealSent: 'Recurso enviado. Uma pessoa da equipe vai analisar e responder no seu e-mail.',
    appealOpen: 'Seu recurso está em análise. A resposta chega no seu e-mail.',
    appealRejected: 'Seu recurso foi analisado e a decisão foi mantida.',
    appealUpheld: 'Seu recurso foi aceito.',
    appealClosed: 'O prazo para contestar esta decisão terminou.',
    appealExpired: 'Por segurança, o recurso precisa ser enviado até 1 hora depois de entrar. Entre de novo para enviar.',
    back: 'Voltar para o login',
    guidelines: 'Ler as Diretrizes da Comunidade',
  },

  notice: {
    restricted: 'A equipe do Alga Meet aplicou uma medida na sua conta. Entre de novo para ver o motivo e como contestar.',
    deletion: (d: string) => `Sua conta será excluída em ${d}. Mudou de ideia? Entre até lá e a exclusão é cancelada.`,
    deletionCanceled: 'Exclusão cancelada',
    deletionCanceledBody: 'Sua conta continua aqui, do jeito que estava. Mandamos um e-mail confirmando.',
  },

  report: {
    title: { message: 'Denunciar mensagem', user: 'Denunciar perfil', space: 'Denunciar espaço' },
    action: 'Denunciar',
    menu: { message: 'Denunciar mensagem', user: 'Denunciar perfil', space: 'Denunciar espaço' },
    group: 'Segurança',
    question: 'Qual é o problema?',
    urgent: 'Urgente',
    others: 'Outros motivos',
    more: 'Mais motivos',
    next: 'Continuar',
    back: 'Voltar',
    change: 'Trocar',
    cancel: 'Cancelar',
    details: 'Quer contar mais?',
    detailsPlaceholder: 'Opcional. O que aconteceu, desde quando, se há outras contas envolvidas.',
    detailsCount: (n: number) => `${n} de 1000 caracteres`,
    anonymous: 'A pessoa denunciada nunca fica sabendo quem denunciou.',
    csamTitle: 'Prioridade máxima',
    csamMessage:
      'A equipe analisa antes de qualquer outra denúncia. Os anexos da mensagem saem do ar na hora e ficam guardados à parte, como prova, para a Polícia Federal.',
    csamOther: 'A equipe analisa antes de qualquer outra denúncia e comunica a Polícia Federal quando há indício de crime.',
    csamIdentified: 'Como a lei pede, sua conta fica identificada para a equipe. Para a pessoa denunciada, nunca.',
    csamDontShare: 'Não salve, não encaminhe e não tire print do conteúdo: isso também é crime. A denúncia já basta.',
    lifeTitle: 'Se alguém corre risco agora',
    lifeBody: 'Ligue 190 (Polícia) ou 192 (SAMU). Para conversar com alguém: CVV, 188, de graça e a qualquer hora.',
    submit: 'Enviar denúncia',
    doneTitle: 'Denúncia recebida',
    doneBody: 'Obrigado por avisar. Uma pessoa da equipe vai analisar. Se a regra foi violada, tomamos uma medida, e quem foi denunciado não fica sabendo quem avisou.',
    doneUrgent: 'Ela entrou no topo da fila.',
    duplicate: 'Você já tinha denunciado isto. A denúncia continua em análise.',
    blockOffer: (name: string) => `Quer parar de receber mensagens de ${name}?`,
    block: (name: string) => `Bloquear ${name}`,
    blocked: (name: string) => `${name} foi bloqueado.`,
    close: 'Fechar',
    rateLimited: 'Você enviou muitas denúncias na última hora. Tente de novo mais tarde. Se for urgente, ligue 190.',
    pick: 'Escolha um motivo.',
    by: (name: string) => `de ${name}`,
    members: (n: number) => `${n} ${n === 1 ? 'membro' : 'membros'}`,
    attachments: (n: number) => (n === 1 ? '1 anexo' : `${n} anexos`),
  },

  privacy: {
    nav: 'Privacidade',
    teenTitle: 'Proteções da sua conta',
    teenBody: 'Contas de 16 e 17 anos começam no modo mais protegido, como a lei pede. Ao fazer 18 anos, as proteções saem sozinhas.',
    teenDm: 'Mensagens diretas só entre amigos',
    teenDmHint: 'Nos dois sentidos: você não abre conversa com quem não é seu amigo, e ninguém de fora abre com você.',
    teenBuy: 'Compras desativadas',
    teenBuyHint: 'Alga Plus e itens da loja pedem 18 anos ou a assistência de um responsável, que ainda não existe no app.',
    docsTitle: 'Termos e privacidade',
    docsBody: 'O que você aceitou e como tratamos seus dados.',
    actionsTitle: 'Ações na minha conta',
    actionsBody: 'Avisos, suspensões e encerramentos aplicados pela equipe, com o prazo para contestar.',
    actionsEmpty: 'Nenhuma ação na sua conta.',
    actionsError: 'Não foi possível carregar as ações.',
    action: {
      warn: 'Aviso',
      suspend: 'Suspensão',
      ban: 'Encerramento da conta',
      lift: 'Medida retirada',
    },
    actionLine: (type: string, rule: string, date: string) => `${type} por ${rule} · ${date}`,
    liftLine: (date: string) => `A medida anterior foi retirada · ${date}`,
    untilLine: (d: string) => `até ${d}`,
    appealBy: (d: string) => `Contestar até ${d}`,
    appealStatus: { open: 'Recurso em análise', upheld: 'Recurso aceito', rejected: 'Recurso negado' },
    appeal: 'Contestar',
    appealTitle: 'Contestar a decisão',
    exportTitle: 'Baixar uma cópia dos seus dados',
    exportBody: 'Conta, mensagens que você escreveu, amizades, espaços, pagamentos e registros de acesso, num arquivo .zip com JSON. Quando fica pronta, o link vai para o seu e-mail (vale 7 dias) e o download também fica aqui.',
    exportRow: 'Seus dados',
    exportHint: 'Um pedido a cada 24 horas.',
    exportRequest: 'Pedir cópia',
    exportBuilding: (d: string) => `Preparando sua cópia, pedida em ${d}. Isto muda sozinho quando ficar pronta.`,
    exportReady: (d: string) => `Pronta. Fica disponível até ${d}; o link também foi para o seu e-mail.`,
    exportOpened: 'Download aberto no navegador.',
    exportExpired: (d: string) => `A última cópia expirou em ${d}. Peça outra quando quiser.`,
    exportFailed: 'Não deu para preparar a última cópia. Peça de novo.',
    exportLoadError: 'Não foi possível ver seus pedidos de cópia.',
    exportDownload: 'Baixar…',
    exportDownloadTitle: 'Baixar sua cópia',
    exportDownloadBody: (min: number) => `Digite sua senha de novo: assim, quem pegar uma sessão aberta sua não leva seus dados. O download abre no navegador, e o link vale ${min} minutos.`,
    exportDownloadConfirm: 'Baixar',
    exportVerify: 'Para pedir, confirme seu e-mail: é para lá que o link vai.',
    telemetryTitle: 'Relatório de qualidade de chamada',
    telemetryBody: 'Opcional e desligado até você ligar. Ajuda a melhorar a voz e a transmissão.',
    telemetryRow: 'Enviar relatório de qualidade de chamada',
    telemetryOff: 'Desligado: nada é enviado.',
    telemetryOn: 'Ligado: ao fim de cada chamada, o app envia números agregados. Desligue quando quiser.',
    telemetrySentTitle: 'O que vai',
    // Same words as docs/legal/politica-de-privacidade.md ("Relatório de qualidade de chamada").
    telemetrySent: 'Duração, tempo para entrar, reconexões, latência, jitter, perda de pacotes, codecs usados, se a codificação foi por hardware, faixas de fps e resolução, versão do app e do Windows e a classe do processador/placa de vídeo.',
    telemetryNeverTitle: 'O que nunca vai',
    telemetryNever: 'Áudio, vídeo, mensagens, nomes de salas, quem estava na chamada nem seu IP.',
    telemetryKept: 'Seu identificador é guardado como hash com sal rotativo e os dados são apagados em 30 dias. Base legal: consentimento (LGPD art. 7º, I), revogável a qualquer momento desligando a opção.',
    deleteTitle: 'Excluir conta',
    deleteBody: 'Apaga sua conta e seus dados. Você tem 7 dias para mudar de ideia.',
    deleteRow: 'Excluir minha conta',
    deleteHint: 'Você escolhe o que acontece com suas mensagens antes de confirmar.',
    deleteOpen: 'Excluir conta…',
  },

  deletion: {
    title: 'Excluir sua conta',
    grace: (d: string) => `Sua conta sai do ar agora e fica guardada por 7 dias, até ${d}. Se você entrar de novo nesse prazo, a exclusão é cancelada. Depois disso, ela é apagada de vez.`,
    gone: 'Somem: perfil, foto, anexos que você enviou, amizades, bloqueios, sessões e participação em espaços.',
    kept: 'Ficam, como a lei pede: registros de pagamento sem seu nome e registros de acesso por 6 meses.',
    messages: 'Suas mensagens',
    anonymize: ['Manter como “Usuário removido”', 'O texto fica nas conversas, sem seu nome nem sua foto, para que elas continuem fazendo sentido para quem ficou.'] as const,
    remove: ['Apagar minhas mensagens', 'Somem de todos os espaços e conversas diretas.'] as const,
    spacesTitle: 'Espaços seus',
    spaceHeir: 'passa para o membro com o cargo mais alto',
    spaceDeleted: 'é excluído com tudo o que tem dentro',
    spacesNote: 'No empate de cargo, quem está há mais tempo no espaço.',
    plus: 'Uma assinatura do Alga Plus para de renovar na hora.',
    exportFirst: 'Quer uma cópia antes? Peça em "Baixar uma cópia dos seus dados".',
    password: 'Sua senha',
    passwordHint: 'Para confirmar que é você.',
    cancel: 'Manter minha conta',
    confirm: 'Excluir minha conta',
    required: 'Digite sua senha.',
  },

  teen: {
    buyTitle: 'Compras pedem 18 anos',
    buyBody: 'Na sua idade, o pagamento precisa ser feito com um responsável, e isso ainda não existe no Alga Meet. Todo o resto continua igual, inclusive o que é grátis.',
  },
} as const
