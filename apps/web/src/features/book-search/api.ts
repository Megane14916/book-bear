import { api } from '../../lib/api/client'
import { ApiError } from '../../lib/api/errors'
import { requestData } from '../../lib/api/result'
import type { components } from '../../lib/api/generated'

export type SearchBook = components['schemas']['BookSearchItem']
export type Book = components['schemas']['Book']
export type ImportBookInput = components['schemas']['ImportBookRequest']
export type ManualBookInput = components['schemas']['ManualBookRequest']

async function required<T>(request: Parameters<typeof requestData<T>>[0]): Promise<T> {
  const data = await requestData(request)
  if (data === null) throw new ApiError('response', '書籍APIから必要なデータを取得できませんでした。')
  return data
}
export const searchBooks = (q: string, signal?: AbortSignal) => required(() => api.GET('/api/v1/books/search', {
  params: { query: { q: q.trim(), limit: 20 } }, signal,
}))
export const getBook = (bookId: string, signal?: AbortSignal) => required(() => api.GET('/api/v1/books/{bookId}', {
  params: { path: { bookId } }, signal,
}))
export const importBook = (body: ImportBookInput, signal: AbortSignal) => required(() => api.POST('/api/v1/books/import', { body, signal }))
export const createManualBook = (body: ManualBookInput, signal: AbortSignal) => required(() => api.POST('/api/v1/books/manual', { body, signal }))

export function externalIdentity(book: SearchBook): ImportBookInput | null {
  if (book.localBookId !== null || book.provider === null || !book.providerId?.trim()) return null
  return { provider: book.provider, providerId: book.providerId }
}
