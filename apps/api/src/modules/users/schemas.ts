import { z } from '@hono/zod-openapi'
import { count, cursorPage, nonEmptyText, patchObject, uuid } from '../../shared/schemas'

const displayName = nonEmptyText().max(50)
const bio = z.string().max(500).nullable()
// Handle character/length policy is intentionally left to the profile implementation.
const handle = nonEmptyText().nullable()

export const UserSummary = z.object({
  id: uuid, displayName, avatarUrl: z.string().url().nullable(),
}).openapi('UserSummary')

const profileFields = {
  ...UserSummary.shape, handle, bio, followersCount: count, followingCount: count,
}
export const Profile = z.object({ ...profileFields, isAnonymous: z.boolean() }).openapi('Profile')
export const PublicProfile = z.object({
  ...profileFields, publicBookmarkCount: count, followedByMe: z.boolean(),
}).openapi('PublicProfile')
export const PatchProfile = patchObject({ displayName, bio, handle }).openapi('PatchProfile')
export const UserPage = cursorPage('UserPage', UserSummary)
