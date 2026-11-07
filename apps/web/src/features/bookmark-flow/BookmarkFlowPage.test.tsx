import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import { api } from '../../lib/api/client'
import { HttpError } from '../../lib/api/errors'
import type { components } from '../../lib/api/generated'
import { createQueryClient } from '../../lib/query/client'
import BookmarkFlowPage from './BookmarkFlowPage'

const userId = '9c3d957a-3be2-4cd8-9b9c-fa145ee156e5'
const bookId = '0c3d957a-3be2-4cd8-9b9c-fa145ee156e5'
const viewer = vi.hoisted(() => ({ status: 'guest', userId: null as string | null, canReadPrivate: false }))
vi.mock('../../lib/auth/AuthProvider', () => ({ useAuth: () => viewer }))
const post = (index: number): components['schemas']['BookmarkFlowItem'] => ({
  id: String(index), pageNumber: index % 2 ? null : 100 - index, content: `記録${index}`,
  visibility: index === 0 ? 'private' : 'public', isSpoiler: false, likeCount: 0, replyCount: 0, likedByMe: false,
  createdAt: '2026-11-07T00:00:00Z', updatedAt: '2026-11-07T00:00:00Z',
})
const page = (items: ReturnType<typeof post>[], nextCursor: string | null = null) => ({
  items, nextCursor, author: { id: userId, displayName: '読者', avatarUrl: null },
  book: { id: bookId, title: '本', author: null, isbn13: null, coverUrl: null },
})
const response = <T,>(data: T) => ({ data, response: Response.json(data) })
function show(client = createQueryClient()) {
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/users/${userId}/books/${bookId}/bookmarks`]}>
    <Routes><Route path="/users/:userId/books/:bookId/bookmarks" element={<BookmarkFlowPage />} /></Routes>
  </MemoryRouter></QueryClientProvider>)
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); viewer.status = 'guest'; viewer.userId = null; viewer.canReadPrivate = false })

it('waits for the viewer, preserves API order, and retries the same cursor without dropping the first page', async () => {
  viewer.status = 'loading'
  const first = Array.from({ length: 15 }, (_, index) => post(index))
  const flowResponse = vi.fn().mockResolvedValueOnce(response(page(first, 'next')))
    .mockRejectedValueOnce(new Error('failed')).mockResolvedValueOnce(response(page([post(15)])))
    .mockResolvedValueOnce(response(page([post(1)])))
  const get = vi.spyOn(api, 'GET').mockImplementation((path) => path === '/api/v1/me/preferences'
    ? Promise.resolve(response({ feedContentMode: 'all' })) : flowResponse())
  const client = createQueryClient()
  const initial = show(client)
  expect(get).not.toHaveBeenCalled()
  initial.unmount()
  viewer.status = 'ready'; viewer.userId = userId; viewer.canReadPrivate = true
  const owner = show(client)
  await screen.findByText('記録0')
  fireEvent.click(screen.getByRole('button', { name: 'もっと見る' }))
  await screen.findByText('続きを取得できませんでした。')
  expect(screen.getAllByRole('article', { name: '栞' })).toHaveLength(15)
  fireEvent.click(screen.getByRole('button', { name: 'もう一度試す' }))
  await screen.findByText('記録15')
  const articles = screen.getAllByRole('article', { name: '栞' })
  expect(articles).toHaveLength(16)
  articles.forEach((article, index) => expect(within(article).getByText(`記録${index}`)).toBeTruthy())
  expect(screen.queryByRole('button', { name: 'もっと見る' })).toBeNull()
  expect(get).toHaveBeenLastCalledWith('/api/v1/users/{userId}/books/{bookId}/bookmarks', expect.objectContaining({
    params: { path: { userId, bookId }, query: { limit: 15, cursor: 'next' } },
  }))
  owner.unmount()
  viewer.status = 'guest'; viewer.userId = null; viewer.canReadPrivate = false
  show(client)
  expect(screen.queryByText('記録0')).toBeNull()
  fireEvent.click(await screen.findByRole('button', { name: '本文を表示' }))
  expect(screen.getByText('記録1')).toBeTruthy()
})

it('distinguishes an empty flow from a missing book or reader', async () => {
  vi.spyOn(api, 'GET').mockResolvedValueOnce(response(page([]))).mockRejectedValueOnce(new HttpError(404))
  const empty = show()
  await screen.findByText('表示できる栞はまだありません')
  empty.unmount()
  show()
  await screen.findByText('本または読者が見つかりません')
})
