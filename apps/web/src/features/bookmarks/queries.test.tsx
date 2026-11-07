import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { throwIfAborted } from '../../lib/api/errors'
import { useBookmarkWrite } from './queries'
import type { Bookmark } from './api'

vi.mock('../../lib/auth/AuthProvider', () => ({ useAuth: () => ({
  runAuthenticatedWrite: async (operation: (context: { signal: AbortSignal; userId: string }) => Promise<unknown>, signal: AbortSignal) => {
    throwIfAborted(signal)
    const result = await operation({ signal, userId: 'owner' })
    throwIfAborted(signal)
    return result
  },
}) }))
afterEach(cleanup)

function setup(operation: (input: string, signal: AbortSignal) => Promise<Bookmark | null>) {
  const client = new QueryClient()
  const onSaved = vi.fn()
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const hook = renderHook(({ scope }) => useBookmarkWrite(operation, scope, onSaved), { wrapper, initialProps: { scope: 'first' } })
  return { ...hook, client, onSaved }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
it('synchronously locks two submissions and removes detail caches after confirmed deletion', async () => {
  const pending = deferred<null>()
  const operation = vi.fn(() => pending.promise)
  const hook = setup(operation)
  hook.client.setQueryData(['bookmarks', 'detail', 'id', 'owner'], { content: '削除前' })
  act(() => { void hook.result.current.save('first'); void hook.result.current.save('second') })
  await waitFor(() => expect(operation).toHaveBeenCalledTimes(1))
  await act(async () => { pending.resolve(null) })
  await waitFor(() => expect(hook.onSaved).toHaveBeenCalledTimes(1))
  expect(hook.client.getQueryData(['bookmarks', 'detail', 'id', 'owner'])).toBeUndefined()
  hook.client.clear()
})
it('does not apply a late response after leaving the form', async () => {
  const pending = deferred<null>()
  let signal: AbortSignal | undefined
  const hook = setup(vi.fn((_input, current) => { signal = current; return pending.promise }))
  act(() => { void hook.result.current.save('draft') })
  await waitFor(() => expect(signal).toBeDefined())
  hook.unmount()
  expect(signal!.aborted).toBe(true)
  await act(async () => { pending.resolve(null) })
  expect(hook.onSaved).not.toHaveBeenCalled()
  hook.client.clear()
})
it('does not automatically retry a failed POST and allows an explicit retry', async () => {
  const operation = vi.fn().mockRejectedValueOnce(new Error('通信失敗')).mockResolvedValueOnce(null)
  const hook = setup(operation)
  await act(async () => { await hook.result.current.save('draft') })
  expect(operation).toHaveBeenCalledTimes(1)
  expect(hook.onSaved).not.toHaveBeenCalled()
  await act(async () => { await hook.result.current.save('revised') })
  expect(operation).toHaveBeenCalledTimes(2)
  expect(hook.onSaved).toHaveBeenCalledTimes(1)
  hook.client.clear()
})
