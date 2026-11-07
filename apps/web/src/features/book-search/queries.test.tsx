import { useState, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { createQueryClient } from '../../lib/query/client'
import { AuthError } from '../../lib/auth/errors'
import { useBookCreation } from './queries'
import type { Book } from './api'

const auth = vi.hoisted(() => ({ useAuth: vi.fn() }))
vi.mock('../../lib/auth/AuthProvider', () => ({ useAuth: auth.useAuth }))
const book: Book = { id: '00000000-0000-4000-8000-000000000001', title: '本', author: null, coverUrl: null,
  isbn13: null, publisher: null, totalPages: null, source: 'manual' }
const clients: ReturnType<typeof createQueryClient>[] = []
beforeEach(() => {
  auth.useAuth.mockReturnValue({ status: 'guest', error: null, retrySession: vi.fn(),
    runAuthenticatedWrite: async (operation: (context: { signal: AbortSignal; userId: string }) => Promise<Book>, signal: AbortSignal) => operation({ signal, userId: 'user' }) })
})
afterEach(() => { cleanup(); clients.splice(0).forEach((client) => client.clear()); vi.clearAllMocks() })
function wrapper({ children }: { children: ReactNode }) {
  const [client] = useState(() => { const current = createQueryClient(); clients.push(current); return current })
  return <QueryClientProvider client={client}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>
}

describe('shared book save preparation', () => {
  it('recovers a failed session restoration before executing the write', async () => {
    const events: string[] = []
    auth.useAuth.mockReturnValue({ status: 'error', error: new AuthError('restore', 'restore failed'),
      retrySession: async () => { events.push('restore') },
      runAuthenticatedWrite: async (operation: (context: { signal: AbortSignal }) => Promise<Book>, signal: AbortSignal) => {
        events.push('prepare'); return operation({ signal })
      } })
    const write = vi.fn(async (_input: string, _signal: AbortSignal) => { events.push('write'); return book })
    const { result } = renderHook(() => useBookCreation(write, 'manual'), { wrapper })
    await act(async () => { await result.current.save('input') })
    expect(events).toEqual(['restore', 'prepare', 'write'])
  })

  it('does not execute duplicate writes on simultaneous submission', async () => {
    let resolve!: (book: Book) => void
    const write = vi.fn((_input: string, _signal: AbortSignal) => new Promise<Book>((yes) => { resolve = yes }))
    const { result } = renderHook(() => useBookCreation(write, 'manual'), { wrapper })
    await act(async () => {
      const first = result.current.save('input'), second = result.current.save('input')
      await vi.waitFor(() => expect(write).toHaveBeenCalledOnce())
      resolve(book)
      await Promise.all([first, second])
    })
    expect(write).toHaveBeenCalledOnce()
  })

  it('aborts an in-progress write when the search scope changes', async () => {
    let sent: AbortSignal | undefined
    let resolve!: (book: Book) => void
    const write = vi.fn((_input: string, signal: AbortSignal) => { sent = signal; return new Promise<Book>((yes) => { resolve = yes }) })
    const { result, rerender } = renderHook(({ scope }) => useBookCreation(write, scope), { wrapper, initialProps: { scope: 'old' } })
    let pending!: Promise<void>
    await act(async () => { pending = result.current.save('old'); await vi.waitFor(() => expect(sent).toBeDefined()) })
    rerender({ scope: 'new' })
    expect(sent?.aborted).toBe(true)
    await act(async () => { resolve(book); await pending })
    expect(result.current.error).toBeNull()
  })

  it('allows a new search save while an aborted old save settles, without unlocking duplicates', async () => {
    const resolvers = new Map<string, (book: Book) => void>()
    const write = vi.fn((input: string, _signal: AbortSignal) => new Promise<Book>((resolve) => { resolvers.set(input, resolve) }))
    const { result, rerender } = renderHook(({ scope }) => useBookCreation(write, scope), { wrapper, initialProps: { scope: 'old' } })
    let oldSave!: Promise<void>, newSave!: Promise<void>
    await act(async () => { oldSave = result.current.save('old'); await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1)) })
    rerender({ scope: 'new' })
    await act(async () => { newSave = result.current.save('new'); await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2)) })
    await act(async () => { resolvers.get('old')!(book); await oldSave })
    await act(async () => { await result.current.save('duplicate') })
    expect(write).toHaveBeenCalledTimes(2)
    await act(async () => { resolvers.get('new')!(book); await newSave })
  })

  it('does not recover auth or send a write when unmounted before mutation starts', async () => {
    const retrySession = vi.fn(async () => {})
    const runAuthenticatedWrite = vi.fn(async () => book)
    auth.useAuth.mockReturnValue({ status: 'error', error: new AuthError('restore', 'restore failed'), retrySession, runAuthenticatedWrite })
    const write = vi.fn(async (_input: string, _signal: AbortSignal) => book)
    const { result, unmount } = renderHook(() => useBookCreation(write, 'manual'), { wrapper })
    const pending = result.current.save('input')
    unmount()
    await pending
    expect(retrySession).not.toHaveBeenCalled()
    expect(runAuthenticatedWrite).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
  })
})
