import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { api } from './client'
import { HealthCheck } from './HealthCheck'
import { getHealth, healthQueryOptions } from './health'
import { ApiError, HttpError } from './errors'
import { createQueryClient } from '../query/client'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('health query under the provider', () => {
  it('shows typed success and supports a manual recheck', async () => {
    const get = vi.spyOn(api, 'GET').mockResolvedValue({ data: { status: 'ok' }, response: Response.json({ status: 'ok' }) })
    const client = createQueryClient()
    render(<QueryClientProvider client={client}><HealthCheck /></QueryClientProvider>)
    await screen.findByText('接続成功：ok')
    expect(get.mock.calls[0][0]).toBe('/api/v1/health')
    expect((get.mock.calls[0][1] as { signal?: AbortSignal } | undefined)?.signal).toBeInstanceOf(AbortSignal)
    fireEvent.click(screen.getByRole('button', { name: '再確認' }))
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2))
    await screen.findByText('接続成功：ok')
    client.clear()
  })

  it('shows an error and can recover on recheck', async () => {
    vi.spyOn(api, 'GET').mockRejectedValueOnce(new HttpError(404, { error: { code: 'NOT_FOUND', message: '見つかりません' } }))
      .mockResolvedValue({ data: { status: 'ok' }, response: Response.json({ status: 'ok' }) })
    const client = createQueryClient()
    render(<QueryClientProvider client={client}><HealthCheck /></QueryClientProvider>)
    await screen.findByText('見つかりません')
    fireEvent.click(screen.getByRole('button', { name: '再確認' }))
    await screen.findByText('接続成功：ok')
    client.clear()
  })

  it('cancels the transport signal and reverts query state', async () => {
    let signal: AbortSignal | undefined
    vi.spyOn(api, 'GET').mockImplementation((_path: string, options?: { signal?: AbortSignal | null }) => new Promise((_resolve, reject) => {
      signal = options?.signal ?? undefined
      signal?.addEventListener('abort', () => reject(signal!.reason), { once: true })
    }))
    const client = createQueryClient()
    const result = client.fetchQuery(healthQueryOptions()).catch((error: unknown) => error)
    await waitFor(() => expect(signal).toBeDefined())
    await client.cancelQueries({ queryKey: ['health'] })
    await result
    expect(signal?.aborted).toBe(true)
    expect(client.getQueryData(['health'])).toBeUndefined()
    expect(client.getQueryState(['health'])?.fetchStatus).toBe('idle')
    client.clear()
  })

  it('does not cache a late success from transport that ignores cancellation', async () => {
    let resolveResponse!: (value: { data: { status: 'ok' }; response: Response }) => void
    const get = vi.spyOn(api, 'GET').mockImplementation(() => new Promise((resolve) => { resolveResponse = resolve }))
    const client = createQueryClient()
    const result = client.fetchQuery(healthQueryOptions()).catch((error: unknown) => error)
    await waitFor(() => expect(get).toHaveBeenCalledOnce())
    await client.cancelQueries({ queryKey: ['health'] })
    resolveResponse({ data: { status: 'ok' }, response: Response.json({ status: 'ok' }) })
    await result
    // Let the ignored transport result propagate through requestData/getHealth.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(client.getQueryData(['health'])).toBeUndefined()
    expect(client.getQueryState(['health'])?.fetchStatus).toBe('idle')
    client.clear()
  })

  it('rejects an unexpected health payload', async () => {
    vi.spyOn(api, 'GET').mockResolvedValue({ data: {}, response: Response.json({}) })
    await expect(getHealth()).rejects.toBeInstanceOf(ApiError)
  })
})
