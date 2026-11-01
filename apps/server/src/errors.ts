import type { ApiError, ApiErrorCode } from '@alga/shared'
import type { FastifyError, FastifyInstance } from 'fastify'
import { z, ZodError } from 'zod'

const STATUS: Record<ApiErrorCode, number> = {
  bad_request: 400,
  validation: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  internal: 500,
}

export class HttpError extends Error {
  readonly statusCode: number
  /** `status` overrides the code's default (e.g. 413 for a `validation` error on an oversized upload). */
  constructor(readonly code: ApiErrorCode, message: string, readonly fields?: Record<string, string>, status?: number) {
    super(message)
    this.statusCode = status ?? STATUS[code]
  }
}

export const badRequest = (message: string) => new HttpError('bad_request', message)
export const forbidden = (message = 'Você não tem permissão para isso.') => new HttpError('forbidden', message)
export const notFound = (message = 'Não encontrado.') => new HttpError('not_found', message)
export const conflict = (message: string, fields?: Record<string, string>) => new HttpError('conflict', message, fields)
export const invalid = (fields: Record<string, string>) => new HttpError('validation', 'Dados inválidos.', fields)

function fieldsOf(err: ZodError): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const issue of err.issues) {
    const key = issue.path.join('.') || '_'
    fields[key] ??= issue.message
  }
  return fields
}

/** Parses untrusted input with a zod schema; failures become a 400 `validation` ApiError. */
export function parse<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const r = schema.safeParse(data ?? {})
  if (!r.success) throw invalid(fieldsOf(r.error))
  return r.data
}

const uuidSchema = z.uuid()
/** Path ids are UUIDs; anything else cannot exist, so it is a 404 rather than a DB error. */
export function idParam(value: string | undefined): string {
  if (!value || !uuidSchema.safeParse(value).success) throw notFound()
  return value
}

/**
 * Error for logs without data: drizzle puts SQL params in `message`/`params`, pg puts row values in `detail`.
 * Keeps type, the query text (placeholders only), pg `code` and the stack frames.
 */
export function safeErr(err: unknown): Record<string, unknown> {
  const e = (err ?? {}) as { name?: string; message?: unknown; code?: unknown; stack?: string; cause?: unknown }
  return {
    type: e.name,
    message: String(e.message ?? '').split('\nparams:')[0],
    code: e.code,
    stack: e.stack?.split('\n').filter((l) => l.trimStart().startsWith('at ')).join('\n'),
    ...(e.cause ? { cause: safeErr(e.cause) } : {}),
  }
}

/** Invite codes and file-URL signatures are bearer secrets; keep them out of request logs. */
export const safeUrl = (url: string) =>
  url.replace(/(\/invites\/)[^/?#]+/, '$1<redacted>').replace(/([?&]sig=)[^&#]+/, '$1<redacted>')

const body = (code: ApiErrorCode, message: string, fields?: Record<string, string>): ApiError =>
  ({ error: fields ? { code, message, fields } : { code, message } })

export function installErrorHandling(app: FastifyInstance): void {
  app.setNotFoundHandler((_req, reply) => {
    void reply.code(404).send(body('not_found', 'Rota não encontrada.'))
  })

  app.setErrorHandler((err: FastifyError | HttpError | ZodError, req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send(body(err.code, err.message, err.fields))
    }
    if (err instanceof ZodError) {
      return reply.code(400).send(body('validation', 'Dados inválidos.', fieldsOf(err)))
    }
    const status = err.statusCode ?? 500
    if (status === 429) return reply.code(429).send(body('rate_limited', 'Muitas requisições. Tente novamente em instantes.'))
    if (status >= 400 && status < 500) {
      // Fastify-level client errors: malformed JSON, unsupported media type, body too large…
      return reply.code(status).send(body(status === 404 ? 'not_found' : 'bad_request', err.message))
    }
    req.log.error({ err: safeErr(err) }, 'unhandled error')
    return reply.code(500).send(body('internal', 'Erro interno.'))
  })
}
