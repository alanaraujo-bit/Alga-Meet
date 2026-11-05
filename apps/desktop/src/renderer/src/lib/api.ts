import type { AccountRestriction, ApiError, ApiErrorCode } from '@alga/shared'

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode | 'network',
    message: string,
    readonly fields?: Record<string, string>,
    /** Suspended/banned account (403 on login, or a session that raced the action). */
    readonly restriction?: AccountRestriction,
    /** Soundboard 429: how long to wait and which limit (cooldown | channel_busy | burst). */
    readonly retry?: { afterMs: number; reason?: string },
  ) {
    super(message)
  }
}

let token: string | null = null
export const setApiToken = (t: string | null): void => {
  token = t
}
/** Authorization header for raw fetches (binary downloads such as soundboard audio). */
export const authHeaders = (): Record<string, string> => (token ? { authorization: `Bearer ${token}` } : {})

/** `X-Alga-Client: <version>; <os>` labels this device in Sessões; left out when main does not report the OS. */
export const clientHeader = (c: { version?: string; osVersion?: string } | undefined): string | null =>
  c?.version && c.osVersion ? `${c.version}; ${c.osVersion}` : null

/** Typed REST call against /api/v1. Throws ApiRequestError (status 0 = network failure). */
export async function api<T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {}
  if (token) headers.authorization = `Bearer ${token}`
  const client = clientHeader(window.alga.config)
  if (client) headers['x-alga-client'] = client
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
    throw new ApiRequestError(res.status, e?.code ?? 'internal', e?.message ?? `Erro inesperado (HTTP ${res.status}).`, e?.fields, e?.restriction,
      e?.retryAfterMs !== undefined ? { afterMs: e.retryAfterMs, reason: e.reason } : undefined)
  }
  return data as T
}

/**
 * Multipart upload with progress (fetch has no upload progress, XHR does). `onProgress` gets 0..1.
 * Same errors as `api` (status 0 = network failure or abort).
 */
export function upload<T>(method: 'POST' | 'PUT', path: string, body: FormData, onProgress?: (p: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open(method, `${window.alga.config.apiUrl}/api/v1${path}`)
    if (token) xhr.setRequestHeader('authorization', `Bearer ${token}`)
    const client = clientHeader(window.alga.config)
    if (client) xhr.setRequestHeader('x-alga-client', client)
    xhr.responseType = 'json'
    if (onProgress) xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total)
    xhr.onerror = xhr.onabort = () => reject(new ApiRequestError(0, 'network', 'Não foi possível falar com o servidor. Verifique sua conexão.'))
    xhr.onload = () => {
      const data = xhr.response as (T & Partial<ApiError>) | null
      if (xhr.status >= 200 && xhr.status < 300) return resolve(data as T)
      const e = data?.error
      reject(new ApiRequestError(xhr.status, e?.code ?? 'internal', e?.message ?? `Erro inesperado (HTTP ${xhr.status}).`, e?.fields))
    }
    xhr.send(body)
  })
}
