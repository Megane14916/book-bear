import { z } from 'zod'
import { normalizeIsbn, toIsbn10 } from './isbn'

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const work = z.object({
  key: z.string().regex(/^(?:\/works\/)?OL\d+W$/), title: z.string().trim().min(1),
  author_name: z.array(z.string()).optional(), isbn: z.array(z.string()),
  readinglog_count: count.nullish(), ratings_count: count.nullish(),
  editions: z.object({ docs: z.array(z.object({ title: z.string().optional(), isbn: z.array(z.string()).optional() })) }).optional(),
})
const result = z.object({ numFound: count.optional(), num_found: count.optional(), docs: z.array(z.unknown()) })
export const openLibraryLimit = 40
const resultLimit = 100

export type OpenLibraryWork = {
  id: string; title: string; authors: string[]; editionTitles: string[]; isbn13: string
  readinglogCount: number | null; ratingsCount: number | null
}

export async function lookupOpenLibrary(isbns: string[], userAgent?: string, fetcher: typeof fetch = fetch) {
  const requested = new Set(isbns.map(normalizeIsbn).filter((id): id is string => id !== null))
  if (requested.size > openLibraryLimit) throw new Error('Open Library batch limit exceeded')
  const works = new Map<string, OpenLibraryWork[]>()
  if (!requested.size) return { calls: 0, status: 'skipped' as const, works }
  const terms = [...requested].flatMap((id) => [id, toIsbn10(id)].filter(Boolean))
  const url = new URL('https://openlibrary.org/search.json')
  url.search = new URLSearchParams({ q: `isbn:(${terms.join(' OR ')})`, limit: String(resultLimit),
    fields: 'key,title,author_name,isbn,readinglog_count,ratings_count,editions,editions.title,editions.isbn',
  }).toString()
  try {
    const response = await fetcher(url, { signal: AbortSignal.timeout(5000), redirect: 'error',
      headers: userAgent ? { 'User-Agent': userAgent } : undefined })
    if (!response.ok) return { calls: 1, status: response.status === 429 ? 'rate-limited' as const : 'unavailable' as const, works }
    const parsed = result.safeParse(await response.json())
    if (!parsed.success) return { calls: 1, status: 'invalid-response' as const, works }
    const total = parsed.data.numFound ?? parsed.data.num_found ?? parsed.data.docs.length
    if (total > parsed.data.docs.length || parsed.data.docs.length > resultLimit) return { calls: 1, status: 'truncated' as const, works }
    for (const row of parsed.data.docs) {
      const entry = work.safeParse(row)
      if (!entry.success) continue
      const book = entry.data
      const matched = new Set(book.isbn.map(normalizeIsbn).filter((id): id is string => id !== null && requested.has(id)))
      for (const isbn13 of matched) {
        const editionTitles = (book.editions?.docs ?? []).flatMap(({ title, isbn }) =>
          title && isbn?.some((id) => normalizeIsbn(id) === isbn13) ? [title] : [])
        const matches = works.get(isbn13) ?? []
        matches.push({ id: book.key.split('/').at(-1)!, title: book.title, authors: book.author_name ?? [], editionTitles,
          isbn13, readinglogCount: book.readinglog_count ?? null, ratingsCount: book.ratings_count ?? null })
        works.set(isbn13, matches)
      }
    }
    return { calls: 1, status: 'ok' as const, works }
  } catch {
    return { calls: 1, status: 'unavailable' as const, works }
  }
}
