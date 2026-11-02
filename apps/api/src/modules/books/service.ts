import { asc, eq, ilike, inArray, or } from 'drizzle-orm'
import type { z } from '@hono/zod-openapi'
import type { Database, DatabaseBindings, withDatabase } from '../../db/client'
import { books, profiles } from '../../db/schema'
import type { Identity } from '../../middleware/auth'
import type { BookProviderClient } from '../../integrations/books'
import { ApiError, notFound } from '../../shared/errors'
import { Isbn13, type BookSearchItem, type ImportBookRequest, type ManualBookRequest } from './schemas'

export const bookSummaryFields = { id: books.id, isbn13: books.isbn13, title: books.title, author: books.author, coverUrl: books.coverUrl }
const bookFields = { ...bookSummaryFields, publisher: books.publisher, totalPages: books.totalPages, source: books.source }
export async function requireProfile(db: Database, userId: string) {
  if (!(await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.id, userId)).limit(1)).length) throw notFound()
}
export async function getBook(db: Database, id: string) {
  const [book] = await db.select(bookFields).from(books).where(eq(books.id, id))
  if (!book) throw notFound()
  return book
}
const localCandidate = (book: typeof books.$inferSelect): z.infer<typeof BookSearchItem> => ({
  localBookId: book.id, isbn13: book.isbn13, title: book.title, author: book.author, coverUrl: book.coverUrl,
  totalPages: book.totalPages, provider: book.source === 'manual' ? null : book.source, providerId: book.sourceId,
})
export async function searchBooks(database: typeof withDatabase, env: DatabaseBindings, query: { q: string; limit: number }, provider: BookProviderClient) {
  const normalized = query.q.replace(/[\s-]/g, '')
  const looksLikeIsbn = /^\d[\d\s-]*$/.test(query.q) && normalized.length >= 10
  if (looksLikeIsbn && !Isbn13.safeParse(normalized).success) throw new ApiError(400, 'VALIDATION_ERROR', '有効なISBN-13を指定してください')
  const isbn13 = Isbn13.safeParse(normalized).success ? normalized : undefined
  const pattern = `%${query.q.replace(/[\\%_]/g, '\\$&')}%`
  const local = await database(env, (db) => db.select().from(books).where(isbn13 ? eq(books.isbn13, isbn13) : or(ilike(books.title, pattern), ilike(books.author, pattern)))
    .orderBy(asc(books.title), asc(books.id)).limit(query.limit))
  if (local.length >= query.limit || (isbn13 && local.length)) return { items: local.map(localCandidate) }
  let external
  try { external = await provider.search(query.q, query.limit, isbn13) } catch (error) {
    if (!(error instanceof ApiError) || error.code !== 'BOOK_PROVIDER_UNAVAILABLE') throw error
    if (local.length) return { items: local.map(localCandidate) }
    throw error
  }
  const isbns = external.flatMap((item) => item.isbn13 ? [item.isbn13] : [])
  const registered = isbns.length ? await database(env, (db) => db.select().from(books).where(inArray(books.isbn13, isbns))) : []
  const byIsbn = new Map(registered.map((book) => [book.isbn13, book]))
  const items = local.map(localCandidate)
  const seen = new Set(items.filter((item) => item.isbn13).map((item) => item.isbn13!))
  const externalIds = new Set<string>()
  for (const book of external) {
    const key = `${book.provider}:${book.providerId}`
    if (book.isbn13 ? seen.has(book.isbn13) : externalIds.has(key)) continue
    if (book.isbn13) seen.add(book.isbn13)
    externalIds.add(key)
    const existing = book.isbn13 ? byIsbn.get(book.isbn13) : undefined
    items.push(existing ? localCandidate(existing) : {
      localBookId: null, provider: book.provider, providerId: book.providerId, isbn13: book.isbn13,
      title: book.title, author: book.author, coverUrl: book.coverUrl, totalPages: book.totalPages,
    })
  }
  return { items: items.slice(0, query.limit) }
}
export async function importBook(database: typeof withDatabase, env: DatabaseBindings, viewer: Identity, input: z.infer<typeof ImportBookRequest>, provider: BookProviderClient) {
  await database(env, (db) => requireProfile(db, viewer.id))
  const candidate = await provider.find(input.provider, input.providerId)
  if (!candidate) throw notFound()
  const { provider: source, providerId: sourceId, ...data } = candidate
  return database(env, async (db) => {
    const [created] = await db.insert(books).values({ ...data, source, sourceId }).onConflictDoNothing({ target: books.isbn13 }).returning(bookFields)
    if (created) return { book: created, created: true }
    const [existing] = await db.select(bookFields).from(books).where(eq(books.isbn13, data.isbn13!))
    if (!existing) throw notFound()
    return { book: existing, created: false }
  })
}
export async function manualBook(db: Database, viewer: Identity, input: z.infer<typeof ManualBookRequest>) {
  await requireProfile(db, viewer.id)
  const [book] = await db.insert(books).values({ ...input, source: 'manual', createdByUserId: viewer.id }).returning(bookFields)
  return book
}
