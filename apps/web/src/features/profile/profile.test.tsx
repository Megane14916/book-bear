import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { api } from '../../lib/api/client'
import { HttpError } from '../../lib/api/errors'
import { createQueryClient } from '../../lib/query/client'
import App from '../../App'

const auth = vi.hoisted(() => ({ userId: '9c3d957a-3be2-4cd8-9b9c-fa145ee156e5' as string | null, status: 'ready', canReadPrivate: true,
  runAuthenticatedWrite: (fn: (context: { signal: AbortSignal; userId: string }) => Promise<unknown>) =>
    fn({ signal: new AbortController().signal, userId: auth.userId! }) }))
vi.mock('../../lib/auth/AuthProvider', () => ({ useAuth: () => auth }))
const profile = { id: auth.userId!, displayName: '読者', bio: null, handle: null, avatarUrl: null, followersCount: 0, followingCount: 0, isAnonymous: true }
const response = <T,>(data: T) => ({ data, response: Response.json(data) })
function show(path: string) {
  return render(<QueryClientProvider client={createQueryClient()}><MemoryRouter initialEntries={[path]}><App /></MemoryRouter></QueryClientProvider>)
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); auth.userId = profile.id; auth.status = 'ready'; auth.canReadPrivate = true })

it('shows a handle conflict in the form and reloads the saved profile', async () => {
  const saved = { ...profile, displayName: '本好き', bio: '読書中', handle: 'book_bear' }
  let current: typeof profile | typeof saved = profile
  vi.spyOn(api, 'GET').mockImplementation(async (path) => {
    if (path === '/api/v1/users/{userId}') return response({ ...current, publicBookmarkCount: 0, followedByMe: false })
    if (path === '/api/v1/users/{userId}/books') return response({ items: [], nextCursor: null })
    if (path === '/api/v1/me') return response(current)
    throw new Error('Unexpected API path')
  })
  const patch = vi.spyOn(api, 'PATCH').mockRejectedValueOnce(new HttpError(409)).mockImplementationOnce(async () => {
    current = saved
    return response(saved)
  })
  const view = show('/me')
  await screen.findByRole('heading', { name: profile.displayName })
  expect(screen.queryByText('公開プロフィール')).toBeNull()
  expect(screen.queryByRole('button', { name: '戻る' })).toBeNull()
  expect(screen.queryByRole('link', { name: /戻る/ })).toBeNull()
  expect(screen.queryByLabelText('表示名')).toBeNull()
  expect(screen.getByRole('link', { name: '設定' }).getAttribute('href')).toBe('/settings')
  expect(screen.queryByRole('link', { name: '自分の本棚' })).toBeNull()
  fireEvent.click(screen.getByRole('link', { name: '編集' }))
  fireEvent.change(await screen.findByLabelText('表示名'), { target: { value: '本好き' } })
  fireEvent.change(screen.getByLabelText('自己紹介'), { target: { value: '読書中' } })
  fireEvent.change(screen.getByLabelText('ハンドル（任意）'), { target: { value: 'book_bear' } })
  fireEvent.click(screen.getByRole('button', { name: 'プロフィールを保存' }))
  await screen.findByText('このハンドルは既に使用されています。')
  fireEvent.click(screen.getByRole('button', { name: 'プロフィールを保存' }))
  await screen.findByText('プロフィールを保存しました。')
  expect(patch.mock.calls[1][1]).toMatchObject({ body: { displayName: '本好き', bio: '読書中', handle: 'book_bear' } })
  fireEvent.click(screen.getByRole('button', { name: '戻る' }))
  await screen.findByRole('heading', { name: saved.displayName })
  view.unmount()
  show('/me/edit')
  for (const value of ['本好き', '読書中', 'book_bear']) expect(await screen.findByDisplayValue(value)).toBeTruthy()
})

it('lets guests page through public books and navigate to the reader’s flow', async () => {
  auth.userId = null; auth.status = 'guest'; auth.canReadPrivate = false
  const book = { id: '0c3d957a-3be2-4cd8-9b9c-fa145ee156e5', title: '公開の本', author: null, isbn13: null, coverUrl: null }
  const secondBook = { ...book, id: '1c3d957a-3be2-4cd8-9b9c-fa145ee156e5', title: '次の本' }
  const get = vi.spyOn(api, 'GET').mockImplementation((path, options) => {
    if (path === '/api/v1/users/{userId}') return Promise.resolve(response({ ...profile, publicBookmarkCount: 2, followedByMe: false }))
    if (path === '/api/v1/users/{userId}/books') {
      const cursor = (options as { params?: { query?: { cursor?: string } } } | undefined)?.params?.query?.cursor
      return Promise.resolve(response(cursor ? { items: [secondBook], nextCursor: null } : { items: [book], nextCursor: 'next' }))
    }
    if (path === '/api/v1/users/{userId}/books/{bookId}/bookmarks') return Promise.resolve(response({ author: profile, book: secondBook, items: [], nextCursor: null }))
    throw new Error('Unexpected API path')
  })
  show(`/users/${profile.id}`)
  await screen.findByRole('link', { name: book.title })
  expect(screen.queryByRole('link', { name: '編集' })).toBeNull()
  expect(screen.queryByRole('link', { name: '設定' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'もっと見る' }))
  fireEvent.click(await screen.findByRole('link', { name: secondBook.title }))
  await screen.findByRole('heading', { name: '栞の流れ' })
  expect(get).not.toHaveBeenCalledWith('/api/v1/me/books', expect.anything())
})
