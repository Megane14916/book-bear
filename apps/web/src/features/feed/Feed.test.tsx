import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { api } from '../../lib/api/client'
import { createQueryClient } from '../../lib/query/client'
import { Feed } from './Feed'

const auth = vi.hoisted(() => ({ status: 'guest', userId: null as string | null, canReadPrivate: false,
  runAuthenticatedWrite: async (fn: (context: { signal: AbortSignal; userId: string }) => Promise<unknown>) =>
    fn({ signal: new AbortController().signal, userId: auth.userId! }) }))
vi.mock('../../lib/auth/AuthProvider', () => ({ useAuth: () => auth }))

const post = (id: string, isSpoiler = false) => ({ id, pageNumber: null, content: `本文${id}`, visibility: 'public' as const,
  isSpoiler, likeCount: 0, replyCount: 0, likedByMe: false, createdAt: '2026-11-07T00:00:00Z', updatedAt: '2026-11-07T00:00:00Z',
  author: { id: 'author', displayName: '読者', avatarUrl: null },
  book: { id: 'book', title: '本', author: null, coverUrl: null, isbn13: null } })
const response = <T,>(data: T) => ({ data, response: Response.json(data) })
function show(client = createQueryClient()) {
  return render(<QueryClientProvider client={client}><MemoryRouter><Feed /></MemoryRouter></QueryClientProvider>)
}
// Use fresh browser-like storage for each test without depending on Node's
// optional global localStorage.
beforeEach(() => {
  const values = new Map<string, string>()
  const storage: Storage = {
    get length() { return values.size },
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, String(value)) },
    removeItem: (key) => { values.delete(key) },
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
  }
  vi.stubGlobal('localStorage', storage)
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); auth.status = 'guest'; auth.userId = null; auth.canReadPrivate = false })

it('keeps pages on an additional-fetch failure, retries the cursor, and persists guest mode without refetching', async () => {
  const get = vi.spyOn(api, 'GET').mockResolvedValueOnce(response({ items: [post('1'), post('spoiler', true)], nextCursor: 'next' }))
    .mockRejectedValueOnce(new Error('failed')).mockResolvedValueOnce(response({ items: [post('2')], nextCursor: null }))
  const view = show()
  await screen.findAllByText('読者')
  expect(screen.queryByText('本文1')).toBeNull()
  fireEvent.click(screen.getByLabelText('すべて表示'))
  expect(screen.getByText('本文1')).toBeTruthy()
  expect(screen.queryByText('本文spoiler')).toBeNull()
  expect(get).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: 'もっと見る' }))
  await screen.findByText('続きを取得できませんでした。')
  expect(screen.getByText('本文1')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'もう一度試す' }))
  await screen.findByText('本文2')
  expect(screen.queryByRole('button', { name: 'もっと見る' })).toBeNull()
  expect((get.mock.calls[2][1] as { params: { query: { cursor: string; limit: number; scope: string } } }).params.query)
    .toEqual({ scope: 'all', limit: 15, cursor: 'next' })
  view.unmount()
  get.mockResolvedValue(response({ items: [post('1')], nextCursor: null }))
  show()
  await screen.findByText('本文1')
})

it('uses the signed-in user preference and updates it without fetching the feed again', async () => {
  auth.status = 'ready'; auth.userId = 'user-a'; auth.canReadPrivate = true
  const get = vi.spyOn(api, 'GET').mockImplementation((path) => Promise.resolve(response(path === '/api/v1/feed'
    ? { items: [post('1')], nextCursor: null } : { feedContentMode: 'tap' })))
  const patch = vi.spyOn(api, 'PATCH').mockResolvedValue(response({ feedContentMode: 'all' as const }))
  const client = createQueryClient()
  show(client)
  await screen.findByText('読者')
  await waitFor(() => expect((screen.getByLabelText('すべて表示') as HTMLInputElement).disabled).toBe(false))
  fireEvent.click(screen.getByLabelText('すべて表示'))
  await screen.findByText('本文1')
  expect(patch).toHaveBeenCalledOnce()
  expect((get.mock.calls as unknown as [string][]).filter(([path]) => path === '/api/v1/feed')).toHaveLength(1)
  auth.userId = 'user-b'
  // A new viewer uses a separate preference query rather than user A's cached mode.
  cleanup()
  show(client)
  await screen.findByText('読者')
  await waitFor(() => expect((screen.getByLabelText('タップして表示') as HTMLInputElement).checked).toBe(true))
})
