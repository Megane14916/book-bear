// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { createApiClient } from './client'
import { ApiError, HttpError, isAbortError } from './errors'
import { requestData } from './result'

const baseUrl = 'http://api.test'
const healthResponse = () => Response.json({ status: 'ok' })

describe('typed API transport', () => {
  it('returns typed success data', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(healthResponse())
    const { api } = createApiClient({ baseUrl, fetch: fetcher })
    await expect(requestData(() => api.GET('/api/v1/health'))).resolves.toEqual({ status: 'ok' })
    expect((fetcher.mock.calls[0][0] as Request).url).toBe(`${baseUrl}/api/v1/health`)
  })

  it.each([
    [400, 'VALIDATION_ERROR'], [401, 'UNAUTHORIZED'], [403, 'REGISTRATION_REQUIRED'],
    [404, 'NOT_FOUND'], [409, 'HAS_BOOKMARKS'], [500, 'INTERNAL_ERROR'],
    [502, 'BOOK_PROVIDER_UNAVAILABLE'], [503, 'INTERNAL_ERROR'], [504, 'INTERNAL_ERROR'],
  ])('preserves HTTP %s and API code %s', async (status, code) => {
    const { api } = createApiClient({ baseUrl, fetch: vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ error: { code, message: '入力を確認', details: { field: 'content' } } }, { status }),
    ) })
    await expect(requestData(() => api.GET('/api/v1/health'))).rejects.toMatchObject({
      kind: 'http', status, code, message: '入力を確認', details: { field: 'content' },
    })
  })

  it.each(['<html>proxy error</html>', '', '{broken json'])('preserves status with a non-JSON error body', async (body) => {
    const { api } = createApiClient({ baseUrl, fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status: 503 })) })
    await expect(requestData(() => api.GET('/api/v1/health'))).rejects.toMatchObject({ status: 503, code: null, kind: 'http' })
  })

  it('treats 204 as success without parsing a body', async () => {
    const response = new Response(null, { status: 204 })
    const json = vi.spyOn(response, 'json')
    const { api } = createApiClient({ baseUrl, fetch: vi.fn<typeof fetch>().mockResolvedValue(response) })
    await expect(requestData(() => api.DELETE('/api/v1/bookmarks/{bookmarkId}', {
      params: { path: { bookmarkId: '00000000-0000-4000-8000-000000000001' } },
    }))).resolves.toBeNull()
    expect(json).not.toHaveBeenCalled()
  })

  it('distinguishes network failure from HTTP failure without retaining raw credentials', async () => {
    const { api } = createApiClient({ baseUrl, fetch: vi.fn<typeof fetch>().mockRejectedValue(new TypeError('sensitive raw error')) })
    const error = await requestData(() => api.GET('/api/v1/health')).catch((error: unknown) => error)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).not.toBeInstanceOf(HttpError)
    expect(error).toMatchObject({ kind: 'network' })
    expect(String(error)).not.toContain('sensitive')
  })

  it('does not misclassify malformed success JSON as a network failure', async () => {
    const { api } = createApiClient({ baseUrl, fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response('{broken')) })
    await expect(requestData(() => api.GET('/api/v1/health'))).rejects.toMatchObject({ kind: 'response' })
  })

  it('rejects an empty 200 rather than reporting a successful empty query', async () => {
    const { api } = createApiClient({ baseUrl, fetch: vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 200, headers: { 'Content-Length': '0' } }),
    ) })
    await expect(requestData(() => api.GET('/api/v1/health'))).rejects.toMatchObject({ kind: 'response' })
  })

  it('uses the latest token on each request and removes Authorization when cleared', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => healthResponse())
    const { api, setAccessTokenGetter } = createApiClient({ baseUrl, fetch: fetcher })
    await api.GET('/api/v1/health')
    let token = 'first'
    setAccessTokenGetter(async () => token)
    await api.GET('/api/v1/health')
    token = 'updated'
    await api.GET('/api/v1/health')
    setAccessTokenGetter(undefined)
    await api.GET('/api/v1/health', { headers: { Authorization: 'Bearer stale' } })
    expect(fetcher.mock.calls.map(([request]) => (request as Request).headers.get('Authorization')))
      .toEqual([null, 'Bearer first', 'Bearer updated', null])
  })

  it('does not send an unauthenticated request when the token getter fails', async () => {
    const fetcher = vi.fn<typeof fetch>()
    const { api, setAccessTokenGetter } = createApiClient({ baseUrl, fetch: fetcher })
    setAccessTokenGetter(async () => { throw new Error('secret') })
    await expect(requestData(() => api.GET('/api/v1/health'))).rejects.toMatchObject({ kind: 'auth' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('omits Authorization when the current token getter returns null', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(healthResponse())
    const { api, setAccessTokenGetter } = createApiClient({ baseUrl, fetch: fetcher })
    setAccessTokenGetter(async () => null)
    await api.GET('/api/v1/health')
    expect((fetcher.mock.calls[0][0] as Request).headers.has('Authorization')).toBe(false)
  })

  it('does not obtain a token or send an already-aborted request with a custom reason', async () => {
    const fetcher = vi.fn<typeof fetch>()
    const { api, setAccessTokenGetter } = createApiClient({ baseUrl, fetch: fetcher })
    const getter = vi.fn(async () => 'token')
    setAccessTokenGetter(getter)
    const controller = new AbortController()
    controller.abort('private abort reason')
    const error = await requestData(() => api.GET('/api/v1/health', { signal: controller.signal })).catch((error: unknown) => error)
    expect(isAbortError(error)).toBe(true)
    expect(String(error)).not.toContain('private abort reason')
    expect(getter).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('does not send a request aborted while waiting for a token', async () => {
    const fetcher = vi.fn<typeof fetch>()
    const { api, setAccessTokenGetter } = createApiClient({ baseUrl, fetch: fetcher })
    let resolveToken!: (token: string) => void
    setAccessTokenGetter(() => new Promise((resolve) => { resolveToken = resolve }))
    const controller = new AbortController()
    const result = requestData(() => api.GET('/api/v1/health', { signal: controller.signal })).catch((error: unknown) => error)
    await vi.waitFor(() => expect(resolveToken).toBeTypeOf('function'))
    controller.abort()
    resolveToken('new-token')
    expect(isAbortError(await result)).toBe(true)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('propagates cancellation during fetch as an abort, not a network failure', async () => {
    let sentSignal: AbortSignal | undefined
    const fetcher = vi.fn<typeof fetch>().mockImplementation((request) => new Promise((_resolve, reject) => {
      sentSignal = (request as Request).signal
      sentSignal.addEventListener('abort', () => reject(sentSignal!.reason), { once: true })
    }))
    const { api } = createApiClient({ baseUrl, fetch: fetcher })
    const controller = new AbortController()
    const result = requestData(() => api.GET('/api/v1/health', { signal: controller.signal })).catch((error: unknown) => error)
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
    controller.abort(new Error('private abort reason'))
    expect(isAbortError(await result)).toBe(true)
    expect(sentSignal?.aborted).toBe(true)
  })
})
