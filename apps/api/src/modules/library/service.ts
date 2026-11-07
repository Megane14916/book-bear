import { and, asc, desc, eq, exists, isNull, sql } from 'drizzle-orm'
import { z } from '@hono/zod-openapi'
import type { Database } from '../../db/client'
import { books, bookmarks, userBooks } from '../../db/schema'
import type { Identity } from '../../middleware/auth'
import { ApiError, notFound } from '../../shared/errors'
import { cursorBoundarySchema, decodeCursor, encodeCursor, newerThan, olderThan, preciseTimestamp } from '../../shared/cursor'
import { bookSummaryFields, getBook, requireProfile } from '../books/service'
import type { CreateUserBookRequest, LibrarySort, PatchUserBookRequest, ReadingStatus } from './schemas'

const fields = {
  id: userBooks.id, userId: userBooks.userId, book: bookSummaryFields, status: userBooks.status, currentPage: userBooks.currentPage,
  createdAt: preciseTimestamp(userBooks.createdAt), updatedAt: preciseTimestamp(userBooks.updatedAt),
}
const ownership = (viewer: Identity, id: string) => and(eq(userBooks.id, id), eq(userBooks.userId, viewer.id))
const latestBookmark = (db: Database) => db.select({ pageNumber: bookmarks.pageNumber, createdAt: bookmarks.createdAt })
  .from(bookmarks).where(and(eq(bookmarks.userBookId, userBooks.id), isNull(bookmarks.deletedAt)))
  .orderBy(desc(bookmarks.createdAt), desc(bookmarks.id)).limit(1).as('latest_bookmark')
const readingBoundarySchema = cursorBoundarySchema.extend({ hasBookmark: z.boolean() })

async function getUserBook(db: Database, viewer: Identity, id: string) {
  const latest = latestBookmark(db)
  const [book] = await db.select({ ...fields, latestBookmarkPage: latest.pageNumber }).from(userBooks)
    .innerJoin(books, eq(books.id, userBooks.bookId)).leftJoinLateral(latest, sql`true`).where(ownership(viewer, id))
  if (!book) throw notFound()
  return book
}
export async function listBooks(db: Database, viewer: Identity, query: {
  limit: number; cursor?: string; status?: z.infer<typeof ReadingStatus>; sort: z.infer<typeof LibrarySort>
}) {
  const latest = latestBookmark(db)
  const byReading = query.sort === 'read_recent' || query.sort === 'read_oldest'
  const ascending = query.sort === 'read_oldest' || query.sort === 'added_oldest'
  const order = ascending ? asc : desc
  const hasBookmark = sql<boolean>`${latest.createdAt} is not null`
  const sortDate = byReading ? sql`coalesce(${latest.createdAt}, ${userBooks.createdAt})` : userBooks.createdAt
  let afterCursor
  if (byReading) {
    const boundary = decodeCursor(query.cursor, readingBoundarySchema)
    const operator = ascending ? sql`>` : sql`<`
    if (boundary) afterCursor = sql`(${hasBookmark}, ${sortDate}, ${userBooks.id})
      ${operator} (${boundary.hasBookmark}::boolean, ${boundary.createdAt}::timestamptz, ${boundary.id}::uuid)`
  } else {
    afterCursor = (ascending ? newerThan : olderThan)(userBooks.createdAt, userBooks.id, decodeCursor(query.cursor))
  }
  await requireProfile(db, viewer.id)
  const rows = await db.select({ ...fields, latestBookmarkPage: latest.pageNumber, sortTime: preciseTimestamp(sortDate), hasBookmark })
    .from(userBooks).innerJoin(books, eq(books.id, userBooks.bookId)).leftJoinLateral(latest, sql`true`)
    .where(and(eq(userBooks.userId, viewer.id), query.status ? eq(userBooks.status, query.status) : undefined, afterCursor))
    .orderBy(...(byReading ? [order(hasBookmark)] : []), order(sortDate), order(userBooks.id)).limit(query.limit + 1)
  const page = rows.slice(0, query.limit)
  const last = page.at(-1)
  const items = page.map(({ sortTime, hasBookmark, ...item }) => item)
  const nextCursor = rows.length > query.limit && last ? encodeCursor({
    createdAt: last.sortTime, id: last.id, ...(byReading ? { hasBookmark: last.hasBookmark } : {}),
  }) : null
  return { items, nextCursor }
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
