import { and, asc, eq, exists, isNull, sql } from 'drizzle-orm'
import type { z } from '@hono/zod-openapi'
import type { Database } from '../../db/client'
import { bookmarkReplies, bookmarks, profiles } from '../../db/schema'
import type { Identity } from '../../middleware/auth'
import { decodeCursor, encodeCursor, newerThan, preciseTimestamp } from '../../shared/cursor'
import { ApiError, notFound } from '../../shared/errors'
import { requireProfile } from '../books/service'
import { canReadBookmark, lockBookmark } from '../bookmarks/service'
import type { CreateReplyRequest, PatchReplyRequest } from './schemas'

const fields = { id: bookmarkReplies.id, content: bookmarkReplies.content, isSpoiler: bookmarkReplies.isSpoiler,
  createdAt: preciseTimestamp(bookmarkReplies.createdAt), updatedAt: preciseTimestamp(bookmarkReplies.updatedAt),
  author: { id: profiles.id, displayName: profiles.displayName, avatarUrl: profiles.avatarUrl } }
const readableParent = (db: Database, viewer: Identity) => exists(db.select({ id: bookmarks.id }).from(bookmarks)
  .where(and(eq(bookmarks.id, bookmarkReplies.bookmarkId), canReadBookmark(db, viewer))))
async function getReply(db: Database, id: string, viewer: Identity) {
  const [reply] = await db.select(fields).from(bookmarkReplies).innerJoin(profiles, eq(profiles.id, bookmarkReplies.userId))
    .where(and(eq(bookmarkReplies.id, id), isNull(bookmarkReplies.deletedAt), readableParent(db, viewer)))
  if (!reply) throw notFound()
  return reply
}
export async function listReplies(db: Database, bookmarkId: string, query: { limit: number; cursor?: string }, viewer?: Identity) {
  const boundary = decodeCursor(query.cursor)
  const parent = db.$with('readable_parent').as(db.select({ id: bookmarks.id }).from(bookmarks)
    .where(and(eq(bookmarks.id, bookmarkId), canReadBookmark(db, viewer))))
  const candidates = db.select({ id: bookmarkReplies.id, userId: bookmarkReplies.userId, content: bookmarkReplies.content,
    isSpoiler: bookmarkReplies.isSpoiler, createdAt: bookmarkReplies.createdAt, updatedAt: bookmarkReplies.updatedAt,
  }).from(bookmarkReplies).where(and(eq(bookmarkReplies.bookmarkId, parent.id), isNull(bookmarkReplies.deletedAt), newerThan(bookmarkReplies.createdAt, bookmarkReplies.id, boundary)))
    .orderBy(asc(bookmarkReplies.createdAt), asc(bookmarkReplies.id)).limit(query.limit + 1).as('reply_candidates')
  const page = db.select({ id: candidates.id, content: candidates.content, isSpoiler: candidates.isSpoiler,
    createdAt: preciseTimestamp(candidates.createdAt).as('reply_created_at'), updatedAt: preciseTimestamp(candidates.updatedAt).as('reply_updated_at'),
    authorId: sql<string>`${profiles.id}`.as('reply_author_id'), displayName: profiles.displayName, avatarUrl: profiles.avatarUrl,
  }).from(candidates).innerJoin(profiles, eq(profiles.id, candidates.userId)).orderBy(asc(candidates.createdAt), asc(candidates.id)).as('reply_page')
  const rows = await db.with(parent).select({ parentId: parent.id, id: page.id, content: page.content, isSpoiler: page.isSpoiler,
    createdAt: page.createdAt, updatedAt: page.updatedAt, authorId: page.authorId, displayName: page.displayName, avatarUrl: page.avatarUrl,
  }).from(parent).leftJoinLateral(page, sql`true`).orderBy(asc(page.createdAt), asc(page.id))
  if (!rows.length) throw notFound()
  // A readable parent with no page has one NULL reply, not a missing parent.
  const replies = rows.flatMap((row) => row.id === null ? [] : [{ id: row.id, content: row.content!, isSpoiler: row.isSpoiler!,
    createdAt: row.createdAt!, updatedAt: row.updatedAt!, author: { id: row.authorId!, displayName: row.displayName!, avatarUrl: row.avatarUrl } }])
  const items = replies.slice(0, query.limit), last = items.at(-1)
  return { items, nextCursor: replies.length > query.limit && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null }
}
export async function createReply(db: Database, viewer: Identity, bookmarkId: string, input: z.infer<typeof CreateReplyRequest>) {
  await requireProfile(db, viewer.id)
  return db.transaction(async (tx) => {
    await lockBookmark(tx, bookmarkId)
    const [created] = await tx.insert(bookmarkReplies).values({ ...input, bookmarkId, userId: viewer.id }).returning({ id: bookmarkReplies.id })
    return getReply(tx, created.id, viewer)
  })
}
export async function patchReply(db: Database, viewer: Identity, id: string, patch: z.infer<typeof PatchReplyRequest>) {
  return db.transaction(async (tx) => {
    const owned = and(eq(bookmarkReplies.id, id), eq(bookmarkReplies.userId, viewer.id), isNull(bookmarkReplies.deletedAt))
    const [target] = await tx.select({ bookmarkId: bookmarkReplies.bookmarkId }).from(bookmarkReplies).where(owned)
    if (!target) throw notFound()
    const parent = await lockBookmark(tx, target.bookmarkId, viewer)
    const [current] = await tx.select({ id: bookmarkReplies.id }).from(bookmarkReplies).where(owned).for('update', { of: bookmarkReplies })
    if (!current) throw notFound()
    if (parent.visibility === 'public' && viewer.isAnonymous) throw new ApiError(403, 'REGISTRATION_REQUIRED', '正式登録が必要です')
    await tx.update(bookmarkReplies).set(patch).where(and(owned, readableParent(tx, viewer)))
    return getReply(tx, id, viewer)
  })
}
export async function deleteReply(db: Database, viewer: Identity, id: string) {
  const rows = await db.update(bookmarkReplies).set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
    .where(and(eq(bookmarkReplies.id, id), eq(bookmarkReplies.userId, viewer.id), isNull(bookmarkReplies.deletedAt))).returning({ id: bookmarkReplies.id })
  if (!rows.length) throw notFound()
}
