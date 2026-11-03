import { and, desc, eq, isNotNull } from 'drizzle-orm'
import type { Database } from '../../db/client'
import { bookmarkLikes, follows, profiles } from '../../db/schema'
import type { Identity } from '../../middleware/auth'
import { decodeCursor, encodeCursor, olderThan, preciseTimestamp } from '../../shared/cursor'
import { ApiError, notFound } from '../../shared/errors'
import { requireProfile } from '../books/service'
import { lockBookmark } from '../bookmarks/service'

export async function follow(db: Database, viewer: Identity, userId: string, add: boolean) {
  if (viewer.id === userId) throw new ApiError(400, 'VALIDATION_ERROR', '自分自身はフォローできません')
  await requireProfile(db, viewer.id)
  const [target] = await db.select({ id: profiles.id }).from(profiles).where(and(eq(profiles.id, userId), add ? isNotNull(profiles.registrationConfirmedAt) : undefined))
  if (!target) throw notFound()
  try {
    if (add) await db.insert(follows).values({ followerId: viewer.id, followingId: userId }).onConflictDoNothing()
    else await db.delete(follows).where(and(eq(follows.followerId, viewer.id), eq(follows.followingId, userId)))
  } catch (error) {
    const pg = error instanceof Error && error.cause instanceof Error ? error.cause : error
    if (pg && typeof pg === 'object' && 'code' in pg && pg.code === '23503' && 'constraint' in pg
      && ['follows_follower_id_profiles_id_fk', 'follows_following_id_profiles_id_fk'].includes(String(pg.constraint))) throw notFound()
    throw error
  }
}
export async function listRelations(db: Database, userId: string, kind: 'followers' | 'following', query: { limit: number; cursor?: string }) {
  const boundary = decodeCursor(query.cursor)
  await requireProfile(db, userId)
  const fixed = kind === 'followers' ? follows.followingId : follows.followerId
  const peer = kind === 'followers' ? follows.followerId : follows.followingId
  const rows = await db.select({ id: profiles.id, displayName: profiles.displayName, avatarUrl: profiles.avatarUrl,
    createdAt: preciseTimestamp(follows.createdAt),
  }).from(follows).innerJoin(profiles, eq(profiles.id, peer))
    .where(and(eq(fixed, userId), olderThan(follows.createdAt, peer, boundary)))
    .orderBy(desc(follows.createdAt), desc(peer)).limit(query.limit + 1)
  const selected = rows.slice(0, query.limit), last = selected.at(-1)
  return { items: selected.map(({ createdAt: _, ...user }) => user), nextCursor: rows.length > query.limit && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null }
}
export async function like(db: Database, viewer: Identity, bookmarkId: string, add: boolean) {
  await requireProfile(db, viewer.id)
  await db.transaction(async (tx) => {
    await lockBookmark(tx, bookmarkId)
    if (add) await tx.insert(bookmarkLikes).values({ userId: viewer.id, bookmarkId }).onConflictDoNothing()
    else await tx.delete(bookmarkLikes).where(and(eq(bookmarkLikes.userId, viewer.id), eq(bookmarkLikes.bookmarkId, bookmarkId)))
  })
}
