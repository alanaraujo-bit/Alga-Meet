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
  constructor(readonly code: ApiErrorCode, message: string, readonly fields?: Record<string, string>) {
    super(message)
    this.statusCode = STATUS[code]
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
    req.log.error({ err }, 'unhandled error')
    return reply.code(500).send(body('internal', 'Erro interno.'))
  })
}
