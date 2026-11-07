import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { api } from '../../lib/api/client'
import { createQueryClient } from '../../lib/query/client'
import BookSearchPage from '../../pages/BookSearchPage'

vi.mock('../../lib/auth/AuthProvider', () => ({ useAuth: () => ({ status: 'guest', userId: null }) }))
const book = { id: 'book', title: '検索対象の本', author: null, coverUrl: null, isbn13: '9784101010014' }
const bookResult = { ...book, localBookId: book.id, provider: null, providerId: null, totalPages: null }
const reader = { id: 'reader', displayName: '検索対象の読者', avatarUrl: null, handle: 'reader' }
const post = { id: 'post', book, author: reader, content: '検索対象のネタバレ本文', pageNumber: null, visibility: 'public',
  isSpoiler: true, likeCount: 0, replyCount: 0, likedByMe: false, createdAt: '2026-11-07T00:00:00Z', updatedAt: '2026-11-07T00:00:00Z' }
const response = <T,>(data: T) => ({ data, response: Response.json(data) })
function show(query = '') {
  return render(<QueryClientProvider client={createQueryClient()}><MemoryRouter initialEntries={[`/search${query}`]}><BookSearchPage /></MemoryRouter></QueryClientProvider>)
}
const button = (name: string) => screen.getByRole('button', { name })
const field = () => screen.getByRole('searchbox') as HTMLInputElement
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('keeps results separate for the same term and pages only public bookmark search', async () => {
  const get = vi.spyOn(api, 'GET').mockImplementation(async (path, options) => {
    if (path === '/api/v1/books/search') return response({ items: [bookResult] })
    if (path === '/api/v1/search/users') return response({ items: [reader], nextCursor: null })
    const cursor = (options as { params: { query: { cursor?: string } } }).params.query.cursor
    return response(cursor ? { items: [{ ...post, id: 'second-post', content: '次の栞', isSpoiler: false }], nextCursor: null } :
      { items: [post], nextCursor: 'next' })
  })
  show('?q=検索対象')
  expect((await screen.findByRole('link', { name: '詳細を見る' })).getAttribute('href')).toBe('/books/book')
  const tabs = within(screen.getByRole('navigation', { name: '検索対象' }))
  fireEvent.click(tabs.getByRole('link', { name: '栞' }))
  const first = await screen.findByRole('article', { name: '栞' })
  expect(within(first).queryByText(post.content)).toBeNull()
  expect(first.querySelector('a[href="/bookmarks/post"]')).toBeTruthy()
  fireEvent.click(button('もっと見る'))
  await screen.findByText('次の栞')
  expect(screen.getAllByRole('article', { name: '栞' })).toHaveLength(2)
  fireEvent.click(tabs.getByRole('link', { name: 'ユーザー' }))
  expect((await screen.findByRole('link', { name: /検索対象の読者/ })).getAttribute('href')).toBe('/users/reader')
  expect(screen.queryByRole('article', { name: '栞' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'もっと見る' })).toBeNull()
  expect(field().value).toBe('検索対象')
  expect(get).toHaveBeenCalledWith('/api/v1/search/posts', expect.objectContaining({ params: { query: { q: '検索対象', limit: 15, cursor: 'next' } } }))
  expect(get).toHaveBeenCalledWith('/api/v1/search/users', expect.objectContaining({ params: { query: { q: '検索対象', limit: 30 } } }))
})

function stubCamera(getUserMedia: () => Promise<unknown>, detect = vi.fn()) {
  class BarcodeDetector {
    static async getSupportedFormats() { return ['ean_13'] }
    detect = detect
  }
  vi.stubGlobal('BarcodeDetector', BarcodeDetector)
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockReturnValue(HTMLMediaElement.HAVE_CURRENT_DATA)
}

it('starts only on request, skips non-ISBN codes and stops the camera after submitting a valid ISBN', async () => {
  const stop = vi.fn()
  const camera = vi.fn(async () => ({ getTracks: () => [{ stop }] }))
  const detect = vi.fn(async () => [{ rawValue: '4912345678904' }, { rawValue: '9784101010015' }, { rawValue: book.isbn13 }])
  stubCamera(camera, detect)
  const get = vi.spyOn(api, 'GET').mockResolvedValue(response({ items: [bookResult] }))
  show()
  expect(camera).not.toHaveBeenCalled()
  expect(get).not.toHaveBeenCalled()
  fireEvent.click(button('ISBNバーコードを読み取る'))
  await screen.findByRole('link', { name: '詳細を見る' })
  expect(stop).toHaveBeenCalledOnce()
  expect(field().value).toBe(book.isbn13)
  expect(get).toHaveBeenCalledWith('/api/v1/books/search', expect.objectContaining({ params: { query: { q: book.isbn13, limit: 20 } } }))
})

it('stops a stream that arrives after cancellation and keeps manual search available', async () => {
  const stop = vi.fn()
  let resolveCamera!: (camera: unknown) => void
  const camera = vi.fn(() => new Promise((resolve) => { resolveCamera = resolve }))
  stubCamera(camera)
  const get = vi.spyOn(api, 'GET').mockResolvedValue(response({ items: [] }))
  show()
  fireEvent.click(button('ISBNバーコードを読み取る'))
  await waitFor(() => expect(camera).toHaveBeenCalledOnce())
  fireEvent.click(button('読み取りを中止'))
  resolveCamera({ getTracks: () => [{ stop }] })
  await waitFor(() => expect(stop).toHaveBeenCalledOnce())
  expect(document.activeElement).toBe(field())
  fireEvent.change(field(), { target: { value: book.isbn13 } })
  fireEvent.click(button('検索する'))
  await screen.findByText('本が見つかりませんでした')
  expect(get).toHaveBeenCalledOnce()
})

it('falls back to manual input when camera permission is denied', async () => {
  stubCamera(vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError')))
  show()
  fireEvent.click(button('ISBNバーコードを読み取る'))
  expect((await screen.findByRole('alert')).textContent).toContain('カメラの利用が許可されませんでした。')
  expect(document.activeElement).toBe(field())
})
