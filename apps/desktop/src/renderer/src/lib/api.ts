import type { ApiError, ApiErrorCode } from '@alga/shared'

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode | 'network',
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message)
  }
}

let token: string | null = null
export const setApiToken = (t: string | null): void => {
  token = t
}

/** Typed REST call against /api/v1. Throws ApiRequestError (status 0 = network failure). */
export async function api<T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {}
  if (token) headers.authorization = `Bearer ${token}`
  if (body !== undefined) headers['content-type'] = 'application/json'
  let res: Response
  try {
    res = await fetch(`${window.alga.config.apiUrl}/api/v1${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiRequestError(0, 'network', 'Não foi possível falar com o servidor. Verifique sua conexão.')
  }
  if (res.status === 204) return undefined as T
  const data = (await res.json().catch(() => null)) as (T & Partial<ApiError>) | null
  if (!res.ok) {
    const e = data?.error
    throw new ApiRequestError(res.status, e?.code ?? 'internal', e?.message ?? `Erro inesperado (HTTP ${res.status}).`, e?.fields)
  }
  return data as T
}
