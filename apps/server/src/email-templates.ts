/**
 * pt-BR e-mail templates: plain text + minimal HTML (inline styles, tables: what mail clients render). Colors from
 * docs/design/design-system.md (`--bg-content`, `--accent`, `--accent-fill`, `--on-accent`).
 * No user-chosen text (display name, username of the requester) goes into a mail that may reach someone else's inbox:
 * a registration can claim any address, so its fields would be a phishing channel signed by our domain.
 */
import type { EmailMessage } from './email.js'

type Content = Pick<EmailMessage, 'subject' | 'text' | 'html'>

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

function html(paragraphs: string[], action?: { label: string; href: string; code: string }): string {
  const p = (t: string) => `<p style="margin:0 0 16px">${t}</p>`
  const button = action
    ? `<p style="margin:24px 0"><a href="${esc(action.href)}" style="display:inline-block;background:#21c9ca;color:#061415;` +
      `padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">${esc(action.label)}</a></p>` +
      `<p style="margin:0 0 16px;font-size:13px;color:#5b6166">Se o botão não abrir o app, cole este código nele:<br>` +
      `<code style="font-size:13px;word-break:break-all;color:#121517">${esc(action.code)}</code></p>`
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
