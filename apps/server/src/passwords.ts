/** Password policy beyond the length the contract checks (B10): no common/leaked, trivial or personal passwords. */
import { COMMON_PASSWORDS } from './common-passwords.js'
import { invalid } from './errors.js'

/** Why `password` is refused (pt-BR, for `fields`), or null. Case-insensitive. */
export function weakPassword(password: string, who: { username: string; email: string }): string | null {
  const p = password.toLowerCase()
  if (COMMON_PASSWORDS.has(p)) return 'Esta senha é muito comum e aparece em vazamentos. Escolha outra.'
  // A 1–4 character unit repeated ("aaaaaaaaaa", "abcabcabca", "12121212121").
  for (let n = 1; n <= 4; n++) {
    if (p.slice(0, n).repeat(Math.ceil(p.length / n)).slice(0, p.length) === p) return 'Senha fácil de adivinhar: evite repetições.'
  }
  // A straight run ("abcdefghij", "9876543210").
  const step = p.charCodeAt(1) - p.charCodeAt(0)
  if (Math.abs(step) === 1 && [...p].every((c, i) => i === 0 || c.charCodeAt(0) - p.charCodeAt(i - 1) === step)) {
    return 'Senha fácil de adivinhar: evite sequências.'
  }
  const local = who.email.split('@')[0] ?? ''
  if ([who.username, local].some((w) => w.length >= 4 && p.includes(w.toLowerCase()))) {
    return 'A senha não pode conter seu nome de usuário ou seu e-mail.'
  }
  return null
}

/** 400 `fields[field]` when `weakPassword` refuses it. */
export function assertStrongPassword(password: string, who: { username: string; email: string }, field: string): void {
  const why = weakPassword(password, who)
  if (why) throw invalid({ [field]: why })
}
