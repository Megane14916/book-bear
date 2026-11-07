import createClient from 'openapi-fetch'
import type { paths } from './generated'
import { ApiError, HttpError, isAbortError, throwIfAborted } from './errors'

export type AccessTokenGetter = () => Promise<string | null>

// Each instance owns its getter, allowing isolated tests without global auth state.
export function createApiClient(options: { baseUrl?: string; fetch?: typeof fetch } = {}) {
  let getAccessToken: AccessTokenGetter | undefined
  let getRequestSignal: (() => AbortSignal) | undefined
  const api = createClient<paths>({
    baseUrl: options.baseUrl ?? (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8787'),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  })

  api.use({
    async onRequest({ request }) {
      if (getRequestSignal) {
        request = new Request(request, { signal: AbortSignal.any([request.signal, getRequestSignal()]) })
      }
      throwIfAborted(request.signal)
      let token: string | null = null
      try {
        token = await getAccessToken?.() ?? null
      } catch (error) {
        throwIfAborted(request.signal)
        if (isAbortError(error)) throw error
        throw new ApiError('auth', '認証情報を取得できませんでした。')
      }
      throwIfAborted(request.signal)
      // This boundary owns Authorization; never retain a caller's stale token.
      request.headers.delete('Authorization')
      if (token) request.headers.set('Authorization', `Bearer ${token}`)
      return request
    },
    async onResponse({ response, request }) {
      if (response.ok) return
      let payload: unknown
      try {
        payload = await response.clone().json()
      } catch (error) {
        throwIfAborted(request.signal)
        if (isAbortError(error)) throw error
        // Proxies can return empty or HTML error bodies. Preserve the HTTP status.
      }
      throw new HttpError(response.status, payload)
    },
    onError({ error, request }) {
      throwIfAborted(request.signal)
      if (isAbortError(error)) return error
      // Do not keep raw errors/requests, which can contain credentials.
      return new ApiError('network', 'APIに接続できませんでした。通信環境を確認してください。')
    },
  })

  return {
    api,
    // Issue #36 installs the getter; this module never logs in or refreshes tokens.
    setAccessTokenGetter(getter?: AccessTokenGetter) { getAccessToken = getter },
    setRequestSignalGetter(getter?: () => AbortSignal) { getRequestSignal = getter },
  }
}

export const { api, setAccessTokenGetter, setRequestSignalGetter } = createApiClient()
