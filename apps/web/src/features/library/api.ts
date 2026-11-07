import { api } from '../../lib/api/client'
import { ApiError } from '../../lib/api/errors'
import { requestData } from '../../lib/api/result'

export async function addToLibrary(bookId: string, signal: AbortSignal) {
  const item = await requestData(() => api.POST('/api/v1/me/books', { body: { bookId }, signal }))
  if (!item) throw new ApiError('response', '本棚登録の応答がありません。')
  return item
}

// Both consumers must use infinite pages with the same query key/data shape.
export async function getLibraryPage(cursor: string | undefined, signal: AbortSignal) {
  const page = await requestData(() => api.GET('/api/v1/me/books', {
    params: { query: { limit: 15, ...(cursor ? { cursor } : {}) } }, signal,
  }))
  if (!page) throw new ApiError('response', '本棚の応答がありません。')
  return page
}
