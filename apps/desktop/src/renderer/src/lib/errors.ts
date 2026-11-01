import { ApiRequestError } from './api'

/** One human sentence (pt-BR) for any thrown value. Server messages are already pt-BR. */
export function errorText(e: unknown, fallback = 'Algo deu errado. Tente de novo.'): string {
  if (e instanceof ApiRequestError) {
    if (e.code === 'rate_limited') return 'Muitas tentativas. Aguarde um pouco e tente de novo.'
    return e.message || fallback
  }
  return fallback
}

/**
 * Field errors from a `validation` / `conflict` response. zod's default issue messages are English,
 * so validation messages for known fields are replaced by our own pt-BR copy.
 */
export function fieldErrors(e: unknown, ptBr: Record<string, string> = {}): Record<string, string> {
  if (!(e instanceof ApiRequestError) || !e.fields) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(e.fields)) out[k] = e.code === 'validation' && ptBr[k] ? ptBr[k] : v
  return out
}
