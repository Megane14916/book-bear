import { z } from '@hono/zod-openapi'
import { Isbn13, type BookProvider } from '../modules/books/schemas'
import { ApiError } from '../shared/errors'

export type ProviderBook = {
  provider: z.infer<typeof BookProvider>; providerId: string; isbn13: string | null
  title: string; author: string | null; publisher: string | null; coverUrl: string | null; totalPages: number | null
}
export const providerUnavailable = () => new ApiError(502, 'BOOK_PROVIDER_UNAVAILABLE', '書籍情報サービスを利用できません')
const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null
const isbn = (value: unknown) => {
  const parsed = Isbn13.safeParse(typeof value === 'string' ? value.replace(/[\s-]/g, '') : value)
  return parsed.success ? parsed.data : null
}
const pages = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 2147483647 ? value : null
const cover = (value: unknown) => {
  try { const url = new URL(String(value)); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null } catch { return null }
}
const GoogleVolume = z.object({
  id: z.string().trim().min(1), volumeInfo: z.object({
    title: z.string().trim().min(1), authors: z.array(z.string()).optional(), publisher: z.unknown().optional(),
    industryIdentifiers: z.array(z.object({ type: z.string(), identifier: z.string() })).optional(),
    pageCount: z.unknown().optional(), imageLinks: z.object({ thumbnail: z.unknown().optional(), smallThumbnail: z.unknown().optional() }).optional(),
  }),
})
function googleBook(value: unknown): ProviderBook | null {
  const parsed = GoogleVolume.safeParse(value)
  if (!parsed.success) return null
  const { id, volumeInfo: info } = parsed.data
  return {
    provider: 'google_books', providerId: id, title: info.title,
    isbn13: info.industryIdentifiers?.filter((item) => item.type === 'ISBN_13').map((item) => isbn(item.identifier)).find(Boolean) ?? null,
    author: text(info.authors?.join(', ')), publisher: text(info.publisher), totalPages: pages(info.pageCount),
    coverUrl: cover(info.imageLinks?.thumbnail ?? info.imageLinks?.smallThumbnail),
  }
}
const OpenBdBook = z.object({ summary: z.object({ isbn: z.string(), title: z.string().trim().min(1), author: z.unknown().optional(), publisher: z.unknown().optional(), cover: z.unknown().optional() }) })

export function createBookProvider(fetcher: typeof fetch = fetch, apiKey?: string) {
  async function get(url: URL): Promise<unknown | null> {
    try {
      const response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(5000) })
      if (response.status === 404) return null
      if (!response.ok) throw providerUnavailable()
      return await response.json()
    } catch { throw providerUnavailable() }
  }
  function googleUrl(path: string) {
    if (!apiKey?.trim()) throw providerUnavailable()
    const url = new URL(`https://www.googleapis.com/books/v1/${path}`)
    url.searchParams.set('key', apiKey)
    return url
  }
  async function googleSearch(q: string, limit: number) {
    const url = googleUrl('volumes')
    url.searchParams.set('q', q)
    url.searchParams.set('maxResults', String(limit))
    const result = await get(url)
    const parsed = z.object({ totalItems: z.number().int().nonnegative(), items: z.array(z.unknown()).optional() }).safeParse(result)
    if (!parsed.success || (parsed.data.totalItems > 0 && !parsed.data.items)) throw providerUnavailable()
    return (parsed.data.items ?? []).map(googleBook).filter((item): item is ProviderBook => item !== null)
  }
  async function openbd(id: string): Promise<ProviderBook | null> {
    const url = new URL('https://api.openbd.jp/v1/get')
    url.searchParams.set('isbn', id)
    const result = await get(url)
    if (result === null) return null
    if (!Array.isArray(result) || result.length !== 1) throw providerUnavailable()
    if (result[0] === null) return null
    const parsed = OpenBdBook.safeParse(result[0])
    if (!parsed.success || isbn(parsed.data.summary.isbn) !== id) throw providerUnavailable()
    const info = parsed.data.summary
    return { provider: 'openbd', providerId: id, isbn13: id, title: info.title, author: text(info.author), publisher: text(info.publisher), coverUrl: cover(info.cover), totalPages: null }
  }
  return {
    async search(q: string, limit: number, isbn13?: string): Promise<ProviderBook[]> {
      if (!isbn13) return googleSearch(q, limit)
      const book = await openbd(isbn13)
      if (book) return [book]
      return (await googleSearch(`isbn:${isbn13}`, limit)).filter((item) => item.isbn13 === isbn13)
    },
    async find(provider: ProviderBook['provider'], id: string): Promise<ProviderBook | null> {
      if (provider === 'openbd') return openbd(id)
      // Never allow dot segments to turn a volume ID into a different endpoint.
      if (id === '.' || id === '..') throw new ApiError(400, 'VALIDATION_ERROR', '書籍IDを確認してください')
      const result = await get(googleUrl(`volumes/${encodeURIComponent(id)}`))
      if (result === null) return null
      const book = googleBook(result)
      if (!book || book.providerId !== id) throw providerUnavailable()
      return book
    },
  }
}
export type BookProviderClient = ReturnType<typeof createBookProvider>
