import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { api } from '../../lib/api/client'
import { PublicBookPreview } from './PublicBookPreview'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
it('defers public books, paginates using the public endpoint only, and links to book detail', async () => {
  vi.stubGlobal('IntersectionObserver', undefined)
  const get = vi.spyOn(api, 'GET').mockResolvedValueOnce({ data: { items: [{ id: 'book', title: '公開した本', author: null, coverUrl: null, isbn13: null }], nextCursor: 'next' }, response: new Response() } as never)
    .mockResolvedValueOnce({ data: { items: [], nextCursor: null }, response: new Response() } as never)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><MemoryRouter><PublicBookPreview userId="reader" /></MemoryRouter></QueryClientProvider>)
  expect(get).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '公開した本を見る' }))
  expect((await screen.findByRole('link', { name: '書籍詳細：公開した本' })).getAttribute('href')).toBe('/books/book')
  fireEvent.click(screen.getByRole('button', { name: '本の続きを見る' }))
  await waitFor(() => expect(get).toHaveBeenCalledTimes(2))
  await screen.findByRole('link', { name: '書籍詳細：公開した本' })
  expect(get).toHaveBeenCalledWith('/api/v1/users/{userId}/books', expect.objectContaining({ params: { path: { userId: 'reader' }, query: { limit: 6, cursor: undefined } } }))
  // No /me/books or private bookshelf request is made for this reader.
  expect((get.mock.calls as unknown as [string, unknown][]).every(([path]) => path === '/api/v1/users/{userId}/books')).toBe(true)
  client.clear()
})
