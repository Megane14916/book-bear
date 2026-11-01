import { sql, eq, and, isNull, exists } from 'drizzle-orm'
import type { z } from '@hono/zod-openapi'
import type { Database } from '../../db/client'
import { profiles, userPreferences, follows, bookmarks, userBooks } from '../../db/schema'
import type { Identity } from '../../middleware/auth'
import { ApiError, notFound, unauthorized } from '../../shared/errors'
import type { PatchProfile } from './schemas'
import type { PatchPreferences } from '../preferences/schemas'

const profileFields = (db: Database) => ({
  id: profiles.id, displayName: profiles.displayName, handle: profiles.handle,
  bio: profiles.bio, avatarUrl: profiles.avatarUrl,
  followersCount: sql<number>`${db.select({ count: sql`count(*)::int` }).from(follows).where(eq(follows.followingId, profiles.id))}`,
  followingCount: sql<number>`${db.select({ count: sql`count(*)::int` }).from(follows).where(eq(follows.followerId, profiles.id))}`,
})

export async function getMe(db: Database, identity: Identity) {
  const [profile] = await db.select(profileFields(db)).from(profiles).where(eq(profiles.id, identity.id))
  if (!profile) throw notFound()
  return { ...profile, isAnonymous: identity.isAnonymous }
}

export async function initializeMe(db: Database, identity: Identity) {
  try {
    return await db.transaction(async (tx) => {
      await tx.insert(profiles).values({ id: identity.id }).onConflictDoNothing({ target: profiles.id })
      await tx.insert(userPreferences).values({ userId: identity.id }).onConflictDoNothing({ target: userPreferences.userId })
      return getMe(tx, identity)
    })
  } catch (error) {
    // Drizzle wraps pg errors in cause. A deleted Auth identity cannot create
    // an application profile even while a previously issued JWT is unexpired.
    if (pgError(error)?.code === '23503') throw unauthorized()
    throw error
  }
}

export async function patchMe(db: Database, identity: Identity, patch: z.infer<typeof PatchProfile>) {
  try {
    return await db.transaction(async (tx) => {
      const rows = await tx.update(profiles).set(patch).where(eq(profiles.id, identity.id)).returning({ id: profiles.id })
      if (!rows.length) throw notFound()
      return getMe(tx, identity)
    })
  } catch (error) {
    const pg = pgError(error)
    if (pg?.code === '23505' && pg.constraint === 'ux_profiles_handle') throw new ApiError(409, 'ALREADY_EXISTS', 'このhandleは既に使用されています')
    throw error
  }
}

export async function getPreferences(db: Database, identity: Identity) {
  const [preferences] = await db.select({ feedContentMode: userPreferences.feedContentMode }).from(userPreferences).where(eq(userPreferences.userId, identity.id))
  if (!preferences) throw notFound()
  return preferences
}

export async function patchPreferences(db: Database, identity: Identity, patch: z.infer<typeof PatchPreferences>) {
  const [preferences] = await db.update(userPreferences).set(patch).where(eq(userPreferences.userId, identity.id))
    .returning({ feedContentMode: userPreferences.feedContentMode })
  if (!preferences) throw notFound()
  return preferences
}

export async function getPublicProfile(db: Database, userId: string, viewer: Identity | undefined) {
  const [profile] = await db.select({
    ...profileFields(db),
    publicBookmarkCount: sql<number>`${db.select({ count: sql`count(*)::int` }).from(bookmarks)
      .innerJoin(userBooks, eq(bookmarks.userBookId, userBooks.id))
      .where(and(eq(userBooks.userId, profiles.id), eq(bookmarks.visibility, 'public'), isNull(bookmarks.deletedAt)))}`,
    followedByMe: viewer ? exists(db.select({ id: follows.followerId }).from(follows)
      .where(and(eq(follows.followerId, viewer.id), eq(follows.followingId, profiles.id)))) : sql<boolean>`false`,
  }).from(profiles).where(eq(profiles.id, userId))
  if (!profile) throw new ApiError(404, 'NOT_FOUND', '対象が見つかりません')
  return profile
}

function pgError(error: unknown): { code: string; constraint?: string } | undefined {
  if (!(error instanceof Error)) return
  if ('code' in error && typeof error.code === 'string') return error as Error & { code: string; constraint?: string }
  if ('cause' in error && error.cause instanceof Error && 'code' in error.cause && typeof error.cause.code === 'string') return error.cause as Error & { code: string; constraint?: string }
}
