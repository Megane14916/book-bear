import { and, asc, desc, eq, exists, ilike, inArray, isNull, or, sql } from 'drizzle-orm'
import type { z } from '@hono/zod-openapi'
import type { Database } from '../../db/client'
import { bookmarkLikes, bookmarkReplies, bookmarks, books, follows, profiles, userBooks } from '../../db/schema'
import type { Identity } from '../../middleware/auth'
import { decodeCursor, encodeCursor, newerThan, olderThan, preciseTimestamp } from '../../shared/cursor'
import { ApiError, notFound } from '../../shared/errors'
import { bookSummaryFields, requireProfile } from '../books/service'
import type { CreateBookmarkRequest, PatchBookmarkRequest } from './schemas'

const bookmarkFields = {
  id: bookmarks.id, content: bookmarks.content, visibility: bookmarks.visibility, pageNumber: bookmarks.pageNumber, isSpoiler: bookmarks.isSpoiler,
  createdAt: preciseTimestamp(bookmarks.createdAt), updatedAt: preciseTimestamp(bookmarks.updatedAt),
}
const authorFields = { id: profiles.id, displayName: profiles.displayName, avatarUrl: profiles.avatarUrl }
const fields = { ...bookmarkFields, author: authorFields, book: bookSummaryFields }
const cardQuery = (db: Database) => db.select(fields).from(bookmarks)
  .innerJoin(userBooks, eq(userBooks.id, bookmarks.userBookId))
  .innerJoin(profiles, eq(profiles.id, userBooks.userId)).innerJoin(books, eq(books.id, userBooks.bookId))
const owned = (db: Database, viewer: Identity) => exists(db.select({ id: userBooks.id }).from(userBooks)
  .where(and(eq(userBooks.id, bookmarks.userBookId), eq(userBooks.userId, viewer.id))))
export const canReadBookmark = (db: Database, viewer?: Identity) => and(isNull(bookmarks.deletedAt),
  viewer ? or(eq(bookmarks.visibility, 'public'), owned(db, viewer)) : eq(bookmarks.visibility, 'public'))

async function withCounts<T extends { id: string }>(db: Database, cards: T[], viewer?: Identity) {
  if (!cards.length) return []
  const ids = cards.map((card) => card.id)
  const likes = await db.select({ id: bookmarkLikes.bookmarkId, count: sql<number>`count(*)::int`,
    liked: viewer ? sql<boolean>`bool_or(${bookmarkLikes.userId} = ${viewer.id}::uuid)` : sql<boolean>`false`,
  }).from(bookmarkLikes).where(inArray(bookmarkLikes.bookmarkId, ids)).groupBy(bookmarkLikes.bookmarkId)
  const replies = await db.select({ id: bookmarkReplies.bookmarkId, count: sql<number>`count(*)::int` }).from(bookmarkReplies)
    .where(and(inArray(bookmarkReplies.bookmarkId, ids), isNull(bookmarkReplies.deletedAt))).groupBy(bookmarkReplies.bookmarkId)
  const likesById = new Map(likes.map((row) => [row.id, row])), repliesById = new Map(replies.map((row) => [row.id, row.count]))
  return cards.map((card) => ({ ...card, likeCount: likesById.get(card.id)?.count ?? 0,
    likedByMe: likesById.get(card.id)?.liked ?? false, replyCount: repliesById.get(card.id) ?? 0 }))
}
export async function getBookmark(db: Database, id: string, viewer?: Identity) {
  const rows = await cardQuery(db).where(and(eq(bookmarks.id, id), canReadBookmark(db, viewer)))
  if (!rows.length) throw notFound()
  return (await withCounts(db, rows, viewer))[0]
}
export async function listBookmarks(db: Database, viewer: Identity, query: { limit: number; cursor?: string }) {
  const boundary = decodeCursor(query.cursor)
  await requireProfile(db, viewer.id)
  // Limit the candidate IDs before joining metadata; count only returned cards.
  const page = db.$with('bookmark_page').as(db.select({ id: bookmarks.id }).from(bookmarks)
    .where(and(owned(db, viewer), isNull(bookmarks.deletedAt), olderThan(bookmarks.createdAt, bookmarks.id, boundary)))
    .orderBy(desc(bookmarks.createdAt), desc(bookmarks.id)).limit(query.limit + 1))
  const rows = await db.with(page).select(fields).from(page).innerJoin(bookmarks, eq(bookmarks.id, page.id))
    .innerJoin(userBooks, eq(userBooks.id, bookmarks.userBookId)).innerJoin(profiles, eq(profiles.id, userBooks.userId))
    .innerJoin(books, eq(books.id, userBooks.bookId)).where(and(eq(userBooks.userId, viewer.id), isNull(bookmarks.deletedAt)))
    .orderBy(desc(bookmarks.createdAt), desc(bookmarks.id))
  const cards = rows.slice(0, query.limit), last = cards.at(-1)
  return { items: await withCounts(db, cards, viewer), nextCursor: rows.length > query.limit && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null }
}
export async function listPublicBookmarks(db: Database, query: { limit: number; boundary?: ReturnType<typeof decodeCursor>; followingUserId?: string; q?: string }, viewer?: Identity) {
  const followed = query.followingUserId ? exists(db.select({ id: userBooks.id }).from(userBooks)
    .innerJoin(follows, eq(follows.followingId, userBooks.userId))
    .where(and(eq(userBooks.id, bookmarks.userBookId), eq(follows.followerId, query.followingUserId)))) : undefined
  const matching = query.q === undefined ? undefined : ilike(bookmarks.content, `%${query.q.replace(/[\\%_]/g, '\\$&')}%`)
  const publicOnly = and(eq(bookmarks.visibility, 'public'), isNull(bookmarks.deletedAt), followed, matching)
  const page = db.$with('feed_page').as(db.select({ id: bookmarks.id }).from(bookmarks)
    .where(and(publicOnly, olderThan(bookmarks.createdAt, bookmarks.id, query.boundary)))
    .orderBy(desc(bookmarks.createdAt), desc(bookmarks.id)).limit(query.limit + 1))
  const rows = await db.with(page).select(fields).from(page).innerJoin(bookmarks, eq(bookmarks.id, page.id))
    .innerJoin(userBooks, eq(userBooks.id, bookmarks.userBookId)).innerJoin(profiles, eq(profiles.id, userBooks.userId))
    .innerJoin(books, eq(books.id, userBooks.bookId)).where(publicOnly)
    .orderBy(desc(bookmarks.createdAt), desc(bookmarks.id))
  const cards = rows.slice(0, query.limit), last = cards.at(-1)
  return { items: await withCounts(db, cards, viewer), nextCursor: rows.length > query.limit && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null }
}
export async function lockBookmark(db: Database, id: string, viewer?: Identity) {
  const [row] = await db.select({ visibility: bookmarks.visibility }).from(bookmarks)
    .where(and(eq(bookmarks.id, id), canReadBookmark(db, viewer))).for('share', { of: bookmarks })
  if (!row) throw notFound()
  return row
}
export async function getBookmarkFlow(db: Database, userId: string, bookId: string, query: { limit: number; cursor?: string }, viewer?: Identity) {
  const boundary = decodeCursor(query.cursor)
  const [author] = await db.select(authorFields).from(profiles).where(eq(profiles.id, userId))
  const [book] = await db.select(bookSummaryFields).from(books).where(eq(books.id, bookId))
  if (!author || !book) throw notFound()
  const [shelf] = await db.select({ id: userBooks.id }).from(userBooks)
    .where(and(eq(userBooks.userId, userId), eq(userBooks.bookId, bookId)))
  if (!shelf) return { author, book, items: [], nextCursor: null }
  const rows = await db.select(bookmarkFields).from(bookmarks).where(and(
    eq(bookmarks.userBookId, shelf.id), isNull(bookmarks.deletedAt),
    viewer?.id === userId ? undefined : eq(bookmarks.visibility, 'public'),
    newerThan(bookmarks.createdAt, bookmarks.id, boundary),
  )).orderBy(asc(bookmarks.createdAt), asc(bookmarks.id)).limit(query.limit + 1)
  const items = rows.slice(0, query.limit), last = items.at(-1)
  return { author, book, items: await withCounts(db, items, viewer),
    nextCursor: rows.length > query.limit && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null }
}
function requirePublishPermission(viewer: Identity, visibility: 'public' | 'private') {
  if (viewer.isAnonymous && visibility === 'public') throw new ApiError(403, 'REGISTRATION_REQUIRED', '正式登録が必要です')
}
export async function createBookmark(db: Database, viewer: Identity, input: z.infer<typeof CreateBookmarkRequest>) {
  try {
    return await db.transaction(async (tx) => {
      const [shelf] = await tx.select({ id: userBooks.id }).from(userBooks)
        .where(and(eq(userBooks.id, input.userBookId), eq(userBooks.userId, viewer.id)))
      if (!shelf) throw notFound()
      requirePublishPermission(viewer, input.visibility)
      const [created] = await tx.insert(bookmarks).values(input).returning({ id: bookmarks.id })
      return getBookmark(tx, created.id, viewer)
    })
  } catch (error) {
    const pg = error instanceof Error && error.cause instanceof Error ? error.cause : error
    if (pg && typeof pg === 'object' && 'code' in pg && pg.code === '23503' && 'constraint' in pg
      && pg.constraint === 'bookmarks_user_book_id_user_books_id_fk') throw notFound()
    throw error
  }
}
export async function patchBookmark(db: Database, viewer: Identity, id: string, patch: z.infer<typeof PatchBookmarkRequest>) {
  return db.transaction(async (tx) => {
    const [current] = await tx.select({ visibility: bookmarks.visibility }).from(bookmarks)
      .where(and(eq(bookmarks.id, id), isNull(bookmarks.deletedAt), owned(tx, viewer))).for('update')
    if (!current) throw notFound()
    requirePublishPermission(viewer, patch.visibility ?? current.visibility)
    await tx.update(bookmarks).set(patch).where(and(eq(bookmarks.id, id), isNull(bookmarks.deletedAt), owned(tx, viewer)))
    return getBookmark(tx, id, viewer)
  })
}
export async function deleteBookmark(db: Database, viewer: Identity, id: string) {
  const rows = await db.update(bookmarks).set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
    .where(and(eq(bookmarks.id, id), isNull(bookmarks.deletedAt), owned(db, viewer))).returning({ id: bookmarks.id })
  if (!rows.length) throw notFound()
}
