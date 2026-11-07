import { afterEach, expect, it, vi } from 'vitest'
import { api } from '../../lib/api/client'
import { createBookmark, deleteBookmark, getBookmark, patchBookmark } from './api'

vi.mock('../../lib/api/client', () => ({ api: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), DELETE: vi.fn() } }))
afterEach(() => vi.resetAllMocks())
it('uses generated API endpoints, caller cancellation and the separate userBookId', async () => {
  const signal = new AbortController().signal
  const body = { userBookId: 'shelf-id', content: '本文', visibility: 'private' as const, isSpoiler: false }
  vi.mocked(api.POST).mockResolvedValue({ data: { id: 'bookmark-id' }, response: new Response(null, { status: 201 }) } as never)
  expect(await createBookmark(body, signal)).toEqual({ id: 'bookmark-id' })
  expect(api.POST).toHaveBeenCalledWith('/api/v1/bookmarks', { body, signal })
  vi.mocked(api.GET).mockResolvedValue({ data: { id: 'bookmark-id' }, response: new Response() } as never)
  await getBookmark('bookmark-id', signal)
  expect(api.GET).toHaveBeenCalledWith('/api/v1/bookmarks/{bookmarkId}', { params: { path: { bookmarkId: 'bookmark-id' } }, signal })
  vi.mocked(api.PATCH).mockResolvedValue({ data: { content: '修正' }, response: new Response() } as never)
  await patchBookmark('bookmark-id', { content: '修正' }, signal)
  expect(api.PATCH).toHaveBeenCalledWith('/api/v1/bookmarks/{bookmarkId}', { params: { path: { bookmarkId: 'bookmark-id' } }, body: { content: '修正' }, signal })
})
it('accepts DELETE 204 without a JSON body', async () => {
  const signal = new AbortController().signal
  vi.mocked(api.DELETE).mockResolvedValue({ data: undefined, response: new Response(null, { status: 204 }) } as never)
  expect(await deleteBookmark('bookmark-id', signal)).toBeNull()
})
it('rejects an unexpectedly empty success response for writes that require a card', async () => {
  vi.mocked(api.PATCH).mockResolvedValue({ data: undefined, response: new Response(null, { status: 204 }) } as never)
  await expect(patchBookmark('bookmark-id', { content: '修正' }, new AbortController().signal)).rejects.toThrow('栞の応答がありません')
})
