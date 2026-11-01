/**
 * pt-BR e-mail templates: plain text + minimal HTML (inline styles, tables: what mail clients render). Colors from
 * docs/design/design-system.md (`--bg-content`, `--accent`, `--accent-fill`, `--on-accent`).
 * No user-chosen text (display name, username of the requester) goes into a mail that may reach someone else's inbox:
 * a registration can claim any address, so its fields would be a phishing channel signed by our domain.
 */
import type { EmailMessage } from './email.js'

type Content = Pick<EmailMessage, 'subject' | 'text' | 'html'>

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

function html(paragraphs: string[], action?: { label: string; href: string; code?: string }): string {
  const p = (t: string) => `<p style="margin:0 0 16px">${t}</p>`
  const button = action
    ? `<p style="margin:24px 0"><a href="${esc(action.href)}" style="display:inline-block;background:#21c9ca;color:#061415;` +
      `padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">${esc(action.label)}</a></p>` +
      (action.code
        ? `<p style="margin:0 0 16px;font-size:13px;color:#5b6166">Se o botão não abrir o app, cole este código nele:<br>` +
          `<code style="font-size:13px;word-break:break-all;color:#121517">${esc(action.code)}</code></p>`
        : '')
    : ''
  const [first, ...rest] = paragraphs
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">` +
    `<meta name="color-scheme" content="light"></head><body style="margin:0;background:#f1f4f6">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:12px;` +
    `font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#121517">` +
    `<tr><td style="background:#121517;border-radius:12px 12px 0 0;padding:18px 28px;color:#4ddcdc;font-size:17px;font-weight:600">Alga Meet</td></tr>` +
    `<tr><td style="padding:28px">${p(first!)}${button}${rest.map(p).join('')}</td></tr></table>` +
    `<p style="margin:16px 0 0;font-family:Arial,sans-serif;font-size:12px;color:#5b6166">Mensagem automática do Alga Meet. Não responda.</p>` +
    `</td></tr></table></body></html>`
}

const text = (lines: string[]) => `${lines.join('\n\n')}\n\n—\nMensagem automática do Alga Meet. Não responda.\n`

export function verifyEmailMail(link: string, token: string): Content {
  const intro = 'Confirme que este e-mail é seu para terminar de criar sua conta no Alga Meet.'
  const after = 'O link vale por 24 horas e só pode ser usado uma vez.'
  const ignore = 'Se você não criou uma conta, ignore esta mensagem: nada será feito com este endereço.'
  return {
    subject: 'Confirme seu e-mail no Alga Meet',
    text: text([intro, `Abra este link:\n${link}`, `Ou cole este código no app:\n${token}`, after, ignore]),
    html: html([intro, after, ignore], { label: 'Confirmar e-mail', href: link, code: token }),
  }
}

/** To the verified owner when someone registers again with their address (B5: the registration itself looks normal). */
export function accountExistsMail(username: string): Content {
  const intro = 'Alguém (talvez você) tentou criar uma conta no Alga Meet com este e-mail, mas ele já pertence a uma conta.'
  const login = `Para entrar, use este e-mail ou o nome de usuário @${username}. Se esqueceu a senha, toque em "Esqueci minha senha" na tela de login.`
  const ignore = 'Se não foi você, ignore esta mensagem: sua conta continua como está.'
  return {
    subject: 'Você já tem uma conta no Alga Meet',
    text: text([intro, login, ignore]),
    html: html([intro, esc(login), ignore]),
  }
}

export function passwordResetMail(link: string, token: string): Content {
  const intro = 'Recebemos um pedido para redefinir a senha da sua conta no Alga Meet.'
  const after = 'O link vale por 1 hora e só pode ser usado uma vez. Ao trocar a senha, todas as sessões abertas são encerradas.'
  const ignore = 'Se não foi você, ignore esta mensagem: sua senha continua a mesma.'
  return {
    subject: 'Redefinir sua senha do Alga Meet',
    text: text([intro, `Abra este link:\n${link}`, `Ou cole este código no app:\n${token}`, after, ignore]),
    html: html([intro, after, ignore], { label: 'Redefinir senha', href: link, code: token }),
  }
}

// ---- trust & safety and privacy (only to verified addresses; no user-chosen text) ----------------------------------

const APPEAL_HOW = 'Para contestar, entre no Alga Meet com seu e-mail e senha e use "Contestar decisão". Uma pessoa da ' +
  'equipe revisa cada recurso.'

/** Account action notice (Termos 8.4): the rule that was broken and how and until when to appeal. */
export function enforcementMail(type: 'warn' | 'suspend' | 'ban', reason: string, opts: { until?: string | null; appealBy?: string | null; deletionOn?: string | null } = {}): Content {
  const what = type === 'warn'
    ? 'Sua conta no Alga Meet recebeu um aviso.'
    : type === 'ban'
      ? 'Sua conta no Alga Meet foi encerrada.'
      : `Sua conta no Alga Meet foi suspensa${opts.until ? ` até ${opts.until}` : ''}.`
  const lines = [what, `Motivo: ${reason}.`]
  if (opts.deletionOn) lines.push(`Se a decisão não for revertida, a conta e os dados dela serão excluídos em ${opts.deletionOn}.`)
  if (opts.appealBy) lines.push(`${APPEAL_HOW} Prazo: até ${opts.appealBy}.`)
  return { subject: type === 'warn' ? 'Aviso sobre sua conta no Alga Meet' : 'Medida aplicada à sua conta no Alga Meet', text: text(lines), html: html(lines) }
}

export function appealDecisionMail(upheld: boolean): Content {
  const lines = upheld
    ? ['Revisamos seu recurso e revertemos a decisão sobre sua conta no Alga Meet.', 'Se a conta estava suspensa ou encerrada, você já pode entrar de novo.']
    : ['Revisamos seu recurso e mantivemos a decisão sobre sua conta no Alga Meet.', 'Se discordar, responda pelo canal de atendimento indicado nos Termos de Uso.']
  return { subject: 'Resultado do seu recurso no Alga Meet', text: text(lines), html: html(lines) }
}

export function deletionScheduledMail(purgeOn: string): Content {
  const lines = [
    `Recebemos o pedido para excluir sua conta no Alga Meet. Ela será excluída em ${purgeOn}.`,
    'Todas as sessões foram encerradas. Para desistir, basta entrar no app de novo antes dessa data.',
    'Se não foi você, entre agora e troque sua senha.',
  ]
  return { subject: 'Exclusão da sua conta no Alga Meet', text: text(lines), html: html(lines) }
}

export function deletionCanceledMail(): Content {
  const lines = ['Você entrou de novo no Alga Meet, então a exclusão da sua conta foi cancelada.', 'Se não foi você, troque sua senha agora.']
  return { subject: 'Exclusão da conta cancelada', text: text(lines), html: html(lines) }
}

export function accountDeletedMail(): Content {
  const lines = [
    'Sua conta no Alga Meet foi excluída, como você pediu.',
    'Guardamos só o que a lei exige, pelo prazo legal: registros de acesso (6 meses), registros fiscais de pagamentos sem ' +
      'vínculo com a sua identidade e casos de moderação em andamento. Detalhes na Política de Privacidade.',
  ]
  return { subject: 'Sua conta no Alga Meet foi excluída', text: text(lines), html: html(lines) }
}

export function dataExportMail(link: string, expiresOn: string): Content {
  const lines = [
    'A cópia dos seus dados do Alga Meet está pronta: um arquivo .zip com seus dados em JSON e links para os seus anexos.',
    `O link vale até ${expiresOn}. Não o encaminhe: quem tiver o link consegue baixar o arquivo.`,
    'Se não foi você que pediu, troque sua senha.',
  ]
  return {
    subject: 'Seus dados do Alga Meet estão prontos',
    text: text([lines[0]!, `Baixe aqui:\n${link}`, ...lines.slice(1)]),
    html: html(lines, { label: 'Baixar meus dados', href: link }),
  }
}

const brl = (cents: number) => `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`

/**
 * Receipt to the payer (Decreto 7.962/2013 art. 4º; growth-plan §2.4 "checkout honesto"). Only catalog text and the
 * recipient's @username (a constrained charset), never a display name or a gift message.
 */
export function receiptMail(r: {
  reference: string; productName: string; amountCents: number; paidAt: Date; renews: 'month' | 'year' | null
  giftTo: string | null; termsUrl: string
}): Content {
  const lines = [
    `Recebemos o seu pagamento de ${brl(r.amountCents)} por ${r.productName}${r.giftTo ? `, de presente para @${r.giftTo}` : ''}.`,
    r.renews
      ? `Renova sozinho a cada ${r.renews === 'year' ? '12 meses' : 'mês'}, pelo mesmo valor. Você pode cancelar a renovação no app quando quiser.`
      : 'Pagamento único: não há renovação.',
    'Você pode pedir o reembolso integral em até 7 dias, no próprio app ("Pedir reembolso"), sem precisar explicar o motivo.',
    `Data: ${r.paidAt.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}. Pedido: ${r.reference}. O que você compra é uma licença de uso que fica na sua conta.`,
    `Termos de Uso: ${r.termsUrl}`,
  ]
  return { subject: `Recibo do Alga Meet: ${r.productName}`, text: text(lines), html: html(lines.map(esc)) }
}

/** To an adult recipient with a verified address when a gift arrives. No message text (it is user-chosen). */
export function giftReceivedMail(senderUsername: string | null): Content {
  const lines = [
    `${senderUsername ? `@${senderUsername}` : 'Um amigo'} mandou um presente para você no Alga Meet.`,
    'Abra o app para ver o que é: você pode abrir ou recusar. Se recusar, quem deu recebe o valor de volta.',
  ]
  return { subject: 'Você recebeu um presente no Alga Meet', text: text(lines), html: html(lines.map(esc)) }
}

// ---- retention (src/events/, src/activity/; growth-plan §4.3) -------------------------------------------------------
// No user-chosen text (event titles, space names, display names): only the time and fixed copy.

/** Asked for on that event (EventView.emailReminder), to a verified address. `time` = 'HH:MM' in Brasília time. */
export function eventReminderMail(time: string): Content {
  const lines = [
    `Lembrete: o evento que você marcou começa às ${time} (horário de Brasília).`,
    'Abra o Alga Meet para entrar na sala quando começar.',
    'Você recebe este e-mail porque pediu o lembrete por e-mail neste evento. Para não receber mais, desmarque a opção no evento.',
  ]
  return { subject: `Seu evento começa às ${time}`, text: text(lines), html: html(lines) }
}

/**
 * Activity e-mail (consent only, adults only, at most 1 per 7 days and 4 per 60): a concrete reason, never a streak,
 * a count or pressure. `unsubscribe` is the one-click link.
 */
export function activityMail(reason: 'event' | 'friend_call', unsubscribe: string): Content {
  const what = reason === 'event'
    ? 'Tem evento marcado em um dos seus espaços no Alga Meet nos próximos dias.'
    : 'Um amigo chamou você numa chamada no Alga Meet enquanto você estava fora.'
  const why = 'Você recebe este e-mail porque ativou os e-mails de atividade. Mandamos no máximo um por semana, e paramos depois de quatro até você voltar.'
  const out = `Para não receber mais, é só um clique: ${unsubscribe}`
  return {
    subject: reason === 'event' ? 'Tem evento marcado no seu espaço' : 'Um amigo chamou você no Alga Meet',
    text: text([what, why, out]),
    html: html([what, why, `<a href="${esc(unsubscribe)}" style="color:#5b6166">Não quero mais esses e-mails</a> (um clique, sem login).`]),
  }
}
