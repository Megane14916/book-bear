import { and, desc, eq, exists, isNull, sql } from 'drizzle-orm'
import type { z } from '@hono/zod-openapi'
import type { Database } from '../../db/client'
import { books, bookmarks, userBooks } from '../../db/schema'
import type { Identity } from '../../middleware/auth'
import { ApiError, notFound } from '../../shared/errors'
import { decodeCursor, encodeCursor, olderThan, preciseTimestamp } from '../../shared/cursor'
import { bookSummaryFields, getBook, requireProfile } from '../books/service'
import type { CreateUserBookRequest, PatchUserBookRequest } from './schemas'

const fields = {
  id: userBooks.id, userId: userBooks.userId, book: bookSummaryFields, status: userBooks.status, currentPage: userBooks.currentPage,
  latestBookmarkPage: sql<number | null>`(
    select ${bookmarks.pageNumber} from ${bookmarks}
    where ${bookmarks.userBookId} = ${userBooks.id} and ${bookmarks.deletedAt} is null
    order by ${bookmarks.createdAt} desc, ${bookmarks.id} desc
    limit 1
  )`,
  createdAt: preciseTimestamp(userBooks.createdAt), updatedAt: preciseTimestamp(userBooks.updatedAt),
}
const ownership = (viewer: Identity, id: string) => and(eq(userBooks.id, id), eq(userBooks.userId, viewer.id))
async function getUserBook(db: Database, viewer: Identity, id: string) {
  const [book] = await db.select(fields).from(userBooks).innerJoin(books, eq(books.id, userBooks.bookId)).where(ownership(viewer, id))
  if (!book) throw notFound()
  return book
}
export async function listBooks(db: Database, viewer: Identity, query: { limit: number; cursor?: string }) {
  const boundary = decodeCursor(query.cursor)
  await requireProfile(db, viewer.id)
  const rows = await db.select(fields).from(userBooks).innerJoin(books, eq(books.id, userBooks.bookId))
    .where(and(eq(userBooks.userId, viewer.id), olderThan(userBooks.createdAt, userBooks.id, boundary)))
    .orderBy(desc(userBooks.createdAt), desc(userBooks.id)).limit(query.limit + 1)
  const items = rows.slice(0, query.limit)
  const last = items.at(-1)
  return { items, nextCursor: rows.length > query.limit && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null }
}
export async function createUserBook(db: Database, viewer: Identity, input: z.infer<typeof CreateUserBookRequest>) {
  await requireProfile(db, viewer.id)
  await getBook(db, input.bookId)
  return db.transaction(async (tx) => {
    const [inserted] = await tx.insert(userBooks).values({ ...input, userId: viewer.id })
      .onConflictDoNothing({ target: [userBooks.userId, userBooks.bookId] }).returning({ id: userBooks.id })
    const [existing] = inserted ? [inserted] : await tx.select({ id: userBooks.id }).from(userBooks)
      .where(and(eq(userBooks.userId, viewer.id), eq(userBooks.bookId, input.bookId)))
    if (!existing) throw notFound()
    return { book: await getUserBook(tx, viewer, existing.id), created: !!inserted }
  })
}
export async function patchUserBook(db: Database, viewer: Identity, id: string, patch: z.infer<typeof PatchUserBookRequest>) {
  return db.transaction(async (tx) => {
    const rows = await tx.update(userBooks).set(patch).where(ownership(viewer, id)).returning({ id: userBooks.id })
    if (!rows.length) throw notFound()
    return getUserBook(tx, viewer, id)
  })
}
export async function deleteUserBook(db: Database, viewer: Identity, id: string) {
  try {
    const rows = await db.delete(userBooks).where(ownership(viewer, id)).returning({ id: userBooks.id })
    if (!rows.length) throw notFound()
  } catch (error) {
    const pg = error instanceof Error && error.cause instanceof Error ? error.cause : error
    if (pg && typeof pg === 'object' && 'code' in pg && pg.code === '23503' && 'constraint' in pg
      && pg.constraint === 'bookmarks_user_book_id_user_books_id_fk') throw new ApiError(409, 'HAS_BOOKMARKS', '栞が残っている本棚は削除できません')
    throw error
  }
}
export async function publicBooks(db: Database, userId: string, query: { limit: number; cursor?: string }) {
  const boundary = decodeCursor(query.cursor)
  await requireProfile(db, userId)
  const rows = await db.select({ book: bookSummaryFields, id: userBooks.id, createdAt: preciseTimestamp(userBooks.createdAt) })
    .from(userBooks).innerJoin(books, eq(books.id, userBooks.bookId))
    .where(and(eq(userBooks.userId, userId), olderThan(userBooks.createdAt, userBooks.id, boundary),
      exists(db.select({ id: bookmarks.id }).from(bookmarks).where(and(eq(bookmarks.userBookId, userBooks.id), eq(bookmarks.visibility, 'public'), isNull(bookmarks.deletedAt))))))
    .orderBy(desc(userBooks.createdAt), desc(userBooks.id)).limit(query.limit + 1)
  const page = rows.slice(0, query.limit), last = page.at(-1)
  return { items: page.map((row) => row.book), nextCursor: rows.length > query.limit && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null }
}
