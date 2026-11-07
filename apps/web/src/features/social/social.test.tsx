import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import App from '../../App'
import { api } from '../../lib/api/client'
import { HttpError } from '../../lib/api/errors'
import type { components } from '../../lib/api/generated'
import { createQueryClient } from '../../lib/query/client'

const auth = vi.hoisted(() => ({ status: 'ready', userId: '9c3d957a-3be2-4cd8-9b9c-fa145ee156e5', isAnonymous: false, canReadPrivate: true,
  runAuthenticatedWrite: (write: (context: { signal: AbortSignal; userId: string }) => Promise<unknown>) =>
    write({ signal: new AbortController().signal, userId: auth.userId }) }))
vi.mock('../../lib/auth/AuthProvider', () => ({ useAuth: () => auth }))
const owner = { id: auth.userId, displayName: '自分', avatarUrl: null }
const other = { ...owner, id: '0c3d957a-3be2-4cd8-9b9c-fa145ee156e5', displayName: '他の読者' }
const bookmark: components['schemas']['BookmarkCard'] = {
  id: '1c3d957a-3be2-4cd8-9b9c-fa145ee156e5', author: other, book: { id: 'book', title: '本', author: null, isbn13: null, coverUrl: null },
  pageNumber: null, content: '共有されない栞本文', isSpoiler: false, visibility: 'public',
  likeCount: 0, replyCount: 0, likedByMe: false, createdAt: '2026-11-07T00:00:00Z', updatedAt: '2026-11-07T00:00:00Z',
}
const reply: components['schemas']['Reply'] = {
  id: 'reply', author: other, content: 'ネタバレ返信本文', isSpoiler: true, createdAt: bookmark.createdAt, updatedAt: bookmark.updatedAt,
}
const response = <T,>(data: T) => ({ data, response: Response.json(data) })
const noContent = () => ({ data: undefined, response: new Response(null, { status: 204 }) })
const show = (path: string) => render(<QueryClientProvider client={createQueryClient()}><MemoryRouter initialEntries={[path]}><App /></MemoryRouter></QueryClientProvider>)
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }))
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); auth.isAnonymous = false })

it('keeps like state on failure and synchronizes reply and like counts after successful writes', async () => {
  let liked = false
  let replies = [reply]
  const own = { ...reply, id: 'mine', author: owner, content: '自分の返信', isSpoiler: false }
  vi.spyOn(api, 'GET').mockImplementation(async (path) => {
    if (path === '/api/v1/bookmarks/{bookmarkId}/replies') return response({ items: replies, nextCursor: null })
    return response({ ...bookmark, likedByMe: liked, likeCount: Number(liked), replyCount: replies.length })
  })
  vi.spyOn(api, 'PUT').mockRejectedValueOnce(new HttpError(403)).mockImplementation(async () => { liked = true; return noContent() })
  vi.spyOn(api, 'POST').mockImplementation(async () => { replies = [reply, own]; return response(own) })
  vi.spyOn(api, 'PATCH').mockImplementation(async () => {
    const edited = { ...own, content: '編集済みの返信' }
    replies = [reply, edited]
    return response(edited)
  })
  vi.spyOn(api, 'DELETE').mockImplementation(async (path) => {
    if (path === '/api/v1/replies/{replyId}') replies = [reply]
    else liked = false
    return noContent()
  })
  show(`/bookmarks/${bookmark.id}`)
  fireEvent.click(await screen.findByRole('button', { name: 'いいね（0）' }))
  await screen.findByText('この操作にはGoogleでの登録とログインが必要です。')
  expect(screen.getByRole('button', { name: 'いいね（0）' }).getAttribute('aria-pressed')).toBe('false')
  click('いいね（0）')
  fireEvent.click(await screen.findByRole('button', { name: 'いいねを解除（1）' }))
  await screen.findByRole('button', { name: 'いいね（0）' })
  const otherReply = screen.getByRole('article', { name: '返信' })
  expect(within(otherReply).queryByText(reply.content)).toBeNull()
  expect(within(otherReply).queryByRole('button', { name: '返信を編集' })).toBeNull()
  fireEvent.change(screen.getByLabelText('返信本文（1,000文字以内）'), { target: { value: own.content } })
  click('返信を投稿')
  await screen.findByText('返信 2')
  fireEvent.click(await screen.findByRole('button', { name: '返信を編集' }))
  fireEvent.change(screen.getByDisplayValue(own.content), { target: { value: '編集済みの返信' } })
  click('返信を保存')
  await screen.findByText('編集済みの返信')
  click('返信を削除')
  click('返信を削除する')
  await screen.findByText('返信 1')
  expect(screen.queryByText('編集済みの返信')).toBeNull()
})

it('links an updated follower count to the public relationship list and forwards its cursor', async () => {
  let followed = false
  const get = vi.spyOn(api, 'GET').mockImplementation(async (path, options) => {
    if (path === '/api/v1/me/preferences') return response({ feedContentMode: 'all' })
    if (path === '/api/v1/feed') {
      const input = options as { params: { query: { scope: string } } }
      return response({ items: input.params.query.scope === 'following' && followed ? [bookmark] : [], nextCursor: null })
    }
    if (path === '/api/v1/users/{userId}/books') return response({ items: [], nextCursor: null })
    if (path === '/api/v1/users/{userId}/followers') {
      const input = options as { params: { query: { cursor?: string } } }
      return response(input.params.query.cursor ? { items: [{ ...other, id: 'next', displayName: '次の読者' }], nextCursor: null } :
        { items: followed ? [owner] : [], nextCursor: 'next' })
    }
    return response({ ...other, bio: null, handle: null, followingCount: 0, followersCount: Number(followed), followedByMe: followed, publicBookmarkCount: 0 })
  })
  vi.spyOn(api, 'PUT').mockImplementation(async () => { followed = true; return noContent() })
  show(`/users/${other.id}`)
  fireEvent.click(await screen.findByRole('button', { name: 'フォローする' }))
  fireEvent.click(await screen.findByRole('link', { name: 'フォロワー 1人' }))
  await screen.findByRole('link', { name: owner.displayName })
  click('もっと見る')
  await screen.findByRole('link', { name: '次の読者' })
  expect(get).toHaveBeenCalledWith('/api/v1/users/{userId}/followers', expect.objectContaining({ params: { path: { userId: other.id }, query: { cursor: 'next', limit: 15 } } }))
  fireEvent.click(screen.getByRole('link', { name: 'ホーム' }))
  click('フォロー中')
  await screen.findByText(bookmark.content)
  expect(get).toHaveBeenCalledWith('/api/v1/feed', expect.objectContaining({ params: { query: { scope: 'following', limit: 15, cursor: undefined } } }))
})

it('offers Google linking to an anonymous reader and shares only the public URL', async () => {
  auth.isAnonymous = true
  const get = vi.spyOn(api, 'GET').mockImplementation(async (path) => path === '/api/v1/bookmarks/{bookmarkId}/replies' ?
    response({ items: [], nextCursor: null }) : response(bookmark))
  const put = vi.spyOn(api, 'PUT')
  const copy = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('navigator', { clipboard: { writeText: copy } })
  const view = show(`/bookmarks/${bookmark.id}`)
  const like = await screen.findByRole('button', { name: 'いいね（0）' })
  fireEvent.click(like)
  expect(within(like.parentElement!).getByRole('button', { name: 'Googleアカウントを連携' })).toBeTruthy()
  expect(put).not.toHaveBeenCalled()
  click('URLをコピー')
  await screen.findByText('URLをコピーしました。')
  const expected = new URL(`/bookmarks/${bookmark.id}`, window.location.origin).href
  expect(copy).toHaveBeenCalledWith(expected)
  const share = new URL(screen.getByRole('link', { name: 'Xで共有' }).getAttribute('href')!)
  expect([...share.searchParams.entries()]).toEqual([['url', expected]])
  view.unmount()
  get.mockResolvedValue(response({ ...bookmark, author: owner, visibility: 'private' }))
  show(`/bookmarks/${bookmark.id}`)
  await screen.findByText('非公開')
  expect(screen.queryByRole('link', { name: 'Xで共有' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'いいね（0）' })).toBeNull()
})
