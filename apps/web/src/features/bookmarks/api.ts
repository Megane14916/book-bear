import { api } from '../../lib/api/client'
import { ApiError } from '../../lib/api/errors'
import { requestData } from '../../lib/api/result'
import type { components } from '../../lib/api/generated'

export type Bookmark = components['schemas']['BookmarkCard']
export type CreateBookmark = components['schemas']['CreateBookmarkRequest']
export type PatchBookmark = components['schemas']['PatchBookmarkRequest']
export type BookmarkInput = Required<PatchBookmark>

async function required<T>(request: Parameters<typeof requestData<T>>[0]): Promise<T> {
  const data = await requestData(request)
  if (data === null) throw new ApiError('response', '栞の応答がありません。')
  return data
}
export const getBookmark = (bookmarkId: string, signal: AbortSignal) => required(() => api.GET('/api/v1/bookmarks/{bookmarkId}', {
  params: { path: { bookmarkId } }, signal,
}))
export const createBookmark = (body: CreateBookmark, signal: AbortSignal) => required(() => api.POST('/api/v1/bookmarks', { body, signal }))
export const patchBookmark = (bookmarkId: string, body: PatchBookmark, signal: AbortSignal) => required(() => api.PATCH('/api/v1/bookmarks/{bookmarkId}', {
  params: { path: { bookmarkId } }, body, signal,
}))
export const deleteBookmark = (bookmarkId: string, signal: AbortSignal) => requestData(() => api.DELETE('/api/v1/bookmarks/{bookmarkId}', {
  params: { path: { bookmarkId } }, signal,
}))
